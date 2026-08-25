import csv
import io
import os
import tempfile

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from .extract import extract_text, find_field_windows
from .normalize import normalize_fields
from .summarize import one_pager_md

app = FastAPI(title="Grant Summarizer")


@app.post("/summarize")
async def summarize(request: Request) -> JSONResponse:
    """Accept raw PDF bytes, return {"csv": "...", "markdown": "..."}."""
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty request body — send raw PDF bytes")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(body)
            tmp_path = tmp.name

        text = extract_text(tmp_path)
        windows = find_field_windows(text)
        row = normalize_fields(windows)

        buf = io.StringIO()
        data = row.model_dump()
        writer = csv.DictWriter(buf, fieldnames=data.keys())
        writer.writeheader()
        writer.writerow(data)
        csv_str = buf.getvalue()

        md_str = one_pager_md(row)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return JSONResponse({"csv": csv_str, "markdown": md_str})


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
