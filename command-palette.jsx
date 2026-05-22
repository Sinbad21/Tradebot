/* command-palette.jsx — ⌘K fuzzy search modal */

const { useState: useStateCP, useEffect: useEffectCP, useMemo: useMemoCP, useRef: useRefCP } = React;

const CMD_ACTIONS = [
  { id: "pause",   label: "Pause or resume bot",      group: "Actions", kbd: "P" },
  { id: "retrain", label: "Retrain Brain now",        group: "Actions", kbd: "R" },
  { id: "mode-safe",  label: "Switch profile · Safe",       group: "Settings" },
  { id: "mode-mid",   label: "Switch profile · Mid",        group: "Settings" },
  { id: "mode-aggressive", label: "Switch profile · Aggressive", group: "Settings" },
  { id: "view-watchlist", label: "View · Watchlist",         group: "Navigate" },
  { id: "view-brain", label: "View · Brain",                group: "Navigate" },
  { id: "view-trades",label: "View · Trades",               group: "Navigate" },
  { id: "view-alerts",label: "View · Alerts",               group: "Navigate" },
  { id: "view-settings", label: "View · Settings",          group: "Navigate" },
  { id: "export",  label: "Export 24h trade log",     group: "Actions" },
];

function fuzzy(haystack, needle) {
  if (!needle) return 0.5; // neutral when empty
  haystack = haystack.toLowerCase();
  needle = needle.toLowerCase();
  if (haystack.includes(needle)) return 1 - (haystack.indexOf(needle) / Math.max(haystack.length, 12));
  // sequential char match
  let hi = 0, score = 0;
  for (let i = 0; i < needle.length; i++) {
    const idx = haystack.indexOf(needle[i], hi);
    if (idx === -1) return 0;
    score += 1 - (idx - hi) * 0.05;
    hi = idx + 1;
  }
  return score / needle.length;
}

function CommandPalette({ open, onClose, onNavigate, onToggleMode, onTogglePause, onRetrain, onOpenAsset }) {
  const assets = useBotStore((state) => state.assets);
  const [q, setQ] = useStateCP("");
  const [cursor, setCursor] = useStateCP(0);
  const inputRef = useRefCP(null);

  useEffectCP(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffectCP(() => { setCursor(0); }, [q, open]);

  function runItem(it) {
    if (!it) return;
    if (it.id === "pause")        onTogglePause?.();
    else if (it.id === "retrain") onRetrain?.();
    else if (it.id.startsWith("mode-"))  onToggleMode?.(it.id.slice(5));
    else if (it.id.startsWith("view-"))  onNavigate?.(it.id.slice(5));
    else if (it.id.startsWith("asset-")) onOpenAsset?.(it.id.slice(6));
    else if (it.id === "export") window.BotActions.exportTradesCsv();
    onClose();
  }

  const items = useMemoCP(() => {
    const assetItems = assets.map(a => ({
      id: `asset-${a.ticker}`,
      label: `${a.ticker} · ${a.name}`,
      group: "Assets",
      kbd: null,
      tone: a.color,
      meta: `${a.exch} · $${a.price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    }));
    const all = [...CMD_ACTIONS, ...assetItems];
    if (!q) return all.slice(0, 8); // recent / default
    const scored = all
      .map(it => ({ it, s: fuzzy(it.label, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 14)
      .map(x => x.it);
    return scored;
  }, [assets, q]);

  // group items
  const grouped = useMemoCP(() => {
    const g = {};
    items.forEach(it => {
      if (!g[it.group]) g[it.group] = [];
      g[it.group].push(it);
    });
    return g;
  }, [items]);

  useEffectCP(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, items.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); runItem(items[cursor]); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, cursor, onClose]);

  if (!open) return null;

  let idx = -1;
  return ReactDOM.createPortal(
    <div className="tb-cmd-backdrop" onClick={onClose}>
      <div className="tb-cmd" onClick={(e) => e.stopPropagation()}>
        <div className="tb-cmd__search">
          <span style={{ color: "var(--text-3)" }}>{I.search}</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search assets, run an action…"
          />
          <span className="kbd" style={{ position: "static", transform: "none" }}>esc</span>
        </div>
        <div className="tb-cmd__list">
          {Object.entries(grouped).map(([group, list]) => (
            <div key={group}>
              <div className="tb-cmd-group">{group}</div>
              {list.map(it => {
                idx++;
                const active = idx === cursor;
                return (
                  <div
                    key={it.id}
                    className={`tb-cmd__item ${active ? "tb-cmd__item--active" : ""}`}
                    onMouseEnter={() => setCursor(idx)}
                    onClick={() => runItem(it)}
                  >
                    <span className="tb-cmd__item-icon">
                      {group === "Assets" ? (
                        <span style={{
                          width: 10, height: 10, borderRadius: 999,
                          background: it.tone || "var(--cyan)",
                          boxShadow: `0 0 6px ${it.tone || "var(--cyan)"}`,
                        }} />
                      ) : group === "Actions" ? I.bolt
                      :  group === "Settings" ? I.target
                      :  I.layers}
                    </span>
                    <span className="tb-cmd__item-label">{it.label}</span>
                    {it.meta && <span className="tb-cmd__item-sub">{it.meta}</span>}
                    {it.kbd && <span className="tb-cmd__item-sub">⌘ {it.kbd}</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ padding: 28, textAlign: "center", color: "var(--text-3)" }}>
              No matches for "{q}".
            </div>
          )}
        </div>
        <div className="tb-cmd__foot">
          <span><span className="k">↑↓</span> navigate · <span className="k">↵</span> select · <span className="k">esc</span> close</span>
          <span>{items.length} results</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

Object.assign(window, { CommandPalette });
