# grant-manager-tool-demo

Utility repository containing `wrangle_grants.py` for merging and normalizing grant CSV/TSV files.
An optional `wrangle_grants_gui.py` provides a minimal Tkinter interface to run the wrangler without the command line.

See [README_wrangle_grants.md](README_wrangle_grants.md) for usage instructions.

## Cloudflare Worker demo

A minimal Cloudflare Worker is provided for quickly publishing a demo endpoint.
To deploy:

```bash
npm install -g wrangler  # one-time install
wrangler publish         # deploys worker.js using wrangler.toml
```

The worker responds with a simple HTML page confirming that the service is alive.
It can be extended to invoke the Python wrangler or serve a richer UI.
