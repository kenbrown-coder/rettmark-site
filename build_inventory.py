#!/usr/bin/env python3
"""
Generate inventory.json from products.json (and known bag SKUs).

Run from project root:
  python build_inventory.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PRODUCTS = ROOT / "products.json"
OUT_JSON = ROOT / "inventory.json"
OUT_CSV = ROOT / "inventory.csv"


def csv_safe(s: str) -> str:
    # Keep it simple: no commas/newlines so a basic CSV parser works.
    return " ".join((s or "").replace(",", " ").split())


def main() -> None:
    raw = json.loads(PRODUCTS.read_text(encoding="utf-8"))

    sku_rows: dict[str, str] = {}
    for sec in raw.get("sections", []):
        for p in sec.get("products", []):
            title = p.get("title", "").strip()
            variant = p.get("variant", "").strip()
            for c in (p.get("colors") or []):
                sku = (c.get("sku") or "").strip()
                if sku:
                    color = (c.get("name") or "").strip()
                    desc = f'{title} — {variant} — {color}'.strip(" —")
                    sku_rows[sku] = csv_safe(desc)

    # Bag SKUs currently offered on the site.
    sku_rows.setdefault("45870BK", "Kinetic 2 Pistol Bag — Black")
    sku_rows.setdefault("45870BM", "Kinetic 2 Pistol Bag — Black Multicam")
    sku_rows.setdefault("45870CGBK", "Kinetic 2 Pistol Bag — Bone")
    sku_rows.setdefault("45870SBBK", "Kinetic 2 Pistol Bag — Flat Dark Earth")

    # Default quantities to 0 so you don't accidentally oversell.
    items = {sku: {"qty": 0} for sku in sorted(sku_rows.keys())}
    out = {
        "items": items,
        "notes": {
            "schema": {"qty": "integer >= 0"},
            "meaning": {
                "qty": "On-hand quantity. If qty > 0: In stock. If qty == 0: Backorder (customer pays now; we order to fulfill).",
            },
        },
    }
    OUT_JSON.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    # Spreadsheet-friendly file with descriptions.
    lines = ["sku,qty,description"]
    for sku in sorted(sku_rows.keys()):
        lines.append(f"{sku},0,{sku_rows[sku]}")
    OUT_CSV.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    print(f"Wrote {OUT_JSON.name} and {OUT_CSV.name} with {len(items)} SKUs.")


if __name__ == "__main__":
    main()

