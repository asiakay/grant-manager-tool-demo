-- Migration 0003: create users table and seed the demo account.
--
-- Password hashes use PBKDF2-HMAC-SHA256 with the format:
--   pbkdf2$<iterations>$<salt_hex>$<derived_key_hex>
--
-- The demo user password is "demo". Re-generate this hash with:
--   node -e "
--     const s=crypto.getRandomValues(new Uint8Array(16));
--     const k=await crypto.subtle.importKey('raw',new TextEncoder().encode('yourpass'),'PBKDF2',false,['deriveBits']);
--     const d=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:s,iterations:600000},k,256);
--     const h=b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
--     console.log('pbkdf2\$600000\$'+h(s)+'\$'+h(d));
--   "

CREATE TABLE IF NOT EXISTS users (
  username      TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

-- Seed the demo account. The hash below is for password "demo".
-- Replace or delete this row before any real deployment.
INSERT OR IGNORE INTO users (username, password_hash, created_at) VALUES (
  'demo',
  'pbkdf2$600000$a3f82c1d9e4b5067f1c2d3e4a5b6c7d8$40e016e2ed090c1eb36f46f7554be963921efaa0de5acc955ecfef7590d2cdd1',
  0
);
