"""Attach JP product photos and copy to firearm rows in the public catalog."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MEDIA_PATH = ROOT / "data" / "jp-rifle-media.json"
CATALOGS = (
    ROOT / "js" / "jp-catalog.json",
    ROOT / "netlify" / "functions" / "lib" / "jp-catalog.json",
)


def family_key(item: dict) -> str | None:
    sku = str(item.get("sku") or "").upper().replace(" ", "")
    if not sku:
        return None
    if "JPRFX" in sku:
        if sku.startswith("SCR11"):
            return "scr-11"
        return "jprfx"
    if "22LR" in sku:
        if sku.startswith("SCR11"):
            return "scr-11"
        if sku.startswith("CTR02"):
            return "ctr-22lr"
        return "jp-22r"
    if "MR-19" in sku or sku.startswith("MR19"):
        return "mr-19"
    if "JP5G940" in sku or sku.startswith("JP5") or "JP5UA" in sku:
        return "jp-5"
    if "GMR15" in sku:
        return "gmr-15"
    if "LRP07" in sku:
        return "lrp-07"
    if sku.startswith("SCR11") or sku.startswith("RR-SCR"):
        return "scr-11"
    if sku.startswith("CTR02") or sku.startswith("RR-CTR"):
        return "ctr-02"
    if sku.startswith("ASF20"):
        return "asf-20"
    if "PSC21" in sku:
        return "psc-21"
    if sku.startswith("RR-JP15"):
        return "jp-15-duty"
    if sku.startswith("JP15"):
        return "jp-15"
    return None


def apply_to_items(items: list[dict], families: dict) -> tuple[int, list[str]]:
    matched = 0
    missing: list[str] = []
    for item in items:
        if not item.get("firearm"):
            for key in ("model", "image", "sourceUrl", "description"):
                item.pop(key, None)
            continue
        key = family_key(item)
        fam = families.get(key) if key else None
        if not fam:
            missing.append(str(item.get("sku")))
            continue
        item["model"] = fam["model"]
        item["image"] = fam["image"]
        item["sourceUrl"] = fam["sourceUrl"]
        item["description"] = fam["description"]
        matched += 1
    return matched, missing


def apply_catalog(path: Path, families: dict) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    matched, missing = apply_to_items(data.get("items") or [], families)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{path.name}: {matched} rifles with media")
    if missing:
        print("  unmatched:", ", ".join(missing))


def main() -> None:
    families = json.loads(MEDIA_PATH.read_text(encoding="utf-8"))["families"]
    for path in CATALOGS:
        apply_catalog(path, families)


if __name__ == "__main__":
    main()
