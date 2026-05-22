/* trade-history.jsx — Full Trades screen (M5)
   Stat strip · daily P&L bars · filterable table · expandable TradeCard */

const { useState: useStateTH, useMemo: useMemoTH, useEffect: useEffectTH } = React;

const REASON_TONE = {
  TAKE_PROFIT: "profit",
  STOP_LOSS: "loss",
  TRAILING_STOP: "cyan",
  BRAIN_EXIT: "violet",
  PATTERN_INVALIDATED: "amber",
  MANUAL: "neutral",
};
const BRAIN_NOTES = {
  TAKE_PROFIT: "Brain hit take-profit target. RSI in overbought territory, sell pressure increasing on the order book.",
  STOP_LOSS: "Hard stop-loss triggered. Pattern invalidated below the entry support; Brain cuts losses to protect capital.",
  TRAILING_STOP: "Trailing stop activated after the move. Brain locked in unrealized P&L as momentum slowed.",
  BRAIN_EXIT: "Brain flagged a regime shift — confluence of indicators turned negative before the stop-loss was hit.",
  PATTERN_INVALIDATED: "The bull-flag breakout failed to hold. Brain closes proactively to avoid full stop-loss.",
  MANUAL: "Operator-initiated close from the dashboard.",
};

function fmtClock(d) {
  const t = d.toTimeString().slice(0, 5);
  const day = d.toDateString().slice(4, 10);
  return { t, day };
}

