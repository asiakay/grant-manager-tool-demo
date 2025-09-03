from pathlib import Path
import csv
from .schema import CleanRow


def write_json(row: CleanRow, path: Path) -> None:
    path.write_text(row.model_dump_json(indent=2))


def write_csv(row: CleanRow, path: Path) -> None:
    data = row.model_dump()
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=data.keys())
        writer.writeheader()
        writer.writerow(data)
