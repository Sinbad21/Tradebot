/**
 * Trading Bot v3.0 — Cloudflare Worker
 * 
 * Cron trigger ogni 5 min → scansiona mercato → gestisce posizioni
 * D1 database per persistenza
 * API REST per la GUI desktop
 */

// ─────────────────────────────────────
// CONFIG DEFAULTS (overridable via DB)
// ─────────────────────────────────────
const CONFIG_DEFAULTS = {
  initial_capital: 5000,
  max_positions: 10,
  risk_per_trade: 0.02,
  stop_loss_pct: 0.025,
  trailing_activation: 0.015,
  trailing_distance: 0.012,
  cooldown_minutes: 30,
  learn_rate: 0.05,
  min_weight: 0.05,
  max_weight: 2.0,
  min_trades_to_learn: 5,
  spread_slippage_pct: 0.001,
};

const CONFIG_META = {
  initial_capital: { label: "Capitale iniziale (€)", type: "number", step: 100 },
  max_positions: { label: "Max posizioni aperte", type: "number", step: 1 },
  risk_per_trade: { label: "Rischio per trade (%)", type: "number", step: 0.005, pct: true },
  stop_loss_pct: { label: "Stop Loss (%)", type: "number", step: 0.005, pct: true },
  trailing_activation: { label: "Trailing attivazione (%)", type: "number", step: 0.005, pct: true },
  trailing_distance: { label: "Trailing distanza (%)", type: "number", step: 0.005, pct: true },
  cooldown_minutes: { label: "Cooldown (minuti)", type: "number", step: 5 },
  learn_rate: { label: "Brain learn rate", type: "number", step: 0.01 },
  min_weight: { label: "Brain peso minimo", type: "number", step: 0.01 },
  max_weight: { label: "Brain peso massimo", type: "number", step: 0.1 },
  min_trades_to_learn: { label: "Min trade per apprendere", type: "number", step: 1 },
  spread_slippage_pct: { label: "Spread/Slippage (%)", type: "number", step: 0.0005, pct: true },
};

async function getSettings(db) {
  const rows = (await db.prepare("SELECT key, value FROM config WHERE key LIKE 'cfg_%'").all()).results || [];
  const settings = { ...CONFIG_DEFAULTS };
  for (const r of rows) {
    const k = r.key.replace('cfg_', '');
    if (k in CONFIG_DEFAULTS) settings[k] = parseFloat(r.value);
  }
  return settings;
}

async function saveSetting(db, key, value) {
  if (!(key in CONFIG_DEFAULTS)) return false;
  const v = parseFloat(value);
  if (isNaN(v)) return false;
  await db.prepare("INSERT OR REPLACE INTO config VALUES (?, ?)").bind('cfg_' + key, v.toString()).run();
  return true;
}

// Backward compat — still used in getCapital default
const INITIAL_CAPITAL = CONFIG_DEFAULTS.initial_capital;

// ─────────────────────────────────────
// WATCHLIST
// ─────────────────────────────────────
const WATCHLIST = {
  // US Stocks
  NVDA: "NVIDIA", AAPL: "Apple", TSLA: "Tesla", META: "Meta",
  AMZN: "Amazon", MSFT: "Microsoft", GOOGL: "Alphabet",
  JPM: "JPMorgan", XOM: "ExxonMobil",
  GLD: "Gold ETF", SPY: "S&P 500", QQQ: "Nasdaq 100",
  // EU Stocks (Milano, Francoforte, Parigi, Amsterdam)
  "ENI.MI": "ENI", "ISP.MI": "Intesa Sanpaolo", "UCG.MI": "UniCredit",
  "ENEL.MI": "Enel", "STLAM.MI": "Stellantis",
  "SAP.DE": "SAP", "SIE.DE": "Siemens", "BAS.DE": "BASF",
  "MC.PA": "LVMH", "OR.PA": "L'Or\u00e9al", "TTE.PA": "TotalEnergies",
  "ASML.AS": "ASML",
  // Crypto
  "BTC-USD": "Bitcoin", "ETH-USD": "Ethereum", "SOL-USD": "Solana",
  "XRP-USD": "XRP", "DOGE-USD": "Dogecoin", "ADA-USD": "Cardano",
};

// ─────────────────────────────────────
// DATA FETCHING — Alpaca primary, Yahoo fallback
// ─────────────────────────────────────

