"""
Prune js/hhdg-frames.json to assets/hhdg files that exist on disk, then regenerate
HHDG PDP HTML and shooting-glasses.html. Run after manually deleting images.

  python scripts/sync_hhdg_assets.py

Optional: delete disk files not referenced in JSON (same as build -- assets-only prune):

  python scripts/sync_hhdg_assets.py --prune-orphans
"""
from __future__ import annotations

import json
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from build_hhdg_catalog import write_shooting_page
from hhdg_assets_util import (
    JSON_PATH,
    HHDG_DIR,
    load_products_from_json,
    prune_orphan_hhdg_files,
    sync_product,
)
from hhdg_pdp import render_product_html

ROOT = os.path.dirname(_SCRIPT_DIR)


def main() -> None:
    prune = "--prune-orphans" in sys.argv
    payload, products = load_products_from_json()
    all_warnings: list[str] = []

    for p in products:
        all_warnings.extend(sync_product(p, ROOT, HHDG_DIR))

    if prune:
        removed = prune_orphan_hhdg_files(products, HHDG_DIR, dry_run=False)
        print("pruned orphan files:", len(removed))
        for n in sorted(removed)[:40]:
            print(" ", n)
        if len(removed) > 40:
            print(" ", f"... and {len(removed) - 40} more")

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print("wrote", JSON_PATH)

    for p in products:
        lp = (p.get("localPage") or "").strip()
        if not lp:
            continue
        page_out = os.path.join(ROOT, lp)
        with open(page_out, "w", encoding="utf-8", newline="\n") as wf:
            wf.write(render_product_html(p))
        print("PDP", lp)

    write_shooting_page(products)

    if all_warnings:
        print("\nWarnings:")
        for w in all_warnings:
            print(" ", w)
    else:
        print("No missing-image warnings.")


if __name__ == "__main__":
    main()
