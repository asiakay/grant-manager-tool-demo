# Grant Manager Tool Demo Documentation

## Repository Narrative
This repository demonstrates a complete workflow for collecting, processing, and presenting grant opportunities.

- **Data wrangling and scoring** – `wrangle_grants.py` consolidates raw CSV/TSV files, normalizes values, and computes weighted scores.
- **Command-line tools** – `search_grants.py` queries the Grants.gov API and enriches results.
- **Graphical interface** – `wrangle_grants_gui.py` wraps the wrangler in a Tkinter app with admin and user roles.
- **Browser visualization** – `visualize_grants_web.py` serves wrangled data through a small Flask app with a credential check.
- **Cloudflare Worker demo** – `worker.js` authenticates users, serves scored grants, and tracks lockouts.
- **PDF summarization** – The `grant_summarizer` package extracts key fields from PDFs or HTML and creates Markdown summaries.
- **Supporting documentation** – The repository includes a root README and additional guides under `docs/`.

## Development Environment Setup
1. Install [Python 3.9+](https://www.python.org/downloads/) and [Node.js](https://nodejs.org/).
2. Clone the repository and enter the project directory:
   ```bash
   git clone https://github.com/your-org/grant-manager-tool-demo.git
   cd grant-manager-tool-demo
   ```
3. Create and activate a Python virtual environment, then install dependencies:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```
4. Install Node dependencies for repository tooling:
   ```bash
   npm install
   ```
5. (Optional) Install Worker-specific dependencies:
   ```bash
   cd worker
   npm install
   ```

After setup, the command-line tools and demo interfaces are ready to run.

## Additional Resources
- [Root README](../README.md) – sample dataset walkthrough and feature details.
- [docs/DEVELOPERS.md](DEVELOPERS.md) – backend, worker, and UI extension guidelines.
- [docs/pipeline_vs_direct_write.md](pipeline_vs_direct_write.md) – pipeline vs direct write deployment discussion.
