#!/usr/bin/env python3
"""
Build per-product pages for each offering in products.json.

Run from project root:
  python build_case_product_pages.py
"""

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "products.json"


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


def build_page(p: dict, page_href: str) -> str:
    title = p["title"]
    variant = p["variant"]
    interior = p["interior"]
    price = p["price"]
    image = p.get("image") or {}
    image_src = image.get("src")
    image_alt = image.get("alt") or title
    colors = p.get("colors") or []
    default_sku = ""
    if colors:
        default_sku = (colors[0].get("sku") or "").strip()

    # Layout inspired by typical e-commerce product pages.
    gallery_html = '<div class="product-hero-thumb" aria-hidden="true"></div>'
    if image_src:
        gallery_html = f'<img class="product-hero-img" id="product-hero-img" src="{esc(image_src)}" alt="{esc(image_alt)}" loading="eager" decoding="async" />'

    color_block = ""
    script_block = ""
    if colors:
        # Build chips (use data attributes for swap).
        chips = []
        for idx, c in enumerate(colors):
            name = c.get("name", "")
            sku = c.get("sku", "")
            img = (c.get("image") or {}).get("src", "")
            alt = (c.get("image") or {}).get("alt", title)
            pressed = "true" if idx == 0 else "false"
            active = " is-active" if idx == 0 else ""
            chips.append(
                f'''<button class="variant-chip{active}" type="button" role="listitem" data-variant-img="{esc(img)}" data-variant-alt="{esc(alt)}" data-variant-sku="{esc(sku)}" data-variant-label="{esc(name)}" aria-pressed="{pressed}"><span class="variant-dot" aria-hidden="true"></span>{esc(name)}</button>'''
            )
        color_block = f"""
              <div class="variant-block" aria-label="Color options">
                <p class="spec" style="margin: 0">Color: <strong id="variant-color">{esc(colors[0].get("name",""))}</strong></p>
                <p class="sku" style="margin: 0">SKU <span id="variant-sku">{esc(colors[0].get("sku",""))}</span></p>
                <div class="variant-grid" role="list" aria-label="Choose a color">
                  {''.join(chips)}
                </div>
              </div>"""
        script_block = """

  <script>
    (function () {
      var hero = document.getElementById("product-hero-img");
      var skuEl = document.getElementById("variant-sku");
      var colorEl = document.getElementById("variant-color");
      if (!hero || !skuEl || !colorEl) return;

      var chips = document.querySelectorAll(".variant-chip[data-variant-img]");
      if (!chips || !chips.length) return;

      function setActive(btn) {
        chips.forEach(function (b) {
          b.classList.remove("is-active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-pressed", "true");
      }

      function apply(btn) {
        var img = btn.getAttribute("data-variant-img");
        var alt = btn.getAttribute("data-variant-alt") || hero.alt;
        var sku = btn.getAttribute("data-variant-sku") || "";
        var label = btn.getAttribute("data-variant-label") || "";

        if (img) hero.src = img;
        hero.alt = alt;
        if (sku) skuEl.textContent = sku;
        if (label) colorEl.textContent = label;
        setActive(btn);
      }

      chips.forEach(function (btn) {
        btn.addEventListener("click", function () { apply(btn); });
      });
    })();
  </script>"""
    product_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <base href="/" />
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{esc(title)} | Rettmark Firearms</title>
  <meta name="description" content="{esc(title)} — {esc(variant)}. Interior dimensions: {esc(interior)}. Authorized dealer: Rettmark Firearms." />
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
      <a href="cases.html">Cases</a>
      <a href="bags.html">Bags</a>
      <a href="contact.html">Contact</a>
    </nav>
    <a class="cart-pill" href="cart.html" title="Shopping cart" aria-label="Shopping cart, 0 items">Cart <span class="cart-count">0</span></a>
  </header>

  <div class="page-shell" id="main">
    <div class="page">
      <header class="page-intro">
        <a class="contact-link" href="cases.html" style="margin-top: 0">← Back to Cases</a>
        <h1>{esc(title)}</h1>
        <p class="lede">
          {esc(variant)} · <strong>authorized Condition&nbsp;1 dealer</strong>.
          Interior dimensions are listed below.
        </p>
      </header>

      <section class="panel product-page-panel" aria-label="Product details">
        <span class="placeholder-badge">Product page</span>
        <div class="product-page-grid">
          <div class="product-page-gallery">
            {gallery_html}
          </div>

          <div class="product-page-right">
            <article class="product-card">
              <p class="sku">{esc(variant)} · Condition&nbsp;1</p>
              <p class="price">Ref. ${esc(price)}</p>
              <p class="spec">Interior: {esc(interior)}</p>
              <p class="stock-badge" data-stock-status data-sku="{esc(default_sku)}"></p>
              {color_block}
              <div class="btn-block">
                <button class="btn-secondary btn-secondary--cart" type="button" data-stock-cta data-add-to-cart data-mode="selected-variant" data-name="{esc(title)}" data-variant="{esc(variant)}" data-price="{esc(price)}" data-url="{esc(page_href)}">Add to cart</button>
              </div>
            </article>

            <div class="product-more-info">
              <h2>Details</h2>
              <ul class="product-bullets">
                <li>
                  Interior dimensions: <strong>{esc(interior)}</strong>
                </li>
                <li>
                  Configuration: <strong>{esc(variant)}</strong>
                </li>
                <li>
                  Photos and media are placeholders until your photography is connected.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p class="cases-disclaimer">
          Models and interior dimensions are transcribed from the manufacturer’s public product data for this line.
          Color options and minor variants may exist beyond what is listed — confirm with us or your distributor before promising a specific finish.
        </p>
      </section>
    </div>
  </div>

  <script src="js/site.js"></script>
  {script_block}
</body>
</html>
"""
    return product_html


def main() -> None:
    raw = json.loads(DATA.read_text(encoding="utf-8"))
    sections = raw["sections"]

    products: list[dict] = []
    for sec in sections:
        for p in sec["products"]:
            products.append(p)

    out_count = 0
    for p in products:
        href = product_href(p["title"], p["variant"])
        out_path = ROOT / href
        out_path.write_text(build_page(p, href), encoding="utf-8", newline="\n")
        out_count += 1

    print(f"Wrote {out_count} product pages.")


if __name__ == "__main__":
    main()

