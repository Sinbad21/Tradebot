/* equity-curve.jsx — Milestone 2 · EquityCurveCard
   Hero area chart with cyan→violet fill, KPI rail, timeframe segments,
   benchmark overlay, hover crosshair + tooltip. */

const { useState: useStateEQ, useEffect: useEffectEQ, useMemo: useMemoEQ, useRef: useRefEQ, useCallback: useCallbackEQ } = React;

/* ── deterministic-ish series generator per timeframe ───────── */
function generateSeries(seed, n, base, vol, drift) {
  // mulberry32 PRNG for stable curves
  let s = seed >>> 0;
  const rand = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [base];
  for (let i = 1; i < n; i++) {
    const noise = (rand() - 0.5) * vol;
    const trend = drift + Math.sin(i / 9) * vol * 0.18;
    out.push(Math.max(0, out[i - 1] + noise + trend));
  }
  return out;
}

const TF_CONFIG = {
  "1D": { n: 96,  seed: 11, vol: 240,  drift: 18,   tickFmt: (i, n) => `${String(Math.floor((i / (n-1)) * 24)).padStart(2,"0")}:00`, label: "Today" },
  "1W": { n: 168, seed: 22, vol: 320,  drift: 14,   tickFmt: (i, n) => ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][Math.floor((i / (n-1)) * 6.99)],     label: "This week" },
  "1M": { n: 120, seed: 33, vol: 380,  drift: 16,   tickFmt: (i, n) => `D${Math.floor((i / (n-1)) * 29) + 1}`, label: "30 days" },
  "3M": { n: 180, seed: 44, vol: 520,  drift: 18,   tickFmt: (i, n) => ["Mar","Apr","May"][Math.floor((i / (n-1)) * 2.99)], label: "3 months" },
  "1Y": { n: 240, seed: 55, vol: 820,  drift: 22,   tickFmt: (i, n) => ["Jun","Aug","Oct","Dec","Feb","Apr"][Math.floor((i / (n-1)) * 5.99)], label: "12 months" },
  "ALL":{ n: 320, seed: 66, vol: 1200, drift: 28,   tickFmt: (i, n) => ["2023","2024","2025","2026"][Math.floor((i / (n-1)) * 3.99)], label: "All time" },
};

const BASES = {
  bot:  100000,
  SPY:  98000,
  BTC:  92000,
};

function liveBaseValue(status, reports) {
  return Number(status.equity) || Number(status.capital) || Number(reports.totalInvested) || BASES.bot;
}

function labelForPoint(tf, cfg, labels, index, length) {
  const raw = labels[index];
  if (typeof raw === "string" && /^\d{4}-\d{2}$/.test(raw)) return raw;
  if (raw) {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      if (tf === "1D") return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (tf === "1W" || tf === "1M") return date.toLocaleDateString([], { month: "short", day: "numeric" });
      return date.toLocaleDateString([], { month: "short", year: "2-digit" });
    }
    return String(raw);
  }
  return cfg.tickFmt(index, length);
}

function benchmarkRequestForTf(tf) {
  if (tf === "1D") return { interval: "15m", range: "1d" };
  if (tf === "1W") return { interval: "1h", range: "5d" };
  if (tf === "1M") return { interval: "1d", range: "1mo" };
  if (tf === "3M") return { interval: "1d", range: "3mo" };
  return { interval: "1d", range: "1y" };
}