// Alpaca API
async function fetchBarsAlpaca(ticker, env, limit = 100) {
  // Crypto su Alpaca usa formato diverso (BTC/USD non BTC-USD)
  const isCrypto = ticker.includes("-USD");
  const isEU = /\.(MI|DE|PA|AS|L|MC)$/.test(ticker);
  if (isCrypto || isEU) return []; // Solo azioni USA su Alpaca

  const apiKey = env.ALPACA_KEY;
  const secret = env.ALPACA_SECRET;
  if (!apiKey || !secret) return [];

  try {
    const url = `https://data.alpaca.markets/v2/stocks/${ticker}/bars?timeframe=1Day&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": secret,
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const rawBars = data.bars || [];
    return rawBars.map((b) => ({
      time: new Date(b.t).getTime() / 1000,
      open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v,
    }));
  } catch (e) {
    return [];
  }
}

async function fetchLatestPrice(ticker, env) {
  const isCrypto = ticker.includes("-USD");
  const isEU = /\.(MI|DE|PA|AS|L|MC)$/.test(ticker);

  // Alpaca real-time per US stocks only
  if (!isCrypto && !isEU) {
    const apiKey = env.ALPACA_KEY;
    const secret = env.ALPACA_SECRET;
    if (apiKey && secret) {
      try {
        const url = `https://data.alpaca.markets/v2/stocks/${ticker}/trades/latest`;
        const res = await fetch(url, {
          headers: {
            "APCA-API-KEY-ID": apiKey,
            "APCA-API-SECRET-KEY": secret,
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.trade?.p) return data.trade.p;
        }
      } catch {}
    }
  }

  // Yahoo fallback (stocks + crypto)
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=5m`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (res.ok) {
      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (meta?.regularMarketPrice) return meta.regularMarketPrice;
    }
  } catch {}

  return null;
}

// Yahoo Finance (fallback per tutto, primario per crypto)
async function fetchBarsYahoo(ticker, range = "3mo", interval = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return [];

    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close?.[i] != null && q.high?.[i] != null && q.low?.[i] != null) {
        bars.push({
          time: ts[i],
          open: q.open?.[i] || q.close[i],
          high: q.high[i],
          low: q.low[i],
          close: q.close[i],
          volume: q.volume?.[i] || 0,
        });
      }
    }
    return bars;
  } catch (e) {
    return [];
  }
}

// Unified fetcher: Alpaca first (real-time), Yahoo fallback
async function fetchBars(ticker, env, range = "3mo", interval = "1d") {
  // Try Alpaca first (stocks only, real-time)
  const alpacaBars = await fetchBarsAlpaca(ticker, env);
  if (alpacaBars.length >= 30) return alpacaBars;

  // Fallback to Yahoo (works for everything)
  return fetchBarsYahoo(ticker, range, interval);
}

// ─────────────────────────────────────
// INDICATORS
// ─────────────────────────────────────
function ema(data, span) {
  const k = 2 / (span + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function addIndicators(bars) {
  if (bars.length < 50) return [];
  const close = bars.map((b) => b.close);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const vol = bars.map((b) => b.volume);

  const ema9 = ema(close, 9);
  const ema21 = ema(close, 21);
  const ema50 = ema(close, 50);
  const ema45 = ema(close, 45); // weekly proxy
  const ema105 = ema(close, 105);

  // RSI
  const rsi = new Array(close.length).fill(50);
  const gains = [], losses = [];
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  if (gains.length >= 14) {
    let avgGain = gains.slice(0, 14).reduce((a, b) => a + b) / 14;
    let avgLoss = losses.slice(0, 14).reduce((a, b) => a + b) / 14;
    for (let i = 14; i < gains.length; i++) {
      avgGain = (avgGain * 13 + gains[i]) / 14;
      avgLoss = (avgLoss * 13 + losses[i]) / 14;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi[i + 1] = 100 - 100 / (1 + rs);
    }
  }

  // MACD
  const emaF = ema(close, 10);
  const emaS = ema(close, 22);
  const macd = emaF.map((v, i) => v - emaS[i]);
  const macdSig = ema(macd, 7);
  const macdHist = macd.map((v, i) => v - macdSig[i]);

  // Bollinger
  const bbUp = [], bbLo = [];
  for (let i = 0; i < close.length; i++) {
    if (i < 19) { bbUp.push(null); bbLo.push(null); continue; }
    const slice = close.slice(i - 19, i + 1);
    const mean = slice.reduce((a, b) => a + b) / 20;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / 20);
    bbUp.push(mean + std * 2);
    bbLo.push(mean - std * 2);
  }

  // ATR
  const atr = new Array(close.length).fill(0);
  const tr = [];
  for (let i = 1; i < close.length; i++) {
    tr.push(Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1])));
  }
  if (tr.length >= 14) {
    let sum = tr.slice(0, 14).reduce((a, b) => a + b) / 14;
    atr[14] = sum;
    for (let i = 14; i < tr.length; i++) {
      sum = (sum * 13 + tr[i]) / 14;
      atr[i + 1] = sum;
    }
  }

  // Volume avg
  const volAvg = new Array(close.length).fill(0);
  for (let i = 19; i < close.length; i++) {
    volAvg[i] = vol.slice(i - 19, i + 1).reduce((a, b) => a + b) / 20;
  }

  // 5-day change
  const chg5d = close.map((c, i) => i >= 5 ? (c - close[i - 5]) / close[i - 5] : 0);

  // Build enriched bars
  return bars.map((b, i) => ({
    ...b,
    ema9: ema9[i], ema21: ema21[i], ema50: ema50[i],
    ema45: ema45[i], ema105: ema105[i],
    rsi: rsi[i],
    macd: macd[i], macdSig: macdSig[i], macdHist: macdHist[i],
    bbUp: bbUp[i], bbLo: bbLo[i],
    atr: atr[i], volAvg: volAvg[i],
    volP1: i > 0 ? vol[i - 1] : 0,
    volP2: i > 1 ? vol[i - 2] : 0,
    chg5d: chg5d[i],
  }));
}

// ─────────────────────────────────────
// SIGNAL GENERATION
// ─────────────────────────────────────
function generateSignal(row, prev, spyRow, weights) {
  let score = 0;
  const reasons = [];
  const activeInd = [];

  const w = (name) => weights[name] ?? 0.5;

  // MACD
  if (prev.macd <= prev.macdSig && row.macd > row.macdSig) {
    score += w("macd_cross"); reasons.push("MACD cross ↑"); activeInd.push("macd_cross");
  } else if (prev.macd >= prev.macdSig && row.macd < row.macdSig) {
    score -= w("macd_cross"); reasons.push("MACD cross ↓"); activeInd.push("macd_cross");
  }
  if (row.macdHist > 0 && row.macdHist > prev.macdHist) {
    score += w("macd_hist"); activeInd.push("macd_hist");
  } else if (row.macdHist < 0 && row.macdHist < prev.macdHist) {
    score -= w("macd_hist"); activeInd.push("macd_hist");
  }

  // RSI
  const rsi = row.rsi;
  const wRsi = w("rsi");
  if (rsi < 25) { score += wRsi * 1.5; reasons.push(`RSI estremo ${rsi.toFixed(0)}`); activeInd.push("rsi"); }
  else if (rsi < 35) { score += wRsi; reasons.push(`RSI basso ${rsi.toFixed(0)}`); activeInd.push("rsi"); }
  else if (rsi > 75) { score -= wRsi * 1.5; activeInd.push("rsi"); }
  else if (rsi > 65) { score -= wRsi; activeInd.push("rsi"); }

  // EMA
  if (row.ema9 > row.ema21) { score += w("ema_trend"); activeInd.push("ema_trend"); }
  else if (row.ema9 < row.ema21) { score -= w("ema_trend"); activeInd.push("ema_trend"); }

  // Bollinger
  if (row.bbLo && row.close <= row.bbLo) { score += w("bollinger"); reasons.push("BB sotto"); activeInd.push("bollinger"); }
  else if (row.bbUp && row.close >= row.bbUp) { score -= w("bollinger"); activeInd.push("bollinger"); }

  // Mean reversion
  let meanRev = false;
  if (row.chg5d < -0.05 && rsi < 30) {
    score += w("mean_rev"); meanRev = true; reasons.push("MEAN REVERSION"); activeInd.push("mean_rev");
  } else if (row.chg5d > 0.08 && rsi > 75) {
    score -= w("mean_rev"); activeInd.push("mean_rev");
  }

  // Filters
  let signal = 0;
  if (score >= 0.8) {
    let buyOk = true;
    const reject = [];

    // Volume
    if (row.volAvg > 0 && row.volume < row.volAvg * 0.6) { buyOk = false; reject.push("vol basso"); }

    // Weekly trend
    if (row.ema45 < row.ema105 && !meanRev) { buyOk = false; reject.push("weekly ↓"); }

    // SPY regime
    if (spyRow && spyRow.close < spyRow.ema50 && !meanRev) { buyOk = false; reject.push("SPY<EMA50"); }

    // EMA50 filter
    if (row.close < row.ema50 && !meanRev) { score -= 0.3; if (score < 0.8) { buyOk = false; reject.push("<EMA50"); } }

    // Volume growing bonus
    if (row.volume > row.volP1 && row.volP1 > row.volP2) {
      score += w("vol_growing"); reasons.push("vol crescente"); activeInd.push("vol_growing");
    }

    if (buyOk && score >= 0.8) signal = 1;
    else if (reject.length) reasons.push(`FILTRATO: ${reject.join(", ")}`);
  } else if (score <= -0.8) {
    signal = -1;
  }

  return { signal, score: +score.toFixed(2), rsi: +rsi.toFixed(1), atr: row.atr, reasons, activeInd };
}

// ─────────────────────────────────────
// DATABASE HELPERS
// ─────────────────────────────────────
async function getCapital(db) {
  const r = await db.prepare("SELECT value FROM config WHERE key='capital'").first();
  if (r) return parseFloat(r.value);
  const cfg = await getSettings(db);
  return cfg.initial_capital;
}

async function setCapital(db, val) {
  await db.prepare("INSERT OR REPLACE INTO config VALUES ('capital', ?)").bind(val.toFixed(2)).run();
}

async function getPositions(db) {
  return (await db.prepare("SELECT * FROM positions").all()).results || [];
}

async function getWeights(db) {
  const rows = (await db.prepare("SELECT * FROM brain").all()).results || [];
  const w = {};
  rows.forEach((r) => { w[r.indicator] = r.weight; });
  return w;
}

async function getTotalTrained(db) {
  const r = await db.prepare("SELECT value FROM config WHERE key='total_trades'").first();
  return r ? parseInt(r.value) : 0;
}

// ─────────────────────────────────────
// BRAIN LEARNING
// ─────────────────────────────────────
async function brainLearn(db, indicators, pnl, pnlPct) {
  if (!indicators || !indicators.length) return "";

  const totalTrained = await getTotalTrained(db) + 1;
  await db.prepare("INSERT OR REPLACE INTO config VALUES ('total_trades', ?)").bind(totalTrained.toString()).run();

  // Save to history
  await db.prepare("INSERT INTO brain_history (indicators, pnl, pnl_pct, created_at) VALUES (?,?,?,?)")
    .bind(JSON.stringify(indicators), pnl, pnlPct, new Date().toISOString()).run();

  const cfg = await getSettings(db);
  if (totalTrained < cfg.min_trades_to_learn) return `Trade ${totalTrained}/${cfg.min_trades_to_learn} — raccolta dati`;

  const isWin = pnl > 0;
  const magnitude = Math.min(Math.abs(pnlPct) / 5, 1.0);
  const delta = cfg.learn_rate * magnitude;
  const adjustments = [];

  for (const ind of indicators) {
    const row = await db.prepare("SELECT weight FROM brain WHERE indicator=?").bind(ind).first();
    if (!row) continue;
    let newW = isWin ? Math.min(row.weight + delta, cfg.max_weight) : Math.max(row.weight - delta, cfg.min_weight);
    await db.prepare("UPDATE brain SET weight=? WHERE indicator=?").bind(+newW.toFixed(4), ind).run();
    adjustments.push(`${ind}${isWin ? "+" : "-"}${delta.toFixed(3)}`);
  }

  // Bonus for inactive indicators on loss
  if (!isWin) {
    const allInd = ["macd_cross", "macd_hist", "rsi", "ema_trend", "bollinger", "mean_rev", "vol_growing"];
    const inactive = allInd.filter((i) => !indicators.includes(i));
    for (const ind of inactive) {
      const row = await db.prepare("SELECT weight FROM brain WHERE indicator=?").bind(ind).first();
      if (row) {
        const newW = Math.min(row.weight + cfg.learn_rate * 0.3, cfg.max_weight);
        await db.prepare("UPDATE brain SET weight=? WHERE indicator=?").bind(+newW.toFixed(4), ind).run();
      }
    }
  }

  return `${isWin ? "WIN" : "LOSS"} ${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(1)}% → ${adjustments.join(", ")}`;
}

// ─────────────────────────────────────
// POSITION MANAGEMENT
// ─────────────────────────────────────
async function openPosition(db, ticker, name, price, atr, score, activeInd) {
  const cfg = await getSettings(db);
  const positions = await getPositions(db);
  if (positions.length >= cfg.max_positions) return null;
  if (positions.find((p) => p.ticker === ticker)) return null;

  const capital = await getCapital(db);
  const slDist = Math.max(atr * 1.5, price * cfg.stop_loss_pct);
  if (slDist <= 0 || price <= 0) return null;

  const isCrypto = ticker.includes("-USD");
  let shares;
  if (isCrypto) {
    shares = +((capital * cfg.risk_per_trade) / slDist).toFixed(6);
    const maxShares = +((capital * 0.35) / price).toFixed(6);
    shares = Math.min(shares, maxShares);
    if (shares * price < 1) return null;
  } else {
    shares = Math.max(1, Math.floor((capital * cfg.risk_per_trade) / slDist));
    const maxShares = Math.floor((capital * 0.35) / price);
    shares = Math.min(shares, maxShares);
    if (shares < 1) return null;
  }

  // Simulate buy at ask (price + spread/slippage)
  const execPrice = +(price * (1 + cfg.spread_slippage_pct)).toFixed(4);
  const cost = +(shares * execPrice).toFixed(2);
  const sl = +(execPrice - slDist).toFixed(2);
  const tp = +(execPrice + slDist * 2).toFixed(2);

  await db.prepare(
    `INSERT INTO positions (ticker,name,entry_price,shares,stop_loss,take_profit,highest,cost,opened_at,score_at_entry,current_price,brain_indicators)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(ticker, name, execPrice, shares, sl, tp, execPrice, cost, new Date().toISOString(), score, execPrice, JSON.stringify(activeInd)).run();

  await setCapital(db, capital - cost);
  return { ticker, name, shares, entry_price: execPrice, stop_loss: sl, take_profit: tp, cost };
}

