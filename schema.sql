-- Schema per trading-bot D1

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  entry_price REAL NOT NULL,
  shares REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  highest REAL NOT NULL,
  trailing_active INTEGER DEFAULT 0,
  cost REAL NOT NULL,
  opened_at TEXT NOT NULL,
  score_at_entry REAL,
  auto_sl INTEGER DEFAULT 1,
  current_price REAL,
  unrealized_pnl REAL DEFAULT 0,
  unrealized_pct REAL DEFAULT 0,
  brain_indicators TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS closed_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  entry_price REAL,
  exit_price REAL,
  shares REAL,
  cost REAL,
  revenue REAL,
  pnl REAL,
  pnl_pct REAL,
  reason TEXT,
  opened_at TEXT,
  closed_at TEXT,
  brain_indicators TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS brain (
  indicator TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  default_weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicators TEXT,
  pnl REAL,
  pnl_pct REAL,
  created_at TEXT,
  mode TEXT DEFAULT 'mid'
);

CREATE TABLE IF NOT EXISTS brain_safe (
  indicator TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  default_weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_mid (
  indicator TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  default_weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_aggressive (
  indicator TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  default_weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  ticker TEXT,
  price REAL,
  score REAL,
  rsi REAL,
  signal INTEGER,
  reasons TEXT
);

CREATE TABLE IF NOT EXISTS cooldowns (
  ticker TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot TEXT NOT NULL,
  amount REAL NOT NULL,
  year_month TEXT NOT NULL,
  created_at TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  ticker TEXT NOT NULL,
  direction TEXT,
  price REAL,
  pct REAL,
  window_size TEXT,
  conf REAL,
  pattern TEXT,
  pnl REAL,
  status TEXT NOT NULL DEFAULT 'armed',
  fired_at TEXT,
  created_at TEXT NOT NULL
);

-- Valori iniziali brain
INSERT OR IGNORE INTO brain VALUES ('macd_cross', 1.0, 1.0);
INSERT OR IGNORE INTO brain VALUES ('macd_hist', 0.2, 0.2);
INSERT OR IGNORE INTO brain VALUES ('rsi', 0.6, 0.6);
INSERT OR IGNORE INTO brain VALUES ('ema_trend', 0.3, 0.3);
INSERT OR IGNORE INTO brain VALUES ('bollinger', 0.5, 0.5);
INSERT OR IGNORE INTO brain VALUES ('mean_rev', 0.8, 0.8);
INSERT OR IGNORE INTO brain VALUES ('vol_growing', 0.3, 0.3);

INSERT OR IGNORE INTO brain_safe VALUES ('macd_cross', 1.0, 1.0);
INSERT OR IGNORE INTO brain_safe VALUES ('macd_hist', 0.2, 0.2);
INSERT OR IGNORE INTO brain_safe VALUES ('rsi', 0.6, 0.6);
INSERT OR IGNORE INTO brain_safe VALUES ('ema_trend', 0.3, 0.3);
INSERT OR IGNORE INTO brain_safe VALUES ('bollinger', 0.5, 0.5);
INSERT OR IGNORE INTO brain_safe VALUES ('mean_rev', 0.8, 0.8);
INSERT OR IGNORE INTO brain_safe VALUES ('vol_growing', 0.3, 0.3);

INSERT OR IGNORE INTO brain_mid VALUES ('macd_cross', 1.0, 1.0);
INSERT OR IGNORE INTO brain_mid VALUES ('macd_hist', 0.2, 0.2);
INSERT OR IGNORE INTO brain_mid VALUES ('rsi', 0.6, 0.6);
INSERT OR IGNORE INTO brain_mid VALUES ('ema_trend', 0.3, 0.3);
INSERT OR IGNORE INTO brain_mid VALUES ('bollinger', 0.5, 0.5);
INSERT OR IGNORE INTO brain_mid VALUES ('mean_rev', 0.8, 0.8);
INSERT OR IGNORE INTO brain_mid VALUES ('vol_growing', 0.3, 0.3);

INSERT OR IGNORE INTO brain_aggressive VALUES ('macd_cross', 1.0, 1.0);
INSERT OR IGNORE INTO brain_aggressive VALUES ('macd_hist', 0.2, 0.2);
INSERT OR IGNORE INTO brain_aggressive VALUES ('rsi', 0.6, 0.6);
INSERT OR IGNORE INTO brain_aggressive VALUES ('ema_trend', 0.3, 0.3);
INSERT OR IGNORE INTO brain_aggressive VALUES ('bollinger', 0.5, 0.5);
INSERT OR IGNORE INTO brain_aggressive VALUES ('mean_rev', 0.8, 0.8);
INSERT OR IGNORE INTO brain_aggressive VALUES ('vol_growing', 0.3, 0.3);

-- Config iniziale
INSERT OR IGNORE INTO config VALUES ('capital', '5000');
INSERT OR IGNORE INTO config VALUES ('total_trades', '0');
INSERT OR IGNORE INTO config VALUES ('scan_count', '0');
INSERT OR IGNORE INTO config VALUES ('scan_activity', '[]');
INSERT OR IGNORE INTO config VALUES ('bot_paused', '0');
INSERT OR IGNORE INTO config VALUES ('trades_safe', '0');
INSERT OR IGNORE INTO config VALUES ('trades_mid', '0');
INSERT OR IGNORE INTO config VALUES ('trades_aggressive', '0');
INSERT OR IGNORE INTO config VALUES ('slots_safe', '3');
INSERT OR IGNORE INTO config VALUES ('slots_mid', '5');
INSERT OR IGNORE INTO config VALUES ('slots_aggressive', '2');
INSERT OR IGNORE INTO config VALUES ('monthly_deposit_stocks', '500');
INSERT OR IGNORE INTO config VALUES ('monthly_deposit_fx', '200');
INSERT OR IGNORE INTO config VALUES ('monthly_deposit_enabled', '1');

-- FX tables
CREATE TABLE IF NOT EXISTS positions_fx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  entry_price REAL NOT NULL,
  shares REAL NOT NULL,
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  highest REAL NOT NULL,
  trailing_active INTEGER DEFAULT 0,
  cost REAL NOT NULL,
  opened_at TEXT NOT NULL,
  score_at_entry REAL,
  auto_sl INTEGER DEFAULT 1,
  current_price REAL,
  unrealized_pnl REAL DEFAULT 0,
  unrealized_pct REAL DEFAULT 0,
  brain_indicators TEXT DEFAULT '[]',
  mode TEXT DEFAULT 'mid'
);

CREATE TABLE IF NOT EXISTS closed_trades_fx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  entry_price REAL,
  exit_price REAL,
  shares REAL,
  cost REAL,
  revenue REAL,
  pnl REAL,
  pnl_pct REAL,
  reason TEXT,
  opened_at TEXT,
  closed_at TEXT,
  brain_indicators TEXT DEFAULT '[]',
  mode TEXT DEFAULT 'mid'
);

