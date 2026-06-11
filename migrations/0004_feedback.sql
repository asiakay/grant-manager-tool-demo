CREATE TABLE IF NOT EXISTS feedback (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      TEXT,
  email        TEXT,
  opted_in     INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS subscribers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  subscribed_at TEXT NOT NULL
);
