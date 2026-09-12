"""Run with python3; requires Pillow and ASTCENC pointing to Arm's astcenc binary."""
import json, os, platform, re, statistics, subprocess, time
from pathlib import Path
from PIL import Image
encoder = os.environ['ASTCENC']
scratch = Path('node_modules/.cache/royal-native-bench')
scratch.mkdir(parents=True, exist_ok=True)
sources = {
    'tiger': 'apps/examples-react/public/fixtures/gltf-svg-texture/ghostscript-tiger-fallback.png',
    'sponza': 'apps/examples-react/public/fixtures/scenes/Sponza/glTF/8006627369776289000.png',
}
results = []
for name, source in sources.items():
    image = Image.open(source).convert('RGBA')
    for extent in [136, 1024]:
        source_png = scratch / f'{name}-{extent}.png'
        image.resize((extent, extent), Image.Resampling.LANCZOS).save(source_png)
        for block in [6, 8]:
            for quality in ['fastest', 'fast', 'medium']:
                output = scratch / f'{name}-{extent}-{block}-{quality}.astc'
                timings, wall = [], []
                for trial in range(4):
                    start = time.perf_counter()
                    result = subprocess.run([encoder, '-cs', str(source_png), str(output), f'{block}x{block}', f'-{quality}', '-j', '1'], capture_output=True, text=True, check=True)
                    elapsed = (time.perf_counter() - start) * 1000
                    seconds = float(re.search(r'Coding time:\s*([\d.]+)', result.stdout)[1])
                    if trial:
                        timings.append(seconds * 1000)
                        wall.append(elapsed)
                results.append(dict(source=name, extent=extent, block=block, quality=quality,
                                    encodeMedianMs=statistics.median(timings), wallMedianMs=statistics.median(wall),
                                    bytes=output.stat().st_size-16, threads=1, samples=3))
                print(name, extent, block, quality, statistics.median(timings), flush=True)
cpu = re.search(r'model name\s*:\s*(.*)', Path('/proc/cpuinfo').read_text())[1] if Path('/proc/cpuinfo').exists() else platform.processor()
report = dict(cpu=cpu, machine=platform.machine(),
              encoder=subprocess.run([encoder, '-version'], capture_output=True, text=True).stdout.strip(),
              sources=sources, results=results)
Path('research/native-texture-formats/encoding-results.json').write_text(json.dumps(report, indent=2)+'\n')
