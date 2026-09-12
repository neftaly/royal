"""Generate reproducible offline scene fixtures; requires Pillow, NumPy and astcenc."""
import importlib.util
import json
import os
from pathlib import Path
import sys
from PIL import Image, ImageDraw

sys.dont_write_bytecode = True
here = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('baker', here.parents[1] / 'scripts/bake-vt-pages.py')
baker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(baker)
output = here / 'generated'
output.mkdir(exist_ok=True)
image = Image.new('RGBA', (1024, 1024), 'white')
draw = ImageDraw.Draw(image)
for y in range(0, 1024, 8):
    for x in range(0, 1024, 8):
        draw.rectangle((x, y, x + 7, y + 7), fill=(230, 70, 30) if (x // 8 + y // 8) % 2 else (20, 110, 220))
draw.rectangle((256, 256, 768, 768), fill='white')
draw.text((300, 450), 'ROYAL VT\n1024 x 1024', fill='black', font_size=52)
image.save(output / 'artwork.png')
(output / 'artwork.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="8192" height="8192" viewBox="0 0 1024 1024"><defs><pattern id="p" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#146edc"/><path d="M0 0h8v8H0zM8 8h8v8H8z" fill="#e6461e"/></pattern></defs><rect width="1024" height="1024" fill="url(#p)"/><rect x="256" y="256" width="512" height="512" fill="white"/><text x="300" y="500" font-size="52">ROYAL SVG</text></svg>')
reports = {}
for encoding in ['image', 'astc-6x6', 'astc-8x8']:
    destination = output / encoding
    if destination.exists():
        raise SystemExit(f'Remove generated fixture tree before regenerating: {destination}')
    reports[encoding] = baker.bake(output / 'artwork.png', destination, encoding,
        os.environ.get('ASTCENC', 'astcenc'), 'fastest')
(output / 'report.json').write_text(json.dumps(reports, indent=2) + '\n')
print(json.dumps(reports))
