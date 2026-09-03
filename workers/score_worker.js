/**
 * ScoringWorker — Cloudflare Queue consumer
 *
 * Third stage of the PDF-ingest pipeline:
 *   ExtractionWorker (drafts/pdf_worker.ts) → SCORE_QUEUE → this worker
 *
 * Queue message body: { file: 'path/to/base.csv' }
 *
 * Per message:
 *   1. Read the extracted CSV from PDF_BUCKET (R2).
 *   2. Parse rows, mapping grant_summarizer CleanRow column names to D1 column names.
 *   3. Fill any missing relevance/fit/ease (0–3) via keyword heuristics.
 *   4. Compute a 0–10 weighted_score using scoring_utils.js.
 *   5. Write the enriched CSV back to PDF_BUCKET as {base}_scored.csv.
 *   6. If GRANT_MANAGER_DB is bound: upsert rows into D1 programs table
 *      with source_channel='pipeline'.
 *
 * Required bindings (workers/score_wrangler.toml):
 *   PDF_BUCKET        R2 bucket
 *   GRANT_MANAGER_DB  D1 database (optional — skipped when absent)
 *
 * Required queue consumer (workers/score_wrangler.toml):
 *   [[queues.consumers]] queue = "grant-score-queue"
 */

import { computeScore, computeStackAlignment, computeCadenceRecency, DEFAULT_WEIGHTS } from "./scoring_utils.js";

// ---------------------------------------------------------------------------
// CSV parsing (RFC 4180 — same implementation as worker.js)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Column header normalisation (mirrors worker.js CSV_COLUMN_ALIASES)
// ---------------------------------------------------------------------------

function normalizeHeader(h) {
  return String(h || "").replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, "");
}

// Maps grant_summarizer CleanRow column names and legacy CSV headers to D1 column names.
const CSV_COLUMN_ALIASES = {
  // grant_summarizer CleanRow fields → D1 columns
  "grant_name":           "name",
  "grantname":            "name",
  "sponsor_org":          "sponsor",
  "sponsororg":           "sponsor",
  "link":                 "source_url",
  "sourceurl":            "source_url",
  "app_deadline":         "deadline",
  "appdeadline":          "deadline",
  "award_max":            "benefits",
  "awardmax":             "benefits",
  "partners_notes":       "eligibility_conditions",
  "partnersnotes":        "eligibility_conditions",
  "extra_notes":          "notes",
  "extranotes":           "notes",
  "industries":           "type",
  // Standard export aliases (matches worker.js)
  "easeofuse":            "ease",
  "matchreq%":            "weighted_score",
  "match%":               "weighted_score",
  "region/eligibility":   "region_eligibility",
  "deadline/nextcohort":  "deadline",
  "notes/actions":        "notes",
  "eligibility(keyconditions)": "eligibility_conditions",
  "non-dilutive?":        "non_dilutive",
  "stackrequired?":       "stack_required",
  "weightedscore":        "weighted_score",
  "opportunityid":        "opportunity_id",
  "opportunitynumber":    "opportunity_number",
  "cfdanumbers":          "cfda_numbers",
  "eligibleapplicants":   "eligible_applicants",
  "awardceiling":         "award_ceiling",
  "awardfloor":           "award_floor",
  "isforecast":           "is_forecast",
  "estimatedpostdate":    "estimated_post_date",
  "sourcechannel":        "source_channel",
};

function resolveHeader(h) {
  const norm = normalizeHeader(h);
  return CSV_COLUMN_ALIASES[norm] ?? norm;
}

// ---------------------------------------------------------------------------
// Heuristic scoring (fills relevance/fit/ease when absent in the source CSV)
// ---------------------------------------------------------------------------

// Broad topic keywords for relevance signal.
const RELEVANCE_KEYWORDS = [
  "innovation", "research", "technology", "community", "health", "energy",
  "education", "environment", "economic", "climate", "workforce", "renewable",
  "infrastructure", "housing", "equity", "sustainability",
];

// Eligibility/award-clarity terms that increase fit confidence.
const FIT_KEYWORDS = [
  "nonprofit", "eligible", "award", "funding", "grant", "applicant",
  "organization", "501(c)", "public", "agency", "institution",
];

// Complexity terms that make an application harder (reduce ease).
const COMPLEXITY_KEYWORDS = [
  "compliance", "federal", "procurement", "audit", "certification",
  "matching", "cost-share", "cost share", "indirect cost", "quarterly report",
];

