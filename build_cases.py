#!/usr/bin/env python3
"""Rebuild cases.html (Cases + Bags catalog) from products.json. Run: python build_cases.py"""

import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "products.json"
OUT = ROOT / "cases.html"

# Bags grid (PDPs stay on bag-*.html); same card/search pattern as cases.
BAGS_CATALOG_HTML = """        <section class="cases-section" aria-label="Bags">
          <details class="cases-accordion" id="cat-bags" open>
            <summary class="cases-accordion-summary"><span class="cases-category">Bags</span></summary>
            <div class="cases-accordion-body">
              <p class="cases-featured-note">Range and storage bags from Condition&nbsp;1. Photos are from the manufacturer until we replace them with Rettmark imagery.</p>
              <div class="product-grid">
          <article class="product-card" data-title="Kinetic 2 Pistol Bag" data-variant="2 pistols &amp; accessories" data-sku="45870BK">
            <a class="ph-thumb" href="bag-kinetic-2-pistol-bag.html" aria-label="View Kinetic 2 Pistol Bag"><img class="ph-thumb-img" src="assets/condition1/kinetic-2-pistol-bag-black.jpg" alt="Durable Kinetic 2 Pistol Bag featuring a sleek black design with reinforced handles and secure Velcro straps for storage." loading="lazy" decoding="async" /></a>
            <h3><a href="bag-kinetic-2-pistol-bag.html">Kinetic 2 Pistol Bag</a></h3>
            <p class="sku">2 pistols &amp; accessories · Condition&nbsp;1</p>
            <p class="spec">Dimensions 14.5&quot; × 11&quot; × 4.5&quot;</p>
            <p class="price">Price $89.99</p>
            <p class="stock-badge" data-stock-badge data-sku="45870BK"></p>
            <div class="btn-block">
              <a class="btn-secondary btn-secondary--link" href="bag-kinetic-2-pistol-bag.html">View details</a>
            </div>
          </article>
              </div>
            </div>
          </details>
        </section>"""


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
    return f"""          <article class="product-card"{sku_attr} data-title="{t}" data-variant="{v}">
            {img}
            <h3><a href="{u}">{t}</a></h3>
            <p class="sku">{v} · Condition&nbsp;1</p>
            <p class="spec">INT {i}</p>
            <p class="price">Price ${p}</p>
            <p class="stock-badge" data-stock-badge></p>
            <div class="btn-block">
              <a class="btn-secondary btn-secondary--link" href="{u}">View details</a>
            </div>
          </article>"""


def main() -> None:
    raw = json.loads(DATA.read_text(encoding="utf-8"))
    source_url = esc(str(raw.get("sourceCollectionUrl", "")))
    sections = raw["sections"]
    # Put the best-seller category first.
    sections = sorted(
        sections,
        key=lambda s: (0 if s.get("id") == "cat-179" else 1),
    )

    blocks = []
    for sec in sections:
        sid = sec["id"]
        heading = sec["heading"]
        blocks.append(f'        <section class="cases-section" aria-label="{esc(heading)}">')
        blocks.append(
            f'          <details class="cases-accordion" id="{esc(sid)}"{" open" if sid == "cat-179" else ""}>'
        )
        blocks.append(f'            <summary class="cases-accordion-summary"><span class="cases-category">{esc(heading)}</span></summary>')
        blocks.append('            <div class="cases-accordion-body">')
        if sid == "cat-179":
            blocks.append('              <p class="cases-featured-note">Most popular size for multi-pistol range kits. Multiple foam layouts are available—open a product to choose your color.</p>')
        blocks.append('              <div class="product-grid">')
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
        blocks.append("              </div>")
        blocks.append("            </div>")
        blocks.append("          </details>")
        blocks.append("        </section>")

    grid_html = "\n".join(blocks)

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <base href="/" />
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cases &amp; Bags | Rettmark Firearms</title>
  <meta name="description" content="Condition 1 hard cases &amp; bags — pistol, revolver, long gun, and range gear. Authorized dealer: Rettmark Firearms." />
  <link rel="stylesheet" href="css/site.css" />
