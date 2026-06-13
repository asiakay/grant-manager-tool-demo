-- Migration 0005: add email column to users for password recovery via email
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email) WHERE email IS NOT NULL;
