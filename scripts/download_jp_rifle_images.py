"""Download JP rifle gallery images used on the Rifles page."""
from __future__ import annotations

import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "jp"
OUT.mkdir(parents=True, exist_ok=True)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Hero images chosen from each JP product-page gallery.
FILES = {
    "asf-20.jpg": "https://www.jprifles.com/jp_galleries/1117.jpg",
    "ctr-02.jpg": "https://www.jprifles.com/jp_galleries/1186.jpg",
    "ctr-22lr.jpg": "https://www.jprifles.com/jp_galleries/461.jpg",
    "jp-15.jpg": "https://www.jprifles.com/jp_galleries/760.jpg",
    "jp-15-duty.jpg": "https://www.jprifles.com/jp_galleries/398.jpg",
    "scr-11.jpg": "https://www.jprifles.com/jp_galleries/753.jpg",
    "psc-21.jpg": "https://www.jprifles.com/jp_galleries/1166.jpg",
    "lrp-07.jpg": "https://www.jprifles.com/jp_galleries/993.jpg",
    "mr-19.jpg": "https://www.jprifles.com/jp_galleries/846.jpg",
    "jp-5.jpg": "https://www.jprifles.com/jp_galleries/1153.jpg",
    "gmr-15.jpg": "https://www.jprifles.com/jp_galleries/946.jpg",
    "jp-22r.jpg": "https://www.jprifles.com/jp_galleries/460.jpg",
}


def download(name: str, url: str) -> None:
    dest = OUT / name
    cmd = [
        "curl.exe",
        "-sL",
        "-A",
        UA,
        "-H",
        "Referer: https://www.jprifles.com/",
        "-H",
        "Accept: image/jpeg,image/png,image/*,*/*",
        "-o",
        str(dest),
        url,
    ]
    subprocess.check_call(cmd)
    size = dest.stat().st_size if dest.exists() else 0
    print(f"{name:22} {size:8d}  {url}")
    if size < 8000:
        raise SystemExit(f"too small: {name}")


def main() -> None:
    for name, url in FILES.items():
        download(name, url)


if __name__ == "__main__":
    main()
