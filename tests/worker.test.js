import { env, createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker from "../worker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetch(request) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function formRequest(url, fields) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(url, { method: "POST", body });
}

// email must be a valid email address — backend validates format on /signup.
async function createAndLoginUser(email, password) {
  await fetch(formRequest("http://localhost/signup", {
    username: email,
    password,
    confirm_password: password,
  }));
  const res = await fetch(formRequest("http://localhost/login", { username: email, password }));
  const cookie = res.headers.get("Set-Cookie");
  const token = cookie?.match(/session=([^;]+)/)?.[1];
  let csrf = null;
  if (token) {
    const csrfRes = await fetch(new Request("http://localhost/api/csrf", {
      headers: { Cookie: `session=${token}` },
    }));
    csrf = (await csrfRes.json()).token;
  }
  return { token, csrf };
}

// Logs in as the built-in demo admin account (seeded by migration 0003).
async function loginAdmin() {
  const res = await fetch(formRequest("http://localhost/login", { username: "demo", password: "demo" }));
  const token = res.headers.get("Set-Cookie")?.match(/session=([^;]+)/)?.[1];
  const csrfRes = await fetch(new Request("http://localhost/api/csrf", {
    headers: { Cookie: `session=${token}` },
  }));
  return { token, csrf: (await csrfRes.json()).token };
}

function authedHeaders(token, csrf, extra = {}) {
  return { Cookie: `session=${token}`, ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...extra };
}

async function authedGet(path, token) {
  return fetch(new Request(`http://localhost${path}`, {
    headers: { Cookie: `session=${token}` },
  }));
}

async function authedPostJson(path, token, csrf, body) {
  return fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: authedHeaders(token, csrf, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  }));
}

// Inserts three test grants using the post-migration snake_case schema.
// The programs table is created by migrations; this only inserts rows.
//   Grant Alpha: Rolling cadence (CadenceRecency=1.0), highest Relevance
//   Grant Beta:  stack_required=1, far-future deadline (CadenceRecency≈0), highest Ease
//   Grant Gamma: No deadline (CadenceRecency=0), highest Fit
async function seedPrograms() {
  await env.GRANT_MANAGER_DB.prepare(`
    INSERT INTO programs (name, sponsor, relevance, fit, ease, stack_required, cadence, deadline)
    VALUES
      ('Grant Alpha', 'Sponsor A', 3, 2, 1, 0, 'Rolling', NULL),
      ('Grant Beta',  'Sponsor B', 1, 1, 3, 1, 'Annual',  '2099-12-31'),
      ('Grant Gamma', 'Sponsor C', 2, 3, 2, 0, 'Annual',  NULL)
  `).run();
}

// ---------------------------------------------------------------------------
// Schema bootstrap
//
// @cloudflare/vitest-pool-workers does not auto-apply D1 migrations, so we
// recreate the full schema (all tables + the demo seed row) after every reset.
// This mirrors the state that wrangler migrations produce in production.
// ---------------------------------------------------------------------------

