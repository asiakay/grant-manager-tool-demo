-- Migration 0002: fix schema — surrogate PK, typed columns, snake_case names, indexes.
--
-- The original schema used "Name" TEXT PRIMARY KEY (names are not stable IDs),
-- stored numeric scores as TEXT (breaks SQL ORDER BY / arithmetic), used TEXT for
-- boolean columns, and had column names with spaces and punctuation that require
-- quoting everywhere and cause subtle bugs.
--
-- This migration:
--   1. Creates programs_v2 with the corrected schema.
--   2. Copies existing data across with type coercions.
--   3. Drops programs and renames programs_v2 → programs.
--   4. Adds indexes on the columns most likely to be filtered or sorted.

CREATE TABLE IF NOT EXISTS programs_v2 (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  type             TEXT,
  name             TEXT NOT NULL UNIQUE,
  sponsor          TEXT,
  source_url       TEXT,
  region_eligibility TEXT,
  deadline         TEXT,
  cadence          TEXT,
  benefits         TEXT,
  eligibility_conditions TEXT,
  stage            TEXT,
  non_dilutive     INTEGER,          -- 0/1 boolean
  stack_required   INTEGER,          -- 0/1 boolean
  relevance        REAL,
  fit              REAL,
  ease             REAL,
  weighted_score   REAL,
  notes            TEXT
);

INSERT INTO programs_v2 (
  type, name, sponsor, source_url, region_eligibility, deadline, cadence,
  benefits, eligibility_conditions, stage, non_dilutive, stack_required,
  relevance, fit, ease, weighted_score, notes
)
SELECT
  "Type",
  "Name",
  "Sponsor",
  "Source URL",
  "Region / Eligibility",
  "Deadline / Next Cohort",
  "Cadence",
  "Benefits",
  "Eligibility (key conditions)",
  "Stage",
  CASE WHEN lower(trim("Non-dilutive?")) IN ('yes','true','1') THEN 1
       WHEN lower(trim("Non-dilutive?")) IN ('no','false','0') THEN 0
       ELSE NULL END,
  CASE WHEN lower(trim("Stack Required?")) IN ('yes','true','1') THEN 1
       WHEN lower(trim("Stack Required?")) IN ('no','false','0') THEN 0
       ELSE NULL END,
  CAST("Relevance"      AS REAL),
  CAST("Fit"            AS REAL),
  CAST("Ease"           AS REAL),
  CAST("Weighted Score" AS REAL),
  "Notes / Actions"
FROM programs;

DROP TABLE programs;
ALTER TABLE programs_v2 RENAME TO programs;

CREATE INDEX IF NOT EXISTS idx_programs_deadline       ON programs (deadline);
CREATE INDEX IF NOT EXISTS idx_programs_weighted_score ON programs (weighted_score);
CREATE INDEX IF NOT EXISTS idx_programs_sponsor        ON programs (sponsor);
CREATE INDEX IF NOT EXISTS idx_programs_non_dilutive   ON programs (non_dilutive);
