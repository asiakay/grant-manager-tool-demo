# grant-manager-tool-demo

Utility repository containing `wrangle_grants.py` for merging and normalizing grant CSV/TSV files.
An optional `wrangle_grants_gui.py` provides a minimal Tkinter interface to run the wrangler without the command line.
The GUI now starts with a simple login screen demonstrating "admin" and
"user" roles.  The admin account can adjust weighting and deadline fields
while the standard user can only choose files and run the wrangler.

Default credentials:

```
username: admin   password: adminpass
username: user    password: userpass
```

See [README_wrangle_grants.md](README_wrangle_grants.md) for usage instructions.

## Sample dataset

A tiny dataset is included under `examples/grants_demo` for quick testing. Run
the wrangler against it to see normalization and scoring in action:

```bash
python wrangle_grants.py --input examples/grants_demo --out out/demo.csv --print-summary
```

This command merges the demo files, computes weighted scores, and writes the
result to `out/demo.csv`.

## Browser visualization

For a quick way to explore wrangled data in your browser, run the small Flask
app:

```bash
python visualize_grants_web.py
```

The page includes a dataset selector letting you switch between
`out/master.csv` (default) and `data/programs.csv`. If the chosen CSV is
missing, the app falls back to tiny sample data so the visualization can still
be demoed.

## Beginner installation

If you're new to Python or Node.js, the following steps walk through a fresh
setup of the project:

1. Install [Python 3.9+](https://www.python.org/downloads/) and
   [Node.js](https://nodejs.org/) if they are not already on your machine.
2. Clone the repository and change into the project directory:

   ```bash
   git clone https://github.com/your-org/grant-manager-tool-demo.git
   cd grant-manager-tool-demo
   ```
3. Create and activate a Python virtual environment, then install the
   dependencies:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
4. (Optional) Install Node dependencies for the Worker demo:

    ```bash
    cd worker
    npm install
    ```

After these steps the `wrangle_grants.py` script and the Worker demo can be run
using the commands shown below.

## Python environment

The wrangling scripts require Python 3.9+ with `pandas` and `openpyxl`.
Create and activate a virtual environment, then install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Live Demo (Worker)

The `worker/` directory contains a small Cloudflare Worker exposing `/api/health` and
`/api/score`, plus a minimal webpage to exercise the API. It is for demonstration only.

### Run locally

```bash
cd worker
npm install
npx wrangler dev --local
# open http://localhost:8787/
```

### Deploy

```bash
npx wrangler deploy
```

### Example request

```bash
curl http://localhost:8787/api/health
```

