-- Migration 0006: add is_admin flag to users table.
-- Default 0 so existing rows and new inserts without the column are treated as non-admin.
-- The env var ADMIN_USERS remains the bootstrap mechanism for the initial
-- admin(s); the DB column takes over for any accounts created thereafter.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
