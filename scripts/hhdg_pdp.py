"""Parse Hunters HD Gold product pages and build Rettmark-styled PDP HTML."""
from __future__ import annotations

import functools
import html as html_lib
import json
import os
import re

from hhdg_frame_color_match import (
    HAS_PIL as _HHDG_HAS_PIL,
    DEFAULT_SCORE_THRESHOLD as _HHDG_COLOR_THRESHOLD_DEFAULT,
    pick_best_gallery_for_choice,
)
import unicodedata
import urllib.parse
import urllib.request

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_SCRIPT_DIR)
_FRAME_IMAGE_OVERRIDES_PATH = os.path.join(
    _REPO_ROOT,
    "hhdg-frame-image-overrides.json",
)
_FRAME_GALLERY_INDEX_OVERRIDES_PATH = os.path.join(
    _REPO_ROOT,
    "hhdg-frame-gallery-index-overrides.json",
)

HHDG_RX_ORDERING_URL = "https://huntershdgold.com/ordering/"
HHDG_RX_ORDERING_ANCHOR = (
    f'<a class="contact-link" href="{HHDG_RX_ORDERING_URL}" '
    'target="_blank" rel="noopener noreferrer">Hunters HD Gold ordering</a>'
)
HHDG_RX_REFERRAL_NOTE = (
    " When asked &ldquo;How did you find out about Hunters HD Gold?&rdquo;, "
    "choose <strong>Rettmark Firearms</strong>."
)


@functools.lru_cache(maxsize=1)
def load_frame_image_overrides() -> dict[str, dict[str, str]]:
    """
    Optional per-product overrides: { "430228060": { "Tan": "https://...jpg" } }
    URLs must be full https CloudFront links; they replace scraped picks for that color only.
    """
    if not os.path.isfile(_FRAME_IMAGE_OVERRIDES_PATH):
        return {}
    try:
        with open(_FRAME_IMAGE_OVERRIDES_PATH, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for pid, mp in raw.items():
        if not isinstance(mp, dict):
            continue
        inner: dict[str, str] = {}
        for lab, url in mp.items():
            if isinstance(lab, str) and isinstance(url, str) and url.startswith("http"):
                inner[lab.strip()] = url.strip()
        if inner:
            out[str(pid).strip()] = inner
    return out


@functools.lru_cache(maxsize=1)
def load_frame_gallery_index_overrides() -> dict[str, dict[str, int]]:
    """
    Optional per-product 0-based indices into the Ecwid thumbnail strip (same order as
    huntershdgold.com and as assets/hhdg/{id}_g*. after catalog build). Used when block
    heuristics disagree with Ecwid gallery grouping (e.g. 430228060 Tan/Green, 430222074
    Blue/Red, 430242062 Red/Black).
    """
    if not os.path.isfile(_FRAME_GALLERY_INDEX_OVERRIDES_PATH):
        return {}
    try:
        with open(_FRAME_GALLERY_INDEX_OVERRIDES_PATH, encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, dict[str, int]] = {}
    for pid, mp in raw.items():
        if not isinstance(mp, dict):
            continue
        inner: dict[str, int] = {}
        for lab, val in mp.items():
            if not isinstance(lab, str):
                continue
            n: int | None = None
            if isinstance(val, bool):
                continue
            if isinstance(val, int):
                n = val
            elif isinstance(val, float) and val == int(val):
                n = int(val)
            elif isinstance(val, str) and val.strip().lstrip("-").isdigit():
                n = int(val.strip())
            if n is not None:
                inner[lab.strip()] = n
        if inner:
            out[str(pid).strip()] = inner
    return out


def _apply_frame_gallery_index_overrides(
    idxs: list[int],
    frame_choices: list[str],
    product_id: str,
    pool_len: int,
) -> list[int]:
    if pool_len <= 0:
        return idxs
    ov = load_frame_gallery_index_overrides().get(str(product_id).strip(), {})
    if not ov:
        return idxs
    hi = pool_len - 1
    out = list(idxs)
    for i, choice in enumerate(frame_choices):
        if choice not in ov:
            continue
        idx = max(0, min(int(ov[choice]), hi))
        if i < len(out):
            out[i] = idx
    return out


def ascii_ecwid_store_product_url(href: str) -> str | None:
    """
    Ecwid sometimes 403s canonical store URLs that contain unicode in the slug
    (smart apostrophe, ®, etc.). Rebuild /store/{ascii-slug}-p{id} from the path.
    """
    parsed = urllib.parse.urlparse((href or "").strip())
    path = (parsed.path or "").rstrip("/")
    if "/store/" not in path:
        return None
    leaf = urllib.parse.unquote(path.split("/store/", 1)[-1].split("/")[-1])
    m = re.match(r"(.+)-p(\d+)$", leaf, re.I)
    if not m:
        return None
    base, pid = m.group(1).strip(), m.group(2)
    nk = unicodedata.normalize("NFKD", base)
    ascii_part = "".join(ch for ch in nk if ord(ch) < 128)
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ascii_part).strip("-")
    if not slug:
        return None
    new_leaf = f"{slug}-p{pid}"
    if new_leaf == leaf:
        return None
    scheme = parsed.scheme or "https"
    return urllib.parse.urlunparse((scheme, parsed.netloc, f"/store/{new_leaf}", "", "", ""))


def pdp_fetch_url_candidates(href: str) -> list[str]:
    """Ordered unique URLs to try when polling an HHDG product page."""
    out: list[str] = []
    seen: set[str] = set()

    def add(u: str) -> None:
        u = (u or "").strip()
        if u and u not in seen:
            seen.add(u)
            out.append(u)

    add(href)
    add(href.replace("%E2%80%99", "'"))
    add(href.replace("%E2%80%99", "%27"))
    alt = ascii_ecwid_store_product_url(href)
    if alt:
        add(alt)
    return out


def fetch_url(url: str, referer: str | None = None) -> str:
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }
    if referer:
        headers["Referer"] = referer
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=75) as r:
        return r.read().decode("utf-8", "replace")


