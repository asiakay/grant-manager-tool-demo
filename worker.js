
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
  notes            TEXT,
  pdf_url          TEXT,
  ai_score         REAL,
  ai_summary       TEXT,
  ai_tier          TEXT,
  ai_scored_at     TEXT,
  opportunity_id   TEXT,
  opportunity_number TEXT,
  cfda_numbers     TEXT,
  eligible_applicants TEXT,
  award_ceiling    REAL,
  award_floor      REAL,
  is_forecast      INTEGER DEFAULT 0,
  estimated_post_date TEXT,
  source_channel   TEXT,
  last_synced_at   TEXT
)`;

function getAdminUsers(env) {
  const raw = typeof env.ADMIN_USERS === "string" && env.ADMIN_USERS.trim() !== ""
    ? env.ADMIN_USERS
    : "demo";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

async function isAdminUser(env, username) {
  if (getAdminUsers(env).has(username)) return true;
  if (env.GRANT_MANAGER_DB) {
    try {
      const row = await env.GRANT_MANAGER_DB.prepare(
        "SELECT is_admin FROM users WHERE username = ?"
      ).bind(username).first();
      return row?.is_admin === 1;
    } catch { return false; }
  }
  return false;
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
// normalizeHeader() strips whitespace but preserves slashes, dashes, parens, and ? so we
// need explicit entries for headers like "Region / Eligibility" → "region/eligibility".
const CSV_COLUMN_ALIASES = {
  // Legacy export names
  "grantname":                    "name",
  "easeofuse":                    "ease",
  "link":                         "source_url",
  "sourceurl":                    "source_url", // "Source URL" — underscore in the DB column isn't whitespace, so normalizeHeader() alone won't match it; needs an explicit alias like every other multi-word column below.
  "matchreq%":                    "weighted_score",
  "match%":                       "weighted_score",
  // Standard CSV format with spaces/slashes/punctuation
  "region/eligibility":           "region_eligibility",
  "deadline/nextcohort":          "deadline",
  "notes/actions":                "notes",
  "eligibility(keyconditions)":   "eligibility_conditions",
  "non-dilutive?":                "non_dilutive",
  "stackrequired?":               "stack_required",
  "weightedscore":                "weighted_score",
  // Grants.gov extract fields (fetch_xml_extract.py) / Simpler Grants.gov sync
  "opportunityid":                "opportunity_id",
  "opportunitynumber":            "opportunity_number",
  "cfdanumbers":                  "cfda_numbers",
  "eligibleapplicants":           "eligible_applicants",
  "awardceiling":                 "award_ceiling",
  "awardfloor":                   "award_floor",
  "isforecast":                   "is_forecast",
  "estimatedpostdate":            "estimated_post_date",
  "sourcechannel":                "source_channel",
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
  "Environment & Climate":    ["environment", "climate", "energy", "sustainability", "clean", "emissions", "carbon", "ecology", "conservation", "biodiversity", "water", "pollution", "resilience", "natural resources", "land use"],
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
  // Also handle old schema column names (quoted headers) transparently.
  const text = [
    r.name        || r.Name        || "",
    r.sponsor     || r.Sponsor     || "",
    r.benefits    || r.Benefits    || "",
    r.eligibility_conditions || r["Eligibility (key conditions)"] || "",
    r.region_eligibility || r["Region / Eligibility"] || "",
    r.type        || r.Type        || "",
    r.notes       || r["Notes / Actions"] || "",
  ].join(" ").toLowerCase();

  let hits = 0;
  let checks = 0;

  // Focus area: count how many of the selected areas have at least one keyword hit.
  // Using hit-count (not just any-hit) gives a stronger signal for multi-area profiles.
  if (focusAreas.length) {
    let areaHits = 0;
    for (const fa of focusAreas) {
      const kws = FOCUS_AREA_KEYWORDS[fa] || [];
      if (kws.some(kw => text.includes(kw))) areaHits++;
    }
    checks += focusAreas.length;
    hits += areaHits;
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
  return (r.stack_required === 1 || r["Stack Required?"] === "Yes") ? 1.0 : 0.2;
}

function computeCadenceRecency(r) {
  const cadence = String(r.cadence || r.Cadence || "").toLowerCase();
  if (cadence.includes("rolling")) return 1.0;
  const raw = r.deadline || r["Deadline / Next Cohort"];
  if (!raw) return 0;
  const deadline = new Date(raw);
  if (isNaN(deadline.getTime())) return 0;
  const daysUntil = (deadline.getTime() - Date.now()) / 86400000;
  if (daysUntil < 0) return 0;
  return Math.max(0, Math.min(1, 1 - daysUntil / 365));
}

function computeScore(r, weights, profile) {
  const profileMatch = profile ? computeProfileMatch(r, profile) : 0;
  const hasProfile = profile && (
    (Array.isArray(profile.focusAreas) && profile.focusAreas.length) ||
    profile.orgType || profile.stage
  );

  // When a profile is set, profile match is the primary ranking signal (0–10).
  // DB scores (relevance/fit/ease) act as a tiebreaker within the same match tier.
  // When no profile is set, fall back to DB scores only.
  const relevance = parseFloat(r.relevance || r.Relevance) || 0;
  const fit       = parseFloat(r.fit       || r.Fit)       || 0;
  const ease      = parseFloat(r.ease      || r.Ease)      || 0;
  const stack     = computeStackAlignment(r);
  const cadence   = computeCadenceRecency(r);

  if (hasProfile) {
    // Primary: profile match 0–1 scaled to 0–10
    // Tiebreaker: normalised DB quality score 0–3 scaled to 0–1
    const w = weights || DEFAULT_WEIGHTS;
    const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
    const dbScore = ((w.Relevance ?? 0) / total) * relevance
                  + ((w.Fit       ?? 0) / total) * fit
                  + ((w.Ease      ?? 0) / total) * ease
                  + ((w.StackAlignment ?? 0) / total) * (stack * 3)
                  + ((w.CadenceRecency ?? 0) / total) * (cadence * 3);
    return Math.round((profileMatch * 10 + dbScore / 3) * 100) / 100;
  }

  // No profile — rank purely by DB quality scores (0–3), scaled to 0–10 to match the
  // profile branch so ScoreCell and GrantDrawer thresholds are consistent.
  const w = weights || DEFAULT_WEIGHTS;
  const total = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  return Math.round((
    ((w.Relevance      ?? 0) / total) * relevance
  + ((w.Fit            ?? 0) / total) * fit
  + ((w.Ease           ?? 0) / total) * ease
  + ((w.StackAlignment ?? 0) / total) * (stack * 3)
  + ((w.CadenceRecency ?? 0) / total) * (cadence * 3)
  ) * (10 / 3) * 100) / 100;
}

// Computes heuristic Relevance, Fit, and Ease scores (0–3 each) for live search
// results that have no AI-generated scores. Uses profile keywords and deadline data.
function computeLiveHeuristicScores(grant, profile) {
  const text = [
    grant.Name || "",
    grant.Sponsor || "",
    grant.Benefits || "",
    grant["Eligibility (key conditions)"] || "",
    grant.Type || "",
  ].join(" ").toLowerCase();

  // Relevance: keyword match against user focus areas (0–3)
  let relevance = 1.5; // neutral default when no profile
  if (profile && Array.isArray(profile.focusAreas) && profile.focusAreas.length) {
    let areaHits = 0;
    for (const fa of profile.focusAreas) {
      const kws = FOCUS_AREA_KEYWORDS[fa] || [];
      if (kws.some(kw => text.includes(kw))) areaHits++;
    }
    relevance = Math.min(3, (areaHits / profile.focusAreas.length) * 3);
  }

  // Fit: org type + stage keyword match (0–3)
  let fit = 1.5; // neutral default
  if (profile && (profile.orgType || profile.stage)) {
    let fitHits = 0, fitChecks = 0;
    const orgKws = ORG_TYPE_KEYWORDS[profile.orgType] || [];
    if (orgKws.length) {
      fitChecks++;
      if (orgKws.some(kw => text.includes(kw))) fitHits++;
    }
    const stageKws = STAGE_KEYWORDS[profile.stage] || [];
    if (stageKws.length) {
      fitChecks++;
      if (stageKws.some(kw => text.includes(kw))) fitHits++;
    }
    if (fitChecks > 0) fit = (fitHits / fitChecks) * 3;
  }

  // Ease: based on deadline proximity (farther deadline = more time = easier to apply)
  let ease = 1.5;
  const deadlineRaw = grant["Deadline/Next Cohort"] || grant["Deadline / Next Cohort"] || "";
  const cadence = String(grant.Cadence || "").toLowerCase();
  if (cadence.includes("rolling")) {
    ease = 3;
  } else if (deadlineRaw) {
    const dl = new Date(deadlineRaw);
    if (!isNaN(dl.getTime())) {
      const daysUntil = (dl.getTime() - Date.now()) / 86400000;
      if (daysUntil < 0)       ease = 0;
      else if (daysUntil < 14) ease = 0.5;
      else if (daysUntil < 30) ease = 1;
      else if (daysUntil < 60) ease = 1.5;
      else if (daysUntil < 90) ease = 2;
      else                     ease = 2.5;
    }
  }

  return {
    Relevance: Math.round(relevance * 100) / 100,
    Fit:       Math.round(fit       * 100) / 100,
    Ease:      Math.round(ease      * 100) / 100,
  };
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
  let token;
  try { token = decodeURIComponent(match[1]); } catch { return null; }
  if (!token || !env.USER_PROFILES) return null;
  try {
    const username = await env.USER_PROFILES.get(`session:${token}`);
    return username || null;
  } catch { return null; }
}

async function validateCsrf(request, env, username) {
  const token = request.headers.get("X-CSRF-Token");
  if (!token) return false;
  try {
    const stored = env.USER_PROFILES
      ? await env.USER_PROFILES.get(`csrf:${username}`)
      : null;
    return stored === token;
  } catch { return false; }
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

const DEFAULT_SIMPLER_FILTERS = {
  opportunity_status: { one_of: ["posted", "forecasted"] },
  funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
};

function buildSimplerGrantsFilters({ agency, minAward, maxAward, deadlineBefore, status }) {
  const filters = {
    opportunity_status: { one_of: ["posted", "forecasted"] },
    funding_instrument: { one_of: ["grant", "cooperative_agreement"] },
  };
  if (status === "posted")      filters.opportunity_status = { one_of: ["posted"] };
  else if (status === "forecasted") filters.opportunity_status = { one_of: ["forecasted"] };
  if (agency) filters.agency = { one_of: [agency] };
  // award_ceiling.min: ceiling can reach minAward (mirrors /api/grants filter semantics)
  if (minAward !== null && !Number.isNaN(minAward)) filters.award_ceiling = { min: minAward };
  // award_floor.max: floor doesn't exceed maxAward cap
  if (maxAward !== null && !Number.isNaN(maxAward)) filters.award_floor = { max: maxAward };
  if (deadlineBefore) filters.close_date = { end_date: deadlineBefore };
  return filters;
}

async function fetchFromSimplerGrants(env, query, page = 1, pageSize = 25, filters = null) {
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
      filters: filters ?? DEFAULT_SIMPLER_FILTERS,
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

// Max opportunities fetched per sync run, across all pages — bounds Worker CPU
// time / subrequest count even if the catalog grows well past this.
const SYNC_MAX_OPPORTUNITIES = 2000;
const SYNC_PAGE_SIZE = 100;

// Walks every page of the Simpler Grants.gov search API for `query` (an empty
// query returns the full catalog matching the filters), stopping when a page
// comes back short (last page) or SYNC_MAX_OPPORTUNITIES is reached.
async function fetchAllFromSimplerGrants(env, query, filters = null) {
  const all = [];
  for (let page = 1; all.length < SYNC_MAX_OPPORTUNITIES; page++) {
    const apiData = await fetchFromSimplerGrants(env, query, page, SYNC_PAGE_SIZE, filters);
    const opportunities = apiData?.data || apiData?.data?.oppHits || apiData?.items || [];
    all.push(...opportunities);
    if (opportunities.length < SYNC_PAGE_SIZE) break;
  }
  return all.slice(0, SYNC_MAX_OPPORTUNITIES);
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

// Fields that are safe to refresh on every sync (descriptive/structural data
// from Grants.gov). relevance/fit/ease/weighted_score/non_dilutive/stack_required
// are deliberately left alone on conflict — they may have been hand-tuned or
// set by the AI scoring pass, and a resync shouldn't clobber that.
const REFRESHABLE_SET = `
    name = excluded.name,
    type = excluded.type,
    sponsor = excluded.sponsor,
    source_url = excluded.source_url,
    deadline = excluded.deadline,
    benefits = excluded.benefits,
    eligibility_conditions = excluded.eligibility_conditions,
    stage = excluded.stage,
    cfda_numbers = excluded.cfda_numbers,
    eligible_applicants = excluded.eligible_applicants,
    award_ceiling = excluded.award_ceiling,
    award_floor = excluded.award_floor,
    source_channel = excluded.source_channel,
    last_synced_at = excluded.last_synced_at
