-- Migration 0007: fix the demo account password hash.
--
-- The hash in 0003 was a placeholder and did not match password "demo".
-- This replaces it with a correctly-derived PBKDF2-HMAC-SHA256 hash for "demo".

-- Use a legacy SHA-256 hash for the demo account (same format as all real user accounts).
-- The PBKDF2 path seeded in 0003 was throwing a runtime error in Cloudflare Workers.
UPDATE users
SET password_hash = '2a97516c354b68848cdbd8f54a226a0a55b21ed138e207ad6c5cbb9c00aa5aea'
WHERE username = 'demo';