async function createSchema() {
  const db = env.GRANT_MANAGER_DB;
  await db.batch([
    // Mirrors PROGRAMS_SCHEMA in worker.js (post migration 0009) — keep in sync
    // whenever a new `programs` column ships, or code paths that read/write it
    // will silently no-op here (SELECT * just omits missing columns) or throw
    // "no such column" on INSERT (as syncGrantsWithD1's fuller column list does).
    db.prepare(`CREATE TABLE IF NOT EXISTS programs (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      type                 TEXT,
      name                 TEXT NOT NULL UNIQUE,
      sponsor              TEXT,
      source_url           TEXT,
      region_eligibility   TEXT,
      deadline             TEXT,
      cadence              TEXT,
      benefits             TEXT,
      eligibility_conditions TEXT,
      stage                TEXT,
      non_dilutive         INTEGER,
      stack_required       INTEGER,
      relevance            REAL,
      fit                  REAL,
      ease                 REAL,
      weighted_score       REAL,
      notes                TEXT,
      pdf_url              TEXT,
      ai_score             REAL,
      ai_summary           TEXT,
      ai_tier              TEXT,
      ai_scored_at         TEXT,
      opportunity_id       TEXT,
      opportunity_number   TEXT,
      cfda_numbers         TEXT,
      eligible_applicants  TEXT,
      award_ceiling        REAL,
      award_floor          REAL,
      is_forecast          INTEGER DEFAULT 0,
      estimated_post_date  TEXT,
      source_channel       TEXT,
      last_synced_at       TEXT
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_programs_opportunity_id
      ON programs (opportunity_id) WHERE opportunity_id IS NOT NULL`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      username      TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      email         TEXT,
      is_admin      INTEGER DEFAULT 0
    )`),
    // Demo account: legacy SHA-256 hash of "demo" (see migration 0007).
    db.prepare(`INSERT OR IGNORE INTO users (username, password_hash, created_at)
      VALUES ('demo', '2a97516c354b68848cdbd8f54a226a0a55b21ed138e207ad6c5cbb9c00aa5aea', 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS feedback (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment      TEXT,
      email        TEXT,
      opted_in     INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL,
      user_agent   TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS subscribers (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT NOT NULL UNIQUE,
      subscribed_at TEXT NOT NULL
    )`),
    // Compliance tables (migration 0010)
    db.prepare(`CREATE TABLE IF NOT EXISTS compliance_grants (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id    INTEGER,
      grant_name    TEXT NOT NULL,
      funder        TEXT,
      total_awarded REAL,
      period_start  TEXT,
      period_end    TEXT,
      status        TEXT NOT NULL DEFAULT 'active',
      created_by    TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS budget_lines (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      compliance_grant_id  INTEGER NOT NULL,
      category             TEXT NOT NULL,
      allocated            REAL NOT NULL DEFAULT 0,
      spent                REAL NOT NULL DEFAULT 0,
      notes                TEXT,
      updated_by           TEXT,
      updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      compliance_grant_id  INTEGER NOT NULL,
      event_type           TEXT NOT NULL,
      actor                TEXT NOT NULL,
      description          TEXT NOT NULL,
      before_value         TEXT,
      after_value          TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS compliance_checklist (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      compliance_grant_id  INTEGER NOT NULL,
      item                 TEXT NOT NULL,
      status               TEXT NOT NULL DEFAULT 'pending',
      checked_by           TEXT,
      checked_at           TEXT,
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
  ]);
}

// Reset all KV/D1 bindings between tests so they don't contaminate each other,
// then rebuild the schema so the empty D1 has all required tables.
beforeEach(reset);
beforeEach(createSchema);

// ---------------------------------------------------------------------------
// Auth — /signup
// ---------------------------------------------------------------------------

describe("POST /signup", () => {
  it("creates a new user and returns 201", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "alice@test.example",
      password: "password1",
      confirm_password: "password1",
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects duplicate email with 409", async () => {
    const fields = { username: "bob@test.example", password: "password1", confirm_password: "password1" };
    await fetch(formRequest("http://localhost/signup", fields));
    const res = await fetch(formRequest("http://localhost/signup", fields));
    expect(res.status).toBe(409);
  });

  it("rejects a plain username that is not an email address", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "notanemail",
      password: "password1",
      confirm_password: "password1",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email/i);
  });

  it("rejects an address without a dot in the domain", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "user@nodot",
      password: "password1",
      confirm_password: "password1",
    }));
    expect(res.status).toBe(400);
  });

  it("rejects email longer than 254 characters", async () => {
    const longEmail = "a".repeat(246) + "@test.com"; // 255 chars; worker rejects length > 254
    const res = await fetch(formRequest("http://localhost/signup", {
      username: longEmail,
      password: "password1",
      confirm_password: "password1",
    }));
    expect(res.status).toBe(400);
  });

  it("rejects password shorter than 8 chars", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "carol@test.example",
      password: "abc",
      confirm_password: "abc",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8/);
  });

  it("accepts password of exactly 8 chars", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "carol@test.example",
      password: "12345678",
      confirm_password: "12345678",
    }));
    expect(res.status).toBe(201);
  });

  it("rejects mismatched passwords", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "dave@test.example",
      password: "password1",
      confirm_password: "different",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/match/i);
  });

  it("rate-limits after 5 signup attempts from the same IP", async () => {
    for (let i = 0; i < 5; i++) {
      await fetch(formRequest("http://localhost/signup", {
        username: `user${i}@test.example`,
        password: "password1",
        confirm_password: "password1",
      }));
    }
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "overflow@test.example",
      password: "password1",
      confirm_password: "password1",
    }));
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// Auth — /login
// ---------------------------------------------------------------------------

describe("POST /login", () => {
  it("logs in an existing user and sets session cookie", async () => {
    await fetch(formRequest("http://localhost/signup", {
      username: "eve@test.example",
      password: "hunter2xx",
      confirm_password: "hunter2xx",
    }));
    const res = await fetch(formRequest("http://localhost/login", {
      username: "eve@test.example",
      password: "hunter2xx",
    }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toMatch(/session=/);
    expect(cookie).toMatch(/HttpOnly/);
  });

  it("returns 401 for wrong password", async () => {
    await fetch(formRequest("http://localhost/signup", {
      username: "frank@test.example",
      password: "correct1x",
      confirm_password: "correct1x",
    }));
    const res = await fetch(formRequest("http://localhost/login", {
      username: "frank@test.example",
      password: "wrong",
    }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for unknown user", async () => {
    const res = await fetch(formRequest("http://localhost/login", {
      username: "nobody@test.example",
      password: "password1",
    }));
    expect(res.status).toBe(401);
  });

  it("rate-limits after 5 failed attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await fetch(formRequest("http://localhost/login", {
        username: "ghost@test.example", password: "bad",
      }));
    }
    const res = await fetch(formRequest("http://localhost/login", {
      username: "ghost@test.example", password: "bad",
    }));
    expect(res.status).toBe(429);
  });

  it("logs in via the built-in demo account", async () => {
    const res = await fetch(formRequest("http://localhost/login", {
      username: "demo",
      password: "demo",
    }));
    expect(res.status).toBe(302);
  });
});

// ---------------------------------------------------------------------------
// Auth — /logout
// ---------------------------------------------------------------------------