`;

async function upsertOpportunitiesToD1(env, opportunities) {
  if (!env.GRANT_MANAGER_DB) {
    throw new Error("D1 binding (GRANT_MANAGER_DB) is missing.");
  }
  await env.GRANT_MANAGER_DB.prepare(PROGRAMS_SCHEMA).run();

  const insertStmt = env.GRANT_MANAGER_DB.prepare(`
    INSERT INTO programs (
      type, name, sponsor, source_url, region_eligibility, deadline, cadence, benefits,
      eligibility_conditions, stage, non_dilutive, stack_required, relevance, fit, ease,
      weighted_score, notes, opportunity_id, cfda_numbers, eligible_applicants,
      award_ceiling, award_floor, source_channel, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(opportunity_id) WHERE opportunity_id IS NOT NULL DO UPDATE SET
      ${REFRESHABLE_SET}
    ON CONFLICT(name) DO UPDATE SET
      opportunity_id = excluded.opportunity_id,
      ${REFRESHABLE_SET}
  `);

  const syncedAt = new Date().toISOString();
  const statements = opportunities.map((opp) => {
    const summary = opp.summary || opp;
    const name = opp.opportunity_title || summary.opportunity_title || "Untitled Grant";
    const opportunityId = opp.opportunity_id != null ? String(opp.opportunity_id) : null;
    const type = capitalize(opp.funding_instrument || summary.funding_instruments?.[0] || "grant");
    const sponsor = opp.agency_name || summary.agency_name || opp.agency_code || "Unknown Agency";
    const sourceUrl = opportunityId ? `https://simpler.grants.gov/opportunity/${opportunityId}` : "";
    const deadline = opp.close_date || summary.close_date || "";
    const awardFloor = opp.award_floor ?? summary.award_floor ?? null;
    const awardCeiling = opp.award_ceiling ?? summary.award_ceiling ?? null;
    const benefits = fmtAward(awardFloor, awardCeiling);
    const applicantTypes = Array.isArray(opp.applicant_types)
      ? opp.applicant_types
      : Array.isArray(summary.applicant_types)
        ? summary.applicant_types
        : [];
    const eligibility = applicantTypes.map(capitalize).join(", ");
    const cfdaList = Array.isArray(opp.cfda_numbers)
      ? opp.cfda_numbers
      : Array.isArray(opp.assistance_listing_numbers)
        ? opp.assistance_listing_numbers
        : Array.isArray(summary.assistance_listing_numbers)
          ? summary.assistance_listing_numbers
          : [];
    const cfdaNumbers = cfdaList.join(", ");
    const stage = capitalize(opp.opportunity_status || "");
    // Derive a simple relevance score (0-3) from how many known grant domains the
    // title/eligibility text mentions, so grants aren't all scored equally at 0.
    const grantText = [name, sponsor, benefits, eligibility].join(" ").toLowerCase();
    const domainCount = Object.values(FOCUS_AREA_KEYWORDS).filter(kws => kws.some(kw => grantText.includes(kw))).length;
    const derivedRelevance = Math.min(3, Math.round((domainCount / Object.keys(FOCUS_AREA_KEYWORDS).length) * 3 * 10) / 10);
    return insertStmt.bind(
      type, name, sponsor, sourceUrl, "", deadline, "", benefits, eligibility, stage, 1, 0,
      derivedRelevance, 0, 0, 0, "", opportunityId, cfdaNumbers, eligibility,
      awardCeiling, awardFloor, "simpler_api", syncedAt,
    );
  });

  // D1 caps batch size; chunk to stay well under it regardless of SYNC_MAX_OPPORTUNITIES.
  for (let i = 0; i < statements.length; i += 50) {
    await env.GRANT_MANAGER_DB.batch(statements.slice(i, i + 50));
  }
  return { success: true, inserted: opportunities.length, message: `Successfully loaded ${opportunities.length} active opportunities to local storage.` };
}

async function syncGrantsWithD1(env, query) {
  const opportunities = await fetchAllFromSimplerGrants(env, query);
  if (opportunities.length === 0) {
    return { success: true, inserted: 0, message: "Sync complete. No records returned from server filters." };
  }
  return upsertOpportunitiesToD1(env, opportunities);
}

// ===== Anonymous Feedback (GitHub Issues) =====

const FEEDBACK_ALLOWED_MIME = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
]);
const FEEDBACK_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const FEEDBACK_RATE_MAX = 5;
const FEEDBACK_WINDOW_SECS = 3600; // 1 hour

// Returns { allowed: boolean }. Increments the counter on each allowed call.
export async function checkFeedbackRateLimit(env, ip) {
  if (!env.FEEDBACK_RATE_LIMIT) return { allowed: true };
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / FEEDBACK_WINDOW_SECS) * FEEDBACK_WINDOW_SECS;
  const key = `anon-fb:${ip}:${windowStart}`;
  const stored = await env.FEEDBACK_RATE_LIMIT.get(key, { type: "json" });
  const count = stored?.count ?? 0;
  if (count >= FEEDBACK_RATE_MAX) return { allowed: false };
  const ttl = windowStart + FEEDBACK_WINDOW_SECS - now + 60;
  await env.FEEDBACK_RATE_LIMIT.put(
    key,
    JSON.stringify({ count: count + 1 }),
    { expirationTtl: Math.max(ttl, 1) },
  );
  return { allowed: true };
}

// Uploads a screenshot File to R2, returns the public URL or null on failure.
// A null return must never block issue creation.
export async function uploadFeedbackScreenshot(file, env) {
  if (!env.FEEDBACK_ATTACHMENTS || !env.FEEDBACK_R2_PUBLIC_BASE_URL) return null;
  if (!FEEDBACK_ALLOWED_MIME.has(file.type)) return null;
  if (file.size > FEEDBACK_MAX_BYTES) return null;
  try {
    const rawExt = file.type.split("/")[1] || "bin";
    const ext = rawExt === "jpeg" ? "jpg" : rawExt;
    const key = `feedback/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();
    await env.FEEDBACK_ATTACHMENTS.put(key, bytes, {
      httpMetadata: { contentType: file.type },
    });
    const base = env.FEEDBACK_R2_PUBLIC_BASE_URL.replace(/\/$/, "");
    return `${base}/${key}`;
  } catch (err) {
    log("warn", "feedback_r2_upload_failed", { error: String(err) });
    return null;
  }
}

export function buildFeedbackIssueBody({ name, email, message, category, screenshotUrl, userAgent }) {
  const categoryLabel =
    category === "bug" ? "Bug Report" :
    category === "feature" ? "Feature Request" :
    "General Feedback";

  const rows = [
    `| Category | ${categoryLabel} |`,
    `| Submitted | ${new Date().toISOString()} |`,
    `| Name | ${name || "_Anonymous_"} |`,
    `| Email | ${email || "_Not provided_"} |`,
    `| User Agent | ${userAgent ? userAgent.slice(0, 120) : "_Unknown_"} |`,
  ].join("\n");

  const parts = [
    `## Feedback Report\n`,
    `| Field | Value |\n|---|---|\n${rows}\n`,
    `---\n\n## Message\n\n${message}`,
  ];

  if (screenshotUrl) {
    parts.push(`---\n\n## Screenshot\n\n![Screenshot](${screenshotUrl})`);
  }

  parts.push(`---\n\n_Submitted anonymously via FoundationPlanner feedback form_`);
  return parts.join("\n\n");
}

