#!/usr/bin/env python3
"""
Merges benchmark JSON exports (from benchmark.html) and produces the RQ2/RQ3 tables.

    python tools/analyze.py results/*.json --out analysis

Writes:
  analysis/summary.csv       pooled stats per environment x technique x config x size
  analysis/max_diameter.csv  largest diameter holding the frame budget per environment x config
  analysis/*.png             frame-interval box plots per environment (only if matplotlib is installed)

Only the standard library is required. Percentiles use linear interpolation
(same as benchmark.js and numpy's default), so numbers match the page.
"""

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path


def percentile(sorted_vals, p):
    if not sorted_vals:
        return math.nan
    h = (len(sorted_vals) - 1) * p
    lo, hi = math.floor(h), math.ceil(h)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (h - lo)


def stats(intervals, refresh_ms, budget_factor):
    s = sorted(intervals)
    n = len(s)
    mean = sum(s) / n if n else math.nan
    budget = refresh_ms * budget_factor
    over = sum(1 for v in intervals if v > budget)
    return {
        "frames": n,
        "meanMs": mean,
        "p50Ms": percentile(s, 0.50),
        "p95Ms": percentile(s, 0.95),
        "p99Ms": percentile(s, 0.99),
        "maxMs": s[-1] if s else math.nan,
        "overBudgetPct": 100 * over / n if n else math.nan,
        "droppedFramesEst": sum(max(0, round(v / refresh_ms) - 1) for v in intervals),
    }


def env_key(run):
    e, s = run["environment"], run["settings"]
    device = s.get("device") or "unknown-device"
    return f"{device} | {e['browser']} {e['version'].split('.')[0]} | {s['technique']}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, default=Path("analysis"))
    ap.add_argument("--holds-pct", type=float, default=None,
                    help="override the 'holds budget' threshold stored in each run (%% of frames over budget)")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    # (env, config, size) -> pooled intervals; runs from the same environment are pooled too.
    pooled = defaultdict(list)
    meta = {}
    for path in args.files:
        run = json.loads(path.read_text())
        key = env_key(run)
        s = run["settings"]
        prev = meta.get(key)
        if prev and abs(prev["refreshMs"] - run["refreshMs"]) > 0.5:
            print(f"warning: {path} has a different refresh interval than earlier runs of {key}")
        meta[key] = {
            "refreshMs": run["refreshMs"],
            "budgetFactor": s["budgetFactor"],
            "holdsPct": args.holds_pct if args.holds_pct is not None else s["holdsPct"],
            "env": run["environment"],
            "settings": s,
        }
        for c in run["cells"]:
            if not c.get("valid", True):
                continue
            g = pooled[(key, c["config"], c["size"])]
            g.append(c)

    summary = []
    for (key, config, size), cells in sorted(pooled.items()):
        m = meta[key]
        intervals = [v for c in cells for v in c["intervals"]]
        st = stats(intervals, m["refreshMs"], m["budgetFactor"])
        first = cells[0]
        summary.append({
            "environment": key,
            "browser": m["env"]["browser"],
            "browserVersion": m["env"]["version"],
            "engine": m["env"]["engine"],
            "device": m["settings"].get("device", ""),
            "os": m["settings"].get("os", ""),
            "gpu": m["env"].get("gpu", ""),
            "dpr": m["env"]["devicePixelRatio"],
            "refreshHz": round(1000 / m["refreshMs"], 2),
            "technique": m["settings"]["technique"],
            "config": config,
            "size": size,
            "repetitions": len(cells),
            "primitives": first["primitives"],
            "displacementPasses": first["displacementPasses"],
            "areaDevice": first["areaDevice"],
            "cssAccepted": all(c.get("cssAccepted", True) for c in cells),
            **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in st.items()},
            "holdsBudget": st["overBudgetPct"] <= m["holdsPct"],
        })

    if not summary:
        raise SystemExit("No valid cells found in the given files.")
    with (args.out / "summary.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(summary[0].keys()))
        w.writeheader()
        w.writerows(summary)

    # Largest diameter where the config holds the budget, requiring all smaller sizes to hold too.
    max_rows = []
    by_env_config = defaultdict(list)
    for r in summary:
        by_env_config[(r["environment"], r["config"])].append(r)
    for (env, config), rows in sorted(by_env_config.items()):
        best = None
        for r in sorted(rows, key=lambda r: r["size"]):
            if not r["holdsBudget"]:
                break
            best = r["size"]
        max_rows.append({"environment": env, "config": config, "maxDiameterPx": best or ""})
    with (args.out / "max_diameter.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["environment", "config", "maxDiameterPx"])
        w.writeheader()
        w.writerows(max_rows)

    # Console overview
    for env in sorted({r["environment"] for r in summary}):
        print(f"\n== {env}  (refresh {1000 / meta[env]['refreshMs']:.1f} Hz)")
        print(f"{'config':12} {'size':>4} {'prim':>4} {'disp':>4} {'p50':>7} {'p95':>7} {'p99':>7} {'over%':>6}  holds")
        for r in (r for r in summary if r["environment"] == env):
            print(f"{r['config']:12} {r['size']:>4} {r['primitives']:>4} {r['displacementPasses']:>4} "
                  f"{r['p50Ms']:>7.2f} {r['p95Ms']:>7.2f} {r['p99Ms']:>7.2f} {r['overBudgetPct']:>6.1f}  "
                  f"{'yes' if r['holdsBudget'] else 'NO'}")

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("\nmatplotlib not installed; skipping plots.")
        return

    for env in sorted({k[0] for k in pooled}):
        sizes = sorted({k[2] for k in pooled if k[0] == env})
        configs = list(dict.fromkeys(k[1] for k in sorted(pooled) if k[0] == env))
        fig, axes = plt.subplots(1, len(sizes), figsize=(4 * len(sizes), 4.5), sharey=True, squeeze=False)
        budget = meta[env]["refreshMs"] * meta[env]["budgetFactor"]
        for ax, size in zip(axes[0], sizes):
            data = [[v for c in pooled.get((env, cfg, size), []) for v in c["intervals"]] for cfg in configs]
            ax.boxplot(data, whis=(1, 99), showfliers=False)
            ax.axhline(budget, color="tab:red", linewidth=1, linestyle="--", label=f"budget {budget:.1f} ms")
            ax.set_xticks(range(1, len(configs) + 1), configs, rotation=60, ha="right", fontsize=8)
            ax.set_title(f"{size}px")
        axes[0][0].set_ylabel("frame interval (ms), whiskers p1–p99")
        axes[0][0].legend(fontsize=8)
        fig.suptitle(env, fontsize=10)
        fig.tight_layout()
        name = "".join(ch if ch.isalnum() else "_" for ch in env)
        fig.savefig(args.out / f"intervals_{name}.png", dpi=150)
        plt.close(fig)
    print(f"\nWrote {args.out}/summary.csv, max_diameter.csv and plots")


if __name__ == "__main__":
    main()