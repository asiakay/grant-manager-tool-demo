# Grant Manager Tool Demo

A comprehensive grant management system for searching, processing, scoring, and visualizing grant opportunities from Grants.gov. This repository combines Python CLI tools, a PDF summarizer package, and Cloudflare Workers infrastructure to create an end-to-end pipeline for grant discovery and evaluation.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fasiakay%2Fgrant-manager-tool-demo)

**Project Status:** Mixed Maturity - Core Python tools and Cloudflare Worker are production-ready. PDF pipeline and end-to-end automation are in development. See [Feature Status](#feature-status) for details

---

## Table of Contents

- [Quick Start](#quick-start)
- [Feature Overview](#feature-overview)
- [Python CLI Tools](#python-cli-tools)
- [Grant Summarizer Package](#grant-summarizer-package)
- [Cloudflare Workers](#cloudflare-workers)
- [UI Components](#ui-components)
- [Installation](#installation)
- [Architecture](#architecture)
- [Feature Status](#feature-status)
- [Documentation](#documentation)
- [Contributing](#contributing)

---

## Quick Start

### Search and Process Grants

```bash
# Search Grants.gov for opportunities
python search_grants.py education --filter opportunityStatuses=posted --output results.tsv --format tsv

# Merge and normalize multiple CSV files
python wrangle_grants.py --input examples/grants_demo --out out/demo.csv --print-summary

# Score programs with weighted algorithm
python program_scoring.py out/demo.csv --out out/scored.csv
```

### Summarize Grant PDFs

```bash
# Install the grant summarizer package
cd grant_summarizer
pip install -e .

# Extract structured data and generate summaries
grant-summarizer --pdf path/to/grant.pdf --format all --outdir ./dist
```

### Deploy Cloudflare Worker

```bash
# Apply database migrations
cd worker
wrangler d1 migrations apply EQORE_DB

# Deploy to Cloudflare
npm run deploy
```

---

## Feature Overview

### Production-Ready Features

- **Grant Search** - Query Grants.gov REST API with keywords and filters
- **Data Wrangling** - Merge and normalize CSV/TSV files with deduplication
- **Program Scoring** - Weighted scoring algorithm for grant opportunities
- **PDF Summarization** - Extract structured data from grant PDFs
- **Cloudflare Worker** - Authentication, dashboard, and API endpoints
- **Database** - D1 SQLite database with programs schema

### Work in Progress

- **Web Visualization** - Flask app with Plotly charts (dependency issues)
- **PDF Processing Pipeline** - Automated PDF upload and summarization
- **End-to-End Automation** - Orchestrated pipeline from search to dashboard

### Experimental

- **AI Chat Interface** - Cloudflare AI integration for grant questions
- **React Components** - Material-UI scoring table (not yet integrated)

---

## Python CLI Tools

### 1. search_grants.py

**Status:** Production Ready

Queries the Grants.gov REST API to search for grant opportunities.

**Features:**
- Keyword search with advanced filters
- SSL certificate validation
- Fetches detailed opportunity synopses
- Exports to CSV or TSV format
- Comprehensive error handling

**Usage:**
```bash
python search_grants.py <keyword> [options]

Options:
  --filter FILTER          API filter (e.g., opportunityStatuses=posted)
  --output FILE            Output file path (default: grants.csv)
  --format {csv,tsv}       Output format (default: csv)
  --debug                  Enable debug logging
```

**Example:**
```bash
python search_grants.py "small business" --filter "opportunityStatuses=posted" --output grants.tsv --format tsv
```

**Dependencies:** pandas, certifi

---

### 2. wrangle_grants.py

**Status:** Production Ready

Merges multiple CSV or TSV files into a unified dataset with normalized headers.

**Features:**
- Union of all headers across files
- Optional deduplication by key column
- Configurable delimiter and encoding
- Strict mode for production validation
- Skip or fail on errors

**Usage:**
```bash
python wrangle_grants.py [options]

Options:
  --input DIR              Input directory with CSV/TSV files
  --out FILE               Output file path
  --pattern PATTERN        File pattern (default: *.csv)
  --dedup-key COLUMN       Column to use for deduplication
  --delimiter CHAR         CSV delimiter (default: ,)
  --encoding ENCODING      File encoding (default: utf-8)
  --strict                 Fail on any error
  --print-summary          Print summary statistics
```

**Example:**
```bash
python wrangle_grants.py --input examples/grants_demo --out out/master.csv --dedup-key "Opportunity Number" --print-summary
```

**Dependencies:** None (standard library only)

---

### 3. program_scoring.py

**Status:** Production Ready

Scores program and accelerator opportunities using a weighted algorithm.

**Features:**
- Stack alignment detection (1.0 if required, 0.2 otherwise)
- Cadence recency scoring (1.0 for rolling deadlines, decay for fixed dates)
- Weighted score formula: `0.3×Relevance + 0.3×Fit + 0.2×Ease + 0.1×StackAlignment + 0.1×CadenceRecency`
- Handles missing or rolling deadlines
- Normalized calculations within 365-day window

**Usage:**
```bash
python program_scoring.py <input.csv> [options]

Options:
  --out FILE               Output file path (default: overwrites input)
```

**Example:**
```bash
python program_scoring.py data/programs.csv --out data/scored.csv
```

**Dependencies:** pandas

---

### 4. visualize_grants_web.py

**Status:** Work in Progress (Dependency Issues)

Flask web application for visualizing grant data with interactive charts.

**Features:**
- Basic authentication (demo credentials: client/demo)
- Dataset switcher (master.csv vs programs.csv)
- Plotly charts for data visualization
- Editable scored opportunities table
- Graceful degradation when Plotly unavailable

**Usage:**
```bash
python visualize_grants_web.py
# Visit http://localhost:5000
```

**Known Issues:**
- Flask not installed in current environment
- Hardcoded secret key (security concern for production)
- Basic session-based auth needs upgrade

**Dependencies:** flask, pandas, plotly

---

### 5. Additional Tools

- **wrangle_grants_gui.py** - Tkinter GUI wrapper with role-based access (admin/user)
- **wrangle_api.py** - Flask API wrapper for programmatic wrangling

---

## Grant Summarizer Package

**Status:** Production Ready (after installation)

A standalone CLI tool that extracts structured data from grant PDFs and generates multiple summary formats.

### Installation

```bash
cd grant_summarizer
pip install -e .
```

This creates the `grant-summarizer` command globally.

### Features

- Extracts 20+ structured fields from grant PDFs
- Deterministic parsing with keyword windows and regex
- Generates three types of markdown summaries:
  - **brief.md** - 5-bullet executive summary
  - **one_pager.md** - 250-400 word narrative
  - **slide_bullets.md** - 10-bullet slide deck
- Offline-first with optional online mode
- Grants.gov API integration for searching

### Usage

```bash
grant-summarizer [options]

Options:
  --pdf PATH               Path to grant PDF file
  --url URL                URL to process (requires --allow-online)
  --search KEYWORD         Search Grants.gov API
  --format {json,csv,md,all}  Output format (default: all)
  --outdir DIR             Output directory (default: .)
  --allow-online           Enable online mode for URLs
  --debug                  Enable debug logging
```

### Examples

```bash
# Summarize a local PDF
grant-summarizer --pdf path/to/TEGL.pdf --format all --outdir ./dist

# Search Grants.gov and summarize results
grant-summarizer --search "workforce development" --allow-online

# Process a URL
grant-summarizer --url https://example.com/grant.pdf --allow-online --outdir ./output
```

### Output Files

- `clean_row.json` - Structured data in JSON format
- `clean_row.csv` - Structured data in CSV format
- `brief.md` - 5-bullet executive summary
- `one_pager.md` - 250-400 word narrative summary
- `slide_bullets.md` - 10-bullet presentation format
- `run.log` - Debug log (when --debug enabled)

### Extracted Fields

The summarizer extracts 20+ fields including:
- Grant name, sponsor organization, CFDA number
- Application deadline, award ceiling/floor
- Eligibility requirements
- Program description and objectives
- Contact information
- Required documentation

### Integration with Pipeline

```bash
# 1. Summarize PDF
grant-summarizer --pdf grant.pdf --format csv --outdir ./dist

# 2. Score the results
python program_scoring.py dist/clean_row.csv --out data/scored.csv

# 3. Import to database (manual via worker /new_schema endpoint)
```

### Test Suite

**Status:** Tests exist but dependencies missing

```bash
# Install test dependencies
pip install pytest

# Run tests
pytest grant_summarizer/tests/
```

**Known Issues:** Import errors due to missing pytest, typer, pdfminer.six, pydantic

---

## Cloudflare Workers

### Architecture

This repository contains **two worker implementations**:

1. **Root Worker** (`worker.js`) - Primary production deployment
2. **TypeScript Worker** (`worker/src/worker.ts`) - Experimental API-focused variant

### Primary Worker (worker.js)

**Status:** Production Ready

The main worker with full authentication, dashboard, and database integration.

#### Features

- **Authentication & Authorization**
  - SHA-256 password hashing
  - Session-based authentication with secure cookies
  - Login attempt tracking with lockout (5 attempts, 5-minute cooldown)
  - Role-based access control (admin/user)

- **Dashboard Interface**
  - View programs table with user-specific weights
  - User profile settings
  - Links to schema (JSON) and data (CSV) exports
  - Test endpoints page for API debugging

- **API Endpoints**
  - `GET /` - Login page or redirect to dashboard
  - `POST /login` - Authentication
  - `GET /dashboard` - Programs dashboard (requires auth)
  - `GET /api/grants` - Scored grants with user weights (requires auth)
  - `GET /schema` - Programs table schema as JSON
  - `GET /data` - Programs table as CSV download
  - `POST /new_schema` - Add new program entry
  - `GET /logout` - Clear session

- **Database Integration**
  - D1 SQLite database with programs table
  - 17 columns including scoring fields
  - Schema defined in `docs/data_contract.json`

- **Storage**
  - KV: `USER_PROFILES` - User-specific scoring weights
  - KV: `LOGIN_ATTEMPTS` - Login attempt tracking
  - R2: `PDF_BUCKET` - PDF document storage
  - Queues: `PDF_INGEST` (consumer), `SCORE_QUEUE` (producer)

#### Configuration

**wrangler.toml** (root):
```toml
name = "grant-demo"
main = "worker/src/worker.ts"
compatibility_date = "2024-05-29"

[[d1_databases]]
binding = "DB"
database_name = "EQORE_DB"
database_id = "85970bbc-3d0b-4922-8ec2-3845f4606201"

[[kv_namespaces]]
binding = "USER_PROFILES"
id = "..."

[[kv_namespaces]]
binding = "LOGIN_ATTEMPTS"
id = "..."

[[r2_buckets]]
binding = "PDF_BUCKET"
bucket_name = "pdf-bucket"

[[queues.consumers]]
queue = "PDF_INGEST"

[[queues.producers]]
queue = "SCORE_QUEUE"
binding = "SCORE_QUEUE"

[vars]
USER_HASHES = '{"admin":"...","user":"..."}'
```

#### Database Schema

```sql
CREATE TABLE programs (
  "Type" TEXT,
  "Name" TEXT PRIMARY KEY,
  "Sponsor" TEXT,
  "Source URL" TEXT,
  "Region / Eligibility" TEXT,
  "Deadline / Next Cohort" TEXT,
  "Cadence" TEXT,
  "Benefits" TEXT,
  "Eligibility (key conditions)" TEXT,
  "Stage" TEXT,
  "Non-dilutive?" TEXT,
  "Stack Required?" TEXT,
  "Relevance" TEXT,
  "Fit" TEXT,
  "Ease" TEXT,
  "Weighted Score" TEXT,
  "Notes / Actions" TEXT
)
```

#### Deployment

```bash
# Apply database migrations
cd worker
wrangler d1 migrations apply EQORE_DB

# Deploy to Cloudflare
npm run deploy

# Or use local development
npm run dev
```

#### User Profile Format

Store in `USER_PROFILES` KV namespace as JSON:

```json
{
  "username": "admin",
  "weights": {
    "Relevance": 0.3,
    "Fit": 0.3,
    "Ease": 0.2,
    "StackAlignment": 0.1,
    "CadenceRecency": 0.1
  }
}
```

---

### TypeScript Worker (worker/src/worker.ts)

**Status:** Experimental

API-focused worker with AI chat and PDF upload capabilities.

#### Features

- **API Endpoints**
  - `GET /api/health` - Health check
  - `POST /api/score` - Simple scoring (doubles input value)
  - `POST /api/chat` - AI chat interface (Cloudflare AI with Llama-3-8B)
  - `POST /upload` - PDF upload (multipart form-data or JSON base64)
  - `GET /pdf/:name` - Retrieve PDF from R2

- **AI Integration**
  - Cloudflare Workers AI binding
  - Llama-3-8B model for chat
  - Session-based conversation history

- **Storage**
  - R2: `PDF_BUCKET` - PDF storage
  - Static assets from `worker/public/` directory

#### Usage

```bash
cd worker
npm run dev
```

**Example API Calls:**

```bash
# Health check
curl https://your-worker.workers.dev/api/health

# Upload PDF
curl -X POST https://your-worker.workers.dev/upload \
  -F "file=@grant.pdf"

# AI Chat
curl -X POST https://your-worker.workers.dev/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is this grant about?"}'

# Get PDF
curl https://your-worker.workers.dev/pdf/grant.pdf
```

---

### PDF Worker (worker/src/pdf_worker.ts)

**Status:** Work in Progress (Incomplete)

Queue consumer for automated PDF processing pipeline.

#### Intended Workflow

1. PDF uploaded to R2 bucket
2. Message sent to `PDF_INGEST` queue
3. pdf_worker processes message:
   - Fetches PDF from R2
   - Sends to grant_summarizer service
   - Stores results (CSV + Markdown) back to R2
   - Optionally triggers scoring via `SCORE_QUEUE`

#### Blockers

- `GRANT_SUMMARIZER_URL` environment variable not configured
- No deployment target for grant_summarizer service
- Integration incomplete

---

## UI Components

### Server-Rendered Components (Production Ready)

Located in `ui/` directory, used by the primary worker:

#### dashboard.js
- Renders programs table with headers and rows
- Shows user profile settings
- Links to schema, data export, and logout

#### login.js
- Simple login form
- Displays demo credentials for testing

#### test_endpoints.js
- API testing interface
- Load grants via `/api/grants` endpoint
- JSON display for debugging

### React Components (Experimental)

#### ScoringTable.jsx

**Status:** Orphaned (Not Integrated)

High-quality React component with Material-UI DataGrid.

**Features:**
- Filterable data grid with deadline and min score filters
- Detail drawer with notes editing
- Action buttons (Mark as Candidate, Add to Watchlist)
- Proper prop validation with PropTypes

**Issues:**
- Not imported or used anywhere
- Missing dependencies (@mui/x-data-grid, React)
- No build configuration

**Recommendation:** Either integrate fully or move to examples/

---

## Installation

### Python Environment

**Requirements:** Python 3.9+

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install core dependencies
pip install -r requirements.txt

# Install grant summarizer
cd grant_summarizer
pip install -e .
cd ..
```

### Node.js Environment

**Requirements:** Node.js 16+

```bash
# Install worker dependencies
cd worker
npm install
cd ..
```

### Cloudflare Setup

1. **Install Wrangler CLI:**
   ```bash
   npm install -g wrangler
   ```

2. **Authenticate:**
   ```bash
   wrangler login
   ```

3. **Create D1 Database:**
   ```bash
   wrangler d1 create EQORE_DB
   ```
   Copy the database ID to `wrangler.toml`

4. **Create KV Namespaces:**
   ```bash
   wrangler kv:namespace create USER_PROFILES
   wrangler kv:namespace create LOGIN_ATTEMPTS
   ```
   Copy the namespace IDs to `wrangler.toml`

5. **Create R2 Bucket:**
   ```bash
   wrangler r2 bucket create pdf-bucket
   ```

6. **Apply Migrations:**
   ```bash
   cd worker
   wrangler d1 migrations apply EQORE_DB
   ```

7. **Deploy:**
   ```bash
   npm run deploy
   ```

---

## Architecture

### Data Flow Pipeline

```
┌─────────────────┐
│  Grants.gov API │
└────────┬────────┘
         │
         v
┌─────────────────┐      ┌──────────────┐
│ search_grants.py│─────>│  Raw CSVs    │
└─────────────────┘      └──────┬───────┘
                                │
                                v
                         ┌──────────────┐
                         │wrangle_grants│
                         └──────┬───────┘
                                │
                                v
                         ┌──────────────┐
                         │ master.csv   │
                         └──────┬───────┘
                                │
         ┌──────────────────────┴──────────────────────┐
         │                                             │
         v                                             v
┌─────────────────┐                           ┌──────────────┐
│ Grant PDFs      │                           │program_scoring│
└────────┬────────┘                           └──────┬───────┘
         │                                           │
         v                                           │
┌─────────────────┐                                  │
│grant-summarizer │                                  │
└────────┬────────┘                                  │
         │                                           │
         v                                           v
┌─────────────────┐                           ┌──────────────┐
│  clean_row.csv  │──────────────────────────>│  scored.csv  │
└─────────────────┘                           └──────┬───────┘
                                                     │
                                                     v
                                              ┌──────────────┐
                                              │ D1 Database  │
                                              │  (programs)  │
                                              └──────┬───────┘
                                                     │
                                                     v
                                              ┌──────────────┐
                                              │Cloudflare    │
                                              │Worker        │
                                              │(Dashboard)   │
                                              └──────────────┘
```

### Component Interactions

```
Python CLI Tools
├── search_grants.py      → Grants.gov API
├── wrangle_grants.py     → File system
├── program_scoring.py    → File system
└── grant_summarizer/     → PDFs, Grants.gov API

Cloudflare Infrastructure
├── worker.js             → D1, KV, R2
├── worker/src/worker.ts  → R2, AI, Static assets
└── pdf_worker.ts         → Queue, R2, External service (incomplete)

UI Components
├── ui/dashboard.js       → Used by worker.js
├── ui/login.js           → Used by worker.js
├── ui/test_endpoints.js  → Used by worker.js
└── ui/ScoringTable.jsx   → Not integrated
```

---

## Feature Status

### Production Ready

| Feature | File | Status | Notes |
|---------|------|--------|-------|
| Grant Search | `search_grants.py` | Ready | No blockers |
| Data Wrangling | `wrangle_grants.py` | Ready | No blockers |
| Program Scoring | `program_scoring.py` | Ready | No blockers |
| PDF Summarizer CLI | `grant_summarizer/` | Ready | Install dependencies first |
| Worker Auth & Dashboard | `worker.js` | Ready | Primary deployment |
| D1 Database | `worker/migrations/` | Ready | Schema applied |
| UI Components | `ui/*.js` | Ready | Used by worker.js |

### Work in Progress

| Feature | File | Status | Blockers |
|---------|------|--------|----------|
| Web Visualization | `visualize_grants_web.py` | WIP | Flask not installed, hardcoded secrets |
| PDF Processing Pipeline | `worker/src/pdf_worker.ts` | WIP | Missing GRANT_SUMMARIZER_URL |
| Test Suite | `grant_summarizer/tests/` | WIP | Dependencies not installed |
| End-to-End Automation | Pipeline scripts | WIP | No orchestration |

### Experimental

| Feature | File | Status | Notes |
|---------|------|--------|-------|
| TypeScript Worker | `worker/src/worker.ts` | Experimental | API-focused variant |
| AI Chat Interface | `worker/src/worker.ts` | Experimental | Cloudflare AI integration |
| React Scoring Table | `ui/ScoringTable.jsx` | Orphaned | Not integrated, missing deps |

### Known Issues

1. **Dependency Gaps:**
   - Flask not installed (blocks visualize_grants_web.py)
   - pytest not installed (blocks grant_summarizer tests)
   - React/MUI not in dependencies (blocks ScoringTable.jsx)

2. **Integration Gaps:**
   - No automated CSV → D1 import
   - pdf_worker → grant_summarizer connection undefined
   - Manual data entry via `/new_schema` endpoint

3. **Security Concerns:**
   - Hardcoded secret key in visualize_grants_web.py
   - USER_HASHES visible in wrangler.toml (should use secrets)

4. **Architecture Confusion:**
   - Dual worker setup (worker.js vs worker/src/worker.ts)
   - Root wrangler.toml points to TypeScript worker but worker.js appears primary

---

## Documentation

### Main Documentation

- [docs/README.md](docs/README.md) - Comprehensive documentation
- [docs/DEVELOPERS.md](docs/DEVELOPERS.md) - Developer guide
- [AGENTS.md](AGENTS.md) - Data pipeline runbook
- [AGENTS_AUTOMATION.md](AGENTS_AUTOMATION.md) - Automation guide
- [PROMPT.md](PROMPT.md) - Grant summarizer specification

### Component Documentation

- [README_wrangle_grants.md](README_wrangle_grants.md) - Wrangling guide
- [grant_summarizer/README.md](grant_summarizer/README.md) - Summarizer docs
- [docs/pipeline_vs_direct_write.md](docs/pipeline_vs_direct_write.md) - Architecture comparison
- [docs/consulting_setup.md](docs/consulting_setup.md) - Consulting setup guide
- [docs/data_contract.json](docs/data_contract.json) - Database schema

### API Reference

**Worker Endpoints:**
- `GET /` - Login page or dashboard redirect
- `POST /login` - Authentication (username, password)
- `GET /dashboard` - Programs table view (authenticated)
- `GET /api/grants` - Scored grants JSON (authenticated)
- `GET /schema` - Programs schema JSON
- `GET /data` - Programs CSV export
- `POST /new_schema` - Add program entry
- `GET /logout` - Clear session

**TypeScript Worker Endpoints:**
- `GET /api/health` - Health check
- `POST /api/score` - Scoring endpoint
- `POST /api/chat` - AI chat (Cloudflare AI)
- `POST /upload` - PDF upload
- `GET /pdf/:name` - PDF retrieval

---

## Contributing

### Development Setup

1. **Fork and clone the repository**
2. **Install dependencies:**
   ```bash
   # Python
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   cd grant_summarizer && pip install -e ".[dev]" && cd ..

   # Node.js
   cd worker && npm install && cd ..
   ```

3. **Run tests:**
   ```bash
   # Python (after installing pytest)
   pytest grant_summarizer/tests/

   # Worker (no tests yet)
   npm test
   ```

4. **Local development:**
   ```bash
   # Python tools
   python search_grants.py --help
   python wrangle_grants.py --help

   # Worker
   cd worker && npm run dev
   ```

### Code Quality

- Use type hints in Python code
- Add docstrings to all functions
- Follow PEP 8 style guide
- Write tests for new features
- Document API endpoints

### Pull Request Process

1. Create feature branch from `main`
2. Make changes with clear commit messages
3. Update documentation
4. Add tests if applicable
5. Submit PR with description

---

## License

See LICENSE file for details.

---

## Support

For issues or questions:
- Open an issue on GitHub
- See documentation in `docs/`
- Check example data in `examples/`

---

## Demo Credentials

**Worker Login:**
- Username: `demo`, Password: `demo`
- Username: `admin`, Password: (see USER_HASHES in wrangler.toml)

**Python GUI:**
- Username: `admin`, Password: `adminpass`
- Username: `user`, Password: `userpass`

**Note:** Change credentials before production deployment.
