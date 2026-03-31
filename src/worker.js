/**
 * Trading Bot v3.0 — Cloudflare Worker
 * 
 * Cron trigger ogni 5 min → scansiona mercato → gestisce posizioni
 * D1 database per persistenza
 * API REST per la GUI desktop
 */

// ─────────────────────────────────────
// CONFIG
// ─────────────────────────────────────
const INITIAL_CAPITAL = 5000;
const MAX_POSITIONS = 3;
const RISK_PER_TRADE = 0.02;
const STOP_LOSS_PCT = 0.025;
const TRAILING_ACTIVATION = 0.015;
const TRAILING_DISTANCE = 0.012;
const COOLDOWN_MINUTES = 30;
const LEARN_RATE = 0.05;
const MIN_WEIGHT = 0.05;
const MAX_WEIGHT = 2.0;
const MIN_TRADES_TO_LEARN = 5;

// ─────────────────────────────────────
// WATCHLIST
// ─────────────────────────────────────
const WATCHLIST = {
  // Stocks
  NVDA: "NVIDIA", AAPL: "Apple", TSLA: "Tesla", META: "Meta",
  AMZN: "Amazon", MSFT: "Microsoft", GOOGL: "Alphabet",
  JPM: "JPMorgan", XOM: "ExxonMobil",
  GLD: "Gold ETF", SPY: "S&P 500", QQQ: "Nasdaq 100",
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
  if (isCrypto) return []; // Alpaca crypto ha endpoint diverso, usiamo Yahoo

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
  if (isCrypto) return null;

  const apiKey = env.ALPACA_KEY;
  const secret = env.ALPACA_SECRET;
  if (!apiKey || !secret) return null;

  try {
    const url = `https://data.alpaca.markets/v2/stocks/${ticker}/trades/latest`;
    const res = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": secret,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.trade?.p || null;
  } catch {
    return null;
  }
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
  return r ? parseFloat(r.value) : INITIAL_CAPITAL;
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

  if (totalTrained < MIN_TRADES_TO_LEARN) return `Trade ${totalTrained}/${MIN_TRADES_TO_LEARN} — raccolta dati`;

  const isWin = pnl > 0;
  const magnitude = Math.min(Math.abs(pnlPct) / 5, 1.0);
  const delta = LEARN_RATE * magnitude;
  const adjustments = [];

  for (const ind of indicators) {
    const row = await db.prepare("SELECT weight FROM brain WHERE indicator=?").bind(ind).first();
    if (!row) continue;
    let newW = isWin ? Math.min(row.weight + delta, MAX_WEIGHT) : Math.max(row.weight - delta, MIN_WEIGHT);
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
        const newW = Math.min(row.weight + LEARN_RATE * 0.3, MAX_WEIGHT);
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
  const positions = await getPositions(db);
  if (positions.length >= MAX_POSITIONS) return null;
  if (positions.find((p) => p.ticker === ticker)) return null;

  const capital = await getCapital(db);
  const slDist = Math.max(atr * 1.5, price * STOP_LOSS_PCT);
  if (slDist <= 0 || price <= 0) return null;

  let shares = Math.max(1, Math.floor((capital * RISK_PER_TRADE) / slDist));
  const maxShares = Math.floor((capital * 0.35) / price);
  shares = Math.min(shares, maxShares);
  if (shares < 1) return null;

  const cost = shares * price;
  const sl = +(price - slDist).toFixed(2);
  const tp = +(price + slDist * 2).toFixed(2);

  await db.prepare(
    `INSERT INTO positions (ticker,name,entry_price,shares,stop_loss,take_profit,highest,cost,opened_at,score_at_entry,current_price,brain_indicators)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(ticker, name, price, shares, sl, tp, price, cost, new Date().toISOString(), score, price, JSON.stringify(activeInd)).run();

  await setCapital(db, capital - cost);
  return { ticker, name, shares, entry_price: price, stop_loss: sl, take_profit: tp, cost };
}

async function closePosition(db, ticker, price, reason) {
  const pos = await db.prepare("SELECT * FROM positions WHERE ticker=?").bind(ticker).first();
  if (!pos) return null;

  const revenue = pos.shares * price;
  const pnl = +(revenue - pos.cost).toFixed(2);
  const pnlPct = +((price - pos.entry_price) / pos.entry_price * 100).toFixed(2);

  // Save closed trade
  await db.prepare(
    `INSERT INTO closed_trades (ticker,name,entry_price,exit_price,shares,cost,revenue,pnl,pnl_pct,reason,opened_at,closed_at,brain_indicators)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(pos.ticker, pos.name, pos.entry_price, price, pos.shares, pos.cost, revenue, pnl, pnlPct, reason, pos.opened_at, new Date().toISOString(), pos.brain_indicators).run();

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
      const lastPrice = bars[bars.length - 1].close;
      const high = bars[bars.length - 1].high;
      const low = bars[bars.length - 1].low;

      // Update price
      await db.prepare("UPDATE positions SET current_price=?, unrealized_pnl=?, unrealized_pct=? WHERE ticker=?")
        .bind(lastPrice, +((lastPrice - pos.entry_price) * pos.shares).toFixed(2),
              +((lastPrice - pos.entry_price) / pos.entry_price * 100).toFixed(2), pos.ticker).run();

      // Trailing stop
      let highest = Math.max(pos.highest, high);
      let sl = pos.stop_loss;
      let trailingActive = pos.trailing_active;
      const gainPct = (highest - pos.entry_price) / pos.entry_price;
      if (gainPct >= TRAILING_ACTIVATION) {
        trailingActive = 1;
        const newSl = +(highest * (1 - TRAILING_DISTANCE)).toFixed(2);
        if (newSl > sl) sl = newSl;
      }
      await db.prepare("UPDATE positions SET highest=?, stop_loss=?, trailing_active=? WHERE ticker=?")
        .bind(highest, sl, trailingActive, pos.ticker).run();

      // Check SL/TP
      if (pos.auto_sl) {
        if (low <= sl) {
          const trade = await closePosition(db, pos.ticker, sl, "stop_loss");
          if (trade) results.closes.push(trade);
          continue;
        }
        if (high >= pos.take_profit) {
          const trade = await closePosition(db, pos.ticker, pos.take_profit, "take_profit");
          if (trade) results.closes.push(trade);
          continue;
        }
      }

      results.equity += lastPrice * pos.shares;
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

  // GET /api/status — full status
  if (path === "/api/status") {
    const capital = await getCapital(db);
    const positions = await getPositions(db);
    const weights = await getWeights(db);
    const totalTrained = await getTotalTrained(db);
    const closedTrades = (await db.prepare("SELECT * FROM closed_trades ORDER BY id DESC LIMIT 20").all()).results || [];
    const recentLogs = (await db.prepare("SELECT * FROM scan_log ORDER BY id DESC LIMIT 50").all()).results || [];

    let equity = capital;
    positions.forEach((p) => { equity += (p.current_price || p.entry_price) * p.shares; });

    const wins = closedTrades.filter((t) => t.pnl > 0).length;
    const totalClosed = closedTrades.length;

    return json({
      capital: +capital.toFixed(2),
      equity: +equity.toFixed(2),
      pnl: +(equity - INITIAL_CAPITAL).toFixed(2),
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
    });
  }

  // GET /api/scan — trigger scan
  if (path === "/api/scan") {
    const result = await scan(db, env);
    return json(result);
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
    await db.prepare("DELETE FROM positions").run();
    await db.prepare("DELETE FROM closed_trades").run();
    await db.prepare("DELETE FROM scan_log").run();
    await db.prepare("DELETE FROM brain_history").run();
    await db.prepare("UPDATE brain SET weight = default_weight").run();
    await setCapital(db, INITIAL_CAPITAL);
    await db.prepare("INSERT OR REPLACE INTO config VALUES ('total_trades', '0')").run();
    return json({ success: true, capital: INITIAL_CAPITAL });
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
// MINI DASHBOARD HTML
// ─────────────────────────────────────
const DASHBOARD_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Trading Bot Monitor</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#111827;color:#f3f4f6;font-family:system-ui,sans-serif;padding:16px}
h1{font-size:1.4rem;margin-bottom:12px;color:#a78bfa}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:16px}
.card{background:#1f2937;border:1px solid #374151;border-radius:8px;padding:12px}
.card .label{font-size:.7rem;color:#9ca3af;text-transform:uppercase}
.card .value{font-size:1.3rem;font-weight:700;margin-top:2px}
.green{color:#34d399}.red{color:#f87171}.yellow{color:#fbbf24}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th{text-align:left;color:#9ca3af;font-size:.7rem;padding:6px 8px;border-bottom:1px solid #374151}
td{padding:6px 8px;border-bottom:1px solid #1f2937}
tr:nth-child(even){background:#1a2438}
.badge{padding:2px 8px;border-radius:4px;font-weight:700;font-size:.75rem}
.buy-badge{background:#0a3320;color:#34d399}
.sell-badge{background:#3a1520;color:#f87171}
.wait-badge{background:#33290a;color:#fbbf24}
.hold-badge{color:#6b7280}
button{background:#7c4dff;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:.85rem;margin:4px}
button:hover{opacity:.85}
button.danger{background:#ef4444}
.log{background:#1f2937;border:1px solid #374151;border-radius:8px;padding:8px;font-family:monospace;font-size:.75rem;max-height:200px;overflow-y:auto;color:#9ca3af;margin-top:12px}
#status{font-size:.75rem;color:#6b7280;margin-top:8px}
</style></head><body>
<h1>◉ Trading Bot — Cloud Monitor</h1>
<div class="cards" id="cards"></div>
<div style="margin-bottom:12px">
<button onclick="doScan()">🔍 Scan Now</button>
<button onclick="closeAll()" class="danger">📦 Close All</button>
<button onclick="resetAll()" class="danger">🗑 Reset</button>
</div>
<h2 style="font-size:1rem;color:#9ca3af;margin-bottom:6px">Posizioni</h2>
<table id="positions"><tr><td style="color:#6b7280">Caricamento...</td></tr></table>
<h2 style="font-size:1rem;color:#9ca3af;margin:12px 0 6px">Watchlist</h2>
<table id="watchlist"><tr><td style="color:#6b7280">Caricamento...</td></tr></table>
<div id="status"></div>
<script>
const API=window.location.origin+"/api";
async function load(){
  try{
    const r=await fetch(API+"/status");const d=await r.json();
    const pnl=d.pnl;const pnlCls=pnl>=0?"green":"red";
    const spy=d.recentScores?.find(s=>s.ticker==="SPY");
    document.getElementById("cards").innerHTML=
      card("Equity","€"+d.equity.toFixed(2))+
      card("P&L",(pnl>=0?"+":"")+"€"+pnl.toFixed(2),pnlCls)+
      card("Cash","€"+d.capital.toFixed(2))+
      card("Posizioni",d.positions.length+"/"+${MAX_POSITIONS})+
      card("Brain",d.brain.confidence.toFixed(0)+"%")+
      card("Win Rate",d.stats.wr+"%",d.stats.wr>=50?"green":"red");
    // Positions
    let ph="<tr><th>Asset</th><th>Prezzo</th><th>P&L</th><th>SL</th><th>TP</th><th></th></tr>";
    if(!d.positions.length)ph+="<tr><td colspan=6 style='color:#6b7280'>Nessuna posizione</td></tr>";
    d.positions.forEach(p=>{
      const pnl2=((p.current_price-p.entry_price)*p.shares).toFixed(2);
      const cls=pnl2>=0?"green":"red";
      ph+=\`<tr><td>\${p.name}</td><td>$\${(p.current_price||p.entry_price).toFixed(2)}</td>
      <td class="\${cls}">\${pnl2>=0?"+":""}€\${pnl2}</td>
      <td class="red">$\${p.stop_loss.toFixed(0)}</td><td class="green">$\${p.take_profit.toFixed(0)}</td>
      <td><button onclick="closeTicker('\${p.ticker}')" style="font-size:.7rem;padding:3px 8px">Chiudi</button></td></tr>\`;
    });
    document.getElementById("positions").innerHTML=ph;
    // Watchlist from recent scores (deduplicate, take latest)
    const seen=new Set();const scores=[];
    (d.recentScores||[]).forEach(s=>{if(!seen.has(s.ticker)&&s.ticker!=="SPY"){seen.add(s.ticker);scores.push(s);}});
    scores.sort((a,b)=>b.score-a.score);
    let wh="<tr><th>Asset</th><th>Prezzo</th><th>Score</th><th>RSI</th><th>Segnale</th></tr>";
    scores.forEach(s=>{
      let badge="hold-badge",txt="— HOLD";
      if(s.signal===1){badge="buy-badge";txt="▲ BUY";}
      else if(s.signal===-1){badge="sell-badge";txt="▼ SELL";}
      else if(s.score>=0.5){badge="wait-badge";txt="⏳ ATTESA";}
      const rsiCls=s.rsi<35?"green":(s.rsi>65?"red":"");
      wh+=\`<tr><td>\${s.ticker.includes("-USD")?"🪙":"📊"} \${s.ticker}</td>
      <td>$\${s.price.toFixed(2)}</td>
      <td class="\${s.score>=0.8?"green":(s.score>=0.5?"yellow":"")}">\${s.score.toFixed(1)}</td>
      <td class="\${rsiCls}">\${s.rsi.toFixed(0)}</td>
      <td><span class="badge \${badge}">\${txt}</span></td></tr>\`;
    });
    document.getElementById("watchlist").innerHTML=wh;
    document.getElementById("status").textContent="Ultimo aggiornamento: "+new Date().toLocaleTimeString();
  }catch(e){document.getElementById("status").textContent="Errore: "+e.message;}
}
function card(label,value,cls){return \`<div class="card"><div class="label">\${label}</div><div class="value \${cls||""}">\${value}</div></div>\`;}
async function doScan(){document.getElementById("status").textContent="Scansione...";await fetch(API+"/scan");load();}
async function closeTicker(t){if(confirm("Chiudere "+t+"?")){await fetch(API+"/close",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ticker:t})});load();}}
async function closeAll(){if(confirm("Chiudere TUTTE le posizioni?")){await fetch(API+"/close-all",{method:"POST"});load();}}
async function resetAll(){if(confirm("RESET completo? Riparti da €5.000")){await fetch(API+"/reset",{method:"POST"});load();}}
load();setInterval(load,60000);
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
