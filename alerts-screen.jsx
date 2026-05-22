/* alerts-screen.jsx — M8 · Alerts (5 alert kinds, list, add-new form) */

const { useState: useStateAL, useMemo: useMemoAL, useEffect: useEffectAL } = React;

const ALERT_KINDS = [
  {
    id: "price",
    label: "Price threshold",
    desc: "Trigger when price crosses a level (above / below).",
    fields: ["direction", "price"],
  },
  {
    id: "pct",
    label: "% change",
    desc: "Trigger when % change in a window exceeds a value.",
    fields: ["pct", "window"],
  },
  {
    id: "conf",
    label: "Brain confidence",
    desc: "Trigger when the Brain's confidence on a ticker crosses a threshold.",
    fields: ["direction", "conf"],
  },
  {
    id: "pattern",
    label: "Pattern detected",
    desc: "Trigger when a specific pattern is detected.",
    fields: ["pattern"],
  },
  {
    id: "pnl",
    label: "Position P&L",
    desc: "Trigger when an open position's P&L crosses a threshold.",
    fields: ["direction", "pnl"],
  },
];

const PATTERN_OPTS = ["bull-flag", "rsi-divergence", "vwap-reclaim", "ema-crossover", "volume-spike", "macd-cross", "double-bottom"];

/* Initial alerts (mocked) */
function seedAlerts() {
  return [
    { id: "a1", kind: "price",   ticker: "NVDA", direction: "above", price: 1300, status: "armed",  fired: null },
    { id: "a2", kind: "conf",    ticker: "BTC",  direction: "above", conf: 85,    status: "armed",  fired: null },
    { id: "a3", kind: "pattern", ticker: "SOL",  pattern: "bull-flag",            status: "fired",  fired: "12m ago" },
    { id: "a4", kind: "pnl",     ticker: "MSTR", direction: "above", pnl: 500,    status: "armed",  fired: null },
    { id: "a5", kind: "pct",     ticker: "AMD",  pct: 5, window: "1h",            status: "paused", fired: null },
    { id: "a6", kind: "conf",    ticker: "ETH",  direction: "below", conf: 50,    status: "armed",  fired: null },
  ];
}

function alertSummary(a) {
  switch (a.kind) {
    case "price":   return `${a.direction === "above" ? "Above" : "Below"} $${a.price}`;
    case "pct":     return `${a.pct}% in ${a.window}`;
    case "conf":    return `Brain ${a.direction} ${a.conf}%`;
    case "pattern": return `Pattern · ${a.pattern}`;
    case "pnl":     return `P&L ${a.direction} $${a.pnl}`;
    default:        return "";
  }
}

function alertKindLabel(kind) {
  return ALERT_KINDS.find(k => k.id === kind)?.label || kind;
}