async function closePosition(db, ticker, price, reason) {
  const pos = await db.prepare("SELECT * FROM positions WHERE ticker=?").bind(ticker).first();
  if (!pos) return null;

  // Simulate sell at bid (price - spread/slippage)
  const cfg = await getSettings(db);
  const execPrice = +(price * (1 - cfg.spread_slippage_pct)).toFixed(4);
  const revenue = pos.shares * execPrice;
  const pnl = +(revenue - pos.cost).toFixed(2);
  const pnlPct = +((execPrice - pos.entry_price) / pos.entry_price * 100).toFixed(2);

  // Save closed trade
  await db.prepare(
    `INSERT INTO closed_trades (ticker,name,entry_price,exit_price,shares,cost,revenue,pnl,pnl_pct,reason,opened_at,closed_at,brain_indicators)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(pos.ticker, pos.name, pos.entry_price, execPrice, pos.shares, pos.cost, revenue, pnl, pnlPct, reason, pos.opened_at, new Date().toISOString(), pos.brain_indicators).run();

  // Brain learn
  let brainMsg = "";
  try {
    const indicators = JSON.parse(pos.brain_indicators || "[]");
    brainMsg = await brainLearn(db, indicators, pnl, pnlPct);
  } catch (e) {}

  // Update capital
  const capital = await getCapital(db);
  await setCapital(db, capital + revenue);

  // Remove position
  await db.prepare("DELETE FROM positions WHERE ticker=?").bind(ticker).run();

  return { ticker, name: pos.name, pnl, pnlPct, reason, brainMsg };
}

// ─────────────────────────────────────
// MAIN SCAN
// ─────────────────────────────────────
async function scan(db, env) {
  const cfg = await getSettings(db);
  const weights = await getWeights(db);
  const capital = await getCapital(db);
  const positions = await getPositions(db);
  const now = new Date().toISOString();
  const results = { buys: [], closes: [], scores: [], spyStatus: null, capital, equity: capital };

  // Fetch SPY for market regime
  let spyRow = null;
  const spyBars = await fetchBars("SPY", env);
  if (spyBars.length >= 50) {
    const spyEnriched = addIndicators(spyBars);
    if (spyEnriched.length > 0) spyRow = spyEnriched[spyEnriched.length - 1];
  }

  if (spyRow) {
    results.spyStatus = {
      price: +spyRow.close.toFixed(2),
      ema50: +spyRow.ema50.toFixed(2),
      bullish: spyRow.close > spyRow.ema50,
    };
  }

  // Update prices & check stops
  for (const pos of positions) {
    const bars = await fetchBars(pos.ticker, env, "5d", "1d");
    if (bars.length > 0) {
      const high = bars[bars.length - 1].high;
      const low = bars[bars.length - 1].low;

      // Get real-time price, fallback to daily close
      const livePrice = await fetchLatestPrice(pos.ticker, env) || bars[bars.length - 1].close;

      // Update price with real-time data
      await db.prepare("UPDATE positions SET current_price=?, unrealized_pnl=?, unrealized_pct=? WHERE ticker=?")
        .bind(livePrice, +((livePrice - pos.entry_price) * pos.shares).toFixed(2),
              +((livePrice - pos.entry_price) / pos.entry_price * 100).toFixed(2), pos.ticker).run();

      // Trailing stop (use daily high for highest tracking)
      const effectiveHigh = Math.max(high, livePrice);
      let highest = Math.max(pos.highest, effectiveHigh);
      let sl = pos.stop_loss;
      let trailingActive = pos.trailing_active;
      const gainPct = (highest - pos.entry_price) / pos.entry_price;
      if (gainPct >= cfg.trailing_activation) {
        trailingActive = 1;
        const newSl = +(highest * (1 - cfg.trailing_distance)).toFixed(2);
        if (newSl > sl) sl = newSl;
      }
      await db.prepare("UPDATE positions SET highest=?, stop_loss=?, trailing_active=? WHERE ticker=?")
        .bind(highest, sl, trailingActive, pos.ticker).run();

      // Check SL/TP using live price
      if (pos.auto_sl) {
        if (livePrice <= sl || low <= sl) {
          const trade = await closePosition(db, pos.ticker, sl, "stop_loss");
          if (trade) results.closes.push(trade);
          continue;
        }
        if (livePrice >= pos.take_profit || high >= pos.take_profit) {
          const trade = await closePosition(db, pos.ticker, pos.take_profit, "take_profit");
          if (trade) results.closes.push(trade);
          continue;
        }
      }

      results.equity += livePrice * pos.shares;
    }
  }

  // Scan watchlist for signals
  for (const [ticker, name] of Object.entries(WATCHLIST)) {
    if (ticker === "SPY") continue;
    try {
      const bars = await fetchBars(ticker, env);
      if (bars.length < 50) continue;
      const enriched = addIndicators(bars);
      if (enriched.length < 2) continue;

      const row = enriched[enriched.length - 1];
      const prev = enriched[enriched.length - 2];
      const { signal, score, rsi, atr, reasons, activeInd } = generateSignal(row, prev, spyRow, weights);

      results.scores.push({ ticker, name, price: +row.close.toFixed(2), score, rsi, signal, reasons });

      // Save to scan log (keep last 100)
      await db.prepare("INSERT INTO scan_log (created_at,ticker,price,score,rsi,signal,reasons) VALUES (?,?,?,?,?,?,?)")
        .bind(now, ticker, row.close, score, rsi, signal, reasons.join(", ")).run();

      if (signal === 1) {
        const pos = await openPosition(db, ticker, name, row.close, atr, score, activeInd);
        if (pos) results.buys.push(pos);
      } else if (signal === -1) {
        const existing = positions.find((p) => p.ticker === ticker);
        if (existing) {
          // Signal sell — log warning but don't auto-close
          results.scores.find((s) => s.ticker === ticker).sellWarning = true;
        }
      }
    } catch (e) {}
  }

  // Cleanup old scan logs
  await db.prepare("DELETE FROM scan_log WHERE id NOT IN (SELECT id FROM scan_log ORDER BY id DESC LIMIT 500)").run();

  // Recalculate equity
  const updatedPositions = await getPositions(db);
  results.equity = await getCapital(db);
  for (const p of updatedPositions) {
    results.equity += (p.current_price || p.entry_price) * p.shares;
  }
  results.positions = updatedPositions;
  results.capital = await getCapital(db);
  results.timestamp = now;

  return results;
}

// ─────────────────────────────────────
// API HANDLERS
// ─────────────────────────────────────

// Auth helpers
async function hmacSign(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function createToken(env) {
  const secret = env.DASHBOARD_PASSWORD;
  const expires = Date.now() + 24 * 60 * 60 * 1000; // 24h
  const payload = "tradebot:" + expires;
  const sig = await hmacSign(payload, secret);
  return payload + ":" + sig;
}

async function verifyToken(token, env) {
  const secret = env.DASHBOARD_PASSWORD;
  if (!secret || !token) return false;
  const parts = token.split(":");
  if (parts.length !== 3) return false;
  const [prefix, expires, sig] = parts;
  if (Date.now() > parseInt(expires)) return false;
  const expected = await hmacSign(prefix + ":" + expires, secret);
  return sig === expected;
}

function getTokenFromRequest(request) {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(/tb_auth=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function cors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

function json(data, status = 200) {
  return cors(new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

async function handleAPI(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const db = env.DB;

  if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));

  // Auth: if DASHBOARD_PASSWORD is set, protect all routes
  const needsAuth = !!env.DASHBOARD_PASSWORD;

  // Login page (always accessible)
  if (path === "/login" && request.method === "GET") {
    if (!needsAuth) return Response.redirect(url.origin + "/", 302);
    return new Response(LOGIN_HTML, { headers: { "Content-Type": "text/html" } });
  }

  // Login API
  if (path === "/api/login" && request.method === "POST") {
    if (!needsAuth) return json({ success: true });
    const body = await request.json();
    if (body.password === env.DASHBOARD_PASSWORD) {
      const token = await createToken(env);
      const res = json({ success: true });
      res.headers.set("Set-Cookie", "tb_auth=" + encodeURIComponent(token) + "; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400");
      return res;
    }
    return json({ error: "Password errata" }, 401);
  }

  // Logout
  if (path === "/api/logout") {
    const res = Response.redirect(url.origin + "/login", 302);
    return new Response(null, {
      status: 302,
      headers: {
        "Location": url.origin + "/login",
        "Set-Cookie": "tb_auth=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
      }
    });
  }

  // Check auth for all other routes
  if (needsAuth) {
    const token = getTokenFromRequest(request);
    const valid = await verifyToken(token, env);
    if (!valid) {
      if (path.startsWith("/api/")) {
        return json({ error: "Non autenticato" }, 401);
      }
      return Response.redirect(url.origin + "/login", 302);
    }
  }

  // GET /api/status — full status
  if (path === "/api/status") {
    try {
    const capital = await getCapital(db);
    const positions = await getPositions(db);
    const weights = await getWeights(db);
    const totalTrained = await getTotalTrained(db);
    const closedTrades = (await db.prepare("SELECT * FROM closed_trades ORDER BY id DESC").all()).results || [];
    const recentLogs = (await db.prepare("SELECT * FROM scan_log ORDER BY id DESC LIMIT 50").all()).results || [];

    // Fetch live prices for open positions
    for (const pos of positions) {
      try {
        const livePrice = await fetchLatestPrice(pos.ticker, env);
        if (livePrice) {
          pos.current_price = livePrice;
          pos.unrealized_pnl = +((livePrice - pos.entry_price) * pos.shares).toFixed(2);
          pos.unrealized_pct = +((livePrice - pos.entry_price) / pos.entry_price * 100).toFixed(2);
          await db.prepare("UPDATE positions SET current_price=?, unrealized_pnl=?, unrealized_pct=? WHERE ticker=?")
            .bind(livePrice, pos.unrealized_pnl, pos.unrealized_pct, pos.ticker).run();
        }
      } catch (e) {}
    }

    let equity = capital;
    positions.forEach((p) => { equity += (p.current_price || p.entry_price) * p.shares; });

    const wins = closedTrades.filter((t) => t.pnl > 0).length;
    const totalClosed = closedTrades.length;

    return json({
      capital: +capital.toFixed(2),
      equity: +equity.toFixed(2),
      pnl: +(equity - (await getSettings(db)).initial_capital).toFixed(2),
      dataSource: env.ALPACA_KEY ? "ALPACA + Yahoo" : "Yahoo Finance",
      positions: positions.map((p) => ({
        ...p,
        trailing_active: !!p.trailing_active,
        auto_sl: !!p.auto_sl,
        brain_indicators: JSON.parse(p.brain_indicators || "[]"),
      })),
      closedTrades,
      brain: { weights, totalTrained, confidence: Math.min(totalTrained / 100 * 100, 100) },
      stats: { total: totalClosed, wins, wr: totalClosed > 0 ? +(wins / totalClosed * 100).toFixed(1) : 0 },
      recentScores: recentLogs,
      maxPositions: (await getSettings(db)).max_positions,
    });
    } catch (e) {
      return json({ error: e.message, stack: e.stack }, 500);
    }
  }

  // GET /api/scan — trigger scan
  if (path === "/api/scan") {
    try {
      const result = await scan(db, env);
      return json(result);
    } catch (e) {
      return json({ error: e.message, stack: e.stack }, 500);
    }
  }

  // POST /api/close — close position
  if (path === "/api/close" && request.method === "POST") {
    const { ticker, price } = await request.json();
    if (!ticker) return json({ error: "ticker required" }, 400);
    const pos = await db.prepare("SELECT * FROM positions WHERE ticker=?").bind(ticker).first();
    const closePrice = price || pos?.current_price || pos?.entry_price;
    const trade = await closePosition(db, ticker, closePrice, "manual_close");
    return json(trade || { error: "Position not found" });
  }

  // POST /api/close-all
  if (path === "/api/close-all" && request.method === "POST") {
    const positions = await getPositions(db);
    const results = [];
    for (const p of positions) {
      const trade = await closePosition(db, p.ticker, p.current_price || p.entry_price, "manual_close");
      if (trade) results.push(trade);
    }
    return json({ closed: results });
  }

  // POST /api/reset
  if (path === "/api/reset" && request.method === "POST") {
    const cfg = await getSettings(db);
    await db.prepare("DELETE FROM positions").run();
    await db.prepare("DELETE FROM closed_trades").run();
    await db.prepare("DELETE FROM scan_log").run();
    await db.prepare("DELETE FROM brain_history").run();
    await db.prepare("UPDATE brain SET weight = default_weight").run();
    await setCapital(db, cfg.initial_capital);
    await db.prepare("INSERT OR REPLACE INTO config VALUES ('total_trades', '0')").run();
    return json({ success: true, capital: cfg.initial_capital });
  }

  // GET /api/settings
  if (path === "/api/settings" && request.method === "GET") {
    const settings = await getSettings(db);
    return json({ settings, meta: CONFIG_META });
  }

  // POST /api/settings
  if (path === "/api/settings" && request.method === "POST") {
    const body = await request.json();
    const updated = [];
    for (const [key, value] of Object.entries(body)) {
      if (await saveSetting(db, key, value)) updated.push(key);
    }
    const settings = await getSettings(db);
    return json({ success: true, updated, settings });
  }

  // GET / — dashboard HTML
  if (path === "/") {
    return cors(new Response(DASHBOARD_HTML, {
      headers: { "Content-Type": "text/html" },
    }));
  }

  return json({ error: "Not found" }, 404);
}

// ─────────────────────────────────────
// LOGIN PAGE
// ─────────────────────────────────────
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"><title>Trading Bot — Login</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b0f19;--card:#151c2c;--border:#252e42;--text:#eef0f6;--text2:#94a3b8;--text3:#64748b;--accent:#8b5cf6;--red:#ef4444;--green:#10b981}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}
.login-box{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:36px;width:380px;max-width:90vw;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.4)}
.login-box h1{font-size:1.2rem;margin-bottom:6px;display:flex;align-items:center;justify-content:center;gap:10px;font-weight:800}
.login-box h1 .dot{width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}
.login-sub{color:var(--text3);font-size:.82rem;margin-bottom:24px}
.login-input{width:100%;padding:14px 16px;background:var(--bg);border:1px solid var(--border);border-radius:10px;color:var(--text);font-size:.95rem;margin-bottom:14px;outline:none;font-family:'Inter',sans-serif;transition:border-color .15s}
.login-input:focus{border-color:var(--accent)}
.login-btn{width:100%;padding:14px;background:linear-gradient(135deg,var(--accent),#7c3aed);color:#fff;border:none;border-radius:10px;font-size:.95rem;font-weight:700;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;box-shadow:0 4px 16px rgba(139,92,246,.3)}
.login-btn:hover{filter:brightness(1.1);transform:translateY(-1px);box-shadow:0 6px 24px rgba(139,92,246,.4)}
.login-btn:disabled{opacity:.5;cursor:wait;transform:none}
.login-err{color:var(--red);font-size:.82rem;margin-top:10px;display:none;font-weight:600}
</style></head><body>
<div class="login-box">
  <h1><span class="dot"></span> Trading Bot</h1>
  <p class="login-sub">Inserisci la password per accedere</p>
  <form onsubmit="doLogin(event)">
    <input type="password" class="login-input" id="loginPwd" placeholder="Password" autocomplete="current-password" autofocus>
    <button type="submit" class="login-btn" id="loginBtn">🔐 Accedi</button>
  </form>
  <div class="login-err" id="loginErr"></div>
</div>
<script>
async function doLogin(e){
  e.preventDefault();
  const btn=document.getElementById("loginBtn");
  const err=document.getElementById("loginErr");
  const pwd=document.getElementById("loginPwd").value;
  if(!pwd){err.textContent="Inserisci la password";err.style.display="block";return;}
  btn.disabled=true;btn.textContent="⏳...";
  try{
    const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:pwd})});
    const d=await r.json();
    if(d.success){window.location.href="/";}
    else{err.textContent=d.error||"Errore";err.style.display="block";}
  }catch(ex){err.textContent="Errore di connessione";err.style.display="block";}
  btn.disabled=false;btn.textContent="🔐 Accedi";
}
<\/script></body></html>`;

// ─────────────────────────────────────
// MINI DASHBOARD HTML
// ─────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"><title>Trading Bot — Monitor</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap');
:root{--bg:#0b0f19;--bg2:#111827;--card:#151c2c;--card2:#1a2236;--card3:#1e2740;--border:#252e42;--border2:#2d3a52;
--text:#eef0f6;--text2:#94a3b8;--text3:#64748b;--text4:#475569;
--green:#10b981;--green2:#059669;--red:#ef4444;--red2:#dc2626;--blue:#3b82f6;--yellow:#eab308;--orange:#f97316;
--accent:#8b5cf6;--accent2:#7c3aed;--cyan:#06b6d4;--pink:#ec4899;
--glow-green:0 0 20px rgba(16,185,129,.15);--glow-red:0 0 20px rgba(239,68,68,.15);--glow-accent:0 0 20px rgba(139,92,246,.15)}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,-apple-system,sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}

/* TOP BAR */
.topbar{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;background:var(--bg2);border-bottom:1px solid var(--border);backdrop-filter:blur(12px);position:sticky;top:0;z-index:50}
.logo{display:flex;align-items:center;gap:10px}
.logo-dot{width:10px;height:10px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
.logo-text{font-size:1rem;font-weight:800;letter-spacing:.5px;background:linear-gradient(135deg,var(--accent),var(--cyan));-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.logo-ver{color:var(--text4);font-size:.7rem;font-weight:500;background:var(--card);padding:2px 8px;border-radius:4px}
.top-right{display:flex;align-items:center;gap:14px}
.source{display:flex;align-items:center;gap:6px;font-size:.78rem;color:var(--text2);background:var(--card);padding:4px 12px;border-radius:6px}
.source .dot{font-size:.5rem}
.pill{font-size:.65rem;padding:4px 12px;border-radius:20px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}
.pill-open{background:rgba(16,185,129,.15);color:var(--green);border:1px solid rgba(16,185,129,.3)}
.pill-closed{background:rgba(239,68,68,.1);color:var(--red);border:1px solid rgba(239,68,68,.2)}

/* LAYOUT */
.main{display:flex;gap:0;min-height:calc(100vh - 49px)}
.content{flex:1;padding:20px 24px;overflow-y:auto}
.sidebar{width:220px;background:var(--bg2);padding:16px;border-left:1px solid var(--border);flex-shrink:0;display:flex;flex-direction:column;gap:4px}

/* STAT CARDS */
.stats{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:12px;margin-bottom:20px}
.stat{background:var(--card);border-radius:12px;padding:16px 18px;border:1px solid var(--border);position:relative;overflow:hidden;transition:border-color .2s,box-shadow .2s}
.stat:hover{border-color:var(--border2)}
.stat::before{content:"";position:absolute;top:0;left:0;right:0;height:2px}
.stat-equity::before{background:linear-gradient(90deg,var(--blue),var(--cyan))}
.stat-pnl::before{background:linear-gradient(90deg,var(--accent),var(--pink))}
.stat-spy::before{background:linear-gradient(90deg,var(--cyan),var(--green))}
.stat-pos::before{background:linear-gradient(90deg,var(--orange),var(--yellow))}
.stat-equity:hover{box-shadow:0 0 24px rgba(59,130,246,.1)}
.stat-pnl:hover{box-shadow:var(--glow-accent)}
.stat-label{font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px;font-weight:600;display:flex;align-items:center;gap:6px}
.stat-value{font-size:1.5rem;font-weight:800;margin-top:6px;font-family:'JetBrains Mono',monospace}
.stat-equity .stat-value{font-size:1.8rem}
.stat-sub{font-size:.72rem;color:var(--text4);margin-top:4px;font-weight:500}

/* SECTION HEADERS */
.section-hdr{font-size:.7rem;color:var(--text3);text-transform:uppercase;letter-spacing:1.2px;font-weight:700;margin:24px 0 10px;display:flex;align-items:center;gap:8px;padding-bottom:8px;border-bottom:1px solid var(--border)}
.info-i{color:var(--text4);cursor:help;position:relative;font-size:.8rem;transition:color .15s}
.info-i:hover{color:var(--accent)}
.info-i:hover::after{content:attr(data-tip);position:absolute;left:20px;top:-4px;background:var(--card3);border:1px solid var(--border2);color:var(--text2);padding:10px 14px;border-radius:8px;font-size:.75rem;white-space:pre-line;z-index:99;min-width:240px;font-weight:400;line-height:1.5;box-shadow:0 8px 32px rgba(0,0,0,.4);letter-spacing:0}

/* TABLE */
table{width:100%;border-collapse:separate;border-spacing:0;font-size:.85rem}
th{text-align:left;font-size:.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:.8px;font-weight:700;padding:10px 14px;background:var(--card);border-bottom:1px solid var(--border)}
th:first-child{border-radius:8px 0 0 0}th:last-child{border-radius:0 8px 0 0}
td{padding:10px 14px;border-bottom:1px solid var(--border);transition:background .1s}
tr:hover td{background:var(--card2)}

.badge{display:inline-flex;align-items:center;justify-content:center;padding:4px 12px;border-radius:6px;font-weight:700;font-size:.72rem;letter-spacing:.3px;min-width:90px;gap:4px}
.b-buy{background:rgba(16,185,129,.12);color:var(--green);border:1px solid rgba(16,185,129,.25)}
.b-sell{background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.25)}
.b-wait{background:rgba(234,179,8,.1);color:var(--yellow);border:1px solid rgba(234,179,8,.2)}
.b-hold{background:var(--card);color:var(--text4);border:1px solid var(--border)}
.b-down{background:rgba(249,115,22,.1);color:var(--orange);border:1px solid rgba(249,115,22,.2)}
.mono{font-family:'JetBrains Mono','Consolas',monospace}
.g{color:var(--green)}.r{color:var(--red)}.y{color:var(--yellow)}.o{color:var(--orange)}.c{color:var(--cyan)}

/* POSITIONS */
.pos-wrap{margin-bottom:8px}
.pos-card{background:var(--card);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:14px;border-left:3px solid var(--border);transition:all .15s}
.pos-card:hover{background:var(--card2);transform:translateX(2px)}
.pos-card.pos-up{border-left-color:var(--green);box-shadow:var(--glow-green)}
.pos-card.pos-down{border-left-color:var(--red);box-shadow:var(--glow-red)}
.pos-name{font-weight:700;flex:1;font-size:.95rem}
.pos-detail{font-size:.8rem;color:var(--text2);font-family:'JetBrains Mono',monospace}
.pos-pnl{font-weight:800;font-size:1rem;min-width:120px;text-align:right;font-family:'JetBrains Mono',monospace}
.pos-levels{font-size:.72rem;color:var(--text4)}
.pos-expand{background:none;border:none;color:var(--accent);cursor:pointer;font-size:1rem;padding:4px 8px;transition:transform .2s;border-radius:4px}
.pos-expand:hover{background:var(--card3)}
.pos-expand.open{transform:rotate(180deg)}
.pos-close{background:transparent;border:1px solid var(--border);color:var(--text3);padding:5px 12px;border-radius:6px;cursor:pointer;font-size:.72rem;font-weight:600;transition:all .15s}
.pos-close:hover{background:var(--red);color:#fff;border-color:var(--red);box-shadow:var(--glow-red)}
.pos-extra{display:none;background:var(--card);border-radius:0 0 10px 10px;padding:12px 18px;margin-top:0;border-left:3px solid var(--border);border-top:1px dashed var(--border);font-size:.8rem;color:var(--text2)}
.pos-extra.show{display:block}
.pos-extra-row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border)}
.pos-extra-row:last-child{border-bottom:none}
.pos-extra-label{color:var(--text3);font-weight:500}
.pos-extra-val{font-family:'JetBrains Mono',monospace;font-weight:600}

.empty-state{background:var(--card);border-radius:10px;padding:32px;text-align:center;color:var(--text4);border:1px dashed var(--border)}

/* SIDEBAR */
.side-btn{width:100%;padding:10px 14px;border:1px solid transparent;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:600;text-align:left;transition:all .15s;display:flex;align-items:center;gap:8px}
.side-btn:hover{filter:brightness(1.1);transform:translateY(-1px)}
.btn-start{background:linear-gradient(135deg,var(--green),var(--green2));color:#fff;font-size:.95rem;padding:12px 14px;text-align:center;justify-content:center;border-radius:10px;box-shadow:0 4px 16px rgba(16,185,129,.25)}
.btn-start:hover{box-shadow:0 6px 24px rgba(16,185,129,.35)}
.btn-action{background:var(--card);color:var(--text2);border-color:var(--border)}
.btn-action:hover{border-color:var(--border2);color:var(--text)}
.btn-danger{background:var(--card);color:var(--red);border-color:var(--border)}
.btn-danger:hover{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.3)}
.btn-calc{background:var(--card);color:var(--cyan);border-color:var(--border)}
.btn-calc:hover{background:rgba(6,182,212,.08);border-color:rgba(6,182,212,.3)}
.btn-settings{background:var(--card);color:var(--accent);border-color:var(--border)}
.btn-settings:hover{background:rgba(139,92,246,.08);border-color:rgba(139,92,246,.3)}
.sep{border:none;border-top:1px solid var(--border);margin:8px 0}
.side-label{font-size:.65rem;color:var(--text4);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin:4px 0}
.side-stat{font-size:.82rem;color:var(--text2);margin-bottom:3px;font-weight:500}
.brain-section{margin-top:4px;background:var(--card);border-radius:8px;padding:10px 12px;border:1px solid var(--border)}
.brain-label{color:var(--accent);font-size:.65rem;text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:6px}

/* LOG */
.log-box{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-family:'JetBrains Mono',monospace;font-size:.75rem;max-height:200px;overflow-y:auto;color:var(--text2);line-height:1.6}
.log-box::-webkit-scrollbar{width:4px}.log-box::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
.log-buy{color:var(--green)}.log-sell{color:var(--red)}.log-warn{color:var(--yellow)}

/* MODAL */
.modal-bg{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.7);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:100;display:none}
.modal{background:var(--bg2);border:1px solid var(--border2);border-radius:16px;padding:28px;width:500px;max-width:92vw;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.5)}
.modal::-webkit-scrollbar{width:4px}.modal::-webkit-scrollbar-thumb{background:var(--border2);border-radius:4px}
.modal h2{font-size:1.15rem;margin-bottom:14px;font-weight:700}
.modal label{display:block;font-size:.78rem;color:var(--text3);margin-top:12px;font-weight:600;letter-spacing:.3px}
.modal input,.modal select{width:100%;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:.85rem;margin-top:4px;transition:border-color .15s;outline:none}
.modal input:focus,.modal select:focus{border-color:var(--accent)}
.modal-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);font-size:.85rem;align-items:center}
.modal-row.total{border-top:2px solid var(--border2);border-bottom:none;font-weight:800;font-size:1.05rem;padding-top:12px;margin-top:6px}

