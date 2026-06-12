-- Migration 0007: fix the demo account password hash.
--
-- The hash in 0003 was a placeholder and did not match password "demo".
-- This replaces it with a correctly-derived PBKDF2-HMAC-SHA256 hash for "demo".

UPDATE users
SET password_hash = 'pbkdf2$600000$b7e3a1c9f4d2806e5a391b7c8d4f2e01$7fea5fc9c994f415dcaf55df110855b363fc83ce3bafb8ca0fa567a0888ef033'
WHERE username = 'demo';
