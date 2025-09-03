# Cloudflare Worker Demo

This directory contains a tiny Cloudflare Worker exposing two endpoints and a minimal UI.
It is **for demo purposes only** and not intended for production use.

## Endpoints

- `GET /api/health` – returns `{ "ok": true }`
- `POST /api/score` – accepts JSON `{ "value": number }` and returns `{ "score": number }`

## Local development

```bash
npm install
npx wrangler dev --local
# open http://localhost:8787/
```

## Deploy

```bash
npx wrangler deploy
```
