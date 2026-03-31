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
  created_at TEXT
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

-- Valori iniziali brain
INSERT OR IGNORE INTO brain VALUES ('macd_cross', 1.0, 1.0);
INSERT OR IGNORE INTO brain VALUES ('macd_hist', 0.2, 0.2);
INSERT OR IGNORE INTO brain VALUES ('rsi', 0.6, 0.6);
INSERT OR IGNORE INTO brain VALUES ('ema_trend', 0.3, 0.3);
INSERT OR IGNORE INTO brain VALUES ('bollinger', 0.5, 0.5);
INSERT OR IGNORE INTO brain VALUES ('mean_rev', 0.8, 0.8);
INSERT OR IGNORE INTO brain VALUES ('vol_growing', 0.3, 0.3);

-- Config iniziale
INSERT OR IGNORE INTO config VALUES ('capital', '5000');
INSERT OR IGNORE INTO config VALUES ('total_trades', '0');