// Thin wrapper so tests can mock the outbound GitHub call without stubbing globalThis.fetch.
export async function postGitHubIssue(env, payload) {
  return fetch("https://api.github.com/repos/asiakay/grant-manager-tool-demo/issues", {
    method: "POST",
    headers: {
      Authorization: `token ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "FoundationPlanner-FeedbackBot/1.0",
      Accept: "application/vnd.github.v3+json",
    },
    body: JSON.stringify(payload),
  });
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
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
  } catch {
    return "";
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      console.log(JSON.stringify({ level: "error", event: "unhandled_exception", error: String(err), ts: Date.now() }));
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: { "content-type": "application/json", "Cache-Control": "no-store" },
      });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncGrantsWithD1(env, ""));
  },
};

async function handleRequest(request, env, ctx) {
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
      const newUser = (form.get("username") || "").trim().toLowerCase();
      const newPass = form.get("password") || "";
      const confirmPass = form.get("confirm_password") || "";

      if (!newUser || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newUser)) {
        return jsonResponse(JSON.stringify({ error: "A valid email address is required." }), { status: 400 });
      }
      if (newUser.length > 254) {
        return jsonResponse(JSON.stringify({ error: "Email address is too long." }), { status: 400 });
      }
      if (!newPass || newPass.length < MIN_PASSWORD_LENGTH) {
        return jsonResponse(JSON.stringify({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` }), { status: 400 });
      }
      if (newPass !== confirmPass) {
        return jsonResponse(JSON.stringify({ error: "Passwords do not match." }), { status: 400 });
      }

      if (!env.GRANT_MANAGER_DB) {
        return jsonResponse(JSON.stringify({ error: "Database not configured." }), { status: 503 });
      }

      let existing = null;
      try {
        existing = await env.GRANT_MANAGER_DB.prepare(
          "SELECT username FROM users WHERE username = ?"
        ).bind(newUser).first();
      } catch (err) {
        log("error", "signup_db_lookup_failed", { requestId, error: String(err) });
        return jsonResponse(JSON.stringify({ error: "Database error. Please try again." }), { status: 503 });
      }

      if (existing || users[newUser]) {
        log("info", "signup_email_taken", { requestId });
        return jsonResponse(JSON.stringify({ error: "An account with that email already exists." }), { status: 409 });
      }

      const hash = await hashPassword(newPass);
      try {
        await env.GRANT_MANAGER_DB.prepare(
          "INSERT INTO users (username, password_hash, email, created_at) VALUES (?, ?, ?, ?)"
        ).bind(newUser, hash, newUser, Date.now()).run();
      } catch (err) {
        log("error", "signup_db_insert_failed", { requestId, error: String(err) });
        return jsonResponse(JSON.stringify({ error: "Could not create account. Please try again." }), { status: 503 });
      }

      log("info", "signup_success", { requestId });
      return jsonResponse(JSON.stringify({ ok: true }), { status: 201 });
    }

    if (url.pathname === "/login" && request.method === "POST") {
      const form = await request.formData();
      const user = (form.get("username") || "").trim().toLowerCase();
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
      try {
        if (dbUser) {
          const { ok, legacy } = await verifyPassword(dbUser.password_hash, pass || "");
          matchOk = ok;
          needsRehash = ok && legacy;
        } else if (users[user]) {
          const { ok } = await verifyPassword(users[user], pass || "");
          matchOk = ok;
        }
      } catch (err) {
        log("error", "login_verify_failed", { requestId, error: String(err) });
        return new Response("Login failed", { status: 500 });
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
        if (env.LOGIN_ATTEMPTS) { try { await env.LOGIN_ATTEMPTS.delete(ip); } catch { /* non-fatal */ } }
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
        try {
          const now = Date.now();
          const prev = await env.LOGIN_ATTEMPTS.get(ip, { type: "json" }) || { count: 0, time: now };
          if (now - prev.time > LOCKOUT_MS) { prev.count = 0; prev.time = now; }
          prev.count++;
          prev.time = now;
          await env.LOGIN_ATTEMPTS.put(ip, JSON.stringify(prev));
        } catch { /* non-fatal — rate-limit counter update failure is acceptable */ }
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
        if (!env.USER_PROFILES) return new Response("KV not configured", { status: 503 });
        const body = await request.json();
        await env.USER_PROFILES.put(`profile:${username}`, JSON.stringify(body));
        log("info", "profile_saved", reqCtx);
        return jsonResponse(JSON.stringify({ ok: true }));
      }
    }

    if (url.pathname === "/api/profile/select-grant") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await validateCsrf(request, env, username))) {
        return new Response("Forbidden", { status: 403 });
      }
      if (!env.USER_PROFILES) return new Response("KV not configured", { status: 503 });

      const { grantId } = await request.json();
      const id = Number(grantId);
      if (!Number.isFinite(id) || id <= 0) {
        return new Response(JSON.stringify({ error: "Invalid grantId" }), { status: 400 });
      }

      const key = `selections:${username}`;
      const existing = await env.USER_PROFILES.get(key, "json").catch(() => null);
      const selections = Array.isArray(existing) ? existing : [];

      if (request.method === "POST") {
        if (!selections.includes(id)) selections.push(id);
        await env.USER_PROFILES.put(key, JSON.stringify(selections));
        log("info", "grant_selected", { ...reqCtx, grantId: id });
        return jsonResponse(JSON.stringify({ ok: true, selected: selections }));
      }

      if (request.method === "DELETE") {
        const updated = selections.filter(s => s !== id);
        await env.USER_PROFILES.put(key, JSON.stringify(updated));
        log("info", "grant_deselected", { ...reqCtx, grantId: id });
        return jsonResponse(JSON.stringify({ ok: true, selected: updated }));
      }
    }

    if (url.pathname === "/api/profile/analyze-mission" && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await validateCsrf(request, env, username))) return new Response("Forbidden", { status: 403 });
      if (!env.AI && !(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN)) {
        return new Response("AI not configured", { status: 503 });
      }
      const { mission } = await request.json();
      if (!mission || typeof mission !== "string" || mission.trim().length < 20) {
        return new Response(JSON.stringify({ error: "Mission text too short" }), { status: 400 });
      }

      const FOCUS_AREA_OPTIONS = [
        "Health & Medicine","Education & Workforce","Technology & Innovation",
        "Housing & Community","Environment & Climate","Agriculture & Food",
        "Social Services","Arts & Humanities","International Development",
        "Veterans & Military","Research & Science","Justice & Safety",
      ];
      const ORG_TYPE_OPTIONS = [
        "Nonprofit/NGO","University/Research Institution","Startup/Small Business",
        "Government/Tribal","Individual Researcher","Hospital/Health System",
      ];
      const STAGE_OPTIONS = [
        "Early Research / Ideation","Pilot / Proof of Concept",
        "Growth / Scaling","Established Program",
      ];

      const prompt = `You are a grant-matching assistant. Analyze this organization's mission statement and classify it.

Mission statement:
"""
${mission.trim().slice(0, 2000)}
"""

Return ONLY a JSON object with these exact keys:
- "focusAreas": array of 1-3 strings chosen ONLY from: ${JSON.stringify(FOCUS_AREA_OPTIONS)}
- "orgType": one string chosen ONLY from: ${JSON.stringify(ORG_TYPE_OPTIONS)}
- "stage": one string chosen ONLY from: ${JSON.stringify(STAGE_OPTIONS)}
- "rationale": one sentence explaining your choices

Example: {"focusAreas":["Health & Medicine","Research & Science"],"orgType":"Nonprofit/NGO","stage":"Growth / Scaling","rationale":"The mission focuses on clinical health research delivered by an established nonprofit."}`;

      const messages = [{ role: "user", content: prompt }];
      let text = "";
      try {
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
      } catch (err) {
        log("error", "mission_analysis_ai_error", { ...reqCtx, err: String(err) });
        return new Response(JSON.stringify({ error: "AI call failed" }), { status: 502 });
      }

      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return new Response(JSON.stringify({ error: "Could not parse AI response" }), { status: 502 });

      let parsed;
      try { parsed = JSON.parse(jsonMatch[0]); } catch {
        return new Response(JSON.stringify({ error: "Invalid AI JSON" }), { status: 502 });
      }

      // Validate and sanitize — only allow values from the known option lists
      const focusAreas = (Array.isArray(parsed.focusAreas) ? parsed.focusAreas : [])
        .filter(v => FOCUS_AREA_OPTIONS.includes(v)).slice(0, 3);
      const orgType = ORG_TYPE_OPTIONS.includes(parsed.orgType) ? parsed.orgType : "";
      const stage = STAGE_OPTIONS.includes(parsed.stage) ? parsed.stage : "";
      const rationale = typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 300) : "";

      log("info", "mission_analyzed", reqCtx);
      return jsonResponse(JSON.stringify({ focusAreas, orgType, stage, rationale }));
    }

    if (url.pathname === "/api/ai-status") {
      const hasBinding = !!env.AI;
      const hasRestApi = !!(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN);
      const configured = hasBinding || hasRestApi;
      const provider = configured ? "workers-ai" : null;
      return jsonResponse(JSON.stringify({ configured, provider }));
    }

    if (url.pathname === "/api/summarize" && request.method === "GET") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });

      const sourceUrl = (url.searchParams.get("url") || "").trim();
      if (!sourceUrl) return jsonResponse(JSON.stringify({ error: "url param required" }), { status: 400 });

      let parsedUrl;
      try { parsedUrl = new URL(sourceUrl); } catch {
        return jsonResponse(JSON.stringify({ error: "Invalid url" }), { status: 400 });
      }
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return jsonResponse(JSON.stringify({ error: "Only http/https URLs allowed" }), { status: 400 });
      }
      const hostname = parsedUrl.hostname;
      const BLOCKED = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|fc00:|fd)/i;
      if (BLOCKED.test(hostname)) {
        return jsonResponse(JSON.stringify({ error: "Private addresses not allowed" }), { status: 400 });
      }

      const hasAI = env.AI || (env.CF_ACCOUNT_ID && env.CF_AI_TOKEN);
      if (!hasAI) return jsonResponse(JSON.stringify({ error: "AI not configured" }), { status: 503 });

      // Fallback metadata fields passed by the frontend when page content may be unavailable
      const metaName        = (url.searchParams.get("name")        || "").trim().slice(0, 200);
      const metaSponsor     = (url.searchParams.get("sponsor")     || "").trim().slice(0, 200);
      const metaBenefits    = (url.searchParams.get("benefits")    || "").trim().slice(0, 300);
      const metaEligibility = (url.searchParams.get("eligibility") || "").trim().slice(0, 300);
      const metaDescription = (url.searchParams.get("description") || "").trim().slice(0, 500);

      const pageText = await fetchPageText(sourceUrl);
      const hasMeta = metaName || metaSponsor || metaBenefits || metaEligibility || metaDescription;

      if (!pageText && !hasMeta) {
        return jsonResponse(JSON.stringify({
          error: "Could not fetch grant page — the site may use bot protection or require JavaScript. Try opening the source link directly.",
        }), { status: 502 });
      }

      let inputBlock;
      if (pageText) {
        inputBlock = `Grant page content:\n${pageText}`;
      } else {
        const lines = [
          metaName        && `Grant name: ${metaName}`,
          metaSponsor     && `Sponsor: ${metaSponsor}`,
          metaBenefits    && `Benefits/Funding: ${metaBenefits}`,
          metaEligibility && `Eligibility: ${metaEligibility}`,
          metaDescription && `Description: ${metaDescription}`,
          `Source URL: ${sourceUrl}`,
        ].filter(Boolean);
        inputBlock = `Grant metadata (source page was not accessible):\n${lines.join("\n")}`;
      }

      const prompt = `You are a grant research assistant. Summarize the following grant opportunity for a nonprofit or small business applicant.

${inputBlock}

Respond with JSON only — no markdown, no explanation, no extra text:
{
  "summary": "<2-3 sentence plain-language summary of what this grant funds, who can apply, and how much is available>",
  "bullets": ["<key fact 1>", "<key fact 2>", "<key fact 3>", "<key fact 4>", "<key fact 5>"]
}`;

      const messages = [{ role: "user", content: prompt }];
      let aiText = "";
      try {
        if (env.AI) {
          const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages, stream: false });
          aiText = result.response || "";
        } else {
          const res = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
            { method: "POST", headers: { "Authorization": `Bearer ${env.CF_AI_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages }) }
          );
          const data = await res.json();
          aiText = data.result?.response ?? "";
        }
      } catch (err) {
        log("error", "summarize_ai_error", { ...reqCtx, error: String(err) });
        return jsonResponse(JSON.stringify({ error: "AI summarization failed" }), { status: 502 });
      }

      const jsonMatch = aiText.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return jsonResponse(JSON.stringify({ error: "Could not parse AI response" }), { status: 502 });

      let parsed;
      try { parsed = JSON.parse(jsonMatch[0]); } catch {
        return jsonResponse(JSON.stringify({ error: "Invalid AI JSON" }), { status: 502 });
      }

      const summary = typeof parsed.summary === "string" ? parsed.summary.slice(0, 600) : "";
      const bullets = Array.isArray(parsed.bullets)
        ? parsed.bullets.filter(b => typeof b === "string").slice(0, 5).map(b => String(b).slice(0, 120))
        : [];

      log("info", "grant_summarized", { ...reqCtx, hostname });
      return jsonResponse(JSON.stringify({ summary, bullets }));
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

      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const pageSize = Math.min(500, Math.max(1, parseInt(url.searchParams.get("pageSize") || "100", 10)));

      // Forecasted opportunities aren't formally applyable yet, so they're hidden
      // from the main ranked list unless explicitly requested.
      const includeForecast = url.searchParams.get("includeForecast") === "true";
      // Award-size range filter, in dollars. minAward keeps grants whose ceiling
      // could plausibly reach that amount; maxAward excludes grants whose floor
      // (or ceiling, if no floor is known) exceeds the cap.
      const minAwardParam = url.searchParams.get("minAward");
      const maxAwardParam = url.searchParams.get("maxAward");
      const minAward = minAwardParam !== null && minAwardParam !== "" ? Number(minAwardParam) : null;
      const maxAward = maxAwardParam !== null && maxAwardParam !== "" ? Number(maxAwardParam) : null;
      // Collapses cohort-year duplicates of the same underlying program (same
      // CFDA/Assistance Listing Number) down to the most recent one, deterministically.
      const dedupeByCfda = url.searchParams.get("dedupeByCfda") !== "false";

      const grantsStart = Date.now();
      const columns = await getColumns(env.GRANT_MANAGER_DB);
      let scored = [];
      if (columns.length > 0) {
        const { results: rows } = await env.GRANT_MANAGER_DB.prepare(`SELECT * FROM programs`).all();
        const hasNewSchema = columns.includes("source_url");
        scored = rows.map((r) => {
          const g = hasNewSchema ? {
            "Type": r.type ?? "",
            "Name": r.name ?? "",
            "Sponsor": r.sponsor ?? "",
            "Source URL": r.source_url ?? "",
            "Region/Eligibility": r.region_eligibility ?? "",
            "Deadline/Next Cohort": r.deadline ?? "",
            "Cadence": r.cadence ?? "",
            "Benefits": r.benefits ?? "",
            "Eligibility (key conditions)": r.eligibility_conditions ?? "",
            "Stage": r.stage ?? "",
            "Non-dilutive?": r.non_dilutive === 1 ? "Yes" : r.non_dilutive === 0 ? "No" : "",
            "Stack Required?": r.stack_required === 1 ? "Yes" : r.stack_required === 0 ? "No" : "",
            "Relevance": r.relevance ?? 0,
            "Fit": r.fit ?? 0,
            "Ease": r.ease ?? 0,
            "Weighted Score": r.weighted_score ?? 0,
            "Notes/Actions": r.notes ?? "",
            // AI scoring pass output (worker.js /api/admin/score-grants) — previously
            // computed and stored but never actually returned here, so GrantDrawer's
            // AI tier/summary/score section was always empty.
            "ai_score": r.ai_score ?? null,
            "ai_summary": r.ai_summary ?? "",
            "ai_tier": r.ai_tier ?? "",
            "ai_scored_at": r.ai_scored_at ?? "",
            "pdf_url": r.pdf_url ?? "",
            "Opportunity ID": r.opportunity_id ?? "",
            "Opportunity Number": r.opportunity_number ?? "",
            "CFDA Numbers": r.cfda_numbers ?? "",
            "Eligible Applicants": r.eligible_applicants ?? "",
            "Award Ceiling": r.award_ceiling ?? null,
            "Award Floor": r.award_floor ?? null,
            "Is Forecast": r.is_forecast === 1,
            "Estimated Post Date": r.estimated_post_date ?? "",
            "Source Channel": r.source_channel ?? "",
          } : r;
          return { ...g, score: computeScore(g, userWeights, profile) };
        });

        if (!includeForecast) {
          scored = scored.filter((g) => !g["Is Forecast"]);
        }
        if (minAward !== null && !Number.isNaN(minAward)) {
          scored = scored.filter((g) => g["Award Ceiling"] != null && Number(g["Award Ceiling"]) >= minAward);
        }
        if (maxAward !== null && !Number.isNaN(maxAward)) {
          scored = scored.filter((g) => {
            const floor = g["Award Floor"] ?? g["Award Ceiling"];
            return floor != null && Number(floor) <= maxAward;
          });
        }
        if (dedupeByCfda) {
          const byCfda = new Map();
          const noCfda = [];
          for (const g of scored) {
            const cfda = String(g["CFDA Numbers"] || "").trim();
            if (!cfda) { noCfda.push(g); continue; }
            const existing = byCfda.get(cfda);
            if (!existing) { byCfda.set(cfda, g); continue; }
            const gDate = Date.parse(g["Deadline/Next Cohort"] || g["Estimated Post Date"] || "");
            const eDate = Date.parse(existing["Deadline/Next Cohort"] || existing["Estimated Post Date"] || "");
            if (!Number.isNaN(gDate) && (Number.isNaN(eDate) || gDate > eDate)) byCfda.set(cfda, g);
          }
          scored = [...noCfda, ...byCfda.values()];
        }

        scored.sort((a, b) => b.score - a.score);
      }
      const total = scored.length;
      const start = (page - 1) * pageSize;
      const data = scored.slice(start, start + pageSize);
      log("info", "grants_fetched", { ...reqCtx, total, page, pageSize, durationMs: Date.now() - grantsStart });
      return jsonResponse(JSON.stringify({ data, total, page, pageSize }));
    }

    if (url.pathname === "/api/me") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      return jsonResponse(JSON.stringify({ username, isAdmin: await isAdminUser(env, username) }));
    }

    if (url.pathname === "/api/admin/users" && request.method === "GET") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await isAdminUser(env, username))) return new Response("Forbidden", { status: 403 });
      if (!env.GRANT_MANAGER_DB) return new Response("Database not configured", { status: 503 });
      const { results } = await env.GRANT_MANAGER_DB.prepare(
        "SELECT username, is_admin FROM users ORDER BY created_at ASC"
      ).all();
      // Merge in env-var admins that may not be in D1 (legacy bootstrap accounts)
      const envAdmins = getAdminUsers(env);
      const rows = results.map((r) => ({ email: r.username, isAdmin: r.is_admin === 1 || envAdmins.has(r.username) }));
      return jsonResponse(JSON.stringify(rows));
    }

    if (url.pathname === "/api/admin/set-admin" && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await isAdminUser(env, username))) return new Response("Forbidden", { status: 403 });
      if (!(await validateCsrf(request, env, username))) return new Response("Forbidden", { status: 403 });
      if (!env.GRANT_MANAGER_DB) return new Response("Database not configured", { status: 503 });
      const body = await request.json().catch(() => ({}));
      const targetEmail = String(body.email || "").trim().toLowerCase();
      const makeAdmin = body.isAdmin === true;
      if (!targetEmail) {
        return jsonResponse(JSON.stringify({ error: "email is required." }), { status: 400 });
      }
      // Prevent removing your own admin access
      if (targetEmail === username && !makeAdmin) {
        return jsonResponse(JSON.stringify({ error: "You cannot remove your own admin access." }), { status: 400 });
      }
      const target = await env.GRANT_MANAGER_DB.prepare(
        "SELECT username FROM users WHERE username = ?"
      ).bind(targetEmail).first();
      if (!target) {
        return jsonResponse(JSON.stringify({ error: "No account found with that email." }), { status: 404 });
      }
      await env.GRANT_MANAGER_DB.prepare(
        "UPDATE users SET is_admin = ? WHERE username = ?"
      ).bind(makeAdmin ? 1 : 0, targetEmail).run();
      log("info", "admin_set", { requestId, by: username, target: targetEmail, isAdmin: makeAdmin });
      return jsonResponse(JSON.stringify({ ok: true }));
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
            ? `https://simpler.grants.gov/opportunity/${opp.opportunity_id}`
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
        const heuristic = computeLiveHeuristicScores(grant, lsProfile);
        grant.Relevance = heuristic.Relevance;
        grant.Fit       = heuristic.Fit;
        grant.Ease      = heuristic.Ease;
        const w = lsWeights || DEFAULT_WEIGHTS;
        const wTotal = Object.values(w).reduce((a, b) => a + b, 0) || 1;
        grant["Weighted Score"] = Math.round((
          ((w.Relevance ?? 0) / wTotal) * grant.Relevance
        + ((w.Fit       ?? 0) / wTotal) * grant.Fit
        + ((w.Ease      ?? 0) / wTotal) * grant.Ease
        ) * 100) / 100;
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

    if (url.pathname === "/api/scan" && request.method === "GET") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await isAdminUser(env, username))) return new Response("Forbidden", { status: 403 });
      if (!env.SIMPLER_GRANTS_API_KEY) {
        return jsonResponse(JSON.stringify({ error: "Live scan is not configured. Set the SIMPLER_GRANTS_API_KEY secret." }), { status: 503 });
      }
      if (!env.GRANT_MANAGER_DB) {
        return jsonResponse(JSON.stringify({ error: "Database not configured." }), { status: 503 });
      }

      const agencyParam     = url.searchParams.get("agency") || null;
      const minAwardRaw     = url.searchParams.get("minAward");
      const maxAwardRaw     = url.searchParams.get("maxAward");
      const minAward        = minAwardRaw !== null && minAwardRaw !== "" ? Number(minAwardRaw) : null;
      const maxAward        = maxAwardRaw !== null && maxAwardRaw !== "" ? Number(maxAwardRaw) : null;
      const deadlineBefore  = url.searchParams.get("deadlineBefore") || null;
      const statusParam     = url.searchParams.get("status") || "both";
      const doSync          = url.searchParams.get("sync") === "true";

      if (!["posted", "forecasted", "both"].includes(statusParam)) {
        return jsonResponse(JSON.stringify({ error: "status must be posted, forecasted, or both" }), { status: 400 });
      }

      const appliedFilters = { agency: agencyParam, minAward, maxAward, deadlineBefore, status: statusParam };
      const apiFilters = buildSimplerGrantsFilters(appliedFilters);

      const scanStart = Date.now();
      let opportunities;
      try {
        opportunities = await fetchAllFromSimplerGrants(env, "", apiFilters);
      } catch (err) {
        log("error", "scan_fetch_failed", { ...reqCtx, error: String(err) });
        return jsonResponse(JSON.stringify({ error: err.message || "Failed to reach Simpler Grants API." }), { status: 502 });
      }

      // Load user profile for heuristic scoring (same as /api/live-search)
      let scanProfile = {};
      if (env.USER_PROFILES) {
        const rawProfile = await env.USER_PROFILES.get(`profile:${username}`);
        if (rawProfile) { try { scanProfile = JSON.parse(rawProfile); } catch { scanProfile = {}; } }
      }

      const results = opportunities.map((opp) => {
        const summary = opp.summary || opp;
        const opportunityId = opp.opportunity_id != null ? String(opp.opportunity_id) : "";
        const name = opp.opportunity_title || summary.opportunity_title || "";
        const sponsor = opp.agency_name || summary.agency_name || opp.agency_code || "";
        const awardFloor = opp.award_floor ?? summary.award_floor ?? null;
        const awardCeiling = opp.award_ceiling ?? summary.award_ceiling ?? null;
        const applicantTypes = Array.isArray(opp.applicant_types)
          ? opp.applicant_types
          : Array.isArray(summary.applicant_types) ? summary.applicant_types : [];
        const eligibility = applicantTypes.map(capitalize).join(", ");
        const cfdaList = Array.isArray(opp.cfda_numbers)
          ? opp.cfda_numbers
          : Array.isArray(opp.assistance_listing_numbers)
            ? opp.assistance_listing_numbers
            : Array.isArray(summary.assistance_listing_numbers)
              ? summary.assistance_listing_numbers : [];
        const grant = {
          "Type":                     capitalize(opp.funding_instrument || summary.funding_instruments?.[0] || "grant"),
          "Name":                     name,
          "Sponsor":                  sponsor,
          "Source URL":               opportunityId ? `https://simpler.grants.gov/opportunity/${opportunityId}` : "",
          "Region / Eligibility":     eligibility,
          "Deadline / Next Cohort":   opp.close_date || summary.close_date || "",
          "Cadence":                  "",
          "Benefits":                 fmtAward(awardFloor, awardCeiling),
          "Eligibility (key conditions)": eligibility,
          "Stage":                    capitalize(opp.opportunity_status || ""),
          "Non-dilutive?":            "Yes",
          "Stack Required?":          "No",
          "Opportunity ID":           opportunityId,
          "Opportunity Number":       opp.opportunity_number || "",
          "CFDA Numbers":             cfdaList.join(", "),
          "Award Ceiling":            awardCeiling,
          "Award Floor":              awardFloor,
          "Is Forecast":              (opp.opportunity_status || "").toLowerCase() === "forecasted",
          "Source Channel":           "simpler_api",
        };
        const heuristic = computeLiveHeuristicScores(grant, scanProfile);
        return { ...grant, Relevance: heuristic.Relevance, Fit: heuristic.Fit, Ease: heuristic.Ease };
      });

      let syncResult = null;
      if (doSync) {
        try {
          syncResult = await upsertOpportunitiesToD1(env, opportunities);
        } catch (err) {
          log("error", "scan_sync_failed", { ...reqCtx, error: String(err) });
          syncResult = { success: false, error: String(err) };
        }
      }

      log("info", "scan_completed", { ...reqCtx, total: results.length, filters: appliedFilters, synced: doSync, durationMs: Date.now() - scanStart });

      const scanBody = { results, total: results.length, filters: appliedFilters };
      if (syncResult !== null) scanBody.sync = syncResult;
      return jsonResponse(JSON.stringify(scanBody));
    }

    if (url.pathname === "/api/live-search-status") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      return jsonResponse(JSON.stringify({ configured: !!env.SIMPLER_GRANTS_API_KEY }));
    }

    // ── NGO / Foundation search — queries D1 for curated non-federal grants ────
    if (url.pathname === "/api/ngo-search" && request.method === "GET") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });

      const q = (url.searchParams.get("q") || "").trim().toLowerCase();
      const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
      const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get("pageSize") || "25", 10)));
      const offset = (page - 1) * pageSize;

      const NGO_CHANNELS = ["'foundation'", "'corporate'", "'community_foundation'"];
      const channelClause = `source_channel IN (${NGO_CHANNELS.join(",")})`;

      let rows, total;
      if (!q) {
        const countRow = await env.GRANT_MANAGER_DB
          .prepare(`SELECT COUNT(*) as n FROM programs WHERE ${channelClause}`)
          .first();
        total = countRow?.n ?? 0;
        const res = await env.GRANT_MANAGER_DB
          .prepare(`SELECT * FROM programs WHERE ${channelClause} ORDER BY weighted_score DESC LIMIT ? OFFSET ?`)
          .bind(pageSize, offset).all();
        rows = res.results;
      } else {
        const like = `%${q}%`;
        const countRow = await env.GRANT_MANAGER_DB
          .prepare(`SELECT COUNT(*) as n FROM programs WHERE ${channelClause}
            AND (LOWER(name) LIKE ? OR LOWER(sponsor) LIKE ? OR LOWER(benefits) LIKE ?
              OR LOWER(eligibility_conditions) LIKE ? OR LOWER(type) LIKE ?)`)
          .bind(like, like, like, like, like).first();
        total = countRow?.n ?? 0;
        const res = await env.GRANT_MANAGER_DB
          .prepare(`SELECT * FROM programs WHERE ${channelClause}
            AND (LOWER(name) LIKE ? OR LOWER(sponsor) LIKE ? OR LOWER(benefits) LIKE ?
              OR LOWER(eligibility_conditions) LIKE ? OR LOWER(type) LIKE ?)
            ORDER BY weighted_score DESC LIMIT ? OFFSET ?`)
          .bind(like, like, like, like, like, pageSize, offset).all();
        rows = res.results;
      }

      const hasNewSchema = rows.length === 0 || "source_url" in rows[0];
      const data = rows.map((r) => ({
        "Type": r.type ?? "",
        "Name": r.name ?? "",
        "Sponsor": r.sponsor ?? "",
        "Source URL": hasNewSchema ? (r.source_url ?? "") : (r.sourceUrl ?? ""),
        "Region/Eligibility": r.region_eligibility ?? "",
        "Deadline/Next Cohort": r.deadline ?? "",
        "Cadence": r.cadence ?? "",
        "Benefits": r.benefits ?? "",
        "Eligibility (key conditions)": r.eligibility_conditions ?? "",
        "Stage": r.stage ?? "",
        "Non-dilutive?": r.non_dilutive ? "Yes" : "No",
        "Stack Required?": r.stack_required ? "Yes" : "No",
        "Relevance": r.relevance ?? 0,
        "Fit": r.fit ?? 0,
        "Ease": r.ease ?? 0,
        "Weighted Score": r.weighted_score ?? 0,
        "Notes/Actions": r.notes ?? "",
        "Award Ceiling": r.award_ceiling ?? null,
        "Award Floor": r.award_floor ?? null,
        "Source Channel": r.source_channel ?? "",
        "Opportunity ID": r.opportunity_id ?? "",
        source: "db",
      }));

      return jsonResponse(JSON.stringify({ data, total, page, pageSize }));
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
      if (!(await isAdminUser(env, username))) {
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

      const BOOL_COLS = new Set(["non_dilutive", "stack_required"]);
      function coerceBool(col, val) {
        if (!BOOL_COLS.has(col)) return val;
        const s = String(val ?? "").trim().toLowerCase();
        if (s === "yes" || s === "true" || s === "1") return 1;
        if (s === "no"  || s === "false" || s === "0") return 0;
        return null;
      }

      const insertCols = [...new Set(mapping.filter(Boolean))];
      const insertStmt = db.prepare(
        `INSERT INTO programs (${insertCols.join(",")})
         VALUES (${insertCols.map(() => "?").join(",")})`
      );
      const statements = [...byName.values()].map((r) =>
        insertStmt.bind(...insertCols.map((c) => coerceBool(c, r[c] ?? "")))
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
      if (!(await isAdminUser(env, username))) return new Response("Forbidden", { status: 403 });
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

    if (url.pathname === "/api/admin/score-grants-ai" && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await isAdminUser(env, username))) return new Response("Forbidden", { status: 403 });
      if (!(await validateCsrf(request, env, username))) return new Response("Forbidden", { status: 403 });
      if (!env.GRANT_MANAGER_DB) return new Response("Database not configured", { status: 503 });
      if (!env.AI && !(env.CF_ACCOUNT_ID && env.CF_AI_TOKEN)) return new Response("AI not configured", { status: 503 });

      try {
        const body = await request.json().catch(() => ({}));
        const batch = Math.min(20, Math.max(1, parseInt(body.batch ?? "5", 10)));
        const rescore = body.rescore === true;

        const profileRaw = env.USER_PROFILES
          ? await env.USER_PROFILES.get("profile:solar_roots", { type: "json" }).catch(() => null)
          : null;
        const focusAreas = profileRaw?.focusAreas ?? ["solar", "clean energy", "climate", "renewable energy"];
        const orgType    = profileRaw?.orgType ?? "Nonprofit";
        const stage      = profileRaw?.stage ?? "Growth";
        const missionCtx = `${focusAreas.join(", ")} | ${orgType} | ${stage}`;

        const filter = rescore
          ? "ORDER BY rowid LIMIT ?"
          : "WHERE (ai_scored_at IS NULL) ORDER BY rowid LIMIT ?";
        const { results: grants } = await env.GRANT_MANAGER_DB.prepare(
          `SELECT name, sponsor, source_url, benefits, eligibility_conditions, type, stage, deadline
           FROM programs ${filter}`
        ).bind(batch).all();

        if (grants.length === 0) {
          return jsonResponse(JSON.stringify({ ok: true, scored: 0, message: "No unscored grants found." }));
        }

        const SOLAR_KEYWORDS = ["solar", "clean energy", "climate", "renewable", "energy efficiency", "environment", "sustainability"];

        async function scoreGrantWithAI(grant, pageText) {
          const context = [
            `Name: ${grant.name}`,
            `Sponsor: ${grant.sponsor || "Unknown"}`,
            `Type: ${grant.type || ""}`,
            `Stage: ${grant.stage || ""}`,
            `Benefits: ${grant.benefits || ""}`,
            `Eligibility: ${grant.eligibility_conditions || ""}`,
            pageText ? `Page excerpt:\n${pageText}` : "",
          ].filter(Boolean).join("\n");

          const prompt = `You are scoring a grant for an organization whose mission covers: ${missionCtx}.

Score this grant on three dimensions (integers 0–3 each):
- relevance: How specific and well-described is this funding opportunity? 0=vague, 3=very clear.
- fit: How broadly accessible is it (nonprofits, startups, researchers)? 0=very narrow, 3=widely open.
- ease: How easy to apply (rolling, simple requirements)? 0=complex, 3=straightforward.

Also provide:
- summary: 1–2 sentence plain-English description of what this grant funds and who it's for.
- tier: "Hot" if excellent fit for our mission + clear eligibility + easy apply; "Warm" if partial fit or some friction; "Cool" otherwise.

Grant:
${context}

Respond with ONLY a JSON object. Example: {"relevance":2,"fit":2,"ease":3,"summary":"Funds clean-energy projects for nonprofits.","tier":"Hot"}`;

          const messages = [{ role: "user", content: prompt }];
          let text = "";
          if (env.AI) {
            const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", { messages, stream: false });
            text = result.response || "";
          } else {
            const res = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
              { method: "POST", headers: { Authorization: `Bearer ${env.CF_AI_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages }) }
            );
            const data = await res.json();
            text = data.result?.response ?? "";
          }

          const match = text.match(/\{[\s\S]*?\}/);
          if (!match) return null;
          try {
            const parsed = JSON.parse(match[0]);
            const clamp = (v) => Math.min(3, Math.max(0, parseInt(v, 10) || 0));
            const validTiers = new Set(["Hot", "Warm", "Cool"]);
            return {
              relevance: clamp(parsed.relevance),
              fit:       clamp(parsed.fit),
              ease:      clamp(parsed.ease),
              summary:   typeof parsed.summary === "string" ? parsed.summary.slice(0, 500) : "",
              tier:      validTiers.has(parsed.tier) ? parsed.tier : "Cool",
            };
          } catch { return null; }
        }

        let scored = 0;
        const errors = [];
        for (const grant of grants) {
          try {
            const pageText = await fetchPageText(grant.source_url);
            const result = await scoreGrantWithAI(grant, pageText);
            if (result) {
              const grantText = [grant.name, grant.benefits, grant.eligibility_conditions].join(" ").toLowerCase();
              const hitCount = SOLAR_KEYWORDS.filter(k => grantText.includes(k)).length;
              const profileBonus = hitCount > 0 ? Math.min(2.0, hitCount * 0.5) : 0;
              const baseScore = (result.relevance * 0.3 + result.fit * 0.3 + result.ease * 0.2) * (10 / 3);
              const aiScore = Math.min(10, Math.round((baseScore + profileBonus) * 100) / 100);

              await env.GRANT_MANAGER_DB.prepare(
                `UPDATE programs SET ai_score = ?, ai_summary = ?, ai_tier = ?, ai_scored_at = ? WHERE name = ?`
              ).bind(aiScore, result.summary, result.tier, new Date().toISOString(), grant.name).run();
              scored++;
            }
          } catch (e) {
            errors.push({ name: grant.name, error: String(e).slice(0, 100) });
          }
        }

        log("info", "grants_ai_scored", { ...reqCtx, scored, errors: errors.length });
        return jsonResponse(JSON.stringify({ ok: true, scored, total: grants.length, errors }));
      } catch (e) {
        log("error", "score_grants_ai_failed", { ...reqCtx, error: String(e) });
        return jsonResponse(JSON.stringify({ error: String(e) }), { status: 500 });
      }
    }

    if (url.pathname === "/api/admin/send-digest" && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await isAdminUser(env, username))) return new Response("Forbidden", { status: 403 });
      if (!(await validateCsrf(request, env, username))) return new Response("Forbidden", { status: 403 });
      if (!env.GRANT_MANAGER_DB) return new Response("Database not configured", { status: 503 });

      try {
        const profileRaw = env.USER_PROFILES
          ? await env.USER_PROFILES.get("profile:solar_roots", { type: "json" }).catch(() => null)
          : null;
        const digestEmail = profileRaw?.digestEmail;
        if (!digestEmail) {
          return jsonResponse(JSON.stringify({ error: "No digestEmail set in profile:solar_roots KV entry." }), { status: 400 });
        }
        if (!env.RESEND_API_KEY) {
          return jsonResponse(JSON.stringify({ error: "RESEND_API_KEY secret not configured." }), { status: 503 });
        }

        const { results: grants } = await env.GRANT_MANAGER_DB.prepare(
          `SELECT name, sponsor, deadline, ai_score, ai_summary, ai_tier, source_url
           FROM programs WHERE ai_tier IN ('Hot','Warm') ORDER BY ai_score DESC LIMIT 20`
        ).all();

        if (grants.length === 0) {
          return jsonResponse(JSON.stringify({ ok: true, count: 0, sent: false, message: "No Hot or Warm grants to send." }));
        }

        const TIER_COLOR = { Hot: "#f97316", Warm: "#eab308", Cool: "#6b7280" };
        const grantCards = grants.map(g => {
          const tierColor = TIER_COLOR[g.ai_tier] ?? "#6b7280";
          const deadlineStr = g.deadline ? `<span style="color:#9ca3af;font-size:12px">Deadline: ${escapeHtml(g.deadline)}</span>` : "";
          const summaryStr = g.ai_summary ? `<p style="margin:6px 0 0;color:#d1d5db;font-size:14px">${escapeHtml(g.ai_summary)}</p>` : "";
          const sourceLink = g.source_url
            ? `<a href="${escapeHtml(g.source_url)}" style="color:#60a5fa;font-size:13px">View grant</a>`
            : "";
          return `<div style="border:1px solid #374151;border-radius:8px;padding:16px;margin-bottom:12px;background:#1f2937">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
    <span style="background:${tierColor}22;color:${tierColor};border:1px solid ${tierColor}44;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">${escapeHtml(g.ai_tier)}</span>
    <strong style="color:#f9fafb;font-size:15px">${escapeHtml(g.name)}</strong>
  </div>
  <div style="color:#9ca3af;font-size:13px;margin-bottom:4px">${escapeHtml(g.sponsor ?? "")}</div>
  ${deadlineStr}
  ${summaryStr}
  <div style="margin-top:8px">${sourceLink}</div>
</div>`;
        }).join("\n");

        const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
        const htmlBody = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#111827;color:#f9fafb;padding:24px;max-width:640px;margin:auto">
<h1 style="color:#f9fafb;font-size:22px;margin-bottom:4px">Solar Roots Grant Digest</h1>
<p style="color:#9ca3af;margin-bottom:20px">${monthLabel} &mdash; ${grants.length} grant${grants.length !== 1 ? "s" : ""} matched</p>
${grantCards}
<hr style="border-color:#374151;margin:24px 0">
<p style="color:#6b7280;font-size:12px">You're receiving this because you're subscribed to the Solar Roots grant digest. Manage your profile to update preferences.</p>
</body></html>`;

        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "onboarding@resend.dev",
            to: digestEmail,
            subject: `Solar Roots Grant Digest — ${monthLabel}`,
            html: htmlBody,
          }),
        });

        if (!emailRes.ok) {
          const errText = await emailRes.text().catch(() => "");
          log("error", "digest_resend_error", { ...reqCtx, status: emailRes.status, error: errText.slice(0, 200) });
          return jsonResponse(JSON.stringify({ error: `Resend error ${emailRes.status}` }), { status: 502 });
        }

        log("info", "digest_sent", { ...reqCtx, count: grants.length, to: digestEmail });
        return jsonResponse(JSON.stringify({ ok: true, count: grants.length, sent: true }));
      } catch (e) {
        log("error", "send_digest_failed", { ...reqCtx, error: String(e) });
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

      // Truncate grant context to ~4000 chars to stay within the model's context window.
      // llama-3.1-8b-instruct has an 8192-token limit; 30 untruncated grants can exceed it.
      const MAX_CONTEXT_CHARS = 4000;
      const truncatedContext = grantContext.length > MAX_CONTEXT_CHARS
        ? grantContext.slice(0, MAX_CONTEXT_CHARS) + "\n[...context truncated]"
        : grantContext;

      const systemPrompt =
        `You are a grant research assistant. The user has a database of ${totalCount} grant opportunities. ` +
        `Answer questions using the grant data below. Reference grants by name, compare opportunities, ` +
        `highlight deadlines and eligibility. Be concise and specific. ` +
        `Every time you mention a grant, format its name as a markdown link to its page in this app ` +
        `using the exact Link URL provided for that grant, e.g. [Grant Name](https://app/?grant=...). ` +
        `Never invent URLs — only use the Link values from the grant data.\n\n` +
        (truncatedContext ? `GRANTS FROM DATABASE:\n${truncatedContext}` : "Could not load grant data.");

      const aiMessages = [{ role: "system", content: systemPrompt }, ...chatMessages];

      // Try native AI binding first, then fall back to REST API.
      // Each path has its own inner try/catch so a binding failure doesn't suppress the
      // REST fallback — previously a thrown error from env.AI.run() skipped the REST path
      // entirely and returned 502 immediately.
      try {
        if (env.AI && typeof env.AI.run === "function") {
          try {
            const aiStart = Date.now();
            const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
              messages: aiMessages,
              stream: false,
            });
            log("info", "ai_chat_response", { ...reqCtx, model: "@cf/meta/llama-3.1-8b-instruct", contextGrants: totalCount, durationMs: Date.now() - aiStart });
            return jsonResponse(JSON.stringify({ response: result.response ?? "" }));
          } catch (bindingErr) {
            log("warn", "ai_binding_failed_trying_rest", { ...reqCtx, error: String(bindingErr) });
            // fall through to REST API if configured
          }
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
            log("error", "ai_rest_failed", { ...reqCtx, status: aiRes.status, error: errText.slice(0, 300) });
            return jsonResponse(JSON.stringify({ error: `AI request failed (${aiRes.status}): ${errText.slice(0, 200)}` }), { status: 502 });
          }
          const data = await aiRes.json();
          const text = data.result?.response ?? "";
          return jsonResponse(JSON.stringify({ response: text }));
        }

        return jsonResponse(JSON.stringify({ error: "AI not configured. Ensure the [ai] binding is set in wrangler.toml and redeploy." }), { status: 503 });
      } catch (aiErr) {
        log("error", "ai_chat_failed", { ...reqCtx, error: String(aiErr) });
        return jsonResponse(JSON.stringify({ error: `The assistant encountered an error: ${String(aiErr)}` }), { status: 502 });
      }
    }

    if (url.pathname === "/api/request-password-reset" && request.method === "POST") {
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (env.LOGIN_ATTEMPTS) {
        const { blocked } = await checkRateLimit(env.LOGIN_ATTEMPTS, `reset_req:${ip}`);
        if (blocked) return new Response("Too many requests. Try again later.", { status: 429 });
      }
      const body = await request.json().catch(() => ({}));
      const resetEmail = String(body.email || "").trim().toLowerCase();
      if (!resetEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(resetEmail)) {
        return jsonResponse(JSON.stringify({ error: "A valid email address is required." }), { status: 400 });
      }
      // Email IS the username — look up directly
      let resetUsername = null;
      if (env.GRANT_MANAGER_DB) {
        try {
          const row = await env.GRANT_MANAGER_DB.prepare(
            "SELECT username FROM users WHERE username = ?"
          ).bind(resetEmail).first();
          if (row) resetUsername = row.username;
        } catch { /* ignore */ }
      }
      if (!resetUsername) {
        return jsonResponse(JSON.stringify({
          ok: true,
          message: "If an account with that email exists, a reset token has been sent.",
        }));
      }
      const resetToken = crypto.randomUUID();
      if (env.LOGIN_ATTEMPTS) {
        await env.LOGIN_ATTEMPTS.put(
          `reset:${resetToken}`,
          JSON.stringify({ username: resetUsername, expiresAt: Date.now() + 3_600_000 }),
          { expirationTtl: 3600 }
        );
      }
      log("info", "password_reset_requested", { requestId, username: resetUsername });
      // Send reset token by email if Resend is configured
      if (env.RESEND_API_KEY) {
        try {
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "onboarding@resend.dev",
              to: resetEmail,
              subject: "Reset your Grant Manager password",
              text: [
                "You requested a password reset for your Grant Manager account.",
                "",
                `Your reset token is: ${resetToken}`,
                "",
                "Enter this token on the reset password page along with your new password.",
                "This token expires in 1 hour.",
                "",
                "If you didn't request this, you can safely ignore this email.",
              ].join("\n"),
            }),
          });
          if (!emailRes.ok) {
            const errText = await emailRes.text();
            console.error("Resend error:", emailRes.status, errText);
          }
        } catch (err) {
          console.error("Resend fetch failed:", err);
        }
        return jsonResponse(JSON.stringify({
          ok: true,
          message: "If an account with that email exists, a reset token has been sent. Check your inbox.",
        }));
      }
      // Dev fallback: return token directly when Resend is not configured
      return jsonResponse(JSON.stringify({
        ok: true,
        token: resetToken,
        message: "Reset token generated (email not configured — token shown for development).",
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

    // POST /api/feedback — no auth required
    // To configure secrets, run:
    //   npx wrangler secret put RESEND_API_KEY
    //   npx wrangler secret put NOTIFICATION_EMAIL
    if (url.pathname === "/api/feedback" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const rating = Number(body.rating);
      if (!rating || rating < 1 || rating > 5) {
        return new Response(JSON.stringify({ error: "rating must be 1–5" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }

      const comment = body.comment ? String(body.comment).slice(0, 2000) : null;
      const email = body.email ? String(body.email).slice(0, 255) : null;
      const optedIn = email && body.opted_in ? 1 : 0;
      const submittedAt = new Date().toISOString();
      const userAgent = request.headers.get("User-Agent") || null;

      await env.GRANT_MANAGER_DB.prepare(
        `INSERT INTO feedback (rating, comment, email, opted_in, submitted_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(rating, comment, email, optedIn, submittedAt, userAgent).run();

      if (email && optedIn) {
        await env.GRANT_MANAGER_DB.prepare(
          `INSERT OR IGNORE INTO subscribers (email, subscribed_at) VALUES (?, ?)`
        ).bind(email, submittedAt).run();
      }

      // Send notification email via Resend — failure is non-blocking
      if (env.RESEND_API_KEY && env.NOTIFICATION_EMAIL) {
        const emailBody = [
          `Star Rating: ⭐ ${rating} / 5`,
          `Comment: ${comment || "No comment left"}`,
          `Email: ${email || "Not provided"}`,
          `Opted in to updates: ${optedIn ? "Yes" : "No"}`,
          `Submitted at: ${submittedAt}`,
          `User agent: ${userAgent || "Unknown"}`,
        ].join("\n");

        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "onboarding@resend.dev",
              to: env.NOTIFICATION_EMAIL,
              subject: "New Feedback — Grant Manager Tool",
              text: emailBody,
            }),
          });
          if (!res.ok) {
            const errText = await res.text();
            console.error("Resend error:", res.status, errText);
          }
        } catch (err) {
          console.error("Resend fetch failed:", err);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // POST /api/anonymous-feedback — no auth required; creates a GitHub issue
    // Secrets: GITHUB_TOKEN (required), FEEDBACK_R2_PUBLIC_BASE_URL (optional, enables screenshots)
    if (url.pathname === "/api/anonymous-feedback" && request.method === "POST") {
      const ip =
        (request.headers.get("CF-Connecting-IP") ||
         request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
         "unknown");

      const { allowed } = await checkFeedbackRateLimit(env, ip);
      if (!allowed) {
        return new Response(
          JSON.stringify({ error: "Too many submissions. Please try again in an hour." }),
          { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "3600" } },
        );
      }

      let fd;
      try {
        fd = await request.formData();
      } catch {
        return new Response(
          JSON.stringify({ error: "Invalid request body" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const rawMsg = fd.get("message");
      if (!rawMsg || typeof rawMsg !== "string" || rawMsg.trim().length === 0) {
        return new Response(
          JSON.stringify({ error: "Message is required" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const VALID_CATS = ["bug", "feature", "general"];
      const rawCat = fd.get("category");
      const category = VALID_CATS.includes(rawCat) ? rawCat : "general";
      const name     = fd.get("name")  ? String(fd.get("name")).slice(0, 100).trim()  : null;
      const email    = fd.get("email") ? String(fd.get("email")).slice(0, 255).trim() : null;
      const message  = rawMsg.slice(0, 5000).trim();
      const userAgent = request.headers.get("User-Agent") || null;

      // Optional screenshot upload — failure is non-blocking
      let screenshotUrl = null;
      const screenshotFile = fd.get("screenshot");
      if (screenshotFile instanceof File && screenshotFile.size > 0) {
        screenshotUrl = await uploadFeedbackScreenshot(screenshotFile, env);
      }

      if (!env.GITHUB_TOKEN) {
        log("error", "anon_feedback_no_token", reqCtx);
        return new Response(
          JSON.stringify({ error: "Feedback service is not configured" }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      const catLabel = category === "bug" ? "bug" : category === "feature" ? "enhancement" : "feedback";
      const issueTitle =
        category === "bug"     ? "[Feedback] Bug Report" :
        category === "feature" ? "[Feedback] Feature Request" :
                                 "[Feedback] General Feedback";
      const issueBody = buildFeedbackIssueBody({ name, email, message, category, screenshotUrl, userAgent });

      let ghRes;
      try {
        ghRes = await postGitHubIssue(env, {
          title: issueTitle,
          body: issueBody,
          labels: [catLabel, "anonymous-feedback"],
        });
      } catch (err) {
        log("error", "anon_feedback_github_network", { ...reqCtx, error: String(err) });
        return new Response(
          JSON.stringify({ error: "Failed to submit feedback. Please try again." }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }

      if (ghRes.status === 401 || ghRes.status === 403) {
        log("error", "anon_feedback_github_auth", { ...reqCtx, status: ghRes.status });
        return new Response(
          JSON.stringify({ error: "Feedback service is temporarily unavailable." }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      if (ghRes.status === 429) {
        log("warn", "anon_feedback_github_ratelimit", reqCtx);
        return new Response(
          JSON.stringify({ error: "Feedback service is busy. Please try again later." }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      if (!ghRes.ok) {
        const errText = await ghRes.text().catch(() => "");
        log("error", "anon_feedback_github_error", { ...reqCtx, status: ghRes.status, error: errText.slice(0, 200) });
        return new Response(
          JSON.stringify({ error: "Failed to submit feedback. Please try again." }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }

      const issue = await ghRes.json();
      log("info", "anon_feedback_submitted", { ...reqCtx, issueNumber: issue.number, category });
      return new Response(
        JSON.stringify({ success: true, issueNumber: issue.number }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // ── Compliance & Audit Trail ─────────────────────────────────────────────
    //
    // All endpoints require authentication. POST/PATCH endpoints additionally
    // require a valid CSRF token (same pattern as /api/profile, /api/notes, etc.)
    // so they are protected against cross-site request forgery.

    // GET /api/compliance/grants
    if (url.pathname === "/api/compliance/grants" && request.method === "GET") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      const rows = await env.GRANT_MANAGER_DB.prepare(
        `SELECT cg.*,
          (SELECT COUNT(*) FROM budget_lines bl WHERE bl.compliance_grant_id = cg.id) AS budget_line_count,
          (SELECT COUNT(*) FROM compliance_checklist cc WHERE cc.compliance_grant_id = cg.id AND cc.status = 'fail') AS checklist_failures
         FROM compliance_grants cg ORDER BY cg.updated_at DESC, cg.id DESC`
      ).all();
      return jsonResponse(JSON.stringify(rows.results ?? []));
    }

    // POST /api/compliance/grants
    if (url.pathname === "/api/compliance/grants" && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await validateCsrf(request, env, username))) {
        log("warn", "csrf_rejected", { ...reqCtx, endpoint: "compliance/grants" });
        return new Response("Forbidden", { status: 403 });
      }
      const body = await request.json();
      const { grant_name, funder, total_awarded, period_start, period_end, program_id } = body;
      if (!grant_name || typeof grant_name !== "string" || !grant_name.trim()) {
        return new Response("grant_name required", { status: 400 });
      }
      const result = await env.GRANT_MANAGER_DB.prepare(
        `INSERT INTO compliance_grants (program_id, grant_name, funder, total_awarded, period_start, period_end, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?) RETURNING id`
      ).bind(
        program_id ?? null,
        grant_name.trim(),
        funder ?? null,
        total_awarded ?? null,
        period_start ?? null,
        period_end ?? null,
        username,
      ).first();
      const id = result?.id;
      await env.GRANT_MANAGER_DB.prepare(
        `INSERT INTO audit_log (compliance_grant_id, event_type, actor, description) VALUES (?, 'status_change', ?, ?)`
      ).bind(id, username, `Grant "${grant_name.trim()}" added to compliance tracking`).run();
      log("info", "compliance_grant_created", { ...reqCtx, grantId: id, grant_name });
      return jsonResponse(JSON.stringify({ id }), { status: 201 });
    }

    // GET /api/compliance/grants/:id  and  PATCH /api/compliance/grants/:id
    const complianceGrantMatch = url.pathname.match(/^\/api\/compliance\/grants\/(\d+)$/);
    if (complianceGrantMatch) {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      const id = parseInt(complianceGrantMatch[1], 10);

      if (request.method === "GET") {
        const [grant, budgetLines, checklist, auditLog] = await Promise.all([
          env.GRANT_MANAGER_DB.prepare(`SELECT * FROM compliance_grants WHERE id = ?`).bind(id).first(),
          env.GRANT_MANAGER_DB.prepare(`SELECT * FROM budget_lines WHERE compliance_grant_id = ? ORDER BY category`).bind(id).all(),
          env.GRANT_MANAGER_DB.prepare(`SELECT * FROM compliance_checklist WHERE compliance_grant_id = ? ORDER BY created_at`).bind(id).all(),
          env.GRANT_MANAGER_DB.prepare(`SELECT * FROM audit_log WHERE compliance_grant_id = ? ORDER BY created_at DESC`).bind(id).all(),
        ]);
        if (!grant) return new Response("Not found", { status: 404 });
        return jsonResponse(JSON.stringify({
          grant,
          budgetLines: budgetLines.results,
          checklist: checklist.results,
          auditLog: auditLog.results,
        }));
      }

      if (request.method === "PATCH") {
        if (!(await validateCsrf(request, env, username))) {
          log("warn", "csrf_rejected", { ...reqCtx, endpoint: "compliance/grants/:id" });
          return new Response("Forbidden", { status: 403 });
        }
        const body = await request.json();
        const prev = await env.GRANT_MANAGER_DB.prepare(`SELECT * FROM compliance_grants WHERE id = ?`).bind(id).first();
        if (!prev) return new Response("Not found", { status: 404 });
        const newStatus = body.status ?? prev.status;
        const newFunder = body.funder ?? prev.funder;
        const newTotal = body.total_awarded ?? prev.total_awarded;
        const newStart = body.period_start ?? prev.period_start;
        const newEnd = body.period_end ?? prev.period_end;
        await env.GRANT_MANAGER_DB.prepare(
          `UPDATE compliance_grants SET status=?, funder=?, total_awarded=?, period_start=?, period_end=?, updated_at=datetime('now') WHERE id=?`
        ).bind(newStatus, newFunder, newTotal, newStart, newEnd, id).run();
        if (body.status && body.status !== prev.status) {
          await env.GRANT_MANAGER_DB.prepare(
            `INSERT INTO audit_log (compliance_grant_id, event_type, actor, description, before_value, after_value)
             VALUES (?, 'status_change', ?, ?, ?, ?)`
          ).bind(id, username, `Status changed from "${prev.status}" to "${body.status}"`, prev.status, body.status).run();
          log("info", "compliance_status_changed", { ...reqCtx, grantId: id, from: prev.status, to: body.status });
        }
        return jsonResponse(JSON.stringify({ ok: true }));
      }
    }

    // POST /api/compliance/grants/:id/budget
    const budgetMatch = url.pathname.match(/^\/api\/compliance\/grants\/(\d+)\/budget$/);
    if (budgetMatch && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await validateCsrf(request, env, username))) {
        log("warn", "csrf_rejected", { ...reqCtx, endpoint: "compliance/budget" });
        return new Response("Forbidden", { status: 403 });
      }
      const id = parseInt(budgetMatch[1], 10);
      const body = await request.json();
      const { category, allocated, spent, notes } = body;
      if (!category || typeof category !== "string" || !category.trim()) {
        return new Response("category required", { status: 400 });
      }
      const existing = await env.GRANT_MANAGER_DB.prepare(
        `SELECT * FROM budget_lines WHERE compliance_grant_id = ? AND lower(category) = lower(?)`
      ).bind(id, category.trim()).first();
      if (existing) {
        const newAlloc = allocated ?? existing.allocated;
        const newSpent = spent ?? existing.spent;
        await env.GRANT_MANAGER_DB.prepare(
          `UPDATE budget_lines SET allocated=?, spent=?, notes=?, updated_by=?, updated_at=datetime('now') WHERE id=?`
        ).bind(newAlloc, newSpent, notes ?? existing.notes, username, existing.id).run();
        await env.GRANT_MANAGER_DB.prepare(
          `INSERT INTO audit_log (compliance_grant_id, event_type, actor, description, before_value, after_value)
           VALUES (?, 'budget_change', ?, ?, ?, ?)`
        ).bind(
          id, username,
          `Budget line "${category.trim()}" updated`,
          JSON.stringify({ allocated: existing.allocated, spent: existing.spent }),
          JSON.stringify({ allocated: newAlloc, spent: newSpent }),
        ).run();
      } else {
        const newAlloc = allocated ?? 0;
        const newSpent = spent ?? 0;
        await env.GRANT_MANAGER_DB.prepare(
          `INSERT INTO budget_lines (compliance_grant_id, category, allocated, spent, notes, updated_by) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(id, category.trim(), newAlloc, newSpent, notes ?? null, username).run();
        await env.GRANT_MANAGER_DB.prepare(
          `INSERT INTO audit_log (compliance_grant_id, event_type, actor, description, after_value)
           VALUES (?, 'budget_change', ?, ?, ?)`
        ).bind(
          id, username,
          `Budget line "${category.trim()}" added`,
          JSON.stringify({ allocated: newAlloc, spent: newSpent }),
        ).run();
      }
      await env.GRANT_MANAGER_DB.prepare(
        `UPDATE compliance_grants SET updated_at=datetime('now') WHERE id=?`
      ).bind(id).run();
      return jsonResponse(JSON.stringify({ ok: true }));
    }

    // POST /api/compliance/grants/:id/checklist
    const checklistAddMatch = url.pathname.match(/^\/api\/compliance\/grants\/(\d+)\/checklist$/);
    if (checklistAddMatch && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await validateCsrf(request, env, username))) {
        log("warn", "csrf_rejected", { ...reqCtx, endpoint: "compliance/checklist/add" });
        return new Response("Forbidden", { status: 403 });
      }
      const id = parseInt(checklistAddMatch[1], 10);
      const body = await request.json();
      const { item } = body;
      if (!item || typeof item !== "string" || !item.trim()) {
        return new Response("item required", { status: 400 });
      }
      await env.GRANT_MANAGER_DB.prepare(
        `INSERT INTO compliance_checklist (compliance_grant_id, item) VALUES (?, ?)`
      ).bind(id, item.trim()).run();
      await env.GRANT_MANAGER_DB.prepare(
        `INSERT INTO audit_log (compliance_grant_id, event_type, actor, description)
         VALUES (?, 'checklist_update', ?, ?)`
      ).bind(id, username, `Checklist item added: "${item.trim()}"`).run();
      return jsonResponse(JSON.stringify({ ok: true }), { status: 201 });
    }

    // PATCH /api/compliance/checklist/:id
    const checklistPatchMatch = url.pathname.match(/^\/api\/compliance\/checklist\/(\d+)$/);
    if (checklistPatchMatch && request.method === "PATCH") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await validateCsrf(request, env, username))) {
        log("warn", "csrf_rejected", { ...reqCtx, endpoint: "compliance/checklist/patch" });
        return new Response("Forbidden", { status: 403 });
      }
      const itemId = parseInt(checklistPatchMatch[1], 10);
      const body = await request.json();
      const { status: itemStatus } = body;
      const validStatuses = ["pending", "pass", "fail", "na"];
      if (!itemStatus || !validStatuses.includes(itemStatus)) {
        return new Response(`status must be one of: ${validStatuses.join(", ")}`, { status: 400 });
      }
      const existing = await env.GRANT_MANAGER_DB.prepare(
        `SELECT * FROM compliance_checklist WHERE id=?`
      ).bind(itemId).first();
      if (!existing) return new Response("Not found", { status: 404 });
      await env.GRANT_MANAGER_DB.prepare(
        `UPDATE compliance_checklist SET status=?, checked_by=?, checked_at=datetime('now') WHERE id=?`
      ).bind(itemStatus, username, itemId).run();
      await env.GRANT_MANAGER_DB.prepare(
        `INSERT INTO audit_log (compliance_grant_id, event_type, actor, description, before_value, after_value)
         VALUES (?, 'checklist_update', ?, ?, ?, ?)`
      ).bind(
        existing.compliance_grant_id, username,
        `Checklist item "${existing.item}" marked "${itemStatus}"`,
        existing.status, itemStatus,
      ).run();
      return jsonResponse(JSON.stringify({ ok: true }));
    }

    // POST /api/compliance/grants/:id/note
    const noteMatch = url.pathname.match(/^\/api\/compliance\/grants\/(\d+)\/note$/);
    if (noteMatch && request.method === "POST") {
      if (!loggedIn) return new Response("Unauthorized", { status: 401 });
      if (!(await validateCsrf(request, env, username))) {
        log("warn", "csrf_rejected", { ...reqCtx, endpoint: "compliance/note" });
        return new Response("Forbidden", { status: 403 });
      }
      const id = parseInt(noteMatch[1], 10);
      const body = await request.json();
      const { note } = body;
      if (!note || typeof note !== "string" || !note.trim()) {
        return new Response("note required", { status: 400 });
      }
      await env.GRANT_MANAGER_DB.prepare(
        `INSERT INTO audit_log (compliance_grant_id, event_type, actor, description) VALUES (?, 'note_added', ?, ?)`
      ).bind(id, username, note.trim()).run();
      await env.GRANT_MANAGER_DB.prepare(
        `UPDATE compliance_grants SET updated_at=datetime('now') WHERE id=?`
      ).bind(id).run();
      return jsonResponse(JSON.stringify({ ok: true }), { status: 201 });
    }

    // ── End Compliance ────────────────────────────────────────────────────────

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
}