</head>
<body class="page-cases" data-shield-anim="off">
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="viewport-bg" role="presentation" aria-hidden="true"></div>

  <header class="site-header">
    <a class="brand-rm" href="index.html" aria-label="Rettmark Firearms home">
      <img src="assets/logo-rm.png" alt="Rettmark" width="120" height="48" decoding="async" />
    </a>
    <nav class="site-nav" aria-label="Primary">
      <a href="index.html">Home</a>
      <a href="firearms.html">Firearms</a>
      <a href="cases.html" aria-current="page">Cases &amp; Bags</a>
      <a href="shooting-glasses.html">Shooting Glasses</a>
      <a href="contact.html">Contact</a>
    </nav>
    <a class="cart-pill" href="cart.html" title="Shopping cart" aria-label="Shopping cart, 0 items">Cart <span class="cart-count">0</span></a>
  </header>

  <div class="page-shell" id="main">
    <div class="page">
      <header class="page-intro">
        <h1>Cases &amp; Bags</h1>
        <p class="lede">
          We are an <strong>authorized Condition&nbsp;1 dealer</strong> for rugged hard cases &amp; bags—pistols, revolvers, rifles, range kits, and soft gear.
          Use search and categories to narrow the list; open a product for colors, stock status, and pricing (cases) or full bag details.
        </p>
      </header>

      <div class="cases-tools" role="search" aria-label="Search and filter cases &amp; bags">
        <label class="cases-tools-label" for="cases-search">Search</label>
        <input class="cases-tools-input" id="cases-search" type="search" placeholder="Search by product, case #, size, or layout" autocomplete="off" />
        <label class="cases-tools-label" for="cases-filter">Category</label>
        <select class="cases-tools-select" id="cases-filter" aria-label="Filter by category">
          <option value="">All categories</option>
          <option value="cat-179">16″ multi-pistol (#179)</option>
          <option value="cat-compact">Compact & micro pistol</option>
          <option value="cat-310">16″ revolver (#310)</option>
          <option value="cat-801">18″ pistol, mag & high-capacity</option>
          <option value="cat-227">20″ pistol (#227)</option>
          <option value="cat-22-31">22″–31″ pistol & range</option>
          <option value="cat-40-42">40″–42″ long / economy</option>
          <option value="cat-45">45″ long, AR & trunks</option>
          <option value="cat-55">55″ long & shotgun</option>
          <option value="cat-bags">Bags</option>
        </select>
      </div>

      <section class="panel cases-catalog" aria-label="Cases &amp; bags catalog">
{grid_html}
        <p class="cases-disclaimer">
          Models and interior dimensions are transcribed from the manufacturer’s public product data for this line. Color options and minor variants may exist beyond what is listed — confirm with us or your distributor before promising a specific finish.
        </p>
{BAGS_CATALOG_HTML}
        <p class="cases-disclaimer">
          Cart is saved in your browser and reviewed on the cart page before checkout handoff.
        </p>
      </section>

      <footer class="site-footer">
        <img src="assets/logo-rm.png" alt="" width="512" height="512" decoding="async" />
        <div>© <span id="year"></span> Rettmark Firearms · <a class="contact-link" href="https://rettmarkfirearms.com/" style="margin-top:0">rettmarkfirearms.com</a> · An authorized Condition1 dealer.</div>
      </footer>
    </div>
  </div>

  <dialog class="supply-notice" id="supply-notice" aria-labelledby="supply-notice-title" aria-describedby="supply-notice-desc">
    <h2 id="supply-notice-title" class="supply-notice__title">Fulfillment notice</h2>
    <p id="supply-notice-desc" class="supply-notice__body">
      At this time our case orders will be filled once supplies are available.
      <strong class="supply-notice__estimate">Current estimate: 1 to 2 weeks.</strong>
    </p>
    <form method="dialog">
      <button type="submit" class="btn-secondary supply-notice__ok">Continue</button>
    </form>
  </dialog>

  <script src="js/site.js"></script>
</body>
</html>
"""
    OUT.write_text(page, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT.relative_to(ROOT)} ({len(sections)} sections)")


if __name__ == "__main__":
    main()
