# Example Benchmark Reports

Saved reports for renderer performance work. These are inputs for deciding what to
delete, keep, or change; they are not pass/fail CI fixtures.

Current baselines:

- `host-gltf-kitchen-sink.json`
- `host-gltf-instancing-quick.json`
- `host-generated-vt-load.json`
- `quest2-gltf-kitchen-sink.json`
- `quest2-gltf-instancing-quick.json`
- `quest2-gltf-instancing-texture-pacing.json`
- `quest2-gltf-instancing-camera-drag.json`
- `quest2-gltf-kitchen-sink-texture-pacing-48f.json`
- `quest2-gltf-kitchen-sink-camera-drag.json`

2026-07-05 device pass:

- Quest 2 animated glTF instancing improved from about `77-80ms` p95 in
  `quest2-gltf-instancing-quick.json` to about `22ms` p95 in
  `quest2-gltf-instancing-texture-pacing.json`, with sampled `useProgram`
  dropping to zero and no sampled texture uploads. Instancing is no longer
  texture-upload bound in this benchmark.
- Quest 2 kitchen sink is still the broad renderer stress target. Prefer the
  longer `quest2-gltf-kitchen-sink-texture-pacing-48f.json` over the short
  non-baseline `quest2-gltf-kitchen-sink-texture-pacing.json`: the 12-frame run
  is useful hitch evidence, but its p95 is too sensitive to a few long frames.
  The 48-frame run is complete at about `24ms` p50, `50ms` p95, and `111ms`
  max.
- Quest 2 camera-drag reports show animated instancing redraws around `22ms`
  p95 while static large grids redraw around `36-42ms` p95 when camera movement
  forces work they otherwise skip. Kitchen sink camera movement still carries
  about `238` draw calls/frame and over `1k` GL state changes/frame.
- iPad Safari `2026-07-05T05-48-08-999Z-gltf-instancing.json` is complete at
  about `77ms` p50 and `88ms` p95, improved from the prior `126ms` p95 baseline
  but still well short of a 60fps frame budget. The helmet report is complete
  at about `19ms` p95, with one large early max frame, so keep using focused
  glTF and camera reports before making renderer-wide changes.

Rejected experiments live in subfolders with their own notes so they are not
mistaken for current baselines.

iPad Safari runs collected through `ios_webkit_debug_proxy` go under
`ipad-safari/`. Treat them as device baselines only when `frameStats.complete`
is true and `warnings` is empty or understood.

2026-07-14 iPad Safari pass:

- `2026-07-14T05-24-35-291Z-virtual-texture-stress.json` completed 24/24
  frames at `18ms` p95 on the physical Apple WebGL2 renderer. It converged with
  zero outstanding page requests, page-load failures, manifest failures, GPU
  admission failures, or quarantined bytes.
- `2026-07-14T05-24-54-125Z-gltf-instancing.json` completed 24/24 frames at
  `61ms` p95 while drawing 98,304 sampled instances. That improves on the
  comparable 24-frame July 4 baseline (`126ms` p95), but remains well outside
  a 60fps frame budget and should stay a constrained-device optimization target.
- The SVG route's frame collector completed, but did not attach a WebGL or
  renderer snapshot, so it was rejected rather than saved as device evidence.
