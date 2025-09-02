#!/usr/bin/env python3
"""Simple Flask app to visualize grant data in a browser.

The app can render either the ``out/master.csv`` file produced by
``wrangle_grants.py`` or a curated ``data/programs.csv`` file. If neither
exists, it falls back to tiny in-memory data so the page still renders.

Run with ``python visualize_grants_web.py`` and open http://localhost:5000.
Use the drop-down to switch between datasets.
"""

from pathlib import Path

import pandas as pd
import plotly.express as px
from flask import Flask, render_template_string, request, redirect, url_for

app = Flask(__name__)


@app.route("/")
def index():
    dataset = request.args.get("dataset", "master")
    if dataset == "programs":
        data_path = Path("data/programs.csv")
        default_df = pd.DataFrame(
            {
                "Name": ["Sample Program"],
                "Weighted Score": [0],
            }
        )
        x_col, y_col, title = "Name", "Weighted Score", "Weighted Score by Program"
    else:
        data_path = Path("out/master.csv")
        default_df = pd.DataFrame(
            {
                "Grant name": ["Sample Grant A", "Sample Grant B"],
                "Total funding": [50000, 75000],
            }
        )
        x_col, y_col, title = "Grant name", "Total funding", "Total Funding by Grant"

    if data_path.exists():
        df = pd.read_csv(data_path)
    else:
        df = default_df

    if {x_col, y_col}.issubset(df.columns):
        fig = px.bar(df, x=x_col, y=y_col, title=title)
        graph_html = fig.to_html(full_html=False, include_plotlyjs="cdn")
    else:
        graph_html = "<p>No suitable columns to visualize.</p>"

    return render_template_string(
        """
        <html>
            <head><title>Grant Funding Visualization</title></head>
            <body>
                <h1>Grant Funding Visualization</h1>
                <form method="get">
                    <label for="dataset">Dataset:</label>
                    <select id="dataset" name="dataset" onchange="this.form.submit()">
                        <option value="master" {% if dataset=='master' %}selected{% endif %}>master.csv</option>
                        <option value="programs" {% if dataset=='programs' %}selected{% endif %}>programs.csv</option>
                    </select>
                </form>
                {{ graph|safe }}
                <p><a href="{{ url_for('scored') }}">Edit scored opportunities</a></p>
            </body>
        </html>
        """,
        graph=graph_html,
        dataset=dataset,
    )


@app.route("/scored", methods=["GET", "POST"])
def scored():
    """Display and allow editing of scored opportunities."""

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


if __name__ == "__main__":
    app.run(debug=True)