def balanced_div_inner(html: str, start_after_open: int) -> str:
    i = start_after_open
    depth = 1
    while i < len(html) and depth > 0:
        nxt = html.find("<div", i)
        clo = html.find("</div>", i)
        if clo == -1:
            break
        if nxt != -1 and nxt < clo:
            depth += 1
            i = nxt + 4
        else:
            depth -= 1
            if depth == 0:
                return html[start_after_open:clo].strip()
            i = clo + 6
    return ""


def extract_description_inner(full_html: str) -> str:
    m = re.search(
        r'<div[^>]*class="[^"]*product-details__product-description[^"]*"[^>]*>',
        full_html,
        re.I,
    )
    if not m:
        return ""
    return balanced_div_inner(full_html, m.end())


def normalize_option_label(s: str) -> str:
    s = html_lib.unescape((s or "").strip())
    s = s.replace("\ufffd", "").strip()
    s = re.sub(r"Hunters HD Gold\s*\W*$", "Hunters HD Gold™", s, flags=re.I)
    s = re.sub(r"Hunters HD Ruby\s*\W*$", "Hunters HD Ruby™", s, flags=re.I)
    s = re.sub(
        r"altive\s*blu\s*\W*$", "AktiveBlu™", s, flags=re.I
    )
    s = re.sub(r"aktive\s*blu\s*\W*$", "AktiveBlu™", s, flags=re.I)
    return s.strip()


STANDARD_LENS_CHOICES: tuple[str, ...] = (
    "Hunters HD Gold™",
    "Hunters HD Ruby™",
    "AktiveBlu™",
)


def finalize_option_groups(groups: list[dict]) -> list[dict]:
    """
    One canonical Hunters HD Gold lens row for every frame product.
    Ecwid radio values sometimes render with mojibake; we always expose the three retail names.
    """
    out: list[dict] = []
    lens_seen = False
    for g in groups:
        if is_lens_option_title(g.get("title", "")):
            if lens_seen:
                continue
            lens_seen = True
            out.append({"title": "Lens", "choices": list(STANDARD_LENS_CHOICES)})
            continue
        out.append(dict(g))

    if not lens_seen:
        insert_at = 0
        for i, g in enumerate(out):
            if is_frame_option_title(g.get("title", "")):
                insert_at = i + 1
        out.insert(insert_at, {"title": "Lens", "choices": list(STANDARD_LENS_CHOICES)})

    return sort_option_groups(out)


def option_display_label(raw_title: str) -> str:
    t = (raw_title or "").strip()
    tl = t.lower()
    if tl == "lens":
        return "Lens color"
    if tl == "color":
        return "Frame color"
    if "color" in tl and "size" in tl:
        return "Frame color / size"
    return t


def is_lens_option_title(raw_title: str) -> bool:
    t = (raw_title or "").strip().lower()
    if t == "lens":
        return True
    if "lens" in t and "choice" in t:
        return True
    if t.startswith("lens ") and t != "lens color":
        return True
    return False


def is_frame_option_title(raw_title: str) -> bool:
    t = (raw_title or "").strip().lower()
    if is_lens_option_title(raw_title):
        return False
    if t == "color" or t.startswith("color /") or ("color" in t and "size" in t):
        return True
    return False


def _frame_match_key(s: str) -> str:
    s = html_lib.unescape((s or "").strip().lower())
    return re.sub(r"\s+", " ", s)


def is_composite_product_overlay(url: str, product_id: str) -> bool:
    """
    Ecwid lifestyle composite (model wearing product) under …/products/{id}/ on CloudFront.
    Omit from on-site galleries; still used in thumb order for frame index overrides.
    """
    return f"/products/{product_id}/" in (url or "")


def _extract_url_from_img_tag(tag: str) -> str | None:
    src_m = re.search(
        r'src="(https://d2j6dbq0eux0bg\.cloudfront\.net[^"]+)"',
        tag,
        re.I,
    )
    if src_m:
        return src_m.group(1).split("?")[0].strip()
    wk = re.search(
        r"-webkit-image-set\(url\((https://d2j6dbq0eux0bg\.cloudfront\.net[^)]+)\)",
        tag,
        re.I,
    )
    if wk:
        return html_lib.unescape(wk.group(1).split("?")[0].strip())
    return None


def extract_img_color_alt_to_url_map(full_html: str) -> dict[str, str]:
    """
    Map normalized color label -> image URL from img alt/title in the gallery region only
    (e.g. 'HHDG B-Raze, Color: Black').
    """
    chunk = product_gallery_html_chunk(full_html) or full_html
    out: dict[str, str] = {}
    for m in re.finditer(r"<img\b[^>]*>", chunk, re.I):
        tag = m.group(0)
        if "Color:" not in tag and "color:" not in tag:
            continue
        combined = ""
        for attr in ("alt", "title"):
            am = re.search(rf'{attr}="([^"]*)"', tag, re.I)
            if am:
                combined += " " + html_lib.unescape(am.group(1))
        cm = re.search(r"Color:\s*(.+)", combined, re.I)
        if not cm:
            continue
        color_fragment = cm.group(1).strip().split(",")[0].strip()
        if not color_fragment:
            continue
        url = _extract_url_from_img_tag(tag)
        if not url:
            continue
        k = _frame_match_key(color_fragment)
        if k and k not in out:
            out[k] = url
    return out


def find_explicit_url_for_frame_choice(
    choice: str, explicit: dict[str, str]
) -> str | None:
    mk = _frame_match_key(choice)
    if mk in explicit:
        return explicit[mk]
    for ek, url in explicit.items():
        if mk == ek:
            return url
        if mk.startswith(ek + " ") or mk.startswith(ek + "("):
            return url
        if ek.startswith(mk + " ") or ek.startswith(mk + "("):
            return url
    return None