function AlertsScreen() {
  const { alerts, assets } = useBotStore((state) => ({ alerts: state.alerts, assets: state.assets }));
  const [kind, setKind]     = useStateAL("price");
  const [ticker, setTicker] = useStateAL("");
  const [direction, setDirection] = useStateAL("above");
  const [price, setPrice] = useStateAL(1200);
  const [pct, setPct] = useStateAL(5);
  const [windowSize, setWindowSize] = useStateAL("1h");
  const [conf, setConf] = useStateAL(80);
  const [pattern, setPattern] = useStateAL("bull-flag");
  const [pnl, setPnl] = useStateAL(500);

  const kindDef = ALERT_KINDS.find(k => k.id === kind);

  const tickerOpts = useMemoAL(() => {
    return assets.map(a => a.ticker);
  }, [assets]);

  useEffectAL(() => {
    if (!ticker && tickerOpts.length) {
      setTicker(tickerOpts[0]);
      return;
    }
    if (ticker && tickerOpts.length && !tickerOpts.includes(ticker)) {
      setTicker(tickerOpts[0]);
    }
  }, [ticker, tickerOpts]);

  async function addAlert() {
    try {
      const payload = { kind, ticker };
      if (kindDef.fields.includes("direction")) payload.direction = direction;
      if (kindDef.fields.includes("price")) payload.price = Number(price);
      if (kindDef.fields.includes("pct")) payload.pct = Number(pct);
      if (kindDef.fields.includes("window")) payload.window = windowSize;
      if (kindDef.fields.includes("conf")) payload.conf = Number(conf);
      if (kindDef.fields.includes("pattern")) payload.pattern = pattern;
      if (kindDef.fields.includes("pnl")) payload.pnl = Number(pnl);
      await window.BotActions.createAlert(payload);
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function deleteAlert(id) {
    try {
      await window.BotActions.deleteAlert(id);
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function toggleStatus(id) {
    try {
      await window.BotActions.toggleAlert(id);
    } catch (e) {
      window.alert(e.message);
    }
  }

  const counts = {
    armed:  alerts.filter(a => a.status === "armed").length,
    paused: alerts.filter(a => a.status === "paused").length,
    fired:  alerts.filter(a => a.status === "fired").length,
    total:  alerts.length,
  };

  return (
    <div className="al-screen">
      <div className="tb-panel__head">
        <h2 className="tb-panel__title">
          Alerts
          <InfoTip title="Alerts" align="right" width={320}>
            User-defined triggers across price, % change, Brain confidence,
            pattern detection and P&L. Armed alerts run on every scan cycle.
            Stored alongside the bot config in <span className="k">D1</span>.
          </InfoTip>
          <span className="tb-panel__count">· {counts.total} total</span>
        </h2>
      </div>

      <div className="al-stats">
        <div className="al-stat">
          <span className="t-label">Armed</span>
          <span className="t-num al-stat__v" style={{ color: "var(--cyan)" }}>{counts.armed}</span>
        </div>
        <div className="al-stat">
          <span className="t-label">Paused</span>
          <span className="t-num al-stat__v" style={{ color: "var(--amber)" }}>{counts.paused}</span>
        </div>
        <div className="al-stat">
          <span className="t-label">Fired · 24h</span>
          <span className="t-num al-stat__v" style={{ color: "var(--profit)" }}>{counts.fired}</span>
        </div>
        <div className="al-stat">
          <span className="t-label">Across assets</span>
          <span className="t-num al-stat__v">{new Set(alerts.map(a => a.ticker)).size}</span>
        </div>
      </div>

      <div className="al-grid">
        {/* Add new — left */}
        <div className="al-card">
          <h3 className="ad-card__title">
            New alert
            <InfoTip title="Add an alert" align="right" width={300}>
              Pick a kind, choose a ticker, set the threshold. Alerts can be
              paused without deleting them.
            </InfoTip>
          </h3>

          <div className="al-form">
            <div className="al-field">
              <span className="al-field__l">Kind</span>
              <div className="al-kinds">
                {ALERT_KINDS.map(k => (
                  <button
                    key={k.id}
                    className={"al-kind " + (kind === k.id ? "al-kind--on" : "")}
                    onClick={() => setKind(k.id)}
                  >
                    <span className="al-kind__t">
                      <span className="al-kind__icon">{
                        k.id === "price" ? I.target :
                        k.id === "pct"   ? I.activity :
                        k.id === "conf"  ? I.brain :
                        k.id === "pattern" ? I.spark : I.bolt
                      }</span>
                      {k.label}
                    </span>
                    <span className="al-kind__d">{k.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="al-field">
              <span className="al-field__l">Ticker</span>
              <div className="al-field-row">
                <select
                  className="input"
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
                  style={{ padding: "0 12px", height: 36 }}
                >
                  {tickerOpts.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {kindDef.fields.includes("direction") && (
              <div className="al-field">
                <span className="al-field__l">Direction</span>
                <div className="al-direction">
                  <button className={direction === "above" ? "is-on" : ""} onClick={() => setDirection("above")}>Above</button>
                  <button className={direction === "below" ? "is-on" : ""} onClick={() => setDirection("below")}>Below</button>
                </div>
              </div>
            )}

            {kindDef.fields.includes("price") && (
              <div className="al-field">
                <span className="al-field__l">Price ($)</span>
                <input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} style={{ paddingLeft: 12 }} />
              </div>
            )}

            {kindDef.fields.includes("pct") && (
              <div className="al-field">
                <span className="al-field__l">% change</span>
                <input className="input" type="number" value={pct} onChange={(e) => setPct(e.target.value)} style={{ paddingLeft: 12 }} />
              </div>
            )}

            {kindDef.fields.includes("window") && (
              <div className="al-field">
                <span className="al-field__l">Window</span>
                <div className="al-direction">
                  {["15m", "1h", "4h", "1d"].map(w => (
                    <button key={w} className={windowSize === w ? "is-on" : ""} onClick={() => setWindowSize(w)}>{w}</button>
                  ))}
                </div>
              </div>
            )}

            {kindDef.fields.includes("conf") && (
              <div className="al-field">
                <span className="al-field__l">Confidence threshold (%)</span>
                <input className="input" type="number" min="0" max="100" value={conf} onChange={(e) => setConf(e.target.value)} style={{ paddingLeft: 12 }} />
              </div>
            )}

            {kindDef.fields.includes("pattern") && (
              <div className="al-field">
                <span className="al-field__l">Pattern</span>
                <select
                  className="input"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  style={{ padding: "0 12px", height: 36 }}
                >
                  {PATTERN_OPTS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}

            {kindDef.fields.includes("pnl") && (
              <div className="al-field">
                <span className="al-field__l">P&L threshold ($)</span>
                <input className="input" type="number" value={pnl} onChange={(e) => setPnl(e.target.value)} style={{ paddingLeft: 12 }} />
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn btn--primary btn--sm" onClick={addAlert}>
                {I.bolt} Arm alert
              </button>
            </div>
          </div>
        </div>

        {/* Existing alerts — right */}
        <div className="al-card">
          <h3 className="ad-card__title">
            Active alerts
            <InfoTip title="Active alerts" align="left" width={280}>
              Click the status pill to pause / resume; the trash button to delete.
              Fired alerts stay in the list for 24h before auto-archiving.
            </InfoTip>
            <span className="tb-panel__count">· {alerts.length}</span>
          </h3>

          <div className="al-list">
            {alerts.map(a => {
              const asset = assets.find(x => x.ticker === a.ticker);
              return (
                <div key={a.id} className={"al-row al-row--" + a.status}>
                  <span className="al-row__dot" />
                  <span className="al-row__chip" style={{ "--chip-c": asset?.color || "var(--cyan)" }}>
                    <span style={{ position: "relative", zIndex: 1 }}>{a.ticker.slice(0, 4)}</span>
                  </span>
                  <div className="al-row__body">
                    <div className="al-row__title">
                      <b>{a.ticker}</b> · {alertKindLabel(a.kind)}
                    </div>
                    <div className="al-row__sub">
                      {alertSummary(a)}{a.fired_at ? ` · fired ${a.fired_at}` : a.fired ? ` · fired ${a.fired}` : ""}
                    </div>
                  </div>
                  <span className={"al-row__status al-row__status--" + a.status} onClick={() => toggleStatus(a.id)} role="button">
                    {a.status}
                  </span>
                  <button className="al-row__del" onClick={() => deleteAlert(a.id)} aria-label="Delete alert">×</button>
                </div>
              );
            })}
            {alerts.length === 0 && (
              <div className="th-empty">No alerts yet. Add one on the left.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AlertsScreen });
