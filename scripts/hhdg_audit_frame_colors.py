"""
Compare Ecwid SSR img alt \"Color: …\" URLs to map_frame_choices_to_remote_urls output.

When a product has no \"Color:\" alts in SSR (common), this script cannot detect swapped
block-order colors — use hhdg-frame-gallery-index-overrides.json and spot-check on
huntershdgold.com. Run: python scripts/hhdg_audit_frame_colors.py
"""
from __future__ import annotations

import json
import os
import sys

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)

from hhdg_pdp import (
    extract_img_color_alt_to_url_map,
    fetch_url,
    finalize_option_groups,
    find_explicit_url_for_frame_choice,
    is_frame_option_title,
    map_frame_choices_to_remote_urls,
    pdp_fetch_url_candidates,
    extract_product_option_groups,
    load_frame_image_overrides,
)

ROOT = os.path.dirname(_SCRIPT_DIR)
JSON_PATH = os.path.join(ROOT, "js", "hhdg-frames.json")


def main() -> None:
    with open(JSON_PATH, encoding="utf-8") as f:
        data = json.load(f)
    ref = "https://huntershdgold.com/store/HHDG-Frames-c74140615"
    for p in data.get("products") or []:
        groups = finalize_option_groups(p.get("optionGroups") or [])
        fg = next(
            (g for g in groups if is_frame_option_title(g.get("title", ""))),
            None,
        )
        if not fg or len(fg.get("choices") or []) < 2:
            continue
        href = p.get("href") or ""
        pid = str(p.get("id") or "")
        full = ""
        for attempt in pdp_fetch_url_candidates(href):
            try:
                cand = fetch_url(attempt, referer=ref)
                if cand and "product-details" in cand:
                    full = cand
                    break
            except OSError:
                continue
        if not full:
            print(f"\n{pid} {p.get('title')} — fetch failed")
            continue
        explicit = extract_img_color_alt_to_url_map(full)
        choices = fg["choices"]
        url_ov = load_frame_image_overrides().get(pid, {})
        built = map_frame_choices_to_remote_urls(full, pid, choices, url_ov)
        title = (p.get("title") or "")[:40]
        print(f"\n=== {pid} {title} ({len(choices)} colors, {len(explicit)} explicit alts) ===")
        if explicit:
            for k, u in sorted(explicit.items()):
                print(f"  alt[{k!r}] -> {u.split('/')[-1]}")
        bad = False
        for c in choices:
            exp = find_explicit_url_for_frame_choice(c, explicit)
            got = built.get(c)
            gt = got.split("/")[-1] if got else None
            et = exp.split("/")[-1] if exp else None
            if exp and got != exp:
                print(f"  MISMATCH {c!r}: explicit {et} vs mapped {gt}")
                bad = True
            else:
                print(f"  ok {c!r} -> {gt}")
        if bad:
            print("  ^ fix via hhdg-frame-gallery-index-overrides.json or alt matching")


if __name__ == "__main__":
    main()
