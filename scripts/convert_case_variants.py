"""Migrate case pages: variant chips -> select (HHDG-style). Run: python scripts/convert_case_variants.py"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def escape_attr(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace('"', "&quot;")
    )


def escape_html(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def parse_buttons(grid_inner: str) -> list[dict]:
    buttons = []
    for m in re.finditer(r"<button\b([^>]*)>([\s\S]*?)</button>", grid_inner):
        attrs = m.group(1)
        if "variant-chip" not in attrs:
            continue

        def get_attr(name: str) -> str:
            mm = re.search(name + r'="([^"]*)"', attrs)
            return mm.group(1) if mm else ""

        buttons.append(
            {
                "img": get_attr("data-variant-img"),
                "alt": get_attr("data-variant-alt"),
                "sku": get_attr("data-variant-sku"),
                "label": get_attr("data-variant-label"),
                "is_active": bool(re.search(r"\bis-active\b", attrs)),
            }
        )
    return buttons


def main() -> None:
    converted = 0
    for fp in sorted(ROOT.glob("case-*.html")):
        html = fp.read_text(encoding="utf-8")
        gm = re.search(
            r'<div class="variant-grid"[^>]*>([\s\S]*?)</div>', html
        )
        if not gm:
            print("skip (no grid)", fp.name)
            continue
        buttons = parse_buttons(gm.group(1))
        if not buttons:
            print("skip (no chips)", fp.name)
            continue

        selected = next((b for b in buttons if b["is_active"]), buttons[0])
        lines = []
        for b in buttons:
            sel = " selected" if b is selected else ""
            lines.append(
                f'                    <option value="{escape_attr(b["sku"])}" '
                f'data-img="{escape_attr(b["img"])}" data-alt="{escape_attr(b["alt"])}" '
                f'data-label="{escape_attr(b["label"])}"{sel}>'
                f'{escape_html(b["label"])}</option>'
            )
        options = "\n".join(lines)

        new_block = f"""              <div class="variant-block case-variant-block" aria-label="Color options">
                <div class="hhdg-option-row">
                  <label class="hhdg-option-label" for="case-color-select">Color</label>
                  <select id="case-color-select" class="hhdg-option-select" autocomplete="off" aria-label="Color">
{options}
                  </select>
                </div>
                <p class="spec" style="margin-top:10px;margin-bottom:0">Your selection: <strong id="variant-color">{escape_html(selected["label"])}</strong></p>
                <p class="sku" style="margin: 0">SKU <span id="variant-sku">{escape_html(selected["sku"])}</span></p>
              </div>"""

        block_re = re.compile(
            r'<div class="variant-block" aria-label="Color options">[\s\S]*?</div>\s*\r?\n\s*</div>',
        )
        if not block_re.search(html):
            print("skip (pattern)", fp.name)
            continue
        html = block_re.sub(new_block, html, count=1)

        script_re = re.compile(
            r"\r?\n\s*<script>\s*\r?\n\s*\(function \(\) \{\s*\r?\n\s*var hero = document\.getElementById\(\"product-hero-img\"\);[\s\S]*?\}\)\(\);\s*\r?\n\s*</script>",
        )
        html = script_re.sub("", html)

        fp.write_text(html, encoding="utf-8")
        converted += 1
        print("ok", fp.name)

    print("done,", converted, "files")


if __name__ == "__main__":
    main()