/* ── Daily P&L bar chart ─────────────────────────────────── */
function DailyPnlChart({ trades, days = 30 }) {
  // sum pnl per day
  const buckets = useMemoTH(() => {
    const map = new Map();
    trades.forEach(t => {
      const key = t.daysAgo;
      map.set(key, (map.get(key) || 0) + t.pnl);
    });
    const arr = [];
    for (let d = days - 1; d >= 0; d--) {
      arr.push({ daysAgo: d, pnl: map.get(d) || 0 });
    }
    return arr;
  }, [trades, days]);

  const maxAbs = Math.max(...buckets.map(b => Math.abs(b.pnl)), 1);
  const total  = buckets.reduce((s, b) => s + b.pnl, 0);

  return (
    <div className="th-pnl-chart">
      <div className="th-pnl-chart__head">
        <div>
          <div className="t-mono" style={{ fontSize: 10, color: "var(--text-4)", letterSpacing: ".14em" }}>P&L · LAST {days}D</div>
          <div className="t-num" style={{
            fontSize: 28, marginTop: 4, fontWeight: 600,
            color: total >= 0 ? "var(--profit)" : "var(--loss)",
            textShadow: total >= 0 ? "var(--glow-profit)" : "var(--glow-loss)",
          }}>
            {total >= 0 ? "+" : "−"}${fmt(Math.abs(total), { decimals: 2 })}
          </div>
        </div>
        <div className="th-pnl-chart__legend">
          <span><span className="th-pnl-chart__dot is-pos" /> Profit day</span>
          <span><span className="th-pnl-chart__dot is-neg" /> Loss day</span>
        </div>
      </div>
      <div className="th-pnl-chart__bars">
        {buckets.map((b, i) => {
          const pct = (Math.abs(b.pnl) / maxAbs) * 100;
          const pos = b.pnl >= 0;
          return (
            <div key={i} className="th-pnl-chart__col" title={`${b.pnl >= 0 ? "+" : "−"}$${fmt(Math.abs(b.pnl), { decimals: 2 })} · ${b.daysAgo}d ago`}>
              <div className="th-pnl-chart__track">
                <span
                  className={"th-pnl-chart__bar " + (pos ? "is-pos" : "is-neg")}
                  style={{ height: `${Math.max(2, pct * 0.95)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="th-pnl-chart__axis t-mono">
        <span>−{days}d</span>
        <span>−{Math.round(days / 2)}d</span>
        <span>today</span>
      </div>
    </div>
  );
}

/* ── Expandable Trade Card row ───────────────────────────── */
function TradeCard({ trade, expanded, onToggle }) {
  const pos = trade.pnl >= 0;
  const tone = REASON_TONE[trade.reason] || "neutral";
  const { t, day } = fmtClock(trade.date);

  return (
    <div className={"th-card " + (expanded ? "th-card--open " : "") + "th-card--" + tone}>
      <button className="th-card__head" onClick={onToggle} aria-expanded={expanded}>
        <div className="th-card__chip" style={{ "--chip-c": trade.color }}>
          <span style={{ position: "relative", zIndex: 1 }}>{trade.ticker.slice(0, 4)}</span>
        </div>

        <div className="th-card__name">
          <div className="th-card__ticker-row">
            <span className="th-card__ticker">{trade.ticker}</span>
            <span className="badge">{trade.exch}</span>
            <span className={"th-card__reason th-card__reason--" + tone}>{trade.reason.replace(/_/g, " ")}</span>
          </div>
          <div className="th-card__meta t-mono">
            {fmt(trade.shares, { decimals: trade.entry < 10 ? 2 : 0 })} @ ${fmt(trade.entry, { decimals: 2 })}
            <span className="sep">→</span>
            ${fmt(trade.exit, { decimals: 2 })}
          </div>
        </div>

        <div className="th-card__when t-mono">
          <div>{t}</div>
          <div style={{ color: "var(--text-4)", fontSize: 10.5 }}>{day}</div>
        </div>

        <div className="th-card__pnl">
          <span className={"t-num " + (pos ? "is-pos" : "is-neg")}>
            {pos ? "+" : "−"}${fmt(Math.abs(trade.pnl), { decimals: 2 })}
          </span>
          <span className={"th-card__pnl-pct " + (pos ? "is-pos" : "is-neg")}>
            {pos ? "+" : ""}{fmt(trade.pnlPct, { decimals: 2 })}%
          </span>
        </div>

        <div className="th-card__chev">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 280ms var(--ease-out)" }}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="th-card__detail">
          <div className="th-card__detail-grid">
            <div className="th-card__brain">
              <div className="t-label">
                <span className="t-violet">Brain</span> · reasoning
              </div>
              <p className="t-body" style={{ marginTop: 8 }}>{trade.note}</p>
              <div className="th-card__brain-meta">
                <span className="t-mono">conf at entry · <b style={{ color: "var(--violet)" }}>{trade.conf}%</b></span>
                <span className="t-mono">held · {Math.round(2 + Math.random() * 6)}h {Math.round(Math.random() * 60)}m</span>
              </div>
            </div>

            <div className="th-card__numbers">
              <div className="th-card__stat">
                <span className="t-label">Entry</span>
                <span className="t-num">${fmt(trade.entry, { decimals: 2 })}</span>
              </div>
              <div className="th-card__stat">
                <span className="t-label">Exit</span>
                <span className="t-num">${fmt(trade.exit, { decimals: 2 })}</span>
              </div>
              <div className="th-card__stat">
                <span className="t-label">Shares</span>
                <span className="t-num">{fmt(trade.shares, { decimals: trade.entry < 10 ? 2 : 0 })}</span>
              </div>
              <div className="th-card__stat">
                <span className="t-label">Capital used</span>
                <span className="t-num">${fmt(trade.entry * trade.shares, { decimals: 0 })}</span>
              </div>
              <div className="th-card__stat th-card__stat--pnl">
                <span className="t-label">Realized P&L</span>
                <span className={"t-num " + (pos ? "is-pos" : "is-neg")}>
                  {pos ? "+" : "−"}${fmt(Math.abs(trade.pnl), { decimals: 2 })}
                </span>
              </div>
            </div>
          </div>

          <div className="th-card__actions">
            <button className="btn btn--sm">Open on chart</button>
            <button className="btn btn--sm">View Brain log</button>
            <button className="btn btn--sm">Replay decision</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Trades screen ────────────────────────────────────────── */
function TradesScreen() {
  const { closedTrades, assets } = useBotStore((state) => ({
    closedTrades: state.status.closedTrades,
    assets: state.assets,
  }));
  const [range, setRange] = useStateTH("30d");
  const [reasonFilter, setReasonFilter] = useStateTH("All");
  const [query, setQuery] = useStateTH("");
  const [expanded, setExpanded] = useStateTH(new Set());

  const days = range === "1d" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const assetMap = useMemoTH(() => new Map((assets || []).map((asset) => [asset.ticker, asset])), [assets]);
  const allTrades = useMemoTH(() => {
    return (closedTrades || []).map((trade) => {
      const asset = assetMap.get(trade.ticker);
      const date = trade.closed_at ? new Date(trade.closed_at) : new Date();
      const diffMs = Date.now() - date.getTime();
      const daysAgo = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
      const reason = (trade.reason || "manual_close").toUpperCase();
      return {
        ...trade,
        id: trade.id || `${trade.ticker}-${trade.closed_at || Math.random()}`,
        ticker: trade.ticker,
        name: trade.name || asset?.name || trade.ticker,
        color: asset?.color || "#00E5FF",
        klass: asset?.klass || "stock",
        exch: asset?.exch || "US",
        entry: Number(trade.entry_price) || 0,
        exit: Number(trade.exit_price) || 0,
        shares: Number(trade.shares) || 0,
        pnl: Number(trade.pnl) || 0,
        pnlPct: Number(trade.pnl_pct) || 0,
        reason,
        note: BRAIN_NOTES[reason] || "Trade closed from the dashboard workflow.",
        conf: asset?.conf || Math.max(45, Math.min(95, Math.round(52 + (Number(asset?.score) || 0) * 18))),
        date,
        daysAgo,
      };
    }).sort((left, right) => right.date - left.date);
  }, [assetMap, closedTrades]);
  const trades = useMemoTH(() => {
    let arr = allTrades.filter(t => t.daysAgo < days);
    if (reasonFilter !== "All") arr = arr.filter(t => t.reason === reasonFilter);
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter(t => t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
    }
    return arr;
  }, [allTrades, days, reasonFilter, query]);

  function toggleRow(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Stat strip
  const stats = useMemoTH(() => {
    if (trades.length === 0) return { realized: 0, win: 0, avg: 0, best: 0, worst: 0, wins: 0 };
    const realized = trades.reduce((s, t) => s + t.pnl, 0);
    const wins = trades.filter(t => t.pnl > 0).length;
    const avg = realized / trades.length;
    const best = Math.max(...trades.map(t => t.pnl));
    const worst = Math.min(...trades.map(t => t.pnl));
    return { realized, win: (wins / trades.length) * 100, avg, best, worst, wins };
  }, [trades]);

  const ranges = [
    { id: "1d", label: "Today" },
    { id: "7d", label: "7d" },
    { id: "30d", label: "30d" },
    { id: "90d", label: "90d" },
  ];
  const reasons = ["All", ...REASONS];

  return (
    <div className="th-screen">
      {/* Title + range tabs */}
      <div className="tb-panel__head">
        <h2 className="tb-panel__title">
          Trades
          <InfoTip title="Trade history" align="right" width={320}>
            Every closed position, newest first. Filter by timeframe or exit reason,
            search by ticker. Click a row to expand the Brain's reasoning, the
            full numbers (entry, exit, shares, capital used) and replay controls.
            Sourced from the <span className="k">closed_trades</span> table.
          </InfoTip>
          <span className="tb-panel__count">· {trades.length} trades</span>
        </h2>
        <div className="tb-panel__actions">
          <div className="seg">
            {ranges.map(r => (
              <button key={r.id} className={"seg__btn" + (range === r.id ? " seg__btn--on" : "")} onClick={() => setRange(r.id)}>{r.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Stat strip */}
      <div className="th-stats">
        <div className="th-stat">
          <span className="t-label">Realized P&L</span>
          <span className={"t-num th-stat__v " + (stats.realized >= 0 ? "is-pos" : "is-neg")}>
            {stats.realized >= 0 ? "+" : "−"}${fmt(Math.abs(stats.realized), { decimals: 2 })}
          </span>
        </div>
        <div className="th-stat">
          <span className="t-label">Win rate</span>
          <span className="t-num th-stat__v">{fmt(stats.win, { decimals: 1 })}%</span>
          <span className="th-stat__sub t-mono">{stats.wins} / {trades.length}</span>
        </div>
        <div className="th-stat">
          <span className="t-label">Avg trade</span>
          <span className={"t-num th-stat__v " + (stats.avg >= 0 ? "is-pos" : "is-neg")}>
            {stats.avg >= 0 ? "+" : "−"}${fmt(Math.abs(stats.avg), { decimals: 2 })}
          </span>
        </div>
        <div className="th-stat">
          <span className="t-label">Best trade</span>
          <span className="t-num th-stat__v is-pos">+${fmt(stats.best, { decimals: 2 })}</span>
        </div>
        <div className="th-stat">
          <span className="t-label">Worst trade</span>
          <span className="t-num th-stat__v is-neg">−${fmt(Math.abs(stats.worst), { decimals: 2 })}</span>
        </div>
      </div>

      {/* Daily P&L chart */}
      <DailyPnlChart trades={trades} days={days} />

      {/* Filters */}
      <div className="th-filters">
        <div className="th-filter-tabs">
          {reasons.map(r => (
            <button
              key={r}
              className={"wl-tab" + (reasonFilter === r ? " wl-tab--on" : "")}
              onClick={() => setReasonFilter(r)}
            >
              <span>{r === "All" ? "All exits" : r.replace(/_/g, " ")}</span>
              <span className="wl-tab__count">
                {r === "All" ? allTrades.filter(t => t.daysAgo < days).length : allTrades.filter(t => t.daysAgo < days && t.reason === r).length}
              </span>
            </button>
          ))}
        </div>
        <label className="input-wrap" style={{ width: 240 }}>
          <span className="input-icon">{I.search}</span>
          <input
            className="input"
            placeholder="Search ticker, name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {/* Trade cards */}
      <div className="th-list">
        {trades.map(t => (
          <TradeCard
            key={t.id}
            trade={t}
            expanded={expanded.has(t.id)}
            onToggle={() => toggleRow(t.id)}
          />
        ))}
        {trades.length === 0 && (
          <div className="th-empty t-body">
            No closed trades match these filters.
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { TradesScreen });
