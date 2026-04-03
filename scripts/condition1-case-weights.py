"""One-off: max variant weight (grams) per Condition 1 case # from public product JSON."""
import json
import re
import time
import urllib.request
from xml.etree import ElementTree as ET

NS = {"sm": "http://www.sitemaps.org/schemas/sitemap/0.9"}
CASE_RE = re.compile(r"#(\d{3,4})\b")


def main():
    smap = urllib.request.urlopen("https://condition1.com/sitemap.xml", timeout=30).read()
    root = ET.fromstring(smap)
    prod_urls = []
    for s in root.findall("sm:sitemap", NS):
        loc = s.find("sm:loc", NS)
        if loc is None or "sitemap_products" not in loc.text:
            continue
        u = loc.text.replace("&amp;", "&")
        xml = urllib.request.urlopen(u, timeout=120).read()
        pr = ET.fromstring(xml)
        for url in pr.findall("sm:url", NS):
            loc_el = url.find("sm:loc", NS)
            if loc_el is None:
                continue
            href = loc_el.text.strip()
            if "/products/" in href and href.rstrip("/") != "https://condition1.com/products":
                prod_urls.append(href)

    handles = sorted(
        {href.rstrip("/").split("/products/")[-1] for href in prod_urls if "/products/" in href}
    )
    print("unique product handles", len(handles))

    def max_variant_weight(data):
        wts = []
        for v in data.get("variants") or []:
            w = v.get("weight")
            if w is not None and isinstance(w, (int, float)):
                wts.append(int(w))
        return max(wts) if wts else None

    by_case = {}

    for i, h in enumerate(handles):
        url = "https://condition1.com/products/" + h + ".js"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "RettmarkWeightSurvey/1.0"})
            raw = urllib.request.urlopen(req, timeout=25).read().decode("utf-8", errors="replace")
            data = json.loads(raw)
        except Exception as e:
            print("FAIL", h, e)
            continue
        title = data.get("title") or ""
        nums = CASE_RE.findall(title)
        if not nums:
            continue
        mw = max_variant_weight(data)
        if mw is None:
            continue
        for num in set(nums):
            rec = by_case.setdefault(num, {"max_g": 0, "items": []})
            rec["items"].append((h, title, mw))
            if mw > rec["max_g"]:
                rec["max_g"] = mw
        if (i + 1) % 50 == 0:
            time.sleep(0.25)

    def nkey(k):
        try:
            return int(k)
        except ValueError:
            return 99999

    print()
    print("case# | max_grams | max_lb_approx | example_handle (heaviest)")
    print("------|-----------|---------------|------------------------------")
    for num in sorted(by_case.keys(), key=nkey):
        r = by_case[num]
        mg = r["max_g"]
        lb = mg / 453.59237
        top = [x for x in r["items"] if x[2] == mg]
        handle = top[0][0] if top else r["items"][0][0]
        print(f"{num:>5} | {mg:>9} | {lb:>13.2f} | {handle}")

    if "178" not in by_case:
        print()
        print('No product title matched "#178" in this crawl (case #178 may not exist on the store).')


if __name__ == "__main__":
    main()
