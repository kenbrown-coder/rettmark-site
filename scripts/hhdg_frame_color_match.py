"""
Match HHDG frame color option labels to gallery images using simple color statistics
(center crop, median HSV). Used when Ecwid does not expose Color: alts for every option.

Requires Pillow (pip install Pillow). If unavailable, enrich_product skips this path.
"""
from __future__ import annotations

import colorsys
import math
import os
import re
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    Image = None  # type: ignore[misc, assignment]
    HAS_PIL = False

# Below this score, keep scraped remote URL / download instead of gallery pick.
DEFAULT_SCORE_THRESHOLD = 0.18


def _norm_choice(choice: str) -> str:
    s = (choice or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    return s


def label_color_families(choice: str) -> list[str]:
    """Ordered hints from option text (first match wins for ideals)."""
    k = _norm_choice(choice)
    out: list[str] = []
    rules: list[tuple[str, tuple[str, ...]]] = [
        ("black", ("black", "ebony")),
        ("grey", ("grey", "gray", "pewter", "smoke", "silver", "chrome", "ghost")),
        ("white", ("white", "clear side", "clear shield")),
        ("red", ("red", "ruby", "crimson", "scarlet")),
        ("blue", ("blue", "navy", "sapphire", "aktiveblu", "marine")),
        ("green", ("green", "olive", "jade", "sage")),
        ("tan", ("tan", "fde", "flat dark earth", "coyote", "desert", "harvest")),
        ("brown", ("brown", "chestnut", "chesnut", "tortoise", "horn", "wood")),
        ("gold", ("gold", "goldtone", "bronze", "brass")),
        ("orange", ("orange", "amber")),
        ("purple", ("lavender", "violet", "purple", "plum")),
        ("pink", ("peach", "pink", "coral", "rose")),
        ("camo", ("camo", "woodland")),
        ("crystal", ("crystal", "transparent")),
    ]
    for fam, needles in rules:
        if any(n in k for n in needles):
            out.append(fam)
    if not out and len(k) < 40:
        if "matte" in k or "gloss" in k:
            out.append("black")
    return out


# Ideal (H 0-1, S, V) — H ignored for black/grey/white
_IDEAL_HSV: dict[str, tuple[float | None, float, float]] = {
    "black": (None, 0.12, 0.14),
    "grey": (None, 0.08, 0.42),
    "white": (None, 0.06, 0.92),
    "red": (0.98, 0.55, 0.48),
    "blue": (0.62, 0.5, 0.48),
    "green": (0.33, 0.45, 0.42),
    "tan": (0.08, 0.35, 0.55),
    "brown": (0.06, 0.5, 0.38),
    "gold": (0.12, 0.55, 0.65),
    "orange": (0.06, 0.7, 0.58),
    "purple": (0.78, 0.35, 0.5),
    "pink": (0.92, 0.35, 0.72),
    "camo": (0.28, 0.25, 0.35),
    "crystal": (None, 0.15, 0.75),
}


def _h_dist(a: float, b: float) -> float:
    d = abs(a - b)
    return min(d, 1.0 - d)


def _median(vals: list[float]) -> float:
    if not vals:
        return 0.0
    s = sorted(vals)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


def compute_image_metrics(path: str) -> dict[str, float] | None:
    if not HAS_PIL or not path or not os.path.isfile(path):
        return None
    try:
        with Image.open(path) as im:
            im = im.convert("RGB")
            w, h = im.size
            margin_x = int(w * 0.2)
            margin_y = int(h * 0.2)
            im = im.crop((margin_x, margin_y, w - margin_x, h - margin_y))
            im.thumbnail((160, 160), Image.Resampling.LANCZOS)
            data = list(im.getdata())
    except OSError:
        return None

    hs: list[float] = []
    ss: list[float] = []
    vs: list[float] = []
    r_sum = g_sum = b_sum = 0.0
    n = 0
    for r, g, b in data:
        r_f, g_f, b_f = r / 255.0, g / 255.0, b / 255.0
        h, s, v = colorsys.rgb_to_hsv(r_f, g_f, b_f)
        # de-emphasize near-white background
        if v > 0.94 and s < 0.08:
            continue
        hs.append(h)
        ss.append(s)
        vs.append(v)
        r_sum += r
        g_sum += g
        b_sum += b
        n += 1

    if n < 30:
        for r, g, b in data[::2]:
            r_f, g_f, b_f = r / 255.0, g / 255.0, b / 255.0
            h, s, v = colorsys.rgb_to_hsv(r_f, g_f, b_f)
            hs.append(h)
            ss.append(s)
            vs.append(v)
        r_sum = sum(p[0] for p in data)
        g_sum = sum(p[1] for p in data)
        b_sum = sum(p[2] for p in data)
        n = len(data)

    tot = r_sum + g_sum + b_sum + 1e-6
    return {
        "h_med": _median(hs),
        "s_med": _median(ss),
        "v_med": _median(vs),
        "r_frac": r_sum / tot,
        "g_frac": g_sum / tot,
        "b_frac": b_sum / tot,
    }


def score_label_vs_metrics(families: list[str], m: dict[str, float]) -> float:
    if not families or not m:
        return 0.0
    best = 0.0
    for fam in families:
        ideal = _IDEAL_HSV.get(fam)
        if not ideal:
            continue
        ih, isat, iv = ideal
        h_med, s_med, v_med = m["h_med"], m["s_med"], m["v_med"]
        if ih is None:
            dh = 0.0
        else:
            dh = _h_dist(h_med, ih)
        ds = abs(s_med - isat)
        dv = abs(v_med - iv)
        dist = math.sqrt(dh * dh * 4 + ds * ds + dv * dv)
        score = 1.0 / (1.0 + dist * 3.5)
        # channel hints
        if fam == "red" and m["r_frac"] > m["b_frac"] + 0.08:
            score += 0.08
        if fam == "blue" and m["b_frac"] > m["r_frac"] + 0.06:
            score += 0.08
        if fam == "green" and m["g_frac"] > m["r_frac"] + 0.05 and m["g_frac"] > m["b_frac"]:
            score += 0.06
        if fam == "black" and m["v_med"] < 0.32 and m["s_med"] < 0.35:
            score += 0.12
        if fam == "grey" and 0.22 < m["v_med"] < 0.62 and m["s_med"] < 0.22:
            score += 0.1
        best = max(best, min(1.0, score))
    return best


def pick_best_gallery_for_choice(
    choice: str,
    gallery_rels: list[str],
    used: set[str],
    img_dir: str,
    *,
    threshold: float = DEFAULT_SCORE_THRESHOLD,
) -> tuple[str | None, float]:
    """
    Return (best_relative_path, score). Score < threshold means caller should fall back.
    """
    if not HAS_PIL or not gallery_rels:
        return None, 0.0
    families = label_color_families(choice)
    if not families:
        return None, 0.0

    best_rel: str | None = None
    best_sc = 0.0
    for rel in gallery_rels:
        if rel in used:
            continue
        base = rel.split("/")[-1]
        path = os.path.join(img_dir, base)
        m = compute_image_metrics(path)
        if not m:
            continue
        sc = score_label_vs_metrics(families, m)
        if sc > best_sc:
            best_sc = sc
            best_rel = rel

    if best_sc < threshold:
        return None, best_sc
    return best_rel, best_sc


def assign_frame_choices_from_gallery_color(
    choices: list[str],
    gallery_rels: list[str],
    img_dir: str,
    *,
    threshold: float = DEFAULT_SCORE_THRESHOLD,
) -> dict[str, str]:
    """
    Greedy assignment: each choice grabs best unused gallery image by color score.
    """
    if not HAS_PIL or len(choices) < 2 or len(gallery_rels) < 2:
        return {}
    used: set[str] = set()
    out: dict[str, str] = {}
    for choice in choices:
        rel, sc = pick_best_gallery_for_choice(
            choice, gallery_rels, used, img_dir, threshold=threshold
        )
        if rel:
            out[choice] = rel
            used.add(rel)
    return out
