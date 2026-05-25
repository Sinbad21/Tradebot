/* statcard.jsx — StatCard component for Milestone 1 validation */

const { useState: useStateSC, useEffect: useEffectSC, useRef: useRefSC } = React;

function StatCard({
  label,
  info,
  icon,
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  unit,
  delta,           // number, signed — interpreted as %
  deltaLabel,      // e.g. "vs yesterday"
  spark = [],
  tone = "cyan",   // cyan | violet | profit | loss | neutral
  signal = false,  // adds animated gradient border
  live = true,
  hero = false,
}) {
  const animated = useAnimatedNumber(value, { duration: 700, decimals });

  // detect direction of value change to flash
  const prev = useRefSC(value);
  const [flash, setFlash] = useStateSC(null);
  useEffectSC(() => {
    if (value === prev.current) return;
    setFlash(value > prev.current ? "up" : "down");
    prev.current = value;
    const t = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(t);
  }, [value]);

  const positive = (delta ?? 0) > 0;
  const negative = (delta ?? 0) < 0;

  return (
    <Glass
      className={[
        "statcard",
        hero && "statcard--hero",
        signal && "statcard--signal",
      ].filter(Boolean).join(" ")}
      gradient={signal}
    >
      <div className="statcard__head">
        <span className="statcard__label">
          <span className="statcard__icon">{icon}</span>
          {label}
          {info ? (
            <InfoTip title={info.title || label} align={info.align || "right"} width={info.width || 280}>
              {info.body}
            </InfoTip>
          ) : null}
        </span>
        {live && (
          <span className="statcard__live">
            <span className="dot" />
            LIVE
          </span>
        )}
      </div>

      <div
        className={[
          "statcard__value",
          flash === "up" && "statcard__value--flash-up",
          flash === "down" && "statcard__value--flash-down",
        ].filter(Boolean).join(" ")}
      >
        {fmt(animated, { decimals, prefix, suffix })}
        {unit && <span className="unit">{unit}</span>}
      </div>

      <div className="statcard__foot">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {delta !== undefined && (
            <span
              className={[
                "statcard__delta",
                positive && "statcard__delta--up",
                negative && "statcard__delta--down",
                !positive && !negative && "statcard__delta--flat",
              ].filter(Boolean).join(" ")}
            >
              {positive ? I.up : negative ? I.down : null}
              {positive ? "+" : ""}{delta.toFixed(2)}%
            </span>
          )}
          {deltaLabel && <span className="statcard__caption">{deltaLabel}</span>}
        </div>
        {spark && spark.length > 0 && (
          <div className="statcard__sparkline">
            <Sparkline
              data={spark}
              width={hero ? 240 : 96}
              height={hero ? 56 : 32}
              tone={tone}
            />
          </div>
        )}
      </div>
    </Glass>
  );
}

Object.assign(window, { StatCard });
