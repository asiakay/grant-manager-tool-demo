-- Migration 0006: add is_admin flag to users table.
-- Default 0 so existing rows and new inserts without the column are treated as non-admin.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
