/* watchlist.jsx — Milestone 3 · WatchlistTable
   51-asset glass table, filter tabs, expandable rows,
   confidence gauge, sparkline, status pill,
   gradient border on signaling rows. */

const { useState: useStateWL, useMemo: useMemoWL, useEffect: useEffectWL } = React;

/* ── Confidence gauge (mini) ──────────────────────────────── */
function ConfGauge({ value, size = 38 }) {
  const v = Math.max(0, Math.min(100, value));
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (v / 100) * c * 0.78;  // 0.78 = ~280° arc
  const cx = size / 2, cy = size / 2;

  const tone =
    v >= 80 ? "var(--violet)" :
    v >= 60 ? "var(--cyan)" :
    v >= 40 ? "var(--amber)" :
              "rgba(255,255,255,0.45)";
  const glow =
    v >= 80 ? "rgba(168, 85, 247, 0.75)" :
    v >= 60 ? "rgba(0, 229, 255, 0.75)" :
              "rgba(255, 176, 32, 0.6)";

  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <filter id={`cg-${v}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.2" />
          </filter>
        </defs>
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="3"
          strokeDasharray={`${c * 0.78} ${c}`}
          transform={`rotate(126 ${cx} ${cy})`}
        />
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke={tone} strokeWidth="3" strokeLinecap="round"
          strokeDasharray={`${c * 0.78} ${c}`}
          strokeDashoffset={off}
          transform={`rotate(126 ${cx} ${cy})`}
          style={{ filter: `drop-shadow(0 0 4px ${glow})`, transition: "stroke-dashoffset 600ms var(--ease-out)" }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums",
        fontSize: 11, fontWeight: 600, color: tone, textShadow: `0 0 6px ${glow}`,
      }}>{v}</div>
    </div>
  );
}

/* ── ticker chip ──────────────────────────────────────────── */
function TickerChip({ ticker, color }) {
  return (
    <div
      style={{
        width: 32, height: 32, borderRadius: 9,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--glass-border)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11,
        letterSpacing: "0.04em",
        color: "var(--text-1)",
        position: "relative",
        overflow: "hidden",
        flex: "0 0 auto",
      }}
    >
      <span style={{
        position: "absolute", inset: 0,
        background: `radial-gradient(circle at 30% 30%, ${color}33, transparent 70%)`,
      }} />
      <span style={{ position: "relative", zIndex: 1 }}>{ticker.slice(0, 4)}</span>
    </div>
  );
}

/* ── Status pill ──────────────────────────────────────────── */
function StatusPill({ status }) {
  const map = {
    holding:    { cls: "badge--profit", label: "HOLDING" },
    watching:   { cls: "",              label: "WATCHING" },
    cooldown:   { cls: "badge--amber",  label: "COOLDOWN" },
    signaling:  { cls: "badge--violet badge--live", label: "SIGNALING" },
  };
  const { cls, label } = map[status] || map.watching;
  return (
    <span className={`badge ${cls}`}>
      {status === "signaling" || status === "holding" ? <span className="dot" /> : null}
      {label}
    </span>
  );
}

/* ── Expanded row content ─────────────────────────────────── */
function ExpandedDetail({ asset }) {
  async function handleForceEntry() {
    try {
      await window.BotActions.forceEntry(asset.ticker, window.__activeMode || asset.mode || "mid");
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function handleClosePosition() {
    try {
      await window.BotActions.closePosition(asset.ticker);
    } catch (e) {
      window.alert(e.message);
    }
  }

  return (
    <div className="wl-detail">
      <div className="wl-detail__col wl-detail__col--brain">
        <div className="t-kicker"><span className="t-violet">Brain</span> · reasoning</div>
        <p className="t-body" style={{ marginTop: 8, color: "var(--text-2)" }}>{asset.reasoning}</p>
        <div className="wl-detail__patterns">
          <div className="t-label" style={{ marginBottom: 8 }}>Recent patterns</div>
          {asset.patterns.map((p, i) => (
            <div key={i} className="wl-pattern">
              <span className="wl-pattern__dot" />
              <span className="t-mono wl-pattern__name">{p.p}</span>
              <span className="t-mono wl-pattern__meta">conf {p.strength}</span>
              <span className="t-mono wl-pattern__time">{p.minsAgo}m ago</span>
            </div>
          ))}
        </div>
      </div>

      <div className="wl-detail__col wl-detail__col--pnl">
        <div className="t-kicker">Position</div>
        {asset.positionSize > 0 ? (
          <div className="wl-pos">
            <div className="wl-pos__row">
              <div>
                <div className="t-label">Size</div>
                <div className="t-num" style={{ fontSize: 18 }}>${fmt(asset.positionSize, { decimals: 0 })}</div>
              </div>
              <div>
                <div className="t-label">Entry</div>
                <div className="t-num" style={{ fontSize: 18 }}>${fmt(asset.entryPrice, { decimals: 2 })}</div>
              </div>
              <div>
                <div className="t-label">Now</div>
                <div className="t-num" style={{ fontSize: 18 }}>${fmt(asset.price, { decimals: 2 })}</div>
              </div>
            </div>
            <div className="wl-pos__pnl">
              <div className="t-label">Unrealized P&amp;L</div>
              <div
                className="t-num"
                style={{
                  fontSize: 26,
                  color: asset.pnlAbs >= 0 ? "var(--profit)" : "var(--loss)",
                  textShadow: asset.pnlAbs >= 0 ? "var(--glow-profit)" : "var(--glow-loss)",
                }}
              >
                {asset.pnlAbs >= 0 ? "+" : ""}{fmt(asset.pnlAbs, { decimals: 2, prefix: "$" })}
                <span style={{ fontSize: 14, marginLeft: 8, opacity: 0.85 }}>
                  ({asset.pnlPct >= 0 ? "+" : ""}{fmt(asset.pnlPct, { decimals: 2 })}%)
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="wl-pos wl-pos--empty">
            <div className="t-body" style={{ color: "var(--text-3)" }}>
              No active position. Brain is observing only.
            </div>
          </div>
        )}

        <div className="wl-detail__actions">
          <button className="btn btn--primary btn--sm" onClick={() => window.__openAsset?.(asset.ticker)}>{I.brain} Open asset detail</button>
          <button className="btn btn--sm" onClick={() => window.__navigate?.("trades")}>View trades</button>
          {asset.positionSize > 0
            ? <button className="btn btn--danger btn--sm" onClick={handleClosePosition}>Close position</button>
            : <button className="btn btn--sm" onClick={handleForceEntry}>Force entry</button>}
        </div>
      </div>
    </div>
  );
}

/* ── Row ──────────────────────────────────────────────────── */
function WatchlistRow({ asset, expanded, onToggle }) {
  const isSignaling = asset.status === "signaling";
  const positive = asset.chg >= 0;

  return (
    <div className={"wl-row " + (expanded ? "wl-row--expanded " : "") + (isSignaling ? "wl-row--signal" : "")}>
      <button className="wl-row__head" onClick={onToggle} aria-expanded={expanded}>
        <div className="wl-cell wl-cell--asset">
          <TickerChip ticker={asset.ticker} color={asset.color} />
          <div className="wl-asset-meta">
            <div className="wl-asset-meta__ticker t-mono">{asset.ticker}</div>
            <div className="wl-asset-meta__name">{asset.name}</div>
          </div>
        </div>

        <div className="wl-cell wl-cell--num">
          <span className="t-num">${fmt(asset.price, { decimals: asset.price < 10 ? 4 : 2 })}</span>
        </div>

        <div className={"wl-cell wl-cell--num " + (positive ? "is-pos" : "is-neg")}>
          <span className="t-num">{positive ? "+" : ""}{fmt(asset.chg, { decimals: 2 })}%</span>
        </div>

        <div className="wl-cell wl-cell--spark">
          <Sparkline data={asset.spark} width={120} height={32} tone={positive ? "profit" : "loss"} />
        </div>

        <div className="wl-cell wl-cell--conf">
          <ConfGauge value={asset.conf} />
        </div>

        <div className="wl-cell wl-cell--status">
          <StatusPill status={asset.status} />
        </div>

        <div className="wl-cell wl-cell--meta">
          <span className="badge">{asset.exch}</span>
        </div>

        <div className="wl-cell wl-cell--chev">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 320ms var(--ease-out)" }}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </div>
      </button>

      {expanded && <ExpandedDetail asset={asset} />}
    </div>
  );
}

/* ── Table ────────────────────────────────────────────────── */
function WatchlistTable() {
  const { assets, loading, status } = useBotStore((state) => ({ assets: state.assets, loading: state.loading, status: state.status }));
  const [filter, setFilter] = useStateWL("All");
  const [expanded, setExpanded] = useStateWL(new Set());
  const [query, setQuery] = useStateWL("");
  const [sort, setSort] = useStateWL({ key: "conf", dir: "desc" });

  const filtered = useMemoWL(() => {
    let arr = [...assets];
    if (filter === "US")        arr = arr.filter(a => a.exch === "US");
    else if (filter === "EU")   arr = arr.filter(a => a.exch === "EU");
    else if (filter === "Crypto") arr = arr.filter(a => a.klass === "crypto");
    else if (filter === "Signaling") arr = arr.filter(a => a.status === "signaling" || a.conf >= 80);

    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter(a => a.ticker.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
    }
    arr.sort((a, b) => {
      const k = sort.key;
      const av = a[k], bv = b[k];
      return (sort.dir === "asc" ? 1 : -1) * (av < bv ? -1 : av > bv ? 1 : 0);
    });
    return arr;
  }, [assets, filter, query, sort]);

  function toggle(t) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  function setSortKey(k) {
    setSort(s => s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "desc" });
  }

  const filters = ["All", "US", "EU", "Crypto", "Signaling"];
  const counts = useMemoWL(() => {
    const all = assets;
    return {
      All: all.length,
      US: all.filter(a => a.exch === "US").length,
      EU: all.filter(a => a.exch === "EU").length,
      Crypto: all.filter(a => a.klass === "crypto").length,
      Signaling: all.filter(a => a.status === "signaling" || a.conf >= 80).length,
    };
  }, [assets]);

  return (
    <Glass className="wl">
      <div className="wl__head">
        <div>
          <h2 className="tb-panel__title" style={{ fontSize: 20 }}>
            Watchlist
            <InfoTip title="Watchlist" align="right" width={320}>
              All tracked assets. Each row shows latest scanned price, 24h change, sparkline
              and the Brain's confidence gauge. Click a row to expand the model's
              reasoning, recent pattern matches and any open position. Rows above
              <span className="v">80%</span> wear a rotating cyan→violet gradient border.
            </InfoTip>
            <span className="tb-panel__count">· {assets.length} assets</span>
          </h2>
        </div>
        <div className="wl__filters">
          <div className="wl-tabs">
            {filters.map(f => (
              <button
                key={f}
                className={"wl-tab" + (filter === f ? " wl-tab--on" : "")}
                onClick={() => setFilter(f)}
              >
                <span>{f}</span>
                <span className="wl-tab__count">{counts[f]}</span>
              </button>
            ))}
          </div>
          <label className="input-wrap" style={{ width: 240 }}>
            <span className="input-icon">{I.search}</span>
            <input
              className="input"
              placeholder="Filter tickers…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="wl-table">
        <div className="wl-header-row">
          <div className="wl-cell wl-cell--asset">
            Asset
            <InfoTip title="Asset" align="right" width={260}>
              Ticker + name. Color glyph is the brand accent; class is on the right pill (US, EU or CRYPTO).
            </InfoTip>
          </div>
          <div className="wl-cell wl-cell--num wl-sortable" onClick={() => setSortKey("price")}>
            Price
            <InfoTip title="Price" align="right" width={240}>
              Live mid-price. Updated every 3s from the data feed. Click the column to sort.
            </InfoTip>
            {" "}{sort.key === "price" && (sort.dir === "asc" ? "↑" : "↓")}
          </div>
          <div className="wl-cell wl-cell--num wl-sortable" onClick={() => setSortKey("chg")}>
            Δ 24h
            <InfoTip title="24h change" align="right" width={260}>
              Percentage change in price over the last 24 hours. Green when positive, red when negative.
            </InfoTip>
            {" "}{sort.key === "chg" && (sort.dir === "asc" ? "↑" : "↓")}
          </div>
          <div className="wl-cell wl-cell--spark">
            Trend 24h
            <InfoTip title="24h trend" align="right" width={260}>
              Sparkline of the last 24h of prices. Stroke color mirrors the 24h delta. Last point glows.
            </InfoTip>
          </div>
          <div className="wl-cell wl-cell--conf wl-sortable" onClick={() => setSortKey("conf")}>
            Brain
            <InfoTip title="Brain confidence" align="right" width={280}>
              The model's 0–99 conviction for the next trade on this asset.
              Color codes: amber &lt; 40, cyan &ge; 60, <span className="v">violet &ge; 80</span>.
            </InfoTip>
            {" "}{sort.key === "conf" && (sort.dir === "asc" ? "↑" : "↓")}
          </div>
          <div className="wl-cell wl-cell--status">
            Status
            <InfoTip title="Status" align="left" width={300}>
              <ul>
                <li><span className="k">WATCHING</span> — scanning, no action</li>
                <li><span className="k">SIGNALING</span> — conf above threshold, ready to enter</li>
                <li><span className="k">HOLDING</span> — open position</li>
                <li><span className="k">COOLDOWN</span> — paused after recent stop-loss</li>
              </ul>
            </InfoTip>
          </div>
          <div className="wl-cell wl-cell--meta">Market</div>
          <div className="wl-cell wl-cell--chev" />
        </div>

        <div className="wl-body">
          {loading && assets.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)" }} className="t-body">
              Loading watchlist…
            </div>
          )}
          {filtered.map(a => (
            <WatchlistRow
              key={a.ticker}
              asset={a}
              expanded={expanded.has(a.ticker)}
              onToggle={() => toggle(a.ticker)}
            />
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--text-3)" }} className="t-body">
              No assets match this filter.
            </div>
          )}
        </div>
      </div>

      <div className="wl__foot">
        <span className="t-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
          showing {filtered.length} of {assets.length} · sorted by {sort.key} {sort.dir}
        </span>
        <span className="badge badge--cyan badge--live"><span className="dot" />scan #{status.totalScans || 0}</span>
      </div>
    </Glass>
  );
}

Object.assign(window, { WatchlistTable, ConfGauge });
