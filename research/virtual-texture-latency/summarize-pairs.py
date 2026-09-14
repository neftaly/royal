"""Summarize counterbalanced pairs; intervals describe these runs only."""
import json
import math
import random
import statistics
from pathlib import Path

root = Path(__file__).parent
result = {}
for device in ("ipad", "quest"):
    reports = [json.loads(p.read_text()) for p in (root / "measurements").glob(f"royal-paired-{device}-*.json")]
    pairs = {}
    for report in reports:
        assert not report.get("error"), report
        run = report["runs"][0]
        gaps = [b - a for a, b in zip([0] + [s["ms"] for s in run["samples"][:-1]], [s["ms"] for s in run["samples"]])]
        run["p95FrameGapMs"] = sorted(gaps)[math.ceil(.95 * len(gaps)) - 1]
        run["newPages"] = run["after"]["pageRequests"] - run["before"]["pageRequests"]
        pairs.setdefault(report["pair"], {})[report["condition"]] = run
    complete = [pair for _, pair in sorted(pairs.items()) if set(pair) == {"on", "off"}]
    entry = {"trials": len(reports), "pairs": len(complete), "metrics": {}}
    for metric in ("firstRequestMs", "firstUploadMs", "detail50Ms", "detail90Ms", "settledMs", "maxFrameGapMs", "p95FrameGapMs"):
        if not complete:
            continue
        off = [pair["off"][metric] for pair in complete]
        on = [pair["on"][metric] for pair in complete]
        differences = [b - a for a, b in zip(off, on)]
        rng = random.Random(4674)
        bootstrap = sorted(statistics.median(rng.choices(differences, k=len(differences))) for _ in range(10000))
        entry["metrics"][metric] = {
            "offMedianMs": statistics.median(off), "onMedianMs": statistics.median(on),
            "pairedMedianDeltaMs": statistics.median(differences),
            "pairedMedianDelta95IntervalMs": [bootstrap[249], bootstrap[9749]],
            "onFasterPairs": sum(value < 0 for value in differences),
        }
    entry["newPageCounts"] = sorted(set(pair[c]["newPages"] for pair in complete for c in ("on", "off")))
    entry["cachedReturnNewReads"] = sum(r["after"]["pageRequests"] - r["before"]["pageRequests"] for report in reports for r in report["runs"][1:])
    result[device] = entry
print(json.dumps(result, indent=2))
