#!/usr/bin/env python3
"""
RQ3 compatibility matrix (and RQ1 visual comparison material).

Renders benchmark.html in static mode in Chromium, Firefox and WebKit via
Playwright, screenshots the sandbox, and classifies every
engine x technique x config x background combination as:

  not-rendered  the loupe looks the same as the engine's own 'none' config
                (the filter graph had no visible effect)
  identical     differs from the reference engine (Chromium) by at most
                --identical-threshold of the loupe's pixels, beyond the difference
                the two engines already show with no filter (font antialiasing etc.)
  differs       renders, but visibly different from the reference
                (a diff image is written for inspection)

Requirements:
    pip install playwright pillow
    python -m playwright install chromium firefox webkit

Usage (serve the repo first, e.g. `python3 -m http.server 8000`):
    python tools/compat_screenshots.py --url http://localhost:8000/benchmark.html --out compat-out

Note: Playwright's WebKit is not Safari. Safari itself must be checked by
opening the same static URLs (printed in the CSV) and screenshotting manually.
"""

import argparse
import csv
import json
import sys
from pathlib import Path
from urllib.parse import urlencode

try:
    from PIL import Image, ImageChops
    from playwright.sync_api import sync_playwright
except ImportError:
    sys.exit("Install dependencies: pip install playwright pillow && python -m playwright install")

ENGINES = ["chromium", "firefox", "webkit"]
TECHNIQUES = ["content", "backdrop", "portal"]
CONFIGS = ["none", "mag", "disp", "disp-3", "disp-5", "disp-7"]
BACKGROUNDS = ["image", "text-dark", "text-light", "checker", "stripes", "colors"]
REFERENCE = "chromium"


MAP_PATH = Path(__file__).resolve().parent.parent / "maps" / "displacement" / "magnification_v2.png"


def lens_mask(w, h):
    """Loupe-shaped mask: the magnification map's alpha, which is what the filter masks with."""
    alpha = Image.open(MAP_PATH).convert("RGBA").getchannel("A").resize((w, h), Image.BILINEAR)
    return alpha.point(lambda v: 255 if v >= 128 else 0)


