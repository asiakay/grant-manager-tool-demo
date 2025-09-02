#!/usr/bin/env python3
"""Simple Flask app to visualize grant data in a browser.

The app looks for ``out/master.csv`` produced by ``wrangle_grants.py``.
If it cannot find the file, it falls back to a tiny in-memory dataset so the
page still renders for demo purposes.

Run with ``python visualize_grants_web.py`` and open http://localhost:5000.
"""

from pathlib import Path

try:
    import pandas as pd
except ImportError as exc:  # pragma: no cover - dependency guard
    raise SystemExit("pandas is required to run this script. Install via 'pip install pandas'.") from exc

try:
    import plotly.express as px
except ImportError as exc:  # pragma: no cover - dependency guard
    raise SystemExit("plotly is required to run this script. Install via 'pip install plotly'.") from exc

try:
    from flask import Flask, render_template_string
except ImportError as exc:  # pragma: no cover - dependency guard
    raise SystemExit("Flask is required to run this script. Install via 'pip install flask'.") from exc

app = Flask(__name__)


@app.route("/")
def index():
    data_path = Path("out/master.csv")
    if data_path.exists():
        df = pd.read_csv(data_path)
    else:
        df = pd.DataFrame(
            {
                "Grant name": ["Sample Grant A", "Sample Grant B"],
                "Total funding": [50000, 75000],
            }
        )

    if {"Grant name", "Total funding"}.issubset(df.columns):
        fig = px.bar(df, x="Grant name", y="Total funding", title="Total Funding by Grant")
        graph_html = fig.to_html(full_html=False, include_plotlyjs="cdn")
    else:
        graph_html = "<p>No suitable columns to visualize.</p>"

    return render_template_string(
        """
        <html>
            <head><title>Grant Funding Visualization</title></head>
            <body>
                <h1>Grant Funding Visualization</h1>
                {{ graph|safe }}
            </body>
        </html>
        """,
        graph=graph_html,
    )


if __name__ == "__main__":
    app.run(debug=True)
