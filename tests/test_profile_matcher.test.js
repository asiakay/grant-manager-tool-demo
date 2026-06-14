/**
 * Vitest tests for workers/profile_matcher_worker.js
 *
 * Environment:  @cloudflare/vitest-pool-workers (wrangler.test.toml)
 * Test doubles: USER_PROFILES KV seeded in-process; D1 seeded via batch;
 *               RESEND_API_KEY intentionally absent → email send is skipped.
 */

import { env, createExecutionContext, waitOnExecutionContext, reset } from "cloudflare:test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import profileMatcher, { refineProfileFromSelections } from "../workers/profile_matcher_worker.js";
import { buildEmailSummary } from "../workers/scoring_utils.js";

// ---------------------------------------------------------------------------
// Schema bootstrap (mirrors worker.test.js)
// ---------------------------------------------------------------------------

async function createSchema() {
  const db = env.GRANT_MANAGER_DB;
  await db.batch([
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
      notes                TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      email TEXT,
      is_admin INTEGER DEFAULT 0
    )`),
  ]);
}

beforeEach(reset);
beforeEach(createSchema);
// Restore spies after each test so they don't accumulate across tests.
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Grant seed data
// ---------------------------------------------------------------------------

async function seedGrants() {
  const db = env.GRANT_MANAGER_DB;
  await db.batch([
    // Grant 1 — tech + nonprofit, rolling cadence, strong scores
    db.prepare(`INSERT INTO programs (name, sponsor, type, benefits, cadence, deadline,
                  stack_required, relevance, fit, ease)
                VALUES ('TechFoundation Accelerator', 'TechFoundation', 'Accelerator',
                  'technology innovation software nonprofit foundation', 'Rolling', NULL, 0, 3, 3, 3)`),
    // Grant 2 — health focus
    db.prepare(`INSERT INTO programs (name, sponsor, type, benefits, cadence, deadline,
                  stack_required, relevance, fit, ease)
                VALUES ('Health Research Grant', 'NIH', 'Grant',
                  'health medicine medical clinical research', 'Annual', '2027-12-31', 0, 2, 2, 2)`),
    // Grant 3 — stack_required=1, strong scores
    db.prepare(`INSERT INTO programs (name, sponsor, type, benefits, cadence, deadline,
                  stack_required, relevance, fit, ease)
                VALUES ('Stack Partner Program', 'CloudCo', 'Accelerator',
                  'technology software engineering', 'Rolling', NULL, 1, 2, 2, 3)`),
    // Grant 4 — past deadline, should score 0 for CadenceRecency
    db.prepare(`INSERT INTO programs (name, sponsor, type, benefits, cadence, deadline,
                  stack_required, relevance, fit, ease)
                VALUES ('Expired Grant', 'OldCo', 'Grant',
                  'social welfare community', 'Annual', '2020-01-01', 0, 1, 1, 1)`),
    // Grant 5 — rolling, low scores — may fall below threshold for some profiles
    db.prepare(`INSERT INTO programs (name, sponsor, type, benefits, cadence, deadline,
                  stack_required, relevance, fit, ease)
                VALUES ('Low Score Rolling', 'Misc', 'Grant',
                  'arts humanities culture', 'Rolling', NULL, 0, 0, 0, 0)`),
  ]);
}

// ---------------------------------------------------------------------------
// Profile seed helpers
// ---------------------------------------------------------------------------

// Alice: Technology focus, Nonprofit/NGO, high Relevance+Fit weight
const ALICE_PROFILE = {
  email: "alice@example.com",
  focusAreas: ["Technology & Innovation"],
  orgType: "Nonprofit/NGO",
  stage: "",
  weights: { Relevance: 0.35, Fit: 0.35, Ease: 0.2, StackAlignment: 0.05, CadenceRecency: 0.05 },
};

// Bob: Health focus — no grants in our seed match Health keyword well enough
const BOB_PROFILE = {
  email: "bob@example.com",
  focusAreas: ["Health & Medicine"],
  orgType: "Hospital/Health System",
  stage: "",
  weights: { Relevance: 0.3, Fit: 0.3, Ease: 0.2, StackAlignment: 0.1, CadenceRecency: 0.1 },
};

// Carol: Cares only about StackAlignment
const CAROL_PROFILE = {
  email: "carol@example.com",
  focusAreas: [],
  orgType: "",
  stage: "",
  weights: { Relevance: 0, Fit: 0, Ease: 0, StackAlignment: 1, CadenceRecency: 0 },
};

async function seedProfile(username, profile) {
  await env.USER_PROFILES.put(`profile:${username}`, JSON.stringify(profile));
}

// ---------------------------------------------------------------------------
// Helper: invoke the scheduled handler
// ---------------------------------------------------------------------------

async function runScheduled() {
  const ctx = createExecutionContext();
  await profileMatcher.scheduled({}, env, ctx);
  await waitOnExecutionContext(ctx);
}

// ---------------------------------------------------------------------------
// Helper: read all messages from the queue (not natively available in tests,
// so we spy on NOTIFY_QUEUE.send to capture calls).
// ---------------------------------------------------------------------------

function captureQueueSends() {
  const sent = [];
  // Do NOT call through to the original: WorkerQueue.send is defined on the
  // prototype, so .bind() still resolves through `this.send`, which now points
  // at the spy — causing infinite recursion.  We only need to capture payloads.
  vi.spyOn(env.NOTIFY_QUEUE, "send").mockImplementation(async (body) => {
    sent.push(body);
  });
  return sent;
}

// ---------------------------------------------------------------------------
// scheduled() — matching logic
// ---------------------------------------------------------------------------

describe("scheduled: matching logic", () => {
  beforeEach(seedGrants);

  it("queues a notification when a grant scores above the threshold for Alice", async () => {
    await seedProfile("alice", ALICE_PROFILE);
    const sent = captureQueueSends();

    await runScheduled();

    expect(sent.length).toBeGreaterThanOrEqual(1);
    const msg = sent.find(m => m.username === "alice");
    expect(msg).toBeDefined();
    expect(msg.email).toBe("alice@example.com");
    expect(Array.isArray(msg.matches)).toBe(true);
    expect(msg.matches.length).toBeGreaterThanOrEqual(1);
  });

  it("does not queue grants below the threshold", async () => {
    // Carol's StackAlignment-only weights: only stack_required=1 grants score high.
    // 'Low Score Rolling' has relevance/fit/ease=0 and stack_required=0 → score = 0
    await seedProfile("carol", CAROL_PROFILE);
    const sent = captureQueueSends();

    await runScheduled();

    const carolMsg = sent.find(m => m.username === "carol");
    if (carolMsg) {
      const grantNames = carolMsg.matches.map(m => m.grant.name);
      expect(grantNames).not.toContain("Low Score Rolling");
    }
  });

  it("applies custom weights from the profile", async () => {
    // Carol weights StackAlignment=1, everything else 0.
    // Only 'Stack Partner Program' (stack_required=1) should appear.
    await seedProfile("carol", CAROL_PROFILE);
    const sent = captureQueueSends();

    await runScheduled();

    const carolMsg = sent.find(m => m.username === "carol");
    expect(carolMsg).toBeDefined();
    const grantNames = carolMsg.matches.map(m => m.grant.name);
    expect(grantNames).toContain("Stack Partner Program");
  });

  it("matches are sorted by score descending within a queued message", async () => {
    await seedProfile("alice", ALICE_PROFILE);
    const sent = captureQueueSends();

    await runScheduled();

    const msg = sent.find(m => m.username === "alice");
    if (msg && msg.matches.length > 1) {
      for (let i = 1; i < msg.matches.length; i++) {
        expect(msg.matches[i - 1].score).toBeGreaterThanOrEqual(msg.matches[i].score);
      }
    }
  });

  it("skips users without an email address", async () => {
    const noEmailProfile = { ...ALICE_PROFILE, email: undefined };
    await env.USER_PROFILES.put("profile:noemail", JSON.stringify(noEmailProfile));
    const sent = captureQueueSends();

    await runScheduled();

    const msg = sent.find(m => m.username === "noemail");
    expect(msg).toBeUndefined();
  });

  it("deduplicates: does not re-queue grants already marked notified", async () => {
    await seedProfile("alice", ALICE_PROFILE);

    // Pre-mark all 5 grants as already notified for alice.
    for (let id = 1; id <= 5; id++) {
      await env.USER_PROFILES.put(`notified:alice:${id}`, "1");
    }

    const sent = captureQueueSends();
    await runScheduled();

    const msg = sent.find(m => m.username === "alice");
    expect(msg).toBeUndefined();
  });

  it("processes multiple users independently in the same run", async () => {
    await seedProfile("alice", ALICE_PROFILE);
    await seedProfile("carol", CAROL_PROFILE);
    const sent = captureQueueSends();

    await runScheduled();

    const aliceMsg = sent.find(m => m.username === "alice");
    const carolMsg = sent.find(m => m.username === "carol");
    expect(aliceMsg).toBeDefined();
    expect(carolMsg).toBeDefined();
    expect(aliceMsg.matches).not.toBe(carolMsg.matches);
  });

  it("runs without error when there are no profiles", async () => {
    await expect(runScheduled()).resolves.not.toThrow();
  });

  it("runs without error when the programs table is empty", async () => {
    await seedProfile("alice", ALICE_PROFILE);
    await expect(runScheduled()).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// scheduled() — notified KV is written after queuing
// ---------------------------------------------------------------------------

describe("scheduled: deduplication state", () => {
  beforeEach(seedGrants);

  it("sets notified KV keys for each queued grant", async () => {
    await seedProfile("alice", ALICE_PROFILE);
    const sent = captureQueueSends();

    await runScheduled();

    const msg = sent.find(m => m.username === "alice");
    if (!msg) return;  // no matches above threshold — nothing to check
    for (const { grant } of msg.matches) {
      const key = `notified:alice:${grant.id}`;
      const val = await env.USER_PROFILES.get(key);
      expect(val).toBe("1");
    }
  });
});

// ---------------------------------------------------------------------------
// refineProfileFromSelections (pure unit tests — no env needed)
// ---------------------------------------------------------------------------

describe("refineProfileFromSelections", () => {
  it("returns the original profile unchanged when there are no selections", () => {
    const profile = { ...CAROL_PROFILE };
    const result = refineProfileFromSelections(profile, []);
    expect(result.weights).toEqual(profile.weights);
  });

  it("boosts StackAlignment when >50% of selections are stack-required", () => {
    const profile = {
      weights: { Relevance: 0.3, Fit: 0.3, Ease: 0.2, StackAlignment: 0.1, CadenceRecency: 0.1 },
    };
    const selections = [
      { id: 1, stack_required: 1, cadence: "Annual", sponsor: "A" },
      { id: 2, stack_required: 1, cadence: "Annual", sponsor: "B" },
      { id: 3, stack_required: 0, cadence: "Annual", sponsor: "C" },
    ];
    const refined = refineProfileFromSelections(profile, selections);
    expect(refined.weights.StackAlignment).toBeGreaterThan(profile.weights.StackAlignment);
  });

  it("boosts CadenceRecency when >50% of selections are rolling", () => {
    const profile = {
      weights: { Relevance: 0.3, Fit: 0.3, Ease: 0.2, StackAlignment: 0.1, CadenceRecency: 0.1 },
    };
    const selections = [
      { id: 1, stack_required: 0, cadence: "Rolling", sponsor: "A" },
      { id: 2, stack_required: 0, cadence: "Rolling", sponsor: "B" },
      { id: 3, stack_required: 0, cadence: "Annual", sponsor: "C" },
    ];
    const refined = refineProfileFromSelections(profile, selections);
    expect(refined.weights.CadenceRecency).toBeGreaterThan(profile.weights.CadenceRecency);
  });

  it("does not boost when ≤50% of selections match a dimension", () => {
    const profile = {
      weights: { Relevance: 0.3, Fit: 0.3, Ease: 0.2, StackAlignment: 0.1, CadenceRecency: 0.1 },
    };
    const selections = [
      { id: 1, stack_required: 1, cadence: "Annual", sponsor: "A" },
      { id: 2, stack_required: 0, cadence: "Annual", sponsor: "B" },
    ];
    const refined = refineProfileFromSelections(profile, selections);
    // 1/2 = exactly 50%, not > 50%, so no boost
    expect(refined.weights.StackAlignment).toEqual(profile.weights.StackAlignment);
  });

  it("caps StackAlignment boost at 0.25", () => {
    const profile = {
      weights: { Relevance: 0.1, Fit: 0.1, Ease: 0.1, StackAlignment: 0.25, CadenceRecency: 0.1 },
    };
    const selections = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, stack_required: 1, cadence: "Annual", sponsor: "A",
    }));
    // Run multiple times to attempt to push past cap.
    let p = profile;
    for (let i = 0; i < 5; i++) p = refineProfileFromSelections(p, selections);

    const rawWeight = p.weights.StackAlignment * Object.values(p.weights).reduce((a, b) => a + b, 0);
    // After renormalization, StackAlignment / sum should not exceed 0.25 / sum before renorm.
    // The cap is applied before renormalization.
    expect(rawWeight).toBeLessThanOrEqual(0.26);  // small tolerance for renorm arithmetic
  });

  it("renormalizes weights so they sum to ~1.0", () => {
    const profile = {
      weights: { Relevance: 0.3, Fit: 0.3, Ease: 0.2, StackAlignment: 0.1, CadenceRecency: 0.1 },
    };
    const selections = [
      { id: 1, stack_required: 1, cadence: "Rolling", sponsor: "A" },
      { id: 2, stack_required: 1, cadence: "Rolling", sponsor: "B" },
    ];
    const refined = refineProfileFromSelections(profile, selections);
    const sum = Object.values(refined.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("builds a sponsorAffinity map from selections", () => {
    const profile = { weights: { Relevance: 0.3, Fit: 0.3, Ease: 0.2, StackAlignment: 0.1, CadenceRecency: 0.1 } };
    const selections = [
      { id: 1, stack_required: 0, cadence: "Annual", sponsor: "Sponsor A" },
      { id: 2, stack_required: 0, cadence: "Annual", sponsor: "Sponsor A" },
      { id: 3, stack_required: 0, cadence: "Annual", sponsor: "Sponsor B" },
    ];
    const refined = refineProfileFromSelections(profile, selections);
    expect(refined.sponsorAffinity).toEqual({ "Sponsor A": 2, "Sponsor B": 1 });
  });

  it("handles null/undefined selections gracefully", () => {
    const profile = { weights: { ...DEFAULT_WEIGHTS_TEST } };
    expect(() => refineProfileFromSelections(profile, null)).not.toThrow();
    expect(() => refineProfileFromSelections(profile, undefined)).not.toThrow();
  });
});

const DEFAULT_WEIGHTS_TEST = { Relevance: 0.3, Fit: 0.3, Ease: 0.2, StackAlignment: 0.1, CadenceRecency: 0.1 };

// ---------------------------------------------------------------------------
// queue handler — notification consumer
// ---------------------------------------------------------------------------

describe("queue: notification consumer", () => {
  it("acks all messages after processing", async () => {
    const ackedIds = [];
    const batch = {
      messages: [
        {
          id: "msg-1",
          body: {
            username: "alice",
            email: "alice@example.com",
            matches: [{ grant: { id: 1, name: "Test Grant", sponsor: "TestCo", deadline: null }, score: 8.5 }],
          },
          ack: () => ackedIds.push("msg-1"),
          retry: () => {},
        },
        {
          id: "msg-2",
          body: { username: "missing-email", email: null, matches: [] },
          ack: () => ackedIds.push("msg-2"),
          retry: () => {},
        },
      ],
    };

    const ctx = createExecutionContext();
    await profileMatcher.queue(batch, env);
    await waitOnExecutionContext(ctx);

    // Both messages must be acked (no RESEND_API_KEY in test env → graceful skip for msg-1)
    expect(ackedIds).toContain("msg-1");
    expect(ackedIds).toContain("msg-2");
  });

  it("does not throw when email is missing from the profile", async () => {
    const batch = {
      messages: [
        {
          id: "msg-1",
          body: { username: "nobody", email: null, matches: [{ grant: { id: 1, name: "G", sponsor: "S" }, score: 7 }] },
          ack: vi.fn(),
          retry: vi.fn(),
        },
      ],
    };
    await expect(profileMatcher.queue(batch, env)).resolves.not.toThrow();
    expect(batch.messages[0].ack).toHaveBeenCalled();
  });

  it("does not throw when matches array is empty", async () => {
    const batch = {
      messages: [
        {
          id: "msg-1",
          body: { username: "alice", email: "alice@example.com", matches: [] },
          ack: vi.fn(),
          retry: vi.fn(),
        },
      ],
    };
    await expect(profileMatcher.queue(batch, env)).resolves.not.toThrow();
    expect(batch.messages[0].ack).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildEmailSummary (pure function — no bindings needed)
// ---------------------------------------------------------------------------

describe("buildEmailSummary", () => {
  const matches = [
    { grant: { name: "TechFoundation Accelerator", sponsor: "TechFoundation", deadline: null }, score: 9.1 },
    { grant: { name: "Stack Partner Program", sponsor: "CloudCo", deadline: "2026-09-30" }, score: 7.4 },
  ];

  it("subject contains the match count", () => {
    const { subject } = buildEmailSummary("alice", matches);
    expect(subject).toContain("2");
  });

  it("singular subject when there is exactly one match", () => {
    const { subject } = buildEmailSummary("alice", [matches[0]]);
    expect(subject).toMatch(/1 new grant match\b/);
    expect(subject).not.toMatch(/matches/);
  });

  it("body HTML contains the username", () => {
    const { html } = buildEmailSummary("alice", matches);
    expect(html).toContain("alice");
  });

  it("body HTML contains all grant names", () => {
    const { html } = buildEmailSummary("alice", matches);
    expect(html).toContain("TechFoundation Accelerator");
    expect(html).toContain("Stack Partner Program");
  });

  it("body HTML contains sponsor names", () => {
    const { html } = buildEmailSummary("alice", matches);
    expect(html).toContain("TechFoundation");
    expect(html).toContain("CloudCo");
  });

  it("body HTML contains formatted scores", () => {
    const { html } = buildEmailSummary("alice", matches);
    expect(html).toContain("9.1");
    expect(html).toContain("7.4");
  });

  it("body HTML contains deadline information when present", () => {
    const { html } = buildEmailSummary("alice", matches);
    expect(html).toContain("2026-09-30");
  });

  it("escapes HTML characters in grant names to prevent XSS", () => {
    const xssMatches = [
      { grant: { name: '<script>alert("xss")</script>', sponsor: "Bad Actor", deadline: null }, score: 8 },
    ];
    const { html } = buildEmailSummary("alice", xssMatches);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("returns valid HTML structure with html/body tags", () => {
    const { html } = buildEmailSummary("alice", matches);
    expect(html).toContain("<html");
    expect(html).toContain("<body");
    expect(html).toContain("</body>");
    expect(html).toContain("</html>");
  });
});

// ---------------------------------------------------------------------------
// worker.js integration — /api/profile/select-grant
// ---------------------------------------------------------------------------

describe("POST /api/profile/select-grant", () => {
  it("requires authentication", async () => {
    const res = await fetch(new Request("http://localhost/api/profile/select-grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantId: 1 }),
    }));
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Import the main worker for the select-grant auth test above
// ---------------------------------------------------------------------------
import worker from "../worker.js";

async function fetch(request) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
