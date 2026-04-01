"""
Print each HHDG product's frame colors and the local image path we use for the hero swap.
Run from repo root: python scripts/hhdg_report_frame_images.py

Paste the output (or the lines for one product) into chat when something looks wrong.
"""
from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(ROOT, "js", "hhdg-frames.json")


def main() -> None:
    needle = (sys.argv[1] or "").strip().lower() if len(sys.argv) > 1 else ""

    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)

    for p in data.get("products") or []:
        title = (p.get("title") or "").strip()
        if needle and needle not in title.lower():
            continue
        fmap = p.get("frameChoiceImages") or {}
        if not fmap:
            continue
        pid = p.get("id", "")
        print(f"\n{title}  (id {pid})")
        print(f"  page: {p.get('localPage', '')}")
        for color, path in fmap.items():
            print(f"    {color!r} -> {path}")


if __name__ == "__main__":
    main()
