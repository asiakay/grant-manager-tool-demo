#!/usr/bin/env node
/**
 * Transforms raw grant CSVs (from Grants.gov searches) into the format
 * expected by the admin upload endpoint.
 *
 * Input columns:  Grant Name, Sponsor, Link, Open Date, Deadline, Status
 * Output columns: Name, Sponsor, Source URL, Deadline / Next Cohort,
 *                 Relevance, Fit, Ease, Weighted Score, Non-dilutive?,
 *                 Stack Required?, Cadence, Benefits,
 *                 Eligibility (key conditions), Region / Eligibility,
 *                 Notes / Actions, Stage, Type
 *
 * Usage:
 *   node scripts/transform-csv-for-upload.js <input.csv> [output.csv]
 *
 * If output path is omitted, writes to <input-base>_upload-ready.csv
 */

const fs = require("fs");
const path = require("path");

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node transform-csv-for-upload.js <input.csv> [output.csv]");
  process.exit(1);
}

const outputPath = process.argv[3] || (() => {
  const ext = path.extname(inputPath);
  return inputPath.slice(0, -ext.length) + "_upload-ready" + ext;
})();

// Minimal CSV parser that handles quoted fields with embedded commas/newlines.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { row.push(field); field = ""; }
      else if (ch === '\n') {
        row.push(field); field = "";
        if (row.some(c => c !== "")) rows.push(row);
        row = [];
      } else if (ch === '\r') { /* skip */ }
      else { field += ch; }
    }
  }
  if (field || row.length) { row.push(field); if (row.some(c => c !== "")) rows.push(row); }
  return rows;
}

function csvCell(val) {
  const s = String(val ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const raw = fs.readFileSync(inputPath, "utf8").replace(/^﻿/, "");
const rows = parseCsv(raw);
if (rows.length < 2) {
  console.error("CSV must have a header row and at least one data row.");
  process.exit(1);
}

const inHeaders = rows[0].map(h => h.trim());

// Map input column index by normalized name
const norm = h => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const colIdx = {};
inHeaders.forEach((h, i) => { colIdx[norm(h)] = i; });

const get = (row, ...keys) => {
  for (const k of keys) {
    const i = colIdx[norm(k)];
    if (i !== undefined && row[i] !== undefined) return String(row[i]).trim();
  }
  return "";
};

// Output columns required by the DB schema
const OUT_HEADERS = [
  "Name",
  "Sponsor",
  "Source URL",
  "Deadline / Next Cohort",
  "Cadence",
  "Benefits",
  "Eligibility (key conditions)",
  "Region / Eligibility",
  "Stage",
  "Type",
  "Non-dilutive?",
  "Stack Required?",
  "Relevance",
  "Fit",
  "Ease",
  "Weighted Score",
  "Notes / Actions",
];

const outRows = [OUT_HEADERS];
let skipped = 0;

for (const row of rows.slice(1)) {
  const name = get(row, "Grant Name", "Name", "Program Name");
  if (!name) { skipped++; continue; }

  const deadline = get(row, "Deadline", "Deadline / Next Cohort", "Close Date");
  const status   = get(row, "Status").toLowerCase();

  // Map "forecasted" status → Cadence hint; posted grants leave cadence blank.
  const cadence = status === "forecasted" ? "Forecasted" : "";

  outRows.push([
    name,
    get(row, "Sponsor", "Agency"),
    get(row, "Link", "Source URL", "URL"),
    deadline,
    cadence,
    get(row, "Benefits", "Award", "Award Max"),
    get(row, "Eligibility", "Eligibility (key conditions)", "Eligible Applicants"),
    get(row, "Region", "Region / Eligibility"),
    get(row, "Stage"),
    get(row, "Type"),
    "Yes",   // Non-dilutive — grants.gov grants are non-dilutive by default
    "No",    // Stack Required — unknown, default No
    "0",     // Relevance — to be scored later
    "0",     // Fit
    "0",     // Ease
    "0",     // Weighted Score
    "",      // Notes / Actions
  ]);
}

const csv = outRows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
fs.writeFileSync(outputPath, csv, "utf8");

console.log(`Done.`);
console.log(`  Input rows : ${rows.length - 1}`);
console.log(`  Output rows: ${outRows.length - 1}`);
console.log(`  Skipped    : ${skipped}`);
console.log(`  Written to : ${outputPath}`);
