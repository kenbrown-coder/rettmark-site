#!/usr/bin/env python3
"""
Populate per-case offering color options (and images) in products.json.

For each offering in products.json:
- Use its existing sourceProductUrl (Condition 1 handle) to fetch /products/<handle>.json
- Identify the best matching "Style" option value for our offering variant
- Collect all variants under that style across all colors
- For each color variant, pick its associated image (variant image_id / variant_ids mapping)
- Download that image locally to assets/condition1/
- Write back:
    colors: [{ name, sku, image: {src, alt} }]
    image: set to Black's image when available (so grid thumbnails stay consistent)

Run from project root:
  python pull_condition1_case_colors.py
"""

from __future__ import annotations

import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA = ROOT / "products.json"
ASSET_DIR = ROOT / "assets" / "condition1"
BASE = "https://condition1.com"


def norm(s: str) -> str:
    s = s.lower()
    s = s.replace("&", "and")
    s = s.replace("’", "'")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


def slugify(s: str) -> str:
    s = s.strip().lower()
    s = s.replace("&", "and")
    s = s.replace("×", "x")
    s = s.replace("/", " ")
    s = s.replace("\\", " ")
    s = s.replace("’", "'").replace("“", '"').replace("”", '"')
    s = s.replace('"', "").replace("'", "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "value"


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "rettmark-site (image sync; contact: rettmarkfirearms.com)",
            "Accept": "application/json,text/plain,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
    return json.loads(raw.decode("utf-8"))


def download(url: str, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "rettmark-site (image sync; contact: rettmarkfirearms.com)",
            "Accept": "image/avif,image/webp,image/*,*/*",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    out_path.write_bytes(data)


def ext_from_url(url: str) -> str:
    path = urllib.parse.urlparse(url).path
    m = re.search(r"\.(jpg|jpeg|png|webp)$", path, re.IGNORECASE)
    return (m.group(1) if m else "jpg").lower()


def score_style_match(our_variant: str, style_value: str) -> int:
    """
    Our variants are short ('2 slot & 8 mag', 'Pre-cut w/ lid organizer', 'Pluckable foam', etc.)
    Condition 1 style values are longer. Use token overlap + key phrase boosts.
    """
    o = norm(our_variant)
    s = norm(style_value)
    score = 0

    overlap = len(set(o.split()) & set(s.split()))
    score += overlap

    for token in ("lid organizer", "pluckable", "empty", "standard foam", "pre cut", "precut"):
        if token in o and token in s:
            score += 8

    for token in ("2 slot", "3 slot", "4 slot", "8 mag", "6 mag", "12 mag"):
        if token in o and token in s:
            score += 10

    # If our variant is very generic (e.g. "Pre-cut foam"), prefer a style containing "pre cut"
    if "pre cut foam" in s and ("pre cut" in o or "precut" in o or o == "pre cut foam" or o == "pre cut"):
        score += 4

    return score


def pick_style_value(our_variant: str, option_values: list[str]) -> str | None:
    if not option_values:
        return None
    scored = [(score_style_match(our_variant, v), v) for v in option_values]
    scored.sort(reverse=True, key=lambda x: x[0])
    return scored[0][1]


def main() -> None:
    raw = json.loads(DATA.read_text(encoding="utf-8"))

    updated = 0
    skipped = 0

    for sec in raw.get("sections", []):
        for p in sec.get("products", []):
            src_url = p.get("sourceProductUrl")
            if not src_url:
                skipped += 1
                continue

            handle = src_url.rstrip("/").split("/products/")[-1]
            product = fetch_json(f"{BASE}/products/{handle}.json").get("product", {})

            # Identify option indices for color/style.
            options = product.get("options") or []
            color_idx = None
            style_idx = None
            for i, opt in enumerate(options):
                name = norm(opt.get("name", ""))
                if name == "color":
                    color_idx = i
                if name == "style":
                    style_idx = i

            variants = product.get("variants") or []
            images = product.get("images") or []
            if color_idx is None or style_idx is None or not variants:
                skipped += 1
                continue

            # Decide which style value corresponds to our offering.
            style_values = options[style_idx].get("values") or []
            chosen_style = pick_style_value(p.get("variant", ""), style_values)
            if not chosen_style:
                skipped += 1
                continue

            # Build image lookup by image id and by variant id.
            image_by_id: dict[int, dict] = {}
            image_by_variant: dict[int, dict] = {}
            for im in images:
                iid = im.get("id")
                if isinstance(iid, int):
                    image_by_id[iid] = im
                for vid in im.get("variant_ids") or []:
                    if isinstance(vid, int):
                        image_by_variant[vid] = im

            def variant_option(v: dict, idx: int) -> str:
                return v.get(f"option{idx+1}") or ""

            # Collect variants for this style.
            bucket = []
            for v in variants:
                if variant_option(v, style_idx) != chosen_style:
                    continue
                color = variant_option(v, color_idx)
                sku = v.get("sku") or ""
                vid = v.get("id")
                img = None
                img_id = v.get("image_id")
                if isinstance(img_id, int) and img_id in image_by_id:
                    img = image_by_id[img_id]
                elif isinstance(vid, int) and vid in image_by_variant:
                    img = image_by_variant[vid]
                elif images:
                    img = images[0]
                if not img or not img.get("src"):
                    continue
                bucket.append((color, sku, img))

            if not bucket:
                skipped += 1
                continue

            colors_out = []
            black_image = None

            for color, sku, img in bucket:
                src = img.get("src")
                alt = img.get("alt") or f'{product.get("title","")} ({color})'
                ext = ext_from_url(src)
                out_name = f"{handle}-{slugify(chosen_style)}-{slugify(color)}.{ext}"
                out_path = ASSET_DIR / out_name
                if not out_path.exists():
                    download(src, out_path)
                    time.sleep(0.15)

                entry = {
                    "name": color,
                    "sku": sku,
                    "image": {
                        "src": f"assets/condition1/{out_name}",
                        "alt": alt,
                    },
                }
                colors_out.append(entry)
                if norm(color) == "black":
                    black_image = entry["image"]

            # Stable ordering: Black first, then alpha
            colors_out.sort(key=lambda c: (0 if norm(c["name"]) == "black" else 1, c["name"].lower()))

            p["colors"] = colors_out
            p["chosenStyle"] = chosen_style
            if black_image:
                p["image"] = black_image

            updated += 1

    DATA.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"Updated colors for {updated} offerings. Skipped {skipped}.")


if __name__ == "__main__":
    main()