function computeHeuristicScores(row) {
  const text = [
    row.name || "",
    row.benefits || "",
    row.eligibility_conditions || "",
    row.type || "",
    row.notes || "",
  ].join(" ").toLowerCase();

  // Relevance: 1.0 base + 0.25 per keyword hit, capped at 3
  const relevanceHits = RELEVANCE_KEYWORDS.filter(kw => text.includes(kw)).length;
  const relevance = Math.min(3, 1.0 + relevanceHits * 0.25);

  // Fit: 1.0 base + 0.3 per keyword hit, capped at 3
  const fitHits = FIT_KEYWORDS.filter(kw => text.includes(kw)).length;
  const fit = Math.min(3, 1.0 + fitHits * 0.3);

  // Ease: deadline proximity (mirrors computeLiveHeuristicScores in worker.js)
  let ease = 1.5;
  const cadence = String(row.cadence || "").toLowerCase();
  const deadlineRaw = row.deadline || "";
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
    // Complexity penalty (subtract 0.5 per term, floor at 0)
    const complexityHits = COMPLEXITY_KEYWORDS.filter(kw => text.includes(kw)).length;
    ease = Math.max(0, ease - complexityHits * 0.5);
  }

  return {
    relevance: Math.round(relevance * 100) / 100,
    fit:       Math.round(fit       * 100) / 100,
    ease:      Math.round(ease      * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// CSV serialiser (minimal RFC 4180)
// ---------------------------------------------------------------------------

function toCsv(headers, rows) {
  function escapeField(v) {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }
  const lines = [headers.map(escapeField).join(",")];
  for (const row of rows) {
    lines.push(headers.map(h => escapeField(row[h])).join(","));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// D1 upsert
// ---------------------------------------------------------------------------

const D1_COLUMNS = [
  "name", "type", "sponsor", "source_url", "region_eligibility", "deadline",
  "cadence", "benefits", "eligibility_conditions", "stage", "non_dilutive",
  "stack_required", "relevance", "fit", "ease", "weighted_score", "notes",
  "opportunity_id", "opportunity_number", "cfda_numbers", "eligible_applicants",
  "award_ceiling", "award_floor", "is_forecast", "estimated_post_date",
  "source_channel", "last_synced_at",
];

async function upsertToD1(db, row) {
  // Prefer opportunity_id match; fall back to name.
  const hasOpportunityId = row.opportunity_id != null && row.opportunity_id !== "";
  const existingStmt = hasOpportunityId
    ? db.prepare("SELECT id FROM programs WHERE opportunity_id = ?").bind(row.opportunity_id)
    : db.prepare("SELECT id FROM programs WHERE name = ?").bind(row.name);

  const existing = await existingStmt.first();

  const cols = D1_COLUMNS.filter(c => row[c] != null);
  const vals = cols.map(c => row[c]);

  if (existing) {
    const sets = cols.map(c => `${c} = ?`).join(", ");
    await db.prepare(`UPDATE programs SET ${sets} WHERE id = ?`)
      .bind(...vals, existing.id)
      .run();
  } else {
    const placeholders = cols.map(() => "?").join(", ");
    await db.prepare(`INSERT INTO programs (${cols.join(", ")}) VALUES (${placeholders})`)
      .bind(...vals)
      .run();
  }
}

// ---------------------------------------------------------------------------
// Message processor
// ---------------------------------------------------------------------------

async function processMessage(msg, env) {
  const body = typeof msg.body === "string" ? { file: msg.body } : msg.body;
  const fileKey = body?.file;

  if (!fileKey) {
    console.error("score_worker: missing 'file' key in message body", msg.body);
    msg.ack();
    return;
  }

  const obj = await env.PDF_BUCKET.get(fileKey);
  if (!obj) {
    console.error(`score_worker: file not found in R2: ${fileKey}`);
    msg.ack();
    return;
  }

  const csvText = await obj.text();
  const rawRows = parseCsv(csvText);
  if (rawRows.length < 2) {
    console.warn(`score_worker: CSV has no data rows: ${fileKey}`);
    msg.ack();
    return;
  }

  const [headerRow, ...dataRows] = rawRows;
  const headers = headerRow.map(resolveHeader);

  const now = new Date().toISOString();
  const scoredRows = [];

  for (const cells of dataRows) {
    const raw = {};
    headers.forEach((h, i) => { raw[h] = cells[i] ?? ""; });

    // Fill heuristic scores when absent or zero.
    const hasDimensions = (
      (parseFloat(raw.relevance) > 0) ||
      (parseFloat(raw.fit) > 0) ||
      (parseFloat(raw.ease) > 0)
    );
    if (!hasDimensions) {
      const h = computeHeuristicScores(raw);
      raw.relevance = h.relevance;
      raw.fit       = h.fit;
      raw.ease      = h.ease;
    }

    // Coerce boolean-ish columns.
    raw.non_dilutive  = raw.non_dilutive  === "1" || raw.non_dilutive  === 1  ? 1 : 0;
    raw.stack_required = raw.stack_required === "1" || raw.stack_required === 1 ? 1 : 0;

    const score = computeScore(raw, DEFAULT_WEIGHTS, null);
    raw.weighted_score  = score;
    raw.source_channel  = "pipeline";
    raw.last_synced_at  = now;

    scoredRows.push(raw);
  }

  // Write scored CSV back to R2.
  const base = fileKey.replace(/\.csv$/i, "");
  const outputKey = `${base}_scored.csv`;
  const allOutputHeaders = [...new Set([...headers, "relevance", "fit", "ease", "weighted_score", "source_channel", "last_synced_at"])];
  const scoredCsv = toCsv(allOutputHeaders, scoredRows);
  await env.PDF_BUCKET.put(outputKey, scoredCsv, { httpMetadata: { contentType: "text/csv" } });
  console.log(`score_worker: wrote ${scoredRows.length} scored rows to ${outputKey}`);

  // Upsert to D1 when binding is available.
  if (env.GRANT_MANAGER_DB) {
    let upserted = 0;
    for (const row of scoredRows) {
      if (!row.name) continue;
      try {
        await upsertToD1(env.GRANT_MANAGER_DB, row);
        upserted++;
      } catch (err) {
        console.error(`score_worker: D1 upsert failed for row '${row.name}'`, err);
      }
    }
    console.log(`score_worker: upserted ${upserted}/${scoredRows.length} rows to D1`);
  }

  msg.ack();
}

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      try {
        await processMessage(msg, env);
      } catch (err) {
        console.error("score_worker: unhandled error processing message", err);
        msg.retry();
      }
    }
  },
};
