/* settings-screen.jsx — M7 · Settings (capital, profile, brain weights, toggles) */

const { useState: useStateST, useEffect: useEffectST, useMemo: useMemoST } = React;

/* Default brain weights from schema.sql */
const BRAIN_DEFAULTS = {
  safe:       { macd_cross: 1.0, macd_hist: 0.2, rsi: 0.6, ema_trend: 0.3, bollinger: 0.5, mean_rev: 0.8, vol_growing: 0.3 },
  mid:        { macd_cross: 1.0, macd_hist: 0.2, rsi: 0.6, ema_trend: 0.3, bollinger: 0.5, mean_rev: 0.8, vol_growing: 0.3 },
  aggressive: { macd_cross: 1.0, macd_hist: 0.2, rsi: 0.6, ema_trend: 0.3, bollinger: 0.5, mean_rev: 0.8, vol_growing: 0.3 },
};

/* Different profiles -> simulated live-learned weights */
const BRAIN_LIVE = {
  safe:       { macd_cross: 0.86, macd_hist: 0.18, rsi: 0.74, ema_trend: 0.42, bollinger: 0.58, mean_rev: 0.88, vol_growing: 0.22 },
  mid:        { macd_cross: 1.04, macd_hist: 0.24, rsi: 0.62, ema_trend: 0.36, bollinger: 0.52, mean_rev: 0.78, vol_growing: 0.34 },
  aggressive: { macd_cross: 1.18, macd_hist: 0.30, rsi: 0.46, ema_trend: 0.22, bollinger: 0.40, mean_rev: 0.62, vol_growing: 0.52 },
};

const PROFILES = [
  {
    id: "safe",
    name: "Safe",
    desc: "Conservative entries, tight stops, smaller positions. Brain only trades highest-confidence setups.",
    slots: 2,
    cls: "st-profile--safe",
  },
  {
    id: "mid",
    name: "Mid",
    desc: "Balanced approach. Mid-risk position sizing with trailing stops once a trade is in profit.",
    slots: 3,
    cls: "st-profile--mid",
  },
  {
    id: "aggressive",
    name: "Aggressive",
    desc: "Larger positions, looser stops, faster exits. Brain trades more frequently, including mid-confidence signals.",
    slots: 1,
    cls: "st-profile--agg",
  },
];

