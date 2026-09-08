-- Migration 0014: Deadline Reminder Notifications
--
-- user_notification_prefs: one row per user; stores global opt-in state and timing.
-- reminder_overrides:  per-item opt-in/out (NULL = use global pref).
-- reminder_log:        deduplication — one send per (user, type, reference, day window).

CREATE TABLE IF NOT EXISTS user_notification_prefs (
  username          TEXT PRIMARY KEY REFERENCES users(username) ON DELETE CASCADE,
  reminders_enabled INTEGER NOT NULL DEFAULT 0,
  days_before       INTEGER NOT NULL DEFAULT 7,
  remind_deadlines  INTEGER NOT NULL DEFAULT 1,  -- grant application deadlines
  remind_periods    INTEGER NOT NULL DEFAULT 1,  -- reporting period due dates
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- type: 'deadline' (programs row) or 'period' (reporting_periods.id)
-- reference_id: programs.rowid text or reporting_periods.id text
-- enabled: 1=forced on, 0=forced off, NULL=follow global pref
CREATE TABLE IF NOT EXISTS reminder_overrides (
  username      TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  type          TEXT NOT NULL,
  reference_id  TEXT NOT NULL,
  enabled       INTEGER,
  PRIMARY KEY (username, type, reference_id)
);

-- window_key = YYYY-MM-DD so at most one email per (user, item, day)
CREATE TABLE IF NOT EXISTS reminder_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  username     TEXT NOT NULL,
  type         TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  window_key   TEXT NOT NULL,
  sent_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(username, type, reference_id, window_key)
);
