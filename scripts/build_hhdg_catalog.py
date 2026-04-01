"""
Fetch HHDG Frames category, write js/hhdg-frames.json, regenerate PDP HTML.

**Default (assets-only):** does not download images. Uses whatever is already in
``assets/hhdg/``, syncs JSON to those files, and deletes unreferenced images there.

To pull images from Hunters HD Gold again (old behavior):

  set HHDG_DOWNLOAD_IMAGES=1

Run from repo root: python scripts/build_hhdg_catalog.py
"""
from __future__ import annotations

import html as html_lib
import json
import os
import re
import sys
import time
import urllib.request

_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPT_DIR not in sys.path:
    sys.path.insert(0, _SCRIPT_DIR)
from hhdg_assets_util import main_image_for_pid, prune_orphan_hhdg_files, sync_product
from hhdg_pdp import HHDG_RX_ORDERING_ANCHOR, enrich_product, render_product_html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "https://huntershdgold.com/store/HHDG-Frames-c74140615"
JSON_PATH = os.path.join(ROOT, "js", "hhdg-frames.json")
IMG_DIR = os.path.join(ROOT, "assets", "hhdg")
PAGE_PATH = os.path.join(ROOT, "shooting-glasses.html")


def _download_hhdg_images() -> bool:
    v = os.environ.get("HHDG_DOWNLOAD_IMAGES", "").strip().lower()
    return v in ("1", "true", "yes", "on")


def fetch_html() -> str:
    req = urllib.request.Request(
        URL,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        return r.read().decode("utf-8", "replace")


def strip_hdg_store_urls(text: str) -> str:
    t = re.sub(r"https?://\S*huntershdgold\.com\S*", "", text or "", flags=re.I)
    return re.sub(r"\s{2,}", " ", t).strip()


def extract_category_page_meta(html: str) -> tuple[str | None, str | None]:
    """Title and meta description from the HHDG category page (Ecwid storefront)."""
    tm = re.search(r"<title>([^<]+)</title>", html, re.I)
    title = html_lib.unescape(tm.group(1).strip()) if tm else None
    if title and "|" in title:
        title = title.split("|")[0].strip()
    dm = re.search(
        r'<meta\s+name="description"\s+content="([^"]*)"', html, re.I
    )
    desc = html_lib.unescape(dm.group(1).strip()) if dm else None
    if desc:
        desc = strip_hdg_store_urls(desc)
    return title, desc


def parse_products(html: str) -> list[dict]:
    parts = re.split(r'<div class="grid-product grid-product--id-', html)
    products: list[dict] = []
    for chunk in parts[1:]:
        pid_m = re.match(r"(\d+)", chunk)
        if not pid_m:
            continue
        pid = pid_m.group(1)
        block = chunk[:14000]

        href_m = re.search(
            r'href="(https://huntershdgold\.com/store/[^"]+)" class="grid-product__image"',
            block,
        )
        img_m = re.search(
            r'src="(https://d2j6dbq0eux0bg\.cloudfront\.net/images/[^"]+)"[^>]*class="grid-product__picture"',
            block,
        )
        if not img_m:
            img_m = re.search(
                r'<img[^>]+src="(https://d2j6dbq0eux0bg\.cloudfront\.net/images/[^"]+)"[^>]*class="grid-product__picture"',
                block,
            )
        title_m = re.search(
            r'<div class="grid-product__title-inner">([^<]+)</div>',
            block,
        )
        price_m = re.search(
            r'grid-product__price-value[^>]*>.*?(\$\d+(?:\.\d{2})?)',
            block,
            re.DOTALL,
        )
        sub_m = re.search(
            r'<div class="grid-product__subtitle-inner">([^<]+)</div>',
            block,
        )

        if not href_m or not img_m or not title_m:
            continue

        title = html_lib.unescape(title_m.group(1).strip())
        subtitle = html_lib.unescape(sub_m.group(1).strip()) if sub_m else ""
        if "Gift Card" in title:
            continue
        products.append(
            {
                "id": pid,
                "title": title,
                "href": html_lib.unescape(href_m.group(1)),
                "imageRemote": img_m.group(1),
                "price": price_m.group(1) if price_m else "",
                "subtitle": subtitle,
            }
        )
    return products


def download_file(url: str, dest: str) -> None:
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=90) as r, open(dest, "wb") as f:
        f.write(r.read())


def card_html(p: dict) -> str:
    title = html_lib.escape(p["title"])
    local_name = (p.get("localPage") or "").strip()
    local = html_lib.escape(local_name) if local_name else ""
    detail_href = local
    detail_target = ""
    src = html_lib.escape(p["imageLocal"])
    price = html_lib.escape(
        p.get("retailPriceDisplay") or p.get("price") or "$299.99"
    )
    sub = (p.get("subtitle") or "").strip()
    if sub:
        line1 = sub
    else:
        line1 = "HHDG frame · Hunters HD Gold"
    sku = html_lib.escape(line1)
    mfr = (p.get("manufacturerSku") or "").strip()
    mfr_html = ""
    if mfr:
        mfr_html = (
            f'\n            <p class="spec" style="margin:6px 0 0 0">Mfr ref '
            f"{html_lib.escape(mfr)}</p>"
        )
    return f"""          <article class="product-card" data-hhdg-id="{html_lib.escape(p["id"])}">
            <a class="ph-thumb" href="{detail_href}"{detail_target} aria-label="View {title} details">
              <img class="ph-thumb-img" src="{src}" alt="{title}" loading="lazy" decoding="async" />
            </a>
            <h3><a href="{detail_href}"{detail_target}>{title}</a></h3>
            <p class="sku">{sku}</p>{mfr_html}
            <p class="price">Price {price}</p>
            <div class="btn-block">
              <a class="btn-secondary btn-secondary--link" href="{detail_href}"{detail_target}>View details</a>
            </div>
          </article>
"""