function SettingsScreen({ mode, onModeChange }) {
  const { status, settings, modeSlots } = useBotStore((state) => ({
    status: state.status,
    settings: state.settings,
    modeSlots: state.modeSlots,
  }));
  const [capital, setCapital] = useStateST(128450);
  const [slots, setSlots]     = useStateST({ safe: 3, mid: 5, aggressive: 2 });
  const [autoSL, setAutoSL]   = useStateST(true);
  const [autoLearn, setAutoLearn] = useStateST(true);
  const [trailing, setTrailing]   = useStateST(true);
  const [cooldown, setCooldown]   = useStateST(45);
  const [saving, setSaving] = useStateST(false);

  useEffectST(() => {
    setCapital(Number(settings.initial_capital) || 5000);
    setSlots({
      safe: Number(modeSlots.safe) || 0,
      mid: Number(modeSlots.mid) || 0,
      aggressive: Number(modeSlots.aggressive) || 0,
    });
    setAutoSL((Number(settings.stop_loss_pct) || 0) > 0);
    setAutoLearn((Number(settings.learn_rate) || 0) > 0);
    setTrailing((Number(settings.trailing_activation) || 0) > 0 && (Number(settings.trailing_distance) || 0) > 0);
    setCooldown(Number(settings.cooldown_minutes) || 30);
  }, [modeSlots, settings]);

  const liveWeights = useMemoST(() => status.modes || {}, [status.modes]);

  function setSlot(id, v) {
    setSlots(s => ({ ...s, [id]: v }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await window.BotActions.saveSettings({
        initial_capital: capital,
        cooldown_minutes: cooldown,
        learn_rate: autoLearn ? Math.max(Number(settings.learn_rate) || 0.05, 0.01) : 0,
        stop_loss_pct: autoSL ? Math.max(Number(settings.stop_loss_pct) || 0.025, 0.005) : 0,
        trailing_activation: trailing ? Math.max(Number(settings.trailing_activation) || 0.015, 0.005) : 0,
        trailing_distance: trailing ? Math.max(Number(settings.trailing_distance) || 0.012, 0.005) : 0,
      }, slots);
    } catch (e) {
      window.alert(e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setCapital(Number(settings.initial_capital) || 5000);
    setSlots({
      safe: Number(modeSlots.safe) || 0,
      mid: Number(modeSlots.mid) || 0,
      aggressive: Number(modeSlots.aggressive) || 0,
    });
    setAutoSL((Number(settings.stop_loss_pct) || 0) > 0);
    setAutoLearn((Number(settings.learn_rate) || 0) > 0);
    setTrailing((Number(settings.trailing_activation) || 0) > 0 && (Number(settings.trailing_distance) || 0) > 0);
    setCooldown(Number(settings.cooldown_minutes) || 30);
  }

  return (
    <div className="st-screen">
      <div className="tb-panel__head">
        <h2 className="tb-panel__title">
          Settings
          <InfoTip title="Bot settings" align="right" width={320}>
            Configure capital allocation, risk profile, per-profile concurrency,
            stop-loss and auto-learning behaviour. Changes write to the
            <span className="k">config</span> and <span className="k">brain_*</span>
            tables and take effect on the next scan cycle.
          </InfoTip>
        </h2>
      </div>

      <div className="st-grid">
        {/* ─── Left column ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Capital */}
          <div className="st-card">
            <div className="st-card__head">
              <div>
                <h3 className="st-card__title">
                  Capital
                  <InfoTip title="Capital under management" align="right" width={280}>
                    Total tradeable balance the Brain can allocate across all profiles.
                    Mapped to <span className="k">config.capital_fx</span>.
                  </InfoTip>
                </h3>
                <div className="st-card__subtitle">Maximum the bot can deploy</div>
              </div>
            </div>
            <div className="st-capital">
              <span className="st-capital__currency">$</span>
              <input
                className="st-capital__input"
                value={fmt(capital, { decimals: 0 })}
                onChange={(e) => {
                  const n = Number(e.target.value.replace(/[^\d.]/g, ""));
                  if (!isNaN(n)) setCapital(n);
                }}
              />
            </div>
            <div className="st-capital__sub">
              Cash now · ${fmt(Number(status.capital) || 0, { decimals: 0 })}{" "}
              <span style={{ color: "var(--text-5)" }}>·</span>{" "}
              Equity · ${fmt(Number(status.equity) || 0, { decimals: 0 })}
            </div>
          </div>

          {/* Profile */}
          <div className="st-card">
            <div className="st-card__head">
              <div>
                <h3 className="st-card__title">
                  Risk profile
                  <InfoTip title="Risk profile" align="right" width={320}>
                    Switches the active strategy. Each profile has its own Brain weights,
                    slot allocation and stop-loss policy. Stored in
                    <span className="k">brain_safe_fx</span>,
                    <span className="k">brain_mid_fx</span>,
                    <span className="k">brain_aggressive_fx</span>.
                  </InfoTip>
                </h3>
                <div className="st-card__subtitle">Active strategy</div>
              </div>
            </div>
            <div className="st-profiles">
              {PROFILES.map(p => (
                <button
                  key={p.id}
                  className={"st-profile " + p.cls + (mode === p.id ? " st-profile--on" : "")}
                  onClick={() => onModeChange(p.id)}
                >
                  <div className="st-profile__head">
                    <span className="dot" />
                    {p.id.toUpperCase()}
                  </div>
                  <div className="st-profile__name">{p.name}</div>
                  <div className="st-profile__desc">{p.desc}</div>
                  <div className="st-profile__meta">
                    <span>slots · <b>{slots[p.id]}</b></span>
                    <span>trained · <b>{liveWeights[p.id]?.trained || 0}</b></span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Slot allocation */}
          <div className="st-card">
            <div className="st-card__head">
              <div>
                <h3 className="st-card__title">
                  Slot allocation
                  <InfoTip title="Concurrent slots" align="right" width={320}>
                    Maximum number of open positions per profile at any moment.
                    Saved to <span className="k">slots_*_fx</span>.
                    Total cap is shared with the capital limit above.
                  </InfoTip>
                </h3>
                <div className="st-card__subtitle">How many trades can run in parallel</div>
              </div>
              <span className="t-mono" style={{ fontSize: 11, color: "var(--text-3)" }}>
                total · <b style={{ color: "var(--text-1)" }}>{slots.safe + slots.mid + slots.aggressive}</b>
              </span>
            </div>
            {PROFILES.map(p => (
              <div key={p.id} className="st-slot">
                <span className="st-slot__label">{p.name}</span>
                <input
                  type="range"
                  min={0} max={6} step={1}
                  value={slots[p.id]}
                  onChange={(e) => setSlot(p.id, Number(e.target.value))}
                  style={{ ["--pct"]: `${(slots[p.id] / 6) * 100}%` }}
                />
                <span className="st-slot__value">{slots[p.id]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ─── Right column ─── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Risk controls */}
          <div className="st-card">
            <div className="st-card__head">
              <div>
                <h3 className="st-card__title">
                  Risk controls
                  <InfoTip title="Risk controls" align="left" width={300}>
                    Behavioural toggles. Auto stop-loss writes default SL
                    levels per trade; trailing stops follow the position once
                    in profit; cooldown blocks re-entry after a loss.
                  </InfoTip>
                </h3>
                <div className="st-card__subtitle">Behavioural toggles</div>
              </div>
            </div>

            <div className="st-toggle-row">
              <div className="st-toggle-row__label">
                <span className="st-toggle-row__label-t">Auto stop-loss</span>
                <span className="st-toggle-row__label-s">Brain sets a default stop-loss on every entry. Saves to <code style={{ color: "var(--cyan)" }}>positions.auto_sl</code>.</span>
              </div>
              <span className={"st-switch " + (autoSL ? "st-switch--on" : "")} onClick={() => setAutoSL(v => !v)} />
            </div>

            <div className="st-toggle-row">
              <div className="st-toggle-row__label">
                <span className="st-toggle-row__label-t">Trailing stop</span>
                <span className="st-toggle-row__label-s">Once a trade is +2%, the stop trails behind the highest price.</span>
              </div>
              <span className={"st-switch " + (trailing ? "st-switch--on" : "")} onClick={() => setTrailing(v => !v)} />
            </div>

            <div className="st-toggle-row">
              <div className="st-toggle-row__label">
                <span className="st-toggle-row__label-t">Brain auto-learning</span>
                <span className="st-toggle-row__label-s">Weights drift after each closed trade. Turn off to freeze the model.</span>
              </div>
              <span className={"st-switch " + (autoLearn ? "st-switch--on" : "")} onClick={() => setAutoLearn(v => !v)} />
            </div>

            <div className="st-toggle-row">
              <div className="st-toggle-row__label">
                <span className="st-toggle-row__label-t">Cooldown after loss</span>
                <span className="st-toggle-row__label-s">Block re-entry on the same ticker for N minutes after a stop-loss.</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="range"
                  min={0} max={180} step={5}
                  value={cooldown}
                  onChange={(e) => setCooldown(Number(e.target.value))}
                  style={{ width: 120, ["--pct"]: `${(cooldown / 180) * 100}%` }}
                />
                <span className="t-mono" style={{ width: 56, textAlign: "right", color: "var(--text-1)", fontWeight: 600 }}>{cooldown}m</span>
              </div>
            </div>
          </div>

          {/* Brain weights (read-only) */}
          <div className="st-card">
            <div className="st-card__head">
              <div>
                <h3 className="st-card__title">
                  Brain weights
                  <InfoTip title="Brain weights · live" align="left" width={320}>
                    Current learned weights per profile. These drift over time —
                    the value shown reflects the latest retrain. Baseline values
                    are stored in each <span className="k">brain_*_fx</span> table.
                  </InfoTip>
                </h3>
                <div className="st-card__subtitle">Live values per profile</div>
              </div>
              <button className="btn btn--sm btn--ghost" onClick={() => window.BotActions.retrainBrain(mode)}>Retrain {mode}</button>
            </div>
            <div className="st-weights">
              {["safe", "mid", "aggressive"].map(p => (
                <div key={p} className="st-weight-col">
                  <div className="st-weight-col__title" style={{
                    color: p === "safe" ? "var(--profit)" : p === "mid" ? "var(--cyan)" : "var(--violet)",
                  }}>
                    {p}
                  </div>
                  {Object.entries(BRAIN_DEFAULTS[p]).map(([k, baseline]) => {
                    const v = Number(liveWeights[p]?.weights?.[k] ?? baseline);
                    return (
                    <div key={k} className="st-weight-row">
                      <span className="st-weight-row__k">{k}</span>
                      <span className="st-weight-row__v" style={{
                        color: Math.abs(v - baseline) > 0.1
                          ? (v > baseline ? "var(--profit)" : "var(--loss)")
                          : "var(--text-1)"
                      }}>
                        {v.toFixed(2)}
                      </span>
                    </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="st-actions">
        <button className="btn" onClick={handleDiscard}>Discard changes</button>
        <button className="btn btn--primary" onClick={handleSave} disabled={saving}>{I.bolt} {saving ? "Saving..." : "Save settings"}</button>
      </div>
    </div>
  );
}

Object.assign(window, { SettingsScreen });
