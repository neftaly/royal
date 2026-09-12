"""Offline PNG -> Royal VT2 PNG or native ASTC pages. Requires Pillow + NumPy.

ASTC additionally requires Arm astcenc (ASTCENC environment variable or --encoder).
This tool and its dependencies are never imported by the renderer.
"""
import argparse
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import tempfile

import numpy as np
from PIL import Image


def astc_ktx2(raw, extent, block):
    """Wrap an astcenc LDR block stream in an unsupercompressed, single-level KTX2."""
    expected = math.ceil(extent / block) ** 2 * 16
    if (raw[:4] != bytes.fromhex('13aba15c') or raw[4:7] != bytes([block, block, 1])
            or int.from_bytes(raw[7:10], 'little') != extent
            or int.from_bytes(raw[10:13], 'little') != extent
            or int.from_bytes(raw[13:16], 'little') != 1 or len(raw) != expected + 16):
        raise ValueError('Unexpected ASTC header or payload size')
    data = bytearray(160)
    data[:12] = bytes.fromhex('ab4b5458203230bb0d0a1a0a')
    for offset, value in [(12, {6: 166, 8: 172}[block]), (16, 1), (20, extent),
                          (24, extent), (36, 1), (40, 1), (48, 104), (52, 44), (104, 44)]:
        struct.pack_into('<I', data, offset, value)
    struct.pack_into('<QQQ', data, 80, 160, expected, expected)
    struct.pack_into('<HH', data, 112, 2, 40)
    data[116:125] = bytes([162, 1, 2, 0, block - 1, block - 1, 0, 0, 16])
    data[134] = 127
    struct.pack_into('<I', data, 144, 0xffffffff)
    return data + raw[16:]


def linear_pixels(image):
    rgba = np.asarray(image.convert('RGBA'), dtype=np.float32) / 255
    rgb = rgba[..., :3]
    rgba[..., :3] = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    rgba[..., :3] *= rgba[..., 3:4]
    return rgba


def srgb_pixels(linear):
    alpha = linear[..., 3:4]
    rgb = np.divide(linear[..., :3], alpha, out=np.zeros_like(linear[..., :3]), where=alpha > 0)
    rgb = np.clip(rgb, 0, 1)
    rgb = np.where(rgb <= .0031308, rgb * 12.92, 1.055 * rgb ** (1 / 2.4) - .055)
    return np.rint(np.concatenate((rgb, alpha), axis=2).clip(0, 1) * 255).astype(np.uint8)


def padded_page(pixels, x, y, size, border, wrap):
    height, width = pixels.shape[:2]
    xs = np.arange(x * size - border, (x + 1) * size + border)
    ys = np.arange(y * size - border, (y + 1) * size + border)
    if wrap == 'repeat':
        xs %= width
        ys %= height
    else:
        xs = xs.clip(0, width - 1)
        ys = ys.clip(0, height - 1)
    return pixels[ys[:, None], xs]


def bake(source, output, encoding='image', encoder='astcenc', quality='medium', wrap='clamp-to-edge'):
    # Refuse existing destinations: interrupted/older page trees must never be
    # silently combined with a new manifest. Publish manifest only after success.
    with Image.open(source) as image:
        if image.format != 'PNG':
            raise ValueError('Input must be a PNG authored in sRGB')
        width, height = image.size
        if any(n > 16384 or n < 1 or n & (n - 1) for n in (width, height)):
            raise ValueError('Offline baker currently requires power-of-two dimensions <= 16384')
        pixels = linear_pixels(image)
    block = {'image': None, 'astc-6x6': 6, 'astc-8x8': 8}[encoding]
    size, border = 128, (4 if block == 8 else 2)
    extent = size + border * 2
    output.mkdir(parents=True, exist_ok=False)
    mip, byte_count, page_count = 0, 0, 0
    with tempfile.TemporaryDirectory(prefix='royal-vt-bake-') as scratch:
        scratch = Path(scratch)
        while True:
            rgba = srgb_pixels(pixels)
            h, w = rgba.shape[:2]
            folder = output / str(mip)
            folder.mkdir()
            for y in range(math.ceil(h / size)):
                for x in range(math.ceil(w / size)):
                    page = Image.fromarray(padded_page(rgba, x, y, size, border, wrap))
                    if block is None:
                        destination = folder / f'{x}-{y}.png'
                        page.save(destination)
                    else:
                        page.save(scratch / 'page.png')
                        subprocess.run([str(encoder), '-cs', str(scratch / 'page.png'), str(scratch / 'page.astc'),
                                        f'{block}x{block}', f'-{quality}', '-j', '1'], check=True, stdout=subprocess.DEVNULL)
                        destination = folder / f'{x}-{y}.ktx2'
                        destination.write_bytes(astc_ktx2((scratch / 'page.astc').read_bytes(), extent, block))
                    byte_count += destination.stat().st_size
                    page_count += 1
            if max(w, h) <= size:
                break
            # Linear-light, premultiplied-alpha box filtering across the entire
            # mip before slicing avoids seams and dark transparent-edge halos.
            if h > 1:
                pixels = (pixels[::2] + pixels[1::2]) * .5
            if w > 1:
                pixels = (pixels[:, ::2] + pixels[:, 1::2]) * .5
            mip += 1
    manifest = dict(contractVersion=2, virtualSize=[width, height], pageSize=size,
                    borderTexels=border, mipCount=mip + 1, colorSpace='srgb',
                    pageEncoding='image' if block is None else 'ktx2-' + encoding,
                    pages=dict(uriTemplate='{mip}/{x}-{y}.' + ('png' if block is None else 'ktx2')))
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return dict(pages=page_count, mipCount=mip + 1, storedExtent=extent, fileBytes=byte_count, wrap=wrap)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--format', choices=['image', 'astc-6x6', 'astc-8x8'], default='image')
    parser.add_argument('--encoder', default=os.environ.get('ASTCENC', 'astcenc'))
    parser.add_argument('--quality', choices=['fastest', 'fast', 'medium', 'thorough'], default='medium')
    parser.add_argument('--wrap', choices=['clamp-to-edge', 'repeat'], default='clamp-to-edge')
    args = parser.parse_args()
    print(json.dumps(bake(args.source, args.output, args.format, args.encoder, args.quality, args.wrap)))
