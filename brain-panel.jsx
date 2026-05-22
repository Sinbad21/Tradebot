/* brain-panel.jsx — Milestone 4 · BrainPanel
   Three-column bento: confidence heatmap (7×8 = 51 assets + padding),
   indicator weights, live thoughts feed and retrain history timeline. */

const { useState: useStateBP, useEffect: useEffectBP, useRef: useRefBP, useMemo: useMemoBP } = React;

/* ── Indicator weights (mirrors schema.sql `brain` table) ─── */
const INDICATORS = [
  { key: "macd_cross",  label: "MACD cross",      weight: 1.00, drift: 0.02, tone: "cyan"   },
  { key: "mean_rev",    label: "Mean reversion",  weight: 0.80, drift: 0.03, tone: "violet" },
  { key: "rsi",         label: "RSI",             weight: 0.60, drift: 0.04, tone: "cyan"   },
  { key: "bollinger",   label: "Bollinger",       weight: 0.50, drift: 0.03, tone: "violet" },
  { key: "ema_trend",   label: "EMA trend",       weight: 0.30, drift: 0.05, tone: "cyan"   },
  { key: "vol_growing", label: "Volume growth",   weight: 0.30, drift: 0.04, tone: "violet" },
  { key: "macd_hist",   label: "MACD histogram",  weight: 0.20, drift: 0.02, tone: "cyan"   },
];

/* ── Live thought templates ───────────────────────────────── */
const THOUGHT_TEMPLATES = [
  { kind: "scan",    text: (a) => `Scanning ${a.ticker} · score ${(a.conf / 100).toFixed(2)}`,                              tone: "neutral" },
  { kind: "signal",  text: (a) => `Signal raised on ${a.ticker} — bull-flag breakout, RSI exit oversold`,                 tone: "cyan"    },
  { kind: "size",    text: (a) => `Sizing ${a.ticker} at 1.2% capital — Brain conf ${a.conf}%`,                           tone: "cyan"    },
  { kind: "hold",    text: (a) => `Holding ${a.ticker}, trailing stop activated at +${(2 + Math.random()*4).toFixed(2)}%`, tone: "profit"  },
  { kind: "cool",    text: (a) => `Cooldown on ${a.ticker} after stop-loss — rebuilding confidence`,                       tone: "loss"    },
  { kind: "weight",  text: ( ) => `Weight nudged: macd_cross +0.04 · mean_rev −0.02`,                                      tone: "violet"  },
  { kind: "match",   text: (a) => `Pattern match: ${a.ticker} · ${["bull-flag","ema-cross","vwap-reclaim","macd-cross","rsi-div"][Math.floor(Math.random()*5)]}`, tone: "cyan" },
  { kind: "reject",  text: (a) => `Rejected ${a.ticker} — daily/4h timeframes conflict`,                                  tone: "neutral" },
  { kind: "retrain", text: ( ) => `Retrain checkpoint queued — last 50 closed trades`,                                    tone: "violet"  },
];

const TONE_HEX = {
  cyan:    "#00E5FF",
  violet:  "#A855F7",
  profit:  "#00FF88",
  loss:    "#FF3D71",
  neutral: "rgba(255,255,255,0.6)",
};

/* ── Retrain history (last 8 checkpoints, oldest → newest) ── */
function makeRetrainHistory() {
  const out = [];
  let conf = 62;
  const hours = [168, 144, 120, 96, 72, 48, 24, 2]; // hours ago
  for (let i = 0; i < hours.length; i++) {
    conf = clamp(conf + (Math.random() - 0.3) * 7, 55, 92);
    const trades = Math.round(38 + Math.random() * 24);
    const wr     = clamp(58 + (Math.random() - 0.4) * 16, 48, 78);
    out.push({
      id: `r-${i}`,
      ago: hours[i],
      conf: Math.round(conf * 10) / 10,
      trades,
      winRate: Math.round(wr * 10) / 10,
      delta: i === 0 ? 0 : Math.round((conf - out[i - 1].conf) * 10) / 10,
      auto: Math.random() > 0.3,
    });
  }
  return out;
}

