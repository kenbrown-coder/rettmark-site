#!/usr/bin/env python3
"""
Populate products.json with Condition 1 product URLs + locally downloaded images.

Strategy:
- Fetch Condition 1 collection JSON (Shopify) for a broad catalog list.
- Match each product entry in products.json to a Condition 1 product handle.
- Fetch the matched product's /products/<handle>.json to get canonical image URLs + alt text.
- Download the primary image (or first image) into assets/condition1/.
- Write back:
    sourceProductUrl
    image: { src: "assets/condition1/<handle>.jpg", alt: "<alt text>" }

Run from project root:
  python pull_condition1_images.py
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


def case_number(title: str) -> str | None:
    m = re.search(r"#\s*(\d+)", title)
    return m.group(1) if m else None


def norm(s: str) -> str:
    s = s.lower()
    s = s.replace("&", "and")
    s = s.replace("’", "'")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


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


def fetch_collection_products(collection_handle: str, limit: int = 250, pages: int = 3) -> list[dict]:
    """
    Shopify collection endpoint returns lightweight product objects:
      { id, title, handle, images: [{src, ...}], ... }
    """
    products: list[dict] = []
    for page in range(1, pages + 1):
        url = f"{BASE}/collections/{collection_handle}/products.json?limit={limit}&page={page}"
        data = fetch_json(url)
        batch = data.get("products") or []
        if not batch:
            break
        products.extend(batch)
        time.sleep(0.2)
    return products


def score_match(our_title: str, our_variant: str, cand_title: str) -> int:
    """
    Score a candidate product title. Higher is better.
    We overweight case number and pistol/slot keywords.
    """
    s = 0
    our_t = norm(our_title)
    our_v = norm(our_variant)
    cand_t = norm(cand_title)

    cn = case_number(our_title)
    if cn and cn in cand_t:
        s += 50

    # Length token: 16", 45", etc.
    m = re.match(r"\s*(\d+)\s*\"", our_title)
    if m and m.group(1) in cand_t:
        s += 12

    # Variant hints.
    for token in ("lid organizer", "pluckable", "empty", "standard foam", "pre cut", "precut", "revolver", "trunk"):
        if token in our_v and token in cand_t:
            s += 6

    # Slot/mag counts appear in some titles.
    for token in ("2 pistol", "3 pistol", "4 pistol", "5 pistol", "6 pistol", "7 pistol", "14 pistol", "18 pistol"):
        if token in our_t and token in cand_t:
            s += 10

    # Generic overlap
    overlap = len(set(our_t.split()) & set(cand_t.split()))
    s += min(20, overlap)
    return s


def pick_best_handle(our_title: str, our_variant: str, catalog: list[dict]) -> str | None:
    cn = case_number(our_title)
    cand_list = catalog
    if cn:
        # Filter to likely matches first.
        cand_list = [p for p in catalog if cn in norm(p.get("title", ""))]
        if not cand_list:
            cand_list = catalog

    scored: list[tuple[int, str, str]] = []
    for c in cand_list:
        handle = c.get("handle")
        title = c.get("title", "")
        if not handle or not title:
            continue
        scored.append((score_match(our_title, our_variant, title), handle, title))
    if not scored:
        return None
    scored.sort(reverse=True, key=lambda x: x[0])
    return scored[0][1]


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


def main() -> None:
    raw = json.loads(DATA.read_text(encoding="utf-8"))

    # Broad catalog list for matching handles.
    catalog = fetch_collection_products("all-hard-cases", pages=5)

    updated = 0
    missing = []

    for sec in raw.get("sections", []):
        for p in sec.get("products", []):
            title = p.get("title", "")
            variant = p.get("variant", "")

            # If this offering already has per-color images (style-specific),
            # do not overwrite them with the generic product hero.
            if p.get("colors"):
                updated += 1
                continue

            handle = pick_best_handle(title, variant, catalog)
            if not handle:
                missing.append(f"{title} ({variant})")
                continue

            product_url = f"{BASE}/products/{handle}"
            product_json = fetch_json(product_url + ".json").get("product", {})
            images = product_json.get("images") or []
            if not images:
                missing.append(f"{title} ({variant}) -> {product_url} (no images)")
                continue

            hero = images[0]
            src = hero.get("src")
            alt = hero.get("alt") or title
            if not src:
                missing.append(f"{title} ({variant}) -> {product_url} (no src)")
                continue

            ext = ext_from_url(src)
            out_name = f"{handle}.{ext}"
            out_path = ASSET_DIR / out_name

            # Avoid re-downloading if already exists.
            if not out_path.exists():
                download(src, out_path)
                time.sleep(0.25)

            p["sourceProductUrl"] = product_url
            p["image"] = {
                "src": f"assets/condition1/{out_name}",
                "alt": alt,
            }
            updated += 1

    DATA.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    print(f"Updated {updated} offerings.")
    if missing:
        print("Missing matches:")
        for m in missing:
            print(" - " + m)


if __name__ == "__main__":
    main()

