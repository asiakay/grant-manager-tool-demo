-- Migration 0010: Compliance & Audit Trail module
--
-- compliance_grants  — a grant record flagged for compliance tracking.
--                      Links optionally to programs.id but supports standalone
--                      entry (grant_name) for grants not yet in the pipeline.
-- budget_lines       — per-category allocation vs. actual spend for a grant.
--                      The core artifact that catches the "spent programming
--                      money on something else" pattern.
-- audit_log          — append-only event trail. Never updated, only inserted.
--                      before_value/after_value are JSON snapshots.
-- compliance_checklist — funder-requirement items with pass/fail/pending/na status.

CREATE TABLE IF NOT EXISTS compliance_grants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id    INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  grant_name    TEXT NOT NULL,
  funder        TEXT,
  total_awarded REAL,
  period_start  TEXT,
  period_end    TEXT,
  status        TEXT NOT NULL DEFAULT 'active',
  -- status values: active | flagged | under_audit | resolved
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  compliance_grant_id  INTEGER NOT NULL REFERENCES compliance_grants(id) ON DELETE CASCADE,
  category             TEXT NOT NULL,
  allocated            REAL NOT NULL DEFAULT 0,
  spent                REAL NOT NULL DEFAULT 0,
  notes                TEXT,
  updated_by           TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  compliance_grant_id  INTEGER NOT NULL REFERENCES compliance_grants(id) ON DELETE CASCADE,
  event_type           TEXT NOT NULL,
  -- event_type values: budget_change | status_change | note_added | flag_raised | checklist_update
  actor                TEXT NOT NULL,
  description          TEXT NOT NULL,
  before_value         TEXT,
  after_value          TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS compliance_checklist (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  compliance_grant_id  INTEGER NOT NULL REFERENCES compliance_grants(id) ON DELETE CASCADE,
  item                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending',
  -- status values: pending | pass | fail | na
  checked_by           TEXT,
  checked_at           TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_compliance_grants_status   ON compliance_grants (status);
CREATE INDEX IF NOT EXISTS idx_compliance_grants_created  ON compliance_grants (created_by);
CREATE INDEX IF NOT EXISTS idx_budget_lines_grant         ON budget_lines (compliance_grant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_grant            ON audit_log (compliance_grant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created          ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS idx_checklist_grant            ON compliance_checklist (compliance_grant_id);
