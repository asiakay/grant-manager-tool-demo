
function log(level, event, fields = {}) {
  console.log(JSON.stringify({ level, event, ...fields, ts: Date.now() }));
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_SALT_BYTES = 16;
const PBKDF2_KEY_BYTES  = 32;

function toHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Returns a PBKDF2-HMAC-SHA256 hash string: "pbkdf2$<iters>$<salt_hex>$<key_hex>"
async function hashPassword(pass) {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    keyMaterial,
    PBKDF2_KEY_BYTES * 8
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(derived)}`;
}

// Constant-time buffer equality (prevents timing attacks).
function bufEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Verifies a password against a stored hash.
// Accepts both PBKDF2 ("pbkdf2$...") and legacy SHA-256 (64-char hex).
// Returns { ok: boolean, legacy: boolean } — callers should re-hash on legacy match.
async function verifyPassword(stored, pass) {
  if (typeof stored !== "string") return { ok: false, legacy: false };

  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    if (parts.length !== 4) return { ok: false, legacy: false };
    const [, iters, saltHex, keyHex] = parts;
    const iterations = parseInt(iters, 10);
    if (!iterations || saltHex.length % 2 !== 0 || keyHex.length % 2 !== 0) {
      return { ok: false, legacy: false };
    }
    const salt = new Uint8Array(saltHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
    const expected = new Uint8Array(keyHex.match(/.{2}/g).map((h) => parseInt(h, 16)));
    const keyMaterial = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]
    );
    const derived = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      keyMaterial,
      expected.byteLength * 8
    );
    return { ok: bufEqual(new Uint8Array(derived), expected), legacy: false };
  }

  // Legacy SHA-256 path (64-char hex). Used for backward compat with old USER_HASHES values.
  if (/^[0-9a-f]{64}$/i.test(stored)) {
    const data = new TextEncoder().encode(pass);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const hex = toHex(hash);
    return { ok: hex === stored.toLowerCase(), legacy: true };
  }

  return { ok: false, legacy: false };
}

async function getColumns(db) {
  const { results } = await db.prepare("PRAGMA table_info(programs)").all();
  return results.map((r) => r.name);
}

// Schema is managed by migrations/. This constant is only used as a fallback
// safety-net CREATE IF NOT EXISTS for the CSV-upload path on environments that
// haven't run migrations yet. It matches the post-migration (0002) schema.
const PROGRAMS_SCHEMA = `CREATE TABLE IF NOT EXISTS programs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  type             TEXT,
  name             TEXT NOT NULL UNIQUE,
  sponsor          TEXT,
  source_url       TEXT,
  region_eligibility TEXT,
  deadline         TEXT,
  cadence          TEXT,
  benefits         TEXT,
  eligibility_conditions TEXT,
  stage            TEXT,
  non_dilutive     INTEGER,
  stack_required   INTEGER,
  relevance        REAL,
  fit              REAL,
  ease             REAL,
  weighted_score   REAL,
  notes            TEXT
)`;

function getAdminUsers(env) {
  const raw = typeof env.ADMIN_USERS === "string" && env.ADMIN_USERS.trim() !== ""
    ? env.ADMIN_USERS
    : "demo";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_ROWS = 2000;

// RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF/CR line endings.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

// Match CSV headers to DB columns ignoring case and whitespace, so
// "Deadline/Next Cohort" and "Deadline / Next Cohort" map to the same column.
function normalizeHeader(h) {
  return String(h || "").replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, "");
}

// Aliases for column headers used in existing CSV exports that differ from DB column names.
const CSV_COLUMN_ALIASES = {
  "grantname":   "name",
  "easeofuse":   "ease",
  "link":        "source_url",
  "matchreq%":   "weighted_score",
  "match%":      "weighted_score",
};

function resolveHeader(h) {
  const norm = normalizeHeader(h);
  return CSV_COLUMN_ALIASES[norm] ?? norm;
}

const DEFAULT_WEIGHTS = { Relevance: 0.3, Fit: 0.3, Ease: 0.2, StackAlignment: 0.1, CadenceRecency: 0.1 };

// Maps user-facing focus area labels to keywords searched in grant text fields.
const FOCUS_AREA_KEYWORDS = {
  "Health & Medicine":        ["health", "medicine", "medical", "clinical", "biomedical", "disease", "drug", "therapeutics", "patient"],
  "Education & Workforce":    ["education", "workforce", "training", "learning", "student", "school", "academic", "career"],
  "Technology & Innovation":  ["technology", "innovation", "tech", "software", "digital", "engineering", "data", "ai", "computing"],
  "Housing & Community":      ["housing", "community", "neighborhood", "affordable", "urban", "rural", "infrastructure"],
  "Environment & Climate":    ["environment", "climate", "energy", "sustainability", "clean", "emissions", "carbon", "ecology"],
  "Agriculture & Food":       ["agriculture", "food", "farm", "crop", "nutrition", "rural", "livestock"],
  "Social Services":          ["social", "welfare", "poverty", "disability", "elderly", "child", "family", "services"],
  "Arts & Humanities":        ["arts", "humanities", "culture", "museum", "heritage", "creative", "media"],
  "International Development":["international", "global", "developing", "foreign", "overseas", "aid"],
  "Veterans & Military":      ["veteran", "military", "defense", "armed forces", "service member"],
  "Research & Science":       ["research", "science", "scientific", "laboratory", "study", "investigation"],
  "Justice & Safety":         ["justice", "safety", "law", "crime", "court", "police", "legal", "equity"],
};

const ORG_TYPE_KEYWORDS = {
  "Nonprofit/NGO":                    ["nonprofit", "ngo", "foundation", "charitable", "501(c)"],
  "University/Research Institution":  ["university", "college", "academic", "institution", "research institution"],
  "Startup/Small Business":           ["startup", "small business", "entrepreneur", "company", "commercial", "industry"],
  "Government/Tribal":                ["government", "tribal", "municipality", "state", "federal", "public"],
  "Individual Researcher":            ["individual", "researcher", "investigator", "pi ", "principal investigator"],
  "Hospital/Health System":           ["hospital", "health system", "clinic", "medical center"],
};

const STAGE_KEYWORDS = {
  "Early Research / Ideation":  ["early", "exploratory", "pilot", "proof of concept", "ideation", "basic research", "preliminary"],
  "Pilot / Proof of Concept":   ["pilot", "proof of concept", "demonstration", "feasibility"],
  "Growth / Scaling":           ["scale", "scaling", "expansion", "growth", "replication"],
  "Established Program":        ["established", "sustained", "continuation", "operational", "ongoing"],
};

// Returns 0-1 profile match score based on how well a grant's text matches the user profile.
function computeProfileMatch(r, profile) {
  const focusAreas = Array.isArray(profile.focusAreas) ? profile.focusAreas : [];
  const orgType    = profile.orgType  || "";
  const stage      = profile.stage    || "";

  if (!focusAreas.length && !orgType && !stage) return 0;

  // Concatenate all searchable text from the grant record (lower-cased).
  const text = [
    r.name || "",
    r.sponsor || "",
    r.benefits || "",
    r.eligibility_conditions || "",
    r.region_eligibility || "",
    r.type || "",
    r.notes || "",
  ].join(" ").toLowerCase();

  let hits = 0;
  let checks = 0;

  // Focus area match — any keyword hit from any selected area counts
  if (focusAreas.length) {
    const focusKeywords = focusAreas.flatMap(fa => FOCUS_AREA_KEYWORDS[fa] || []);
    if (focusKeywords.length) {
      checks++;
      if (focusKeywords.some(kw => text.includes(kw))) hits++;
    }
  }

  // Org type match
  const orgKeywords = ORG_TYPE_KEYWORDS[orgType] || [];
  if (orgKeywords.length) {
    checks++;
    if (orgKeywords.some(kw => text.includes(kw))) hits++;
  }

  // Stage match
  const stageKeywords = STAGE_KEYWORDS[stage] || [];
  if (stageKeywords.length) {
    checks++;
    if (stageKeywords.some(kw => text.includes(kw))) hits++;
  }

  return checks ? hits / checks : 0;
}

function computeStackAlignment(r) {
  return (r.stack_required === 1) ? 1.0 : 0.2;
}

function computeCadenceRecency(r) {
  const cadence = String(r.cadence || "").toLowerCase();
  if (cadence.includes("rolling")) return 1.0;
  const raw = r.deadline;
  if (!raw) return 0;
  const deadline = new Date(raw);
  if (isNaN(deadline.getTime())) return 0;
  const daysUntil = (deadline.getTime() - Date.now()) / 86400000;
  if (daysUntil < 0) return 0;
  return Math.max(0, Math.min(1, 1 - daysUntil / 365));
}

function computeScore(r, weights, profile) {
  const w = weights || DEFAULT_WEIGHTS;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const wn = {
    Relevance:      (w.Relevance ?? 0) / total,
    Fit:            (w.Fit ?? 0) / total,
    Ease:           (w.Ease ?? 0) / total,
    StackAlignment: (w.StackAlignment ?? 0) / total,
    CadenceRecency: (w.CadenceRecency ?? 0) / total,
  };
  const relevance  = parseFloat(r.relevance) || 0;
  const fit        = parseFloat(r.fit) || 0;
  const ease       = parseFloat(r.ease) || 0;
  const stack      = computeStackAlignment(r);
  const cadence    = computeCadenceRecency(r);
  // Relevance/Fit/Ease are 0-3; stack and cadence are 0-1.
  // Multiply stack/cadence by 3 so all components share the same scale.
  const baseScore = wn.Relevance * relevance
       + wn.Fit * fit
       + wn.Ease * ease
       + wn.StackAlignment * (stack * 3)
       + wn.CadenceRecency * (cadence * 3);

  // Profile match bonus: up to +1.5 added on top of the 0-3 base score.
  // Grants matching the user's focus areas, org type, and stage rank higher.
  const profileMatch = profile ? computeProfileMatch(r, profile) : 0;
  return baseScore + profileMatch * 1.5;
}

const SESSION_TTL = 86400; // 24 hours in seconds

function jsonResponse(body, init = {}) {
  const status = init.status ?? 200;
  const extra = init.headers ?? {};
  return new Response(body, {
    ...init,
    status,
    headers: {
      "content-type": "application/json",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

async function resolveSession(env, cookie) {
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  if (!token || !env.USER_PROFILES) return null;
  const username = await env.USER_PROFILES.get(`session:${token}`);
  return username || null;
}

async function validateCsrf(request, env, username) {
  const token = request.headers.get("X-CSRF-Token");
  if (!token) return false;
  const stored = env.USER_PROFILES
    ? await env.USER_PROFILES.get(`csrf:${username}`)
    : null;
  return stored === token;
}

async function checkRateLimit(kv, key) {
  const now = Date.now();
  let rec = (await kv.get(key, { type: "json" })) || { count: 0, time: now };
  if (now - rec.time > LOCKOUT_MS) { rec.count = 0; rec.time = now; }
  if (rec.count >= MAX_ATTEMPTS) return { blocked: true, rec };
  rec.count++;
  rec.time = now;
  await kv.put(key, JSON.stringify(rec));
  return { blocked: false, rec };
}

async function fetchFromSimplerGrants(env, query, page = 1, pageSize = 25) {
  if (!env.SIMPLER_GRANTS_API_KEY) {
    throw new Error("Missing required credential binding: SIMPLER_GRANTS_API_KEY.");
  }
  const response = await fetch("https://api.simpler.grants.gov/v1/opportunities/search", {
    method: "POST",
    headers: {
      "X-API-Key": env.SIMPLER_GRANTS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
        funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
      },
      pagination: {
        page_offset: page,
        page_size: pageSize,
        sort_order: [{ order_by: "relevancy", sort_direction: "descending" }],
      },
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`Upstream API failed with status ${response.status}: ${errText.slice(0, 200)}`);
  }
  return await response.json();
}

async function syncGrantsWithD1(env, query) {
  if (!env.GRANT_MANAGER_DB) {
    throw new Error("D1 binding (GRANT_MANAGER_DB) is missing.");
  }
  const apiData = await fetchFromSimplerGrants(env, query, 1, 25);
  const opportunities = apiData?.data || apiData?.data?.oppHits || apiData?.items || [];
  if (opportunities.length === 0) {
    return { success: true, inserted: 0, message: "Sync complete. No records returned from server filters." };
  }

  await env.GRANT_MANAGER_DB.prepare(PROGRAMS_SCHEMA).run();

  function fmtAward(floor, ceiling) {
    const fmt = (n) => "$" + Number(n).toLocaleString("en-US");
    if (floor && ceiling) return `${fmt(floor)} – ${fmt(ceiling)}`;
    if (ceiling) return `Up to ${fmt(ceiling)}`;
    if (floor) return `From ${fmt(floor)}`;
    return "";
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "";
  }

  const insertStmt = env.GRANT_MANAGER_DB.prepare(`
    INSERT INTO programs (
      type, name, sponsor, source_url, region_eligibility, deadline, cadence, benefits,
      eligibility_conditions, stage, non_dilutive, stack_required, relevance, fit, ease,
      weighted_score, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      type = excluded.type,
      sponsor = excluded.sponsor,
      source_url = excluded.source_url,
      deadline = excluded.deadline,
      benefits = excluded.benefits,
      eligibility_conditions = excluded.eligibility_conditions,
      stage = excluded.stage
  `);

  const statements = opportunities.map((opp) => {
    const summary = opp.summary || opp;
    const name = opp.opportunity_title || summary.opportunity_title || "Untitled Grant";
    const type = capitalize(opp.funding_instrument || summary.funding_instruments?.[0] || "grant");
    const sponsor = opp.agency_name || summary.agency_name || opp.agency_code || "Unknown Agency";
    const sourceUrl = opp.opportunity_id ? `https://grants.gov/search-results-detail/${opp.opportunity_id}` : "";
    const deadline = opp.close_date || summary.close_date || "";
    const benefits = fmtAward(opp.award_floor ?? summary.award_floor, opp.award_ceiling ?? summary.award_ceiling);
    const eligibility = Array.isArray(opp.applicant_types)
      ? opp.applicant_types.map(capitalize).join(", ")
      : Array.isArray(summary.applicant_types)
        ? summary.applicant_types.map(capitalize).join(", ")
        : "";
    const stage = capitalize(opp.opportunity_status || "");
    // Derive a simple relevance score (0-3) from how many known grant domains the
    // title/eligibility text mentions, so grants aren't all scored equally at 0.
    const grantText = [name, sponsor, benefits, eligibility].join(" ").toLowerCase();
    const domainCount = Object.values(FOCUS_AREA_KEYWORDS).filter(kws => kws.some(kw => grantText.includes(kw))).length;
    const derivedRelevance = Math.min(3, Math.round((domainCount / Object.keys(FOCUS_AREA_KEYWORDS).length) * 3 * 10) / 10);
    return insertStmt.bind(type, name, sponsor, sourceUrl, "", deadline, "", benefits, eligibility, stage, 1, 0, derivedRelevance, 0, 0, 0, "");
  });

  await env.GRANT_MANAGER_DB.batch(statements);
  return { success: true, inserted: opportunities.length, message: `Successfully loaded ${opportunities.length} active opportunities to local storage.` };
}