CREATE TABLE IF NOT EXISTS scan_log_fx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  ticker TEXT,
  price REAL,
  score REAL,
  rsi REAL,
  signal INTEGER,
  reasons TEXT
);

CREATE TABLE IF NOT EXISTS cooldowns_fx (
  ticker TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_history_fx (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  indicators TEXT,
  pnl REAL,
  pnl_pct REAL,
  created_at TEXT,
  mode TEXT DEFAULT 'mid'
);

CREATE TABLE IF NOT EXISTS brain_safe_fx (
  indicator TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  default_weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_mid_fx (
  indicator TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  default_weight REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS brain_aggressive_fx (
  indicator TEXT PRIMARY KEY,
  weight REAL NOT NULL,
  default_weight REAL NOT NULL
);

INSERT OR IGNORE INTO brain_safe_fx VALUES ('macd_cross', 1.0, 1.0);
INSERT OR IGNORE INTO brain_safe_fx VALUES ('macd_hist', 0.2, 0.2);
INSERT OR IGNORE INTO brain_safe_fx VALUES ('rsi', 0.6, 0.6);
INSERT OR IGNORE INTO brain_safe_fx VALUES ('ema_trend', 0.3, 0.3);
INSERT OR IGNORE INTO brain_safe_fx VALUES ('bollinger', 0.5, 0.5);
INSERT OR IGNORE INTO brain_safe_fx VALUES ('mean_rev', 0.8, 0.8);
INSERT OR IGNORE INTO brain_safe_fx VALUES ('vol_growing', 0.3, 0.3);

INSERT OR IGNORE INTO brain_mid_fx VALUES ('macd_cross', 1.0, 1.0);
INSERT OR IGNORE INTO brain_mid_fx VALUES ('macd_hist', 0.2, 0.2);
INSERT OR IGNORE INTO brain_mid_fx VALUES ('rsi', 0.6, 0.6);
INSERT OR IGNORE INTO brain_mid_fx VALUES ('ema_trend', 0.3, 0.3);
INSERT OR IGNORE INTO brain_mid_fx VALUES ('bollinger', 0.5, 0.5);
INSERT OR IGNORE INTO brain_mid_fx VALUES ('mean_rev', 0.8, 0.8);
INSERT OR IGNORE INTO brain_mid_fx VALUES ('vol_growing', 0.3, 0.3);

INSERT OR IGNORE INTO brain_aggressive_fx VALUES ('macd_cross', 1.0, 1.0);
INSERT OR IGNORE INTO brain_aggressive_fx VALUES ('macd_hist', 0.2, 0.2);
INSERT OR IGNORE INTO brain_aggressive_fx VALUES ('rsi', 0.6, 0.6);
INSERT OR IGNORE INTO brain_aggressive_fx VALUES ('ema_trend', 0.3, 0.3);
INSERT OR IGNORE INTO brain_aggressive_fx VALUES ('bollinger', 0.5, 0.5);
INSERT OR IGNORE INTO brain_aggressive_fx VALUES ('mean_rev', 0.8, 0.8);
INSERT OR IGNORE INTO brain_aggressive_fx VALUES ('vol_growing', 0.3, 0.3);

INSERT OR IGNORE INTO config VALUES ('initial_capital_fx', '1000');
INSERT OR IGNORE INTO config VALUES ('capital_fx', '1000');
INSERT OR IGNORE INTO config VALUES ('scan_count_fx', '0');
INSERT OR IGNORE INTO config VALUES ('scan_activity_fx', '[]');
INSERT OR IGNORE INTO config VALUES ('trades_safe_fx', '0');
INSERT OR IGNORE INTO config VALUES ('trades_mid_fx', '0');
INSERT OR IGNORE INTO config VALUES ('trades_aggressive_fx', '0');
INSERT OR IGNORE INTO config VALUES ('slots_safe_fx', '2');
INSERT OR IGNORE INTO config VALUES ('slots_mid_fx', '3');
INSERT OR IGNORE INTO config VALUES ('slots_aggressive_fx', '1');
