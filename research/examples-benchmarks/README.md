# Example Benchmark Reports

Saved reports for renderer performance work. These are inputs for deciding what to
delete, keep, or change; they are not pass/fail CI fixtures.

Every current examples server publishes `/__royal-source.json`, and the same
`buildId`, full Git revision, dirty flag, and build timestamp are embedded in
each in-page benchmark report. The iPad Safari harness fetches that endpoint
before attaching and rejects a report whose embedded `buildId` differs. This is
the authority for the code under test; a URL, open tab, or remembered dev-server
start time is not sufficient evidence.

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

2026-07-15 iPad Safari orientation pass:

- `ipad-safari/2026-07-15T03-42-06-461Z-virtual-texture-stress.json` retains
  one renderer root across a physical landscape-to-portrait turn. The viewport
  changed from `1024x698` to `768x954` at DPR 2, the canvas backing dimensions
  tracked its CSS size in both orientations, the renderer advanced from frame
  27 to 30 without a lifecycle interruption, and VT reconverged to zero pending
  pages with no Royal or WebGL errors.

2026-07-15 iPad Safari advanced-material pass:

- `ipad-safari/2026-07-15T04-09-09-061Z-gltf-lab.json` renders the official
  Khronos `CompareDispersion` asset for 24/24 sampled frames at `29ms` p95.
- `ipad-safari/2026-07-15T04-16-04-770Z-gltf-lab.json` renders the official
  Khronos `CompareTransmission` asset for 24/24 sampled frames at `18ms` p95,
  with one framebuffer-to-texture copy in the sampled frame, no resource
  denials, no WebGL errors, and an available renderer lifecycle. This run
  validates that GPU-local framebuffer copies are measured by the GL trace but
  no longer consume the CPU-to-GPU upload governor budget.

2026-07-20 iPad Safari resource-floor pass:

- `ipad-safari/2026-07-19T18-53-59-935Z-gltf-scenes.json` completes the 52.7 MB
  Sponza scene on the physical A10/iPadOS 17.7 floor for 12/12 frames at `17ms`
  p95. The portable 256 MiB persistent-GPU ceiling retains 210,238,614 bytes,
  fits 68 of 69 ordinary textures, and denies no claims. A preceding 512 MiB
  run left WebKit unresponsive past its bounded measurement window. The one
  retained diagnostic is WebKit's delayed module-preload warning while texture
  completion takes 12.2 seconds; it is not a Royal runtime or WebGL failure.
- `ipad-safari/2026-07-19T18-54-12-080Z-gltf-ghostscript-tiger-svg.json`
  completes 12/12 frames at `17ms` p95 with no browser diagnostics or resource
  denials.
- `ipad-safari/2026-07-19T18-54-27-468Z-virtual-texture-stress.json` completes
  12/12 frames at `18ms` p95. VT settles with five resident pages and zero
  pending pages, page failures, manifest failures, diagnostics, or GPU denials.

2026-07-22 iPad Safari Bistro document-scene pass:

- Exact clean commit `700e3ad0` exercises all three glTF document scenes through
  the public example selector at a `1404x1418` backing size. Exterior (scene 0)
  completes 30/30 moving frames at `37ms` p95 with 146 primitives and 202/202
  textures; Interior (scene 1) completes at `35ms` with 74 primitives and
  111/111 textures; Interior Wine (scene 2) completes at `25ms` with 381
  primitives and 110/110 textures. Every run has zero image failure, GPU
  admission denial, or lifecycle interruption. The three adjacent PNG captures
  retain the final physical pixels for fidelity comparison.
- The bounded 30-second cold Exterior attempt is retained as
  `2026-07-21T17-26-37-474Z-gltf-bistro-web-scene-exterior.failure.json`: it
  reached first usable content but only 139/202 textures before the deadline.
  The accepted rerun reports first usable at 4.0 seconds and texture completion
  at 41.7 seconds, so startup remains a real workload limit rather than a
  benchmark-harness or stale-page artifact.
