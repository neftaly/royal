# Probability AVIF frame-time decision

Status: reviewed 2026-07-25. No runtime change accepted.

## Evidence

Probability's Settlers workload uses 45 AVIF sources, 94.02 MiB of decoded
base-level RGBA and about 130 MiB of retained mipmapped storage. Its supplied
headed Intel trace reached exact final pixels at 3.120 seconds.

Relevant inclusive trace totals overlap and MUST NOT be added:

- browser-thread `Decode Image`: 407.5 ms over 45 images;
- `GPUTask`: 732.9 ms, with one 84.4 ms task;
- `WebGL`: 449.9 ms;
- command-buffer flush: 627.1 ms; and
- the three largest late Royal animation callbacks: 247.4, 145.9 and 77.6 ms.

Those callbacks contain ten synchronous `getProgramiv(LINK_STATUS)` waits
totaling 368.7 ms; GPU-side program links total 268.7 ms. The worst callbacks
are therefore not evidence that the 32 MiB texture-upload allowance itself
consumed the same wall time. Upload, mip generation, shader compilation and
command-buffer synchronization overlap.

The raw trace is `/tmp/probability-settlers-headed-trace.json.gz` on the
measurement machine.

## Decisions

- Keep deterministic per-frame byte admission. CPU submission time cannot
  observe queued GPU completion. A time-aware policy would require delayed,
  non-disjoint GPU timer evidence and must improve both exact-final and worst
  frame on representative devices.
- Keep one complete ordinary mipmapped representation. Publishing a base level
  with a temporary non-mipmap sampler would add another completeness state,
  visible transition and the same eventual mip-generation work.
- Do not expose an application upload knob.
- Keep offline complete compressed mip pyramids as the less-work path.

A synchronous experiment started all links in a publication batch before
querying status. It was fully reverted after its first trace failed to remove
the waits reliably. A planned five-run comparison became invalid when
Probability changed source and emitted repeated HMR/create-root failures during
the measurement window; those numbers are intentionally not reported as an
A/B.

The next valid shader experiment is a pending-program lifecycle using
[`KHR_parallel_shader_compile`](https://registry.khronos.org/webgl/extensions/KHR_parallel_shader_compile/).
It must retain the currently drawable program during texture promotion and
prove physical Safari 17, Quest 2 and fallback-browser behavior. It is a
separate shader-lifecycle investigation, not an accepted texture change.
