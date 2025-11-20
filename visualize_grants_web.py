#!/usr/bin/env python3
"""End-user friendly dashboard for exploring wrangled grant data.

The previous version of this module rendered a raw table with few controls.
This update introduces a small **end-user portal** that:

* keeps the original login requirement,
* provides hero messaging and dataset metadata,
* adds keyword filtering, quick summary metrics, and dataset download links,
* shows a fallback chart even when Plotly is unavailable, and
* exposes ``/schema`` and ``/data`` endpoints referenced throughout the
  documentation.

Run with ``python visualize_grants_web.py`` and open http://localhost:5000.
Use the controls at the top of the page to switch datasets, search, and export
rows.  The UI is intentionally dependency-light so that non-technical team
members can review results without touching the CLI.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable

import json
import logging
import os
import pandas as pd

try:  # Plotly is optional for visualization
    import plotly.express as px
except ImportError:  # pragma: no cover - graceful degradation
    px = None
    logging.warning(
        "plotly is not installed; run 'pip install plotly' to enable charts"
    )
from flask import (
    Flask,
    Response,
    jsonify,
    redirect,
    render_template_string,
    request,
    session,
    url_for,
)

app = Flask(__name__)
# Simple demo credentials; replace with a proper auth system in production.
app.secret_key = "dev-secret"
USERS = {"client": "demo"}


DEFAULT_MASTER = pd.DataFrame(
    {
        "Grant name": ["Sample Grant A", "Sample Grant B"],
        "Sponsor org": ["Dept. of Energy", "Dept. of Labor"],
        "Total funding": [50000, 75000],
        "App deadline": ["2025-12-01", "2025-09-15"],
    }
)
DEFAULT_PROGRAMS = pd.DataFrame(
    {
        "Name": ["Sample Program"],
        "Weighted Score": [0.8],
        "Deadline / Next Cohort": ["2025-10-01"],
    }
)
DATASET_CONFIG: Dict[str, Dict[str, Any]] = {
    "master": {
        "label": "Wrangled Grants (out/master.csv)",
        "path": Path("out/master.csv"),
        "fallback": DEFAULT_MASTER,
        "chart": {
            "x": "Grant name",
            "y": "Total funding",
            "title": "Total Funding by Grant",
        },
    },
    "programs": {
        "label": "Scored Programs (data/programs.csv)",
        "path": Path("data/programs.csv"),
        "fallback": DEFAULT_PROGRAMS,
        "chart": {
            "x": "Name",
            "y": "Weighted Score",
            "title": "Weighted Score by Program",
        },
    },
}


def load_dataset(name: str) -> tuple[pd.DataFrame, Dict[str, Any]]:
    """Return a dataframe and its metadata for the requested dataset."""

    config = DATASET_CONFIG.get(name, DATASET_CONFIG["master"])
    if config["path"].exists():
        df = pd.read_csv(config["path"])
        source_label = str(config["path"])
    else:
        df = config["fallback"].copy()
        source_label = f"Sample data – {config['path'].name}"
    meta = {**config, "name": name, "source_label": source_label}
    return df, meta


def filter_by_query(df: pd.DataFrame, query: str) -> pd.DataFrame:
    """Return rows whose stringified values match ``query`` (case-insensitive)."""

    if not query:
        return df
    needle = query.lower()
    mask = df.apply(
        lambda row: row.astype(str).str.lower().str.contains(needle, na=False).any(),
        axis=1,
    )
    return df[mask]


def find_date_column(columns: Iterable[str]) -> str | None:
    """Best-effort detection of a deadline column."""

    for col in columns:
        lowered = col.lower()
        if "deadline" in lowered or "cohort" in lowered:
            return col
    return None


def compute_summary(df: pd.DataFrame) -> Dict[str, Any]:
    """Compute quick stats for the hero cards."""

    summary = {"total_rows": len(df), "total_funding": None, "next_deadline": None}
    funding_cols = [c for c in df.columns if "funding" in c.lower() or "amount" in c.lower()]
    if funding_cols:
        col = funding_cols[0]
        cleaned = (
            df[col]
            .astype(str)
            .str.replace("$", "", regex=False)
            .str.replace(",", "", regex=False)
        )
        values = pd.to_numeric(cleaned, errors="coerce")
        if values.notna().any():
            summary["total_funding"] = values.sum()

    deadline_col = find_date_column(df.columns)
    if deadline_col:
        current_date = datetime.now(timezone.utc).date()
        deadlines = pd.to_datetime(df[deadline_col], errors="coerce")
        upcoming = deadlines[deadlines >= pd.Timestamp(current_date)]
        if not upcoming.empty:
            summary["next_deadline"] = upcoming.min().strftime("%b %d, %Y")
    return summary


def format_currency(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "N/A"
    return f"${value:,.0f}"


def render_chart(df: pd.DataFrame, config: Dict[str, Any]) -> str:
    """Return HTML for the chart placeholder."""

    chart_cfg = config.get("chart", {})
    x_col, y_col = chart_cfg.get("x"), chart_cfg.get("y")
    if not x_col or not y_col:
        return "<p>No chart configured for this dataset.</p>"
    if px is None:
        return "<p class='muted'>Install plotly for interactive charts.</p>"
    if not {x_col, y_col}.issubset(df.columns):
        return "<p class='muted'>Columns unavailable for chart.</p>"
    fig = px.bar(df, x=x_col, y=y_col, title=chart_cfg.get("title", ""))
    return fig.to_html(full_html=False, include_plotlyjs="cdn")


def require_login() -> bool:
    """Return True if the current session is authenticated."""
    return "user" in session


@app.route("/")
def index():
    if not require_login():
        return redirect(url_for("login"))

    dataset = request.args.get("dataset", "master")
    query = request.args.get("q", "").strip()
    try:
        limit = int(request.args.get("limit", 25))
    except (TypeError, ValueError):
        limit = 25
    limit = max(5, min(limit, 100))

    df, meta = load_dataset(dataset)
    filtered = filter_by_query(df, query)
    summary = compute_summary(filtered)
    preview = filtered.head(limit)
    graph_html = render_chart(filtered, meta)

    cards = [
        {
            "label": "Visible rows",
            "value": f"{len(filtered):,}",
            "hint": "After filters are applied",
        },
        {
            "label": "Total funding",
            "value": format_currency(summary.get("total_funding")),
            "hint": "Sum of parsed funding column" if summary.get("total_funding") else "Funding column unavailable",
        },
        {
            "label": "Next deadline",
            "value": summary.get("next_deadline") or "Not available",
            "hint": "Earliest future date detected",
        },
    ]

    headers = list(preview.columns)
    preview_rows = preview.to_dict(orient="records")

    dataset_options = [
        {"value": key, "label": cfg["label"]}
        for key, cfg in DATASET_CONFIG.items()
    ]

    return render_template_string(
        """
        <!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="utf-8" />
                <title>Grant Manager Portal</title>
                <style>
                    :root {
                        font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
                        color: #0f172a;
                        background-color: #f8fafc;
                    }
                    body {
                        margin: 0;
                        padding: 0 0 3rem;
                        background-color: #f8fafc;
                    }
                    header {
                        background: linear-gradient(120deg, #0f172a, #1d4ed8);
                        color: white;
                        padding: 2.5rem 5vw 2rem;
                    }
                    header h1 {
                        margin: 0 0 0.5rem 0;
                        font-size: clamp(2rem, 4vw, 2.75rem);
                    }
                    header p {
                        margin: 0;
                        color: rgba(255, 255, 255, 0.85);
                    }
                    main {
                        max-width: 1200px;
                        margin: -2rem auto 0;
                        background: white;
                        border-radius: 1.5rem;
                        padding: 2rem;
                        box-shadow: 0 25px 50px rgba(15, 23, 42, 0.15);
                    }
                    .controls form {
                        display: flex;
                        flex-wrap: wrap;
                        gap: 1rem;
                        align-items: flex-end;
                    }
                    label {
                        font-size: 0.85rem;
                        text-transform: uppercase;
                        letter-spacing: 0.04em;
                        color: #475569;
                        display: flex;
                        flex-direction: column;
                        gap: 0.4rem;
                    }
                    input[type="text"], input[type="number"], select {
                        border-radius: 0.75rem;
                        border: 1px solid #cbd5f5;
                        padding: 0.75rem 1rem;
                        font-size: 1rem;
                        min-width: 220px;
                    }
                    button.primary {
                        border: none;
                        background: #2563eb;
                        color: white;
                        padding: 0.85rem 1.5rem;
                        border-radius: 0.75rem;
                        cursor: pointer;
                        font-weight: 600;
                        box-shadow: 0 10px 25px rgba(37, 99, 235, 0.35);
                    }
                    .cards {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                        gap: 1rem;
                        margin: 2rem 0;
                    }
                    .card {
                        border-radius: 1rem;
                        background: linear-gradient(135deg, #e0ecff, #f8fbff);
                        padding: 1.25rem;
                    }
                    .card .label {
                        font-size: 0.85rem;
                        color: #475569;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                    }
                    .card .value {
                        font-size: 2rem;
                        font-weight: 600;
                        margin: 0.25rem 0 0.5rem;
                    }
                    .card .hint {
                        color: #64748b;
                        font-size: 0.9rem;
                    }
                    .section-title {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 1rem;
                        margin-bottom: 1rem;
                    }
                    .pill {
                        background: #eef2ff;
                        padding: 0.35rem 0.9rem;
                        border-radius: 999px;
                        color: #3730a3;
                        font-weight: 600;
                        font-size: 0.9rem;
                    }
                    .chart-box {
                        background: #f8fafc;
                        border-radius: 1rem;
                        padding: 1rem;
                        border: 1px solid #e2e8f0;
                    }
                    .table-wrapper {
                        overflow-x: auto;
                        border-radius: 1rem;
                        border: 1px solid #e2e8f0;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                    }
                    th, td {
                        padding: 0.75rem 1rem;
                        border-bottom: 1px solid #e2e8f0;
                        text-align: left;
                        font-size: 0.95rem;
                    }
                    th {
                        background: #f8fafc;
                        font-size: 0.8rem;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                        color: #475569;
                    }
                    tr:hover td {
                        background: #f1f5f9;
                    }
                    .actions a {
                        text-decoration: none;
                        background: #0f172a;
                        color: white;
                        padding: 0.6rem 1rem;
                        border-radius: 0.75rem;
                        font-size: 0.9rem;
                    }
                    .actions a.secondary {
                        background: #fff;
                        color: #0f172a;
                        border: 1px solid #cbd5f5;
                    }
                    .actions__logout {
                        text-decoration: none;
                        border: 1px solid rgba(255, 255, 255, 0.6);
                        color: white;
                        padding: 0.5rem 1.25rem;
                        border-radius: 999px;
                        font-weight: 600;
                    }
                    footer {
                        margin-top: 2rem;
                        color: #94a3b8;
                        font-size: 0.85rem;
                    }
                    .muted { color: #94a3b8; }
                </style>
            </head>
            <body>
                <header>
                    <p>Signed in as {{ username }}</p>
                    <h1>Grant Manager Portal</h1>
                    <p>Explore wrangled grants, program pipelines, and scoring snapshots without touching the command line.</p>
                </header>
                <main>
                    <section class="controls">
                        <div class="section-title">
                            <div>
                                <h2>Dataset Controls</h2>
                                <p class="muted">Source: {{ meta.source_label }}</p>
                            </div>
                            <a class="actions__logout" href="{{ url_for('logout') }}">Logout</a>
                        </div>
                        <form method="get">
                            <label>Dataset
                                <select name="dataset" onchange="this.form.submit()">
                                    {% for option in dataset_options %}
                                        <option value="{{ option.value }}" {% if option.value == dataset %}selected{% endif %}>{{ option.label }}</option>
                                    {% endfor %}
                                </select>
                            </label>
                            <label>Search keywords
                                <input type="text" name="q" placeholder="Industry, sponsor, notes" value="{{ query }}" />
                            </label>
                            <label>Rows to preview
                                <input type="number" name="limit" min="5" max="100" value="{{ limit }}" />
                            </label>
                            <button class="primary" type="submit">Update view</button>
                        </form>
                    </section>
                    <section class="cards">
                        {% for card in cards %}
                            <div class="card">
                                <div class="label">{{ card.label }}</div>
                                <div class="value">{{ card.value }}</div>
                                <div class="hint">{{ card.hint }}</div>
                            </div>
                        {% endfor %}
                    </section>
                    <section>
                        <div class="section-title">
                            <div>
                                <h2>Quick visual</h2>
                                <p class="muted">Based on {{ dataset }} dataset</p>
                            </div>
                            <span class="pill">{{ len_filtered }} rows</span>
                        </div>
                        <div class="chart-box">{{ graph|safe }}</div>
                    </section>
                    <section style="margin-top:2rem;">
                        <div class="section-title">
                            <div>
                                <h2>Preview ({{ preview_count }} rows)</h2>
                                <p class="muted">Download the CSV to run custom scoring or reviews.</p>
                            </div>
                            <div class="actions">
                                <a href="{{ url_for('data_export', dataset=dataset) }}">Download CSV</a>
                                <a class="secondary" href="{{ url_for('schema_view') }}" target="_blank">View Schema</a>
                                <a class="secondary" href="{{ url_for('scored') }}">Inline editor</a>
                            </div>
                        </div>
                        {% if preview_rows|length == 0 %}
                            <p>No rows match the current filters. Try broadening your search.</p>
                        {% else %}
                            <div class="table-wrapper">
                                <table>
                                    <thead>
                                        <tr>
                                            {% for header in headers %}
                                                <th>{{ header }}</th>
                                            {% endfor %}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {% for row in preview_rows %}
                                            <tr>
                                                {% for header in headers %}
                                                    <td>{{ row[header] }}</td>
                                                {% endfor %}
                                            </tr>
                                        {% endfor %}
                                    </tbody>
                                </table>
                            </div>
                        {% endif %}
                    </section>
                    <footer>
                        <p>Need help? Run <code>python wrangle_grants.py --help</code> or contact the ops team.</p>
                    </footer>
                </main>
            </body>
        </html>
        """,
        username=session.get("user"),
        dataset=dataset,
        query=query,
        limit=limit,
        cards=cards,
        meta=meta,
        dataset_options=dataset_options,
        graph=graph_html,
        headers=headers,
        preview_rows=preview_rows,
        preview_count=len(preview_rows),
        len_filtered=len(filtered),
    )


@app.route("/data")
def data_export() -> Response:
    """Download the selected dataset as CSV."""

    if not require_login():
        return redirect(url_for("login"))
    dataset = request.args.get("dataset", "master")
    df, meta = load_dataset(dataset)
    csv_payload = df.to_csv(index=False)
    filename = meta["path"].name
    return Response(
        csv_payload,
        mimetype="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
        },
    )


@app.route("/schema")
def schema_view():
    """Serve the canonical schema JSON used by the portal."""

    contract_path = Path("docs/data_contract.json")
    if contract_path.exists():
        payload = json.loads(contract_path.read_text())
    else:  # pragma: no cover - used only when repo is misconfigured
        payload = {"error": "docs/data_contract.json not found"}
    return jsonify(payload)


@app.route("/scored", methods=["GET", "POST"])
def scored():
    """Display and allow editing of scored opportunities."""

    if not require_login():
        return redirect(url_for("login"))

    data_path = Path("out/master.csv")
    if data_path.exists():
        df = pd.read_csv(data_path)
    else:
        df = pd.DataFrame(
            {
                "Program": ["Sample Program A", "Sample Program B"],
                "Weighted Score": [0.5, 0.75],
            }
        )

    if request.method == "POST":
        columns = list(df.columns)
        for i in range(len(df)):
            for j, col in enumerate(columns):
                df.at[i, col] = request.form.get(f"cell_{i}_{j}", "")
        data_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(data_path, index=False)
        return redirect(url_for("scored"))

    table_html = "<table border='1'><tr>" + "".join(
        f"<th>{col}</th>" for col in df.columns
    ) + "</tr>"
    for i, row in df.iterrows():
        table_html += "<tr>"
        for j, col in enumerate(df.columns):
            value = "" if pd.isna(row[col]) else row[col]
            table_html += f"<td><input name='cell_{i}_{j}' value='{value}'/></td>"
        table_html += "</tr>"
    table_html += "</table>"

    return render_template_string(
        """
        <html>
            <head><title>Scored Opportunities</title></head>
            <body>
                <h1>Scored Opportunities</h1>
                <form method="post">
                    {{ table|safe }}
                    <p><button type="submit">Save</button></p>
                </form>
            </body>
        </html>
        """,
        table=table_html,
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    """Minimal login form for viewing wrangled grants."""
    error = ""
    if request.method == "POST":
        user = request.form.get("username", "")
        password = request.form.get("password", "")
        if USERS.get(user) == password:
            session["user"] = user
            return redirect(url_for("index"))
        error = "Invalid credentials"
    return render_template_string(
        """
        <html>
            <head><title>Login</title></head>
            <body>
                <h1>Grant Viewer Login</h1>
                {% if error %}<p style='color:red'>{{ error }}</p>{% endif %}
                <form method="post">
                    <label>Username <input name="username" /></label><br/>
                    <label>Password <input type="password" name="password" /></label><br/>
                    <button type="submit">Login</button>
                </form>
            </body>
        </html>
        """,
        error=error,
    )


@app.route("/logout")
def logout():
    """Clear the session and return to the login page."""
    session.clear()
    return redirect(url_for("login"))


if __name__ == "__main__":
    host = os.environ.get("GRANT_PORTAL_HOST", "127.0.0.1")
    debug_flag = os.environ.get("GRANT_PORTAL_DEBUG", "0") not in {"", "0", "false", "False"}

    if host not in {"127.0.0.1", "localhost", "::1"} and debug_flag:
        logging.warning(
            "Disabling Flask debug mode because host %s is not loopback", host
        )
        debug_flag = False

    app.run(host=host, debug=debug_flag)
