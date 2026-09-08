-- Migration 0013: Logic Model (Outputs + Outcomes) for Grant Tracker
--
-- Adds logic_inputs and logic_activities narrative columns to grant_applications.
-- Creates grant_outputs (countable deliverables, always numeric) and
-- grant_outcomes (population change, numeric OR narrative) as separate lists.
-- Creates output_actuals and outcome_actuals for per-period reporting.
--
-- Met threshold: actual >= 100% of target (was >=97% in v1 OKR design).
-- Narrative-only outcomes: "reported" / "not yet reported" instead of met/partial/missed.
-- Outputs and Outcomes are stored as separate lists, not merged.

ALTER TABLE grant_applications ADD COLUMN logic_inputs    TEXT;
ALTER TABLE grant_applications ADD COLUMN logic_activities TEXT;

-- grant_outputs: immediate, countable deliverables (numeric target required)
CREATE TABLE IF NOT EXISTS grant_outputs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_application_id INTEGER NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  description          TEXT NOT NULL,
  target_value         REAL NOT NULL,
  unit                 TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- grant_outcomes: change in target population (numeric OR narrative)
-- is_narrative = 1: status is "reported" / "not yet reported", no target_value required.
-- is_narrative = 0: status is met / partial / missed based on numeric actual vs target.
CREATE TABLE IF NOT EXISTS grant_outcomes (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_application_id INTEGER NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  description          TEXT NOT NULL,
  is_narrative         INTEGER NOT NULL DEFAULT 0,
  target_value         REAL,
  target_narrative     TEXT,
  unit                 TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

-- output_actuals: numeric actual logged per Output per reporting period
CREATE TABLE IF NOT EXISTS output_actuals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  output_id            INTEGER NOT NULL REFERENCES grant_outputs(id) ON DELETE CASCADE,
  reporting_period_id  INTEGER NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
  actual_value         REAL NOT NULL,
  computed_status      TEXT NOT NULL DEFAULT 'partial',
  logged_by            TEXT NOT NULL,
  logged_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(output_id, reporting_period_id)
);

-- outcome_actuals: actual logged per Outcome per reporting period
-- Numeric outcomes: actual_value + computed_status (met/partial/missed)
-- Narrative outcomes: actual_narrative + computed_status (reported/not yet reported)
CREATE TABLE IF NOT EXISTS outcome_actuals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  outcome_id           INTEGER NOT NULL REFERENCES grant_outcomes(id) ON DELETE CASCADE,
  reporting_period_id  INTEGER NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
  actual_value         REAL,
  actual_narrative     TEXT,
  computed_status      TEXT NOT NULL DEFAULT 'not yet reported',
  logged_by            TEXT NOT NULL,
  logged_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(outcome_id, reporting_period_id)
);

CREATE INDEX IF NOT EXISTS idx_grant_outputs_app      ON grant_outputs  (grant_application_id);
CREATE INDEX IF NOT EXISTS idx_grant_outcomes_app     ON grant_outcomes (grant_application_id);
CREATE INDEX IF NOT EXISTS idx_output_actuals_period  ON output_actuals (reporting_period_id);
CREATE INDEX IF NOT EXISTS idx_output_actuals_output  ON output_actuals (output_id);
CREATE INDEX IF NOT EXISTS idx_outcome_actuals_period ON outcome_actuals (reporting_period_id);
CREATE INDEX IF NOT EXISTS idx_outcome_actuals_outcome ON outcome_actuals (outcome_id);
