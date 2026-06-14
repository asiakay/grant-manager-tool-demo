/**
 * FoundationPlanner — Profile Matcher Worker
 *
 * Triggered:
 *   scheduled  — cron (daily at 08:00 UTC).  Scores all D1 grants against every
 *                user profile, queues notifications for high-scoring matches.
 *   queue      — NOTIFY_QUEUE consumer.  Sends one summary email per message
 *                via the Resend API.
 *
 * Required bindings (workers/profile_matcher_wrangler.toml):
 *   USER_PROFILES  KV namespace  (shared with the main web worker)
 *   GRANT_MANAGER_DB  D1 database  (shared)
 *   NOTIFY_QUEUE   Queue producer + consumer
 *
 * Required secrets (set with wrangler secret put):
 *   RESEND_API_KEY
 *
 * Optional env vars (set in [vars]):
 *   SCORE_THRESHOLD  float, default 6.0
 */

import {
  computeScore,
  buildEmailSummary,
  DEFAULT_WEIGHTS,
} from "./scoring_utils.js";

// KV key prefixes — must match the main worker.js conventions.
const PROFILE_PREFIX    = "profile:";
const SELECTIONS_PREFIX = "selections:";
const NOTIFIED_PREFIX   = "notified:";

// TTL for the "already notified" deduplication key (30 days).
const NOTIFIED_TTL_SECONDS = 30 * 24 * 60 * 60;

// How many grants to process per user per run (guard against very large tables).
const GRANT_BATCH_LIMIT = 200;

// Maximum matches to include in a single notification.
const MAX_MATCHES_PER_EMAIL = 10;

// ---------------------------------------------------------------------------
// Scheduled handler — daily profile matching
// ---------------------------------------------------------------------------

async function runScheduled(env) {
  const threshold = parseFloat(env.SCORE_THRESHOLD ?? "6.0");

  // List all profile keys.  USER_PROFILES stores profiles under "profile:{username}".
  const profileList = await env.USER_PROFILES.list({ prefix: PROFILE_PREFIX });
  if (!profileList.keys.length) return;

  // Fetch all grants once and share across profiles (avoids N×M D1 queries).
  const grants = await fetchAllGrants(env.GRANT_MANAGER_DB);
  if (!grants.length) return;

  for (const { name: kvKey } of profileList.keys) {
    const username = kvKey.slice(PROFILE_PREFIX.length);
    try {
      await processUser(env, username, grants, threshold);
    } catch (err) {
      // Isolate per-user failures so one bad profile can't abort the whole run.
      console.error(`profile_matcher: error processing user ${username}`, err);
    }
  }
}

async function processUser(env, username, grants, threshold) {
  const rawProfile = await env.USER_PROFILES.get(PROFILE_PREFIX + username, "json");
  if (!rawProfile) return;

  // Skip users with no email — we have nowhere to send the notification.
  const email = rawProfile.email;
  if (!email) return;

  // Fetch selection history and refine profile weights.
  const selectionIds = await loadSelectionIds(env, username);
  const selectedGrants = grants.filter(g => selectionIds.has(g.id));
  const profile = refineProfileFromSelections(rawProfile, selectedGrants);

  const matches = [];
  for (const grant of grants) {
    const score = computeScore(grant, profile.weights ?? DEFAULT_WEIGHTS, profile);
    if (score < threshold) continue;

    // Deduplication: skip grants we already notified this user about.
    const dedupeKey = `${NOTIFIED_PREFIX}${username}:${grant.id}`;
    const alreadySent = await env.USER_PROFILES.get(dedupeKey);
    if (alreadySent) continue;

    matches.push({ grant, score });
  }

  if (!matches.length) return;

  // Sort best-first and cap before queuing.
  matches.sort((a, b) => b.score - a.score);
  const topMatches = matches.slice(0, MAX_MATCHES_PER_EMAIL);

  await env.NOTIFY_QUEUE.send({ username, email, matches: topMatches });

  // Mark these grants as notified so they're not re-queued next run.
  await Promise.all(
    topMatches.map(({ grant }) =>
      env.USER_PROFILES.put(
        `${NOTIFIED_PREFIX}${username}:${grant.id}`,
        "1",
        { expirationTtl: NOTIFIED_TTL_SECONDS },
      )
    )
  );
}

// ---------------------------------------------------------------------------
// Queue handler — NOTIFY_QUEUE consumer → email via Resend
// ---------------------------------------------------------------------------

async function runQueue(batch, env) {
  for (const msg of batch.messages) {
    try {
      const { username, email, matches } = msg.body;
      if (!email || !matches?.length) {
        msg.ack();
        continue;
      }

      const { subject, html } = buildEmailSummary(username, matches);
      await sendEmailViaResend(env.RESEND_API_KEY, email, subject, html);
      msg.ack();
    } catch (err) {
      console.error("profile_matcher: queue handler error", err);
      msg.retry();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchAllGrants(db) {
  const result = await db
    .prepare(`SELECT * FROM programs ORDER BY id DESC LIMIT ${GRANT_BATCH_LIMIT}`)
    .all();
  return result.results ?? [];
}

async function loadSelectionIds(env, username) {
  const raw = await env.USER_PROFILES.get(SELECTIONS_PREFIX + username, "json");
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map(Number).filter(Number.isFinite));
}

/**
 * Lightweight preference learning.
 *
 * Inspects the grants a user has explicitly selected (via /api/profile/select-grant)
 * and nudges their weights toward dimensions that feature in their selections.
 * Adjustments are capped so the profile can always be overridden by the user.
 */
export function refineProfileFromSelections(profile, selectedGrants) {
  if (!selectedGrants?.length) return profile;

  const total = selectedGrants.length;
  const stackCount   = selectedGrants.filter(g => g.stack_required === 1).length;
  const rollingCount = selectedGrants.filter(g =>
    String(g.cadence || "").toLowerCase().includes("rolling")
  ).length;

  // Build a sponsor-affinity map for potential future ranking use.
  const sponsorAffinity = {};
  for (const g of selectedGrants) {
    if (g.sponsor) sponsorAffinity[g.sponsor] = (sponsorAffinity[g.sponsor] ?? 0) + 1;
  }

  const weights = { ...(profile.weights ?? DEFAULT_WEIGHTS) };

  if (stackCount / total > 0.5) {
    weights.StackAlignment = Math.min(0.25, (weights.StackAlignment ?? 0.1) + 0.05);
  }
  if (rollingCount / total > 0.5) {
    weights.CadenceRecency = Math.min(0.25, (weights.CadenceRecency ?? 0.1) + 0.05);
  }

  // Renormalize so weights still sum to 1.
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (const k of Object.keys(weights)) weights[k] = weights[k] / sum;
  }

  return { ...profile, weights, sponsorAffinity };
}

async function sendEmailViaResend(apiKey, to, subject, html) {
  if (!apiKey) {
    console.warn("profile_matcher: RESEND_API_KEY not set — skipping email send");
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "FoundationPlanner <notifications@foundationplanner.app>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  async scheduled(_event, env, _ctx) {
    await runScheduled(env);
  },

  async queue(batch, env) {
    await runQueue(batch, env);
  },
};
