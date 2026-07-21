# Ghostscript tiger SVG texture fixture

`ghostscript-tiger.svg` is `Ghostscript Tiger.svg` by Ghostscript authors,
derived from GPL Ghostscript `tiger.eps`.

Source: https://commons.wikimedia.org/wiki/File:Ghostscript_Tiger.svg

License: AGPL-3.0-or-later.

The upstream SVG remains byte-for-byte unchanged in this fixture (SHA-256
`5211e169283f43ab8ad7ea7998d917d5fbb3c568ac85c1a0217e86792822684d`).
`ghostscript-tiger-fallback.png` is a 256×256 raster derivative under the same
license. The generated glTF card prefers the SVG through experimental
`GS_texture_svg` and exposes that PNG as its ordinary core fallback.
