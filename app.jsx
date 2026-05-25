/* app.jsx — Tradebit product dashboard
   Sidebar + topbar + main grid. All design-system showcase removed. */

const { useState: useStateAPP, useEffect: useEffectAPP, useMemo: useMemoAPP } = React;

/* ── helpers ─────────────────────────────────────────────── */
function clampAPP(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function roll(arr, next) {
  const out = arr.slice(1); out.push(next); return out;
}
function makeWalk(n = 28, base = 100, vol = 4, trend = 0.1) {
  const out = [base];
  for (let i = 1; i < n; i++) {
    out.push(out[i - 1] + (Math.random() - 0.5) * vol + trend);
  }
  return out;
}

function getRecentClosedTrades(closedTrades, hours = 24) {
  const cutoff = Date.now() - (hours * 60 * 60 * 1000);
  return (closedTrades || []).filter((trade) => {
    const ts = trade.closed_at ? new Date(trade.closed_at).getTime() : NaN;
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function buildSpark(values, fallback) {
  const clean = (values || []).map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (clean.length >= 2) return clean;
  if (Number.isFinite(fallback)) return [fallback * 0.99, fallback * 1.01, fallback];
  return [];
}

function deriveDayPnl(closedTrades) {
  return getRecentClosedTrades(closedTrades).reduce((sum, trade) => sum + (Number(trade.pnl) || 0), 0);
}

const SPARK_EQUITY  = makeWalk(64, 100000, 600, 80);
const SPARK_TRADES  = makeWalk(24, 18, 4, 0.3);
const SPARK_WINRATE = makeWalk(24, 60, 3, 0.2);
const SPARK_CONF    = makeWalk(24, 72, 4, 0.5);

/* ── shimmer (used by Watchlist) ─────────────────────────── */
const SHIMMER_CSS = `
.shimmer { position: relative; overflow: hidden; background: rgba(255,255,255,0.04); }
.shimmer::after { content:""; position:absolute; inset:0; background: linear-gradient(90deg, transparent, rgba(0,229,255,0.18), transparent); transform: translateX(-100%); animation: sweep 1.6s ease-in-out infinite; }
@keyframes sweep { to { transform: translateX(100%); } }
`;

/* ── Sidebar icons (single-path each) ───────────────────── */
const SI = {
  dash:     <Icon d={<path d="M3 12 12 3l9 9M5 10v10h14V10" />} size={16} />,
  watch:    <Icon d={<path d="M11 5a6 6 0 1 0 4.5 9.9L20 19m-9-9V8" />} size={16} />,
  brain:    <Icon d={<path d="M9 4a3 3 0 0 1 3 3v10a3 3 0 1 1-6 0 2.5 2.5 0 0 1-2-4 2.5 2.5 0 0 1 2-4V7a3 3 0 0 1 3-3zM15 4a3 3 0 0 0-3 3v10a3 3 0 1 0 6 0 2.5 2.5 0 0 0 2-4 2.5 2.5 0 0 0-2-4V7a3 3 0 0 0-3-3z" />} size={16} />,
  trades:   <Icon d={<path d="M3 17V7m0 10 4-4 4 4 7-7m-3 0h3v3" />} size={16} />,
  history:  <Icon d={<path d="M12 3a9 9 0 1 1-9 9M3 6v3h3M12 7v5l3 2" />} size={16} />,
  settings: <Icon d={<path d="M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0-5v3m0 14v3M5.6 5.6l2 2m8.8 8.8 2 2M3 12h3m12 0h3M5.6 18.4l2-2m8.8-8.8 2-2" />} size={16} />,
  bell:     <Icon d={<path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9zM10 21a2 2 0 0 0 4 0" />} size={16} />,
  pause:    <Icon d={<path d="M7 5v14M17 5v14" stroke="currentColor" strokeWidth="2.2" />} size={14} />,
  play:     <Icon d={<path d="M6 4l14 8L6 20z" fill="currentColor" />} size={14} />,
};

/* ── Sidebar ─────────────────────────────────────────────── */
function Sidebar({ active, onChange, counts }) {
  const items = [
    { id: "dashboard", label: "Dashboard", icon: SI.dash },
    { id: "watchlist", label: "Watchlist", icon: SI.watch, count: counts.assets },
    { id: "brain",     label: "Brain",     icon: SI.brain, count: counts.signals },
    { id: "trades",    label: "Trades",    icon: SI.trades },
    { id: "history",   label: "History",   icon: SI.history },
  ];
  const utility = [
    { id: "alerts",   label: "Alerts",   icon: SI.bell, count: 3 },
    { id: "settings", label: "Settings", icon: SI.settings },
  ];

  return (
    <aside className="tb-side">
      <div className="tb-side__brand">
        <span className="brand__mark">T</span>
        <span className="brand__name">trade<b>bit</b></span>
      </div>

      <nav className="tb-side__nav">
        <div className="tb-nav-section">Trading</div>
        {items.map(it => (
          <button
            key={it.id}
            className={"tb-nav-item " + (active === it.id ? "tb-nav-item--active" : "")}
            onClick={() => onChange(it.id)}
          >
            <span className="tb-nav-item__icon">{it.icon}</span>
            <span>{it.label}</span>
            {it.count !== undefined && <span className="tb-nav-item__count">{it.count}</span>}
          </button>
        ))}

        <div className="tb-nav-section">System</div>
        {utility.map(it => (
          <button
            key={it.id}
            className={"tb-nav-item " + (active === it.id ? "tb-nav-item--active" : "")}
            onClick={() => onChange(it.id)}
          >
            <span className="tb-nav-item__icon">{it.icon}</span>
            <span>{it.label}</span>
            {it.count !== undefined && <span className="tb-nav-item__count">{it.count}</span>}
          </button>
        ))}
      </nav>

      <div className="tb-side__foot">
        <div className="tb-side__user">
          <span className="tb-side__avatar">F</span>
          <div className="tb-side__user-meta">
            <span className="tb-side__user-name">Francesco</span>
            <span className="tb-side__user-mode">Mid · $128k</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ── Topbar ──────────────────────────────────────────────── */
function Topbar({ paused, onTogglePause, mode, onCycleMode, dayPnl, onOpenCmd, onOpenTweaks, onOpenAlerts }) {
  const pos = dayPnl >= 0;
  const modeMap = { safe: "Safe", mid: "Mid", aggressive: "Aggressive" };
  return (
    <header className="tb-top">
      <div className="tb-top__left">
        <div className={"tb-state " + (paused ? "tb-state--paused" : "")}>
          <span className="tb-state__dot" />
          {paused ? "Paused" : "Live"}
        </div>

        <button className={"tb-mode tb-mode--" + (mode === "aggressive" ? "agg" : mode)} onClick={onCycleMode}>
          <span className="tb-mode__dot" />
          {modeMap[mode]} profile
        </button>

        <div className="tb-pnl-strip">
          <span className="tb-pnl-strip__k">Day P&L</span>
          <span className={"tb-pnl-strip__v " + (pos ? "is-pos" : "is-neg")}>
            {pos ? "+" : "−"}${fmt(Math.abs(dayPnl), { decimals: 2 })}
          </span>
          <span className="tb-pnl-strip__sub">
            {pos ? "+" : ""}{fmt(dayPnl / 128450 * 100, { decimals: 2 })}%
          </span>
        </div>
      </div>

      <div className="tb-top__right">
        <button className="tb-kbd-trigger" onClick={onOpenCmd}>
          {I.search}
          <span>Search</span>
          <span className="k">⌘ K</span>
        </button>
        <button className="btn btn--sm" onClick={onOpenAlerts} aria-label="Notifications">
          {SI.bell}
        </button>
        <button className="btn btn--sm btn--ghost" onClick={onOpenTweaks} title="Tweaks (⌘.)" aria-label="Tweaks">
          {SI.settings}
        </button>
        <button
          className={"btn btn--sm " + (paused ? "btn--primary" : "btn--danger")}
          onClick={onTogglePause}
        >
          {paused ? SI.play : SI.pause}
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
    </header>
  );
}

/* ── Stat row ────────────────────────────────────────────── */
function StatRow() {
  const { status, assets } = useBotStore((state) => ({ status: state.status, assets: state.assets }));
  const recentTrades = useMemoAPP(() => getRecentClosedTrades(status.closedTrades), [status.closedTrades]);
  const tradesToday = recentTrades.length;
  const winRate = Number(status.stats?.wr) || 0;
  const brainConf = assets.length
    ? +(assets.reduce((sum, asset) => sum + (Number(asset.conf) || 0), 0) / assets.length).toFixed(1)
    : Number(status.brain?.confidence) || 0;
  const equity = Number(status.equity) || 0;

  const eqSpark = useMemoAPP(
    () => buildSpark((status.scanActivity || []).slice(-24).map((entry) => entry.equity), equity || 100000),
    [status.scanActivity, equity]
  );
  const trSpark = useMemoAPP(
    () => buildSpark((status.scanActivity || []).slice(-24).map((entry) => (entry.buys?.length || 0) + (entry.closes?.length || 0)), tradesToday || 1),
    [status.scanActivity, tradesToday]
  );
  const wrSpark = useMemoAPP(() => {
    const rolling = [];
    let wins = 0;
    recentTrades.slice().reverse().slice(-24).forEach((trade, index) => {
      if ((Number(trade.pnl) || 0) > 0) wins += 1;
      rolling.push((wins / (index + 1)) * 100);
    });
    return buildSpark(rolling, winRate || 50);
  }, [recentTrades, winRate]);
  const bcSpark = useMemoAPP(
    () => buildSpark((status.recentScores || []).slice(-24).map((entry) => clampAPP(52 + (Number(entry.score) || 0) * 18, 0, 100)), brainConf || 60),
    [status.recentScores, brainConf]
  );

  const previousEquity = eqSpark.length > 1 ? eqSpark[0] : equity;
  const equityDeltaPct = previousEquity > 0 ? ((equity - previousEquity) / previousEquity) * 100 : 0;
  const tradesDelta = trSpark.length > 1 ? trSpark[trSpark.length - 1] - trSpark[0] : 0;
  const winRateDelta = wrSpark.length > 1 ? winRate - wrSpark[0] : 0;
  const brainDelta = bcSpark.length > 1 ? brainConf - bcSpark[0] : 0;

  return (
    <div className="tb-grid-stats">
      <StatCard
        label="Portfolio equity"
        info={{
          title: "Portfolio equity",
          body: <>Mark-to-market value of all open positions plus uninvested cash. Updates on every price tick (~2s). Delta is vs yesterday's close.</>,
          align: "right",
        }}
        icon={I.activity}
        value={equity}
        decimals={2}
        prefix="$"
        delta={equityDeltaPct}
        deltaLabel="vs recent scan window"
        spark={eqSpark}
        tone="cyan"
      />
      <StatCard
        label="Trades today"
        info={{
          title: "Trades today",
          body: <>Opens + closes executed since midnight UTC. Sparkline shows the rolling count over the last 24 cycles. Delta is vs the trailing 7-day average for the same hour.</>,
        }}
        icon={I.bolt}
        value={tradesToday}
        delta={tradesDelta}
        deltaLabel="last 24h executions"
        spark={trSpark}
        tone="cyan"
      />
      <StatCard
        label="Win rate"
        info={{
          title: "Win rate",
          body: <>Share of the last 50 closed trades that returned positive P&L. A healthy bot lives in the <span className="k">55–70%</span> band.</>,
        }}
        icon={I.target}
        value={winRate}
        decimals={1}
        suffix="%"
        delta={winRateDelta}
        deltaLabel="recent closed trades"
        spark={wrSpark}
        tone="profit"
      />
      <StatCard
        label="Brain confidence"
        info={{
          title: "Brain confidence",
          body: <>Rolling average of per-asset confidence scores across all 51 watched tickers. Reflects how strong the model thinks current setups are.</>,
          align: "left",
        }}
        icon={I.brain}
        value={brainConf}
        decimals={1}
        suffix="%"
        delta={brainDelta}
        deltaLabel={`rolling avg · ${assets.length || 0} assets`}
        spark={bcSpark}
        tone="violet"
        signal
      />
    </div>
  );
}

/* ── App ─────────────────────────────────────────────────── */
function App() {
  const { status, assets, loading, error } = useBotStore((state) => ({
    status: state.status,
    assets: state.assets,
    loading: state.loading,
    error: state.error,
  }));
  const [active, setActive] = useStateAPP("dashboard");
  const [activeAsset, setActiveAsset] = useStateAPP(null);  // ticker string or null
  const [mode, setMode] = useStateAPP("mid");
  const [cmdOpen, setCmdOpen] = useStateAPP(false);
  const [tweaksOpen, setTweaksOpen] = useStateAPP(false);

  // Tweaks state
  const [density, setDensity] = useStateAPP("cozy");
  const [glow, setGlow] = useStateAPP("medium");
  const [accent, setAccent] = useStateAPP("cyan");

  const dayPnl = useMemoAPP(() => deriveDayPnl(status.closedTrades), [status.closedTrades]);

  // Expose openAsset to children (so watchlist rows can deep-link)
  window.__openAsset = (ticker) => { setActiveAsset(ticker); };
  window.__navigate = (id) => { setActive(id); setActiveAsset(null); };
  window.__activeMode = mode;

  // inject shimmer once
  useEffectAPP(() => {
    if (document.getElementById("shimmer-css")) return;
    const s = document.createElement("style");
    s.id = "shimmer-css";
    s.textContent = SHIMMER_CSS;
    document.head.appendChild(s);
  }, []);

  // ⌘K listener (and ⌘. for tweaks)
  useEffectAPP(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setTweaksOpen(o => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Apply accent palette via CSS custom props
  useEffectAPP(() => {
    const preset = (window.ACCENT_PRESETS || []).find(p => p.id === accent);
    if (!preset) return;
    document.documentElement.style.setProperty("--cyan", preset.cyan);
    document.documentElement.style.setProperty("--violet", preset.violet);
  }, [accent]);

  const counts = {
    assets:  assets.length,
    signals: assets.filter(a => a.conf >= 80).length,
  };

  function cycleMode() {
    const order = ["safe", "mid", "aggressive"];
    setMode(m => order[(order.indexOf(m) + 1) % order.length]);
  }

  async function handleTogglePause() {
    try {
      await window.BotActions.togglePause(!status.paused);
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function handleRetrain() {
    try {
      await window.BotActions.retrainBrain(mode);
    } catch (e) {
      window.alert(e.message);
    }
  }

  return (
    <div className={"app-shell " + (density === "dense" ? "dense " : "") + (glow === "low" ? "low-glow " : glow === "high" ? "high-glow " : "")}>
      <Sidebar active={active} onChange={(id) => { setActive(id); setActiveAsset(null); }} counts={counts} />

      <div className="tb-main">
        <Topbar
          paused={!!status.paused}
          onTogglePause={handleTogglePause}
          mode={mode}
          onCycleMode={cycleMode}
          dayPnl={dayPnl}
          onOpenCmd={() => setCmdOpen(true)}
          onOpenTweaks={() => setTweaksOpen(true)}
          onOpenAlerts={() => { setActive("alerts"); setActiveAsset(null); }}
        />

        <main className="tb-content">
          {error && (
            <div className="glass" style={{ padding: 12, marginBottom: 16, color: "var(--loss)" }}>
              {error}
            </div>
          )}
          {loading && !assets.length ? (
            <div className="glass" style={{ padding: 32, textAlign: "center", color: "var(--text-3)" }}>
              Loading dashboard…
            </div>
          ) : activeAsset ? (
            <AssetDetail ticker={activeAsset} onBack={() => setActiveAsset(null)} />
          ) : (
            <>
              {active === "dashboard" && (
                <>
                  <StatRow />
                  <EquityCurveCard />
                  <div className="tb-grid-mid">
                    <WatchlistTable />
                    <RecentTrades />
                  </div>
                  <BrainPanel />
                </>
              )}

              {active === "watchlist" && <WatchlistTable />}

              {active === "brain" && <BrainPanel />}

              {active === "trades" && <TradesScreen />}

              {active === "history" && <TradesScreen />}

              {active === "settings" && (
                <SettingsScreen mode={mode} onModeChange={setMode} />
              )}

              {active === "alerts" && <AlertsScreen />}
            </>
          )}
        </main>
      </div>

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={(id) => { setActive(id); setActiveAsset(null); }}
        onToggleMode={(id) => setMode(id)}
          onTogglePause={handleTogglePause}
          onRetrain={handleRetrain}
        onOpenAsset={(ticker) => setActiveAsset(ticker)}
      />

      <TweaksPanel
        open={tweaksOpen}
        onClose={() => setTweaksOpen(false)}
        density={density} onDensity={setDensity}
        glow={glow}       onGlow={setGlow}
        accent={accent}   onAccent={setAccent}
      />
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("app"));
root.render(<App />);
