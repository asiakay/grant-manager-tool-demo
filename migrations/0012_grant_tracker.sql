-- Migration 0012: Grant Application Lifecycle & OKR Tracking
--
-- grant_applications  — full lifecycle record from application through funding.
--                       Stores periodicity so due dates can be auto-generated.
-- grant_okrs          — one or more OKRs attached to a grant application.
--                       OKRs may be revised quarterly (revision_count tracks this).
-- grant_key_results   — each Key Result under an OKR, with a numeric target.
-- reporting_periods   — auto-generated from funded_date + periodicity.
--                       Regenerated whenever funded_date or periodicity changes.
-- key_result_actuals  — actual values logged per Key Result per reporting period.
--                       Computed status: met (≥97% of target), missed (0%), partial otherwise.

CREATE TABLE IF NOT EXISTS grant_applications (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  program_id           INTEGER REFERENCES programs(id) ON DELETE SET NULL,
  grant_name           TEXT NOT NULL,
  funder               TEXT,
  total_awarded        REAL,
  -- lifecycle dates
  application_date     TEXT,
  offer_date           TEXT,
  funded_date          TEXT,
  -- current lifecycle status
  lifecycle_status     TEXT NOT NULL DEFAULT 'applied',
  -- lifecycle_status values: applied | offered | funded | closed
  -- periodicity drives auto-generated reporting_periods
  periodicity          TEXT NOT NULL DEFAULT 'one-time',
  -- periodicity values: one-time | monthly | quarterly | annual | custom
  custom_interval_days INTEGER,
  -- how many periods to generate ahead of funded_date (default generous horizon)
  period_horizon       INTEGER NOT NULL DEFAULT 4,
  notes                TEXT,
  created_by           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grant_okrs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_application_id INTEGER NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  objective            TEXT NOT NULL,
  -- OKRs can be revised quarterly; track how many times and when
  revision_count       INTEGER NOT NULL DEFAULT 0,
  last_revised_at      TEXT,
  revision_notes       TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grant_key_results (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  okr_id               INTEGER NOT NULL REFERENCES grant_okrs(id) ON DELETE CASCADE,
  description          TEXT NOT NULL,
  target_value         REAL NOT NULL,
  unit                 TEXT NOT NULL DEFAULT '',
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reporting_periods (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  grant_application_id INTEGER NOT NULL REFERENCES grant_applications(id) ON DELETE CASCADE,
  period_number        INTEGER NOT NULL,
  due_date             TEXT NOT NULL,
  -- status: upcoming | overdue | submitted
  status               TEXT NOT NULL DEFAULT 'upcoming',
  submitted_at         TEXT,
  submitted_by         TEXT,
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(grant_application_id, period_number)
);

CREATE TABLE IF NOT EXISTS key_result_actuals (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  key_result_id        INTEGER NOT NULL REFERENCES grant_key_results(id) ON DELETE CASCADE,
  reporting_period_id  INTEGER NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
  actual_value         REAL NOT NULL,
  -- computed_status: met | partial | missed
  -- met: actual >= 97% of target; missed: actual = 0; partial: otherwise
  computed_status      TEXT NOT NULL DEFAULT 'partial',
  logged_by            TEXT NOT NULL,
  logged_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(key_result_id, reporting_period_id)
);

CREATE INDEX IF NOT EXISTS idx_grant_apps_created  ON grant_applications (created_by);
CREATE INDEX IF NOT EXISTS idx_grant_apps_status   ON grant_applications (lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_grant_apps_funded   ON grant_applications (funded_date);
CREATE INDEX IF NOT EXISTS idx_grant_okrs_app      ON grant_okrs (grant_application_id);
CREATE INDEX IF NOT EXISTS idx_grant_kr_okr        ON grant_key_results (okr_id);
CREATE INDEX IF NOT EXISTS idx_reporting_periods_app ON reporting_periods (grant_application_id);
CREATE INDEX IF NOT EXISTS idx_reporting_periods_due ON reporting_periods (due_date);
CREATE INDEX IF NOT EXISTS idx_kr_actuals_period    ON key_result_actuals (reporting_period_id);
CREATE INDEX IF NOT EXISTS idx_kr_actuals_kr        ON key_result_actuals (key_result_id);
