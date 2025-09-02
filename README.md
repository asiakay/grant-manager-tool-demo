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
4. (Optional) Initialize a Node project:

   ```bash
   npm init -y
   ```

5. (Optional) Install Node dependencies for the Cloudflare Worker example:

   ```bash
   npm install
   ```

After these steps the `wrangle_grants.py` script and the optional Cloudflare
Worker demo can be run using the commands shown below.

## Python environment

The wrangling scripts require Python 3.9+ with `pandas` and `openpyxl`.
Create and activate a virtual environment, then install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Cloudflare Worker demo

A minimal Cloudflare Worker is provided for quickly publishing a demo endpoint.
The worker includes a basic login page (credentials match the GUI: `admin/adminpass` and
`user/userpass`) and, once logged in, redirects to `/scored` to display the scored
opportunities from a CSV file (`out/master.csv` by default). The data is rendered in a
table and, when the CSV contains `Name` and `Weighted Score` columns, a bar chart is also
shown. If the CSV can't be fetched, the worker falls back to a small built-in sample so the
page isn't blank. Update the `CSV_URL` constant in `worker.js` if your scored CSV is hosted elsewhere.
To deploy:

```bash
npm install            # install wrangler locally
npm run deploy         # publishes worker.js using wrangler.toml
# or with a global install:
# npm install -g wrangler
# wrangler publish
```


