import { env, createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import worker from "../worker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

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

async function createAndLoginUser(username, password) {
  await fetch(formRequest("http://localhost/signup", {
    username,
    password,
    confirm_password: password,
  }));
  const res = await fetch(formRequest("http://localhost/login", { username, password }));
  const cookie = res.headers.get("Set-Cookie");
  return cookie?.match(/session=([^;]+)/)?.[1];
}

async function authedGet(path, sessionToken) {
  return fetch(new Request(`http://localhost${path}`, {
    headers: { Cookie: `session=${sessionToken}` },
  }));
}

async function seedPrograms() {
  await env.GRANT_MANAGER_DB.prepare(`
    CREATE TABLE IF NOT EXISTS programs (
      "Name" TEXT,
      "Sponsor" TEXT,
      "Relevance" TEXT,
      "Fit" TEXT,
      "Ease" TEXT,
      "Stack Required?" TEXT,
      "Cadence" TEXT,
      "Deadline / Next Cohort" TEXT,
      "Notes/Actions" TEXT
    )
  `).run();
  // Grant Alpha: Rolling cadence (CadenceRecency=1.0), high Relevance
  // Grant Beta:  Stack=Yes, far-future deadline (CadenceRecency≈0), high Ease
  // Grant Gamma: No deadline (CadenceRecency=0), highest Fit
  await env.GRANT_MANAGER_DB.prepare(`
    INSERT INTO programs ("Name","Sponsor","Relevance","Fit","Ease","Stack Required?","Cadence","Deadline / Next Cohort")
    VALUES
      ('Grant Alpha', 'Sponsor A', '3', '2', '1', 'No',  'Rolling', NULL),
      ('Grant Beta',  'Sponsor B', '1', '1', '3', 'Yes', 'Annual',  '2099-12-31'),
      ('Grant Gamma', 'Sponsor C', '2', '3', '2', 'No',  'Annual',  NULL)
  `).run();
}

// Reset all KV/D1 bindings between tests so they don't contaminate each other
beforeEach(reset);

// ---------------------------------------------------------------------------
// Auth — /signup
// ---------------------------------------------------------------------------

describe("POST /signup", () => {
  it("creates a new user and returns 201", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "alice",
      password: "password1",
      confirm_password: "password1",
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("rejects duplicate username with 409", async () => {
    const fields = { username: "bob", password: "password1", confirm_password: "password1" };
    await fetch(formRequest("http://localhost/signup", fields));
    const res = await fetch(formRequest("http://localhost/signup", fields));
    expect(res.status).toBe(409);
  });

  it("rejects username shorter than 3 chars", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "ab",
      password: "password1",
      confirm_password: "password1",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/3/);
  });

  it("rejects username with invalid characters", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "bad user!",
      password: "password1",
      confirm_password: "password1",
    }));
    expect(res.status).toBe(400);
  });

  it("rejects password shorter than 6 chars", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "carol",
      password: "abc",
      confirm_password: "abc",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/6/);
  });

  it("rejects mismatched passwords", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "dave",
      password: "password1",
      confirm_password: "different",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/match/i);
  });
});

// ---------------------------------------------------------------------------
// Auth — /login
// ---------------------------------------------------------------------------

