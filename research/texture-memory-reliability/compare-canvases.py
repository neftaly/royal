"""Compare stable canvas captures; requires Pillow. Exit nonzero on visual drift."""
import argparse
import json
from PIL import Image, ImageChops, ImageStat

parser = argparse.ArgumentParser()
parser.add_argument('before')
parser.add_argument('after')
parser.add_argument('--max-mean', type=float, default=0.1)
parser.add_argument('--max-changed-fraction', type=float, default=0.002)
args = parser.parse_args()
before = Image.open(args.before).convert('RGBA')
after = Image.open(args.after).convert('RGBA')
if before.size != after.size:
    raise SystemExit('Canvas sizes differ')
diff = ImageChops.difference(before, after)
mean = ImageStat.Stat(diff).mean
changed = sum(max(pixel) > 8 for pixel in diff.getdata())
fraction = changed / (before.width * before.height)
passed = max(mean) <= args.max_mean and fraction <= args.max_changed_fraction
print(json.dumps({'size': before.size, 'meanAbsoluteRgba': mean,
                  'pixelsOver8': changed, 'changedFraction': fraction,
                  'maxMean': args.max_mean, 'maxChangedFraction': args.max_changed_fraction,
                  'passed': passed}, indent=2))
raise SystemExit(0 if passed else 1)
