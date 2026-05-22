/* mock-data.jsx — live shared dashboard store */

const { useSyncExternalStore } = React;

const DASHBOARD_POLL_MS = 30000;
const EMPTY_MODE_SLOTS = { safe: 0, mid: 0, aggressive: 0 };
const DEFAULT_STATUS = {
  capital: 0,
  equity: 0,
  pnl: 0,
  paused: false,
  positions: [],
  closedTrades: [],
  modes: {},
  brain: { weights: {}, totalTrained: 0, confidence: 0 },
  stats: { total: 0, wins: 0, wr: 0 },
  recentScores: [],
  maxPositions: 0,
  lastScanAt: null,
  totalScans: 0,
  scanActivity: [],
  spyStatus: null,
  dataSource: "",
};
const DEFAULT_REPORTS = {
  monthly: [],
  monthlyByMode: [],
  topAssets: [],
  worstAssets: [],
  total: { trades: 0, wins: 0, wr: 0, pnl: 0, pnl_pct: 0 },
  totalDeposited: 0,
  numDeposits: 0,
  totalInvested: 0,
  equityCurve: [],
};

const BOT_STORE = {
  state: {
    version: 0,
    loading: true,
    refreshing: false,
    error: "",
    assets: [],
    status: DEFAULT_STATUS,
    settings: {},
    settingsMeta: {},
    modeSlots: EMPTY_MODE_SLOTS,
    reports: DEFAULT_REPORTS,
    alerts: [],
    brainHistory: [],
  },
  listeners: new Set(),
  refreshPromise: null,
  intervalId: null,
};

function emitBotState() {
  window.BOT_STATE = BOT_STORE.state;
  window.ASSETS = BOT_STORE.state.assets;
  BOT_STORE.listeners.forEach((listener) => listener());
}

function updateBotState(patch) {
  BOT_STORE.state = {
    ...BOT_STORE.state,
    ...patch,
    version: BOT_STORE.state.version + 1,
  };
  emitBotState();
}

function subscribeBotState(listener) {
  BOT_STORE.listeners.add(listener);
  return () => BOT_STORE.listeners.delete(listener);
}

function useBotStore(selector = (state) => state) {
  return useSyncExternalStore(
    subscribeBotState,
    () => selector(BOT_STORE.state),
    () => selector(BOT_STORE.state)
  );
}

function colorFromTickerMD(ticker) {
  const palette = ["#00E5FF", "#A855F7", "#00FF88", "#FFB020", "#FF3D71", "#7BD7FF", "#84CC16", "#F97316"];
  let hash = 0;
  for (const ch of ticker) hash = ((hash << 5) - hash) + ch.charCodeAt(0);
  return palette[Math.abs(hash) % palette.length];
}

function normalizeAsset(asset) {
  const price = Number(asset.price) || 0;
  const spark = Array.isArray(asset.spark) && asset.spark.length
    ? asset.spark.map((value) => Number(value) || 0)
    : price > 0 ? [price * 0.994, price * 1.002, price] : [0, 0, 0];

  return {
    ...asset,
    color: asset.color || colorFromTickerMD(asset.ticker),
    price,
    chg: Number(asset.chg) || 0,
    spark,
    conf: Number(asset.conf) || 0,
    positionSize: Number(asset.positionSize) || 0,
    entryPrice: asset.entryPrice == null ? null : Number(asset.entryPrice),
    pnlAbs: Number(asset.pnlAbs) || 0,
    pnlPct: Number(asset.pnlPct) || 0,
    score: asset.score == null ? null : Number(asset.score),
    signal: Number(asset.signal) || 0,
    tradeCount: Number(asset.tradeCount) || 0,
    realizedPnl: Number(asset.realizedPnl) || 0,
    patterns: Array.isArray(asset.patterns) ? asset.patterns : [],
  };
}