def extract_thumb_bar_webkit_urls(full_html: str) -> list[str]:
    """Ordered image URL per gallery thumbnail (matches Ecwid carousel slots)."""
    chunk = product_gallery_html_chunk(full_html)
    if not chunk:
        return []
    thumb_starts = [
        m.start()
        for m in re.finditer(r'<div class="details-gallery__thumb(?:\s|")', chunk)
    ]
    if not thumb_starts:
        return []
    out: list[str] = []
    for i, st in enumerate(thumb_starts):
        end = thumb_starts[i + 1] if i + 1 < len(thumb_starts) else len(chunk)
        block = chunk[st:end]
        wm = re.search(
            r"-webkit-image-set\(url\((https://d2j6dbq0eux0bg\.cloudfront\.net[^)]+)\)",
            block,
            re.I,
        )
        if not wm:
            continue
        u = html_lib.unescape(wm.group(1).split("?")[0].strip())
        lu = u.lower()
        if not lu.endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        if not out or out[-1] != u:
            out.append(u)
    return out


def _thumb_slot_indices_for_colors(
    n_colors: int,
    thumbs: list[str],
    product_id: str,
) -> list[int]:
    """
    Map each frame-color slot to a gallery thumb index (same order as frame_choices).

    Per-color ``Color: …`` URLs from the page are applied separately in
    ``map_frame_choices_to_remote_urls``; this only supplies fallback indices when
    no explicit match exists for a slot.

    For large galleries, Ecwid often lists many angles of the first color before
    the next frame color — so we partition **non-composite** thumbs into blocks
    and take the start of each block. For smaller galleries, use consecutive
    indices (stride only when very many thumbs per color).
    """
    if n_colors <= 0 or not thumbs:
        return []
    m = len(thumbs)
    if n_colors == 1:
        return [0]

    valid = [
        i
        for i, u in enumerate(thumbs)
        if not is_composite_product_overlay(u, product_id)
    ]
    if len(valid) < n_colors:
        valid = list(range(m))
    L = len(valid)
    if m > n_colors * 4:
        return [valid[min(k * L // n_colors, L - 1)] for k in range(n_colors)]
    return _thumb_index_plan(n_colors, m)


def _thumb_index_plan(n_colors: int, pool_len: int) -> list[int]:
    """
    For n frame colors and m gallery thumbs, return the thumb index for each color slot
    (same order as frame_choices). Uses striding only when there are many thumbs per color.
    """
    if n_colors <= 0 or pool_len <= 0:
        return []
    if n_colors == 1:
        return [0]
    if pool_len < n_colors:
        return [min(i, pool_len - 1) for i in range(n_colors)]
    if pool_len > n_colors * 9:
        idxs = [round(i * (pool_len - 1) / (n_colors - 1)) for i in range(n_colors)]
        return [min(max(0, x), pool_len - 1) for x in idxs]
    return list(range(n_colors))


def _resolve_gallery_thumb_at(
    thumbs: list[str], idx: int, product_id: str
) -> str | None:
    """URL at thumbs[idx], or next/previous non-composite overlay if that slot is a bundle hero."""
    if not thumbs or idx < 0:
        return None
    idx = min(idx, len(thumbs) - 1)
    u = thumbs[idx]
    if not is_composite_product_overlay(u, product_id):
        return u
    for j in range(idx + 1, len(thumbs)):
        if not is_composite_product_overlay(thumbs[j], product_id):
            return thumbs[j]
    for j in range(idx - 1, -1, -1):
        if not is_composite_product_overlay(thumbs[j], product_id):
            return thumbs[j]
    return u


def gallery_urls_for_frame_mapping(full_html: str) -> list[str]:
    """
    Canonical gallery image order for frame color mapping and (in enrich_product) downloads.
    Matches Ecwid's visible thumbnail strip order.
    """
    thumbs = extract_thumb_bar_webkit_urls(full_html)
    if not thumbs:
        thumbs = extract_ordered_gallery_webkit_urls(full_html)
    if not thumbs:
        thumbs = extract_all_gallery_media_urls(full_html, max_images=60)
    return thumbs


def map_frame_choices_to_remote_urls(
    full_html: str,
    product_id: str,
    frame_choices: list[str],
    url_overrides: dict[str, str] | None = None,
) -> dict[str, str]:
    """
    Match each frame option label to an image from the polled HHDG product page:
    1) Optional url_overrides (from hhdg-frame-image-overrides.json)
    2) Optional per-color gallery indices (hhdg-frame-gallery-index-overrides.json;
       0-based, same order as Ecwid thumbnail strip — composite overlay is index 0 when present)
    3) img alt/title 'Color: …' in the gallery region
    4) gallery thumbnail strip — block starts when many thumbs, else consecutive
    5) fallback: ordered webkit URLs in the gallery region
    """
    explicit = extract_img_color_alt_to_url_map(full_html)
    thumbs = gallery_urls_for_frame_mapping(full_html)

    n = len(frame_choices)
    m = len(thumbs)
    result: dict[str, str] = {}
    if n == 0:
        return result

    ov = url_overrides or {}
    idxs = _apply_frame_gallery_index_overrides(
        _thumb_slot_indices_for_colors(n, thumbs, product_id),
        frame_choices,
        product_id,
        m,
    )
    for i, choice in enumerate(frame_choices):
        if choice in ov and ov[choice].startswith("http"):
            result[choice] = ov[choice]
            continue
        u_exp = find_explicit_url_for_frame_choice(choice, explicit)
        if u_exp:
            result[choice] = u_exp
        elif i < len(idxs) and m > 0:
            u = _resolve_gallery_thumb_at(thumbs, idxs[i], product_id)
            if u:
                result[choice] = u

    if len(result) < n:
        fallback = extract_ordered_gallery_webkit_urls(full_html)
        m2 = len(fallback)
        if m2 > 0:
            idxs2 = _apply_frame_gallery_index_overrides(
                _thumb_slot_indices_for_colors(n, fallback, product_id),
                frame_choices,
                product_id,
                m2,
            )
            for i, choice in enumerate(frame_choices):
                if choice in result:
                    continue
                if choice in ov and ov[choice].startswith("http"):
                    result[choice] = ov[choice]
                    continue
                if i < len(idxs2):
                    u = _resolve_gallery_thumb_at(fallback, idxs2[i], product_id)
                    if u:
                        result[choice] = u
    if len(result) < n:
        fallback = extract_ordered_gallery_webkit_urls(full_html)
        for i, choice in enumerate(frame_choices):
            if choice in result:
                continue
            if choice in ov and ov[choice].startswith("http"):
                result[choice] = ov[choice]
            elif fallback:
                result[choice] = fallback[min(i, len(fallback) - 1)]

    for choice in frame_choices:
        if choice in ov and ov[choice].startswith("http"):
            result[choice] = ov[choice]
    return result


def extract_ordered_gallery_webkit_urls(full_html: str) -> list[str]:
    """Ordered hero/thumbnail URLs from product gallery (Ecwid -webkit-image-set), deduped."""
    chunk = product_gallery_html_chunk(full_html)
    if not chunk:
        return []
    raw: list[str] = []
    for m in re.finditer(
        r"-webkit-image-set\(url\((https://d2j6dbq0eux0bg\.cloudfront\.net[^)]+)\)",
        chunk,
        re.I,
    ):
        raw.append(html_lib.unescape(m.group(1).split("?")[0].strip()))
    if not raw:
        for m in re.finditer(
            r"background-image:url\((https://d2j6dbq0eux0bg\.cloudfront\.net[^)]+)\)",
            chunk,
            re.I,
        ):
            raw.append(m.group(1).split("?")[0].strip())
    out: list[str] = []
    seen_tail: str | None = None
    for u in raw:
        lu = u.lower()
        if not lu.endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        tail = u.split("/")[-1]
        if tail == seen_tail:
            continue
        seen_tail = tail
        out.append(u)
    return out


def sort_option_groups(groups: list[dict]) -> list[dict]:
    def key(g: dict) -> tuple:
        t = (g.get("title") or "").strip().lower()
        if t == "lens":
            return (2, t)
        if t.startswith("color") or t == "color":
            return (1, t)
        return (3, t)

    return sorted(groups, key=key)


def extract_select_choices(block: str) -> list[str]:
    choices: list[str] = []
    seen: set[str] = set()
    for vm in re.finditer(r'<option value="([^"]*)" label="([^"]*)"', block):
        lab = normalize_option_label(vm.group(2))
        if not lab or "please choose" in lab.lower():
            continue
        if lab not in seen:
            seen.add(lab)
            choices.append(lab)
    return choices


def extract_radio_choices(block: str) -> list[str]:
    """Ecwid radio option rows (e.g. HHDG Marksman) — no <select> / <option>."""
    choices: list[str] = []
    seen: set[str] = set()
    parts = re.split(
        r'(?=<div class="form-control form-control--radio)',
        block,
        flags=re.I,
    )
    for part in parts:
        if "form-control__radio" not in part and 'type="radio"' not in part:
            continue
        lab_m = re.search(
            r'<label[^>]*for="[^"]*"[^>]*>([\s\S]*?)</label>',
            part,
            re.I,
        )
        if lab_m:
            text = re.sub(r"<!---->", "", lab_m.group(1)).strip()
            text = html_lib.unescape(text).strip()
        else:
            vm = re.search(
                r'<input[^>]*type="radio"[^>]*value="([^"]*)"',
                part,
                re.I,
            )
            text = html_lib.unescape(vm.group(1)).strip() if vm else ""
        text = normalize_option_label(text)
        if not text or "please choose" in text.lower():
            continue
        if text not in seen:
            seen.add(text)
            choices.append(text)
    return choices


def extract_product_option_groups(full_html: str) -> list[dict]:
    """Ecwid product-details options: <select> and/or radio lists (Color, Lens, …)."""
    opts_section_m = re.search(
        r'class="[^"]*product-details__product-options[^"]*"',
        full_html,
        re.I,
    )
    if not opts_section_m:
        return []
    start = opts_section_m.start()
    rest = full_html[start:]
    end_m = re.search(
        r'class="[^"]*product-details__product-description',
        rest,
        re.I,
    )
    chunk = rest[: end_m.start() if end_m else 250000]

    module_re = re.compile(
        r'<div class="product-details-module details-product-option(?:\s+details-product-option--[^\s"]+)+"[^>]*>',
        re.I,
    )
    positions = [m.start() for m in module_re.finditer(chunk)]

    groups: list[dict] = []
    for i, pos in enumerate(positions):
        block_end = positions[i + 1] if i + 1 < len(positions) else len(chunk)
        block = chunk[pos:block_end]
        title_m = re.search(
            r"details-product-option__title[^>]*>[\s\S]*?<!--\[-->([^<]+)",
            block,
        )
        if not title_m:
            continue
        title = html_lib.unescape(title_m.group(1)).strip()
        if title.lower() == "select amount":
            continue

        choices: list[str] = []
        if re.search(r"details-product-option--select", block, re.I) or (
            '<option value="' in block and "</select>" in block.lower()
        ):
            choices = extract_select_choices(block)
        elif re.search(r"details-product-option--radio", block, re.I) or (
            "form-control--radio" in block
        ):
            choices = extract_radio_choices(block)

        if not choices:
            continue
        groups.append({"title": title, "choices": choices})
    return sort_option_groups(groups)


def product_gallery_html_chunk(full_html: str) -> str:
    a = full_html.find('class="product-details__gallery')
    if a == -1:
        gm = re.search(
            r'class="[^"]*product-details__gallery[^"]*"',
            full_html,
            re.I,
        )
        a = gm.start() if gm else -1
    if a == -1:
        return ""
    b = full_html.find("product-details__product-options", a)
    if b == -1:
        desc_m = re.search(
            r'class="[^"]*product-details__product-description[^"]*"',
            full_html[a:],
            re.I,
        )
        if desc_m:
            b = a + desc_m.start()
    if b == -1:
        tail = full_html[a : a + 500000]
        form_m = re.search(
            r'<form\b[^>]*class="[^"]*product-details__',
            tail,
            re.I,
        )
        b = a + form_m.start() if form_m else a + len(tail)
    return full_html[a:b]


def extract_all_gallery_media_urls(full_html: str, max_images: int = 60) -> list[str]:
    """
    All distinct product images from the Ecwid PDP gallery region only (thumbs + slides),
    in document order — not sitewide assets.
    """
    chunk = product_gallery_html_chunk(full_html)
    if not chunk:
        return []
    pat = re.compile(
        r'src="(https://d2j6dbq0eux0bg\.cloudfront\.net/images/[^"]+\.(?:jpg|jpeg|png|webp))"'
        r'|-webkit-image-set\(url\((https://d2j6dbq0eux0bg\.cloudfront\.net/images/[^)]+\.(?:jpg|jpeg|png|webp))\)'
        r'|background-image:url\((https://d2j6dbq0eux0bg\.cloudfront\.net/images/[^)]+\.(?:jpg|jpeg|png|webp))\)',
        re.I,
    )
    seen: set[str] = set()
    out: list[str] = []
    for m in pat.finditer(chunk):
        u = next((g for g in m.groups() if g), None)
        if not u:
            continue
        u = html_lib.unescape(u.split("?")[0].strip())
        lu = u.lower()
        if not lu.endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
        if len(out) >= max_images:
            break
    return out


def extract_product_scraped_fields(full_html: str) -> dict[str, str]:
    """Manufacturer-visible SKU and list price from polled HHDG PDP."""
    out: dict[str, str] = {}
    chunk = full_html[: min(len(full_html), 1_500_000)]
    m = re.search(r'<meta\s+itemprop="sku"\s+content="([^"]*)"', chunk, re.I)
    if m:
        sku = html_lib.unescape(m.group(1).strip())
        if sku:
            out["manufacturerSku"] = sku
    pm = re.search(r'itemprop="price"[^>]*content="([^"]+)"', chunk, re.I)
    if pm:
        raw = pm.group(1).strip()
        if re.fullmatch(r"\d+(?:\.\d+)?", raw):
            out["manufacturerListPrice"] = f"${float(raw):.2f}"
        elif raw.startswith("$"):
            out["manufacturerListPrice"] = raw
    if "manufacturerListPrice" not in out:
        dm = re.search(
            r'class="[^"]*product-details__product-price[^"]*"[^>]*>[\s\S]{0,1200}?(\$\d+(?:\.\d{2})?)',
            chunk,
            re.I,
        )
        if dm:
            out["manufacturerListPrice"] = dm.group(1).strip()
    return out


def strip_html_styles(fragment: str) -> str:
    def strip_style_tag(m: re.Match) -> str:
        tag = m.group(0)
        tag = re.sub(r'\sstyle="[^"]*"', "", tag, flags=re.I)
        tag = re.sub(r'\sclass="[^"]*"', "", tag, flags=re.I)
        return tag

    return re.sub(r"<[a-zA-Z][^>]*>", strip_style_tag, fragment)


def neutralize_hunter_links(fragment: str) -> str:
    """Normalize huntershdgold.com/ordering links; strip other outbound hunter links."""
    fragment = re.sub(
        r'<a[^>]*href="https://[^"]*huntershdgold\.com/ordering[^"]*"[^>]*>([\s\S]*?)</a>',
        r'<a class="contact-link" href="https://huntershdgold.com/ordering/" target="_blank" rel="noopener noreferrer">\1</a>',
        fragment,
        flags=re.I,
    )
    while True:
        m = re.search(
            r'<a\s[^>]*href="https://[^"]*huntershdgold\.com[^"]*"[^>]*>',
            fragment,
            flags=re.I,
        )
        if not m:
            break
        start, open_end = m.start(), m.end()
        depth = 1
        pos = open_end
        close_end = None
        while pos < len(fragment):
            na = fragment.find("<a", pos)
            nc = fragment.find("</a>", pos)
            if nc == -1:
                fragment = fragment[:start] + fragment[open_end:]
                close_end = None
                break
            if na != -1 and na < nc:
                depth += 1
                pos = na + 2
            else:
                depth -= 1
                if depth == 0:
                    close_end = nc
                    break
                pos = nc + 4
        if close_end is None:
            break
        inner = fragment[open_end:close_end]
        fragment = fragment[:start] + inner + fragment[close_end + 4 :]
    return fragment


def slug_file_from_href(href: str, product_id: str) -> str:
    path = urllib.parse.unquote(urllib.parse.urlparse(href).path.strip("/"))
    leaf = path.split("/")[-1] if path else ""
    m = re.match(r"(.+)-p(\d+)$", leaf)
    base = m.group(1) if m else leaf
    if base.upper().startswith("HHDG-"):
        base = base[5:]
    if base.upper().startswith("HUNTERS-HD-GOLD-"):
        base = base[16:]
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", base).strip("-").lower()
    if not slug or len(slug) > 80:
        slug = f"id-{product_id}"
    return f"hhdg-{slug}.html"


def download_binary(url: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36",
            "Referer": "https://huntershdgold.com/",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as r, open(dest, "wb") as f:
        f.write(r.read())


def enrich_product(
    p: dict,
    img_dir: str,
    skip_download: bool = False,
) -> dict:
    href = p["href"]
    pid = p["id"]
    ref = "https://huntershdgold.com/store/HHDG-Frames-c74140615"
    full = ""
    for attempt in pdp_fetch_url_candidates(href):
        try:
            cand = fetch_url(attempt, referer=ref)
            if cand and "product-details" in cand:
                full = cand
                break
        except Exception:
            continue
    desc_raw = extract_description_inner(full) if full else ""
    desc = neutralize_hunter_links(strip_html_styles(desc_raw)) if desc_raw else ""
    if not desc.strip():
        desc = (
            "<p>For prescription lenses and custom orders, start at "
            f"{HHDG_RX_ORDERING_ANCHOR}.{HHDG_RX_REFERRAL_NOTE} "
            'For customization and general availability at Rettmark, '
            '<a class="contact-link" href="contact.html" style="margin-top:0">contact Rettmark Firearms</a>.</p>'
        )
    scraped = extract_product_scraped_fields(full) if full else {}

    # Same order as Ecwid's thumbnail strip (not document-wide first-seen order).
    # extract_all_gallery_media_urls can prepend hero img src before composite and shift
    # every index vs huntershdgold.com — frame overrides and user "Nth image" counts
    # must match this list.
    urls: list[str] = []
    if full:
        urls = extract_thumb_bar_webkit_urls(full) or extract_ordered_gallery_webkit_urls(
            full
        )
        if not urls:
            urls = extract_all_gallery_media_urls(full, max_images=60)

    urls = [u for u in urls if not is_composite_product_overlay(u, pid)]

    local_gallery: list[str] = []
    for idx, u in enumerate(urls):
        ext = os.path.splitext(urllib.parse.urlparse(u).path)[1] or ".jpg"
        fname = f"{pid}_g{idx}{ext}"
        rel = f"assets/hhdg/{fname}"
        dest = os.path.join(img_dir, fname)
        if not skip_download:
            try:
                download_binary(u, dest)
            except Exception:
                continue
        if os.path.isfile(dest):
            local_gallery.append(rel)

    if not local_gallery and p.get("imageLocal"):
        local_gallery = [p["imageLocal"]]

    local_page = slug_file_from_href(href, pid)
    option_groups = finalize_option_groups(
        extract_product_option_groups(full) if full else [],
    )

    frame_choice_images: dict[str, str] = {}
    frame_group = next(
        (g for g in option_groups if is_frame_option_title(g.get("title", ""))),
        None,
    )
    if frame_group and full:
        explicit_colors = extract_img_color_alt_to_url_map(full)
        remote_by_choice = map_frame_choices_to_remote_urls(
            full,
            pid,
            frame_group["choices"],
            url_overrides=load_frame_image_overrides().get(pid, {}),
        )
        url_ov = load_frame_image_overrides().get(pid, {})
        gallery_idx_ov = load_frame_gallery_index_overrides().get(pid, {})
        choices = frame_group["choices"]
        color_on = _HHDG_HAS_PIL and os.environ.get("HHDG_COLOR_MATCH", "1").strip().lower() not in (
            "0",
            "false",
            "no",
            "off",
        )
        try:
            color_th = float(
                os.environ.get("HHDG_COLOR_MATCH_THRESHOLD", "").strip()
                or str(_HHDG_COLOR_THRESHOLD_DEFAULT)
            )
        except ValueError:
            color_th = _HHDG_COLOR_THRESHOLD_DEFAULT

        used_gallery: set[str] = set()
        for i, choice in enumerate(choices):
            if choice in url_ov and url_ov[choice].startswith("http"):
                remote = url_ov[choice]
                ext = os.path.splitext(urllib.parse.urlparse(remote).path)[1] or ".jpg"
                slug = re.sub(r"[^a-zA-Z0-9]+", "-", choice).strip("-").lower()[:50] or f"opt{i}"
                fname = f"{pid}_frame_{i}_{slug}{ext}"
                rel = f"assets/hhdg/{fname}"
                dest = os.path.join(img_dir, fname)
                if not skip_download:
                    try:
                        download_binary(remote, dest)
                    except Exception:
                        pass
                if os.path.isfile(dest):
                    frame_choice_images[choice] = rel
                continue

            # Pinned thumb indices beat Ecwid "Color: …" img alts (often wrong angle or color).
            if choice in gallery_idx_ov:
                remote = remote_by_choice.get(choice)
                if remote:
                    ext = os.path.splitext(urllib.parse.urlparse(remote).path)[1] or ".jpg"
                    slug = re.sub(r"[^a-zA-Z0-9]+", "-", choice).strip("-").lower()[:50] or f"opt{i}"
                    fname = f"{pid}_frame_{i}_{slug}{ext}"
                    rel = f"assets/hhdg/{fname}"
                    dest = os.path.join(img_dir, fname)
                    if not skip_download:
                        try:
                            download_binary(remote, dest)
                        except Exception:
                            pass
                    if os.path.isfile(dest):
                        frame_choice_images[choice] = rel
                continue

            u_exp = find_explicit_url_for_frame_choice(choice, explicit_colors)
            if u_exp:
                ext = os.path.splitext(urllib.parse.urlparse(u_exp).path)[1] or ".jpg"
                slug = re.sub(r"[^a-zA-Z0-9]+", "-", choice).strip("-").lower()[:50] or f"opt{i}"
                fname = f"{pid}_frame_{i}_{slug}{ext}"
                rel = f"assets/hhdg/{fname}"
                dest = os.path.join(img_dir, fname)
                if not skip_download:
                    try:
                        download_binary(u_exp, dest)
                    except Exception:
                        pass
                if os.path.isfile(dest):
                    frame_choice_images[choice] = rel
                continue

            matched_rel: str | None = None
            if (
                color_on
                and local_gallery
                and choice not in gallery_idx_ov
            ):
                rel_pick, _sc = pick_best_gallery_for_choice(
                    choice,
                    local_gallery,
                    used_gallery,
                    img_dir,
                    threshold=color_th,
                )
                if rel_pick:
                    matched_rel = rel_pick
                    used_gallery.add(rel_pick)

            if matched_rel:
                frame_choice_images[choice] = matched_rel
                continue

            remote = remote_by_choice.get(choice)
            if not remote:
                continue
            ext = os.path.splitext(urllib.parse.urlparse(remote).path)[1] or ".jpg"
            slug = re.sub(r"[^a-zA-Z0-9]+", "-", choice).strip("-").lower()[:50] or f"opt{i}"
            fname = f"{pid}_frame_{i}_{slug}{ext}"
            rel = f"assets/hhdg/{fname}"
            dest = os.path.join(img_dir, fname)
            if not skip_download:
                try:
                    download_binary(remote, dest)
                except Exception:
                    pass
            if os.path.isfile(dest):
                frame_choice_images[choice] = rel

    return {
        **p,
        **scraped,
        "descriptionHtml": desc,
        "galleryLocal": local_gallery,
        "localPage": local_page,
        "optionGroups": option_groups,
        "frameChoiceImages": frame_choice_images,
    }


def render_hhdg_purchase_block(
    p: dict,
    title_esc: str,
    retail_num: str,
    local_page_esc: str,
    hero_esc: str,
    cart_variant_esc: str,
) -> str:
    groups = [g for g in (p.get("optionGroups") or []) if g.get("choices")]

    if not groups:
        cart_sku = html_lib.escape(f"HHDG-{p['id']}")
        return f"""              <div class="btn-block">
                <button class="btn-secondary btn-secondary--cart" type="button" data-add-to-cart data-sku="{cart_sku}" data-name="{title_esc}" data-variant="{cart_variant_esc}" data-price="{retail_num}" data-url="{local_page_esc}" data-image="{hero_esc}">Add to cart</button>
              </div>"""

    labels = [option_display_label(g["title"]) for g in groups]
    conf = {"base": f"HHDG-{p['id']}", "labels": labels, "sep": " // "}
    conf_json = json.dumps(conf, ensure_ascii=False)

    frame_img_map: dict[str, str] = p.get("frameChoiceImages") or {}
    frame_sel_idx = next(
        (i for i, g in enumerate(groups) if is_frame_option_title(g.get("title", ""))),
        None,
    )

    rows: list[str] = []
    for i, g in enumerate(groups):
        lab_esc = html_lib.escape(labels[i])
        sel_attrs = ' class="hhdg-option-select" data-hhdg-option-select'
        if frame_sel_idx is not None and i == frame_sel_idx:
            sel_attrs = ' class="hhdg-option-select" data-hhdg-option-select data-hhdg-frame-select'
        if frame_sel_idx is not None and i == frame_sel_idx:
            opts_parts = []
        else:
            opts_parts = ['<option value="">Choose…</option>']
        for j, c in enumerate(g["choices"]):
            ce = html_lib.escape(c)
            img_attr = ""
            if frame_sel_idx is not None and i == frame_sel_idx and c in frame_img_map:
                img_attr = f' data-img="{html_lib.escape(frame_img_map[c])}"'
            sel_mark = ""
            if frame_sel_idx is not None and i == frame_sel_idx and j == 0:
                sel_mark = " selected"
            opts_parts.append(f"<option value=\"{ce}\"{img_attr}{sel_mark}>{ce}</option>")
        opts_inner = "".join(opts_parts)
        rows.append(
            f"""            <div class="hhdg-option-row">
              <label class="hhdg-option-label" for="hhdg-opt-{i}">{lab_esc}</label>
              <select id="hhdg-opt-{i}"{sel_attrs}>
{opts_inner}
              </select>
            </div>"""
        )
    rows_html = "\n".join(rows)

    return f"""            <div class="variant-block hhdg-variant-block" aria-label="Frame and lens options">
{rows_html}
              <p class="spec" style="margin-top:10px;margin-bottom:0">Your selection: <strong id="variant-color">Choose all options above</strong></p>
              <span id="variant-sku" hidden aria-hidden="true"></span>
            </div>
            <div class="btn-block">
              <button class="btn-secondary btn-secondary--cart" type="button" data-add-to-cart data-mode="selected-variant" data-hhdg-options-add disabled data-name="{title_esc}" data-variant="{cart_variant_esc}" data-price="{retail_num}" data-url="{local_page_esc}">Add to cart</button>
            </div>
            <script type="application/json" id="hhdg-opt-json">{conf_json}</script>
            <script>
(function () {{
  var confEl = document.getElementById("hhdg-opt-json");
  var skuEl = document.getElementById("variant-sku");
  var colorEl = document.getElementById("variant-color");
  var btn = document.querySelector("[data-hhdg-options-add]");
  var selects = document.querySelectorAll("[data-hhdg-option-select]");
  if (!confEl || !skuEl || !colorEl || !btn || !selects.length) return;
  var conf;
  try {{ conf = JSON.parse(confEl.textContent); }} catch (e) {{ return; }}
  var sep = conf.sep || " // ";
  var base = conf.base || "";
  var labels = conf.labels || [];
  var frameSel = document.querySelector("[data-hhdg-frame-select]");

  function updateHeroFromFrame() {{
    var hero = document.getElementById("product-hero-img");
    if (!frameSel || !hero) return;
    var opt = frameSel.options[frameSel.selectedIndex];
    if (!opt || !opt.value) return;
    var u = opt.getAttribute("data-img");
    if (u) hero.src = u;
  }}

  function sync() {{
    var parts = [];
    var meta = [];
    var ok = true;
    for (var i = 0; i < selects.length; i++) {{
      var sel = selects[i];
      var v = (sel.value || "").trim();
      if (!v) ok = false;
      parts.push(v);
      var lab = labels[i] || ("Option " + (i + 1));
      meta.push(lab + ": " + v);
    }}
    updateHeroFromFrame();
    if (!ok) {{
      skuEl.textContent = "";
      colorEl.textContent = "Choose all options above";
      btn.disabled = true;
      return;
    }}
    skuEl.textContent = base + sep + parts.join(sep);
    colorEl.textContent = meta.join(" · ");
    btn.disabled = false;
  }}

  selects.forEach(function (sel) {{ sel.addEventListener("change", sync); }});
  sync();
}})();
            </script>"""


def render_product_html(
    p: dict,
    nav_current_shooting: bool = True,
) -> str:
    title_esc = html_lib.escape(p["title"])
    retail_display = html_lib.escape(p.get("retailPriceDisplay") or "$299.99")
    retail_num = html_lib.escape((p.get("retailPriceNum") or "299.99").strip())
    cart_variant = "HHDG frame"
    cart_variant_esc = html_lib.escape(cart_variant)
    local_page_esc = html_lib.escape(p.get("localPage") or "")
    sub = (p.get("subtitle") or "").strip()
    sub_esc = html_lib.escape(sub) if sub else ""
    desc = p.get("descriptionHtml") or ""
    gallery = p.get("galleryLocal") or []
    meta_desc = html_lib.escape(
        f"{p['title']} — Hunters HD Gold HHDG frame at Rettmark Firearms."[:300]
    )

    current = ' aria-current="page"' if nav_current_shooting else ""
    shooting_nav = f'<a href="shooting-glasses.html"{current}>Shooting Glasses</a>'

    frame_img_map_pre: dict[str, str] = p.get("frameChoiceImages") or {}
    frame_group_pre = next(
        (
            g
            for g in (p.get("optionGroups") or [])
            if is_frame_option_title(g.get("title", ""))
        ),
        None,
    )
    hero = gallery[0] if gallery else p.get("imageLocal", "")
    if (
        frame_group_pre
        and frame_group_pre.get("choices")
        and frame_img_map_pre
    ):
        fc0 = frame_group_pre["choices"][0]
        if fc0 in frame_img_map_pre:
            hero = frame_img_map_pre[fc0]
    hero_esc = html_lib.escape(hero)
    thumbs = gallery[1:] if len(gallery) > 1 else []

    thumbs_html = ""
    if thumbs:
        imgs = []
        for t in thumbs:
            imgs.append(
                f"""              <img class="product-gallery-sub-img" src="{html_lib.escape(t)}" alt="" width="800" height="800" loading="lazy" decoding="async" tabindex="0" role="button" aria-label="Show this image larger" />"""
            )
        thumbs_html = (
            f'\n            <div class="product-gallery-sub" aria-label="More product images">\n'
            + "\n".join(imgs)
            + "\n            </div>"
        )

    sku_line = sub_esc if sub else "HHDG frame · Hunters HD Gold"
    mfr_sku = (p.get("manufacturerSku") or "").strip()
    if mfr_sku:
        sku_line = f"{sku_line} · Mfr ref {html_lib.escape(mfr_sku)}"

    list_price_html = ""
    lp = (p.get("manufacturerListPrice") or "").strip()
    if lp:
        list_price_html = (
            f'<p class="spec" style="margin-top:6px">Manufacturer list (reference): '
            f"{html_lib.escape(lp)}</p>"
        )

    gallery_script = ""
    if thumbs:
        gallery_script = """
  <script>
  (function () {
    var hero = document.getElementById("product-hero-img");
    if (!hero) return;
    document.querySelectorAll(".product-gallery-sub-img").forEach(function (img) {
      img.addEventListener("click", function () {
        var s = img.getAttribute("src");
        if (s) hero.src = s;
      });
      img.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        var s = img.getAttribute("src");
        if (s) hero.src = s;
      });
    });
  })();
  </script>"""

    purchase_html = render_hhdg_purchase_block(
        p, title_esc, retail_num, local_page_esc, hero_esc, cart_variant_esc
    )

    opt_groups = [g for g in (p.get("optionGroups") or []) if g.get("choices")]
    if opt_groups:
        spec_inner = (
            "Sold here at Rettmark. Choose frame and lens options below (same choices as Hunters HD Gold), "
            "then add to cart. For Rx or custom lenses, start at "
            f"{HHDG_RX_ORDERING_ANCHOR}.{HHDG_RX_REFERRAL_NOTE} "
            '<a class="contact-link" href="contact.html" style="margin-top:0">Contact us</a> for other questions.'
        )
    else:
        spec_inner = (
            "Sold here at Rettmark. For Rx or custom lens orders, start at "
            f"{HHDG_RX_ORDERING_ANCHOR}.{HHDG_RX_REFERRAL_NOTE} "
            '<a class="contact-link" href="contact.html" style="margin-top:0">Contact us</a> '
            "before checkout if you need guidance from Rettmark."
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <base href="/" />
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title_esc} | Shooting Glasses | Rettmark Firearms</title>
  <meta name="description" content="{meta_desc}" />
  <link rel="stylesheet" href="css/site.css" />
</head>
<body data-shield-anim="off">
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="viewport-bg" role="presentation" aria-hidden="true"></div>

  <header class="site-header">
    <a class="brand-rm" href="index.html" aria-label="Rettmark Firearms home">
      <img src="assets/logo-rm.png" alt="Rettmark" width="512" height="512" decoding="async" />
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a href="index.html">Home</a>
      <a href="firearms.html">Firearms</a>
      <a href="cases.html">Cases &amp; Bags</a>
      {shooting_nav}
      <a href="contact.html">Contact</a>
    </nav>
    <a class="cart-pill" href="cart.html" title="Shopping cart" aria-label="Shopping cart, 0 items">Cart <span class="cart-count">0</span></a>
  </header>

  <div class="page-shell" id="main">
    <div class="page">
      <header class="page-intro">
        <a class="contact-link" href="shooting-glasses.html" style="margin-top: 0">← Back to Shooting Glasses</a>
        <h1>{title_esc}</h1>
        <p class="lede">
          <strong>Hunters HD Gold</strong> · sold by Rettmark Firearms. Questions or prescription needs? Start at {HHDG_RX_ORDERING_ANCHOR}.{HHDG_RX_REFERRAL_NOTE} <a class="contact-link" href="contact.html" style="margin-top:0">Contact us</a> for other questions.
        </p>
      </header>

      <section class="panel product-page-panel" aria-label="Product details">
        <div class="product-page-grid">
          <div class="product-page-gallery" aria-label="Product photos">
            <img class="product-hero-img" id="product-hero-img" src="{hero_esc}" alt="{title_esc}" loading="eager" decoding="async" />{thumbs_html}
          </div>

          <div class="product-page-right">
            <article class="product-card">
              <p class="sku">{sku_line}</p>
              <p class="price">Price {retail_display}</p>
{list_price_html}
              <p class="spec">
                {spec_inner}
              </p>
{purchase_html}
            </article>

            <div class="product-more-info hhdg-prose-wrap">
              <h2>Details</h2>
              <div class="hhdg-prose">
{desc.strip()}
              </div>
            </div>
          </div>
        </div>
        <p class="cases-disclaimer">
          Product information is adapted from manufacturer materials. Safety, warranty, and ANSI Z87.1+ compliance are documented with your order; ask us if you need the full safety sheet before you buy.
        </p>
      </section>

      <footer class="site-footer">
        <img src="assets/logo-rm.png" alt="" width="512" height="512" decoding="async" />
        <div>© <span id="year"></span> Rettmark Firearms · <a class="contact-link" href="https://rettmarkfirearms.com/" style="margin-top:0">rettmarkfirearms.com</a> · Authorized Condition1 dealer · Hunters HD Gold authorized dealer.</div>
      </footer>
    </div>
  </div>

  <script src="js/site.js"></script>{gallery_script}
</body>
</html>
"""