/* REFRESH INDICATOR */
.refresh-bar{height:2px;background:linear-gradient(90deg,var(--accent),var(--cyan));position:fixed;top:0;left:0;transition:width .3s;z-index:200}

/* Scrollbar */
::-webkit-scrollbar{width:6px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border);border-radius:6px}

@media(max-width:768px){
  .main{flex-direction:column}.sidebar{width:100%;border-left:none;border-top:1px solid var(--border);flex-direction:row;flex-wrap:wrap;gap:4px}
  .stats{grid-template-columns:1fr 1fr}.stat-equity .stat-value{font-size:1.4rem}
  .content{padding:12px 14px}
}
</style></head><body>
<div class="refresh-bar" id="refreshBar" style="width:0"></div>

<div class="topbar">
  <div class="logo">
    <span class="logo-dot"></span>
    <span class="logo-text">TRADEBOT</span>
    <span class="logo-ver">v3.1</span>
  </div>
  <div class="top-right">
    <span class="source"><span class="dot" id="srcDot">●</span> <span id="srcName">...</span></span>
    <span class="pill pill-closed" id="mktPill">CHIUSO</span>
    <span style="font-size:.75rem;color:var(--text3)" id="cycleLabel"></span>
  </div>
</div>

<div class="main">
<div class="content">

  <!-- STAT CARDS -->
  <div class="stats">
    <div class="stat stat-equity">
      <div class="stat-label">Equity <span class="info-i" data-tip="Valore totale: cash + posizioni aperte">ⓘ</span></div>
      <div class="stat-value" id="vEquity">€5,000.00</div>
      <div class="stat-sub" id="vCash">Cash: €5,000.00</div>
    </div>
    <div class="stat stat-pnl">
      <div class="stat-label">P&L <span class="info-i" data-tip="Profitto/Perdita totale\\nEquity - Capitale iniziale (€5.000)">ⓘ</span></div>
      <div class="stat-value" id="vPnl">€0.00</div>
    </div>
    <div class="stat stat-spy">
      <div class="stat-label">SPY <span class="info-i" data-tip="S&P 500 — salute del mercato USA\\nSopra EMA50 = BULL (BUY permessi)\\nSotto EMA50 = BEAR (solo Mean Reversion)">ⓘ</span></div>
      <div class="stat-value" id="vSpy">—</div>
      <div class="stat-sub" id="vSpyStatus"></div>
    </div>
    <div class="stat stat-pos">
      <div class="stat-label">Posizioni <span class="info-i" data-tip="Posizioni aperte / massimo configurato">ⓘ</span></div>
      <div class="stat-value" id="vPos">0/10</div>
    </div>
  </div>

  <!-- POSITIONS -->
  <div class="section-hdr">Posizioni Aperte <span class="info-i" data-tip="Posizioni annotate dal bot\\nSL = Stop Loss (chiude in perdita)\\nTP = Take Profit (chiude in profitto)\\n⬆ = Trailing Stop attivo">ⓘ</span></div>
  <div id="posContainer"><div class="empty-state">Nessuna posizione aperta</div></div>

  <!-- WATCHLIST -->
  <div class="section-hdr">Watchlist <span class="info-i" data-tip="Azioni USA + EU + Crypto monitorati\\nOgni 5 min: scarica dati, calcola MACD,\\nRSI, EMA, Bollinger e decide se comprare">ⓘ</span>
    <span style="margin-left:auto;font-size:.7rem;color:var(--text3)" id="scanTime"></span>
  </div>
  <table id="watchlist">
    <thead><tr>
      <th>Asset <span class="info-i" data-tip="Nome dell'azione o crypto">ⓘ</span></th>
      <th style="text-align:right">Prezzo <span class="info-i" data-tip="Ultimo prezzo in USD">ⓘ</span></th>
      <th style="text-align:right">Score <span class="info-i" data-tip="Punteggio da -3 a +3\\nSopra +0.8 = BUY\\nSotto -0.8 = SELL">ⓘ</span></th>
      <th style="text-align:right">RSI <span class="info-i" data-tip="0-100. Sotto 30 = ipervenduto\\nSopra 70 = ipercomprato">ⓘ</span></th>
      <th style="text-align:center">Segnale <span class="info-i" data-tip="▲ BUY = compra\\n⏳ ATTESA = filtrato\\n— HOLD = aspetta\\n▼ SELL = vendi">ⓘ</span></th>
    </tr></thead>
    <tbody id="wlBody"><tr><td colspan="5" style="color:var(--text3);text-align:center">Premi Scan per analizzare</td></tr></tbody>
  </table>

  <!-- STORICO OPERAZIONI -->
  <div class="section-hdr">Storico Operazioni <span class="info-i" data-tip="Tutte le operazioni di apertura e chiusura">ⓘ</span></div>
  <table id="tradesTable">
    <thead><tr>
      <th>Data</th>
      <th>Asset</th>
      <th style="text-align:right">Entry</th>
      <th style="text-align:right">Exit</th>
      <th style="text-align:right">Shares</th>
      <th style="text-align:right">P&L</th>
      <th style="text-align:right">%</th>
      <th>Motivo</th>
    </tr></thead>
    <tbody id="tradesBody"><tr><td colspan="8" style="color:var(--text3);text-align:center">Nessuna operazione</td></tr></tbody>
  </table>

  <!-- LOG -->
  <div class="section-hdr">Log <span class="info-i" data-tip="Registro attività\\nVerde = acquisto, Rosso = vendita\\nGiallo = avviso">ⓘ</span></div>
  <div class="log-box" id="logBox"></div>

