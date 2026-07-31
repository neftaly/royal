# Multi-scale depth precision

Status: deferred research; Probability golden path resolved with bounded
conventional clipping.

## Consumer problem

Probability keeps thin, nearby tabletop surfaces stable through explicit
bounds-tracked orbit clipping and an explicit XR depth range. The managed orbit
path derives both planes after view movement while retaining the authored near
plane as its minimum. That bounded policy does not generalize to a scene which
must show geometry from human scale through planetary scale in the same frame.
A very small near plane and very large far plane make physically separate
surfaces resolve to the same depth value.

This is a renderer precision problem, not a reason to expose numeric draw order
or let applications offset authored geometry. Truly coplanar surfaces remain
ambiguous and are outside this proposal.

## Why reversed-Z needs measurement

Royal currently uses conventional `LEQUAL` depth testing. Its private composite
and edge targets use 24-bit fixed-point depth, while direct canvas and
`XRWebGLLayer` depth attachments are browser-owned. Merely reversing the
projection and comparison direction reverses substantially the same
fixed-point quantization; it should not be assumed to provide the large gains
commonly demonstrated with floating-point depth.

The useful Royal experiment should compare complete compatible paths:

1. the current conventional path with tightly fitted near/far planes across
   direct, private-target and browser-owned XR framebuffers;
2. reversed-Z with the same 24-bit attachments, as a control;
3. reversed-Z with floating-point depth attachments;
4. logarithmic depth only if the floating-point reversed-Z result is
   insufficient;
5. partitioned scale/depth passes as an explicit alternative when one frame
   must contain both nearby and astronomical geometry.

The comparison must include the ordinary surface depth target and every depth
consumer, including edge overlays, depth prepasses, compositing, picking,
transmission and context restoration. A mixed convention between those paths
would be incorrect.

## Acceptance experiment

Use deterministic geometry rather than a showcase scene:

- pairs of independently transformed surfaces at known separations;
- camera-to-geometry ratios spanning tabletop through planetary scales;
- perspective and orthographic cameras;
- both shallow and head-on viewing angles;
- a nearby object and a distant object visible in the same frame;
- animated camera motion to expose temporal flicker, not only still-image
  correctness.

For each path, record the smallest stable world-space separation as a function
of camera depth, GPU memory, depth bandwidth, frame time and supported browser /
device coverage. Include at least Chromium, Firefox, iPad Safari and Quest
immersive WebXR.

Adopt a new default only if it materially improves measured separation across
Royal's supported devices without regressing ordinary scenes. Otherwise retain
the current bounded clipping path. Partitioned scale passes remain a separate
consumer requirement rather than a Probability fallback.

## API constraint

Prefer making the best depth convention a renderer default. Do not expose raw
WebGL depth functions, polygon offsets or render-order numbers as the public
solution. If different scale bands require an application decision, the public
primitive should describe those bands or bounds rather than their underlying
GPU state. Do not add a public conventional/reversed depth switch: adoption
requires one renderer-wide invariant with direct canvas and XR compatibility.