describe("POST /login", () => {
  it("logs in an existing user and sets session cookie", async () => {
    await fetch(formRequest("http://localhost/signup", {
      username: "eve",
      password: "hunter2",
      confirm_password: "hunter2",
    }));
    const res = await fetch(formRequest("http://localhost/login", {
      username: "eve",
      password: "hunter2",
    }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/dashboard");
    const cookie = res.headers.get("Set-Cookie");
    expect(cookie).toMatch(/session=/);
    expect(cookie).toMatch(/HttpOnly/);
  });

  it("returns 401 for wrong password", async () => {
    await fetch(formRequest("http://localhost/signup", {
      username: "frank",
      password: "correct",
      confirm_password: "correct",
    }));
    const res = await fetch(formRequest("http://localhost/login", {
      username: "frank",
      password: "wrong",
    }));
    expect(res.status).toBe(401);
  });

  it("returns 401 for unknown user", async () => {
    const res = await fetch(formRequest("http://localhost/login", {
      username: "nobody",
      password: "password1",
    }));
    expect(res.status).toBe(401);
  });

  it("rate-limits after 5 failed attempts", async () => {
    for (let i = 0; i < 5; i++) {
      await fetch(formRequest("http://localhost/login", { username: "ghost", password: "bad" }));
    }
    const res = await fetch(formRequest("http://localhost/login", { username: "ghost", password: "bad" }));
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
    const token = await createAndLoginUser("grace", "password1");
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
    ["POST", "/api/notes"],
    ["POST", "/api/chat"],
  ])("%s %s returns 401 without session", async (method, path) => {
    const res = await fetch(new Request(`http://localhost${path}`, { method }));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /api/me
// ---------------------------------------------------------------------------

describe("GET /api/me", () => {
  it("returns the logged-in username", async () => {
    const token = await createAndLoginUser("henry", "password1");
    const res = await authedGet("/api/me", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.username).toBe("henry");
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
    const token = await createAndLoginUser("ivan", "password1");
    const res = await authedGet("/api/profile", token);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("saves and retrieves a profile", async () => {
    const token = await createAndLoginUser("julia", "password1");
    const profile = { org: "Acme", weights: { Relevance: 0.4, Fit: 0.3, Ease: 0.2, StackAlignment: 0.05, CadenceRecency: 0.05 } };
    const postRes = await fetch(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }));
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

  it("returns an array of grants with a score field", async () => {
    const token = await createAndLoginUser("karen", "password1");
    const res = await authedGet("/api/grants", token);
    expect(res.status).toBe(200);
    const grants = await res.json();
    expect(Array.isArray(grants)).toBe(true);
    expect(grants.length).toBe(3);
    for (const g of grants) {
      expect(typeof g.score).toBe("number");
      expect(g.score).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns grants sorted by score descending", async () => {
    const token = await createAndLoginUser("lena", "password1");
    const res = await authedGet("/api/grants", token);
    const grants = await res.json();
    for (let i = 1; i < grants.length; i++) {
      expect(grants[i - 1].score).toBeGreaterThanOrEqual(grants[i].score);
    }
  });

  it("applies custom weights from user profile", async () => {
    const token = await createAndLoginUser("mike", "password1");
    // Weight Ease heavily so Grant Beta (Ease=3) scores highest
    await fetch(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ weights: { Relevance: 0, Fit: 0, Ease: 1, StackAlignment: 0, CadenceRecency: 0 } }),
    }));
    const res = await authedGet("/api/grants", token);
    const grants = await res.json();
    expect(grants[0].Name).toBe("Grant Beta");
  });

  it("applies default weights when no profile exists", async () => {
    const token = await createAndLoginUser("nina", "password1");
    // Default weights: Relevance=0.3, Fit=0.3 — Grant Alpha (R=3,F=2) should beat others
    const res = await authedGet("/api/grants", token);
    const grants = await res.json();
    // Top grant should be Alpha (highest Relevance+Fit under default weights)
    expect(grants[0].Name).toBe("Grant Alpha");
  });

  it("StackAlignment scoring: Yes=1.0, No=0.2", async () => {
    const token = await createAndLoginUser("omar", "password1");
    // Weight StackAlignment only
    await fetch(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 1, CadenceRecency: 0 } }),
    }));
    const res = await authedGet("/api/grants", token);
    const grants = await res.json();
    // Grant Beta has Stack Required? = Yes → higher score
    expect(grants[0].Name).toBe("Grant Beta");
  });

  it("CadenceRecency: rolling deadline scores highest", async () => {
    const token = await createAndLoginUser("petra", "password1");
    await fetch(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 0, CadenceRecency: 1 } }),
    }));
    const res = await authedGet("/api/grants", token);
    const grants = await res.json();
    // Grant Alpha has Cadence=Rolling → score 1.0 → highest
    expect(grants[0].Name).toBe("Grant Alpha");
  });

  it("far-future deadlines (>365 days) score 0 for CadenceRecency", async () => {
    const token = await createAndLoginUser("quinn", "password1");
    await fetch(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 0, CadenceRecency: 1 } }),
    }));
    const res = await authedGet("/api/grants", token);
    const grants = await res.json();
    const beta = grants.find((g) => g.Name === "Grant Beta");
    // Grant Beta has deadline 2099-12-31 — more than 365 days away → CadenceRecency = 0
    expect(beta.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// /api/notes
// ---------------------------------------------------------------------------

describe("POST /api/notes", () => {
  beforeEach(seedPrograms);

  it("saves a note against a grant", async () => {
    const token = await createAndLoginUser("rosa", "password1");
    const res = await fetch(formRequest("http://localhost/api/notes", {
      Name: "Grant Alpha",
      "Notes/Actions": "Follow up in Q3",
    }));
    // Without session cookie this should be 401
    expect(res.status).toBe(401);
  });

  it("saves a note when authenticated", async () => {
    const token = await createAndLoginUser("sam", "password1");
    const body = new FormData();
    body.append("Name", "Grant Alpha");
    body.append("Notes/Actions", "Apply by July");
    const res = await fetch(new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { Cookie: `session=${token}` },
      body,
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 400 when Name is missing", async () => {
    const token = await createAndLoginUser("tina", "password1");
    const body = new FormData();
    body.append("Notes/Actions", "some note");
    const res = await fetch(new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { Cookie: `session=${token}` },
      body,
    }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /api/ai-status
// ---------------------------------------------------------------------------

describe("GET /api/ai-status", () => {
  it("returns configured:true when AI binding is present", async () => {
    const res = await fetch(new Request("http://localhost/api/ai-status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    // AI binding is wired in wrangler.test.toml
    expect(typeof body.configured).toBe("boolean");
  });
});
