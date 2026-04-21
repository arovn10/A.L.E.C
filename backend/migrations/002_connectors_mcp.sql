-- Migration 002 — Connectors & MCPs multi-tenant data model (SQLite)
-- Spec: docs/superpowers/specs/2026-04-21-connectors-mcp-design.md
-- Safe to re-run: every CREATE uses IF NOT EXISTS; INSERTs use OR IGNORE.

CREATE TABLE IF NOT EXISTS organizations (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  email_domain TEXT NOT NULL UNIQUE,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS org_memberships (
  user_id    TEXT NOT NULL,
  org_id     TEXT NOT NULL REFERENCES organizations(id),
  role       TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, org_id)
);

CREATE TABLE IF NOT EXISTS connector_definitions (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  category       TEXT NOT NULL,
  icon           TEXT,
  auth_type      TEXT NOT NULL,
  fields_json    TEXT NOT NULL,
  multi_instance INTEGER NOT NULL DEFAULT 0,
  is_org_only    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS connector_instances (
  id            TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES connector_definitions(id),
  scope_type    TEXT NOT NULL CHECK (scope_type IN ('user','org')),
  scope_id      TEXT NOT NULL,
  display_name  TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  status        TEXT,
  status_detail TEXT,
  last_checked  DATETIME,
  created_by    TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  scope_type      TEXT NOT NULL CHECK (scope_type IN ('user','org')),
  scope_id        TEXT NOT NULL,
  transport       TEXT NOT NULL,
  command         TEXT,
  args_json       TEXT,
  url             TEXT,
  env_ref_ids_json TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  auto_start      INTEGER NOT NULL DEFAULT 1,
  status          TEXT,
  status_detail   TEXT,
  tools_json      TEXT,
  last_started    DATETIME,
  created_by      TEXT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  org_id        TEXT,
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     TEXT NOT NULL,
  metadata_json TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Desktop Control (addendum, spec lines 392-420)
CREATE TABLE IF NOT EXISTS desktop_permissions (
  id                  TEXT PRIMARY KEY,
  granted             INTEGER NOT NULL DEFAULT 0,
  last_checked        TEXT,
  last_probed_version TEXT
);

CREATE TABLE IF NOT EXISTS desktop_policy (
  key                TEXT PRIMARY KEY,
  mode               TEXT NOT NULL,
  session_token      TEXT,
  session_expires_at TEXT,
  kill_switch        INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT NOT NULL,
  updated_by         TEXT NOT NULL
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_instances_scope   ON connector_instances(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_mcp_scope         ON mcp_servers(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_audit_user        ON audit_log(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_memberships_user  ON org_memberships(user_id);

-- Seed rows (addendum lines 415-419)
INSERT OR IGNORE INTO desktop_policy(key, mode, kill_switch, updated_at, updated_by)
  VALUES ('default', 'session', 0, datetime('now'), 'system');

INSERT OR IGNORE INTO desktop_permissions(id, granted) VALUES
  ('accessibility', 0),
  ('screen_recording', 0),
  ('automation', 0);
