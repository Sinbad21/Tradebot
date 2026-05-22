/* asset-detail.jsx — Per-asset deep view
   Header · Price chart · KPI rail · Open position · Brain reasoning
   · Pattern history · Per-ticker trade log · News feed */

const { useState: useStateAD, useMemo: useMemoAD, useEffect: useEffectAD, useRef: useRefAD } = React;

/* deterministic series builder */
function adSeries(seed, n, base, vol, drift) {
  let s = seed >>> 0;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [base];
  for (let i = 1; i < n; i++) {
    out.push(Math.max(0.01, out[i - 1] + (rand() - 0.5) * vol + drift + Math.sin(i / 7) * vol * 0.18));
  }
  return out;
}

const AD_TF = {
  "1D":  { interval: "15m", range: "1d" },
  "1W":  { interval: "1h", range: "5d" },
  "1M":  { interval: "1d", range: "1mo" },
  "3M":  { interval: "1d", range: "3mo" },
  "1Y":  { interval: "1d", range: "1y" },
};

const NEWS_TEMPLATES = [
  (t) => `${t} cleared a 4h bull-flag breakout — Brain raised conviction to high.`,
  (t) => `Volume on ${t} expanding above 20-day average. Pattern: VWAP reclaim.`,
  (t) => `${t} options flow leaning bullish into earnings. IV ranked at 62%.`,
  (t) => `Sector rotation favoring ${t} — peers up 2.3% on average today.`,
  (t) => `${t} broke below its 50-day moving average. Brain stepped back to observation.`,
  (t) => `${t} hit a new 90-day high. Brain widened the trailing stop to lock in gains.`,
];

const PATTERNS_LIB = [
  "bull-flag", "rsi-divergence", "vwap-reclaim", "ema-crossover",
  "volume-spike", "supply-zone-tap", "macd-cross", "ichimoku-cross",
];