async function apiJson(path, init = {}) {
  const headers = new Headers(init.headers || {});
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const response = await fetch(path, { ...init, headers });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function normalizeModeSlots(payload) {
  if (!payload) return { ...EMPTY_MODE_SLOTS };
  return payload.slots || payload;
}

function assetMapFromAssets(assets) {
  return new Map(assets.map((asset) => [asset.ticker, asset]));
}

async function refreshBotState(options = {}) {
  if (BOT_STORE.refreshPromise) return BOT_STORE.refreshPromise;
  if (!options.silent) updateBotState({ refreshing: true, error: "" });

  BOT_STORE.refreshPromise = (async () => {
    try {
      const [statusRes, watchlistRes, settingsRes, slotsRes, reportsRes, alertsRes, brainHistoryRes] = await Promise.all([
        apiJson("/api/status"),
        apiJson("/api/watchlist"),
        apiJson("/api/settings"),
        apiJson("/api/mode-slots"),
        apiJson("/api/reports"),
        apiJson("/api/alerts"),
        apiJson("/api/brain/history"),
      ]);

      const assets = (watchlistRes.assets || []).map(normalizeAsset);

      updateBotState({
        loading: false,
        refreshing: false,
        error: "",
        assets,
        status: {
          ...DEFAULT_STATUS,
          ...statusRes,
          positions: statusRes.positions || [],
          closedTrades: statusRes.closedTrades || [],
          recentScores: statusRes.recentScores || [],
          scanActivity: statusRes.scanActivity || [],
        },
        settings: settingsRes.settings || {},
        settingsMeta: settingsRes.meta || {},
        modeSlots: normalizeModeSlots(slotsRes),
        reports: { ...DEFAULT_REPORTS, ...reportsRes },
        alerts: alertsRes.alerts || [],
        brainHistory: brainHistoryRes.history || [],
      });

      return BOT_STORE.state;
    } catch (error) {
      updateBotState({
        loading: false,
        refreshing: false,
        error: error.message || "Unknown error",
      });
      throw error;
    } finally {
      BOT_STORE.refreshPromise = null;
    }
  })();

  return BOT_STORE.refreshPromise;
}

async function runAndRefresh(path, init) {
  const result = await apiJson(path, init);
  await refreshBotState({ silent: true });
  return result;
}

const BotActions = {
  refresh: (options) => refreshBotState(options),
  scan: () => runAndRefresh("/api/scan"),
  closePosition: (ticker) => runAndRefresh("/api/close", { method: "POST", body: JSON.stringify({ ticker }) }),
  closeAll: () => runAndRefresh("/api/close-all", { method: "POST" }),
  reset: () => runAndRefresh("/api/reset", { method: "POST" }),
  togglePause: (paused) => runAndRefresh("/api/pause", { method: "POST", body: JSON.stringify({ paused }) }),
  forceEntry: (ticker, mode) => runAndRefresh("/api/force-entry", { method: "POST", body: JSON.stringify({ ticker, mode }) }),
  retrainBrain: (mode) => runAndRefresh("/api/retrain", { method: "POST", body: JSON.stringify({ mode }) }),
  saveSettings: async (settings, slots) => {
    if (settings && Object.keys(settings).length) {
      await apiJson("/api/settings", { method: "POST", body: JSON.stringify(settings) });
    }
    if (slots && Object.keys(slots).length) {
      await apiJson("/api/mode-slots", { method: "POST", body: JSON.stringify(slots) });
    }
    await refreshBotState({ silent: true });
    return BOT_STORE.state;
  },
  createAlert: (payload) => runAndRefresh("/api/alerts", { method: "POST", body: JSON.stringify(payload) }),
  toggleAlert: (id) => runAndRefresh("/api/alerts/toggle", { method: "POST", body: JSON.stringify({ id }) }),
  deleteAlert: (id) => runAndRefresh("/api/alerts/delete", { method: "POST", body: JSON.stringify({ id }) }),
  updateStopLoss: (ticker, stopLoss) => runAndRefresh("/api/position/stop", { method: "POST", body: JSON.stringify({ ticker, stopLoss }) }),
  lockInPosition: (ticker, ratio = 0.5) => runAndRefresh("/api/position/lock-in", { method: "POST", body: JSON.stringify({ ticker, ratio }) }),
  fetchChart: (ticker, interval = "1h", range = "1mo") => apiJson(`/api/chart?ticker=${encodeURIComponent(ticker)}&interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`),
  exportTradesCsv: () => {
    const assetMap = assetMapFromAssets(BOT_STORE.state.assets);
    const rows = (BOT_STORE.state.status.closedTrades || []).map((trade) => {
      const asset = assetMap.get(trade.ticker);
      return [
        trade.closed_at || "",
        trade.ticker,
        trade.name || asset?.name || "",
        trade.mode || "mid",
        trade.entry_price,
        trade.exit_price,
        trade.shares,
        trade.pnl,
        trade.pnl_pct,
        trade.reason,
      ].join(",");
    });
    const csv = ["closed_at,ticker,name,mode,entry_price,exit_price,shares,pnl,pnl_pct,reason", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "tradebot-trades.csv";
    link.click();
    URL.revokeObjectURL(href);
  },
};

if (!BOT_STORE.intervalId) {
  BOT_STORE.intervalId = window.setInterval(() => {
    refreshBotState({ silent: true }).catch(() => {});
  }, DASHBOARD_POLL_MS);
}

Object.assign(window, {
  useBotStore,
  refreshBotState,
  BotActions,
  getBotState: () => BOT_STORE.state,
});

emitBotState();
refreshBotState({ silent: true }).catch(() => {});