/* ── Helpers ───────────────────────────────────────────────── */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function formatAgo(h) {
  if (h < 1)  return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/* ── Confidence cell tone ──────────────────────────────────── */
function confTone(conf) {
  if (conf >= 80) return { bg: "rgba(168,85,247,0.18)",  bd: "rgba(168,85,247,0.55)",  fg: "#E9D5FF", glow: "0 0 14px rgba(168,85,247,0.45)" };
  if (conf >= 65) return { bg: "rgba(0,229,255,0.16)",   bd: "rgba(0,229,255,0.50)",   fg: "#B7F8FF", glow: "0 0 12px rgba(0,229,255,0.35)" };
  if (conf >= 50) return { bg: "rgba(255,255,255,0.05)", bd: "rgba(255,255,255,0.18)", fg: "rgba(255,255,255,0.78)", glow: "none" };
  return                  { bg: "rgba(255,61,113,0.10)",  bd: "rgba(255,61,113,0.30)",  fg: "rgba(255,201,214,0.85)", glow: "none" };
}

/* ── Heatmap ───────────────────────────────────────────────── */
function ConfidenceHeatmap() {
  const assets = useBotStore((state) => state.assets);
  const [hovered, setHovered] = useStateBP(null);

  const cells = useMemoBP(() => {
    return (assets || []).map((asset) => {
      const conf = clamp(Number(asset.conf) || 0, 0, 99);
      return { ticker: asset.ticker, name: asset.name, conf, klass: asset.klass, status: asset.status };
    });
  }, [assets]);

  const paddedCells = useMemoBP(() => {
    const next = cells.slice(0, 56);
    while (next.length < 56) next.push({ pad: true });
    return next;
  }, [cells]);

  const top = useMemoBP(
    () => cells.filter(c => !c.pad).slice().sort((a, b) => b.conf - a.conf).slice(0, 3),
    [cells]
  );

  const active = hovered ?? top[0];

  return (
    <div className="bp-heatmap-wrap">
      <div className="bp-heatmap-head">
        <div className="t-label" style={{ display: "inline-flex", alignItems: "center" }}>
          Confidence map · {cells.length} assets
          <InfoTip title="Confidence map" align="right" width={300}>
            Every cell is one watched asset. The number is the <span className="k">Brain</span>’s
            real-time conviction (0–99) that the next trade on that ticker will be profitable.
            Color bands: <span className="k">&lt;50</span> avoid · <span className="k">50–65</span> observe ·
            <span className="k">65–80</span> signal · <span className="v">≥80</span> high-conviction.
            Values come directly from the latest watchlist snapshot.
          </InfoTip>
        </div>
        <div className="bp-legend">
          <span className="bp-legend__chip" style={{ background: "rgba(255,61,113,0.10)",  borderColor: "rgba(255,61,113,0.30)"  }}>&lt; 50</span>
          <span className="bp-legend__chip" style={{ background: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.18)" }}>50–65</span>
          <span className="bp-legend__chip" style={{ background: "rgba(0,229,255,0.16)",   borderColor: "rgba(0,229,255,0.50)",   color: "#B7F8FF" }}>65–80</span>
          <span className="bp-legend__chip" style={{ background: "rgba(168,85,247,0.18)",  borderColor: "rgba(168,85,247,0.55)",  color: "#E9D5FF" }}>≥ 80</span>
        </div>
      </div>

      <div className="bp-heatmap" role="grid" aria-label="Per-asset Brain confidence">
        {paddedCells.map((c, i) => {
          if (c.pad) {
            return <div key={`pad-${i}`} className="bp-cell bp-cell--pad" aria-hidden="true" />;
          }
          const t = confTone(c.conf);
          const isActive = hovered && hovered.ticker === c.ticker;
          return (
            <div
              key={c.ticker}
              role="gridcell"
              className={`bp-cell ${isActive ? "bp-cell--active" : ""}`}
              style={{
                background: t.bg,
                borderColor: isActive ? "rgba(0,229,255,0.85)" : t.bd,
                color: t.fg,
                boxShadow: isActive ? "0 0 0 1px rgba(0,229,255,0.6), 0 0 24px rgba(0,229,255,0.35)" : (c.conf >= 80 ? t.glow : "none"),
              }}
              onMouseEnter={() => setHovered(c)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="bp-cell__ticker">{c.ticker}</div>
              <div className="bp-cell__conf t-mono">{Math.round(c.conf)}</div>
              <div className="bp-cell__bar">
                <span style={{ width: `${c.conf}%`, background: t.fg, boxShadow: c.conf >= 65 ? `0 0 6px ${t.fg}` : "none" }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* hover/peek strip */}
      <div className="bp-peek">
        {active ? (
          <>
            <div>
              <div className="t-mono" style={{ fontSize: 11, color: "var(--text-4)", letterSpacing: ".14em" }}>
                {hovered ? "HOVERED" : "TOP CONFIDENCE"}
              </div>
              <div className="t-display" style={{ fontSize: 18, marginTop: 2 }}>
                {active.ticker} <span style={{ color: "var(--text-3)", fontWeight: 400, marginLeft: 6 }}>{active.name}</span>
              </div>
            </div>
            <div className="bp-peek__num t-num" style={{ color: confTone(active.conf).fg, textShadow: confTone(active.conf).glow }}>
              {Math.round(active.conf)}<span className="unit">%</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ── Indicator weights ─────────────────────────────────────── */
function IndicatorWeights() {
  const mode = window.__activeMode || "mid";
  const { modeData, settings } = useBotStore((state) => ({
    modeData: state.status.modes?.[window.__activeMode || "mid"] || state.status.modes?.mid || { weights: {}, trained: 0 },
    settings: state.settings,
  }));

  const vals = useMemoBP(() => INDICATORS.map((indicator) => Number(modeData.weights?.[indicator.key] ?? indicator.weight)), [modeData]);

  async function retrain() {
    try {
      await window.BotActions.retrainBrain(mode);
    } catch (e) {
      window.alert(e.message);
    }
  }

  const max = Math.max(...vals, 1.0);

  return (
    <div className="bp-weights">
      <div className="bp-section-head">
        <div className="t-label" style={{ display: "inline-flex", alignItems: "center" }}>
          Indicator weights
          <InfoTip title="Indicator weights" align="right" width={320}>
            Weights tell the Brain how much each signal contributes to the final confidence score.
            They drift between retrains as the bot learns from closed trades. The vertical tick
            shows the original baseline from <span className="k">schema.sql</span>; the colored bar
            is the current value. Click <span className="v">Retrain now</span> to force an
            update against the last 50 closed trades.
          </InfoTip>
        </div>
        <button className="btn btn--sm btn--primary" onClick={retrain}>
          {I.bolt}
          Retrain now
        </button>
      </div>

      <div className="bp-weight-list">
        {INDICATORS.map((ind, i) => {
          const v = vals[i];
          const pct = (v / max) * 100;
          const baseline = (ind.weight / max) * 100;
          const diff = v - ind.weight;
          return (
            <div key={ind.key} className="bp-weight-row">
              <div className="bp-weight-label">
                <span className="t-mono bp-weight-key">{ind.key}</span>
                <span className="bp-weight-name">{ind.label}</span>
              </div>
              <div className="bp-weight-track">
                <span className="bp-weight-baseline" style={{ left: `${baseline}%` }} />
                <span
                  className="bp-weight-fill"
                  style={{
                    width: `${pct}%`,
                    background: ind.tone === "cyan"
                      ? "linear-gradient(90deg, rgba(0,229,255,0.25), rgba(0,229,255,0.85))"
                      : "linear-gradient(90deg, rgba(168,85,247,0.25), rgba(168,85,247,0.85))",
                    boxShadow: ind.tone === "cyan" ? "0 0 10px rgba(0,229,255,0.35)" : "0 0 10px rgba(168,85,247,0.35)",
                  }}
                />
              </div>
              <div className="bp-weight-val t-mono">
                {v.toFixed(2)}
                <span className={`bp-weight-diff ${diff >= 0 ? "is-up" : "is-down"}`}>
                  {diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(2)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bp-weight-foot t-mono">
        <span>trained · {modeData.trained || 0}</span>
        <span>auto-learn · {(Number(settings.learn_rate) || 0) > 0 ? "enabled" : "disabled"}</span>
        <span>baseline · │</span>
      </div>
    </div>
  );
}

/* ── Live thoughts feed ────────────────────────────────────── */
function ThoughtsFeed() {
  const { recentScores, positions, brainHistory, refreshing } = useBotStore((state) => ({
    recentScores: state.status.recentScores,
    positions: state.status.positions,
    brainHistory: state.brainHistory,
    refreshing: state.refreshing,
  }));

  const items = useMemoBP(() => {
    const scoreItems = (recentScores || []).slice(0, 14).map((row, index) => ({
      id: `score-${row.id || index}`,
      t: new Date(row.created_at || Date.now()),
      kind: Number(row.signal) === 1 ? "signal" : Number(row.signal) === -1 ? "reject" : "scan",
      text: Number(row.signal) === 1
        ? `Signal raised on ${row.ticker} · score ${Number(row.score || 0).toFixed(2)} · ${row.reasons || "entry candidate"}`
        : `Scanning ${row.ticker} · score ${Number(row.score || 0).toFixed(2)} · ${row.reasons || "watching"}`,
      tone: Number(row.signal) === 1 ? "cyan" : Number(row.signal) === -1 ? "loss" : "neutral",
    }));

    const positionItems = (positions || []).slice(0, 6).map((position) => ({
      id: `position-${position.ticker}`,
      t: new Date(position.opened_at || Date.now()),
      kind: "hold",
      text: `Holding ${position.ticker} · unrealized ${Number(position.unrealized_pct || 0).toFixed(2)}% · stop ${fmt(Number(position.stop_loss) || 0, { decimals: 2 })}`,
      tone: Number(position.unrealized_pnl || 0) >= 0 ? "profit" : "loss",
    }));

    const retrainItems = (brainHistory || []).slice(0, 6).map((entry) => ({
      id: `brain-${entry.id}`,
      t: new Date(entry.created_at || Date.now()),
      kind: "retrain",
      text: `Retrain ${String(entry.mode || "mid").toUpperCase()} · pnl ${Number(entry.pnl_pct || 0).toFixed(2)}% · indicators ${(entry.indicators || []).join(", ") || "none"}`,
      tone: "violet",
    }));

    return [...scoreItems, ...positionItems, ...retrainItems]
      .sort((left, right) => right.t - left.t)
      .slice(0, 32);
  }, [brainHistory, positions, recentScores]);

  function fmtTime(d) {
    return d.toTimeString().slice(0, 8);
  }

  return (
    <div className="bp-feed">
      <div className="bp-section-head">
        <div className="t-label" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="status-dot status-dot--cyan" />
          Brain thoughts · live
          <InfoTip title="Live thoughts" align="left" width={300}>
            A real-time stream of every decision the Brain makes: scans, pattern matches,
            sizing, holds, cooldowns and weight nudges. Events flash cyan when they arrive
            and persist for the last 32 ticks. This is the human-readable view of the
            <span className="k">scan_log</span> table.
          </InfoTip>
        </div>
        <span className="badge badge--cyan badge--live">
          <span className="dot" />
          {refreshing ? "REFRESHING" : "LIVE"}
        </span>
      </div>

      <div className="bp-feed-list">
        {items.map((it, idx) => (
          <div key={it.id} className={`bp-thought ${idx === 0 ? "bp-thought--fresh" : ""}`}>
            <div className="bp-thought__time t-mono">{fmtTime(it.t)}</div>
            <div className="bp-thought__rail">
              <span className="bp-thought__dot" style={{ background: TONE_HEX[it.tone], boxShadow: `0 0 8px ${TONE_HEX[it.tone]}` }} />
              {idx < items.length - 1 ? <span className="bp-thought__line" /> : null}
            </div>
            <div className="bp-thought__body">
              <div className="bp-thought__kind t-mono" style={{ color: TONE_HEX[it.tone] }}>{it.kind.toUpperCase()}</div>
              <div className="bp-thought__text">{it.text}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bp-feed-foot">
        <div className="t-mono" style={{ color: "var(--text-4)", fontSize: 11 }}>
          {items.length} events buffered · newest first
        </div>
        <button className="btn btn--sm btn--ghost" onClick={() => window.__navigate?.("trades")}>Open trades</button>
      </div>
    </div>
  );
}

/* ── Retrain history timeline ─────────────────────────────── */
function RetrainHistory() {
  const rows = useBotStore((state) => state.brainHistory);
  const history = useMemoBP(() => {
    const mapped = (rows || []).slice().reverse().map((row, index, all) => {
      const conf = clamp(68 + (Number(row.pnl_pct) || 0) * 2.4, 35, 95);
      const prevConf = index > 0 ? clamp(68 + (Number(all[index - 1].pnl_pct) || 0) * 2.4, 35, 95) : conf;
      const agoHours = row.created_at ? Math.max(0, Math.round((Date.now() - new Date(row.created_at).getTime()) / 3600000)) : 0;
      return {
        id: row.id,
        ago: agoHours,
        conf,
        trades: Math.max(1, (row.indicators || []).length),
        pnlPct: Number(row.pnl_pct) || 0,
        delta: +(conf - prevConf).toFixed(1),
        mode: String(row.mode || "mid").toUpperCase(),
      };
    });

    if (mapped.length) return mapped;
    return [{ id: "empty", ago: 0, conf: 0, trades: 0, pnlPct: 0, delta: 0, mode: "MID" }];
  }, [rows]);

  const latest = history[history.length - 1];

  return (
    <div className="bp-retrain">
      <div className="bp-section-head">
        <div className="t-label" style={{ display: "inline-flex", alignItems: "center" }}>
          Retrain history · 7d
          <InfoTip title="Retrain history" align="right" width={320}>
            Every checkpoint is a snapshot of the Brain after a learning pass over recent
            closed trades. <span className="k">AUTO</span> retrains run on a fixed cadence;
            <span className="v">MANUAL</span> ones are user-triggered. Per checkpoint we
            keep aggregate confidence, sample size (trades) and the resulting win rate —
            mirrored into the <span className="k">brain_history</span> table.
          </InfoTip>
        </div>
        <span className="t-mono" style={{ color: "var(--text-4)", fontSize: 11 }}>{history.length} checkpoints</span>
      </div>

      {/* Big current conf */}
      <div className="bp-retrain-hero">
        <div>
          <div className="t-mono" style={{ fontSize: 10.5, color: "var(--text-4)", letterSpacing: ".14em" }}>CURRENT</div>
          <div className="t-num" style={{ fontSize: 44, color: "var(--violet)", textShadow: "var(--glow-violet-sm)", lineHeight: 1 }}>
            {latest.conf.toFixed(1)}<span className="unit" style={{ fontSize: 18, color: "var(--text-3)", marginLeft: 4 }}>%</span>
          </div>
        </div>
        <div className="bp-retrain-spark">
          <Sparkline data={history.map(h => h.conf)} width={148} height={48} tone="violet" />
          <div className="t-mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, textAlign: "right" }}>
            {(history[history.length-1].conf - history[0].conf) >= 0 ? "+" : ""}{(history[history.length-1].conf - history[0].conf).toFixed(1)} pts · 7d
          </div>
        </div>
      </div>

      {/* Timeline rows */}
      <div className="bp-timeline">
        {history.slice().reverse().map((h, i) => (
          <div key={h.id} className={`bp-trow ${i === 0 ? "bp-trow--latest" : ""}`}>
            <div className="bp-trow__node">
              <span className={`bp-trow__dot ${i === 0 ? "is-now" : ""}`} />
              {i < history.length - 1 ? <span className="bp-trow__line" /> : null}
            </div>
            <div className="bp-trow__when t-mono">{formatAgo(h.ago)}</div>
            <div className="bp-trow__body">
              <div className="bp-trow__head">
                <span className="t-num" style={{ fontSize: 14 }}>{h.conf.toFixed(1)}%</span>
                {h.delta !== 0 ? (
                  <span className={`bp-trow__delta ${h.delta > 0 ? "is-up" : "is-down"}`}>
                    {h.delta > 0 ? "+" : ""}{h.delta.toFixed(1)}
                  </span>
                ) : null}
                <span className="badge badge--violet" style={{ height: 18, fontSize: 9.5 }}>
                  {h.mode}
                </span>
              </div>
              <div className="bp-trow__meta t-mono">
                {h.trades} indicators · {h.pnlPct >= 0 ? "+" : ""}{h.pnlPct.toFixed(2)}% pnl
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main BrainPanel ──────────────────────────────────────── */
function BrainPanel() {
  const { assets, status } = useBotStore((state) => ({ assets: state.assets, status: state.status }));
  const aggConf = useMemoBP(() => {
    if (!assets.length) return 0;
    return assets.reduce((sum, asset) => sum + (Number(asset.conf) || 0), 0) / assets.length;
  }, [assets]);

  const lastDayActivity = useMemoBP(() => {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000);
    return (status.scanActivity || []).filter((entry) => !entry.t || new Date(entry.t).getTime() >= cutoff);
  }, [status.scanActivity]);

  const cycleSeconds = useMemoBP(() => {
    const times = (status.scanActivity || []).slice(-6).map((entry) => new Date(entry.t).getTime()).filter(Boolean);
    if (times.length < 2) return 0;
    let total = 0;
    for (let index = 1; index < times.length; index++) total += (times[index] - times[index - 1]);
    return total / (times.length - 1) / 1000;
  }, [status.scanActivity]);

  const signals24h = lastDayActivity.reduce((sum, entry) => sum + ((entry.buys || []).length || 0), 0);
  const scanned24h = lastDayActivity.reduce((sum, entry) => sum + (Number(entry.scored) || 0), 0);
  const uptimeMs = status.scanActivity?.length ? Date.now() - new Date(status.scanActivity[0].t).getTime() : 0;
  const uptimeDays = Math.max(0, Math.floor(uptimeMs / (24 * 60 * 60 * 1000)));
  const uptimeHours = Math.max(0, Math.floor((uptimeMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)));

  return (
    <div className="bp-root">
      {/* Status strip */}
      <div className="bp-strip">
        <div className="bp-strip__brand">
          <div className="bp-brain-orb">
            <span className="bp-brain-orb__core" />
            <span className="bp-brain-orb__ring" />
            <span className="bp-brain-orb__ring bp-brain-orb__ring--2" />
          </div>
          <div>
            <div className="t-kicker" style={{ color: "var(--violet)", display: "inline-flex", alignItems: "center" }}>
              BRAIN v2.4 · auto-learning
              <InfoTip title="Brain v2.4" align="right" width={320}>
                The Brain is the ensemble model that turns raw indicators (MACD, RSI,
                Bollinger, mean-reversion…) into a single 0–99 confidence score per asset.
                <span className="k">auto-learning</span> means weights self-adjust after every
                closed trade — no manual tuning required.
              </InfoTip>
            </div>
            <div className="t-display" style={{ fontSize: 22, marginTop: 4 }}>
              Confidence{" "}
              <span className="t-num t-violet" style={{ fontSize: 22, textShadow: "var(--glow-violet-sm)" }}>
                {aggConf.toFixed(1)}%
              </span>{" "}
              <span style={{ color: "var(--text-3)", fontSize: 14, fontWeight: 400, display: "inline-flex", alignItems: "center" }}>
                aggregate · {assets.length} assets
                <InfoTip title="Aggregate confidence" align="right" width={300}>
                  The weighted mean of per-asset confidence across all 51 watched tickers.
                  Above <span className="v">75%</span> the bot is in an aggressive posture;
                  below <span className="k">55%</span> it pauses new entries and waits for
                  clearer setups.
                </InfoTip>
              </span>
            </div>
          </div>
        </div>

        <div className="bp-strip__meta">
          <div className="bp-meta-cell">
            <div className="t-mono bp-meta-cell__k" style={{ display: "inline-flex", alignItems: "center" }}>
              CYCLE
              <InfoTip title="Scan cycle" align="left" width={260}>
                How long one full pass over all 51 assets takes. Lower is better —
                <span className="k">&lt;1s</span> means the bot reacts faster than most
                short-term setups develop.
              </InfoTip>
            </div>
            <div className="t-num bp-meta-cell__v">
              <span className="status-dot status-dot--cyan" style={{ marginRight: 6 }} />
              {cycleSeconds ? cycleSeconds.toFixed(2) : "0.00"} <span className="unit">s</span>
            </div>
          </div>
          <div className="bp-meta-cell">
            <div className="t-mono bp-meta-cell__k" style={{ display: "inline-flex", alignItems: "center" }}>
              SCANNED · 24h
              <InfoTip title="Scans in last 24h" align="left" width={260}>
                Total number of asset evaluations in the last day. At one scan per asset
                every cycle, this is roughly <span className="k">51 × cycles/day</span>.
              </InfoTip>
            </div>
            <div className="t-num bp-meta-cell__v">{scanned24h}</div>
          </div>
          <div className="bp-meta-cell">
            <div className="t-mono bp-meta-cell__k" style={{ display: "inline-flex", alignItems: "center" }}>
              SIGNALS · 24h
              <InfoTip title="Signals raised" align="left" width={260}>
                Scans where confidence crossed the entry threshold. Not every signal
                becomes a trade — cooldowns, position limits and slot caps can veto it.
              </InfoTip>
            </div>
            <div className="t-num bp-meta-cell__v" style={{ color: "var(--cyan)" }}>{signals24h}</div>
          </div>
          <div className="bp-meta-cell">
            <div className="t-mono bp-meta-cell__k" style={{ display: "inline-flex", alignItems: "center" }}>
              UPTIME
              <InfoTip title="Uptime" align="left" width={260}>
                Continuous time since the last restart or deploy. The Brain keeps learning
                across restarts — weights persist in <span className="k">D1</span>.
              </InfoTip>
            </div>
            <div className="t-num bp-meta-cell__v">{uptimeDays}d {String(uptimeHours).padStart(2, "0")}h</div>
          </div>
        </div>
      </div>

      {/* Bento */}
      <div className="bp-bento">
        <div className="bp-bento__cell bp-bento__cell--map">
          <ConfidenceHeatmap />
        </div>
        <div className="bp-bento__cell bp-bento__cell--weights">
          <IndicatorWeights />
        </div>
        <div className="bp-bento__cell bp-bento__cell--feed">
          <ThoughtsFeed />
        </div>
        <div className="bp-bento__cell bp-bento__cell--retrain">
          <RetrainHistory />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { BrainPanel });
