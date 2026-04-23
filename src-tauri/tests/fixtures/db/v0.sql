CREATE TABLE scripts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  code TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  manual_run_enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT
);
-- statement --
CREATE TABLE triggers (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(script_id) REFERENCES scripts(id) ON DELETE CASCADE
);
-- statement --
CREATE TABLE script_policies (
  script_id TEXT PRIMARY KEY,
  notify_on_failure INTEGER NOT NULL,
  notify_on_success INTEGER NOT NULL,
  max_run_seconds INTEGER,
  FOREIGN KEY(script_id) REFERENCES scripts(id) ON DELETE CASCADE
);
-- statement --
CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL,
  config_json_non_secret TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- statement --
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  script_id TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  trigger_label TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  exit_code INTEGER,
  error_summary TEXT,
  coalesced_count INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(script_id) REFERENCES scripts(id) ON DELETE CASCADE
);
-- statement --
CREATE TABLE run_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  stream TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
);
-- statement --
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
-- statement --
INSERT INTO scripts (id, name, description, code, enabled, manual_run_enabled, created_at, updated_at, last_run_at)
VALUES ('script-1', 'Legacy Script', 'Script from legacy fixture', 'console.log("legacy")', 1, 1, '2026-04-23T00:00:00.000Z', '2026-04-23T00:00:00.000Z', NULL);
-- statement --
INSERT INTO script_policies (script_id, notify_on_failure, notify_on_success, max_run_seconds)
VALUES ('script-1', 1, 0, NULL);
