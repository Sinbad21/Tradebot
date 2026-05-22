/* trades.jsx — Recent closed trades feed
   Mirrors closed_trades table from schema.sql */

const { useState: useStateTR, useEffect: useEffectTR, useMemo: useMemoTR } = React;

function fmtAgo(min) {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function TradeRow({ trade }) {
  const pos = trade.pnl >= 0;
  return (
    <div className="tb-trade">
      <div className="tb-trade__chip">
        <span className="tb-trade__chip-glow" style={{
          background: `radial-gradient(circle at 30% 30%, ${trade.color}44, transparent 70%)`,
        }} />
        <span style={{ position: "relative", zIndex: 1 }}>{trade.ticker.slice(0, 4)}</span>
      </div>
      <div className="tb-trade__name">
        <div className="tb-trade__head">
          <span className="tb-trade__ticker">{trade.ticker}</span>
          <span className="tb-trade__reason">{trade.reason.replace(/_/g, " ")}</span>
        </div>
        <div className="tb-trade__meta">
          <span>{fmt(trade.shares, { decimals: trade.entry < 10 ? 2 : 0 })} @ ${fmt(trade.entry, { decimals: 2 })}</span>
          <span className="sep">→</span>
          <span>${fmt(trade.exit, { decimals: 2 })}</span>
          <span className="sep">·</span>
          <span>{fmtAgo(trade.minutesAgo)} ago</span>
        </div>
      </div>
      <div className="tb-trade__pnl">
        <span className={`tb-trade__pnl-v ${pos ? "is-pos" : "is-neg"}`}>
          {pos ? "+" : ""}${fmt(Math.abs(trade.pnl), { decimals: 2 })}
        </span>
        <span className="tb-trade__pnl-pct" style={{ color: pos ? "var(--profit)" : "var(--loss)" }}>
          {pos ? "+" : ""}{fmt(trade.pnlPct, { decimals: 2 })}%
        </span>
      </div>
    </div>
  );
}

function RecentTrades() {
  const { closedTrades, assets } = useBotStore((state) => ({
    closedTrades: state.status.closedTrades,
    assets: state.assets,
  }));
  const assetMap = useMemoTR(() => new Map((assets || []).map((asset) => [asset.ticker, asset])), [assets]);
  const trades = useMemoTR(() => {
    return (closedTrades || []).slice(0, 14).map((trade) => {
      const asset = assetMap.get(trade.ticker);
      const closedAt = trade.closed_at ? new Date(trade.closed_at) : null;
      const minutesAgo = closedAt ? Math.max(1, Math.round((Date.now() - closedAt.getTime()) / 60000)) : 0;
      return {
        ...trade,
        id: trade.id || `${trade.ticker}-${trade.closed_at || Math.random()}`,
        color: asset?.color || "#00E5FF",
        klass: asset?.klass || "stock",
        entry: Number(trade.entry_price) || 0,
        exit: Number(trade.exit_price) || 0,
        shares: Number(trade.shares) || 0,
        pnl: Number(trade.pnl) || 0,
        pnlPct: Number(trade.pnl_pct) || 0,
        reason: (trade.reason || "manual_close").toUpperCase(),
        minutesAgo,
      };
    });
  }, [assetMap, closedTrades]);
  const realized = useMemoTR(
    () => trades.reduce((sum, t) => sum + t.pnl, 0),
    [trades]
  );
  const wins = trades.filter(t => t.pnl > 0).length;
  const winRate = (wins / trades.length) * 100;

  return (
    <div className="tb-trades">
      <div className="tb-trades-head">
        <div>
          <h3 className="tb-panel__title" style={{ fontSize: 17 }}>
            Recent trades
            <InfoTip title="Recent trades" align="left" width={300}>
              Closed positions in the last 24 hours, newest first. Each row shows
              entry → exit price, shares, the exit reason (take-profit, stop-loss,
              trailing stop, Brain exit, manual…) and the realized P&L. Sourced
              from the <span className="k">closed_trades</span> table.
            </InfoTip>
          </h3>
          <div className="t-mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>
            {trades.length} closed · {winRate.toFixed(0)}% win rate
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="t-mono" style={{ fontSize: 10, color: "var(--text-4)", letterSpacing: ".14em" }}>REALIZED 24H</div>
          <div className="t-num" style={{
            fontSize: 20,
            fontWeight: 600,
            color: realized >= 0 ? "var(--profit)" : "var(--loss)",
            textShadow: realized >= 0 ? "var(--glow-profit)" : "var(--glow-loss)",
          }}>
            {realized >= 0 ? "+" : "−"}${fmt(Math.abs(realized), { decimals: 2 })}
          </div>
        </div>
      </div>

      <div className="tb-trades-list">
        {trades.map(t => <TradeRow key={t.id} trade={t} />)}
        {trades.length === 0 && (
          <div className="t-body" style={{ color: "var(--text-3)", padding: 20, textAlign: "center" }}>
            No closed trades yet.
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { RecentTrades });
