-- Migration 0009: structured fields from Grants.gov (XML Extract + Simpler Grants.gov API).
--
-- opportunity_id       — Grants.gov's numeric OpportunityID. Authoritative join key across
--                        ingestion sources; nullable so existing name-keyed rows (CSV
--                        uploads, manual entries) keep working unchanged.
-- opportunity_number   — human-readable funding opportunity number (e.g. "USDA-NIFA-OP-010").
-- cfda_numbers         — comma-joined CFDA / Assistance Listing Numbers. Lets duplicate
--                        cohort-year variants of the same program be identified deterministically.
-- eligible_applicants  — comma-joined structured eligibility categories (vs. the free-text
--                        region_eligibility/eligibility_conditions columns).
-- award_ceiling/floor  — numeric award bounds, enabling real filter/sort instead of parsing
--                        the free-text "benefits" string.
-- is_forecast          — 1 for opportunities sourced from OpportunityForecastDetail (not yet
--                        formally posted); 0 for posted opportunities.
-- estimated_post_date  — forecast-only: when a forecasted opportunity is expected to post.
-- source_channel       — which ingestion path last wrote this row ('xml_extract' |
--                        'simpler_api' | 'csv_upload' | 'pipeline').
-- last_synced_at       — ISO-8601 timestamp of the last successful sync from an authoritative
--                        source (as opposed to a manual edit).

ALTER TABLE programs ADD COLUMN opportunity_id TEXT;
ALTER TABLE programs ADD COLUMN opportunity_number TEXT;
ALTER TABLE programs ADD COLUMN cfda_numbers TEXT;
ALTER TABLE programs ADD COLUMN eligible_applicants TEXT;
ALTER TABLE programs ADD COLUMN award_ceiling REAL;
ALTER TABLE programs ADD COLUMN award_floor REAL;
ALTER TABLE programs ADD COLUMN is_forecast INTEGER DEFAULT 0;
ALTER TABLE programs ADD COLUMN estimated_post_date TEXT;
ALTER TABLE programs ADD COLUMN source_channel TEXT;
ALTER TABLE programs ADD COLUMN last_synced_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_programs_opportunity_id
  ON programs (opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_programs_cfda          ON programs (cfda_numbers);
CREATE INDEX IF NOT EXISTS idx_programs_award_ceiling ON programs (award_ceiling);
CREATE INDEX IF NOT EXISTS idx_programs_is_forecast   ON programs (is_forecast);