describe("GET /logout", () => {
  it("clears the session cookie and redirects", async () => {
    const { token } = await createAndLoginUser("grace@test.example", "password1x");
    const res = await fetch(new Request("http://localhost/logout", {
      headers: { Cookie: `session=${token}` },
    }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Set-Cookie")).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

// ---------------------------------------------------------------------------
// Auth — protected endpoints require login
// ---------------------------------------------------------------------------

describe("Protected endpoints reject unauthenticated requests", () => {
  it.each([
    ["GET",  "/api/grants"],
    ["GET",  "/api/me"],
    ["GET",  "/api/profile"],
    ["GET",  "/api/csrf"],
    ["POST", "/api/notes"],
    ["POST", "/api/chat"],
  ])("%s %s returns 401 without session", async (method, path) => {
    const res = await fetch(new Request(`http://localhost${path}`, { method }));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /api/csrf
// ---------------------------------------------------------------------------

describe("GET /api/csrf", () => {
  it("returns a CSRF token for authenticated user", async () => {
    const { token } = await createAndLoginUser("csrfuser@test.example", "password1x");
    const res = await authedGet("/api/csrf", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
  });

  it("returns the same token on repeated calls", async () => {
    const { token } = await createAndLoginUser("csrfuser2@test.example", "password1x");
    const a = await (await authedGet("/api/csrf", token)).json();
    const b = await (await authedGet("/api/csrf", token)).json();
    expect(a.token).toBe(b.token);
  });
});

// ---------------------------------------------------------------------------
// CSRF validation on state-changing endpoints
// ---------------------------------------------------------------------------

describe("CSRF validation", () => {
  it("POST /api/profile rejects request without CSRF token", async () => {
    const { token } = await createAndLoginUser("csrftest1@test.example", "password1x");
    const res = await fetch(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ org: "Acme" }),
    }));
    expect(res.status).toBe(403);
  });

  it("POST /api/notes rejects request without CSRF token", async () => {
    const { token } = await createAndLoginUser("csrftest2@test.example", "password1x");
    const body = new FormData();
    body.append("Name", "Test Grant");
    body.append("Notes/Actions", "some note");
    const res = await fetch(new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { Cookie: `session=${token}` },
      body,
    }));
    expect(res.status).toBe(403);
  });

  it("POST /api/profile succeeds with valid CSRF token", async () => {
    const { token, csrf } = await createAndLoginUser("csrftest3@test.example", "password1x");
    const res = await authedPostJson("/api/profile", token, csrf, { org: "Acme" });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// /api/me
// ---------------------------------------------------------------------------

describe("GET /api/me", () => {
  it("returns the logged-in email as the username field", async () => {
    const { token } = await createAndLoginUser("henry@test.example", "password1x");
    const res = await authedGet("/api/me", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.username).toBe("henry@test.example");
  });
});

// ---------------------------------------------------------------------------
// /api/health
// ---------------------------------------------------------------------------

describe("GET /api/health", () => {
  it("returns ok:true without auth", async () => {
    const res = await fetch(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// /api/profile
// ---------------------------------------------------------------------------

describe("/api/profile", () => {
  it("returns null profile for new user", async () => {
    const { token } = await createAndLoginUser("ivan@test.example", "password1x");
    const res = await authedGet("/api/profile", token);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("saves and retrieves a profile", async () => {
    const { token, csrf } = await createAndLoginUser("julia@test.example", "password1x");
    const profile = {
      org: "Acme",
      weights: { Relevance: 0.4, Fit: 0.3, Ease: 0.2, StackAlignment: 0.05, CadenceRecency: 0.05 },
    };
    const postRes = await authedPostJson("/api/profile", token, csrf, profile);
    expect(postRes.status).toBe(200);

    const getRes = await authedGet("/api/profile", token);
    const body = await getRes.json();
    expect(body.org).toBe("Acme");
    expect(body.weights.Relevance).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// /api/grants — scoring
// ---------------------------------------------------------------------------

describe("GET /api/grants — scoring", () => {
  beforeEach(seedPrograms);

  it("returns paginated envelope with data array and total", async () => {
    const { token } = await createAndLoginUser("karen@test.example", "password1x");
    const res = await authedGet("/api/grants", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(typeof body.pageSize).toBe("number");
    for (const g of body.data) {
      expect(typeof g.score).toBe("number");
      expect(g.score).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns grants sorted by score descending", async () => {
    const { token } = await createAndLoginUser("lena@test.example", "password1x");
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    for (let i = 1; i < grants.length; i++) {
      expect(grants[i - 1].score).toBeGreaterThanOrEqual(grants[i].score);
    }
  });

  it("paginates correctly with page and pageSize params", async () => {
    const { token } = await createAndLoginUser("lena2@test.example", "password1x");
    const res1 = await authedGet("/api/grants?page=1&pageSize=2", token);
    const body1 = await res1.json();
    expect(body1.data.length).toBe(2);
    expect(body1.total).toBe(3);
    expect(body1.page).toBe(1);
    const res2 = await authedGet("/api/grants?page=2&pageSize=2", token);
    const body2 = await res2.json();
    expect(body2.data.length).toBe(1);
    expect(body2.page).toBe(2);
    const names1 = body1.data.map((g) => g.Name);
    const names2 = body2.data.map((g) => g.Name);
    expect(names1.every((n) => !names2.includes(n))).toBe(true);
  });

  it("applies custom weights from user profile", async () => {
    const { token, csrf } = await createAndLoginUser("mike@test.example", "password1x");
    // Weight Ease heavily so Grant Beta (ease=3) scores highest
    await authedPostJson("/api/profile", token, csrf,
      { weights: { Relevance: 0, Fit: 0, Ease: 1, StackAlignment: 0, CadenceRecency: 0 } });
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    expect(grants[0].Name).toBe("Grant Beta");
  });

  it("applies default weights when no profile exists", async () => {
    const { token } = await createAndLoginUser("nina@test.example", "password1x");
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    expect(grants[0].Name).toBe("Grant Alpha");
  });

  it("StackAlignment scoring: stack_required=1 scores highest", async () => {
    const { token, csrf } = await createAndLoginUser("omar@test.example", "password1x");
    await authedPostJson("/api/profile", token, csrf,
      { weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 1, CadenceRecency: 0 } });
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    expect(grants[0].Name).toBe("Grant Beta");
  });

  it("CadenceRecency: rolling cadence scores highest", async () => {
    const { token, csrf } = await createAndLoginUser("petra@test.example", "password1x");
    await authedPostJson("/api/profile", token, csrf,
      { weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 0, CadenceRecency: 1 } });
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    expect(grants[0].Name).toBe("Grant Alpha");
  });

  it("deadlines more than 365 days away score 0 for CadenceRecency", async () => {
    const { token, csrf } = await createAndLoginUser("quinn@test.example", "password1x");
    await authedPostJson("/api/profile", token, csrf,
      { weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 0, CadenceRecency: 1 } });
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    const beta = grants.find((g) => g.Name === "Grant Beta");
    expect(beta.score).toBe(0);
  });

  it("past deadlines score 0 for CadenceRecency", async () => {
    const { token, csrf } = await createAndLoginUser("rosa2@test.example", "password1x");
    await env.GRANT_MANAGER_DB.prepare(
      `INSERT INTO programs (name, sponsor, relevance, fit, ease, stack_required, cadence, deadline)
       VALUES ('Grant Past', 'Sponsor P', 0, 0, 0, 0, 'Annual', '2020-01-01')`
    ).run();
    await authedPostJson("/api/profile", token, csrf,
      { weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 0, CadenceRecency: 1 } });
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    const past = grants.find((g) => g.Name === "Grant Past");
    expect(past.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/grants — Grants.gov structured field filters (award range, forecast,
// CFDA dedupe)
// ---------------------------------------------------------------------------

describe("GET /api/grants — Grants.gov filters", () => {
  async function seedGrantsGovRows() {
    await env.GRANT_MANAGER_DB.batch([
      env.GRANT_MANAGER_DB.prepare(`
        INSERT INTO programs (name, sponsor, relevance, fit, ease, opportunity_id, award_ceiling, award_floor, cfda_numbers, deadline, is_forecast)
        VALUES ('Small Posted Grant', 'Sponsor A', 1, 1, 1, '1', 50000, 10000, '10.001', '2026-08-01', 0)
      `),
      env.GRANT_MANAGER_DB.prepare(`
        INSERT INTO programs (name, sponsor, relevance, fit, ease, opportunity_id, award_ceiling, award_floor, cfda_numbers, deadline, is_forecast)
        VALUES ('Large Posted Grant', 'Sponsor B', 1, 1, 1, '2', 5000000, 100000, '10.002', '2026-09-01', 0)
      `),
      env.GRANT_MANAGER_DB.prepare(`
        INSERT INTO programs (name, sponsor, relevance, fit, ease, opportunity_id, award_ceiling, award_floor, cfda_numbers, estimated_post_date, is_forecast)
        VALUES ('Forecasted Grant', 'Sponsor C', 1, 1, 1, '3', 2000000, 200000, '10.003', '2026-12-01', 1)
      `),
      // Two cohort-year variants of the same underlying program (shared CFDA), different deadlines.
      env.GRANT_MANAGER_DB.prepare(`
        INSERT INTO programs (name, sponsor, relevance, fit, ease, opportunity_id, award_ceiling, cfda_numbers, deadline, is_forecast)
        VALUES ('Annual Program 2025', 'Sponsor D', 1, 1, 1, '4', 100000, '10.004', '2025-06-01', 0)
      `),
      env.GRANT_MANAGER_DB.prepare(`
        INSERT INTO programs (name, sponsor, relevance, fit, ease, opportunity_id, award_ceiling, cfda_numbers, deadline, is_forecast)
        VALUES ('Annual Program 2026', 'Sponsor D', 1, 1, 1, '5', 100000, '10.004', '2026-06-01', 0)
      `),
    ]);
  }
  beforeEach(seedGrantsGovRows);

  it("excludes forecasted opportunities by default", async () => {
    const { token } = await createAndLoginUser("gg1@test.example", "password1x");
    const { data } = await (await authedGet("/api/grants", token)).json();
    expect(data.some((g) => g.Name === "Forecasted Grant")).toBe(false);
  });

  it("includes forecasted opportunities when includeForecast=true", async () => {
    const { token } = await createAndLoginUser("gg2@test.example", "password1x");
    const { data } = await (await authedGet("/api/grants?includeForecast=true", token)).json();
    const forecasted = data.find((g) => g.Name === "Forecasted Grant");
    expect(forecasted).toBeTruthy();
    expect(forecasted["Is Forecast"]).toBe(true);
    expect(forecasted["Estimated Post Date"]).toBe("2026-12-01");
  });

  it("minAward filters out grants whose ceiling is below the threshold", async () => {
    const { token } = await createAndLoginUser("gg3@test.example", "password1x");
    const { data } = await (await authedGet("/api/grants?minAward=1000000", token)).json();
    const names = data.map((g) => g.Name);
    expect(names).toContain("Large Posted Grant");
    expect(names).not.toContain("Small Posted Grant");
  });

  it("maxAward filters out grants whose floor exceeds the cap", async () => {
    const { token } = await createAndLoginUser("gg4@test.example", "password1x");
    const { data } = await (await authedGet("/api/grants?maxAward=20000", token)).json();
    const names = data.map((g) => g.Name);
    expect(names).toContain("Small Posted Grant");
    expect(names).not.toContain("Large Posted Grant");
  });

  it("exposes Award Ceiling/Floor and CFDA Numbers on each row", async () => {
    const { token } = await createAndLoginUser("gg5@test.example", "password1x");
    const { data } = await (await authedGet("/api/grants", token)).json();
    const small = data.find((g) => g.Name === "Small Posted Grant");
    expect(small["Award Ceiling"]).toBe(50000);
    expect(small["Award Floor"]).toBe(10000);
    expect(small["CFDA Numbers"]).toBe("10.001");
  });

  it("dedupeByCfda (default) collapses cohort-year duplicates, keeping the latest deadline", async () => {
    const { token } = await createAndLoginUser("gg6@test.example", "password1x");
    const { data } = await (await authedGet("/api/grants", token)).json();
    const variants = data.filter((g) => g["CFDA Numbers"] === "10.004");
    expect(variants.length).toBe(1);
    expect(variants[0].Name).toBe("Annual Program 2026");
  });

  it("dedupeByCfda=false returns every cohort-year variant", async () => {
    const { token } = await createAndLoginUser("gg7@test.example", "password1x");
    const { data } = await (await authedGet("/api/grants?dedupeByCfda=false", token)).json();
    const variants = data.filter((g) => g["CFDA Numbers"] === "10.004");
    expect(variants.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// /api/notes
// ---------------------------------------------------------------------------

describe("POST /api/notes", () => {
  beforeEach(seedPrograms);

  it("rejects unauthenticated request with 401", async () => {
    const res = await fetch(formRequest("http://localhost/api/notes", {
      Name: "Grant Alpha",
      "Notes/Actions": "Follow up in Q3",
    }));
    expect(res.status).toBe(401);
  });

  it("rejects authenticated request without CSRF token", async () => {
    const { token } = await createAndLoginUser("rosa@test.example", "password1x");
    const body = new FormData();
    body.append("Name", "Grant Alpha");
    body.append("Notes/Actions", "Apply by July");
    const res = await fetch(new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { Cookie: `session=${token}` },
      body,
    }));
    expect(res.status).toBe(403);
  });

  it("saves a note when authenticated with valid CSRF token", async () => {
    const { token, csrf } = await createAndLoginUser("sam@test.example", "password1x");
    const body = new FormData();
    body.append("name", "Grant Alpha");   // handler reads form.get("name")
    body.append("notes", "Apply by July");
    const res = await fetch(new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "X-CSRF-Token": csrf },
      body,
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 400 when Name is missing", async () => {
    const { token, csrf } = await createAndLoginUser("tina@test.example", "password1x");
    const body = new FormData();
    body.append("Notes/Actions", "some note");
    const res = await fetch(new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "X-CSRF-Token": csrf },
      body,
    }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /api/ai-status
// ---------------------------------------------------------------------------

describe("GET /api/ai-status", () => {
  it("returns a boolean configured field without auth", async () => {
    const res = await fetch(new Request("http://localhost/api/ai-status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.configured).toBe("boolean");
  });
});

// ---------------------------------------------------------------------------
// Password reset flow
// ---------------------------------------------------------------------------

describe("POST /api/request-password-reset", () => {
  it("returns a reset token for a known email address", async () => {
    await fetch(formRequest("http://localhost/signup", {
      username: "resetme@test.example",
      password: "password1x",
      confirm_password: "password1x",
    }));
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "resetme@test.example" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe("string");
  });

  it("returns ok (no token) for unknown email — no user enumeration", async () => {
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@test.example" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeUndefined();
  });

  it("returns 400 when email field is missing from request body", async () => {
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid email format", async () => {
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "notanemail" }),
    }));
    expect(res.status).toBe(400);
  });

  it("rate-limits after 5 requests from the same IP", async () => {
    for (let i = 0; i < 5; i++) {
      await fetch(new Request("http://localhost/api/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `user${i}@test.example` }),
      }));
    }
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "another@test.example" }),
    }));
    expect(res.status).toBe(429);
  });
});

describe("POST /api/reset-password", () => {
  // Signs up with email and requests a password reset token (dev path — no Resend key).
  async function getResetToken(email) {
    await fetch(formRequest("http://localhost/signup", {
      username: email,
      password: "oldpassword",
      confirm_password: "oldpassword",
    }));
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }));
    return (await res.json()).token;
  }

  it("resets the password and allows login with the new password", async () => {
    const token = await getResetToken("resetuser1@test.example");
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "newpassword1", confirm_password: "newpassword1" }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Old password no longer works
    const badLogin = await fetch(formRequest("http://localhost/login", {
      username: "resetuser1@test.example", password: "oldpassword",
    }));
    expect(badLogin.status).toBe(401);

    // New password works
    const goodLogin = await fetch(formRequest("http://localhost/login", {
      username: "resetuser1@test.example", password: "newpassword1",
    }));
    expect(goodLogin.status).toBe(302);
  });

  it("rejects an invalid token", async () => {
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "bad-token", password: "newpassword1", confirm_password: "newpassword1" }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid or has expired/i);
  });

  it("rejects mismatched passwords", async () => {
    const token = await getResetToken("resetuser2@test.example");
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "newpassword1", confirm_password: "different" }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/match/i);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const token = await getResetToken("resetuser3@test.example");
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "short", confirm_password: "short" }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/8/);
  });

  it("rejects reuse of a consumed reset token", async () => {
    const token = await getResetToken("resetuser4@test.example");
    await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "newpassword1", confirm_password: "newpassword1" }),
    }));
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "anotherpass", confirm_password: "anotherpass" }),
    }));
    expect(res.status).toBe(400);
  });

  it("rejects missing required fields", async () => {
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: "sometoken" }),
    }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /data — CSV export
// ---------------------------------------------------------------------------

describe("GET /data — CSV export", () => {
  beforeEach(seedPrograms);

  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(new Request("http://localhost/data"));
    expect(res.status).toBe(401);
  });

  it("returns a CSV file with correct content-type and disposition", async () => {
    const { token } = await createAndLoginUser("csv1@test.example", "password1x");
    const res = await authedGet("/data", token);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain("attachment");
    expect(disposition).toContain(".csv");
  });

  it("returns all rows — header plus one line per grant", async () => {
    const { token } = await createAndLoginUser("csv2@test.example", "password1x");
    const res = await authedGet("/data", token);
    const text = await res.text();
    const lines = text.trim().split("\r\n");
    expect(lines.length).toBe(4); // 1 header + 3 data rows
    const names = ["Grant Alpha", "Grant Beta", "Grant Gamma"];
    for (const name of names) {
      expect(lines.some((l) => l.includes(name))).toBe(true);
    }
  });

  it("properly escapes values containing commas and quotes", async () => {
    const { token } = await createAndLoginUser("csv3@test.example", "password1x");
    await env.GRANT_MANAGER_DB.prepare(
      `INSERT INTO programs (name, sponsor, relevance, fit, ease, stack_required, cadence, deadline)
       VALUES ('Grant, Tricky "One"', 'Sponsor', 1, 1, 1, 0, 'Annual', NULL)`
    ).run();
    const res = await authedGet("/data", token);
    const text = await res.text();
    expect(text).toContain('"Grant, Tricky ""One"""');
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/upload-csv
// ---------------------------------------------------------------------------

describe("POST /api/admin/upload-csv", () => {
  function csvRequest(token, csrf, csvText, mode = "merge") {
    const body = new FormData();
    body.append("file", new File([csvText], "grants.csv", { type: "text/csv" }));
    body.append("mode", mode);
    return new Request("http://localhost/api/admin/upload-csv", {
      method: "POST",
      headers: { Cookie: `session=${token}`, ...(csrf ? { "X-CSRF-Token": csrf } : {}) },
      body,
    });
  }

  const SAMPLE_CSV =
    'Name,Sponsor,Type,Relevance,Fit,Ease\r\n' +
    'Upload Grant One,Sponsor X,Grant,3,2,1\r\n' +
    '"Upload, Grant ""Two""",Sponsor Y,Fellowship,1,3,2\r\n';

  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(new Request("http://localhost/api/admin/upload-csv", { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users with 403", async () => {
    const { token, csrf } = await createAndLoginUser("notadmin@test.example", "password1x");
    const res = await fetch(csvRequest(token, csrf, SAMPLE_CSV));
    expect(res.status).toBe(403);
  });

  it("rejects admin request without CSRF token with 403", async () => {
    const { token } = await loginAdmin();
    const res = await fetch(csvRequest(token, null, SAMPLE_CSV));
    expect(res.status).toBe(403);
  });

  it("imports CSV rows that then appear in /api/grants", async () => {
    const { token, csrf } = await loginAdmin();
    const res = await fetch(csvRequest(token, csrf, SAMPLE_CSV));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.inserted).toBe(2);
    expect(body.updated).toBe(0);

    const grantsRes = await authedGet("/api/grants", token);
    const { data, total } = await grantsRes.json();
    expect(total).toBe(2);
    const names = data.map((g) => g.Name);
    expect(names).toContain("Upload Grant One");
    expect(names).toContain('Upload, Grant "Two"');
    expect(data.find((g) => g.Name === 'Upload, Grant "Two"').Sponsor).toBe("Sponsor Y");
  });

  it("merge mode updates existing grants by Name instead of duplicating", async () => {
    const { token, csrf } = await loginAdmin();
    await fetch(csvRequest(token, csrf, SAMPLE_CSV));
    const res = await fetch(csvRequest(token, csrf,
      "Name,Sponsor\nUpload Grant One,New Sponsor\nBrand New Grant,Sponsor Z\n"));
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.updated).toBe(1);

    const { data, total } = await (await authedGet("/api/grants", token)).json();
    expect(total).toBe(3);
    expect(data.find((g) => g.Name === "Upload Grant One").Sponsor).toBe("New Sponsor");
  });

  it("replace mode deletes existing grants before importing", async () => {
    const { token, csrf } = await loginAdmin();
    await fetch(csvRequest(token, csrf, SAMPLE_CSV));
    const res = await fetch(csvRequest(token, csrf,
      "Name,Sponsor\nOnly Grant,Sponsor R\n", "replace"));
    const body = await res.json();
    expect(body.inserted).toBe(1);

    const { data, total } = await (await authedGet("/api/grants", token)).json();
    expect(total).toBe(1);
    expect(data[0].Name).toBe("Only Grant");
  });

  it("matches headers ignoring case and spacing around slashes", async () => {
    const { token, csrf } = await loginAdmin();
    await fetch(csvRequest(token, csrf, "name,Deadline/Next Cohort\nSpacing Grant,2026-12-01\n"));

    const { data } = await (await authedGet("/api/grants", token)).json();
    const g = data.find((x) => x.Name === "Spacing Grant");
    expect(g["Deadline/Next Cohort"]).toBe("2026-12-01"); // new-schema key has no spaces
  });

  it("reports unknown columns and skips rows without a Name", async () => {
    const { token, csrf } = await loginAdmin();
    const res = await fetch(csvRequest(token, csrf,
      "Name,Sponsor,Bogus Column\nGood Grant,Sponsor A,x\n,Sponsor B,y\n"));
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.skipped).toBe(1);
    expect(body.unknownColumns).toContain("Bogus Column");
  });

  it("returns 400 when the Name column is missing", async () => {
    const { token, csrf } = await loginAdmin();
    const res = await fetch(csvRequest(token, csrf, "Sponsor,Type\nSomeone,Grant\n"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Name/);
  });

  it("returns 400 for a CSV with no data rows", async () => {
    const { token, csrf } = await loginAdmin();
    const res = await fetch(csvRequest(token, csrf, "Name,Sponsor\n"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when the file field is missing", async () => {
    const { token, csrf } = await loginAdmin();
    const body = new FormData();
    body.append("mode", "merge");
    const res = await fetch(new Request("http://localhost/api/admin/upload-csv", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "X-CSRF-Token": csrf },
      body,
    }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/me — admin flag
// ---------------------------------------------------------------------------

describe("GET /api/me — admin flag", () => {
  it("reports isAdmin:true for the demo admin account", async () => {
    const { token } = await loginAdmin();
    const me = await (await authedGet("/api/me", token)).json();
    expect(me.isAdmin).toBe(true);
  });

  it("reports isAdmin:false for a regular user", async () => {
    const { token } = await createAndLoginUser("regular@test.example", "password1x");
    const me = await (await authedGet("/api/me", token)).json();
    expect(me.isAdmin).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

describe("GET /api/admin/users", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(new Request("http://localhost/api/admin/users"));
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users with 403", async () => {
    const { token } = await createAndLoginUser("nonadmin@test.example", "password1x");
    const res = await authedGet("/api/admin/users", token);
    expect(res.status).toBe(403);
  });

  it("returns an array of user objects for admin", async () => {
    const { token } = await loginAdmin();
    const res = await authedGet("/api/admin/users", token);
    expect(res.status).toBe(200);
    const users = await res.json();
    expect(Array.isArray(users)).toBe(true);
    for (const u of users) {
      expect(typeof u.email).toBe("string");
      expect(typeof u.isAdmin).toBe("boolean");
    }
  });

  it("includes newly registered users in the list", async () => {
    await createAndLoginUser("findme@test.example", "password1x");
    const { token } = await loginAdmin();
    const users = await (await authedGet("/api/admin/users", token)).json();
    expect(users.some((u) => u.email === "findme@test.example")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/set-admin
// ---------------------------------------------------------------------------

describe("POST /api/admin/set-admin", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(new Request("http://localhost/api/admin/set-admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone@test.example", isAdmin: true }),
    }));
    expect(res.status).toBe(401);
  });

  it("rejects non-admin users with 403", async () => {
    const { token, csrf } = await createAndLoginUser("plain@test.example", "password1x");
    const res = await authedPostJson("/api/admin/set-admin", token, csrf,
      { email: "plain@test.example", isAdmin: true });
    expect(res.status).toBe(403);
  });

  it("rejects request without CSRF token with 403", async () => {
    const { token } = await loginAdmin();
    const res = await fetch(new Request("http://localhost/api/admin/set-admin", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "someone@test.example", isAdmin: true }),
    }));
    expect(res.status).toBe(403);
  });

  it("grants admin to an existing user", async () => {
    await createAndLoginUser("promote@test.example", "password1x");
    const { token, csrf } = await loginAdmin();

    const res = await authedPostJson("/api/admin/set-admin", token, csrf,
      { email: "promote@test.example", isAdmin: true });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    const users = await (await authedGet("/api/admin/users", token)).json();
    expect(users.find((u) => u.email === "promote@test.example")?.isAdmin).toBe(true);
  });

  it("revokes admin from a user", async () => {
    await createAndLoginUser("demote@test.example", "password1x");
    const { token, csrf } = await loginAdmin();

    await authedPostJson("/api/admin/set-admin", token, csrf,
      { email: "demote@test.example", isAdmin: true });
    const res = await authedPostJson("/api/admin/set-admin", token, csrf,
      { email: "demote@test.example", isAdmin: false });
    expect(res.status).toBe(200);

    const users = await (await authedGet("/api/admin/users", token)).json();
    expect(users.find((u) => u.email === "demote@test.example")?.isAdmin).toBe(false);
  });

  it("returns 400 when email is missing from request body", async () => {
    const { token, csrf } = await loginAdmin();
    const res = await authedPostJson("/api/admin/set-admin", token, csrf, { isAdmin: true });
    expect(res.status).toBe(400);
  });

  it("returns 404 for an unknown email address", async () => {
    const { token, csrf } = await loginAdmin();
    const res = await authedPostJson("/api/admin/set-admin", token, csrf,
      { email: "ghost@test.example", isAdmin: true });
    expect(res.status).toBe(404);
  });

  it("returns 400 when an admin tries to remove their own admin status", async () => {
    await createAndLoginUser("second@test.example", "password1x");
    const { token: adminToken, csrf: adminCsrf } = await loginAdmin();

    // Promote second@test.example to admin
    await authedPostJson("/api/admin/set-admin", adminToken, adminCsrf,
      { email: "second@test.example", isAdmin: true });

    // Log in as the new admin and attempt self-demotion
    const loginRes = await fetch(formRequest("http://localhost/login", {
      username: "second@test.example", password: "password1x",
    }));
    const token2 = loginRes.headers.get("Set-Cookie")?.match(/session=([^;]+)/)?.[1];
    const csrf2 = (await (await fetch(new Request("http://localhost/api/csrf", {
      headers: { Cookie: `session=${token2}` },
    }))).json()).token;

    const selfRes = await authedPostJson("/api/admin/set-admin", token2, csrf2,
      { email: "second@test.example", isAdmin: false });
    expect(selfRes.status).toBe(400);
    expect((await selfRes.json()).error).toMatch(/cannot remove your own/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/feedback
// ---------------------------------------------------------------------------

describe("POST /api/feedback", () => {
  it("does not require authentication", async () => {
    const res = await fetch(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 4 }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("accepts feedback with all optional fields", async () => {
    const res = await fetch(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating: 5,
        comment: "Extremely helpful tool",
        email: "happy@test.example",
        opted_in: true,
      }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("rejects rating of 0 with 400", async () => {
    const res = await fetch(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 0 }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/rating/i);
  });

  it("rejects rating above 5 with 400", async () => {
    const res = await fetch(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 6 }),
    }));
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await fetch(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json{",
    }));
    expect(res.status).toBe(400);
  });

  it("accepts feedback without optional fields", async () => {
    const res = await fetch(new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating: 3 }),
    }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/live-search and /api/live-search-status
// ---------------------------------------------------------------------------

describe("GET /api/live-search", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(new Request("http://localhost/api/live-search?q=education"));
    expect(res.status).toBe(401);
  });

  it("returns 503 when SIMPLER_GRANTS_API_KEY is not configured", async () => {
    const { token } = await createAndLoginUser("ls1@test.example", "password1x");
    const res = await authedGet("/api/live-search?q=education", token);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.configured).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("returns 503 or 200 for blank query (key check takes priority)", async () => {
    const { token } = await createAndLoginUser("ls2@test.example", "password1x");
    const res = await authedGet("/api/live-search?q=", token);
    expect([200, 503]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// GET /api/sync — syncGrantsWithD1 (Simpler Grants.gov full-catalog pagination)
// ---------------------------------------------------------------------------

describe("GET /api/sync", () => {
  afterEach(() => {
    delete env.SIMPLER_GRANTS_API_KEY;
    vi.unstubAllGlobals();
  });

  function opp(i, overrides = {}) {
    return {
      opportunity_id: 1000 + i,
      opportunity_title: `Synced Grant ${i}`,
      agency_name: "Test Agency",
      funding_instrument: "grant",
      close_date: "2099-01-01",
      award_floor: 10000,
      award_ceiling: 500000 + i,
      applicant_types: ["nonprofit"],
      cfda_numbers: [`10.${i}`],
      opportunity_status: "posted",
      ...overrides,
    };
  }

  // First page full (100 items) so the pagination loop requests a second page;
  // second page short (10 items) so it stops there. 110 total across 2 pages.
  function mockPaginatedApi() {
    return vi.fn().mockImplementation(async (url, init) => {
      const body = JSON.parse(init.body);
      const page = body.pagination.page_offset;
      const items = page === 1
        ? Array.from({ length: 100 }, (_, i) => opp(i))
        : page === 2
          ? Array.from({ length: 10 }, (_, i) => opp(100 + i))
          : [];
      return new Response(JSON.stringify({ data: items }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
  }

  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(new Request("http://localhost/api/sync"));
    expect(res.status).toBe(401);
  });

  it("walks every page and inserts every opportunity, not just the first 25", async () => {
    env.SIMPLER_GRANTS_API_KEY = "test-key";
    const mockFetch = mockPaginatedApi();
    vi.stubGlobal("fetch", mockFetch);

    const { token } = await createAndLoginUser("sync1@test.example", "password1x");
    const res = await authedGet("/api/sync", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.inserted).toBe(110);

    // Third call would have been made if the loop didn't stop after a short page.
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const { results } = await env.GRANT_MANAGER_DB.prepare("SELECT count(*) as cnt FROM programs").all();
    expect(results[0].cnt).toBe(110);
  });

  it("maps opportunity_id, award range, and CFDA numbers into the new columns", async () => {
    env.SIMPLER_GRANTS_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ data: [opp(0)] }), { status: 200, headers: { "content-type": "application/json" } })
    ));

    const { token } = await createAndLoginUser("sync2@test.example", "password1x");
    await authedGet("/api/sync", token);

    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT * FROM programs WHERE opportunity_id = '1000'"
    ).first();
    expect(row).toBeTruthy();
    expect(row.name).toBe("Synced Grant 0");
    expect(row.award_floor).toBe(10000);
    expect(row.award_ceiling).toBe(500000);
    expect(row.cfda_numbers).toBe("10.0");
    expect(row.source_channel).toBe("simpler_api");
    expect(row.last_synced_at).toBeTruthy();
  });

  it("re-syncing the same opportunity_id updates the row instead of duplicating it", async () => {
    env.SIMPLER_GRANTS_API_KEY = "test-key";
    const respond = (items) => new Response(JSON.stringify({ data: items }), { status: 200, headers: { "content-type": "application/json" } });

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => respond([opp(0)])));
    const { token } = await createAndLoginUser("sync3@test.example", "password1x");
    await authedGet("/api/sync", token);

    // Second sync: same opportunity_id, updated title/award — should update in place.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      respond([opp(0, { opportunity_title: "Synced Grant 0 (renamed)", award_ceiling: 999999 })])
    ));
    await authedGet("/api/sync", token);

    const { results } = await env.GRANT_MANAGER_DB.prepare(
      "SELECT * FROM programs WHERE opportunity_id = '1000'"
    ).all();
    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Synced Grant 0 (renamed)");
    expect(results[0].award_ceiling).toBe(999999);
  });

  it("does not overwrite manually-edited notes on re-sync", async () => {
    env.SIMPLER_GRANTS_API_KEY = "test-key";
    const respond = (items) => new Response(JSON.stringify({ data: items }), { status: 200, headers: { "content-type": "application/json" } });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => respond([opp(0)])));

    const { token } = await createAndLoginUser("sync4@test.example", "password1x");
    await authedGet("/api/sync", token);
    await env.GRANT_MANAGER_DB.prepare("UPDATE programs SET notes = ? WHERE opportunity_id = '1000'")
      .bind("my manual note").run();

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => respond([opp(0)])));
    await authedGet("/api/sync", token);

    const row = await env.GRANT_MANAGER_DB.prepare("SELECT notes FROM programs WHERE opportunity_id = '1000'").first();
    expect(row.notes).toBe("my manual note");
  });
});

describe("GET /api/live-search-status", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await fetch(new Request("http://localhost/api/live-search-status"));
    expect(res.status).toBe(401);
  });

  it("returns configured:false when API key is not set", async () => {
    const { token } = await createAndLoginUser("ls3@test.example", "password1x");
    const res = await authedGet("/api/live-search-status", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.configured).toBe(false);
  });
});