def changed_fraction(a, b, mask, tolerance):
    """Fraction of loupe pixels whose max channel difference exceeds `tolerance` (0-255)."""
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    channel_max = diff.split()
    m = ImageChops.lighter(ImageChops.lighter(channel_max[0], channel_max[1]), channel_max[2])
    over = m.point(lambda v: 255 if v > tolerance else 0)
    total = sum(1 for v in mask.getdata() if v)
    changed = sum(1 for o, k in zip(over.getdata(), mask.getdata()) if o and k)
    return changed / total if total else 0.0, diff


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://localhost:8000/benchmark.html")
    ap.add_argument("--out", default="compat-out")
    ap.add_argument("--engines", nargs="+", default=ENGINES)
    ap.add_argument("--techniques", nargs="+", default=TECHNIQUES)
    ap.add_argument("--configs", nargs="+", default=CONFIGS)
    ap.add_argument("--backgrounds", nargs="+", default=BACKGROUNDS)
    ap.add_argument("--size", type=int, default=214, help="loupe width in px (107 = demo)")
    ap.add_argument("--tolerance", type=int, default=12, help="per-pixel channel tolerance (0-255)")
    ap.add_argument("--rendered-threshold", type=float, default=0.01,
                    help="min fraction of changed loupe pixels vs 'none' to count as rendered")
    ap.add_argument("--identical-threshold", type=float, default=0.02,
                    help="max fraction of changed loupe pixels vs reference to count as identical")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    out = Path(args.out)
    (out / "shots").mkdir(parents=True, exist_ok=True)
    (out / "diffs").mkdir(parents=True, exist_ok=True)

    configs = args.configs if "none" in args.configs else ["none", *args.configs]
    shots = {}  # (engine, technique, config, bg) -> (path, lens info, url)
    versions = {}

    with sync_playwright() as p:
        for engine in args.engines:
            browser = getattr(p, engine).launch(headless=not args.headed)
            versions[engine] = browser.version
            page = browser.new_page(viewport={"width": 1000, "height": 700}, device_scale_factor=1)
            for technique in args.techniques:
                for bg in args.backgrounds:
                    for config in configs:
                        query = urlencode({"static": 1, "technique": technique, "config": config,
                                           "size": args.size, "bg": bg})
                        url = f"{args.url}?{query}"
                        page.goto(url)
                        page.wait_for_selector('html[data-ready="1"]', timeout=15000)
                        lens = json.loads(page.get_attribute("html", "data-lens"))
                        path = out / "shots" / f"{engine}_{technique}_{bg}_{config}.png"
                        page.locator("#sandbox").screenshot(path=str(path))
                        shots[(engine, technique, config, bg)] = (path, lens, url)
                        print(f"{engine:9} {technique:8} {bg:10} {config}")
            browser.close()

    rows = []
    masks = {}
    for (engine, technique, config, bg), (path, lens, url) in shots.items():
        w, h = round(lens["w"]), round(lens["h"])
        x0, y0 = lens["left"], lens["top"]
        box = (x0, y0, x0 + w, y0 + h)
        mask = masks.setdefault((w, h), lens_mask(w, h))
        crop = Image.open(path).crop(box)

        row = {"engine": engine, "browserVersion": versions[engine], "technique": technique,
               "config": config, "background": bg, "cssAccepted": lens["cssAccepted"],
               "changedVsNone": "", "changedVsReference": "", "baselineVsReference": "",
               "outcome": "", "url": url}

        if config == "none":
            row["outcome"] = "baseline"
        else:
            none_path = shots[(engine, technique, "none", bg)][0]
            vs_none, _ = changed_fraction(crop, Image.open(none_path).crop(box), mask, args.tolerance)
            row["changedVsNone"] = round(vs_none, 4)
            if vs_none < args.rendered_threshold:
                row["outcome"] = "not-rendered"
            else:
                ref = shots.get((REFERENCE, technique, config, bg))
                if ref is None or engine == REFERENCE:
                    row["outcome"] = "reference" if engine == REFERENCE else "rendered"
                else:
                    vs_ref, diff = changed_fraction(crop, Image.open(ref[0]).crop(box), mask, args.tolerance)
                    # Engines already differ without any filter (font antialiasing, image
                    # decoding); subtract that so only filter-caused differences count.
                    base_engine = Image.open(shots[(engine, technique, "none", bg)][0]).crop(box)
                    base_ref = Image.open(shots[(REFERENCE, technique, "none", bg)][0]).crop(box)
                    baseline, _ = changed_fraction(base_engine, base_ref, mask, args.tolerance)
                    row["changedVsReference"] = round(vs_ref, 4)
                    row["baselineVsReference"] = round(baseline, 4)
                    if vs_ref - baseline <= args.identical_threshold:
                        row["outcome"] = "identical"
                    else:
                        row["outcome"] = "differs"
                        # Amplify the difference so subtle shifts are visible.
                        diff.point(lambda v: min(255, v * 4)).save(
                            out / "diffs" / f"{engine}_{technique}_{bg}_{config}.png")
        rows.append(row)

    rows.sort(key=lambda r: (r["technique"], r["config"], r["background"], r["engine"]))
    csv_path = out / "compat.csv"
    with csv_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    # Compact matrix: worst outcome across backgrounds, per technique x config x engine.
    rank = {"not-rendered": 3, "differs": 2, "identical": 1, "reference": 0, "rendered": 0, "baseline": 0}
    print("\nCompatibility matrix (worst outcome over backgrounds)")
    print(f"{'technique':9} {'config':12} " + " ".join(f"{e:13}" for e in args.engines))
    for technique in args.techniques:
        for config in configs:
            if config == "none":
                continue
            cells = []
            for engine in args.engines:
                outs = [r["outcome"] for r in rows
                        if r["engine"] == engine and r["technique"] == technique and r["config"] == config]
                cells.append(max(outs, key=lambda o: rank[o]) if outs else "-")
            print(f"{technique:9} {config:12} " + " ".join(f"{c:13}" for c in cells))
    print(f"\nWrote {csv_path}, screenshots in {out / 'shots'}, diffs in {out / 'diffs'}")
    print("Browser versions:", versions)


if __name__ == "__main__":
    main()