</div>

<!-- SIDEBAR -->
<div class="sidebar">
  <button class="side-btn btn-start" onclick="doScan()" id="scanBtn">🔍 SCAN NOW</button>
  <hr class="sep">
  <button class="side-btn btn-action" onclick="closeAllModal()">📦 Chiudi tutte</button>
  <hr class="sep">
  <button class="side-btn btn-calc" onclick="showCalc()">💰 Profitto netto</button>
  <hr class="sep">
  <button class="side-btn btn-settings" onclick="showSettings()">⚙️ Impostazioni</button>
  <hr class="sep">
  <button class="side-btn btn-danger" onclick="resetAll()">🗑 Reset</button>
  <hr class="sep">
  <button class="side-btn" onclick="location.href=\\'/api/logout\\'">🚪 Logout</button>
  <hr class="sep">

  <div class="side-label">Statistiche</div>
  <div class="side-stat" id="sTrades">Trade: 0</div>
  <div class="side-stat" id="sWr">Win rate: —</div>
  <div class="side-stat" id="sPnl">P&L chiusi: —</div>

  <hr class="sep">
  <div class="brain-section">
    <div class="brain-label">🧠 Brain <span class="info-i" data-tip="Auto-apprendimento.\\nDopo ogni trade, aggiusta i pesi\\ndegli indicatori. Più trade fa,\\npiù diventa preciso.">ⓘ</span></div>
    <div class="side-stat" id="bConf">Confidenza: 0%</div>
    <div class="side-stat" id="bTrained">Addestrato: 0 trade</div>
    <div class="side-stat" style="font-size:.75rem;color:var(--text3);word-break:break-all" id="bLast"></div>
  </div>
