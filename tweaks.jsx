/* tweaks.jsx — small floating Tweaks panel
   Toggled from outside via app state (or ⌘. shortcut) */

const { useState: useStateTW } = React;

const ACCENT_PRESETS = [
  { id: "cyan",   cyan: "#00E5FF", violet: "#A855F7" },
  { id: "neon",   cyan: "#22E5A0", violet: "#FFB020" },
  { id: "magma",  cyan: "#FF6B6B", violet: "#9D4EFF" },
  { id: "ocean",  cyan: "#3D5AFE", violet: "#00B8D4" },
];

function TweaksPanel({ open, onClose, density, onDensity, glow, onGlow, accent, onAccent }) {
  if (!open) return null;
  return (
    <div className="tw-panel">
      <div className="tw-panel__head">
        <span className="t-label">Tweaks</span>
        <button className="tw-panel__close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="tw-row">
        <div className="tw-row__l">
          <span>Accent</span>
          <span className="tw-row__v">{accent}</span>
        </div>
        <div className="tw-swatches">
          {ACCENT_PRESETS.map(p => (
            <div
              key={p.id}
              className={"tw-swatch " + (accent === p.id ? "tw-swatch--on" : "")}
              style={{ background: `linear-gradient(90deg, ${p.cyan}, ${p.violet})` }}
              onClick={() => onAccent(p.id)}
              title={p.id}
            />
          ))}
        </div>
      </div>

      <div className="tw-row">
        <div className="tw-row__l">
          <span>Density</span>
          <span className="tw-row__v">{density}</span>
        </div>
        <div className="tw-segs">
          {["cozy", "dense"].map(d => (
            <button key={d} className={"tw-seg " + (density === d ? "is-on" : "")} onClick={() => onDensity(d)}>{d}</button>
          ))}
        </div>
      </div>

      <div className="tw-row">
        <div className="tw-row__l">
          <span>Glow intensity</span>
          <span className="tw-row__v">{glow}</span>
        </div>
        <div className="tw-segs">
          {["low", "medium", "high"].map(g => (
            <button key={g} className={"tw-seg " + (glow === g ? "is-on" : "")} onClick={() => onGlow(g)}>{g}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TweaksPanel, ACCENT_PRESETS });
