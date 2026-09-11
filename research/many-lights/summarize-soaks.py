"""Summarize preserved soak evidence without treating fence timings as GPU timers."""
import gzip
import json
from pathlib import Path
from statistics import median

root = Path(__file__).parent
summary = {}
for device in ('ipad', 'quest'):
    source = root / f'{device}-soak-results.json'
    compressed = source.with_suffix('.json.gz')
    raw = source.read_bytes() if source.exists() else gzip.decompress(compressed.read_bytes())
    data = json.loads(raw)
    groups = {}
    maximum_difference = 0
    for cycle in data['cycles']:
        for case in cycle['result']['results']:
            if 'completionMs' not in case:
                continue
            key = (case['kind'], case['count'], case['mode'])
            groups.setdefault(key, []).append(case['completionMs']['median'])
            for comparison in case['parity']:
                maximum_difference = max(maximum_difference, comparison['maxChannelDifference'])
    summary[device] = {
        'durationMs': data['durationMs'], 'cycles': len(data['cycles']),
        'maxChannelDifference': maximum_difference,
        'metric': 'Batched fence completion milliseconds per draw; not an exact GPU timer',
        'results': [dict(kind=k[0], count=k[1], mode=k[2], samples=len(v),
                         medianMs=median(v), firstQuarterMedianMs=median(v[:len(v)//4]),
                         lastQuarterMedianMs=median(v[-len(v)//4:]))
                    for k, v in sorted(groups.items())],
    }
    if not compressed.exists():
        compressed.write_bytes(gzip.compress(raw, mtime=0))
    if source.exists():
        source.unlink()
(root / 'soak-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({k: {a: b for a, b in v.items() if a != 'results'} for k, v in summary.items()}, indent=2))
