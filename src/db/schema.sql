CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'web',
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tools_config (
  tool_name TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tokens_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  tokens_count INTEGER NOT NULL,
  date TEXT NOT NULL DEFAULT (date('now')),
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Valores por defecto iniciales
INSERT OR IGNORE INTO sessions (id, name) VALUES ('default', 'Chat Principal');
INSERT OR IGNORE INTO settings (key, value) VALUES ('agent_name', 'AgentAssist');
INSERT OR IGNORE INTO settings (key, value) VALUES ('agent_version', '1.0.0');
