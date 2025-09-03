#!/usr/bin/env python3
"""Expose ``wrangle_grants.py`` as a simple HTTP API."""

from flask import Flask, jsonify
import pandas as pd
from pathlib import Path
from wrangle_grants import main as wrangle_main

app = Flask(__name__)


@app.route("/api/wrangle", methods=["GET"])
def api_wrangle() -> tuple:
    """Run the grant wrangler and return the master dataset as JSON."""
    try:
        wrangle_main(["--input", "data/csvs", "--out", "out/master.csv"])
    except SystemExit as exc:  # ``wrangle_grants`` uses ``SystemExit`` on error
        return jsonify({"error": str(exc)}), 400

    csv_path = Path("out/master.csv")
    if not csv_path.exists():
        return jsonify({"error": "wrangle output not found"}), 500

    df = pd.read_csv(csv_path)
    return jsonify(df.to_dict(orient="records"))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