</div>
</div>

<!-- PROFIT CALCULATOR MODAL -->
<div class="modal-bg" id="calcModal">
<div class="modal">
  <h2>💰 Profitto Netto</h2>
  <p style="font-size:.78rem;color:var(--text3);margin-bottom:14px">Calcolo automatico per mercato. Tasse e costi applicati in base al tipo di asset.</p>

  <div style="display:flex;gap:8px;margin-bottom:14px">
    <button class="side-btn btn-action" style="flex:1;text-align:center;justify-content:center;font-size:.78rem" id="calcModeAuto">📊 Auto (da bot)</button>
    <button class="side-btn btn-action" style="flex:1;text-align:center;justify-content:center;font-size:.78rem" id="calcModeManual">✏️ Manuale</button>
  </div>

  <div id="calcManualFields" style="display:none">
    <label>Profitto lordo (€)</label><input type="number" id="cGross" value="0">
    <label>Mercato</label>
    <select id="cMarket">
      <option value="us">🇺🇸 USA (Alpaca)</option>
      <option value="eu">🇪🇺 Europa (MI/DE/PA/AS)</option>
      <option value="crypto">🪙 Crypto</option>
    </select>
    <label>Giorni di detenzione</label><input type="number" id="cDays" value="365" min="1" max="365">
    <label>Capitale investito (€)</label><input type="number" id="cCap" value="5000">
  </div>

  <div style="margin-top:16px;border:1px solid var(--border2);border-radius:10px;padding:16px;background:var(--card)" id="calcResults">
    <div id="calcBreakdown"></div>
    <div class="modal-row total" style="margin-top:12px"><span class="g">PROFITTO NETTO</span><span id="crNet" class="g" style="font-family:JetBrains Mono,monospace">—</span></div>
    <div class="modal-row"><span class="c">Rendimento %</span><span id="crPct" class="c" style="font-family:JetBrains Mono,monospace">—</span></div>
    <div class="modal-row total"><span>Somma che ricevi</span><span id="crTotal" style="font-family:JetBrains Mono,monospace">—</span></div>
  </div>

  <div style="display:flex;gap:8px;margin-top:14px">
    <button class="side-btn btn-start" style="flex:1" onclick="doCalc()">📊 Calcola</button>
    <button class="side-btn btn-action" style="flex:1" onclick="hideCalc()">Chiudi</button>
  </div>
  <p style="font-size:.68rem;color:var(--text4);margin-top:10px;text-align:center">⚠ Stime indicative — consulta un commercialista per la tua situazione</p>
</div>
</div>

<!-- SETTINGS MODAL -->
<div class="modal-bg" id="settingsModal">
<div class="modal">
  <h2>⚙️ Impostazioni</h2>
  <p style="font-size:.8rem;color:var(--text3);margin-bottom:12px">Modifica i parametri del bot. Le modifiche si applicano dal prossimo scan.</p>
  <div id="settingsFields"></div>
  <div style="margin-top:6px;padding:10px;background:var(--card2);border-radius:6px;display:none" id="settingsSaved">
    <span class="g">✓ Impostazioni salvate</span>
  </div>
  <div style="display:flex;gap:8px;margin-top:14px">
    <button class="side-btn btn-start" style="flex:1" onclick="saveSettings()">💾 Salva</button>
    <button class="side-btn btn-action" style="flex:1" onclick="resetSettings()">↩ Reset default</button>
    <button class="side-btn btn-action" style="flex:1" onclick="hideSettings()">Chiudi</button>
  </div>
</div>
</div>

<script>
const API=window.location.origin+"/api";
let logs=[];let scanCount=0;