const SCORE_BATCH_SIZE = 15; // AI calls per waitUntil invocation

// Scores one batch of unscored grants for a user and saves to KV.
// Called via ctx.waitUntil so it runs after the response is sent.
// Each invocation scores up to SCORE_BATCH_SIZE grants; subsequent
// fetches of /api/grants trigger the next batch until all are done.
async function scoreNextBatchForUser(username, profile, env) {
  const hasAI = env.AI || (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN);
  if (!hasAI || !env.GRANT_MANAGER_DB || !env.USER_PROFILES) return;

  const focusAreas = Array.isArray(profile.focusAreas) ? profile.focusAreas.join(", ") : "";
  const orgType = profile.orgType || "";
  const stage = profile.stage || "";
  if (!focusAreas && !orgType && !stage) return;

  const tableColumns = await getColumns(env.GRANT_MANAGER_DB);
  const hasNewSchema = tableColumns.includes("source_url");
  const nameCol     = hasNewSchema ? "name"                   : '"Name"';
  const sponsorCol  = hasNewSchema ? "sponsor"                : '"Sponsor"';
  const benefitsCol = hasNewSchema ? "benefits"               : '"Benefits"';
  const eligCol     = hasNewSchema ? "eligibility_conditions" : '"Eligibility (key conditions)"';
  const typeCol     = hasNewSchema ? "type"                   : '"Type"';
  const stageCol    = hasNewSchema ? "stage"                  : '"Stage"';

  // Load existing scores
  let scores = {};
  try {
    const raw = await env.USER_PROFILES.get(`user_scores:${username}`);
    if (raw) scores = JSON.parse(raw);
  } catch { /* start fresh */ }

  // Fetch only grants not yet scored for this user
  const { results: allGrants } = await env.GRANT_MANAGER_DB.prepare(
    `SELECT ${nameCol} as name, ${sponsorCol} as sponsor, ${benefitsCol} as benefits,
            ${eligCol} as eligibility_conditions, ${typeCol} as type, ${stageCol} as stage
     FROM programs ORDER BY rowid`
  ).all();

  const unscored = allGrants.filter(g => !scores[g.name]);
  if (!unscored.length) return;

  const batch = unscored.slice(0, SCORE_BATCH_SIZE);

  const profileSummary = [
    focusAreas && `Focus areas: ${focusAreas}`,
    orgType && `Organization type: ${orgType}`,
    stage && `Stage: ${stage}`,
  ].filter(Boolean).join("\n");

  async function runAI(messages) {
    if (env.AI) {
      const r = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages, stream: false });
      return r.response || "";
    }
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      { method: "POST", headers: { "Authorization": `Bearer ${env.CF_AI_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages }) }
    );
    const d = await r.json();
    return d.result?.response ?? "";
  }

  for (const grant of batch) {
    try {
      const context = [
        `Grant: ${grant.name}`,
        grant.sponsor && `Sponsor: ${grant.sponsor}`,
        grant.type && `Type: ${grant.type}`,
        grant.stage && `Stage: ${grant.stage}`,
        grant.benefits && `Benefits: ${grant.benefits}`,
        grant.eligibility_conditions && `Eligibility: ${grant.eligibility_conditions}`,
      ].filter(Boolean).join("\n");

      const prompt = `Evaluate this grant for a user with the following profile.

User profile:
${profileSummary}

Grant:
${context}

Score on three dimensions (integers 0-3 only):
- relevance: Does this grant's purpose match the user's focus areas? 0=unrelated, 3=direct match.
- fit: Does the eligibility match the user's org type and stage? 0=ineligible, 3=ideal.
- ease: How easy is it for this user to apply? 0=very difficult, 3=straightforward.

Reply with ONLY valid JSON, nothing else. Example: {"relevance":2,"fit":1,"ease":3}`;

      const text = await runAI([{ role: "user", content: prompt }]);
      const m = text.match(/\{[^}]+\}/);
      if (m) {
        const parsed = JSON.parse(m[0]);
        const clamp = (v) => Math.min(3, Math.max(0, parseInt(v, 10) || 0));
        scores[grant.name] = { relevance: clamp(parsed.relevance), fit: clamp(parsed.fit), ease: clamp(parsed.ease) };
      }
    } catch { /* skip */ }
  }

  await env.USER_PROFILES.put(`user_scores:${username}`, JSON.stringify(scores));
}

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const reqStart = Date.now();
    const cookie = request.headers.get("Cookie") || "";
    const username = await resolveSession(env, cookie);
    const loggedIn = !!username;
    const reqCtx = { requestId, method: request.method, path: url.pathname, user: username ?? undefined };
    // USER_HASHES must contain pre-computed hashes — either the new PBKDF2 format
    // ("pbkdf2$600000$<salt_hex>$<key_hex>") or legacy SHA-256 (64-char hex, still
    // accepted for backward compat). Plain-text passwords are no longer auto-hashed
    // here because PBKDF2 hashes are salted and cannot be deterministically re-derived.
    // The demo user is seeded into D1 via migration 0003; no default is injected here.
    let envUsers = {};
    if (env.USER_HASHES) {
      try {
        const raw = JSON.parse(env.USER_HASHES);
        for (const [u, h] of Object.entries(raw)) {
          if (typeof h === "string" && (h.startsWith("pbkdf2$") || /^[0-9a-f]{64}$/i.test(h))) {
            envUsers[u] = h;
          } else {
            log("warn", "user_hashes_bad_format", { requestId, user: u });
          }
        }
      } catch (err) {
        log("warn", "invalid_user_hashes", { requestId, error: String(err) });
      }
    }

    const users = envUsers;

    if (url.pathname === "/signup" && request.method === "POST") {
      // Rate-limit signups per IP to block mass account creation
      if (env.LOGIN_ATTEMPTS) {
        const ip = request.headers.get("CF-Connecting-IP") || "unknown";
        const { blocked } = await checkRateLimit(env.LOGIN_ATTEMPTS, `signup:${ip}`);
        if (blocked) {
          log("warn", "signup_rate_limited", { requestId, ip });
          return new Response("Too many signup attempts. Try again later.", { status: 429 });
        }
      }

      const form = await request.formData();
      const newUser = (form.get("username") || "").trim();
      const newPass = form.get("password") || "";
      const confirmPass = form.get("confirm_password") || "";

      if (!newUser || newUser.length < 3 || newUser.length > 32) {
        return jsonResponse(JSON.stringify({ error: "Username must be 3–32 characters." }), { status: 400 });
      }
      if (!/^[a-zA-Z0-9_]+$/.test(newUser)) {
        return jsonResponse(JSON.stringify({ error: "Username may only contain letters, numbers, and underscores." }), { status: 400 });
      }
      if (!newPass || newPass.length < MIN_PASSWORD_LENGTH) {
        return jsonResponse(JSON.stringify({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }), { status: 400 });
      }
      if (newPass !== confirmPass) {
        return jsonResponse(JSON.stringify({ error: "Passwords do not match." }), { status: 400 });
      }

      const existing = await env.GRANT_MANAGER_DB.prepare(
        "SELECT username FROM users WHERE username = ?"
      ).bind(newUser).first();

      if (existing || users[newUser]) {
        log("info", "signup_username_taken", { requestId, username: newUser });
        return jsonResponse(JSON.stringify({ error: "Username is already taken." }), { status: 409 });
      }

      const hash = await hashPassword(newPass);
      await env.GRANT_MANAGER_DB.prepare(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"
      ).bind(newUser, hash, Date.now()).run();

      log("info", "signup_success", { requestId, username: newUser });
      return jsonResponse(JSON.stringify({ ok: true }), { status: 201 });
    }

    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      const user = form.get("username");
      const pass = form.get("password");
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";

      if (env.LOGIN_ATTEMPTS) {
        const stored = await env.LOGIN_ATTEMPTS.get(ip, { type: "json" });
        const now = Date.now();
        const rec = stored || { count: 0, time: now };
        if (now - rec.time <= LOCKOUT_MS && rec.count >= MAX_ATTEMPTS) {
          log("warn", "login_rate_limited", { requestId, ip });
          return new Response("Too many attempts. Try again later.", { status: 429 });
        }
      } else {
        log("warn", "login_attempts_binding_missing", { requestId });
      }

      let dbUser = null;
      try {
        dbUser = await env.GRANT_MANAGER_DB.prepare(
          "SELECT password_hash FROM users WHERE username = ?"
        ).bind(user).first();
      } catch (err) {
        log("warn", "login_d1_lookup_failed", { requestId, error: String(err) });
      }

      // Check D1 user first, then env users.
      let matchOk = false;
      let needsRehash = false;
      if (dbUser) {
        const { ok, legacy } = await verifyPassword(dbUser.password_hash, pass || "");
        matchOk = ok;
        needsRehash = ok && legacy;
      } else if (users[user]) {
        const { ok } = await verifyPassword(users[user], pass || "");
        matchOk = ok;
        // Env users can't be auto-upgraded (secret is outside our write scope).
      }

      if (matchOk) {
        // Lazy-upgrade legacy SHA-256 D1 hashes to PBKDF2 on successful login.
        if (needsRehash && env.GRANT_MANAGER_DB) {
          try {
            const upgraded = await hashPassword(pass);
            await env.GRANT_MANAGER_DB.prepare(
              "UPDATE users SET password_hash = ? WHERE username = ?"
            ).bind(upgraded, user).run();
            log("info", "password_hash_upgraded", { requestId, user });
          } catch (err) {
            log("warn", "password_hash_upgrade_failed", { requestId, error: String(err) });
          }
        }
        if (env.LOGIN_ATTEMPTS) await env.LOGIN_ATTEMPTS.delete(ip);
        const token = crypto.randomUUID();
        if (env.USER_PROFILES) {
          await env.USER_PROFILES.put(`session:${token}`, user, { expirationTtl: SESSION_TTL });
        }
        log("info", "login_success", { requestId, user, ip });
        const secure = url.protocol === "https:" ? "; Secure" : "";
        return new Response("", {
          status: 302,
          headers: {
            "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Lax${secure}`,
            Location: "/dashboard",
          },
        });
      }

      log("warn", "login_failed", { requestId, user, ip });
      // Failed login — increment attempt counter
      if (env.LOGIN_ATTEMPTS) {
        const now = Date.now();
        const prev = await env.LOGIN_ATTEMPTS.get(ip, { type: "json" }) || { count: 0, time: now };
        if (now - prev.time > LOCKOUT_MS) { prev.count = 0; prev.time = now; }
        prev.count++;
        prev.time = now;
        await env.LOGIN_ATTEMPTS.put(ip, JSON.stringify(prev));
      }
      return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname === "/api/profile") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (request.method === "GET") {
        const raw = env.USER_PROFILES ? await env.USER_PROFILES.get(`profile:${username}`) : null;
        const profile = raw ? JSON.parse(raw) : null;
        return jsonResponse(JSON.stringify(profile));
      }
      if (request.method === "POST") {
        if (!(await validateCsrf(request, env, username))) {
          log("warn", "csrf_rejected", { ...reqCtx, endpoint: "profile" });
          return new Response("Forbidden", { status: 403 });
        }
        const body = await request.json();
        await env.USER_PROFILES.put(`profile:${username}`, JSON.stringify(body));
        log("info", "profile_saved", reqCtx);
        // Clear stale scores so the UI reflects "scoring in progress" immediately,
        // then recompute in the background after this response is sent.
        if (env.USER_PROFILES) await env.USER_PROFILES.delete(`user_scores:${username}`);
        ctx.waitUntil(scoreNextBatchForUser(username, body, env));
        return jsonResponse(JSON.stringify({ ok: true, scoring: true }));
      }
    }

    if (url.pathname === "/api/ai-status") {
      const hasBinding = !!env.AI;
      const hasRestApi = !!(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN);
      const configured = hasBinding || hasRestApi;
      const provider = configured ? "workers-ai" : null;
      return jsonResponse(JSON.stringify({ configured, provider }));
    }

    if (url.pathname === "/api/grants") {
      if (!loggedIn) {
        return new Response("Unauthorized", { status: 401 });
      }
      let profile = {};
      if (env.USER_PROFILES) {
        const raw = await env.USER_PROFILES.get(`profile:${username}`);
        if (raw) {
          try { profile = JSON.parse(raw); } catch { profile = {}; }
        }
      }

      const userWeights = (profile.weights && typeof profile.weights === "object")
        ? profile.weights
        : null;

      // Load per-user AI scores computed against this user's profile.
      let userScores = {};
      if (env.USER_PROFILES) {
        try {
          const raw = await env.USER_PROFILES.get(`user_scores:${username}`);
          if (raw) userScores = JSON.parse(raw);
        } catch { /* fall back to keyword scoring */ }
      }
      const scoredCount = Object.keys(userScores).length;

      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get("pageSize") || "100", 10)));

      const grantsStart = Date.now();
      const columns = await getColumns(env.GRANT_MANAGER_DB);
      let scored = [];
      if (columns.length > 0) {
        const { results: rows } = await env.GRANT_MANAGER_DB.prepare(
            `SELECT * FROM programs`
        ).all();
        scored = rows
          .map((r) => {
            // Prefer per-user AI scores; fall back to DB scores + keyword match.
            const us = userScores[r.name] || userScores[r.Name];
            const rowWithScores = us ? { ...r, relevance: us.relevance, fit: us.fit, ease: us.ease } : r;
            return {
              ...r,
              relevance: rowWithScores.relevance,
              fit: rowWithScores.fit,
              ease: rowWithScores.ease,
              score: Math.round(computeScore(rowWithScores, userWeights, profile) * 100) / 100,
            };
          })
          .sort((a, b) => b.score - a.score);
      }
      const total = scored.length;
      const start = (page - 1) * pageSize;
      const data = scored.slice(start, start + pageSize);

      // If the user has a profile and there are still unscored grants, kick off
      // the next batch in the background so scoring converges over a few fetches.
      const hasProfile = profile && ((profile.focusAreas?.length) || profile.orgType || profile.stage);
      const scoringReady = scoredCount >= total;
      if (hasProfile && !scoringReady) {
        ctx.waitUntil(scoreNextBatchForUser(username, profile, env));
      }

      log("info", "grants_fetched", { ...reqCtx, total, page, pageSize, scoredCount, durationMs: Date.now() - grantsStart });
      return jsonResponse(JSON.stringify({ data, total, page, pageSize, scoringReady, scoredCount, totalGrants: total }));
    }

    if (url.pathname === "/api/me") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      return jsonResponse(JSON.stringify({ username, isAdmin: getAdminUsers(env).has(username) }));
    }

    if (url.pathname === "/api/csrf" && request.method === "GET") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      let csrfToken = env.USER_PROFILES
        ? await env.USER_PROFILES.get(`csrf:${username}`)
        : null;
      if (!csrfToken) {
        csrfToken = crypto.randomUUID();
        if (env.USER_PROFILES) {
          await env.USER_PROFILES.put(`csrf:${username}`, csrfToken, { expirationTtl: SESSION_TTL });
        }
      }
      return jsonResponse(JSON.stringify({ token: csrfToken }));
    }

    if (url.pathname === "/api/live-search" && request.method === "GET") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!env.SIMPLER_GRANTS_API_KEY) {
        return jsonResponse(JSON.stringify({
          error: "Live search is not configured. Set the SIMPLER_GRANTS_API_KEY secret.",
          configured: false,
        }), { status: 503 });
      }

      const q = (url.searchParams.get("q") || "").trim();
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const pageSize = Math.min(25, Math.max(1, parseInt(url.searchParams.get("pageSize") || "25", 10)));

      if (!q) return jsonResponse(JSON.stringify({ data: [], total: 0, page: 1, pageSize, configured: true }));

      // Load user profile for scoring
      let lsProfile = {};
      if (env.USER_PROFILES) {
        const raw = await env.USER_PROFILES.get(`profile:${username}`);
        if (raw) { try { lsProfile = JSON.parse(raw); } catch { lsProfile = {}; } }
      }
      const lsWeights = (lsProfile.weights && typeof lsProfile.weights === "object") ? lsProfile.weights : null;

      const searchStart = Date.now();
      let apiData;
      try {
        apiData = await fetchFromSimplerGrants(env, q, page, pageSize);
      } catch (err) {
        log("error", "live_search_fetch_failed", { ...reqCtx, error: String(err) });
        return jsonResponse(JSON.stringify({ error: err.message || "Failed to reach Simpler Grants API." }), { status: 502 });
      }

      function fmtAward(floor, ceiling) {
        const fmt = (n) => "$" + Number(n).toLocaleString("en-US");
        if (floor && ceiling) return `${fmt(floor)} – ${fmt(ceiling)}`;
        if (ceiling) return `Up to ${fmt(ceiling)}`;
        if (floor) return `From ${fmt(floor)}`;
        return "";
      }

      function capitalize(s) {
        return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "";
      }

      const data = (apiData.data || []).map((opp) => {
        const summary = opp.summary || opp;
        const grant = {
          "Type": capitalize(opp.funding_instrument || summary.funding_instruments?.[0] || "grant"),
          "Name": opp.opportunity_title || summary.opportunity_title || "",
          "Sponsor": opp.agency_name || summary.agency_name || opp.agency_code || "",
          "Source URL": opp.opportunity_id
            ? `https://grants.gov/search-results-detail/${opp.opportunity_id}`
            : "",
          "Region/Eligibility": "",
          "Deadline/Next Cohort": opp.close_date || summary.close_date || "",
          "Cadence": "",
          "Benefits": fmtAward(
            opp.award_floor ?? summary.award_floor,
            opp.award_ceiling ?? summary.award_ceiling
          ),
          "Eligibility (key conditions)": Array.isArray(opp.applicant_types)
            ? opp.applicant_types.map(capitalize).join(", ")
            : Array.isArray(summary.applicant_types)
              ? summary.applicant_types.map(capitalize).join(", ")
              : "",
          "Stage": capitalize(opp.opportunity_status || ""),
          "Non-dilutive?": "Yes",
          "Stack Required?": "No",
          "Relevance": 0,
          "Fit": 0,
          "Ease": 0,
          "Weighted Score": 0,
          "Notes/Actions": "",
        };
        return { ...grant, score: Math.round(computeScore(grant, lsWeights, lsProfile) * 100) / 100 };
      });

      const paginationInfo = apiData.pagination_info || {};
      const total = paginationInfo.total_records ?? data.length;
      log("info", "live_search_completed", { ...reqCtx, query: q, total, page, durationMs: Date.now() - searchStart });
      return jsonResponse(JSON.stringify({ data, total, page, pageSize, configured: true }));
    }

    if (url.pathname === "/api/sync" && request.method === "GET") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      try {
        const queryTerm = url.searchParams.get("query") || "";
        const syncResult = await syncGrantsWithD1(env, queryTerm);
        return jsonResponse(JSON.stringify(syncResult));
      } catch (err) {
        log("error", "database_sync_route_failed", { ...reqCtx, error: String(err) });
        return jsonResponse(JSON.stringify({ success: false, error: err.message }), { status: 500 });
      }
    }

    if (url.pathname === "/api/live-search-status") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      return jsonResponse(JSON.stringify({ configured: !!env.SIMPLER_GRANTS_API_KEY }));
    }

    if (url.pathname === "/api/health") {
      return jsonResponse(JSON.stringify({ ok: true }));
    }

    if (url.pathname === "/api/notes" && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await validateCsrf(request, env, username))) {
        log("warn", "csrf_rejected", { ...reqCtx, endpoint: "notes" });
        return new Response("Forbidden", { status: 403 });
      }
      if (!env.GRANT_MANAGER_DB) return new Response("Database not configured", { status: 503 });
      const form = await request.formData();
      const name = form.get("name");
      const notes = form.get("notes") ?? "";
      if (!name) return new Response("Missing name", { status: 400 });
      await env.GRANT_MANAGER_DB.prepare(
        `UPDATE programs SET notes = ? WHERE name = ?`
      )
        .bind(notes, name)
        .run();
      return jsonResponse(JSON.stringify({ ok: true }));
    }

    if (url.pathname === "/api/admin/upload-csv" && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!getAdminUsers(env).has(username)) {
        log("warn", "admin_upload_forbidden", reqCtx);
        return new Response("Forbidden", { status: 403 });
      }
      if (!(await validateCsrf(request, env, username))) {
        log("warn", "csrf_rejected", { ...reqCtx, endpoint: "admin-upload-csv" });
        return new Response("Forbidden", { status: 403 });
      }
      if (!env.GRANT_MANAGER_DB) return new Response("Database not configured", { status: 503 });

      const form = await request.formData();
      const file = form.get("file");
      const mode = form.get("mode") === "replace" ? "replace" : "merge";
      if (!file || typeof file === "string") {
        return jsonResponse(JSON.stringify({ error: "Missing CSV file upload (form field \"file\")." }), { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return jsonResponse(JSON.stringify({ error: "CSV file too large (max 5 MB)." }), { status: 413 });
      }

      const rows = parseCsv(await file.text());
      if (rows.length < 2) {
        return jsonResponse(JSON.stringify({ error: "CSV must contain a header row and at least one data row." }), { status: 400 });
      }
      if (rows.length - 1 > MAX_UPLOAD_ROWS) {
        return jsonResponse(JSON.stringify({ error: `CSV exceeds the ${MAX_UPLOAD_ROWS}-row limit.` }), { status: 400 });
      }

      const db = env.GRANT_MANAGER_DB;
      await db.prepare(PROGRAMS_SCHEMA).run();
      const columns = await getColumns(db);
      const colByNorm = new Map(columns.map((c) => [normalizeHeader(c), c]));

      const headers = rows[0];
      const mapping = headers.map((h) => colByNorm.get(resolveHeader(h)) ?? null);
      const unknownColumns = headers.filter((h, i) => !mapping[i] && String(h).trim() !== "");
      const nameIdx = mapping.indexOf("name");
      if (nameIdx === -1) {
        return jsonResponse(JSON.stringify({ error: 'CSV must include a "name" (or "Name") column.', unknownColumns }), { status: 400 });
      }

      // Deduplicate by name (last row wins); rows without a name are skipped.
      const byName = new Map();
      let skipped = 0;
      for (const row of rows.slice(1)) {
        const name = String(row[nameIdx] ?? "").trim();
        if (!name) { skipped++; continue; }
        const record = {};
        headers.forEach((h, i) => {
          if (mapping[i]) record[mapping[i]] = row[i] ?? "";
        });
        record.name = name;
        byName.set(name, record);
      }
      if (byName.size === 0) {
        return jsonResponse(JSON.stringify({ error: "No rows with a non-empty name were found." }), { status: 400 });
      }

      const names = [...byName.keys()];
      let updated = 0;
      if (mode === "replace") {
        await db.prepare("DELETE FROM programs").run();
      } else {
        for (let i = 0; i < names.length; i += 50) {
          const chunk = names.slice(i, i + 50);
          const placeholders = chunk.map(() => "?").join(",");
          const { results: existing } = await db.prepare(
            `SELECT name FROM programs WHERE name IN (${placeholders})`
          ).bind(...chunk).all();
          updated += existing.length;
          if (existing.length > 0) {
            await db.prepare(`DELETE FROM programs WHERE name IN (${placeholders})`).bind(...chunk).run();
          }
        }
      }

      const insertCols = [...new Set(mapping.filter(Boolean))];
      const insertStmt = db.prepare(
        `INSERT INTO programs (${insertCols.join(",")})
         VALUES (${insertCols.map(() => "?").join(",")})`
      );
      const statements = [...byName.values()].map((r) =>
        insertStmt.bind(...insertCols.map((c) => r[c] ?? ""))
      );
      for (let i = 0; i < statements.length; i += 50) {
        await db.batch(statements.slice(i, i + 50));
      }

      const inserted = byName.size - (mode === "replace" ? 0 : updated);
      log("info", "admin_csv_uploaded", { ...reqCtx, mode, inserted, updated, skipped, unknownColumns });
      return jsonResponse(JSON.stringify({ ok: true, mode, inserted, updated, skipped, total: byName.size, unknownColumns }));
    }

    if (url.pathname === "/api/admin/score-grants" && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!getAdminUsers(env).has(username)) return new Response("Forbidden", { status: 403 });
      if (!(await validateCsrf(request, env, username))) return new Response("Forbidden", { status: 403 });
      if (!env.GRANT_MANAGER_DB) return new Response("Database not configured", { status: 503 });

      const hasAI = env.AI || (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN);
      if (!hasAI) return new Response("AI not configured", { status: 503 });

      try {

      const body = await request.json().catch(() => ({}));
      const batch = Math.min(20, Math.max(1, parseInt(body.batch ?? "5", 10)));
      const rescore = body.rescore === true;

      // Detect whether the table uses the new snake_case schema (post-migration 0002)
      // or the original quoted-header schema, and map to a common shape.
      const tableColumns = await getColumns(env.GRANT_MANAGER_DB);
      const hasNewSchema = tableColumns.includes("source_url");

      const nameCol        = hasNewSchema ? "name"                      : '"Name"';
      const sponsorCol     = hasNewSchema ? "sponsor"                   : '"Sponsor"';
      const sourceUrlCol   = hasNewSchema ? "source_url"                : '"Source URL"';
      const benefitsCol    = hasNewSchema ? "benefits"                  : '"Benefits"';
      const eligCol        = hasNewSchema ? "eligibility_conditions"    : '"Eligibility (key conditions)"';
      const typeCol        = hasNewSchema ? "type"                      : '"Type"';
      const stageCol       = hasNewSchema ? "stage"                     : '"Stage"';
      const relevanceCol   = hasNewSchema ? "relevance"                 : '"Relevance"';
      const fitCol         = hasNewSchema ? "fit"                       : '"Fit"';

      const unscoredWhere = `WHERE (${relevanceCol} IS NULL OR CAST(${relevanceCol} AS REAL) = 0)`
                          + ` AND (${fitCol} IS NULL OR CAST(${fitCol} AS REAL) = 0)`;
      const filter = rescore ? "ORDER BY rowid LIMIT ?" : `${unscoredWhere} ORDER BY rowid LIMIT ?`;

      const { results: grants } = await env.GRANT_MANAGER_DB.prepare(
        `SELECT rowid as _rowid,
                ${nameCol} as name, ${sponsorCol} as sponsor, ${sourceUrlCol} as source_url,
                ${benefitsCol} as benefits, ${eligCol} as eligibility_conditions,
                ${typeCol} as type, ${stageCol} as stage
         FROM programs ${filter}`
      ).bind(batch).all();

      if (grants.length === 0) {
        return jsonResponse(JSON.stringify({ ok: true, scored: 0, message: "No unscored grants found." }));
      }

      async function fetchPageText(pageUrl) {
        if (!pageUrl) return "";
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          let res;
          try {
            res = await fetch(pageUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (compatible; GrantManagerBot/1.0)" },
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          if (!res.ok) return "";
          const html = await res.text();
          // Strip tags and collapse whitespace; cap at 2000 chars so it fits in the prompt.
          return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
        } catch {
          return "";
        }
      }

      async function scoreWithAI(grant, pageText) {
        const context = [
          `Name: ${grant.name}`,
          `Sponsor: ${grant.sponsor || "Unknown"}`,
          `Type: ${grant.type || ""}`,
          `Stage: ${grant.stage || ""}`,
          `Benefits: ${grant.benefits || ""}`,
          `Eligibility: ${grant.eligibility_conditions || ""}`,
          pageText ? `Page content excerpt:\n${pageText}` : "",
        ].filter(Boolean).join("\n");

        const prompt = `Score this grant opportunity on three dimensions, each from 0 to 3 (integers only).

Definitions:
- relevance (0-3): How clearly does this grant describe a real, specific funding opportunity with defined purpose and scope? 0=vague/unclear, 3=very clear and specific.
- fit (0-3): How broadly applicable is this grant across different org types (nonprofits, startups, researchers, govt)? 0=very narrow, 3=widely accessible.
- ease (0-3): How easy is it to apply? Consider rolling deadlines, simple requirements, no match required. 0=complex/burdensome, 3=straightforward.

Grant:
${context}

Respond with ONLY a JSON object, no explanation. Example: {"relevance":2,"fit":1,"ease":3}`;

        const messages = [{ role: "user", content: prompt }];
        let text = "";
        if (env.AI) {
          const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages, stream: false });
          text = result.response || "";
        } else {
          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
            { method: "POST", headers: { "Authorization": `Bearer ${env.CF_AI_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages }) }
          );
          const data = await res.json();
          text = data.result?.response ?? "";
        }
        const match = text.match(/\{[^}]+\}/);
        if (!match) return null;
        try {
          const parsed = JSON.parse(match[0]);
          const clamp = (v) => Math.min(3, Math.max(0, parseInt(v, 10) || 0));
          return { relevance: clamp(parsed.relevance), fit: clamp(parsed.fit), ease: clamp(parsed.ease) };
        } catch { return null; }
      }

      let scored = 0;
      const errors = [];
      for (const grant of grants) {
        try {
          const pageText = await fetchPageText(grant.source_url);
          const scores = await scoreWithAI(grant, pageText);
          if (scores) {
            const weighted = Math.round((scores.relevance * 0.3 + scores.fit * 0.3 + scores.ease * 0.2) * 100) / 100;
            const easeCol   = hasNewSchema ? "ease"           : '"Ease"';
            const wscoreCol = hasNewSchema ? "weighted_score" : '"Weighted Score"';
            await env.GRANT_MANAGER_DB.prepare(
              `UPDATE programs SET ${relevanceCol} = ?, ${fitCol} = ?, ${easeCol} = ?, ${wscoreCol} = ? WHERE ${nameCol} = ?`
            ).bind(scores.relevance, scores.fit, scores.ease, weighted, grant.name).run();
            scored++;
          }
        } catch (e) {
          errors.push({ name: grant.name, error: String(e).slice(0, 100) });
        }
      }

      log("info", "grants_scored", { ...reqCtx, scored, errors: errors.length });
      return jsonResponse(JSON.stringify({ ok: true, scored, total: grants.length, errors }));
      } catch (e) {
        log("error", "score_grants_failed", { ...reqCtx, error: String(e) });
        return jsonResponse(JSON.stringify({ error: String(e) }), { status: 500 });
      }
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      if (!loggedIn) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!(await validateCsrf(request, env, username))) {
        log("warn", "csrf_rejected", { ...reqCtx, endpoint: "chat" });
        return new Response("Forbidden", { status: 403 });
      }
      const { messages } = await request.json();
      const chatMessages = Array.isArray(messages)
        ? messages
        : [{ role: "user", content: String(messages || "") }];

      // Pull relevant grants from D1 to ground the AI in the actual dataset
      const lastUserMsg = [...chatMessages].reverse().find(m => m.role === "user")?.content || "";
      const kw = `%${lastUserMsg.slice(0, 80)}%`;
      let grantContext = "";
      let totalCount = 0;
      try {
        const countRow = await env.GRANT_MANAGER_DB.prepare("SELECT COUNT(*) as n FROM programs").first();
        totalCount = countRow?.n ?? 0;

        const { results: matched } = await env.GRANT_MANAGER_DB.prepare(
          `SELECT name, sponsor, type, stage, deadline, benefits,
                  eligibility_conditions, relevance, fit, ease, notes
           FROM programs
           WHERE name LIKE ? OR sponsor LIKE ? OR benefits LIKE ?
              OR eligibility_conditions LIKE ?
           LIMIT 20`
        ).bind(kw, kw, kw, kw).all();

        const { results: top } = await env.GRANT_MANAGER_DB.prepare(
          `SELECT name, sponsor, type, stage, deadline, benefits,
                  eligibility_conditions, relevance, fit, ease, notes
           FROM programs
           ORDER BY COALESCE(relevance, 0) + COALESCE(fit, 0) DESC
           LIMIT 10`
        ).all();

        const seen = new Set();
        const combined = [];
        for (const r of [...matched, ...top]) {
          if (!seen.has(r.name)) { seen.add(r.name); combined.push(r); }
        }

        grantContext = combined.map(r =>
          `• ${r.name} | ${r.sponsor} | ${r.type || ""} | ${r.stage || ""}\n` +
          `  Link: ${url.origin}/?grant=${encodeURIComponent(r.name)}\n` +
          `  Deadline: ${r.deadline || "N/A"} | Relevance: ${r.relevance} | Fit: ${r.fit} | Ease: ${r.ease}\n` +
          `  Benefits: ${r.benefits || "N/A"}\n` +
          `  Eligibility: ${r.eligibility_conditions || "N/A"}` +
          (r.notes ? `\n  Notes: ${r.notes}` : "")
        ).join("\n\n");
      } catch (e) {
        log("error", "chat_grant_context_failed", { ...reqCtx, error: String(e) });
      }

      const systemPrompt =
        `You are a grant research assistant. The user has a database of ${totalCount} grant opportunities. ` +
        `Answer questions using the grant data below. Reference grants by name, compare opportunities, ` +
        `highlight deadlines and eligibility. Be concise and specific. ` +
        `Every time you mention a grant, format its name as a markdown link to its page in this app ` +
        `using the exact Link URL provided for that grant, e.g. [Grant Name](https://app/?grant=...). ` +
        `Never invent URLs — only use the Link values from the grant data.\n\n` +
        (grantContext ? `GRANTS FROM DATABASE:\n${grantContext}` : "Could not load grant data.");

      const aiMessages = [{ role: "system", content: systemPrompt }, ...chatMessages];

      // Try native AI binding first, then fall back to REST API
      if (env.AI) {
        const aiStart = Date.now();
        const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
          messages: aiMessages,
          stream: false,
        });
        log("info", "ai_chat_response", { ...reqCtx, model: "@cf/meta/llama-3.1-8b-instruct", contextGrants: totalCount, durationMs: Date.now() - aiStart });
        return jsonResponse(JSON.stringify({ response: result.response }));
      }

      if (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN) {
        const aiRes = await fetch(
          `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.CF_AI_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ messages: aiMessages }),
          }
        );
        if (!aiRes.ok) {
          const errText = await aiRes.text().catch(() => "");
          return new Response(`AI request failed: ${errText}`, { status: 502 });
        }
        const data = await aiRes.json();
        const text = data.result?.response ?? "";
        return jsonResponse(JSON.stringify({ response: text }));
      }

      return new Response("AI not configured", { status: 503 });
    }

    if (url.pathname === "/api/request-password-reset" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (env.LOGIN_ATTEMPTS) {
        const { blocked } = await checkRateLimit(env.LOGIN_ATTEMPTS, `reset_req:${ip}`);
        if (blocked) return new Response("Too many requests. Try again later.", { status: 429 });
      }
      const body = await request.json().catch(() => ({}));
      const resetUser = String(body.username || "").trim();
      if (!resetUser) {
        return jsonResponse(JSON.stringify({ error: "Username is required." }), { status: 400 });
      }
      // Check if user exists in D1 or env users
      let userExists = !!users[resetUser];
      if (!userExists && env.GRANT_MANAGER_DB) {
        try {
          const row = await env.GRANT_MANAGER_DB.prepare(
            "SELECT username FROM users WHERE username = ?"
          ).bind(resetUser).first();
          userExists = !!row;
        } catch { /* ignore */ }
      }
      if (!userExists) {
        // Don't reveal whether the username exists
        return jsonResponse(JSON.stringify({
          ok: true,
          message: "If that account exists, a reset token has been generated.",
        }));
      }
      const resetToken = crypto.randomUUID();
      if (env.LOGIN_ATTEMPTS) {
        await env.LOGIN_ATTEMPTS.put(
          `reset:${resetToken}`,
          JSON.stringify({ username: resetUser, expiresAt: Date.now() + 3_600_000 }),
          { expirationTtl: 3600 }
        );
      }
      log("info", "password_reset_requested", { requestId, username: resetUser });
      return jsonResponse(JSON.stringify({
        ok: true,
        token: resetToken,
        message: "Reset token generated. In production this would be delivered via email.",
      }));
    }

    if (url.pathname === "/api/reset-password" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { token: resetToken, password: newPass, confirm_password: confirmPass } = body;
      if (!resetToken || !newPass || !confirmPass) {
        return jsonResponse(JSON.stringify({ error: "token, password, and confirm_password are required." }), { status: 400 });
      }
      if (newPass.length < MIN_PASSWORD_LENGTH) {
        return jsonResponse(JSON.stringify({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }), { status: 400 });
      }
      if (newPass !== confirmPass) {
        return jsonResponse(JSON.stringify({ error: "Passwords do not match." }), { status: 400 });
      }
      let resetData = null;
      if (env.LOGIN_ATTEMPTS) {
        resetData = await env.LOGIN_ATTEMPTS.get(`reset:${resetToken}`, { type: "json" });
      }
      if (!resetData || Date.now() > resetData.expiresAt) {
        return jsonResponse(JSON.stringify({ error: "Reset token is invalid or has expired." }), { status: 400 });
      }
      const newHash = await hashPassword(newPass);
      try {
        await env.GRANT_MANAGER_DB.prepare(
          "UPDATE users SET password_hash = ? WHERE username = ?"
        ).bind(newHash, resetData.username).run();
      } catch (err) {
        log("error", "password_reset_failed", { requestId, error: String(err) });
        return jsonResponse(JSON.stringify({ error: "Failed to update password." }), { status: 500 });
      }
      if (env.LOGIN_ATTEMPTS) {
        await env.LOGIN_ATTEMPTS.delete(`reset:${resetToken}`);
      }
      log("info", "password_reset_success", { requestId, username: resetData.username });
      return jsonResponse(JSON.stringify({ ok: true }));
    }

    if (url.pathname === "/data" && request.method === "GET") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      const columns = await getColumns(env.GRANT_MANAGER_DB);
      if (columns.length === 0) {
        return new Response("No data available", { status: 404 });
      }
      const { results: rows } = await env.GRANT_MANAGER_DB.prepare(
        `SELECT * FROM programs`
      ).all();

      function csvCell(val) {
        const s = val === null || val === undefined ? "" : String(val);
        return s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }

      const header = columns.map(csvCell).join(",");
      const dataRows = rows.map((r) => columns.map((c) => csvCell(r[c])).join(","));
      const csv = [header, ...dataRows].join("\r\n") + "\r\n";

      const date = new Date().toISOString().slice(0, 10);
      log("info", "csv_exported", { ...reqCtx, rowCount: rows.length });
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="grants-${date}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (url.pathname === "/logout") {
      const match = cookie.match(/session=([^;]+)/);
      if (match && env.USER_PROFILES) {
        await env.USER_PROFILES.delete(`session:${decodeURIComponent(match[1])}`);
      }
      const secure = url.protocol === "https:" ? "; Secure" : "";
      return new Response("", {
        status: 302,
        headers: {
          "Set-Cookie":
            `session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secure}`,
          Location: "/",
        },
      });
    }

    const assetRes = await env.ASSETS.fetch(request);
    const newHeaders = new Headers(assetRes.headers);
    newHeaders.set("X-Content-Type-Options", "nosniff");
    const assetType = assetRes.headers.get("content-type") || "";
    if (assetType.includes("text/html")) {
      // Never cache HTML: a stale index.html references hashed bundles that
      // vanish on the next deploy, leaving users a blank page until refresh.
      newHeaders.set("Cache-Control", "no-cache");
    } else if (url.pathname.startsWith("/assets/")) {
      // Vite content-hashes bundle filenames, so these are safe to cache hard.
      newHeaders.set("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      newHeaders.set("Cache-Control", "public, max-age=86400");
    }
    return new Response(assetRes.body, { status: assetRes.status, headers: newHeaders });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncGrantsWithD1(env, ""));
  },
};

