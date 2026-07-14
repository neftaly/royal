# Virtual texture v2 behavior

Date: 2026-07-15

This is the product contract for Royal virtual textures. It deliberately does
not preserve virtual-texture v1 behavior as an oracle.

## Product promise

Virtual texturing lets a surface retain useful detail when only a small part of
a very large image is visible. It must work for ordinary raster art, large
textured ground, and eventually SVG without making any of those source formats
part of the residency system.

Royal decides whether an image should be virtual. Small images stay ordinary.
The public material and UV behavior is the same either way.

## Canonical behavior

- Texture coordinate `(0, 0)` addresses the upper-left of authored content.
  Source decoding normalizes this once; there is no public `flipY` policy.
- Clamp, repeat, mirrored-repeat, colour space, mip filtering, and texture
  transforms match ordinary texture sampling.
- Demand is derived from the projected screen footprint in every active view.
  Stereo uses the maximum demand needed by either eye.
- A surface may approach or cross the near plane, fill the view, be viewed at a
  grazing angle, extend behind the camera, or cover the camera. Those cases
  must produce bounded conservative demand, not disappear or request infinity.
- A close view may request the finest authored detail, but never pages beyond
  the source's finite resolution.
- Newly visible or missing fine pages render from a coarser resident ancestor.
  A page never becomes visible before its upload is complete.
- Page demand, decoding, upload, residency, eviction, and diagnostics have
  independent bounded budgets. One texture cannot monopolize a frame.
- Residency is shared by decoded content identity, not merely by a request URI.
  Replacing bytes behind a stable URI produces a new version and cannot reuse
  stale pages.

## Sources and formats

The runtime consumes one canonical page-source interface. A source reports its
finite size, mip count, colour space, version identity, and asynchronously
produces a requested page with a defined border.

Source adapters may include:

- a pre-tiled authored manifest;
- an ordinary raster image decoded and tiled on demand;
- a KTX2/Basis source whose supported GPU blocks remain compressed;
- a later SVG raster-page producer.

SVG is not special to page selection, coverage, residency, or shaders. Until
the SVG page producer exists, SVG uses only the ordinary browser image path.
Likewise, compression changes page representation and upload, not demand.

## Non-features

- No browser-side image enhancement or invented detail.
- No format-specific residency policy.
- No global resource governor exposed through React.
- No dependency on DOM layout, a visible canvas, or a continuously running
  frame clock.
- No promise that every large image becomes virtual; device capability and
  source economics may keep an image ordinary.
- No runtime resolution of external resources nested inside SVG.

## Stress cases

The conformance suite must cover:

- camera millimetres from a textured plane and camera intersecting that plane;
- an effectively unbounded ground plane at shallow and horizon-grazing angles;
- extreme UV scale, negative UVs, seams, and every wrap mode;
- non-square, one-texel-wide, non-power-of-two, and very large sources;
- discontinuous UV islands and mirrored transforms;
- rapid teleport, fast rotation, stereo disagreement, and XR visibility loss;
- background XR session while a foreground browser view continues rendering;
- slow, failed, aborted, duplicated, or out-of-order page work;
- tiny memory budgets, context loss, version replacement, and source disposal;
- compressed and uncompressed pages producing equivalent visible sampling.

Geometry behind the near plane is clipped for rendering, but coverage
estimation must conservatively clip its projected footprint instead of dropping
the whole primitive. A ground plane is the principal oracle for this rule.

## Acceptance gates

Correctness uses image oracles for sampling and property tests for demand,
budgets, state transitions, and cancellation. Performance uses captured traces
on desktop, iPad, and Quest. A v2 slice is not complete if it merely looks right
in a settled desktop view.

The existing `docs/virtual-textures.md` describes the current v1 implementation
and migration facts. It is not the v2 product contract and should be removed
with v1.
