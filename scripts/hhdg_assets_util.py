"""
Shared helpers for HHDG local assets: sync JSON to disk, prune orphans, pick grid images.
"""
from __future__ import annotations

import glob
import json
import os

from hhdg_pdp import is_frame_option_title

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HHDG_DIR = os.path.join(ROOT, "assets", "hhdg")
JSON_PATH = os.path.join(ROOT, "js", "hhdg-frames.json")

_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def asset_exists(root: str, rel: str) -> bool:
    if not rel or not rel.strip():
        return False
    p = rel.replace("/", os.sep)
    full = os.path.join(root, p)
    return os.path.isfile(full)


def main_image_for_pid(hhdg_dir: str, pid: str) -> str | None:
    pattern = os.path.join(hhdg_dir, f"{pid}.*")
    for path in sorted(glob.glob(pattern)):
        base = os.path.basename(path)
        if "_g" in base or "_frame" in base:
            continue
        ext = os.path.splitext(base)[1].lower()
        if ext not in _IMAGE_EXT:
            continue
        return f"assets/hhdg/{base}"
    return None


def any_asset_for_pid(hhdg_dir: str, pid: str) -> str | None:
    for pat in (f"{pid}_frame_*", f"{pid}_g*"):
        paths = sorted(glob.glob(os.path.join(hhdg_dir, pat)))
        if paths:
            return f"assets/hhdg/{os.path.basename(paths[0])}"
    return main_image_for_pid(hhdg_dir, pid)


def sync_product(p: dict, root: str = ROOT, hhdg_dir: str = HHDG_DIR) -> list[str]:
    """Prune missing paths; fill frame/image fallbacks. Mutates p; return warnings."""
    warnings: list[str] = []
    pid = str(p.get("id") or "")

    gl = [x for x in (p.get("galleryLocal") or []) if asset_exists(root, x)]
    p["galleryLocal"] = gl

    fc = {
        k: v
        for k, v in (p.get("frameChoiceImages") or {}).items()
        if asset_exists(root, v)
    }

    fg = next(
        (
            g
            for g in (p.get("optionGroups") or [])
            if is_frame_option_title(g.get("title", ""))
        ),
        None,
    )

    fallback: str | None = None
    if fg:
        for c in fg.get("choices") or []:
            if c in fc:
                fallback = fc[c]
                break
    if not fallback and gl:
        fallback = gl[0]
    if not fallback:
        fallback = main_image_for_pid(hhdg_dir, pid) or any_asset_for_pid(hhdg_dir, pid)

    if fg and fallback:
        for c in fg.get("choices") or []:
            if c not in fc:
                fc[c] = fallback

    p["frameChoiceImages"] = fc

    il = (p.get("imageLocal") or "").strip()
    if not asset_exists(root, il):
        fix = main_image_for_pid(hhdg_dir, pid) or fallback or any_asset_for_pid(hhdg_dir, pid)
        if fix:
            p["imageLocal"] = fix
        else:
            warnings.append(f"{pid} {p.get('title', '')[:40]}: no imageLocal fallback")

    if not asset_exists(root, p.get("imageLocal") or ""):
        warnings.append(
            f"{pid} {p.get('title', '')[:40]}: imageLocal still missing "
            f"({p.get('imageLocal')!r})"
        )

    return warnings


def referenced_hhdg_basenames(products: list[dict]) -> set[str]:
    s: set[str] = set()
    for p in products:
        il = (p.get("imageLocal") or "").strip()
        if il and "hhdg/" in il.replace("\\", "/"):
            s.add(il.replace("\\", "/").split("/")[-1])
        for x in p.get("galleryLocal") or []:
            if x:
                s.add(x.replace("\\", "/").split("/")[-1])
        for x in (p.get("frameChoiceImages") or {}).values():
            if x:
                s.add(x.replace("\\", "/").split("/")[-1])
    return s


def prune_orphan_hhdg_files(
    products: list[dict],
    hhdg_dir: str = HHDG_DIR,
    *,
    dry_run: bool = False,
) -> list[str]:
    """Delete image files in assets/hhdg not referenced by products. Returns deleted basenames."""
    keep = referenced_hhdg_basenames(products)
    deleted: list[str] = []
    if not os.path.isdir(hhdg_dir):
        return deleted
    for name in os.listdir(hhdg_dir):
        path = os.path.join(hhdg_dir, name)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(name)[1].lower()
        if ext not in _IMAGE_EXT:
            continue
        if name in keep:
            continue
        if dry_run:
            deleted.append(name)
            continue
        try:
            os.remove(path)
            deleted.append(name)
        except OSError:
            pass
    return deleted


def load_products_from_json(path: str = JSON_PATH) -> tuple[dict, list[dict]]:
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    return payload, payload.get("products") or []
