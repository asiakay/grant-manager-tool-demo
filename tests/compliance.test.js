/**
 * Compliance & Audit Trail — API endpoint tests
 *
 * Tests the full surface of the compliance module:
 *   - Authentication gates (all endpoints require a session)
 *   - CSRF gates (all mutating endpoints require X-CSRF-Token)
 *   - Grant creation, listing, and detail retrieval
 *   - Budget line upsert (create and update paths)
 *   - Checklist item management and status transitions
 *   - Remediation note logging
 *   - Audit trail completeness: every mutation produces an audit_log entry
 *   - Input validation (empty strings, missing fields, invalid status values)
 *   - Over-budget detection via budget line data
 *   - Full end-to-end flow: create → populate → flag → remediate
 */

import { env, createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../worker.js";

// ---------------------------------------------------------------------------
// Helpers (mirrors worker.test.js — keep in sync if the auth flow changes)
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

async function createAndLoginUser(email, password = "Password1!") {
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

function authedGet(path, token) {
  return fetch(new Request(`http://localhost${path}`, {
    headers: { Cookie: `session=${token}` },
  }));
}

function authedPostJson(path, token, csrf, body) {
  return fetch(new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      Cookie: `session=${token}`,
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }));
}

function authedPatchJson(path, token, csrf, body) {
  return fetch(new Request(`http://localhost${path}`, {
    method: "PATCH",
    headers: {
      Cookie: `session=${token}`,
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }));
}

// Read all audit_log rows for a given compliance_grant_id directly from D1.
async function getAuditLog(grantId) {
  const rows = await env.GRANT_MANAGER_DB.prepare(
    "SELECT * FROM audit_log WHERE compliance_grant_id = ? ORDER BY created_at ASC"
  ).bind(grantId).all();
  return rows.results;
}

// ---------------------------------------------------------------------------
// Schema bootstrap — must include compliance tables from migration 0010.
// ---------------------------------------------------------------------------

async function createSchema() {
  const db = env.GRANT_MANAGER_DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sponsor TEXT,
      relevance REAL, fit REAL, ease REAL,
      stack_required INTEGER, cadence TEXT, deadline TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      email TEXT,
      is_admin INTEGER DEFAULT 0
    )`),
    // Demo account: legacy SHA-256 hash of "demo" (migration 0007).
    db.prepare(`INSERT OR IGNORE INTO users (username, password_hash, created_at)
      VALUES ('demo', '2a97516c354b68848cdbd8f54a226a0a55b21ed138e207ad6c5cbb9c00aa5aea', 0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT, email TEXT, opted_in INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL, user_agent TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      subscribed_at TEXT NOT NULL
    )`),
    // Compliance tables (migration 0010)
    db.prepare(`CREATE TABLE IF NOT EXISTS compliance_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id INTEGER,
      grant_name TEXT NOT NULL,
      funder TEXT,
      total_awarded REAL,
      period_start TEXT,
      period_end TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS budget_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compliance_grant_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      allocated REAL NOT NULL DEFAULT 0,
      spent REAL NOT NULL DEFAULT 0,
      notes TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compliance_grant_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      description TEXT NOT NULL,
      before_value TEXT,
      after_value TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS compliance_checklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      compliance_grant_id INTEGER NOT NULL,
      item TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      checked_by TEXT,
      checked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`),
  ]);
}

beforeEach(reset);
beforeEach(createSchema);

// ---------------------------------------------------------------------------
// Authentication gates
// ---------------------------------------------------------------------------

describe("Authentication — all compliance endpoints require a session", () => {
  it("GET /api/compliance/grants → 401 when unauthenticated", async () => {
    const res = await fetch(new Request("http://localhost/api/compliance/grants"));
    expect(res.status).toBe(401);
  });

  it("POST /api/compliance/grants → 401 when unauthenticated", async () => {
    const res = await fetch(new Request("http://localhost/api/compliance/grants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_name: "Test" }),
    }));
    expect(res.status).toBe(401);
  });

  it("GET /api/compliance/grants/1 → 401 when unauthenticated", async () => {
    const res = await fetch(new Request("http://localhost/api/compliance/grants/1"));
    expect(res.status).toBe(401);
  });

  it("PATCH /api/compliance/grants/1 → 401 when unauthenticated", async () => {
    const res = await fetch(new Request("http://localhost/api/compliance/grants/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "flagged" }),
    }));
    expect(res.status).toBe(401);
  });

  it("POST /api/compliance/grants/1/budget → 401 when unauthenticated", async () => {
    const res = await fetch(new Request("http://localhost/api/compliance/grants/1/budget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: "Programming", allocated: 1000, spent: 500 }),
    }));
    expect(res.status).toBe(401);
  });

  it("POST /api/compliance/grants/1/checklist → 401 when unauthenticated", async () => {
    const res = await fetch(new Request("http://localhost/api/compliance/grants/1/checklist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: "Some requirement" }),
    }));
    expect(res.status).toBe(401);
  });

  it("PATCH /api/compliance/checklist/1 → 401 when unauthenticated", async () => {
    const res = await fetch(new Request("http://localhost/api/compliance/checklist/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "pass" }),
    }));
    expect(res.status).toBe(401);
  });

  it("POST /api/compliance/grants/1/note → 401 when unauthenticated", async () => {
    const res = await fetch(new Request("http://localhost/api/compliance/grants/1/note", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Some note" }),
    }));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// CSRF gates
// ---------------------------------------------------------------------------

describe("CSRF — mutating endpoints reject requests without X-CSRF-Token", () => {
  it("POST /api/compliance/grants → 403 without CSRF token", async () => {
    const { token } = await createAndLoginUser("csrf-test@example.com");
    // Pass null for csrf → no X-CSRF-Token header sent
    const res = await authedPostJson("/api/compliance/grants", token, null, { grant_name: "Test" });
    expect(res.status).toBe(403);
  });

  it("PATCH /api/compliance/grants/:id → 403 without CSRF token", async () => {
    const { token, csrf } = await createAndLoginUser("csrf-patch@example.com");
    // Create a grant first (with valid CSRF)
    const createRes = await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "CSRF Patch Test",
    });
    const { id } = await createRes.json();
    // Then patch without CSRF
    const res = await authedPatchJson(`/api/compliance/grants/${id}`, token, null, { status: "flagged" });
    expect(res.status).toBe(403);
  });

  it("POST /api/compliance/grants/:id/budget → 403 without CSRF token", async () => {
    const { token, csrf } = await createAndLoginUser("csrf-budget@example.com");
    const createRes = await authedPostJson("/api/compliance/grants", token, csrf, { grant_name: "Budget CSRF Test" });
    const { id } = await createRes.json();
    const res = await authedPostJson(`/api/compliance/grants/${id}/budget`, token, null, {
      category: "Programming", allocated: 1000, spent: 500,
    });
    expect(res.status).toBe(403);
  });

  it("POST /api/compliance/grants/:id/checklist → 403 without CSRF token", async () => {
    const { token, csrf } = await createAndLoginUser("csrf-checklist@example.com");
    const createRes = await authedPostJson("/api/compliance/grants", token, csrf, { grant_name: "Checklist CSRF Test" });
    const { id } = await createRes.json();
    const res = await authedPostJson(`/api/compliance/grants/${id}/checklist`, token, null, { item: "Req 1" });
    expect(res.status).toBe(403);
  });

  it("PATCH /api/compliance/checklist/:id → 403 without CSRF token", async () => {
    const { token, csrf } = await createAndLoginUser("csrf-cl-patch@example.com");
    const createRes = await authedPostJson("/api/compliance/grants", token, csrf, { grant_name: "CL Patch CSRF" });
    const { id } = await createRes.json();
    await authedPostJson(`/api/compliance/grants/${id}/checklist`, token, csrf, { item: "Req" });
    const detail = await (await authedGet(`/api/compliance/grants/${id}`, token)).json();
    const itemId = detail.checklist[0].id;
    const res = await authedPatchJson(`/api/compliance/checklist/${itemId}`, token, null, { status: "pass" });
    expect(res.status).toBe(403);
  });

  it("POST /api/compliance/grants/:id/note → 403 without CSRF token", async () => {
    const { token, csrf } = await createAndLoginUser("csrf-note@example.com");
    const createRes = await authedPostJson("/api/compliance/grants", token, csrf, { grant_name: "Note CSRF Test" });
    const { id } = await createRes.json();
    const res = await authedPostJson(`/api/compliance/grants/${id}/note`, token, null, { note: "A note" });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Grant creation
// ---------------------------------------------------------------------------

describe("POST /api/compliance/grants", () => {
  it("creates a grant and returns id with 201", async () => {
    const { token, csrf } = await createAndLoginUser("create@example.com");
    const res = await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "USDA Community Programs FY2025",
      funder: "USDA Rural Development",
      total_awarded: 50000,
      period_start: "2025-01-01",
      period_end: "2025-12-31",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe("number");
    expect(body.id).toBeGreaterThan(0);
  });

  it("defaults status to 'active'", async () => {
    const { token, csrf } = await createAndLoginUser("status-default@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Status Default Test",
    })).json();
    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT status FROM compliance_grants WHERE id = ?"
    ).bind(id).first();
    expect(row.status).toBe("active");
  });

  it("records creator username in created_by", async () => {
    const email = "creator@example.com";
    const { token, csrf } = await createAndLoginUser(email);
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Creator Test",
    })).json();
    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT created_by FROM compliance_grants WHERE id = ?"
    ).bind(id).first();
    expect(row.created_by).toBe(email);
  });

  it("writes an audit_log entry on creation", async () => {
    const { token, csrf } = await createAndLoginUser("audit-create@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Audit Trail Grant",
    })).json();
    const log = await getAuditLog(id);
    expect(log.length).toBe(1);
    expect(log[0].event_type).toBe("status_change");
    expect(log[0].description).toContain("Audit Trail Grant");
  });

  it("rejects missing grant_name with 400", async () => {
    const { token, csrf } = await createAndLoginUser("missing-name@example.com");
    const res = await authedPostJson("/api/compliance/grants", token, csrf, {
      funder: "Some Funder",
    });
    expect(res.status).toBe(400);
  });

  it("rejects blank grant_name with 400", async () => {
    const { token, csrf } = await createAndLoginUser("blank-name@example.com");
    const res = await authedPostJson("/api/compliance/grants", token, csrf, { grant_name: "   " });
    expect(res.status).toBe(400);
  });

  it("optional fields can be omitted", async () => {
    const { token, csrf } = await createAndLoginUser("minimal@example.com");
    const res = await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Minimal Grant",
    });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT * FROM compliance_grants WHERE id = ?"
    ).bind(id).first();
    expect(row.funder).toBeNull();
    expect(row.total_awarded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Grant listing
// ---------------------------------------------------------------------------

describe("GET /api/compliance/grants", () => {
  it("returns empty array when no grants exist", async () => {
    const { token } = await createAndLoginUser("list-empty@example.com");
    const res = await authedGet("/api/compliance/grants", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  it("lists grants with budget_line_count and checklist_failures", async () => {
    const { token, csrf } = await createAndLoginUser("list-counts@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "List Test Grant",
    })).json();

    // Add two budget lines
    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, { category: "Programming", allocated: 10000, spent: 12000 });
    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, { category: "Admin", allocated: 2000, spent: 1000 });

    // Add two checklist items: one failing
    await authedPostJson(`/api/compliance/grants/${id}/checklist`, token, csrf, { item: "Req 1" });
    await authedPostJson(`/api/compliance/grants/${id}/checklist`, token, csrf, { item: "Req 2" });
    const detail = await (await authedGet(`/api/compliance/grants/${id}`, token)).json();
    await authedPatchJson(`/api/compliance/checklist/${detail.checklist[0].id}`, token, csrf, { status: "fail" });
    await authedPatchJson(`/api/compliance/checklist/${detail.checklist[1].id}`, token, csrf, { status: "pass" });

    const res = await authedGet("/api/compliance/grants", token);
    const list = await res.json();
    const g = list.find((x) => x.id === id);
    expect(g).toBeDefined();
    expect(g.budget_line_count).toBe(2);
    expect(g.checklist_failures).toBe(1);
  });

  it("orders grants by updated_at descending", async () => {
    const { token, csrf } = await createAndLoginUser("list-order@example.com");
    await authedPostJson("/api/compliance/grants", token, csrf, { grant_name: "First Grant" });
    await authedPostJson("/api/compliance/grants", token, csrf, { grant_name: "Second Grant" });

    const list = await (await authedGet("/api/compliance/grants", token)).json();
    expect(list[0].grant_name).toBe("Second Grant");
    expect(list[1].grant_name).toBe("First Grant");
  });
});

// ---------------------------------------------------------------------------
// Grant detail
// ---------------------------------------------------------------------------

describe("GET /api/compliance/grants/:id", () => {
  it("returns grant with budgetLines, checklist, and auditLog", async () => {
    const { token, csrf } = await createAndLoginUser("detail@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Detail Test",
      funder: "Test Funder",
    })).json();

    const res = await authedGet(`/api/compliance/grants/${id}`, token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grant).toBeDefined();
    expect(body.grant.grant_name).toBe("Detail Test");
    expect(body.grant.funder).toBe("Test Funder");
    expect(Array.isArray(body.budgetLines)).toBe(true);
    expect(Array.isArray(body.checklist)).toBe(true);
    expect(Array.isArray(body.auditLog)).toBe(true);
  });

  it("returns 404 for a non-existent grant", async () => {
    const { token } = await createAndLoginUser("not-found@example.com");
    const res = await authedGet("/api/compliance/grants/99999", token);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

describe("PATCH /api/compliance/grants/:id — status changes", () => {
  it("changes status from active to flagged", async () => {
    const { token, csrf } = await createAndLoginUser("status-change@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Status Change Test",
    })).json();

    const res = await authedPatchJson(`/api/compliance/grants/${id}`, token, csrf, { status: "flagged" });
    expect(res.status).toBe(200);

    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT status FROM compliance_grants WHERE id = ?"
    ).bind(id).first();
    expect(row.status).toBe("flagged");
  });

  it("writes a status_change audit event with before/after values", async () => {
    const { token, csrf } = await createAndLoginUser("status-audit@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Audit Status Test",
    })).json();

    await authedPatchJson(`/api/compliance/grants/${id}`, token, csrf, { status: "under_audit" });

    const log = await getAuditLog(id);
    const statusEvent = log.find((e) => e.event_type === "status_change" && e.before_value);
    expect(statusEvent).toBeDefined();
    expect(statusEvent.before_value).toBe("active");
    expect(statusEvent.after_value).toBe("under_audit");
    expect(statusEvent.description).toContain("active");
    expect(statusEvent.description).toContain("under_audit");
  });

  it("does NOT write an audit event when status is unchanged", async () => {
    const { token, csrf } = await createAndLoginUser("status-unchanged@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Status Unchanged Test",
    })).json();

    const logBefore = await getAuditLog(id);
    await authedPatchJson(`/api/compliance/grants/${id}`, token, csrf, { funder: "New Funder" });
    const logAfter = await getAuditLog(id);

    expect(logAfter.length).toBe(logBefore.length);
  });

  it("returns 404 when patching a non-existent grant", async () => {
    const { token, csrf } = await createAndLoginUser("patch-404@example.com");
    const res = await authedPatchJson("/api/compliance/grants/99999", token, csrf, { status: "flagged" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Budget lines
// ---------------------------------------------------------------------------

describe("POST /api/compliance/grants/:id/budget", () => {
  it("creates a new budget line", async () => {
    const { token, csrf } = await createAndLoginUser("budget-create@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Budget Create Test",
    })).json();

    const res = await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Programming",
      allocated: 30000,
      spent: 12000,
    });
    expect(res.status).toBe(200);

    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT * FROM budget_lines WHERE compliance_grant_id = ?"
    ).bind(id).first();
    expect(row.category).toBe("Programming");
    expect(row.allocated).toBe(30000);
    expect(row.spent).toBe(12000);
  });

  it("writes a budget_change audit event on creation", async () => {
    const { token, csrf } = await createAndLoginUser("budget-audit-create@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Budget Audit Create",
    })).json();

    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Programming",
      allocated: 30000,
      spent: 0,
    });

    const log = await getAuditLog(id);
    const budgetEvent = log.find((e) => e.event_type === "budget_change");
    expect(budgetEvent).toBeDefined();
    expect(budgetEvent.description).toContain("Programming");
  });

  it("updates an existing budget line for the same category (case-insensitive)", async () => {
    const { token, csrf } = await createAndLoginUser("budget-update@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Budget Update Test",
    })).json();

    // Create
    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Programming",
      allocated: 30000,
      spent: 10000,
    });
    // Update using different case — should update the same row
    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "programming",
      allocated: 30000,
      spent: 25000,
    });

    const rows = await env.GRANT_MANAGER_DB.prepare(
      "SELECT * FROM budget_lines WHERE compliance_grant_id = ?"
    ).bind(id).all();
    // Must be exactly one row — not two
    expect(rows.results.length).toBe(1);
    expect(rows.results[0].spent).toBe(25000);
  });

  it("writes a budget_change audit event with before/after on update", async () => {
    const { token, csrf } = await createAndLoginUser("budget-audit-update@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Budget Audit Update",
    })).json();

    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Admin",
      allocated: 5000,
      spent: 1000,
    });
    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Admin",
      allocated: 5000,
      spent: 6000,
    });

    const log = await getAuditLog(id);
    const updateEvent = log.find((e) => e.event_type === "budget_change" && e.before_value);
    expect(updateEvent).toBeDefined();
    const before = JSON.parse(updateEvent.before_value);
    const after = JSON.parse(updateEvent.after_value);
    expect(before.spent).toBe(1000);
    expect(after.spent).toBe(6000);
  });

  it("detects over-budget state through the detail endpoint", async () => {
    const { token, csrf } = await createAndLoginUser("budget-over@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Over Budget Test",
    })).json();

    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Programming",
      allocated: 10000,
      spent: 15000, // over budget
    });

    const detail = await (await authedGet(`/api/compliance/grants/${id}`, token)).json();
    const line = detail.budgetLines.find((l) => l.category === "Programming");
    expect(line.spent).toBeGreaterThan(line.allocated);
  });

  it("rejects missing category with 400", async () => {
    const { token, csrf } = await createAndLoginUser("budget-no-cat@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "No Category Test",
    })).json();

    const res = await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      allocated: 5000,
      spent: 2000,
    });
    expect(res.status).toBe(400);
  });

  it("records updated_by with the actor's username", async () => {
    const email = "budget-actor@example.com";
    const { token, csrf } = await createAndLoginUser(email);
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Actor Test",
    })).json();

    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Personnel",
      allocated: 20000,
      spent: 18000,
    });

    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT updated_by FROM budget_lines WHERE compliance_grant_id = ?"
    ).bind(id).first();
    expect(row.updated_by).toBe(email);
  });
});

// ---------------------------------------------------------------------------
// Checklist management
// ---------------------------------------------------------------------------

describe("POST /api/compliance/grants/:id/checklist", () => {
  it("adds a checklist item with default status 'pending'", async () => {
    const { token, csrf } = await createAndLoginUser("cl-create@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Checklist Create",
    })).json();

    const res = await authedPostJson(`/api/compliance/grants/${id}/checklist`, token, csrf, {
      item: "100% of funds spent on programming activities",
    });
    expect(res.status).toBe(201);

    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT * FROM compliance_checklist WHERE compliance_grant_id = ?"
    ).bind(id).first();
    expect(row.item).toBe("100% of funds spent on programming activities");
    expect(row.status).toBe("pending");
  });

  it("writes a checklist_update audit event on item creation", async () => {
    const { token, csrf } = await createAndLoginUser("cl-audit-add@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Checklist Audit Add",
    })).json();

    await authedPostJson(`/api/compliance/grants/${id}/checklist`, token, csrf, {
      item: "Submit quarterly expense report",
    });

    const log = await getAuditLog(id);
    const clEvent = log.find((e) => e.event_type === "checklist_update");
    expect(clEvent).toBeDefined();
    expect(clEvent.description).toContain("Submit quarterly expense report");
  });

  it("rejects blank item with 400", async () => {
    const { token, csrf } = await createAndLoginUser("cl-blank@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Blank Item Test",
    })).json();

    const res = await authedPostJson(`/api/compliance/grants/${id}/checklist`, token, csrf, {
      item: "   ",
    });
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/compliance/checklist/:id", () => {
  async function setupGrantWithChecklistItem(email) {
    const { token, csrf } = await createAndLoginUser(email);
    const { id: grantId } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Checklist Status Test",
    })).json();
    await authedPostJson(`/api/compliance/grants/${grantId}/checklist`, token, csrf, {
      item: "Requirement under test",
    });
    const detail = await (await authedGet(`/api/compliance/grants/${grantId}`, token)).json();
    const itemId = detail.checklist[0].id;
    return { token, csrf, grantId, itemId };
  }

  it("transitions a checklist item from pending to pass", async () => {
    const { token, csrf, itemId } = await setupGrantWithChecklistItem("cl-pass@example.com");
    const res = await authedPatchJson(`/api/compliance/checklist/${itemId}`, token, csrf, { status: "pass" });
    expect(res.status).toBe(200);

    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT status FROM compliance_checklist WHERE id = ?"
    ).bind(itemId).first();
    expect(row.status).toBe("pass");
  });

  it("transitions a checklist item to fail and records actor", async () => {
    const email = "cl-fail@example.com";
    const { token, csrf, itemId } = await setupGrantWithChecklistItem(email);
    await authedPatchJson(`/api/compliance/checklist/${itemId}`, token, csrf, { status: "fail" });

    const row = await env.GRANT_MANAGER_DB.prepare(
      "SELECT status, checked_by FROM compliance_checklist WHERE id = ?"
    ).bind(itemId).first();
    expect(row.status).toBe("fail");
    expect(row.checked_by).toBe(email);
  });

  it("writes a checklist_update audit event with before/after status", async () => {
    const { token, csrf, grantId, itemId } = await setupGrantWithChecklistItem("cl-audit-patch@example.com");
    await authedPatchJson(`/api/compliance/checklist/${itemId}`, token, csrf, { status: "pass" });

    const log = await getAuditLog(grantId);
    const patchEvent = log.find((e) => e.event_type === "checklist_update" && e.before_value);
    expect(patchEvent).toBeDefined();
    expect(patchEvent.before_value).toBe("pending");
    expect(patchEvent.after_value).toBe("pass");
  });

  it("supports all valid status values: pending, pass, fail, na", async () => {
    const { token, csrf, itemId } = await setupGrantWithChecklistItem("cl-all-statuses@example.com");
    for (const status of ["pass", "fail", "na", "pending"]) {
      const res = await authedPatchJson(`/api/compliance/checklist/${itemId}`, token, csrf, { status });
      expect(res.status).toBe(200);
    }
  });

  it("rejects an invalid status value with 400", async () => {
    const { token, csrf, itemId } = await setupGrantWithChecklistItem("cl-invalid-status@example.com");
    const res = await authedPatchJson(`/api/compliance/checklist/${itemId}`, token, csrf, {
      status: "approved", // not a valid value
    });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent checklist item", async () => {
    const { token, csrf } = await createAndLoginUser("cl-not-found@example.com");
    const res = await authedPatchJson("/api/compliance/checklist/99999", token, csrf, { status: "pass" });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Remediation notes
// ---------------------------------------------------------------------------

describe("POST /api/compliance/grants/:id/note", () => {
  it("adds a remediation note to the audit log", async () => {
    const { token, csrf } = await createAndLoginUser("note-add@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Note Test Grant",
    })).json();

    const noteText = "Contacted department head and received written acknowledgment of misallocation.";
    const res = await authedPostJson(`/api/compliance/grants/${id}/note`, token, csrf, {
      note: noteText,
    });
    expect(res.status).toBe(201);

    const log = await getAuditLog(id);
    const noteEvent = log.find((e) => e.event_type === "note_added");
    expect(noteEvent).toBeDefined();
    expect(noteEvent.description).toBe(noteText);
  });

  it("records the actor's username", async () => {
    const email = "note-actor@example.com";
    const { token, csrf } = await createAndLoginUser(email);
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Note Actor Test",
    })).json();
    await authedPostJson(`/api/compliance/grants/${id}/note`, token, csrf, { note: "Corrective action taken." });

    const log = await getAuditLog(id);
    const noteEvent = log.find((e) => e.event_type === "note_added");
    expect(noteEvent.actor).toBe(email);
  });

  it("rejects an empty note with 400", async () => {
    const { token, csrf } = await createAndLoginUser("note-empty@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Empty Note Test",
    })).json();
    const res = await authedPostJson(`/api/compliance/grants/${id}/note`, token, csrf, { note: "" });
    expect(res.status).toBe(400);
  });

  it("rejects a whitespace-only note with 400", async () => {
    const { token, csrf } = await createAndLoginUser("note-whitespace@example.com");
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Whitespace Note Test",
    })).json();
    const res = await authedPostJson(`/api/compliance/grants/${id}/note`, token, csrf, { note: "   " });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Audit trail completeness
// ---------------------------------------------------------------------------

describe("Audit trail — every mutation produces a log entry", () => {
  it("accumulates a complete audit trail across the full lifecycle", async () => {
    const { token, csrf } = await createAndLoginUser("full-lifecycle@example.com");

    // 1. Create grant
    const { id } = await (await authedPostJson("/api/compliance/grants", token, csrf, {
      grant_name: "Full Lifecycle Grant",
      funder: "Community Foundation",
      total_awarded: 75000,
    })).json();

    // 2. Add budget lines
    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Programming", allocated: 60000, spent: 0,
    });
    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Admin", allocated: 15000, spent: 0,
    });

    // 3. Record that the department head spent programming funds on admin
    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Programming", allocated: 60000, spent: 20000,
    });
    await authedPostJson(`/api/compliance/grants/${id}/budget`, token, csrf, {
      category: "Admin", allocated: 15000, spent: 42000, // over — used programming funds
    });

    // 4. Flag grant
    await authedPatchJson(`/api/compliance/grants/${id}`, token, csrf, { status: "flagged" });

    // 5. Add compliance checklist items
    await authedPostJson(`/api/compliance/grants/${id}/checklist`, token, csrf, {
      item: "100% of funds must be used for programming activities",
    });

    // 6. Mark checklist item as failing
    const detail = await (await authedGet(`/api/compliance/grants/${id}`, token)).json();
    const itemId = detail.checklist[0].id;
    await authedPatchJson(`/api/compliance/checklist/${itemId}`, token, csrf, { status: "fail" });

    // 7. Escalate to under_audit
    await authedPatchJson(`/api/compliance/grants/${id}`, token, csrf, { status: "under_audit" });

    // 8. Log remediation note
    await authedPostJson(`/api/compliance/grants/${id}/note`, token, csrf, {
      note: "Internal review initiated. Demand letter sent to department head requesting repayment of $27,000 diverted from programming budget.",
    });

    // 9. Verify complete audit trail
    const log = await getAuditLog(id);
    const eventTypes = log.map((e) => e.event_type);

    // Should have: initial creation, 2 budget creates, 2 budget updates, 2 status changes, 1 checklist add, 1 checklist patch, 1 note
    expect(eventTypes.filter((t) => t === "budget_change").length).toBeGreaterThanOrEqual(4);
    expect(eventTypes.filter((t) => t === "status_change").length).toBeGreaterThanOrEqual(3); // created + flagged + under_audit
    expect(eventTypes.filter((t) => t === "checklist_update").length).toBeGreaterThanOrEqual(2); // add + patch
    expect(eventTypes.filter((t) => t === "note_added").length).toBe(1);

    // Verify the full grant detail via the API
    const finalDetail = await (await authedGet(`/api/compliance/grants/${id}`, token)).json();
    expect(finalDetail.grant.status).toBe("under_audit");
    expect(finalDetail.budgetLines.length).toBe(2);

    const adminLine = finalDetail.budgetLines.find((l) => l.category === "Admin");
    expect(adminLine.spent).toBeGreaterThan(adminLine.allocated); // over budget — key indicator

    const progLine = finalDetail.budgetLines.find((l) => l.category === "Programming");
    expect(progLine.spent).toBeLessThan(progLine.allocated); // under-utilized — funds went elsewhere

    expect(finalDetail.checklist[0].status).toBe("fail");
    expect(finalDetail.auditLog.length).toBe(log.length);
  });
});
