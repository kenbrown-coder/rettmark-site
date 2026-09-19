"""Parse JP 2026 dealer price list into public MAP catalog JSON.

Dealer / master-dealer columns are discarded and never written.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from pypdf import PdfReader

PDF = Path(r"c:\Users\kbrow\Downloads\JP DEALER PRICING LIST 2026.pdf")
ROOT = Path(__file__).resolve().parents[1]
OUT_JS = ROOT / "js" / "jp-catalog.json"
OUT_FN = ROOT / "netlify" / "functions" / "lib" / "jp-catalog.json"

MONEY = r"\$\d{1,3}(?:,\d{3})*\.\d{2}"
PRICE_RE = re.compile(rf"({MONEY})\s+({MONEY})\s+({MONEY})\s+({MONEY})\s*$")
SKIP_LINE = re.compile(
    r"^(JP Enterprises, Inc\.?|2026 Price List|\*Indicates limited inventory|"
    r"Item Description Retail JP MAP Dealer Master|Dealer|"
    r"Refer to Terms and Conditions.*|Page \d+ of \d+|CODING|jprifles\.com|"
    r"New products highlighted in yellow|JP ENTERPRISES|PRICE LIST 2026)\s*$",
    re.I,
)

HEADER_ENDINGS = {
    "PRICE",
    "RIFLES",
    "PISTOLS",
    "ASSEMBLIES",
    "UPGRADES",
    "UPGRADE",
    "OPTIONS",
    "COMPONENTS",
    "PARTS",
    "KITS",
    "BARRELS",
    "ADDITIONS",
    "ACCESSORIES",
    "LEVERS",
    "PINS",
    "GAUGES",
    "GUIDES",
    "CATCH",
    "SPRING",
    "SPRINGS",
    "SHOES",
    "COMPENSATORS",
    "DISSIPATOR",
    "DISSIPATORS",
    "RAIL",
    "RAILS",
    "NUTS",
    "BOLTS",
    "CARRIERS",
    "STOCK",
    "BUFFER",
    "TRIGGER",
    "GRIP",
    "GRIPS",
    "GUARD",
    "GUARDS",
    "FINISH",
    "FINISHES",
    "LASERMARK",
    "FEATURE",
    "UPPERS",
    "LOWERS",
    "MUZZLE",
    "SAFETY",
    "SYSTEMS",
    "SYSTEM",
    "RELEASE",
    "ELIMINATORS",
    "BLOCKS",
    "BLOCK",
    "HANDLES",
    "HANDLE",
    "SETS",
    "SUBCOMPONENTS",
    "TREATMENT",
    "BRACES",
    "BRACE",
}

HEADER_REJECT = {"WITH", "INCLUDING", "CHAMBER", "CONTOUR", "TWIST", "MOUNTED"}

CONTINUATION_START = {
    "AND",
    "WITH",
    "UPPER",
    "SYSTEM",
    "CHASSIS",
    "RECEIVER",
    "CONTOUR",
    "TWIST",
    "POSITION",
    "LENGTH",
    "BLACK",
    "FINISH",
    "OAL",
    "ANODIZED",
    "PROPRIETARY",
    "MATTE",
    "STAINLESS",
    "PORT",
    "JOURNAL",
    "THREAD",
    "THREADS",
    "TPI",
    "FOR",
    "ON",
    "IN",
    "THE",
    "A",
    "SET",
    "SERIES",
    "TYPE",
    "VERSION",
}

FIREARM_CAT_HINTS = (
    "BASE RIFLE",
    "READY RIFLES",
    "FEATURE RIFLES",
    "22LR BASE",
    "MR-19 BASE",
    "9MM BASE",
    "SMALL FRAME BASE",
    "LARGE FRAME BASE",
)

ACRONYM_FIX = (
    (r"\bJp-5\b", "JP-5"),
    (r"\bJp5\b", "JP5"),
    (r"\bJp\b", "JP"),
    (r"\bAr-15\b", "AR-15"),
    (r"\bAr-10\b", "AR-10"),
    (r"\bAr\b", "AR"),
    (r"\bM-Lok\b", "M-LOK"),
    (r"\bPcc\b", "PCC"),
    (r"\bPdw\b", "PDW"),
    (r"\bNfa\b", "NFA"),
    (r"\bQd\b", "QD"),
    (r"\bMk\b", "MK"),
    (r"\bVmos\b", "VMOS"),
    (r"\bLmos\b", "LMOS"),
    (r"\bFde\b", "FDE"),
    (r"\bOd\b", "OD"),
    (r"\bSss\b", "SS"),
    (r"\bTpi\b", "TPI"),
    (r"\bOal\b", "OAL"),
    (r"\bApac\b", "APAC"),
    (r"\b9Mm\b", "9mm"),
    (r"\b22Lr\b", "22LR"),
    (r"\b6\.5C\b", "6.5C"),
    (r"\bIii\b", "III"),
)


def money_to_cents(s: str) -> int:
    return ceil_to_dollar(int(round(float(s.replace("$", "").replace(",", "")) * 100)))


def ceil_to_dollar(cents: int) -> int:
    """Round any leftover cents up to the next whole dollar ($1.05 → $2)."""
    if cents <= 0:
        return 0
    rem = cents % 100
    return cents if rem == 0 else cents + (100 - rem)


def looks_like_sku_token(tok: str) -> bool:
    t = tok.rstrip("*")
    if not t:
        return False
    if t.startswith("o") and len(t) > 2:
        return True
    if re.search(r"\d", t):
        return True
    if "/" in t:
        return True
    if "-" in t and len(t) >= 5:
        return True
    return False


def is_header_line(line: str) -> bool:
    text = re.sub(r"\s+", " ", line).strip(" .")
    if not text or "$" in text or ".." in text:
        return False
    if SKIP_LINE.match(text):
        return False
    words = text.split()
    if not words or len(text) > 72:
        return False
    first = words[0].rstrip(".,:*")
    section_prefixes = {"JP5", "22LR", "9MM", "MR-19", "MLOK"}
    if looks_like_sku_token(first) and first not in section_prefixes:
        return False
    if words[0] in CONTINUATION_START:
        last_check = words[-1].rstrip(".,:*")
        if last_check.startswith(".") or (last_check and last_check[0].isdigit()):
            last_check = words[-2].rstrip(".,:*") if len(words) > 1 else last_check
        if last_check not in HEADER_ENDINGS:
            return False
    if any(w.rstrip(".,:*") in HEADER_REJECT for w in words):
        return False
    last = words[-1].rstrip(".,:*")
    # "SMALL FRAME READY RIFLES, .223"
    if last.startswith(".") or last[0].isdigit():
        last = words[-2].rstrip(".,:*") if len(words) > 1 else last
    return last in HEADER_ENDINGS


def split_sku_desc(left: str) -> tuple[str, str, bool]:
    parts = left.split()
    if not parts:
        return "", "", False
    limited = any("*" in p for p in parts[:2])
    sku_parts = [parts[0].rstrip("*")]
    idx = 1
    if len(parts) > 1 and parts[1] in {"PISTOL", "RIFLE"}:
        sku_parts.append(parts[1])
        idx = 2
    sku = " ".join(sku_parts)
    desc = " ".join(parts[idx:]).strip()
    if not desc:
        desc = sku
    return sku, desc, limited


def nice_text(s: str) -> str:
    raw_words = re.sub(r"\s+", " ", s).strip(" .").split()
    out = []
    for w in raw_words:
        if re.search(r"\d", w) or "/" in w:
            out.append(w.rstrip("."))
            continue
        tw = w.title()
        out.append(tw)
    text = " ".join(out)
    for pat, repl in ACRONYM_FIX:
        text = re.sub(pat, repl, text)
    text = text.replace("**All Nfa Rules Apply**", "**All NFA rules apply**")
    text = text.replace("**All NFA Rules Apply**", "**All NFA rules apply**")
    return text


def is_firearm_category(category: str) -> bool:
    cat = category.upper()
    return any(h in cat for h in FIREARM_CAT_HINTS)


def classify(category: str, sku: str, desc: str) -> str:
    cat = category.upper()
    blob = f"{sku} {desc}".upper()
    if (
        sku.startswith("o")
        or "Upgrade" in category
        or "Custom Options" in category
        or "Finish Options" in category
        or "Barrel Finishes" in category
        or "Lasermark" in category
        or "Specialty Finish" in category
    ):
        return "upgrade"
    if re.search(r"\bCOMPLETE LOWER\b", blob) or (sku.upper().endswith("LA") and "LOWER" in blob):
        return "lower"
    if (
        re.search(r"\bCOMPLETE UPPER\b", blob)
        or re.search(r"\bUPPER ASSEMBLY\b", blob)
        or sku.upper().startswith("RU-")
    ):
        if re.search(r"\bRIFLE\b", blob) and not re.search(r"\bUPPER\b", desc.upper()):
            return "rifle"
        return "upper"
    if sku.upper().startswith(("RR-", "FR-")):
        if "PISTOL" in sku.upper() or re.search(r"\bPISTOL\b", desc.upper()):
            return "pistol"
        return "rifle"
    if is_firearm_category(category):
        if "PISTOL" in sku.upper() or re.search(r"\bPISTOL\b", desc.upper()):
            return "pistol"
        return "rifle"
    return "part"


def group_for_kind(kind: str) -> str:
    return {
        "rifle": "Rifles & pistols",
        "pistol": "Rifles & pistols",
        "upper": "Upper assemblies",
        "lower": "Lower assemblies",
        "upgrade": "Build options & upgrades",
        "part": "Parts",
    }[kind]


def slug_id(sku: str, name: str, used: dict[str, int]) -> str:
    base = re.sub(r"[^A-Z0-9]+", "-", sku.upper()).strip("-")[:70] or "ITEM"
    n = used.get(base, 0)
    used[base] = n + 1
    if n == 0:
        return base
    extra = re.sub(r"[^A-Z0-9]+", "-", name.upper()).strip("-")[:24]
    return f"{base}-{extra}" if extra else f"{base}-{n + 1}"


def extract_items() -> list[dict]:
    reader = PdfReader(str(PDF))
    items: list[dict] = []
    category = "General"
    buf = ""
    used_ids: dict[str, int] = {}

    def flush_paragraph(text: str) -> None:
        nonlocal category
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            return
        m = PRICE_RE.search(text)
        if not m:
            if is_header_line(text):
                category = nice_text(text)
            return
        left = text[: m.start()].strip()
        if not left:
            return
        sku, desc, limited = split_sku_desc(left)
        kind = classify(category, sku, desc)
        name = nice_text(desc)
        items.append(
            {
                "id": slug_id(sku, name, used_ids),
                "sku": sku,
                "name": name,
                "category": category,
                "group": group_for_kind(kind),
                "kind": kind,
                "mapCents": money_to_cents(m.group(2)),
                "retailCents": money_to_cents(m.group(1)),
                "limited": bool(limited),
                "upgrade": kind == "upgrade",
                "firearm": kind in {"rifle", "pistol"},
            }
        )

    for page in reader.pages[1:]:
        raw = page.extract_text() or ""
        for line in raw.splitlines():
            line = line.strip()
            if not line or SKIP_LINE.match(line):
                continue
            if PRICE_RE.search(line):
                flush_paragraph(f"{buf} {line}".strip() if buf else line)
                buf = ""
                continue
            if buf:
                buf = f"{buf} {line}"
                if PRICE_RE.search(buf):
                    flush_paragraph(buf)
                    buf = ""
                continue
            if is_header_line(line):
                category = nice_text(line)
            else:
                buf = line
        if buf and PRICE_RE.search(buf):
            flush_paragraph(buf)

    return items


def main() -> None:
    items = extract_items()
    payload = {
        "source": "JP Enterprises 2026 price list",
        "effective": "2026-02-19",
        "currency": "USD",
        "priceNote": "Listed price is shown with MSRP for reference. This is a request list, not a checkout cart.",
        "items": items,
    }
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_FN.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(text, encoding="utf-8")
    OUT_FN.write_text(text, encoding="utf-8")
    try:
        from apply_jp_rifle_media import main as apply_rifle_media

        apply_rifle_media()
    except Exception as exc:
        print("rifle media overlay skipped:", exc)
    print("items", len(items))
    print("kinds", dict(Counter(i["kind"] for i in items)))
    cats = Counter(i["category"] for i in items)
    print("categories", len(cats))
    for cat, n in cats.most_common(50):
        print(f"  {n:4d}  {cat}")
    print("wrote", OUT_JS)


if __name__ == "__main__":
    main()
