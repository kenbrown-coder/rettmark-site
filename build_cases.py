#!/usr/bin/env python3
"""Rebuild cases.html from products.json. Run from project root: python build_cases.py"""

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "products.json"
OUT = ROOT / "cases.html"


def esc(s: str) -> str:
    return html.escape(s, quote=True)


def slugify(s: str) -> str:
    s = s.strip().lower()
    s = s.replace("&", "and")
    s = s.replace("×", "x")
    s = s.replace("/", " ")
    s = s.replace("\\", " ")
    # Normalize common punctuation used in the data.
    s = s.replace("’", "'").replace("“", '"').replace("”", '"')
    s = s.replace('"', "").replace("'", "")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "variant"


def case_number_from_title(title: str) -> str:
    m = re.search(r"#\s*(\d+)", title)
    return m.group(1) if m else "unknown"


def product_href(title: str, variant: str) -> str:
    case_no = case_number_from_title(title)
    v = slugify(variant)
    return f"case-{case_no}-{v}.html"


def card(
    title: str,
    variant: str,
    interior: str,
    price: str,
    url: str,
    image_src: str | None = None,
    image_alt: str | None = None,
    sku: str | None = None,
) -> str:
    t = esc(title)
    v = esc(variant)
    i = esc(interior)
    p = esc(price)
    u = esc(url)
    price_num = esc(price)
    img = ""
    if image_src:
        img_src = esc(image_src)
        img_alt = esc(image_alt or title)
        img = f'<a class="ph-thumb" href="{u}" aria-label="View {t}"><img class="ph-thumb-img" src="{img_src}" alt="{img_alt}" loading="lazy" decoding="async" /></a>'
    else:
        img = f'<a class="ph-thumb" href="{u}" aria-label="View {t}" aria-hidden="true"></a>'
    sku_attr = f' data-sku="{esc(sku)}"' if sku else ""
    return f"""          <article class="product-card"{sku_attr}>
            {img}
            <h3><a href="{u}">{t}</a></h3>
            <p class="sku">{v} · Condition&nbsp;1</p>
            <p class="spec">INT {i}</p>
            <p class="price">Ref. ${p}</p>
            <p class="stock-badge" data-stock-badge></p>
          </article>"""


def main() -> None:
    raw = json.loads(DATA.read_text(encoding="utf-8"))
    source_url = esc(str(raw.get("sourceCollectionUrl", "")))
    sections = raw["sections"]

    jump_links = []
    blocks = []
    for sec in sections:
        sid = sec["id"]
        heading = sec["heading"]
        if sec.get("jump"):
            jl = esc(sec["jump"])
            jump_links.append(f'        <a href="#{esc(sid)}">{jl}</a>')
        blocks.append(
            f'        <h2 class="cases-category" id="{esc(sid)}">{esc(heading)}</h2>\n        <div class="product-grid">'
        )
        for p in sec["products"]:
            href = product_href(p["title"], p["variant"])
            image = p.get("image") or {}
            image_src = image.get("src")
            image_alt = image.get("alt")
            colors = p.get("colors") or []
            default_sku = ""
            if colors and isinstance(colors, list):
                default_sku = (colors[0].get("sku") or "").strip()
            blocks.append(
                card(
                    p["title"],
                    p["variant"],
                    p["interior"],
                    p["price"],
                    href,
                    image_src=image_src,
                    image_alt=image_alt,
                    sku=default_sku,
                )
            )
        blocks.append("        </div>")

    jump_html = "\n".join(jump_links)
    grid_html = "\n".join(blocks)

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <base href="/" />
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cases | Rettmark Firearms</title>
  <meta name="description" content="Condition 1 hard cases — pre-cut foam pistol, revolver, long gun, and trunk cases. Authorized dealer: Rettmark Firearms." />
  <link rel="stylesheet" href="css/site.css" />
</head>
<body data-shield-anim="off">
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="viewport-bg" role="presentation" aria-hidden="true"></div>

  <header class="site-header">
    <a class="brand-rm" href="index.html" aria-label="Rettmark Firearms home">
      <img src="assets/logo-rm.png" alt="Rettmark" width="120" height="48" decoding="async" />
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a href="index.html">Home</a>
      <a href="firearms.html">Firearms</a>
      <a href="cases.html" aria-current="page">Cases</a>
      <a href="bags.html">Bags</a>
      <a href="contact.html">Contact</a>
    </nav>
    <a class="cart-pill" href="cart.html" title="Shopping cart" aria-label="Shopping cart, 0 items">Cart <span class="cart-count">0</span></a>
  </header>

  <div class="page-shell" id="main">
    <div class="page">
      <header class="page-intro">
        <h1>Cases</h1>
        <p class="lede">
          We are an <strong>authorized Condition&nbsp;1 dealer</strong>. This catalog follows their
          <strong>pre-cut foam firearm case</strong> assortment — the same models and sizing families shown on Condition&nbsp;1’s
          <a href="{source_url}" rel="noopener noreferrer">pre-cut foam cases</a> collection page. Thumbnails are placeholders until your photography is connected.
        </p>
      </header>

      <nav class="cases-jump" aria-label="Jump to category">
{jump_html}
      </nav>

      <section class="panel cases-catalog" aria-label="Case catalog">
        <span class="placeholder-badge">Catalog draft</span>
{grid_html}
        <p class="cases-disclaimer">
          Models and interior dimensions are transcribed from the manufacturer’s public product data for this line. Color options and minor variants may exist beyond what is listed — confirm with us or your distributor before promising a specific finish.
        </p>
      </section>

      <footer class="site-footer">
        <img src="assets/logo-rm.png" alt="" width="512" height="512" decoding="async" />
        <div>© <span id="year"></span> Rettmark Firearms · <a class="contact-link" href="https://rettmarkfirearms.com/" style="margin-top:0">rettmarkfirearms.com</a> · An authorized Condition1 dealer.</div>
      </footer>
    </div>
  </div>

  <script src="js/site.js"></script>
</body>
</html>
"""
    OUT.write_text(page, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(sections)} sections)")


if __name__ == "__main__":
    main()