def write_shooting_page(products: list[dict]) -> None:
    grid = "\n".join(card_html(p) for p in products)
    page_meta_desc = "Hunters HD Gold HHDG frames — in stock at Rettmark Firearms."
    page_meta_esc = html_lib.escape(page_meta_desc)

    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <base href="/" />
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Shooting Glasses | Rettmark Firearms</title>
  <meta name="description" content="{page_meta_esc}" />
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
      <a href="shooting-glasses.html" aria-current="page">Shooting Glasses</a>
      <a href="contact.html">Contact</a>
    </nav>
    <a class="cart-pill" href="cart.html" title="Shopping cart" aria-label="Shopping cart, 0 items">Cart <span class="cart-count">0</span></a>
  </header>

  <div class="page-shell" id="main">
    <div class="page">
      <header class="page-intro">
        <h1>Shooting Glasses</h1>
        <p class="lede"><strong>Authorized Hunters HD Gold Dealer</strong></p>
        <p class="lede">
          Rettmark Firearms is proud to offer Hunters HD Gold as an authorized dealer.
        </p>
        <p class="lede">
          For prescription lenses, custom orders, or customization requests, please begin with {HHDG_RX_ORDERING_ANCHOR}.
          When asked &ldquo;How did you find out about Hunters HD Gold?&rdquo; please select <strong>Rettmark Firearms</strong>.
        </p>
        <p class="lede">
          For other questions or availability information, please
          <a class="contact-link" href="contact.html" style="margin-top:0">contact us</a> directly.
        </p>
      </header>

      <section class="panel" aria-label="HHDG frames catalog">
        <div class="product-grid">
{grid}
        </div>
        <p class="cases-disclaimer">
          Prices may change. Hunters HD Gold® protective eyewear is manufactured by Optical Prescription Lab; frames and lenses are designed to meet applicable safety standards when configured as sold. Full specifications, warranty, and safety notices ship with the product or are available on request. Product names and images are property of Hunters HD Gold.
        </p>
      </section>

      <footer class="site-footer">
        <img src="assets/logo-rm.png" alt="" width="512" height="512" decoding="async" />
        <div>© <span id="year"></span> Rettmark Firearms · <a class="contact-link" href="https://rettmarkfirearms.com/" style="margin-top:0">rettmarkfirearms.com</a> · Authorized Condition1 dealer · Hunters HD Gold authorized dealer.</div>
      </footer>
    </div>
  </div>

  <script src="js/site.js"></script>
</body>
</html>
"""
    with open(PAGE_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    print("wrote", PAGE_PATH)


def main() -> None:
    raw = fetch_html()
    products = parse_products(raw)
    cat_title, _cat_desc = extract_category_page_meta(raw)
    payload = {
        "source": URL,
        "scrapedFor": "Rettmark Firearms dealer catalog",
        "categoryPage": {
            "title": cat_title,
            "description": "",
        },
        "products": products,
    }
    os.makedirs(os.path.dirname(JSON_PATH), exist_ok=True)
    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    print("products:", len(products), "->", JSON_PATH)

    for p in products:
        p["retailPriceDisplay"] = "$299.99"
        p["retailPriceNum"] = "299.99"

    download_images = _download_hhdg_images()
    for p in products:
        if download_images:
            ext = os.path.splitext(p["imageRemote"].split("?")[0])[1] or ".jpg"
            local = os.path.join(IMG_DIR, f"{p['id']}{ext}")
            if not os.path.isfile(local):
                print("download", p["id"], p["title"][:40])
                try:
                    download_file(p["imageRemote"], local)
                except Exception as e:
                    print("  failed:", e)
            p["imageLocal"] = f"assets/hhdg/{os.path.basename(local)}"
        else:
            found = main_image_for_pid(IMG_DIR, p["id"])
            if found:
                p["imageLocal"] = found
            else:
                ext = os.path.splitext(p["imageRemote"].split("?")[0])[1] or ".jpg"
                p["imageLocal"] = f"assets/hhdg/{p['id']}{ext}"

    for p in products:
        print("PDP:", p["title"][:52])
        ep = enrich_product(p, IMG_DIR, skip_download=not download_images)
        time.sleep(0.4)
        page_out = os.path.join(ROOT, ep["localPage"])
        with open(page_out, "w", encoding="utf-8", newline="\n") as wf:
            wf.write(render_product_html(ep))
        p["localPage"] = ep["localPage"]
        if ep.get("galleryLocal"):
            p["galleryLocal"] = ep["galleryLocal"]
        p["optionGroups"] = ep.get("optionGroups") or []
        p["frameChoiceImages"] = ep.get("frameChoiceImages") or {}
        p["manufacturerSku"] = ep.get("manufacturerSku") or ""
        p["manufacturerListPrice"] = ep.get("manufacturerListPrice") or ""

    if not download_images:
        for p in products:
            sync_product(p, ROOT, IMG_DIR)
        removed = prune_orphan_hhdg_files(products, IMG_DIR, dry_run=False)
        if removed:
            print("pruned orphan assets/hhdg files:", len(removed))

    with open(JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    write_shooting_page(products)


if __name__ == "__main__":
    main()
