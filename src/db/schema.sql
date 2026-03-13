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

CREATE TABLE IF NOT EXISTS tool_runtime_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT 'default',
  source TEXT NOT NULL DEFAULT 'web',
  tool_name TEXT NOT NULL DEFAULT 'unknown',
  reason TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL DEFAULT 'global',
  session_id TEXT,
  kind TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.6,
  source TEXT NOT NULL DEFAULT 'agent',
  fingerprint TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories(session_id);
CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_fingerprint ON memories(fingerprint);

CREATE TABLE IF NOT EXISTS integration_state (
  integration_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  base_url TEXT,
  auth_setting_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_ok_at DATETIME,
  last_error TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_integration_state_provider ON integration_state(provider);
CREATE INDEX IF NOT EXISTS idx_integration_state_enabled ON integration_state(enabled);

-- Valores por defecto iniciales
INSERT OR IGNORE INTO sessions (id, name) VALUES ('default', 'Chat Principal');
INSERT OR IGNORE INTO settings (key, value) VALUES ('agent_name', 'AgentAssist');
INSERT OR IGNORE INTO settings (key, value) VALUES ('agent_version', '1.0.0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('auto_memory_enabled', '1');
