# Pipeline vs Direct Write

This guide summarizes the tradeoffs between running the full processing pipeline and writing records directly to the database.

## Grant sources
- **Pipeline** – ingest bulk data from tools like `search_grants.py` or the PDF summarizer to feed an automated scoring run.
- **Direct write** – add a handful of grants manually or from ad‑hoc scripts.

## Cost considerations
- **Pipeline** – uses R2 storage and Cloudflare Queues (`PDF_INGEST`, `SCORE_QUEUE`), incurring per‑request costs but scaling well for batches.
- **Direct write** – avoids queue and storage fees at the expense of manual effort and limited throughput.

## Selection criteria
- Choose the **pipeline** for recurring, high‑volume updates or when automation is required.
- Choose **direct write** for quick prototypes or small datasets where infrastructure costs must be minimal.

## Required configuration variables
- `USER_HASHES` – map of usernames to bcrypt salts and hashes for the demo login.
- `USER_PROFILES` – KV namespace storing weight profiles.
- `PDF_BUCKET` – R2 bucket holding uploaded PDFs and generated summaries.
- `PDF_INGEST` – queue delivering PDF keys to extraction workers.
- `SCORE_QUEUE` – queue for sending extracted rows to scoring workers.
- `EQORE_DB` – D1 database binding containing program records.

These variables are referenced in the pipeline, Worker, or example scripts. Ensure they are configured before choosing an approach.
