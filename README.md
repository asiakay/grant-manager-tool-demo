# grant-manager-tool-demo

Utility repository containing `wrangle_grants.py` for merging and normalizing grant CSV/TSV files.
An optional `wrangle_grants_gui.py` provides a minimal Tkinter interface to run the wrangler without the command line.

See [README_wrangle_grants.md](README_wrangle_grants.md) for usage instructions.

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
4. (Optional) Initialize a Node project and install dependencies for the
   Cloudflare Worker example:

   ```bash
   npm init -y
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
To deploy:

```bash
npm install            # install wrangler locally
npm run deploy        # publishes worker.js using wrangler.toml
=======
npm install -g wrangler  # one-time install
wrangler publish         # deploys worker.js using wrangler.toml
```

The worker responds with a simple HTML page confirming that the service is alive.
It can be extended to invoke the Python wrangler or serve a richer UI.


