#!/usr/bin/env python3
"""
Fetch inventory CSV from a remote URL and overwrite local inventory.csv.

Expected CSV columns:
  sku,qty[,description]

Usage:
  INVENTORY_CSV_URL="https://..." python scripts/sync_inventory_csv.py
"""

from __future__ import annotations

import csv
import io
import os
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "inventory.csv"


def fetch_text(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "rettmark-inventory-sync",
            "Accept": "text/csv,text/plain,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8-sig")


def validate_csv(text: str) -> str:
    reader = csv.DictReader(io.StringIO(text))
    fields = [f.strip().lower() for f in (reader.fieldnames or [])]
    if "sku" not in fields or "qty" not in fields:
        raise ValueError("CSV must include 'sku' and 'qty' headers.")

    # Normalize output to a clean predictable CSV for diffs.
    has_description = "description" in fields
    out_fields = ["sku", "qty"] + (["description"] if has_description else [])

    out_buf = io.StringIO()
    writer = csv.DictWriter(out_buf, fieldnames=out_fields, lineterminator="\n")
    writer.writeheader()

    seen = 0
    for row in reader:
        sku = (row.get("sku") or "").strip()
        if not sku:
            continue
        qty_raw = (row.get("qty") or "").strip()
        try:
            qty = int(qty_raw)
        except ValueError as e:
            raise ValueError(f"Invalid qty for SKU '{sku}': '{qty_raw}'") from e
        if qty < 0:
            raise ValueError(f"qty must be >= 0 for SKU '{sku}'.")

        out_row = {"sku": sku, "qty": str(qty)}
        if has_description:
            out_row["description"] = (row.get("description") or "").strip()
        writer.writerow(out_row)
        seen += 1

    if seen == 0:
        raise ValueError("CSV has no usable rows.")
    return out_buf.getvalue()


def main() -> int:
    url = os.environ.get("INVENTORY_CSV_URL", "").strip()
    if not url:
        print("Missing INVENTORY_CSV_URL.", file=sys.stderr)
        return 2

    try:
        raw = fetch_text(url)
        normalized = validate_csv(raw)
    except Exception as exc:
        print(f"Inventory sync failed: {exc}", file=sys.stderr)
        return 1

    OUT.write_text(normalized, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

