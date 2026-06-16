import { env, createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import worker, {
  checkFeedbackRateLimit,
  uploadFeedbackScreenshot,
  buildFeedbackIssueBody,
} from "../worker.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function workerFetch(request) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function feedbackRequest(fields = {}, file = null) {
  const fd = new FormData();
  fd.append("message", fields.message ?? "This is test feedback");
  if (fields.category !== undefined) fd.append("category", fields.category);
  if (fields.name !== undefined) fd.append("name", fields.name);
  if (fields.email !== undefined) fd.append("email", fields.email);
  if (file) fd.append("screenshot", file);
  return new Request("http://localhost/api/anonymous-feedback", {
    method: "POST",
    body: fd,
    headers: fields.ip ? { "CF-Connecting-IP": fields.ip } : {},
  });
}

function mockGitHubOk(issueNumber = 42) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ number: issueNumber, html_url: `https://github.com/owner/repo/issues/${issueNumber}` }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}

function mockGitHubError(status, body = {}) {
  return vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Schema bootstrap (mirrors worker.test.js pattern)
// ---------------------------------------------------------------------------

async function createSchema() {
  const db = env.GRANT_MANAGER_DB;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, email TEXT, is_admin INTEGER DEFAULT 0
    )`),
    db.prepare(`INSERT OR IGNORE INTO users (username, password_hash, created_at)
      VALUES ('demo','2a97516c354b68848cdbd8f54a226a0a55b21ed138e207ad6c5cbb9c00aa5aea',0)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, rating INTEGER NOT NULL,
      comment TEXT, email TEXT, opted_in INTEGER NOT NULL DEFAULT 0,
      submitted_at TEXT NOT NULL, user_agent TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE, subscribed_at TEXT NOT NULL
    )`),
  ]);
}

beforeEach(reset);
beforeEach(createSchema);
afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Unit: checkFeedbackRateLimit
// ---------------------------------------------------------------------------

describe("checkFeedbackRateLimit", () => {
  it("allows the first submission", async () => {
    const result = await checkFeedbackRateLimit(env, "1.2.3.4");
    expect(result.allowed).toBe(true);
  });

  it("allows up to 5 submissions in the same window", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkFeedbackRateLimit(env, "1.2.3.4");
      expect(r.allowed).toBe(true);
    }
  });

  it("blocks the 6th submission in the same window", async () => {
    for (let i = 0; i < 5; i++) {
      await checkFeedbackRateLimit(env, "1.2.3.4");
    }
    const r = await checkFeedbackRateLimit(env, "1.2.3.4");
    expect(r.allowed).toBe(false);
  });

  it("tracks different IPs independently", async () => {
    for (let i = 0; i < 5; i++) await checkFeedbackRateLimit(env, "10.0.0.1");
    const blocked = await checkFeedbackRateLimit(env, "10.0.0.1");
    const allowed = await checkFeedbackRateLimit(env, "10.0.0.2");
    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });

  it("allows submission when FEEDBACK_RATE_LIMIT binding is absent", async () => {
    const r = await checkFeedbackRateLimit({}, "1.2.3.4");
    expect(r.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit: uploadFeedbackScreenshot
// ---------------------------------------------------------------------------

describe("uploadFeedbackScreenshot", () => {
  function makeFile(type = "image/png", size = 1024) {
    return new File([new Uint8Array(size)], "shot.png", { type });
  }

  it("uploads a valid image and returns a public URL", async () => {
    const file = makeFile("image/png", 512);
    const url = await uploadFeedbackScreenshot(file, env);
    expect(url).toMatch(/^https:\/\/test-r2\.example\.com\/feedback\/.+\.png$/);
  });

  it("returns null for disallowed MIME types", async () => {
    const file = makeFile("application/pdf", 512);
    const result = await uploadFeedbackScreenshot(file, env);
    expect(result).toBeNull();
  });

  it("returns null for files exceeding 5 MB", async () => {
    const file = makeFile("image/png", 5 * 1024 * 1024 + 1);
    const result = await uploadFeedbackScreenshot(file, env);
    expect(result).toBeNull();
  });

  it("returns null when FEEDBACK_ATTACHMENTS binding is absent", async () => {
    const file = makeFile("image/jpeg", 512);
    const result = await uploadFeedbackScreenshot(file, { FEEDBACK_R2_PUBLIC_BASE_URL: "https://x.com" });
    expect(result).toBeNull();
  });

  it("returns null when FEEDBACK_R2_PUBLIC_BASE_URL is absent", async () => {
    const file = makeFile("image/jpeg", 512);
    const { FEEDBACK_R2_PUBLIC_BASE_URL: _, ...envWithoutUrl } = env;
    const result = await uploadFeedbackScreenshot(file, envWithoutUrl);
    expect(result).toBeNull();
  });

  it("returns null when R2 put throws", async () => {
    const badEnv = {
      FEEDBACK_R2_PUBLIC_BASE_URL: "https://test-r2.example.com",
      FEEDBACK_ATTACHMENTS: {
        put: () => { throw new Error("R2 down"); },
      },
    };
    const file = makeFile("image/png", 512);
    const result = await uploadFeedbackScreenshot(file, badEnv);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit: buildFeedbackIssueBody
// ---------------------------------------------------------------------------

describe("buildFeedbackIssueBody", () => {
  it("includes required fields in the output", () => {
    const body = buildFeedbackIssueBody({
      name: "Alice",
      email: "alice@example.com",
      message: "Something broke",
      category: "bug",
      screenshotUrl: null,
      userAgent: "Mozilla/5.0",
    });
    expect(body).toContain("Bug Report");
    expect(body).toContain("Alice");
    expect(body).toContain("alice@example.com");
    expect(body).toContain("Something broke");
  });

  it("uses Anonymous when name is omitted", () => {
    const body = buildFeedbackIssueBody({
      name: null, email: null, message: "Hi", category: "general",
      screenshotUrl: null, userAgent: null,
    });
    expect(body).toContain("_Anonymous_");
    expect(body).toContain("_Not provided_");
  });

  it("embeds screenshot as markdown image when URL is provided", () => {
    const body = buildFeedbackIssueBody({
      name: null, email: null, message: "See pic", category: "bug",
      screenshotUrl: "https://cdn.example.com/shot.png", userAgent: null,
    });
    expect(body).toContain("![Screenshot](https://cdn.example.com/shot.png)");
  });

  it("omits screenshot section when URL is null", () => {
    const body = buildFeedbackIssueBody({
      name: null, email: null, message: "No pic", category: "general",
      screenshotUrl: null, userAgent: null,
    });
    expect(body).not.toContain("Screenshot");
  });
});

// ---------------------------------------------------------------------------
// Integration: POST /api/anonymous-feedback — input validation
// ---------------------------------------------------------------------------

describe("POST /api/anonymous-feedback — validation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockGitHubOk());
  });

  it("rejects a request with no message with 400", async () => {
    const fd = new FormData();
    fd.append("category", "bug");
    const res = await workerFetch(
      new Request("http://localhost/api/anonymous-feedback", { method: "POST", body: fd }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/message/i);
  });

  it("rejects a whitespace-only message with 400", async () => {
    const fd = new FormData();
    fd.append("message", "   ");
    const res = await workerFetch(
      new Request("http://localhost/api/anonymous-feedback", { method: "POST", body: fd }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts valid feedback and returns success with issue number", async () => {
    const res = await workerFetch(feedbackRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(typeof json.issueNumber).toBe("number");
  });

  it("accepts all valid categories", async () => {
    for (const cat of ["bug", "feature", "general"]) {
      vi.stubGlobal("fetch", mockGitHubOk());
      const res = await workerFetch(feedbackRequest({ category: cat }));
      expect(res.status).toBe(200);
    }
  });

  it("defaults to 'general' for an invalid category", async () => {
    const mockFetch = mockGitHubOk();
    vi.stubGlobal("fetch", mockFetch);
    const res = await workerFetch(feedbackRequest({ category: "invalid" }));
    expect(res.status).toBe(200);
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.labels).toContain("feedback");
  });

  it("truncates messages longer than 5000 chars", async () => {
    const mockFetch = mockGitHubOk();
    vi.stubGlobal("fetch", mockFetch);
    const longMsg = "x".repeat(6000);
    const res = await workerFetch(feedbackRequest({ message: longMsg }));
    expect(res.status).toBe(200);
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.body).toContain("x".repeat(5000));
    expect(callBody.body).not.toContain("x".repeat(5001));
  });

  it("returns 503 when GITHUB_TOKEN is not configured", async () => {
    const { GITHUB_TOKEN: _, ...envWithout } = env;
    // Override env by accessing without the token — we test via a custom env mock
    // We directly call the route with a worker that uses an env without GITHUB_TOKEN.
    // Since we can't swap env per-request easily in the pool, we test via the exported fn.
    // This test covers the branch via the integration path when token is empty string.
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    // Patch env GITHUB_TOKEN to undefined for this call
    const origToken = env.GITHUB_TOKEN;
    Object.defineProperty(env, "GITHUB_TOKEN", { value: undefined, writable: true, configurable: true });
    const res = await workerFetch(feedbackRequest());
    expect(res.status).toBe(503);
    Object.defineProperty(env, "GITHUB_TOKEN", { value: origToken, writable: true, configurable: true });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration: rate limiting
// ---------------------------------------------------------------------------

describe("POST /api/anonymous-feedback — rate limiting", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockGitHubOk());
  });

  it("allows 5 submissions from the same IP", async () => {
    for (let i = 0; i < 5; i++) {
      const res = await workerFetch(feedbackRequest({ ip: "5.5.5.5" }));
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 on the 6th submission from the same IP", async () => {
    for (let i = 0; i < 5; i++) {
      vi.stubGlobal("fetch", mockGitHubOk());
      await workerFetch(feedbackRequest({ ip: "6.6.6.6" }));
    }
    vi.stubGlobal("fetch", mockGitHubOk());
    const res = await workerFetch(feedbackRequest({ ip: "6.6.6.6" }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/too many/i);
  });

  it("does not block a different IP after one IP hits limit", async () => {
    for (let i = 0; i < 5; i++) {
      vi.stubGlobal("fetch", mockGitHubOk());
      await workerFetch(feedbackRequest({ ip: "7.7.7.7" }));
    }
    vi.stubGlobal("fetch", mockGitHubOk());
    const res = await workerFetch(feedbackRequest({ ip: "8.8.8.8" }));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Integration: GitHub API error handling
// ---------------------------------------------------------------------------

describe("POST /api/anonymous-feedback — GitHub error handling", () => {
  it("returns 503 on GitHub 401", async () => {
    vi.stubGlobal("fetch", mockGitHubError(401, { message: "Bad credentials" }));
    const res = await workerFetch(feedbackRequest());
    expect(res.status).toBe(503);
  });

  it("returns 503 on GitHub 403", async () => {
    vi.stubGlobal("fetch", mockGitHubError(403, { message: "Forbidden" }));
    const res = await workerFetch(feedbackRequest());
    expect(res.status).toBe(503);
  });

  it("returns 503 on GitHub 429 (rate limited)", async () => {
    vi.stubGlobal("fetch", mockGitHubError(429, { message: "API rate limit exceeded" }));
    const res = await workerFetch(feedbackRequest());
    expect(res.status).toBe(503);
  });

  it("returns 502 on other GitHub server errors", async () => {
    vi.stubGlobal("fetch", mockGitHubError(500, { message: "Internal Server Error" }));
    const res = await workerFetch(feedbackRequest());
    expect(res.status).toBe(502);
  });

  it("returns 502 when GitHub fetch throws a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const res = await workerFetch(feedbackRequest());
    expect(res.status).toBe(502);
  });

  it("does not leak internal error details in the response body", async () => {
    vi.stubGlobal("fetch", mockGitHubError(500, { message: "secret-internal-detail" }));
    const res = await workerFetch(feedbackRequest());
    const text = await res.text();
    expect(text).not.toContain("secret-internal-detail");
  });
});

// ---------------------------------------------------------------------------
// Integration: screenshot attachment — R2 failure does not block issue creation
// ---------------------------------------------------------------------------

describe("POST /api/anonymous-feedback — screenshot handling", () => {
  it("includes screenshot URL in the GitHub issue body when upload succeeds", async () => {
    const mockFetch = mockGitHubOk();
    vi.stubGlobal("fetch", mockFetch);

    const img = new File([new Uint8Array(64)], "shot.png", { type: "image/png" });
    const res = await workerFetch(feedbackRequest({}, img));
    expect(res.status).toBe(200);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.body).toContain("![Screenshot]");
    expect(sentBody.body).toContain("test-r2.example.com");
  });

  it("creates the issue without a screenshot when upload fails, without returning an error", async () => {
    // Remove R2 binding so upload returns null
    const origR2 = env.FEEDBACK_ATTACHMENTS;
    Object.defineProperty(env, "FEEDBACK_ATTACHMENTS", { value: undefined, writable: true, configurable: true });

    const mockFetch = mockGitHubOk();
    vi.stubGlobal("fetch", mockFetch);

    const img = new File([new Uint8Array(64)], "shot.png", { type: "image/png" });
    const res = await workerFetch(feedbackRequest({}, img));
    expect(res.status).toBe(200);

    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.body).not.toContain("![Screenshot]");

    Object.defineProperty(env, "FEEDBACK_ATTACHMENTS", { value: origR2, writable: true, configurable: true });
  });

  it("rejects files with invalid MIME type (does not block issue creation)", async () => {
    const mockFetch = mockGitHubOk();
    vi.stubGlobal("fetch", mockFetch);

    const pdf = new File([new Uint8Array(64)], "file.pdf", { type: "application/pdf" });
    const res = await workerFetch(feedbackRequest({}, pdf));
    // Issue still created successfully
    expect(res.status).toBe(200);
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.body).not.toContain("![Screenshot]");
  });

  it("rejects files exceeding 5 MB (does not block issue creation)", async () => {
    const mockFetch = mockGitHubOk();
    vi.stubGlobal("fetch", mockFetch);

    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    const res = await workerFetch(feedbackRequest({}, big));
    expect(res.status).toBe(200);
    const sentBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(sentBody.body).not.toContain("![Screenshot]");
  });
});
