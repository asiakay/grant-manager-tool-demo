-- Migration 0005: add optional email column to users table.
ALTER TABLE users ADD COLUMN email TEXT;
