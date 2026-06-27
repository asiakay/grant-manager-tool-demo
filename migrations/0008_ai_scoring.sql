-- Migration 0008: AI scoring columns for per-grant summaries and tier classification.
-- ai_score   — profile-matched 0–10 score (base formula + keyword proximity bonus)
-- ai_summary — 1–2 sentence plain-English summary produced by the scoring LLM
-- ai_tier    — 'Hot' | 'Warm' | 'Cool' classification for digest filtering
-- ai_scored_at — ISO-8601 timestamp of last AI scoring pass (used to skip already-scored rows)
-- pdf_url    — reserved for future attachment URL storage (nullable, not yet populated)
ALTER TABLE programs ADD COLUMN pdf_url TEXT;
ALTER TABLE programs ADD COLUMN ai_score REAL;
ALTER TABLE programs ADD COLUMN ai_summary TEXT;
ALTER TABLE programs ADD COLUMN ai_tier TEXT;
ALTER TABLE programs ADD COLUMN ai_scored_at TEXT;
CREATE INDEX IF NOT EXISTS idx_programs_ai_tier  ON programs (ai_tier);
CREATE INDEX IF NOT EXISTS idx_programs_ai_score ON programs (ai_score);