async function load(){
  const bar=document.getElementById("refreshBar");bar.style.width="30%";
  try{
    const r=await fetch(API+"/status");
    if(r.status===401){window.location.href="/login";return;}
    const d=await r.json();bar.style.width="80%";

    // Source
    document.getElementById("srcName").textContent=d.dataSource||"Yahoo";
    document.getElementById("srcDot").style.color=d.dataSource?.includes("ALPACA")?"var(--green)":"var(--yellow)";

    // Stats
    const pnl=d.pnl||0;
    document.getElementById("vEquity").textContent="€"+d.equity.toFixed(2);
    document.getElementById("vCash").textContent="Cash: €"+d.capital.toFixed(2);
    document.getElementById("vPnl").textContent=(pnl>=0?"+":"")+"€"+pnl.toFixed(2);
    document.getElementById("vPnl").className="stat-value "+(pnl>=0?"g":"r");
    document.getElementById("vPos").textContent=d.positions.length+"/"+(d.maxPositions||10);

    // Profit calculator default
    document.getElementById("cGross").value=pnl.toFixed(2);
    lastPositions=d.positions||[];
    lastClosedTrades=d.closedTrades||[];
    lastCapital=d.capital||5000;

    // Positions
    const pc=document.getElementById("posContainer");
    if(!d.positions.length){
      pc.innerHTML='<div class="empty-state">Nessuna posizione aperta<br><span style="font-size:.8rem">Il bot aprirà posizioni quando trova segnali</span></div>';
    } else {
      pc.innerHTML=d.positions.map((p,i)=>{
        const cur=p.current_price||p.entry_price;
        const pl=((cur-p.entry_price)*p.shares);
        const pct=((cur-p.entry_price)/p.entry_price*100);
        const up=pl>=0;
        const trail=p.trailing_active?" ⬆":"";
        const sh=p.shares%1===0?p.shares:p.shares.toFixed(4);
        const curVal=(cur*p.shares);
        const opened=p.opened_at?new Date(p.opened_at).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";
        const indicators=(p.brain_indicators||[]).join(", ")||"—";
        return '<div class="pos-wrap"><div class="pos-card '+(up?"pos-up":"pos-down")+'">'
          +'<button class="pos-expand" onclick="togglePos('+i+')" id="posExp'+i+'">▼</button>'
          +'<div class="pos-name">'+p.name+trail+'</div>'
          +'<div class="pos-detail mono">'+sh+'sh &middot; $'+p.entry_price.toFixed(2)+' &rarr; $'+cur.toFixed(2)+'</div>'
          +'<div class="pos-pnl '+(up?"g":"r")+'">'+(up?"+":"")+"€"+pl.toFixed(2)+' ('+(pct>=0?"+":"")+pct.toFixed(1)+'%)</div>'
          +'<div class="pos-levels"><span class="r">SL $'+p.stop_loss.toFixed(0)+'</span> &middot; <span class="g">TP $'+p.take_profit.toFixed(0)+'</span></div>'
          +'<button class="pos-close" onclick="closeTicker(\\\''+p.ticker+'\\\')">Chiudi</button></div>'
          +'<div class="pos-extra" id="posExtra'+i+'">'
          +'<div class="pos-extra-row"><span class="pos-extra-label">Costo apertura</span><span class="pos-extra-val">€'+p.cost.toFixed(2)+'</span></div>'
          +'<div class="pos-extra-row"><span class="pos-extra-label">Valore attuale</span><span class="pos-extra-val '+(up?"g":"r")+'">€'+curVal.toFixed(2)+'</span></div>'
          +'<div class="pos-extra-row"><span class="pos-extra-label">Aperta il</span><span class="pos-extra-val">'+opened+'</span></div>'
          +'<div class="pos-extra-row"><span class="pos-extra-label">Score ingresso</span><span class="pos-extra-val">'+(p.score_at_entry||0).toFixed(1)+'</span></div>'
          +'<div class="pos-extra-row"><span class="pos-extra-label">Trailing Stop</span><span class="pos-extra-val">'+(p.trailing_active?"<span class=g>Attivo ⬆</span>":"No")+'</span></div>'
          +'<div class="pos-extra-row"><span class="pos-extra-label">Indicatori</span><span class="pos-extra-val" style="font-size:.75rem">'+indicators+'</span></div>'
          +'</div></div>';
      }).join("");
    }

    // Watchlist
    const seen=new Set();const scores=[];
    (d.recentScores||[]).forEach(s=>{if(!seen.has(s.ticker)&&s.ticker!=="SPY"){seen.add(s.ticker);scores.push(s);}});
    scores.sort((a,b)=>b.score-a.score);

    // SPY from scores
    const spyScore=(d.recentScores||[]).find(s=>s.ticker==="SPY");
    
    if(scores.length){
      document.getElementById("wlBody").innerHTML=scores.map((s,i)=>{
        let badge,cls;
        if(s.signal===1){badge="▲ BUY";cls="b-buy";}
        else if(s.signal===-1){badge="▼ SELL";cls="b-sell";}
        else if(s.score>=0.5){badge="⏳ ATTESA";cls="b-wait";}
        else if(s.score<=-0.5){badge="⏳ RIBASSO";cls="b-down";}
        else{badge="— HOLD";cls="b-hold";}
        const isCrypto=s.ticker.includes("-USD");
        const icon=isCrypto?"🪙":"📊";
        const rsiCls=s.rsi<35?"g":(s.rsi>65?"r":"");
        const scCls=s.score>=0.8?"g":(s.score>=0.5?"y":(s.score<=-0.8?"r":""));
        const dotCls=s.signal===1?"g":(s.signal===-1?"r":(s.score>=0.5?"y":""));
        return '<tr><td><span class="'+dotCls+'">● </span>'+icon+' '+s.ticker+'</td>'
          +'<td style="text-align:right" class="mono">$'+s.price.toFixed(2)+'</td>'
          +'<td style="text-align:right" class="mono '+scCls+'">'+s.score.toFixed(1)+'</td>'
          +'<td style="text-align:right;font-weight:700" class="'+rsiCls+'">'+s.rsi.toFixed(0)+'</td>'
          +'<td style="text-align:center"><span class="badge '+cls+'">'+badge+'</span></td></tr>';
      }).join("");
      document.getElementById("scanTime").textContent="Ultimo: "+new Date().toLocaleTimeString();
    }

    // Stats
    const st=d.stats||{};
    const closedPnl=(d.closedTrades||[]).reduce((a,t)=>a+t.pnl,0);
    document.getElementById("sTrades").textContent="Trade: "+(st.total||0);
    document.getElementById("sWr").textContent="Win rate: "+(st.total?st.wr+"%":"—");
    document.getElementById("sWr").style.color=st.wr>=50?"var(--green)":(st.total?"var(--red)":"var(--text2)");
    document.getElementById("sPnl").textContent="P&L: "+(closedPnl>=0?"+":"")+"€"+closedPnl.toFixed(2);
    document.getElementById("sPnl").style.color=closedPnl>=0?"var(--green)":"var(--red)";

    // Trades history
    const tb=document.getElementById("tradesBody");
    if(d.closedTrades&&d.closedTrades.length){
      tb.innerHTML=d.closedTrades.map(t=>{
        const w=t.pnl>=0;
        const dt=t.closed_at?new Date(t.closed_at).toLocaleString("it-IT",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"—";
        const reason=t.reason==="stop_loss"?"SL":(t.reason==="take_profit"?"TP":(t.reason==="manual_close"?"Manuale":t.reason));
        return '<tr><td class="mono" style="font-size:.8rem">'+dt+'</td>'
          +'<td>'+t.name+'</td>'
          +'<td style="text-align:right" class="mono">$'+(t.entry_price||0).toFixed(2)+'</td>'
          +'<td style="text-align:right" class="mono">$'+(t.exit_price||0).toFixed(2)+'</td>'
          +'<td style="text-align:right">'+t.shares+'</td>'
          +'<td style="text-align:right;font-weight:700" class="'+(w?"g":"r")+'">'+(w?"+":"")+"€"+t.pnl.toFixed(2)+'</td>'
          +'<td style="text-align:right" class="'+(w?"g":"r")+'">'+(t.pnl_pct>=0?"+":"")+t.pnl_pct.toFixed(1)+'%</td>'
          +'<td><span class="badge '+(t.reason==="take_profit"?"b-buy":(t.reason==="stop_loss"?"b-sell":"b-hold"))+'">'+reason+'</span></td></tr>';
      }).join("");
    } else {
      tb.innerHTML='<tr><td colspan="8" style="color:var(--text3);text-align:center">Nessuna operazione</td></tr>';
    }

    // Brain
    const br=d.brain||{};
    document.getElementById("bConf").textContent="Confidenza: "+(br.confidence||0).toFixed(0)+"%";
    document.getElementById("bConf").style.color=br.confidence>=50?"var(--green)":(br.confidence>=20?"var(--yellow)":"var(--text3)");
    document.getElementById("bTrained").textContent="Addestrato: "+(br.totalTrained||0)+" trade";

    bar.style.width="100%";setTimeout(()=>{bar.style.width="0"},400);
  }catch(e){
    document.getElementById("refreshBar").style.width="0";
    addLog("❌ Errore: "+e.message,"sell");
  }
}

function addLog(msg,type){
  const t=new Date().toLocaleTimeString();
  logs.push({t,msg,type});if(logs.length>50)logs=logs.slice(-50);
  const box=document.getElementById("logBox");
  box.innerHTML=logs.map(l=>'<div class="log-'+(l.type||"")+'">'+l.t+" "+l.msg+"</div>").join("");
  box.scrollTop=box.scrollHeight;
}

function togglePos(i){
  const extra=document.getElementById("posExtra"+i);
  const btn=document.getElementById("posExp"+i);
  if(extra){extra.classList.toggle("show");btn.classList.toggle("open");}
}

async function doScan(){
  const btn=document.getElementById("scanBtn");
  btn.textContent="⏳ Scansione...";btn.disabled=true;
  addLog("🔍 Scan avviato...","");
  try{
    const r=await fetch(API+"/scan");
    if(!r.ok){const err=await r.text();addLog("❌ Scan errore "+r.status+": "+err,"sell");btn.textContent="🔍 SCAN NOW";btn.disabled=false;return;}
    const d=await r.json();
    if(d.error){addLog("❌ "+d.error,"sell");btn.textContent="🔍 SCAN NOW";btn.disabled=false;return;}
    scanCount++;
    document.getElementById("cycleLabel").textContent="Ciclo "+scanCount;
    if(d.buys?.length) d.buys.forEach(b=>addLog("📝 BUY "+b.name+": "+b.shares+"sh @ $"+b.entry_price.toFixed(2),"buy"));
    if(d.closes?.length) d.closes.forEach(c=>addLog((c.pnl>=0?"🟢":"🔴")+" CLOSE "+c.name+": "+(c.pnl>=0?"+":"")+"€"+c.pnl.toFixed(2)+" ["+c.reason+"]",c.pnl>=0?"buy":"sell"));
    if(d.scores?.length) addLog("📊 "+d.scores.length+" asset scansionati | "+d.positions?.length+" posizioni","");
    if(d.spyStatus) addLog("🏛 SPY: $"+d.spyStatus.price+" → "+(d.spyStatus.bullish?"BULLISH ✅":"BEARISH ⛔"),d.spyStatus.bullish?"buy":"sell");

    // Update SPY card
    if(d.spyStatus){
      document.getElementById("vSpy").textContent="$"+d.spyStatus.price;
      document.getElementById("vSpy").className="stat-value "+(d.spyStatus.bullish?"g":"r");
      document.getElementById("vSpyStatus").textContent=d.spyStatus.bullish?"BULL ▲":"BEAR ▼";
      document.getElementById("vSpyStatus").className="stat-sub "+(d.spyStatus.bullish?"g":"r");
      const pill=document.getElementById("mktPill");
      // Rough market hours check (14:30-21:00 CET)
      const h=new Date().getUTCHours();const isOpen=h>=13&&h<21;
      pill.textContent=isOpen?" APERTO ":" CHIUSO ";
      pill.className="pill "+(isOpen?"pill-open":"pill-closed");
    }
    load();
  }catch(e){addLog("❌ "+e.message,"sell");}
  btn.textContent="🔍 SCAN NOW";btn.disabled=false;
}

async function closeTicker(t){
  if(!confirm("Chiudere "+t+"?"))return;
  addLog("Chiusura "+t+"...","");
  await fetch(API+"/close",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker:t})});
  load();
}

function closeAllModal(){
  if(!confirm("Chiudere TUTTE le posizioni?"))return;
  addLog("Chiusura tutte...","warn");
  fetch(API+"/close-all",{method:"POST"}).then(()=>load());
}

function resetAll(){
  if(!confirm("RESET completo?\\nRiparti da €5.000"))return;
  addLog("🗑 Reset...","sell");
  fetch(API+"/reset",{method:"POST"}).then(()=>{logs=[];load();});
}

// Profit calculator
let calcMode="auto";
let lastPositions=[];let lastClosedTrades=[];let lastCapital=5000;
function showCalc(){document.getElementById("calcModal").style.display="flex";setCalcMode("auto");}
function hideCalc(){document.getElementById("calcModal").style.display="none";}