- `ipad-safari/2026-07-21T18-39-39-608Z-gltf-bistro-web.json` is the exact clean
  `b4b62d75` cold-cache attribution run after isolating each measured document
  through `about:blank`. It records all 891 WebKit request lifecycles, including
  exactly 202 unique AVIF assets and 404 internal blob reads, with zero failed or
  pending requests and no browser errors. Safari's page Resource Timing API
  still stops at 150 entries despite accepting a 10,000-entry buffer, so the
  inspector Network trace is the authority. The 202 AVIF fetch starts span 38.3
  seconds (9.3 to 47.6 seconds after navigation), while individual fetches are
  mostly short (`152ms` median, `406ms` p95). This attributes the 46.5-second
  texture settlement primarily to the bounded fetch/decode job pipeline rather
  than 41 MB of network transfer. The adjacent PNG matches the prior physical
  Exterior capture; 12/12 moving frames complete at `33ms` p95.

2026-07-25 iPad Safari texture-read-ahead integration:

- `ipad-safari/2026-07-24T17-24-58-691Z-gltf-scenes.json` is the exact clean
  `9f697918` cold-cache Sponza run. It reaches first usable geometry at 6.656
  seconds, settles 69/69 images at 8.656 seconds, retains 197,852,340 ordinary
  texture bytes within 232,666,368 total persistent bytes, and records no
  fallback, image failure, GPU denial, lifecycle interruption, warning, or
  application browser diagnostic. Full-DPR camera motion completes 24/24
  samples at `27ms` p95 while the host is under ordinary concurrent workload;
  48 measured renderer callbacks total 66 ms and peak at 5 ms. The adjacent PNG
  retains the final texture-coherent physical pixels.

2026-07-14 Quest 2 Browser pass:

- `quest2-virtual-texture-stress-2026-07-14.json` completed 24/24 frames at
  `11.2ms` p95 on the physical Adreno 650, with camera-drag draw latency also at
  `11.2ms` p95 and one draw per moved frame.
- The close-view follow-up drove that same 8-by-8-metre plane from distance 11
  to the orbit control's 0.1 minimum. The transition admitted and uploaded eight
  additional mip-0/1 pages (13 resident total), completed with no pending
  requests, browser errors, VT failures, overflow, or quarantined bytes, and
  retained a canvas screenshot. The approach took about `800ms`; its 52-frame
  sample was `33.3ms` p95 before returning to `11.4ms` p95 steady-state. The
  trace attributes the long approach frames to renderer redraw/page-upload work,
  so close-view transition pacing remains a concrete optimization slice even
  though residency and rendering are correct.
- `quest2-virtual-texture-pressure-2026-07-15.telemetry.json` records the
  foreground Adreno 650 smoke that exercised overview/focus presets, close/far
  zoom, cache reactivation, pan, native-DPR resize, and orientation changes.
  The smoke passed fixed atlas allocation while more pages were uploaded than
  its 24 physical slots could retain, exact VT governor accounting, zero
  quarantined bytes, and stable residency for the protected ordinary texture.
  The telemetry wrapper completed with exit code 0, no probe failures, no
  thermal throttling, and the Quest charging at 73%.
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
  Quest logged one `glFramebufferTexture2DMultisample` `GL_INVALID_OPERATION` warning
  during XR framebuffer setup, so frame pacing and that browser/driver warning
  remain an optimization/diagnostic target rather than a correctness gate.
  Reports declaring real XR are rejected unless activation succeeds and
  physical XR-session frames exist.
- `quest2-webxr-vr-vt-2026-07-14.json` reran the physical session after adding
  a 20-by-20-metre explicit-VT ground plane and generated-VT SVG board. It
  completed 24/24 stereo XR frames at `20.6ms` p95 with no renderer admission,
  page, manifest, or generated-page failures. The renderer converged with 18
  cached pages across both VT resources; the SVG path generated five demanded
  pages rather than rasterizing its 5,461-page logical target eagerly. The
  trace kept measured XR JavaScript callbacks below `7.5ms` apart from one
  startup callback, so the remaining frame interval is outside the main
  renderer callback. Quest still emits the known multisample framebuffer
  `GL_INVALID_OPERATION` warning during XR setup.
