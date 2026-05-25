/* primitives.jsx — small shared bits for milestone 1 */

const { useState: useStatePR, useEffect: useEffectPR, useRef: useRefPR } = React;

/* ── Inline icons (Lucide-flavored, stroke 1.6) ──────────────── */
const Icon = ({ d, size = 14, stroke = 1.6, fill = "none", style }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
    aria-hidden="true"
  >
    {d}
  </svg>
);

const I = {
  search:   <Icon d={<><circle cx="11" cy="11" r="7" /><path d="m21 21-3.5-3.5" /></>} />,
  bolt:     <Icon d={<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />} />,
  brain:    <Icon d={<path d="M12 4a3 3 0 0 0-3 3v.5A2.5 2.5 0 0 0 6.5 10 2.5 2.5 0 0 0 4 12.5 2.5 2.5 0 0 0 6.5 15 2.5 2.5 0 0 0 9 17.5V18a3 3 0 0 0 6 0v-.5a2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5A2.5 2.5 0 0 0 15 7.5V7a3 3 0 0 0-3-3z" />} />,
  activity: <Icon d={<path d="M22 12h-4l-3 9L9 3l-3 9H2" />} />,
  target:   <Icon d={<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></>} />,
  layers:   <Icon d={<><path d="m12 2 9 5-9 5-9-5 9-5z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>} />,
  up:       <Icon d={<><path d="m6 15 6-6 6 6" /></>} size={12} />,
  down:     <Icon d={<><path d="m6 9 6 6 6-6" /></>} size={12} />,
  spark:    <Icon d={<path d="m3 17 6-6 4 4 8-9" />} />,
  info:     <Icon d={<><circle cx="12" cy="12" r="9" /><path d="M12 8.2v.01M11 11.5h1v5h1" /></>} size={12} />,
};

/* ── InfoTip — small (i) icon with a glass tooltip ──────────── */
function InfoTip({ title, children, align = "right", width = 280 }) {
  const [open, setOpen] = useStatePR(false);
  const [pos, setPos] = useStatePR(null);
  const triggerRef = useRefPR(null);

  function place() {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left;
    if (align === "right")  left = r.left - 12;
    else if (align === "left") left = r.right - width + 12;
    else /* center */         left = r.left + r.width / 2 - width / 2;
    // clamp to viewport with 8px margin
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    const top = r.bottom + 10;
    setPos({ left, top });
  }

  function show() { place(); setOpen(true); }
  function hide() { setOpen(false); }

  useEffectPR(() => {
    if (!open) return;
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <span
      ref={triggerRef}
      className={`itip ${open ? "itip--open" : ""} itip--${align}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => e.stopPropagation()}
      tabIndex={0}
      role="button"
      aria-label={typeof title === "string" ? `Info: ${title}` : "More info"}
    >
      <span className="itip__icon" aria-hidden="true">i</span>
      {open && pos
        ? ReactDOM.createPortal(
            <span
              className={`itip__pop itip__pop--portal itip--${align}`}
              style={{ width, left: pos.left, top: pos.top }}
              role="tooltip"
            >
              <span className="itip__title">{title}</span>
              <span className="itip__body">{children}</span>
            </span>,
            document.body
          )
        : null}
    </span>
  );
}

/* ── animated counter ───────────────────────────────────────── */
function useAnimatedNumber(target, { duration = 700, decimals = 0 } = {}) {
  const [val, setVal] = useStatePR(target);
  const startRef = useRefPR({ from: target, to: target, t0: 0 });

  useEffectPR(() => {
    const from = val;
    startRef.current = { from, to: target, t0: performance.now() };
    let raf;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      const { from, to, t0 } = startRef.current;
      const t = Math.min(1, (now - t0) / duration);
      const v = from + (to - from) * ease(t);
      setVal(v);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

/* ── Sparkline ──────────────────────────────────────────────── */
function Sparkline({ data, width = 96, height = 32, tone = "cyan", strokeWidth = 1.6, gradientId }) {
  const id = useRefPR(gradientId || `sg-${Math.random().toString(36).slice(2, 8)}`).current;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const px = (i) => (i / (data.length - 1)) * (width - 2) + 1;
  const py = (v) => height - 2 - ((v - min) / range) * (height - 4);

  const points = data.map((v, i) => `${px(i).toFixed(2)},${py(v).toFixed(2)}`).join(" ");
  const area = `M ${px(0).toFixed(2)},${height} L ${points.replaceAll(" ", " L ")} L ${px(data.length - 1).toFixed(2)},${height} Z`;

  const palette = {
    cyan:   { stroke: "var(--cyan)",   fill: "rgba(0,229,255,0.18)",  glow: "rgba(0,229,255,0.6)"  },
    violet: { stroke: "var(--violet)", fill: "rgba(168,85,247,0.18)", glow: "rgba(168,85,247,0.6)" },
    profit: { stroke: "var(--profit)", fill: "rgba(0,255,136,0.18)",  glow: "rgba(0,255,136,0.6)"  },
    loss:   { stroke: "var(--loss)",   fill: "rgba(255,61,113,0.18)", glow: "rgba(255,61,113,0.6)" },
    neutral:{ stroke: "rgba(255,255,255,0.6)", fill: "rgba(255,255,255,0.08)", glow: "rgba(255,255,255,0.3)" },
  }[tone] || { stroke: "var(--cyan)", fill: "rgba(0,229,255,0.18)", glow: "rgba(0,229,255,0.6)" };

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="trend">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor={palette.fill} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
        <filter id={`${id}-glow`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={area} fill={`url(#${id}-fill)`} />
      <polyline
        points={points}
        fill="none"
        stroke={palette.stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={`url(#${id}-glow)`}
      />
      {/* last-point dot */}
      <circle
        cx={px(data.length - 1)}
        cy={py(data[data.length - 1])}
        r={2.4}
        fill={palette.stroke}
        style={{ filter: `drop-shadow(0 0 4px ${palette.glow})` }}
      />
    </svg>
  );
}

/* ── Generic glass card ─────────────────────────────────────── */
function Glass({ children, className = "", hover = true, style, gradient = false, ...rest }) {
  return (
    <div
      className={["glass", hover && "glass--hover", gradient && "glass--gradient-border", className].filter(Boolean).join(" ")}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ── Number formatter (locale-stable) ───────────────────────── */
function fmt(value, { decimals = 0, prefix = "", suffix = "", compact = false } = {}) {
  if (compact) {
    return prefix + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value) + suffix;
  }
  return prefix + new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value) + suffix;
}

/* publish to window so other babel scripts can use them */
Object.assign(window, { Icon, I, Sparkline, Glass, useAnimatedNumber, fmt, InfoTip });