function setCalcMode(mode){
  calcMode=mode;
  document.getElementById("calcModeAuto").style.borderColor=mode==="auto"?"var(--accent)":"var(--border)";
  document.getElementById("calcModeManual").style.borderColor=mode==="manual"?"var(--accent)":"var(--border)";
  document.getElementById("calcManualFields").style.display=mode==="manual"?"block":"none";
  doCalc();
}

function getMarketType(ticker){
  if(!ticker) return "us";
  if(ticker.includes("-USD")) return "crypto";
  if(ticker.indexOf(".")!==-1) return "eu";
  return "us";
}

function calcTaxForMarket(gross, investedCap, days, market){
  const taxPct=0.26;
  const tax=Math.max(0,gross)*taxPct;
  let ivafe=0, fx=0, label="";
  if(market==="us"){
    // IVAFE: 0.2% annuo sul valore detenuto all'estero, proporzionale ai giorni
    ivafe=investedCap*0.002*(days/365);
    // Spread cambio: solo sul profitto (la conversione avviene al prelievo)
    fx=Math.abs(gross)*0.005;
    label="🇺🇸 USA";
  } else if(market==="eu"){
    ivafe=0; fx=0;
    label="🇪🇺 EU";
  } else {
    // Crypto: IVAFE su valore detenuto, no spread cambio (già in USD/EUR)
    ivafe=investedCap*0.002*(days/365);
    fx=0;
    label="🪙 Crypto";
  }
  return {tax, ivafe, fx, total: tax+ivafe+fx, net: gross-tax-ivafe-fx, label, market};
}

function doCalc(){
  const bd=document.getElementById("calcBreakdown");
  let totalGross=0, totalTax=0, totalIvafe=0, totalFx=0, totalNet=0, totalCap=0;
  let rows="";

  if(calcMode==="auto"){
    // Group closed trades by market
    const groups={us:{gross:0,maxCap:0,days:30},eu:{gross:0,maxCap:0,days:30},crypto:{gross:0,maxCap:0,days:30}};
    (lastClosedTrades||[]).forEach(t=>{
      const mkt=getMarketType(t.ticker);
      groups[mkt].gross+=t.pnl||0;
      groups[mkt].maxCap=Math.max(groups[mkt].maxCap, t.cost||0);
      if(t.opened_at&&t.closed_at){
        const d=Math.max(1,Math.round((new Date(t.closed_at)-new Date(t.opened_at))/(1000*86400)));
        groups[mkt].days=Math.max(groups[mkt].days,d);
      }
    });
    // Add open positions unrealized P&L
    let openCapByMkt={us:0,eu:0,crypto:0};
    (lastPositions||[]).forEach(p=>{
      const mkt=getMarketType(p.ticker);
      const cur=p.current_price||p.entry_price;
      groups[mkt].gross+=((cur-p.entry_price)*p.shares);
      openCapByMkt[mkt]+=(p.cost||0);
    });
    // Use max of: largest single trade cost or current open capital, as proxy for invested amount
    for(const mkt of Object.keys(groups)){
      groups[mkt].maxCap=Math.max(groups[mkt].maxCap, openCapByMkt[mkt]||0);
      if(groups[mkt].maxCap===0) groups[mkt].maxCap=lastCapital*0.35; // fallback: max per-position allocation
    }

    for(const [mkt, g] of Object.entries(groups)){
      if(g.gross===0&&g.maxCap===0) continue;
      const r=calcTaxForMarket(g.gross, g.maxCap, g.days, mkt);
      totalGross+=g.gross; totalTax+=r.tax; totalIvafe+=r.ivafe; totalFx+=r.fx; totalNet+=r.net; totalCap+=g.maxCap;
      rows+='<div style="margin-bottom:12px;padding:10px;background:var(--card2);border-radius:8px;border:1px solid var(--border)">'
        +'<div style="font-weight:700;margin-bottom:6px;font-size:.85rem">'+r.label+'</div>'
        +'<div class="modal-row"><span>Profitto lordo</span><span class="mono">'+fmt(g.gross)+'</span></div>'
        +'<div class="modal-row"><span class="r">Tassa 26%</span><span class="mono r">-€'+r.tax.toFixed(2)+'</span></div>';
      if(r.ivafe>0) rows+='<div class="modal-row"><span class="o">IVAFE 0.2% ('+g.days+'gg)</span><span class="mono o">-€'+r.ivafe.toFixed(2)+'</span></div>';
      if(r.fx>0) rows+='<div class="modal-row"><span class="y">Spread cambio</span><span class="mono y">-€'+r.fx.toFixed(2)+'</span></div>';
      rows+='<div class="modal-row" style="font-weight:700"><span>Netto '+r.label+'</span><span class="mono '+((r.net>=0)?"g":"r")+'">'+fmt(r.net)+'</span></div></div>';
    }
    if(!rows) rows='<div style="text-align:center;color:var(--text4);padding:16px">Nessun trade da calcolare.<br>Esegui uno scan o inserisci dati manualmente.</div>';
    totalCap=totalCap||lastCapital;
  } else {
    const gross=parseFloat(document.getElementById("cGross").value)||0;
    const market=document.getElementById("cMarket").value;
    const days=Math.min(365,Math.max(1,parseInt(document.getElementById("cDays").value)||365));
    const cap=parseFloat(document.getElementById("cCap").value)||5000;
    const r=calcTaxForMarket(gross, cap, days, market);
    totalGross=gross; totalTax=r.tax; totalIvafe=r.ivafe; totalFx=r.fx; totalNet=r.net; totalCap=cap;
    rows='<div class="modal-row"><span>Profitto lordo</span><span class="mono">'+fmt(gross)+'</span></div>'
      +'<div class="modal-row"><span class="r">Tassa 26%</span><span class="mono r">-€'+r.tax.toFixed(2)+'</span></div>';
    if(r.ivafe>0) rows+='<div class="modal-row"><span class="o">IVAFE 0.2% ('+days+'gg)</span><span class="mono o">-€'+r.ivafe.toFixed(2)+'</span></div>';
    if(r.fx>0) rows+='<div class="modal-row"><span class="y">Spread cambio 0.5%</span><span class="mono y">-€'+r.fx.toFixed(2)+'</span></div>';
  }

  bd.innerHTML=rows;
  const pct=totalCap>0?(totalNet/totalCap*100):0;
  document.getElementById("crNet").textContent=fmt(totalNet);
  document.getElementById("crNet").className=totalNet>=0?"g":"r";
  document.getElementById("crPct").textContent=pct.toFixed(2)+"%";
  document.getElementById("crTotal").textContent="€"+(totalCap+totalNet).toFixed(2);
}

function fmt(v){return (v>=0?"+":"")+"\u20ac"+v.toFixed(2);}

// Close modal on bg click
document.getElementById("calcModal").addEventListener("click",e=>{if(e.target.classList.contains("modal-bg"))hideCalc();});
document.getElementById("settingsModal").addEventListener("click",e=>{if(e.target.classList.contains("modal-bg"))hideSettings();});
document.getElementById("calcModeAuto").addEventListener("click",()=>setCalcMode("auto"));
document.getElementById("calcModeManual").addEventListener("click",()=>setCalcMode("manual"));

// Settings
let settingsMeta={};
async function showSettings(){
  document.getElementById("settingsModal").style.display="flex";
  document.getElementById("settingsSaved").style.display="none";
  try{
    const r=await fetch(API+"/settings");const d=await r.json();
    settingsMeta=d.meta||{};
    const container=document.getElementById("settingsFields");
    container.innerHTML=Object.entries(d.settings).map(([k,v])=>{
      const m=d.meta[k]||{};
      const label=m.label||k;
      const step=m.step||1;
      const displayVal=m.pct?(v*100).toFixed(1):v;
      return '<label>'+label+'</label><input type="number" step="'+step+'" id="cfg_'+k+'" value="'+displayVal+'" data-key="'+k+'" data-pct="'+(m.pct?"1":"0")+'">';
    }).join("");
  }catch(e){addLog("❌ Errore settings: "+e.message,"sell");}
}
function hideSettings(){document.getElementById("settingsModal").style.display="none";}

async function saveSettings(){
  const inputs=document.querySelectorAll("#settingsFields input");
  const body={};
  inputs.forEach(inp=>{
    const k=inp.dataset.key;
    let v=parseFloat(inp.value);
    if(inp.dataset.pct==="1") v=v/100;
    body[k]=v;
  });
  try{
    const r=await fetch(API+"/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const d=await r.json();
    if(d.success){
      document.getElementById("settingsSaved").style.display="block";
      addLog("⚙️ Settings salvati: "+d.updated.join(", "),"buy");
      setTimeout(()=>{document.getElementById("settingsSaved").style.display="none";},3000);
    }
  }catch(e){addLog("❌ Errore salvataggio: "+e.message,"sell");}
}

async function resetSettings(){
  if(!confirm("Ripristinare tutte le impostazioni ai valori default?"))return;
  try{
    const defaults={initial_capital:5000,max_positions:3,risk_per_trade:0.02,stop_loss_pct:0.025,trailing_activation:0.015,trailing_distance:0.012,cooldown_minutes:30,learn_rate:0.05,min_weight:0.05,max_weight:2.0,min_trades_to_learn:5,spread_slippage_pct:0.001};
    const r=await fetch(API+"/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(defaults)});
    const d=await r.json();
    if(d.success){addLog("⚙️ Settings ripristinati ai default","buy");showSettings();}
  }catch(e){addLog("❌ Errore reset: "+e.message,"sell");}
}

// Init
load();
setInterval(load,30000);
addLog("Dashboard caricata","");
</script></body></html>`;

// ─────────────────────────────────────
// WORKER ENTRY POINT
// ─────────────────────────────────────
export default {
  // HTTP requests → API
  async fetch(request, env) {
    return handleAPI(request, env);
  },

  // Cron trigger → scan every 5 min
  async scheduled(event, env) {
    await scan(env.DB, env);
  },
};
