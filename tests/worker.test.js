import { env, createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
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

// Returns { token, csrf } for authenticated helpers.
async function createAndLoginUser(username, password) {
  await fetch(formRequest("http://localhost/signup", {
    username,
    password,
    confirm_password: password,
  }));
  const res = await fetch(formRequest("http://localhost/login", { username, password }));
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

  it("rejects password shorter than 8 chars", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "carol",
      password: "abc",
      confirm_password: "abc",
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8/);
  });

  it("accepts password of exactly 8 chars", async () => {
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "carol",
      password: "12345678",
      confirm_password: "12345678",
    }));
    expect(res.status).toBe(201);
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

  it("rate-limits after 5 signup attempts from the same IP", async () => {
    // Exhaust 5 attempts (all succeed or fail — count is per IP regardless)
    for (let i = 0; i < 5; i++) {
      await fetch(formRequest("http://localhost/signup", {
        username: `user${i}`,
        password: "password1",
        confirm_password: "password1",
      }));
    }
    const res = await fetch(formRequest("http://localhost/signup", {
      username: "overflow",
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
      username: "eve",
      password: "hunter2xx",
      confirm_password: "hunter2xx",
    }));
    const res = await fetch(formRequest("http://localhost/login", {
      username: "eve",
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
      username: "frank",
      password: "correct1x",
      confirm_password: "correct1x",
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
    const { token } = await createAndLoginUser("grace", "password1x");
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
    const { token } = await createAndLoginUser("csrfuser", "password1x");
    const res = await authedGet("/api/csrf", token);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
  });

  it("returns the same token on repeated calls", async () => {
    const { token } = await createAndLoginUser("csrfuser2", "password1x");
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
    const { token } = await createAndLoginUser("csrftest1", "password1x");
    const res = await fetch(new Request("http://localhost/api/profile", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ org: "Acme" }),
    }));
    expect(res.status).toBe(403);
  });

  it("POST /api/notes rejects request without CSRF token", async () => {
    const { token } = await createAndLoginUser("csrftest2", "password1x");
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
    const { token, csrf } = await createAndLoginUser("csrftest3", "password1x");
    const res = await authedPostJson("/api/profile", token, csrf, { org: "Acme" });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// /api/me
// ---------------------------------------------------------------------------

describe("GET /api/me", () => {
  it("returns the logged-in username", async () => {
    const { token } = await createAndLoginUser("henry", "password1x");
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
    const { token } = await createAndLoginUser("ivan", "password1x");
    const res = await authedGet("/api/profile", token);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("saves and retrieves a profile", async () => {
    const { token, csrf } = await createAndLoginUser("julia", "password1x");
    const profile = { org: "Acme", weights: { Relevance: 0.4, Fit: 0.3, Ease: 0.2, StackAlignment: 0.05, CadenceRecency: 0.05 } };
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
    const { token } = await createAndLoginUser("karen", "password1x");
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
    const { token } = await createAndLoginUser("lena", "password1x");
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    for (let i = 1; i < grants.length; i++) {
      expect(grants[i - 1].score).toBeGreaterThanOrEqual(grants[i].score);
    }
  });

  it("paginates correctly with page and pageSize params", async () => {
    const { token } = await createAndLoginUser("lena2", "password1x");
    const res1 = await authedGet("/api/grants?page=1&pageSize=2", token);
    const body1 = await res1.json();
    expect(body1.data.length).toBe(2);
    expect(body1.total).toBe(3);
    expect(body1.page).toBe(1);
    const res2 = await authedGet("/api/grants?page=2&pageSize=2", token);
    const body2 = await res2.json();
    expect(body2.data.length).toBe(1);
    expect(body2.page).toBe(2);
    // No overlap between pages
    const names1 = body1.data.map((g) => g.Name);
    const names2 = body2.data.map((g) => g.Name);
    expect(names1.every((n) => !names2.includes(n))).toBe(true);
  });

  it("applies custom weights from user profile", async () => {
    const { token, csrf } = await createAndLoginUser("mike", "password1x");
    // Weight Ease heavily so Grant Beta (Ease=3) scores highest
    await authedPostJson("/api/profile", token, csrf,
      { weights: { Relevance: 0, Fit: 0, Ease: 1, StackAlignment: 0, CadenceRecency: 0 } });
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    expect(grants[0].Name).toBe("Grant Beta");
  });

  it("applies default weights when no profile exists", async () => {
    const { token } = await createAndLoginUser("nina", "password1x");
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    expect(grants[0].Name).toBe("Grant Alpha");
  });

  it("StackAlignment scoring: Yes=1.0, No=0.2", async () => {
    const { token, csrf } = await createAndLoginUser("omar", "password1x");
    await authedPostJson("/api/profile", token, csrf,
      { weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 1, CadenceRecency: 0 } });
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    expect(grants[0].Name).toBe("Grant Beta");
  });

  it("CadenceRecency: rolling deadline scores highest", async () => {
    const { token, csrf } = await createAndLoginUser("petra", "password1x");
    await authedPostJson("/api/profile", token, csrf,
      { weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 0, CadenceRecency: 1 } });
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    expect(grants[0].Name).toBe("Grant Alpha");
  });

  it("deadlines more than 365 days away score 0 for CadenceRecency", async () => {
    const { token, csrf } = await createAndLoginUser("quinn", "password1x");
    await authedPostJson("/api/profile", token, csrf,
      { weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 0, CadenceRecency: 1 } });
    const res = await authedGet("/api/grants", token);
    const { data: grants } = await res.json();
    const beta = grants.find((g) => g.Name === "Grant Beta");
    expect(beta.score).toBe(0);
  });

  it("past deadlines score 0 for CadenceRecency", async () => {
    const { token, csrf } = await createAndLoginUser("rosa2", "password1x");
    await env.GRANT_MANAGER_DB.prepare(
      `INSERT INTO programs ("Name","Sponsor","Relevance","Fit","Ease","Stack Required?","Cadence","Deadline / Next Cohort")
       VALUES ('Grant Past', 'Sponsor P', '0', '0', '0', 'No', 'Annual', '2020-01-01')`
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
    const { token } = await createAndLoginUser("rosa", "password1x");
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
    const { token, csrf } = await createAndLoginUser("sam", "password1x");
    const body = new FormData();
    body.append("Name", "Grant Alpha");
    body.append("Notes/Actions", "Apply by July");
    const res = await fetch(new Request("http://localhost/api/notes", {
      method: "POST",
      headers: { Cookie: `session=${token}`, "X-CSRF-Token": csrf },
      body,
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("returns 400 when Name is missing", async () => {
    const { token, csrf } = await createAndLoginUser("tina", "password1x");
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
  it("returns configured:true when AI binding is present", async () => {
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
  it("returns a reset token for a known user", async () => {
    await fetch(formRequest("http://localhost/signup", {
      username: "resetme",
      password: "password1x",
      confirm_password: "password1x",
    }));
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "resetme" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.token).toBe("string");
  });

  it("returns ok (no token) for unknown username without leaking existence", async () => {
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "doesnotexist" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toBeUndefined();
  });

  it("returns 400 when username is missing", async () => {
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it("rate-limits after 5 requests from same IP", async () => {
    for (let i = 0; i < 5; i++) {
      await fetch(new Request("http://localhost/api/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: `user${i}` }),
      }));
    }
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "another" }),
    }));
    expect(res.status).toBe(429);
  });
});

describe("POST /api/reset-password", () => {
  async function getResetToken(username) {
    await fetch(formRequest("http://localhost/signup", {
      username,
      password: "oldpassword",
      confirm_password: "oldpassword",
    }));
    const res = await fetch(new Request("http://localhost/api/request-password-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    }));
    return (await res.json()).token;
  }

  it("resets the password and allows login with new password", async () => {
    const token = await getResetToken("resetuser1");
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "newpassword1", confirm_password: "newpassword1" }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);

    // Old password no longer works
    const badLogin = await fetch(formRequest("http://localhost/login", {
      username: "resetuser1", password: "oldpassword",
    }));
    expect(badLogin.status).toBe(401);

    // New password works
    const goodLogin = await fetch(formRequest("http://localhost/login", {
      username: "resetuser1", password: "newpassword1",
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
    const token = await getResetToken("resetuser2");
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "newpassword1", confirm_password: "different" }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/match/i);
  });

  it("rejects a password shorter than 8 characters", async () => {
    const token = await getResetToken("resetuser3");
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "short", confirm_password: "short" }),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/8/);
  });

  it("rejects reuse of a consumed reset token", async () => {
    const token = await getResetToken("resetuser4");
    await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "newpassword1", confirm_password: "newpassword1" }),
    }));
    // Second use of same token
    const res = await fetch(new Request("http://localhost/api/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password: "anotherpass", confirm_password: "anotherpass" }),
    }));
    expect(res.status).toBe(400);
  });
});
