# Consulting Deployment Setup

This guide outlines how to deploy the grant manager components — data wrangler, web UI, and worker — using Docker and Docker Compose.

## Prerequisites

- Docker and Docker Compose installed
- Git clone of the repository

## Build and Run

1. Build images and start the stack:
   ```bash
   cd examples
   docker compose up --build
   ```
   The data wrangler will process CSV files in `data/` and write outputs to `out/`.

2. Access the services:
   - Web UI: [http://localhost:5000](http://localhost:5000)
   - Worker (Wrangler dev server): [http://localhost:8787](http://localhost:8787)

3. To rerun the wrangler after updating data, restart the `wrangler` service:
   ```bash
   docker compose run --rm wrangler
   ```

The Compose file mounts `../data` and `../out` so changes persist on the host.
