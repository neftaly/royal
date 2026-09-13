# Bounded traversal for very large repeating UVs

Adversarial review found a main-thread hang in VT demand: when a repeating UV
axis is constant at `2 ** 53` or another sufficiently large finite value, adding
one to its tile index can leave that index unchanged. The loop then never exits,
even after its single requested page is already resident in the demand set.

The regression on the original source exceeded an external 15-second process
timeout (exit 124). The fixed demand suite completes with 24 passing tests.
Four parameterized cases cover positive and negative large coordinates, repeat
and mirrored-repeat, and both axis orientations. They compare demand against the
equivalent zero-offset axis, while the other axis retains a nonzero footprint.

The fix advances a small offset and derives the absolute tile from it. Existing
full-axis saturation means partial repeating axes span at most two tiles;
clamped and saturated axes span one. The offsets therefore advance exactly even
when an absolute UV index cannot. Tile order, seam handling and page insertion
order remain unchanged for ordinary coordinates. No scratch, collections or
cache state were added; the renderer change adds two lines.

A second review checked negative coordinates, mirror parity, independent axis
saturation, inclusive seam traversal and overflow exits. At the tested extreme
magnitudes the represented constant values are even integers, so the zero-offset
reference is appropriate. This does not claim to recover UV precision already
lost in the input or to define GPU sampling accuracy at such magnitudes.

The alternating four-round isolated demand comparison measured median CPU:

| Geometry | Before | After |
| --- | ---: | ---: |
| Coincident triangles | 2238.06 ms | 2260.07 ms |
| Grid | 1430.01 ms | 1421.27 ms |

These approximately 1% differences do not establish a speed improvement or
regression. GC counts vary across rounds; no GC improvement is claimed. This is
a correctness fix. The benchmark measures ordinary clamped UV demand, including
fixture construction, without GPU rendering or decoding.

Validation: 189 VT tests across 13 files, root types and lint, packed package
consumers, and 44 headless Intel Iris Xe source-combination cases pass. The GPU
matrix checks normal source refinement; the enormous-coordinate regression is
covered by the demand tests. The existing package size limit passes. The lazy
gzip output exceeded its prior limit by 8 bytes and deployed gzip by 4 bytes;
a named 16-byte allowance covers this bounded-traversal correctness fix.

Artifacts: [source patch](bounded-tiles.patch),
[source hashes](bounded-tiles-sources.json),
[CPU comparison](bounded-tiles-comparison.json),
[host-GPU regression](bounded-tiles-source-regression.json).
All changes remain uncommitted.
