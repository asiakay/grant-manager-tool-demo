# FoundationPlanner

## 🔗 Live Demo

**[https://grant-manager-tool-demo.asialakaygrady-6d4.workers.dev](https://grant-manager-tool-demo.asialakaygrady-6d4.workers.dev)**

603 non-dilutive grants loaded, personalized scoring live.

> **Demo login:** username `demo` · password `demo`

---

**A data-driven grant discovery and scoring engine for mission-aligned organizations.**
Built on Cloudflare's edge infrastructure. 603 non-dilutive funding opportunities. Personalized match scoring. AI-assisted research. Live in production.

## Screenshots

![Landing page — "Find and win the right grants for your project"](docs/screenshots/landing.png)

![User profile setup — focus areas, org stage, and scoring weights](docs/screenshots/profile-setup.png)

![Scoring weights detail — Relevance weighted at 56%, per-user configurable](docs/screenshots/scoring-weights.png)

![Grant dashboard — 500 grants ranked by personalized match score, with filters and deadline tracking](docs/screenshots/dashboard.png)

---

## The Problem

Community-serving organizations — co-ops, nonprofits, small businesses, workforce programs — find grants through intuition and word of mouth. They miss opportunities, pursue poor fits, and have no systematic way to prioritize. The result is underfunded missions and staff making high-stakes decisions based on incomplete information.

## The Solution

FoundationPlanner replaces guesswork with a weighted, auditable decision framework. Users create an organizational profile — focus area, stage, eligibility, scoring priorities — and the platform ranks non-dilutive funding opportunities by personalized match score in real time.

Every grant in the dataset is non-dilutive. No equity. No repayment. No strings to investors.

---

## What It Does

### Personalized Match Scoring
Each user configures scoring weights across five dimensions: **Relevance**, **Fit**, **Ease**, **Stack Alignment**, and **Deadline Urgency**. The platform ranks all 603 opportunities against that profile on every load. No two users see the same ranked list.

### AI-Assisted Research
The built-in AI assistant analyzes patterns across the full dataset — surfacing non-obvious matches, answering natural language questions about eligibility and fit. Cohort-year duplicates (the same underlying program reposted across years) are now collapsed deterministically by CFDA/Assistance Listing Number rather than relying on the AI to spot them.

### Grant Discovery Pipeline
A full data pipeline runs daily from the Grants.gov XML Extract (full catalog + forecasted opportunities) and the Simpler Grants.gov API, through normalization, scoring, and import into the live dashboard. The pipeline is documented, repeatable, and extensible.

### Workflow Tools
- Live keyword and filter search across all programs, including an award-size range filter (exact `AwardCeiling`/`AwardFloor` from Grants.gov, not text-parsed)
- A "Forecasted (coming soon)" view for opportunities Grants.gov has announced but not yet formally posted — earlier visibility than the live-posted-only view
- Save, hide, and annotate individual opportunities per user
- Export to CSV for grant writing and reporting workflows
- Role-based auth with per-user scoring profiles
- Deadline tracking — 27 opportunities closing within 90 days

---

## Live Product

| Metric | Value |
|---|---|
| Total grants loaded | 603 |
| All non-dilutive | 603 / 603 |
| Top match score | 3.2 |
| Upcoming deadlines (90 days) | 27 |
| Production deployments | 43 |
| Infrastructure | Cloudflare Workers + D1 + KV + R2 |

**[View the live dashboard →](https://grant-manager-tool-demo.asialakaygrady-6d4.workers.dev)**

> **Demo login:** username `demo` · password `demo`

---

## Architecture

```
Grants.gov XML Extract (full daily catalog) ─┐
Grants.gov keyword search (search_grants.py) ─┼→ Python pipeline (wrangle · score) → D1 Database → Cloudflare Worker (Dashboard + API)
Simpler Grants.gov API (in-Worker daily sync)─┘
```
Weights are configurable per user. The scoring profile is stored in KV and applied at query time — not baked into the dataset.

Grants.gov data reaches the `programs` table through two independent, complementary channels:
the [XML Extract](https://www.grants.gov/xml-extract) (`fetch_xml_extract.py`) — the full daily
catalog including forecasted opportunities, structured award/eligibility/CFDA fields, no API
key required — feeding the Python pipeline on a daily GitHub Actions cron; and the Simpler
Grants.gov JSON API (`syncGrantsWithD1` in `worker.js`) — already-authenticated, now paginated
across the full catalog on its own daily Worker cron. Both upsert into the same table, matched
by Grants.gov's stable `opportunity_id` where available, so records from either source update
in place instead of duplicating.

### Stack
- **Runtime:** Cloudflare Workers (edge, zero cold starts)
- **Database:** D1 SQLite — programs schema, 27+ columns (including structured Grants.gov fields: `opportunity_id`, `cfda_numbers`, `eligible_applicants`, `award_ceiling`/`award_floor`, `is_forecast`)
- **Storage:** KV (user profiles, session state) · R2 (PDF documents)
- **AI:** Cloudflare Workers AI — Llama-3-8B via `/api/chat`
- **Data pipeline:** Python 3.9+ (search, XML extract, wrangle, score, summarize)
- **Auth:** PBKDF2-HMAC-SHA256 (600 000 iterations, random salt) via [WebCrypto API](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) · session cookies · login attempt lockout · lazy hash upgrade (SHA-256 legacy hashes are re-hashed on next successful login)

---

## Key Components

### Cloudflare Worker (`worker.js`)
Primary production deployment. Handles authentication, dashboard rendering, user profile management, and grant scoring. Full endpoint reference in [DEVELOPERS.md](docs/DEVELOPERS.md).

### Python Pipeline
Five production-ready CLI tools for data acquisition, normalization, scoring, and PDF summarization. The full pipeline documentation is in [DEVELOPERS.md](docs/DEVELOPERS.md).

```bash
# Acquire — full daily catalog (no query, includes forecasted opportunities)
python fetch_xml_extract.py --output data/csvs/grants_gov_extract.csv

# Acquire — targeted keyword search
python search_grants.py "workforce development" --filter "opportunityStatuses=posted"

# Normalize and merge datasets
python scripts/wrangle_grants.py --input data/csvs --out out/master.csv --print-summary

# Score opportunities
python program_scoring.py out/master.csv --out out/scored.csv

# Load into D1 (one command runs the full pipeline: extract → wrangle → score → import)
make import          # load to remote D1
make import-local    # load to local D1 preview

# Summarize grant PDFs
grant-summarizer --pdf grant.pdf --format all --outdir ./dist
```

The XML Extract sync runs daily via [`.github/workflows/grants-gov-sync.yml`](.github/workflows/grants-gov-sync.yml).

### Scoring Algorithm
```
Score = 0.3×Relevance + 0.3×Fit + 0.2×Ease + 0.1×StackAlignment + 0.1×DeadlineUrgency
```
Weights are configurable per user. The scoring profile is stored in KV and applied at query time — not baked into the dataset.

Full schema definition: [docs/data_contract.json](docs/data_contract.json).

### Admin CSV Upload

Admin users see an **Upload CSV** button on the dashboard that bulk-imports grants
into D1 via `POST /api/admin/upload-csv`. The CSV needs a header row with a `Name`
column; other recognized columns (Type, Sponsor, Source URL, Deadline / Next Cohort,
Benefits, Relevance, Fit, Ease, …) are matched case- and whitespace-insensitively,
and unknown columns are ignored. Two import modes:

- **Merge** (default) — inserts new grants and updates existing ones, matched by Name.
- **Replace** — wipes the `programs` table before importing.

Admins are configured with the `ADMIN_USERS` var in `wrangler.toml`
(comma-separated usernames; defaults to the built-in `demo` account).

---

## Quick Deploy

```bash
# 1. Clone
git clone https://github.com/asiakay/grant-manager-tool-demo
cd grant-manager-tool-demo

# 2. Install dependencies
pip install -r requirements.txt
cd worker && npm install && cd ..

# 3. Configure Cloudflare
wrangler login
wrangler d1 create GRANT_MANAGER_DB
wrangler kv:namespace create USER_PROFILES
wrangler kv:namespace create LOGIN_ATTEMPTS
wrangler r2 bucket create pdf-bucket

# 4. Set credentials as a secret (never in wrangler.toml)
#    USER_HASHES values must be PBKDF2 hashes. Generate one with:
#      node -e "
#        const s=crypto.getRandomValues(new Uint8Array(16));
#        const k=await crypto.subtle.importKey('raw',new TextEncoder().encode('yourpassword'),'PBKDF2',false,['deriveBits']);
#        const d=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:s,iterations:600000},k,256);
#        const h=b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
#        console.log('pbkdf2\$600000\$'+h(s)+'\$'+h(d));
#      "
#    Then: wrangler secret put USER_HASHES
#    Paste: {"admin":"pbkdf2$600000$<salt>$<hash>"}
wrangler secret put USER_HASHES

# 5. Apply migrations and deploy
cd worker
wrangler d1 migrations apply GRANT_MANAGER_DB
npm run deploy
```

Full setup documentation: [DEVELOPERS.md](docs/DEVELOPERS.md)

---

## Roadmap

- **PDF processing pipeline** — A Queue-based worker ([`drafts/pdf_worker.ts`](drafts/pdf_worker.ts)) ingests grant PDFs from R2 via `grant_summarizer` and imports scored rows into D1. Prototyped; pending hosted `GRANT_SUMMARIZER_URL` and Cloudflare Queue provisioning.
- ~~**Grants.gov XML Extract ingestion**~~ — Shipped: `fetch_xml_extract.py` pulls the full daily catalog (including forecasted opportunities) into the same pipeline that already scores and imports keyword-search results, with structured award/eligibility/CFDA fields now surfaced in the UI.

---

## Documentation

| Document | Contents |
|---|---|
| [DEVELOPERS.md](docs/DEVELOPERS.md) | Full pipeline docs, CLI reference, API guide |
| [docs/AGENTS.md](docs/AGENTS.md) | Data pipeline runbook |
| [docs/AGENTS_AUTOMATION.md](docs/AGENTS_AUTOMATION.md) | Automation guide |
| [docs/data_contract.json](docs/data_contract.json) | Database schema and field definitions |
| [docs/pipeline_vs_direct_write.md](docs/pipeline_vs_direct_write.md) | Architecture decision record |

---

## Compliance & Audit Trail

FoundationPlanner includes a built-in compliance module purpose-built for nonprofits that manage restricted funding — grants that may only be spent in specific categories (programming, staffing, equipment) defined by the funder agreement. Misuse of restricted funds is a leading cause of nonprofit audits; this module makes those obligations visible, trackable, and auditable before problems escalate.

### How it works

1. A staff member or admin creates a **Compliance Grant** record for any awarded grant under monitoring. Each record tracks grant name, funder, total award amount, and grant period.

2. **Budget Lines** define the funder-approved spending categories (e.g., "Programming," "Staffing," "Equipment") with allocated and actual-spent amounts. The dashboard visualizes each line with a color-coded spend bar: green when within budget, amber above 80%, red when over 100%. Any over-budget line is surfaced with a warning badge on the grant card.

3. **Compliance Checklist** captures funder requirements — IRS filings, narrative reports, invoices, site visits — as individual line items. Each item can be marked `pending`, `pass`, `fail`, or `n/a`. The checklist tab badge shows the count of failing items at a glance.

4. **Audit Log** records every material change with actor, timestamp, and before/after values. Budget updates, status changes, checklist transitions, and remediation notes all write append-only entries to `audit_log`. The log cannot be edited or deleted — it is a permanent record.

5. Grant **status** moves through a defined lifecycle: `active` → `flagged` → `under_audit` → `resolved`. Each transition writes a timestamped audit event.

6. **Remediation Notes** are free-form annotations attached to a grant (stored as `note_added` audit events). Use them to document corrective actions, funder communications, or board decisions.

### Deployment

The compliance module requires applying migration `0010_compliance.sql` to your D1 database:

```bash
# Apply compliance tables (safe to run on an existing database — uses CREATE TABLE IF NOT EXISTS)
wrangler d1 migrations apply GRANT_MANAGER_DB --remote
```

For local development:
```bash
wrangler d1 migrations apply GRANT_MANAGER_DB --local
```

### Database schema

| Table | Purpose |
|---|---|
| `compliance_grants` | One row per grant under compliance monitoring |
| `budget_lines` | Per-category allocated vs. spent amounts, upserted by category name |
| `compliance_checklist` | Funder requirements with `pending`/`pass`/`fail`/`na` status |
| `audit_log` | Append-only event trail — never updated, only inserted |

### Security

All write endpoints (`POST`/`PATCH`) require:
- A valid session cookie (401 if absent)
- The `X-CSRF-Token` header matching the session's stored token (403 if absent or mismatched)

Read endpoints (`GET`) require a valid session but no CSRF token.

### API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/compliance/grants` | List all grants with budget_line_count and checklist_failures |
| `POST` | `/api/compliance/grants` | Create a new compliance grant |
| `GET` | `/api/compliance/grants/:id` | Full detail: grant + budget lines + checklist + audit log |
| `PATCH` | `/api/compliance/grants/:id` | Update status or grant metadata |
| `POST` | `/api/compliance/grants/:id/budget` | Upsert a budget line by category (case-insensitive) |
| `POST` | `/api/compliance/grants/:id/checklist` | Add a checklist requirement item |
| `PATCH` | `/api/compliance/checklist/:id` | Update a checklist item's status |
| `POST` | `/api/compliance/grants/:id/note` | Add a remediation note to the audit log |

### Tests

Worker-level compliance tests live in `tests/compliance.test.js` and run with `npm run test:worker`. The suite covers:
- Authentication gates (every endpoint)
- CSRF gates (every mutating endpoint)
- Grant CRUD and lifecycle status transitions
- Budget line creation, upsert deduplication, and over-budget detection
- Checklist item management and status validation
- Remediation note creation
- Audit trail completeness (before/after values, actor recording, ordering)
- Full end-to-end lifecycle: create → over-budget → flag → under_audit → resolve

---

## Anonymous Feedback (GitHub Issues)

A persistent feedback widget — available on every page without requiring a GitHub account — that files user reports directly as GitHub issues, with optional screenshot attachments.

### How it works

1. The user clicks the **Feedback** button (bottom-right corner, any page).
2. They fill in a category (Bug Report / Feature Request / General), a message, and optionally their name, email, and a screenshot.
3. The form `POST`s to `/api/anonymous-feedback` as `multipart/form-data`.
4. The Cloudflare Worker:
   - Checks a **KV rate limit** (5 submissions per IP per hour).
   - If a screenshot is attached, **uploads it to R2** and gets a public URL. If R2 upload fails for any reason, the issue is still created without the image.
   - Calls the **GitHub Issues API** (`POST /repos/asiakay/grant-manager-tool-demo/issues`) using the `GITHUB_TOKEN` secret, embedding the screenshot as `![Screenshot](url)` in the Markdown body.
5. The user sees a success confirmation; no GitHub account is needed.

### Setup & deploy

**Required secret**

```bash
# A GitHub personal access token (classic or fine-grained) with repo Issues write permission
wrangler secret put GITHUB_TOKEN
```

**Optional — screenshot uploads**

Screenshots require an R2 bucket with public access enabled and a known public URL:

```bash
# 1. Create the bucket (already provisioned if you see it in wrangler.toml)
wrangler r2 bucket create foundationplanner-feedback-attachments

# 2. Enable public access in the Cloudflare dashboard → R2 → bucket → Settings → Public Access
#    Copy the r2.dev URL (e.g. https://pub-abc123.r2.dev)

# 3. Set the public base URL as a Worker variable
wrangler secret put FEEDBACK_R2_PUBLIC_BASE_URL
# Enter: https://pub-abc123.r2.dev/foundationplanner-feedback-attachments
```

If `FEEDBACK_R2_PUBLIC_BASE_URL` is not set, the widget still works — screenshots are silently skipped and issues are created without images.

### wrangler.toml additions

```toml
# Rate limiting (KV namespace already provisioned)
[[kv_namespaces]]
binding = "FEEDBACK_RATE_LIMIT"
id = "786a52996c0b4ad4884a48fd10d65d82"

# Screenshot storage (R2 bucket already provisioned)
[[r2_buckets]]
binding = "FEEDBACK_ATTACHMENTS"
bucket_name = "foundationplanner-feedback-attachments"
```

### Environment variables / secrets

| Name | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | **Yes** | GitHub PAT with `repo` Issues write scope |
| `FEEDBACK_R2_PUBLIC_BASE_URL` | No | Public base URL of the R2 bucket (enables screenshot embedding) |

### Rate limiting

5 submissions per IP address per hour, enforced via the `FEEDBACK_RATE_LIMIT` KV namespace. Exceeding the limit returns HTTP 429 with a `Retry-After: 3600` header. The counter resets automatically at the top of each hour (KV TTL).

### File upload constraints

- Accepted types: JPEG, PNG, GIF, WebP, AVIF
- Maximum size: 5 MB
- Files stored under `feedback/{timestamp}-{uuid}.{ext}` in the R2 bucket
- Invalid type or oversized files are silently skipped — the issue is still created

### Running tests

```bash
npm run test:worker
# or run just the feedback suite:
npx vitest run tests/anonymous-feedback.test.js
```

---

## The Builder

**Asia Grady** is a cooperative economist, civic technologist, and builder based in Jamaica Plain, Boston. She is developing a portfolio of civic infrastructure projects at the intersection of Afrofuturism, cooperative economics, and community wealth — spanning energy, capital access, civic education, and media. She holds published research in urban economics and AI systems.

This tool was built on personal time, with no institutional support. The IP belongs to its builder.

- [LinkedIn](https://www.linkedin.com/in/asia-lakay-grady/)
- [GitHub](https://github.com/asiakay)

---

## Licensing

This repository is source-available for evaluation purposes. Licensing inquiries welcome.

For partnership discussions or licensing: [LinkedIn](https://www.linkedin.com/in/asia-lakay-grady/)

---

*FoundationPlanner · Jamaica Plain, Boston · 2026*
