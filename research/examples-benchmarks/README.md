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
- `ipad-safari/2026-07-14T06-20-35-959Z-gltf-ghostscript-tiger-svg.json`
  completed 24/24 frames at `18ms` p95 with no browser diagnostics and an
  available renderer lifecycle. Apple WebKit keeps decoded SVG on the ordinary
  texture path because repainting the same SVG through Canvas 2D produces
  origin-unclean pixels there; the accepted run has zero generated-VT requests,
  failures, or allocations.

2026-07-14 Quest 2 Browser pass:

- `quest2-virtual-texture-stress-2026-07-14.json` completed 24/24 frames at
  `11.2ms` p95 on the physical Adreno 650, with camera-drag draw latency also at
  `11.2ms` p95 and one draw per moved frame.
- `quest2-gltf-instancing-2026-07-14.json` keeps 4,096 animated instances near
  `35ms` p95. Camera-driven static grid redraws are about `33ms` p95 at grid 16,
  while grid 8 camera redraws are about `11ms` p95; constrained-device
  instancing remains the clearest renderer optimization target.
- `quest2-gltf-ghostscript-tiger-svg-2026-07-14.json` completed 24/24 frames at
  `11.3ms` p95 with clean browser diagnostics. Camera-driven redraws completed
  24/24 at `10.8ms` draw p95 and one draw per moved frame.
- `quest2-webxr-vr-2026-07-14.json` activated one real immersive session and
  completed 24/24 physical XR frames at `47.5ms` p95. Physical probing found
  that automatically calling the optional `offerSession()` alongside an
  explicit Enter XR control can occupy Quest's sole immersive-session slot; the
  example now uses only the standard trusted `requestSession()` path. A
  background XR session can independently retain that same slot while Browser
  is foregrounded, and the harness reports that lifecycle state separately.
  Quest
  logged one `glFramebufferTexture2DMultisample` `GL_INVALID_OPERATION` warning
  during XR framebuffer setup, so frame pacing and that browser/driver warning
  remain an optimization/diagnostic target rather than a correctness gate.
  Reports declaring real XR are rejected unless activation succeeds and
  physical XR-session frames exist.