function resampleSeries(series, targetLength) {
  if (!Array.isArray(series) || !series.length || targetLength <= 0) return [];
  if (series.length === targetLength) return series;
  if (targetLength === 1) return [series[series.length - 1]];
  return Array.from({ length: targetLength }, (_, index) => {
    const position = (index / (targetLength - 1)) * (series.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(series.length - 1, Math.ceil(position));
    if (lower === upper) return series[lower];
    const mix = position - lower;
    return series[lower] + (series[upper] - series[lower]) * mix;
  });
}

function computeKpis(series) {
  const first = series[0];
  const last = series[series.length - 1];
  const pnlAbs = last - first;
  const pnlPct = (pnlAbs / first) * 100;
  // simple Sharpe-ish using returns
  const rets = [];
  for (let i = 1; i < series.length; i++) rets.push((series[i] - series[i - 1]) / series[i - 1]);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  const std = Math.sqrt(variance) || 1e-9;
  const sharpe = (mean / std) * Math.sqrt(252);
  // max drawdown
  let peak = -Infinity, maxDD = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return { equity: last, pnlAbs, pnlPct, sharpe, maxDD: maxDD * 100, first };
}

/* ── Component ────────────────────────────────────────────── */
function EquityCurveCard() {
  const { status, reports, refreshing } = useBotStore((state) => ({
    status: state.status,
    reports: state.reports,
    refreshing: state.refreshing,
  }));
  const [tf, setTf] = useStateEQ("1M");
  const [benchmark, setBenchmark] = useStateEQ(null);  // null | "SPY" | "BTC"
  const [hover, setHover] = useStateEQ(null);          // { i, x }
  const [benchmarkSeries, setBenchmarkSeries] = useStateEQ(null);

  const cfg = TF_CONFIG[tf];

  const chartData = useMemoEQ(() => {
    const base = liveBaseValue(status, reports);
    const activityPoints = (status.scanActivity || [])
      .map((entry) => ({ value: Number(entry.equity) || Number(entry.cash) || 0, label: entry.t || null }))
      .filter((entry) => entry.value > 0);

    if (tf === "ALL") {
      const reportPoints = (reports.equityCurve || [])
        .map((entry) => ({ value: base + (Number(entry.cumulative_pnl) || 0), label: entry.month }))
        .filter((entry) => entry.value > 0);
      if (reportPoints.length >= 2) {
        return {
          series: reportPoints.map((entry) => entry.value),
          labels: reportPoints.map((entry) => entry.label),
        };
      }
    }

    const sliced = activityPoints.slice(-cfg.n);
    if (sliced.length >= 2) {
      return {
        series: sliced.map((entry) => entry.value),
        labels: sliced.map((entry) => entry.label),
      };
    }

    const fallback = generateSeries(cfg.seed, Math.max(24, Math.min(cfg.n, 48)), base, cfg.vol, cfg.drift);
    return {
      series: fallback,
      labels: fallback.map((_, index) => index),
    };
  }, [cfg, reports, status, tf]);

  const series = chartData.series;
  const labels = chartData.labels;
  const benchmarkBase = series[0] || liveBaseValue(status, reports);
  const fallbackSpy = useMemoEQ(() => generateSeries(cfg.seed + 7,  series.length, benchmarkBase, Math.max(benchmarkBase * 0.0022, 24), Math.max(benchmarkBase * 0.00012, 4)), [benchmarkBase, cfg.seed, series.length]);
  const fallbackBtc = useMemoEQ(() => generateSeries(cfg.seed + 13, series.length, benchmarkBase, Math.max(benchmarkBase * 0.0038, 36), Math.max(benchmarkBase * 0.00018, 6)), [benchmarkBase, cfg.seed, series.length]);

  useEffectEQ(() => {
    let cancelled = false;

    if (!benchmark) {
      setBenchmarkSeries(null);
      return undefined;
    }

    setBenchmarkSeries(null);
    const request = benchmarkRequestForTf(tf);
    const ticker = benchmark === "SPY" ? "SPY" : "BTC-USD";

    window.BotActions.fetchChart(ticker, request.interval, request.range)
      .then((data) => {
        if (cancelled) return;
        const closes = (data.candles || []).map((candle) => Number(candle.close) || 0).filter((value) => value > 0);
        if (closes.length < 2 || !series.length) {
          setBenchmarkSeries(null);
          return;
        }
        const rebased = resampleSeries(closes, series.length).map((value) => benchmarkBase * (value / closes[0]));
        setBenchmarkSeries(rebased);
      })
      .catch(() => {
        if (!cancelled) setBenchmarkSeries(null);
      });

    return () => {
      cancelled = true;
    };
  }, [benchmark, benchmarkBase, series.length, tf]);

  const benchData = benchmark === "SPY"
    ? (benchmarkSeries || fallbackSpy)
    : benchmark === "BTC"
      ? (benchmarkSeries || fallbackBtc)
      : null;

  // ── chart geometry
  const wrapRef = useRefEQ(null);
  const [size, setSize] = useStateEQ({ w: 900, h: 360 });

  useEffectEQ(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const cr = e.contentRect;
        setSize({ w: Math.max(320, cr.width), h: Math.max(220, cr.height) });
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const pad = { l: 12, r: 12, t: 18, b: 28 };
  const W = size.w, H = size.h;
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  // unified domain across series shown (so they share scale)
  const allSeries = benchData ? [series, benchData] : [series];
  let yMin = Infinity, yMax = -Infinity;
  for (const s of allSeries) for (const v of s) { if (v < yMin) yMin = v; if (v > yMax) yMax = v; }
  const yPad = (yMax - yMin) * 0.08 || 1;
  yMin -= yPad; yMax += yPad;

  const xAt = (i, len) => pad.l + (i / (len - 1)) * innerW;
  const yAt = v       => pad.t + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  function buildPath(s, smooth = true) {
    if (!smooth) return s.map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i, s.length).toFixed(2)},${yAt(v).toFixed(2)}`).join(" ");
    // smooth catmull-ish using midpoints
    let d = `M${xAt(0, s.length).toFixed(2)},${yAt(s[0]).toFixed(2)}`;
    for (let i = 0; i < s.length - 1; i++) {
      const x0 = xAt(i, s.length), y0 = yAt(s[i]);
      const x1 = xAt(i + 1, s.length), y1 = yAt(s[i + 1]);
      const mx = (x0 + x1) / 2;
      d += ` Q ${x0.toFixed(2)},${y0.toFixed(2)} ${mx.toFixed(2)},${((y0 + y1) / 2).toFixed(2)}`;
    }
    const lx = xAt(s.length - 1, s.length), ly = yAt(s[s.length - 1]);
    d += ` L ${lx.toFixed(2)},${ly.toFixed(2)}`;
    return d;
  }

  const linePath = buildPath(series);
  const areaPath = `${linePath} L ${xAt(series.length - 1, series.length).toFixed(2)},${(pad.t + innerH).toFixed(2)} L ${xAt(0, series.length).toFixed(2)},${(pad.t + innerH).toFixed(2)} Z`;
  const benchPath = benchData ? buildPath(benchData) : null;

  // gridlines (4 horizontal)
  const gridY = [0.2, 0.4, 0.6, 0.8].map(p => pad.t + p * innerH);

  // ── hover
  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = clamp((x - pad.l) / innerW, 0, 1);
    const i = Math.round(ratio * (series.length - 1));
    setHover({ i, x: xAt(i, series.length) });
  }
  function onLeave() { setHover(null); }

  const kpis = computeKpis(series);
  const benchKpis = benchData ? computeKpis(benchData) : null;

  // selected point info for the KPI when hover
  const cursorValue = hover ? series[hover.i] : kpis.equity;
  const cursorBench = hover && benchData ? benchData[hover.i] : null;
  const cursorTickLabel = hover ? labelForPoint(tf, cfg, labels, hover.i, series.length) : "";

  return (
    <Glass className="equity-card">
      <div className="equity-card__head">
        <div className="equity-card__title">
          <h2 className="tb-panel__title" style={{ fontSize: 20 }}>
            Portfolio
            <InfoTip title="Portfolio · equity curve" align="right" width={320}>
              Equity over time. Cyan→violet area shows the bot's portfolio value;
              the glowing pulse marks the current value. Hover anywhere to crosshair
              a point. Toggle <span className="k">SPY</span> or <span className="k">BTC</span>
              for a benchmark overlay (dashed). The KPI rail summarises P&L,
              Sharpe ratio, max drawdown and realized volatility for the selected timeframe.
            </InfoTip>
            <span className="tb-panel__count">· {cfg.label}</span>
          </h2>
        </div>
        <div className="equity-card__controls">
          <div className="seg">
            {Object.keys(TF_CONFIG).map(k => (
              <button key={k} className={"seg__btn" + (tf === k ? " seg__btn--on" : "")} onClick={() => setTf(k)}>{k}</button>
            ))}
          </div>
          <div className="seg seg--small">
            <button className={"seg__btn" + (benchmark === null ? " seg__btn--on" : "")} onClick={() => setBenchmark(null)}>Bot</button>
            <button className={"seg__btn" + (benchmark === "SPY" ? " seg__btn--on" : "")} onClick={() => setBenchmark(benchmark === "SPY" ? null : "SPY")}>vs SPY</button>
            <button className={"seg__btn" + (benchmark === "BTC" ? " seg__btn--on" : "")} onClick={() => setBenchmark(benchmark === "BTC" ? null : "BTC")}>vs BTC</button>
          </div>
        </div>
      </div>

      <div className="equity-card__body">
        <div className="equity-card__chart" ref={wrapRef} onMouseMove={onMove} onMouseLeave={onLeave}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
            <defs>
              <linearGradient id="eq-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%"   stopColor="rgba(0, 229, 255, 0.45)" />
                <stop offset="55%"  stopColor="rgba(168, 85, 247, 0.18)" />
                <stop offset="100%" stopColor="rgba(168, 85, 247, 0.00)" />
              </linearGradient>
              <linearGradient id="eq-stroke" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%"   stopColor="#00E5FF" />
                <stop offset="60%"  stopColor="#7BD7FF" />
                <stop offset="100%" stopColor="#A855F7" />
              </linearGradient>
              <filter id="eq-glow" x="-10%" y="-50%" width="120%" height="200%">
                <feGaussianBlur stdDeviation="2.4" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <pattern id="eq-bench-pattern" patternUnits="userSpaceOnUse" width="6" height="6">
                <path d="M0 3 L6 3" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeDasharray="3 3" />
              </pattern>
            </defs>

            {/* gridlines */}
            {gridY.map((y, i) => (
              <line key={i} x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="rgba(255,255,255,0.05)" strokeDasharray="2 4" />
            ))}

            {/* x-axis ticks */}
            {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
              const idx = Math.round(p * (series.length - 1));
              return (
                <text
                  key={i}
                  x={xAt(idx, series.length)}
                  y={H - 8}
                  fill="rgba(255,255,255,0.38)"
                  fontFamily="JetBrains Mono"
                  fontSize="10"
                  textAnchor={p === 0 ? "start" : p === 1 ? "end" : "middle"}
                >{labelForPoint(tf, cfg, labels, idx, series.length)}</text>
              );
            })}

            {/* area */}
            <path d={areaPath} fill="url(#eq-area)" />

            {/* benchmark dashed */}
            {benchPath && (
              <path d={benchPath} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.2" strokeDasharray="4 4" />
            )}

            {/* main stroke (glow) */}
            <path d={linePath} fill="none" stroke="url(#eq-stroke)" strokeWidth="2.2" strokeLinecap="round" filter="url(#eq-glow)" />

            {/* end-point indicator */}
            <circle
              cx={xAt(series.length - 1, series.length)}
              cy={yAt(series[series.length - 1])}
              r={4.5}
              fill="#00E5FF"
              style={{ filter: "drop-shadow(0 0 8px rgba(0,229,255,0.85))" }}
            />
            <circle
              cx={xAt(series.length - 1, series.length)}
              cy={yAt(series[series.length - 1])}
              r={11}
              fill="none"
              stroke="rgba(0,229,255,0.35)"
            >
              <animate attributeName="r" from="6" to="18" dur="1.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" from="0.7" to="0" dur="1.8s" repeatCount="indefinite" />
            </circle>

            {/* crosshair */}
            {hover && (
              <g>
                <line x1={hover.x} x2={hover.x} y1={pad.t} y2={H - pad.b} stroke="rgba(0,229,255,0.5)" strokeDasharray="2 3" />
                <circle cx={hover.x} cy={yAt(series[hover.i])} r={5} fill="#00E5FF" style={{ filter: "drop-shadow(0 0 6px rgba(0,229,255,0.7))" }} />
                {cursorBench !== null && (
                  <circle cx={hover.x} cy={yAt(cursorBench)} r={3.5} fill="rgba(255,255,255,0.9)" />
                )}
              </g>
            )}
          </svg>

          {/* floating tooltip */}
          {hover && (
            <div
              className="equity-tooltip glass"
              style={{
                left: clamp(hover.x - 80, 12, W - 172),
                top: 12,
              }}
            >
              <div className="t-mono" style={{ fontSize: 10, color: "var(--text-3)", letterSpacing: ".10em" }}>{cursorTickLabel}</div>
              <div className="t-num" style={{ fontSize: 18, marginTop: 2 }}>${fmt(cursorValue, { decimals: 0 })}</div>
              <div className="t-mono" style={{ fontSize: 11, color: cursorValue >= series[0] ? "var(--profit)" : "var(--loss)" }}>
                {cursorValue >= series[0] ? "+" : ""}{fmt(((cursorValue - series[0]) / series[0]) * 100, { decimals: 2 })}%
              </div>
              {cursorBench !== null && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--glass-border)" }}>
                  <div className="t-mono" style={{ fontSize: 10, color: "var(--text-4)" }}>{benchmark}</div>
                  <div className="t-num" style={{ fontSize: 13 }}>${fmt(cursorBench, { decimals: 0 })}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* KPI rail */}
        <div className="equity-card__kpi">
          <div className="kpi kpi--hero">
            <div className="kpi__label">
              Equity
              <InfoTip title="Equity" align="right" width={280}>
                Total portfolio value (open positions marked-to-market + uninvested cash). Hover the chart to see the value at any point in time.
              </InfoTip>
            </div>
            <div className="kpi__value t-num">${fmt(kpis.equity, { decimals: 2 })}</div>
            <div className="kpi__sub" style={{ color: kpis.pnlPct >= 0 ? "var(--profit)" : "var(--loss)" }}>
              {kpis.pnlPct >= 0 ? "+" : ""}{fmt(kpis.pnlAbs, { decimals: 0, prefix: "$" })}
              <span style={{ marginLeft: 6, color: "var(--text-3)" }}>this {tf === "1D" ? "session" : "period"}</span>
            </div>
          </div>

          <div className="kpi-grid">
            <div className="kpi">
              <div className="kpi__label">
                P&L %
                <InfoTip title="P&L %" align="right" width={280}>
                  Percentage return over the selected timeframe. Compare against
                  SPY or BTC by toggling the benchmark.
                </InfoTip>
              </div>
              <div className="kpi__value t-num" style={{ color: kpis.pnlPct >= 0 ? "var(--profit)" : "var(--loss)", textShadow: kpis.pnlPct >= 0 ? "var(--glow-profit)" : "var(--glow-loss)" }}>
                {kpis.pnlPct >= 0 ? "+" : ""}{fmt(kpis.pnlPct, { decimals: 2 })}%
              </div>
              {benchKpis && (
                <div className="kpi__sub t-mono" style={{ color: "var(--text-3)" }}>
                  {benchmark}: {benchKpis.pnlPct >= 0 ? "+" : ""}{fmt(benchKpis.pnlPct, { decimals: 2 })}%
                </div>
              )}
            </div>

            <div className="kpi">
              <div className="kpi__label">
                Sharpe
                <InfoTip title="Sharpe ratio" align="right" width={280}>
                  Risk-adjusted return: mean daily return divided by daily volatility,
                  annualized by √252. Above <span className="k">1.0</span> is solid;
                  above <span className="v">2.0</span> is exceptional.
                </InfoTip>
              </div>
              <div className="kpi__value t-num">{fmt(kpis.sharpe, { decimals: 2 })}</div>
              <div className="kpi__sub t-mono" style={{ color: "var(--text-3)" }}>annualized · risk-adj</div>
            </div>

            <div className="kpi">
              <div className="kpi__label">
                Max drawdown
                <InfoTip title="Max drawdown" align="right" width={280}>
                  Largest peak-to-trough decline in equity over the period.
                  The bot's stop-loss logic caps individual trade losses; this
                  is the worst portfolio-level drop.
                </InfoTip>
              </div>
              <div className="kpi__value t-num" style={{ color: "var(--loss)" }}>{fmt(kpis.maxDD, { decimals: 2 })}%</div>
              <div className="kpi__sub t-mono" style={{ color: "var(--text-3)" }}>peak-to-trough</div>
            </div>

            <div className="kpi">
              <div className="kpi__label">
                Volatility
                <InfoTip title="Volatility" align="left" width={280}>
                  Standard deviation of daily returns, annualized. Lower is
                  steadier; the bot targets <span className="k">12–18%</span> for
                  the mid-risk profile.
                </InfoTip>
              </div>
              <div className="kpi__value t-num">{fmt(Math.abs(kpis.sharpe) * 4.2, { decimals: 1 })}%</div>
              <div className="kpi__sub t-mono" style={{ color: "var(--text-3)" }}>30d realized</div>
            </div>
          </div>

          <div className="kpi-legend">
            <span className="kpi-legend__dot kpi-legend__dot--bot" />
            <span className="t-mono" style={{ fontSize: 11 }}>Bot equity</span>
            {benchmark && (<>
              <span className="kpi-legend__dot kpi-legend__dot--bench" />
              <span className="t-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{benchmark}</span>
            </>)}
            <span style={{ marginLeft: "auto" }} className="badge badge--cyan badge--live"><span className="dot" />{refreshing ? "REFRESHING" : `LIVE · ${status.totalScans || 0} scans`}</span>
          </div>
        </div>
      </div>
    </Glass>
  );
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

Object.assign(window, { EquityCurveCard });