/* ── Helpers ──────────────────────────────────────────────── */
function adClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function adFmtTime(d) {
  return d.toTimeString().slice(0, 5);
}
function adFmtAgo(min) {
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function fallbackSeries(basePrice) {
  if (!basePrice) return [0, 0, 0];
  return [basePrice * 0.994, basePrice * 1.002, basePrice];
}

/* ── Price chart (smaller than EquityCurve, asset-specific) */
function AssetChart({ ticker, basePrice, color }) {
  const [tf, setTf] = useStateAD("1M");
  const [hover, setHover] = useStateAD(null);
  const [candles, setCandles] = useStateAD([]);
  const cfg = AD_TF[tf];

  const series = useMemoAD(() => {
    const closes = candles.map((candle) => Number(candle.close) || 0).filter((value) => value > 0);
    return closes.length >= 2 ? closes : fallbackSeries(basePrice);
  }, [basePrice, candles]);

  useEffectAD(() => {
    let cancelled = false;
    window.BotActions.fetchChart(ticker, cfg.interval, cfg.range)
      .then((data) => {
        if (!cancelled) setCandles(data.candles || []);
      })
      .catch(() => {
        if (!cancelled) setCandles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cfg.interval, cfg.range, ticker]);

  const wrapRef = useRefAD(null);
  const [size, setSize] = useStateAD({ w: 720, h: 320 });

  useEffectAD(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const cr = e.contentRect;
        setSize({ w: Math.max(320, cr.width), h: Math.max(200, cr.height) });
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 12, r: 12, t: 16, b: 26 };
  const W = size.w, H = size.h;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  let yMin = Math.min(...series), yMax = Math.max(...series);
  const yPad = (yMax - yMin) * 0.08 || 1;
  yMin -= yPad; yMax += yPad;

  const xAt = (i) => pad.l + (i / (series.length - 1)) * innerW;
  const yAt = (v) => pad.t + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  function buildPath(s) {
    let d = `M${xAt(0).toFixed(2)},${yAt(s[0]).toFixed(2)}`;
    for (let i = 0; i < s.length - 1; i++) {
      const x0 = xAt(i), y0 = yAt(s[i]);
      const x1 = xAt(i + 1), y1 = yAt(s[i + 1]);
      const mx = (x0 + x1) / 2;
      d += ` Q ${x0.toFixed(2)},${y0.toFixed(2)} ${mx.toFixed(2)},${((y0 + y1) / 2).toFixed(2)}`;
    }
    d += ` L ${xAt(series.length - 1).toFixed(2)},${yAt(s[s.length - 1]).toFixed(2)}`;
    return d;
  }
  const linePath = buildPath(series);
  const areaPath = `${linePath} L ${xAt(series.length - 1).toFixed(2)},${(pad.t + innerH).toFixed(2)} L ${xAt(0).toFixed(2)},${(pad.t + innerH).toFixed(2)} Z`;

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = adClamp((x - pad.l) / innerW, 0, 1);
    const i = Math.round(ratio * (series.length - 1));
    setHover({ i, x: xAt(i) });
  }

  const first = series[0];
  const last = series[series.length - 1];
  const pnlPct = ((last - first) / first) * 100;
  const pos = pnlPct >= 0;
  const cursorVal = hover ? series[hover.i] : last;

  return (
    <div className="ad-chart-card">
      <div className="ad-chart-card__head">
        <div>
          <div className="t-mono" style={{ fontSize: 10, color: "var(--text-4)", letterSpacing: ".14em" }}>PRICE · {tf}</div>
          <div className="ad-chart-card__price t-num" style={{ color: pos ? "var(--profit)" : "var(--loss)", textShadow: pos ? "var(--glow-profit)" : "var(--glow-loss)" }}>
            ${fmt(cursorVal, { decimals: cursorVal < 10 ? 4 : 2 })}
          </div>
          <div className={"ad-chart-card__delta t-mono " + (pos ? "is-pos" : "is-neg")}>
            {pos ? "▲" : "▼"} {fmt(Math.abs(pnlPct), { decimals: 2 })}% over {tf}
          </div>
        </div>
        <div className="seg">
          {Object.keys(AD_TF).map(k => (
            <button key={k} className={"seg__btn" + (tf === k ? " seg__btn--on" : "")} onClick={() => setTf(k)}>{k}</button>
          ))}
        </div>
      </div>

      <div className="ad-chart-card__chart" ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
          <defs>
            <linearGradient id="ad-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"   stopColor={pos ? "rgba(0,255,136,0.40)" : "rgba(255,61,113,0.40)"} />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </linearGradient>
            <filter id="ad-glow" x="-10%" y="-50%" width="120%" height="200%">
              <feGaussianBlur stdDeviation="2.0" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* gridlines */}
          {[0.25, 0.5, 0.75].map((p, i) => (
            <line key={i} x1={pad.l} x2={W - pad.r} y1={pad.t + p * innerH} y2={pad.t + p * innerH} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
          ))}

          <path d={areaPath} fill="url(#ad-area)" />
          <path d={linePath} fill="none" stroke={pos ? "var(--profit)" : "var(--loss)"} strokeWidth="2" strokeLinecap="round" filter="url(#ad-glow)" />

          {/* end point pulse */}
          <circle cx={xAt(series.length - 1)} cy={yAt(last)} r={4} fill={pos ? "var(--profit)" : "var(--loss)"} style={{ filter: `drop-shadow(0 0 8px ${pos ? "rgba(0,255,136,0.7)" : "rgba(255,61,113,0.7)"})` }} />

          {/* crosshair */}
          {hover && (
            <g>
              <line x1={hover.x} x2={hover.x} y1={pad.t} y2={H - pad.b} stroke={pos ? "rgba(0,255,136,0.5)" : "rgba(255,61,113,0.5)"} strokeDasharray="2 3" />
              <circle cx={hover.x} cy={yAt(series[hover.i])} r={4} fill={pos ? "var(--profit)" : "var(--loss)"} />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

/* ── Per-ticker pattern detections ─────────────────────────── */
function PatternHistory({ asset }) {
  const items = useMemoAD(() => {
    const patterns = Array.isArray(asset.patterns) ? asset.patterns : [];
    if (patterns.length) return patterns;
    return [{ p: "waiting", strength: (asset.conf / 100).toFixed(2), minsAgo: 5, outcome: "active" }];
  }, [asset]);

  return (
    <div className="ad-card">
      <div className="ad-card__head">
        <h3 className="ad-card__title">
          Pattern history
          <InfoTip title="Pattern history" align="right" width={300}>
            Every algorithmic pattern the Brain has detected on this ticker.
            <span className="k">filled</span> = led to an entry,
            <span className="k">expired</span> = invalidated before entry,
            <span className="k">active</span> = currently watching.
          </InfoTip>
        </h3>
      </div>
      <div className="ad-pattern-list">
        {items.map(it => (
          <div key={it.id} className="ad-pattern">
            <div className="ad-pattern__dot" />
            <div className="ad-pattern__main">
              <span className="t-mono ad-pattern__name">{it.p}</span>
              <span className={"ad-pattern__outcome ad-pattern__outcome--" + it.outcome}>{it.outcome}</span>
            </div>
            <span className="t-mono ad-pattern__strength">conf {it.strength}</span>
            <span className="t-mono ad-pattern__time">{adFmtAgo(it.minsAgo)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── News feed (mocked) ──────────────────────────────────── */
function NewsFeed({ asset, trades }) {
  const items = useMemoAD(() => {
    const headlineItems = [
      {
        id: `${asset.ticker}-reasoning`,
        title: asset.reasoning,
        source: "Brain log",
        hoursAgo: asset.lastSeen ? Math.max(1, Math.round((Date.now() - new Date(asset.lastSeen).getTime()) / 3600000)) : 1,
      },
      ...(asset.patterns || []).slice(0, 2).map((pattern, index) => ({
        id: `${asset.ticker}-pattern-${index}`,
        title: `${asset.ticker} pattern ${pattern.p} is ${pattern.outcome} at confidence ${pattern.strength}.`,
        source: "ScanLog",
        hoursAgo: Math.max(1, Math.round((pattern.minsAgo || 1) / 60)),
      })),
      ...(trades || []).slice(0, 2).map((trade, index) => ({
        id: `${asset.ticker}-trade-${index}`,
        title: `${asset.ticker} closed ${trade.reason || "manual_close"} at ${fmt(Number(trade.pnl_pct) || 0, { decimals: 2 })}% P&L.`,
        source: "Trade archive",
        hoursAgo: trade.closed_at ? Math.max(1, Math.round((Date.now() - new Date(trade.closed_at).getTime()) / 3600000)) : 1,
      })),
    ];
    return headlineItems.sort((left, right) => left.hoursAgo - right.hoursAgo).slice(0, 5);
  }, [asset, trades]);
  return (
    <div className="ad-card">
      <div className="ad-card__head">
        <h3 className="ad-card__title">
          News &amp; signals
          <InfoTip title="News & signals" align="left" width={300}>
            Mixed feed of Brain-generated observations and external news.
            Items the Brain weighs heaviest are tagged <span className="k">Brain log</span>.
          </InfoTip>
        </h3>
      </div>
      <div className="ad-news-list">
        {items.map(n => (
          <div key={n.id} className="ad-news">
            <div className="ad-news__source t-mono">{n.source}</div>
            <div className="ad-news__title">{n.title}</div>
            <div className="ad-news__time t-mono">{adFmtAgo(n.hoursAgo * 60)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Per-ticker recent trade log ────────────────────────── */
function TickerTradeLog({ ticker }) {
  const trades = useBotStore((state) => state.status.closedTrades.filter((trade) => trade.ticker === ticker).slice(0, 6));

  const tot = trades.reduce((s, t) => s + t.pnl, 0);
  const winRate = trades.length ? (trades.filter(t => t.pnl > 0).length / trades.length) * 100 : 0;

  return (
    <div className="ad-card">
      <div className="ad-card__head">
        <h3 className="ad-card__title">
          Trade log · {ticker}
          <InfoTip title={`Trades on ${ticker}`} align="right" width={300}>
            Closed positions on this ticker, newest first. Aggregate P&L and
            win rate on the right.
          </InfoTip>
        </h3>
        <div className="ad-card__head-r t-mono">
          <span>{winRate.toFixed(0)}% win rate</span>
          <span className="sep">·</span>
          <span className={tot >= 0 ? "is-pos" : "is-neg"}>
            {tot >= 0 ? "+" : "−"}${fmt(Math.abs(tot), { decimals: 2 })}
          </span>
        </div>
      </div>
      <div className="ad-tradelog">
        {trades.length === 0 && <div className="th-empty">No closed trades on this ticker yet.</div>}
        {trades.map(t => {
          const pos = Number(t.pnl) >= 0;
          const entry = Number(t.entry_price) || 0;
          const exit = Number(t.exit_price) || 0;
          const shares = Number(t.shares) || 0;
          const pnl = Number(t.pnl) || 0;
          const closedAt = t.closed_at ? new Date(t.closed_at) : null;
          const daysAgo = closedAt ? Math.max(0, Math.floor((Date.now() - closedAt.getTime()) / (24 * 60 * 60 * 1000))) : 0;
          return (
            <div key={t.id || `${t.ticker}-${t.closed_at}`} className="ad-trade">
              <span className={"ad-trade__reason ad-trade__reason--" + (t.reason === "stop_loss" ? "loss" : t.reason === "take_profit" ? "profit" : t.reason === "brain_exit" ? "violet" : "cyan")}>
                {(t.reason || "manual_close").replace(/_/g, " ")}
              </span>
              <span className="t-mono ad-trade__nums">
                {fmt(shares, { decimals: entry < 10 ? 2 : 0 })} @ ${fmt(entry, { decimals: 2 })}
                {" "}→{" "}
                ${fmt(exit, { decimals: 2 })}
              </span>
              <span className={"t-num ad-trade__pnl " + (pos ? "is-pos" : "is-neg")}>
                {pos ? "+" : "−"}${fmt(Math.abs(pnl), { decimals: 2 })}
              </span>
              <span className="t-mono ad-trade__when">{t.daysAgo}d ago</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Brain reasoning card ────────────────────────────────── */
function BrainCard({ asset }) {
  const liveWeights = useBotStore((state) => state.status.modes?.[asset.mode || window.__activeMode || "mid"]?.weights || {});
  const indicators = useMemoAD(() => {
    const source = Object.keys(liveWeights).length ? liveWeights : {
      macd_cross: 1,
      rsi: 0.6,
      ema_trend: 0.3,
      bollinger: 0.5,
      vol_growing: 0.3,
    };
    return Object.entries(source).slice(0, 5).map(([key, value]) => ({
      k: key,
      v: Number(value) || 0,
      on: asset.conf >= 60 || key === "macd_cross",
    }));
  }, [asset.conf, liveWeights]);

  return (
    <div className="ad-card">
      <div className="ad-card__head">
        <h3 className="ad-card__title">
          <span className="t-violet">Brain</span> · reasoning
          <InfoTip title="Brain reasoning" align="right" width={300}>
            The model's current narrative for this asset — pattern matches,
            indicator confluences and risk posture. Refreshed every scan cycle.
          </InfoTip>
        </h3>
        <div className="ad-conf">
          <div className="ad-conf__num t-num" style={{ color: asset.conf >= 80 ? "var(--violet)" : asset.conf >= 65 ? "var(--cyan)" : "var(--text-2)" }}>
            {asset.conf}<span className="unit">%</span>
          </div>
          <div className="t-mono" style={{ color: "var(--text-4)", fontSize: 10, letterSpacing: ".14em" }}>CONFIDENCE</div>
        </div>
      </div>
      <p className="t-body" style={{ color: "var(--text-2)" }}>{asset.reasoning}</p>

      <div className="ad-card__divider" />

      <div className="ad-indicators">
        {indicators.map(ind => (
          <div key={ind.k} className={"ad-ind " + (ind.on ? "is-on" : "is-off")}>
            <span className="ad-ind__dot" />
            <span className="t-mono ad-ind__k">{ind.k}</span>
            <span className="t-mono ad-ind__v">{ind.v.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Position card ───────────────────────────────────────── */
function PositionCard({ asset }) {
  const hasPos = asset.positionSize > 0;
  const pos = (asset.pnlAbs || 0) >= 0;

  async function handleAdjustStop() {
    const preset = asset.stopLoss || asset.price * 0.97;
    const input = window.prompt(`Set stop-loss for ${asset.ticker}`, String(Number(preset).toFixed(2)));
    if (input == null) return;
    const stopLoss = Number(input);
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      window.alert("Enter a valid stop-loss price.");
      return;
    }
    try {
      await window.BotActions.updateStopLoss(asset.ticker, stopLoss);
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function handleLockIn() {
    try {
      await window.BotActions.lockInPosition(asset.ticker, 0.5);
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function handleClose() {
    try {
      await window.BotActions.closePosition(asset.ticker);
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function handleForceEntry() {
    try {
      await window.BotActions.forceEntry(asset.ticker, window.__activeMode || asset.mode || "mid");
    } catch (e) {
      window.alert(e.message);
    }
  }

  return (
    <div className="ad-card">
      <div className="ad-card__head">
        <h3 className="ad-card__title">
          Position
          <InfoTip title="Open position" align="right" width={280}>
            Active size, entry, current value and unrealized P&L. Sourced from
            <span className="k">positions</span>. The action buttons hit the
            same endpoints the dashboard uses.
          </InfoTip>
        </h3>
        {hasPos ? (
          <span className="badge badge--profit"><span className="dot" />HOLDING</span>
        ) : (
          <span className="badge">OBSERVING</span>
        )}
      </div>

      {hasPos ? (
        <>
          <div className="ad-pos-grid">
            <div className="ad-pos-cell">
              <span className="t-label">Size</span>
              <span className="t-num">${fmt(asset.positionSize, { decimals: 0 })}</span>
            </div>
            <div className="ad-pos-cell">
              <span className="t-label">Entry</span>
              <span className="t-num">${fmt(asset.entryPrice, { decimals: 2 })}</span>
            </div>
            <div className="ad-pos-cell">
              <span className="t-label">Now</span>
              <span className="t-num">${fmt(asset.price, { decimals: 2 })}</span>
            </div>
          </div>
          <div className="ad-pos-pnl">
            <span className="t-label">Unrealized P&amp;L</span>
            <span className={"t-num ad-pos-pnl__v " + (pos ? "is-pos" : "is-neg")}>
              {pos ? "+" : "−"}${fmt(Math.abs(asset.pnlAbs), { decimals: 2 })}
              <span className="ad-pos-pnl__pct">
                ({asset.pnlPct >= 0 ? "+" : ""}{fmt(asset.pnlPct, { decimals: 2 })}%)
              </span>
            </span>
          </div>
          <div className="ad-pos-actions">
            <button className="btn btn--sm" onClick={handleAdjustStop}>Adjust stop</button>
            <button className="btn btn--sm" onClick={handleLockIn}>Lock in 50%</button>
            <button className="btn btn--danger btn--sm" onClick={handleClose}>Close position</button>
          </div>
        </>
      ) : (
        <>
          <div className="ad-pos-empty">
            No active position. The Brain is currently observing for setup confirmation.
          </div>
          <div className="ad-pos-actions">
            <button className="btn btn--primary btn--sm" onClick={handleForceEntry}>{I.bolt} Force entry</button>
            <button className="btn btn--sm" onClick={() => window.__navigate?.("alerts")}>Set alert</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Header bar ──────────────────────────────────────────── */
function AssetHeader({ asset, onBack }) {
  const pos = asset.chg >= 0;
  return (
    <div className="ad-header">
      <button className="ad-back" onClick={onBack} aria-label="Back to watchlist">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        <span>Watchlist</span>
      </button>
      <div className="ad-header__main">
        <div className="ad-header__chip" style={{ "--chip-c": asset.color }}>
          <span style={{ position: "relative", zIndex: 1 }}>{asset.ticker.slice(0, 4)}</span>
        </div>
        <div>
          <div className="ad-header__row">
            <h1 className="ad-header__ticker">{asset.ticker}</h1>
            <span className="badge">{asset.exch}</span>
            <span className="badge">{asset.klass.toUpperCase()}</span>
          </div>
          <div className="ad-header__name">{asset.name}</div>
        </div>
      </div>
      <div className="ad-header__price">
        <div className="t-mono" style={{ fontSize: 10, color: "var(--text-4)", letterSpacing: ".14em" }}>LAST PRICE</div>
        <div className="t-num ad-header__price-v">${fmt(asset.price, { decimals: asset.price < 10 ? 4 : 2 })}</div>
        <div className={"ad-header__delta " + (pos ? "is-pos" : "is-neg")}>
          {pos ? "▲" : "▼"} {fmt(Math.abs(asset.chg), { decimals: 2 })}%
          <span className="t-mono" style={{ color: "var(--text-4)", marginLeft: 6 }}>24h</span>
        </div>
      </div>
    </div>
  );
}

/* ── Main Asset detail screen ────────────────────────────── */
function AssetDetail({ ticker, onBack }) {
  const assets = useBotStore((state) => state.assets);
  const asset = useMemoAD(
    () => assets.find((entry) => entry.ticker === ticker) || assets[0] || {
      ticker: ticker || "N/A",
      name: ticker || "Unknown",
      exch: "US",
      klass: "stock",
      color: "#00E5FF",
      price: 0,
      chg: 0,
      conf: 0,
      status: "watching",
      reasoning: "Waiting for live asset data.",
      patterns: [],
      tradeCount: 0,
      realizedPnl: 0,
      mode: "mid",
      positionSize: 0,
      entryPrice: null,
      pnlAbs: 0,
      pnlPct: 0,
      stopLoss: null,
      takeProfit: null,
    },
    [assets, ticker]
  );

  const tickerTrades = useBotStore((state) => state.status.closedTrades.filter((trade) => trade.ticker === asset.ticker).slice(0, 6));

  const kpis = useMemoAD(() => {
    return {
      realizedPnl: Number(asset.realizedPnl) || 0,
      tradeCount: Number(asset.tradeCount) || 0,
      stopLoss: asset.stopLoss,
      takeProfit: asset.takeProfit,
      mode: (asset.mode || "mid").toUpperCase(),
    };
  }, [asset]);

  return (
    <div className="ad-screen">
      <AssetHeader asset={asset} onBack={onBack} />

      <div className="ad-grid-top">
        <AssetChart ticker={asset.ticker} basePrice={asset.price} color={asset.color} />

        <div className="ad-kpi-rail">
          <div className="ad-kpi">
            <span className="t-label">Realized P&amp;L</span>
            <span className={"t-num " + (kpis.realizedPnl >= 0 ? "is-pos" : "is-neg")}>{kpis.realizedPnl >= 0 ? "+" : "−"}${fmt(Math.abs(kpis.realizedPnl), { decimals: 2, compact: true })}</span>
          </div>
          <div className="ad-kpi">
            <span className="t-label">Closed trades</span>
            <span className="t-num">{kpis.tradeCount}</span>
          </div>
          <div className="ad-kpi">
            <span className="t-label">Stop-loss</span>
            <span className="t-num">{kpis.stopLoss ? `$${fmt(Number(kpis.stopLoss), { decimals: 2 })}` : "—"}</span>
          </div>
          <div className="ad-kpi">
            <span className="t-label">Take-profit</span>
            <span className="t-num">{kpis.takeProfit ? `$${fmt(Number(kpis.takeProfit), { decimals: 2 })}` : "—"}</span>
          </div>
          <div className="ad-kpi ad-kpi--accent">
            <span className="t-label">Mode</span>
            <span className="t-num" style={{ color: "var(--violet)", textShadow: "var(--glow-violet-sm)" }}>
              {kpis.mode}
            </span>
          </div>
        </div>
      </div>

      <div className="ad-grid-mid">
        <BrainCard asset={asset} />
        <PositionCard asset={asset} />
      </div>

      <div className="ad-grid-bot">
        <PatternHistory asset={asset} />
        <TickerTradeLog ticker={asset.ticker} />
      </div>

      <NewsFeed asset={asset} trades={tickerTrades} />
    </div>
  );
}

Object.assign(window, { AssetDetail });
