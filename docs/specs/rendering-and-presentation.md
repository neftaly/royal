# Rendering and presentation

## Presentation ownership

The renderer root owns canvas pixel size, DPR policy, default framebuffer use,
context attributes, viewport-derived matrices, presentation clock, and all
intermediate targets. Scene descriptors own cameras and display intent but not
the resolved canvas aspect or XR eye transforms.

One scene may be rendered through one or multiple ordered views. Multi-view
rendering is one frame transaction: resource selection and fallbacks are
coherent across views, and the public frame counter advances once.

## WebGL floor

Royal targets WebGL2 and GLSL ES 3.00. Required startup capabilities MUST be
probed from actual context limits and framebuffer completeness. Optional
extensions may improve performance or quality but MUST NOT define different
semantic renderers.

The compatibility floor is Safari 17, including A10-class iPad hardware. Quest
2 is the minimum physical WebXR performance target. Chrome/Firefox and newer
devices are additional coverage, not permission to raise the baseline through
an optional extension.

Portable ETC2/EAC is the compressed texture baseline. Optional ASTC,
anisotropic filtering, parallel shader compilation, timer queries, multiview,
or multi-draw MAY be used behind capability policy. Lack of one optional
extension MUST take a documented fallback path, not a browser-name branch.

## Color and alpha

The working lighting domain is scene-linear HDR where the active material/pass
requires it. Texture decode converts color sources from sRGB exactly once. Data
textures are not converted. Lighting and blending operate in their specified
linear domains. A direct opaque/masked draw applies tone mapping and output
encoding immediately before its destination write; a retained linear pass
applies them once at its terminal presentation edge.

Scene `clearColor` is linear RGBA and defaults to transparent black. Canvas
alpha is a root creation option and does not silently rewrite scene alpha.
Every intermediate texture/pass MUST define whether RGB is scene-linear or
display-referred and whether alpha is straight, premultiplied, or unused.

The default tone map is PBR Neutral; linear clamp is an explicit diagnostic or
display-referred choice. Exposure is EV100, where a higher value produces a
darker image.

Small opaque and alpha-mask scenes present directly, avoiding persistent target
bytes, an extra full-screen sample, and tile-memory traffic. A complex
all-standard scene MAY instead retain one view-sized half-float color/depth
target and move terminal presentation out of every material fragment. The
selection is a stable, GL-free scene classifier with a conservative 32-surface
crossover; it never branches on an asset, route, camera, browser name, or frame
timing. Clean physical Safari measurements on Sponza reduced the camera-drag
average from 32.6 ms to 30.3 ms and p95 from 42 ms to 38 ms while preserving
the exact shared tone map and output encoding; exploratory paired runs showed
larger but thermally variable gains, so they are not the acceptance claim. The
additional target remains budget-governed.

An all-standard scene with alpha-blended draws MAY retain one view-sized
half-float color/depth target so blending occurs before the shared output
transform. That path requires both `EXT_color_buffer_float` and
`EXT_float_blend`; otherwise direct presentation is the stable fallback.
Capability selection and material eligibility are retained lifecycle
decisions, not browser-name tests or per-draw extension queries. The target is
charged to the root persistent GPU budget and released when the need
deactivates. Direct and retained paths consume the same shared transform source
and MUST agree for opaque standard surfaces.

A retained scene with at least 32 fully opaque standard triangle surfaces MAY
run a position-only depth pass before PBR shading when exact-compatible
`WEBGL_multi_draw` is available. A camera inside their aggregate world-space
volume admits the established hidden-fragment case. An outside camera is
admitted only for direct default-framebuffer rendering with more than one
sample and at least 2× retained-bound coverage along the camera's dominant
outside axis. The cold plan owns eligible count, aggregate bounds, and the
three summed candidate-area/aggregate-area ratios; one pure camera decision
keeps frame work allocation-free. A 5% exit margin prevents boundary motion
from repeatedly rebuilding the pass. It is never a route, asset-name,
browser-name, or frame-time branch. Alpha mask, alpha blend, transmission,
lines, and cheap unlit surfaces remain on their single semantic pass because
coverage or pass ordering cannot be reproduced by the position-only program,
or because a second pass has no sound cost case. The depth pass writes no color
and uses the same model,
instance, winding, cull, LOD, bounds, viewport, framebuffer, and depth target as
the later draw. Both vertex programs MUST declare `gl_Position` invariant so
driver optimization cannot make the position-only pass self-occlude the color
pass through cross-program depth drift. Covered color draws then require exact
depth equality; work outside the prepass retains less-or-equal comparison. Its
submission owner, programs,
shaders, and batching scratch load only after the cold classifier admits the
pass. The central state owner represents its color mask and depth comparison
explicitly; no pass may inherit hidden GL state. Without multi-draw, the stable fallback is
the existing front-to-back PBR pass rather than one extra JavaScript draw per
surface.

Clean exact-build Safari 17.14 evidence at commit `df631f9c` validates the
inside-volume cost case. Full-DPR Sponza camera motion fell from the preceding
clean 30.3 ms average / 38 ms p95 to 16.5 / 19 ms over 120 samples. A later
controlled removal reached 39 ms p95, while the camera-volume plan restored the
pass and reached a 17 ms median / 23 ms p95 with the same ~1.2 ms callback cost.
Conversely, the normalized Bistro Exterior camera remains outside the opaque
volume, so the plan keeps its 147-draw single path instead of inferring hidden
fragment savings from 146 scene primitives. Quest remains separately unproven.

A 2026-08-10 physical Safari adversarial A/B first rejected unconditional
outside-camera admission. It improved Probability Settlers by a repeatable
3--4 ms median, but made 120-sample Bistro Exterior worse from 33 / 36 ms
median/p95 to 34 / 38 ms and increased submissions from 147 to 192 per frame.
The retained direct-multisample/2×-coverage classifier then measured Settlers at
33 / 39 ms against a corrected wall-clock-path control at 37 / 44 ms; the
cleaned candidate repeated at 30 / 38 ms. Bistro's single-sample retained
composite excludes the new branch and remained on exactly 147 submissions.
An alternating exact-depth follow-up measured two equality candidates at 27 / 34
and 26 / 34 ms median/p95 versus less-or-equal controls at 28 / 55 and 31 / 38
ms. The first control tail was noisy, but the 1--5 ms median separation survived
order reversal. The result is a material partial gain, not the 16.7 ms
acceptance target.

After the final ordinary canvas pass, Royal invalidates only the default
framebuffer's depth attachment. The renderer owns that depth for the complete
frame, no later canvas pass reads it, and the discard occurs after world,
retained-world restoration, presentation overlay, and edge overlay work.
External framebuffers, including XR, retain their caller-owned lifecycle.
Physical Safari Settlers measured 20 / 25 and 19 / 24 ms median/p95 with this
discard around a 26 / 32 ms immediate control. Bistro retained 147 submissions,
all 202 images, and a pixel-identical capture while completing at 28 / 35 ms.
Discarding the offscreen composite depth before target switching was separately
rejected: Bistro regressed to 33 / 36 ms versus the immediately reverted 24 /
29 ms control, despite RMSE 0 captures.
The retained default-depth path also completed 120/120 full-DPR Sponza camera
frames at 22 / 26 ms median/p95 with all 69 images resident, no failure or
warning, and a clean physical capture. This is cross-scene correctness evidence,
not a replacement floor for earlier faster clean Sponza runs.

Exact clean commit `cc9a749e` confirms the invariant-position correction on
physical Safari 17.14 after the original self-occlusion was reproduced. The
restored depth path retained all 69 Sponza images without failures, completed
120/120 moving samples at 17.125 ms average / 20 ms p95, and remained visually
clean after motion (`2026-07-21T10-18-35-517Z-gltf-scenes.json`).

## Geometry and materials

Royal's simple public materials are standard PBR, unlit, and wireframe. glTF
material extensions remain ingestion data rather than multiplying the public
material taxonomy.

Wireframe uses a portable one-device-pixel presentation and MUST NOT depend on
implementation-defined wide WebGL lines. It shares geometry transforms,
visibility, and picking identity with filled rendering.

Lighting includes directional, point, spot, explicit scene environment, and
asset-scoped fallback environment. Environment precedence is semantic and
independent of asynchronous completion order.

Once every selected material is known to be unlit, canonical lowering erases
environment and direct-light state before resource ownership. Variant and
material-LOD selection use the same pure material-set rule as surface emission,
so an inactive base or alternate material cannot keep IBL work alive. An
unresolved glTF remains conservatively lighting-capable to preserve concurrent
environment preparation for the common lit case.

The current profile does not promise shadow maps, screen-space ambient
occlusion, or another visibility term for direct lights. Directional and
punctual lights are unshadowed; material occlusion textures affect environment
lighting only, as defined by glTF. A lighting-reference image that adds external
shadowing is therefore not a conformance oracle for an otherwise identical
asset. A future shadow path requires its own public behavior, resource budget,
visibility policy, XR cost, and Safari/Quest floor before it can enter this
profile.

### Prefiltered environment profile

`prefilteredEnvironment({ src, version })` names one offline Royal environment
artifact. Royal does not decode an HDR image or convolve an environment at
runtime. The artifact is a little-endian KTX 1 cubemap with packed
`R11F_G11F_B10F` faces, a complete mip pyramid, and one
`royal.environment.v1` metadata entry containing provenance plus nine RGB
spherical-harmonic irradiance coefficients. Faces are square powers of two no
larger than 256 pixels. Unknown, truncated, oversized, or non-canonical
artifacts fail before GPU allocation.

The repository's `scripts/repack-royal-environment.ts` converts the pinned
Filament `cmgen` output described by its `--help` text into this browser-safe
profile. Source generation and repacking are offline concerns; neither tool nor
its source HDR is shipped to an application.

The exact pair `(src, typeof version, version)` is the asset identity. Changing
rotation or radiance scale reuses the prepared artifact and changes only scene
uniforms. While a new identity is fetched and validated, after its load fails,
or when its persistent GPU claim is denied, PBR draws use the deterministic
studio environment. Royal never samples a partial cubemap or stale prior
identity. Successful publication changes diffuse SH and specular cubemap
lighting together on one invalidated frame. Context restoration reuploads the
retained validated bytes without refetching.

Diffuse irradiance is reconstructed from the nine coefficients. Reflected
radiance is sampled from the offline roughness mip pyramid and combined with an
analytic split-sum BRDF approximation; no BRDF lookup texture is retained.
Environment rotation applies to both directions, and `radianceScaleNits`
scales both contributions. The cubemap, sampler, and coefficients have one root
owner and one persistent-budget claim. The parser remains a lazy chunk and no
environment texture, sampler, fetch, or shader variant exists for scenes that
do not select this source.

## Bounded emissive volumes

A `boundedVolume` is a non-pickable emissive participating-medium
approximation. It is not a light and does not scatter directional, point,
environment, or shadow radiance. The WebGL path rasterizes the boundary's back
faces and integrates twelve jittered samples through the analytically clipped
convex interval. Density combines the normalized local-height profile,
local-space procedural noise, the color alpha multiplier, and the authored
inverse-metre extinction coefficient. The resulting Beer-Lambert opacity
blends the scene-linear RGB emission.

Visible volume demand activates the existing full-resolution linear composite
target and a sampleable depth texture. Ordinary terminal-presentation and
transmission composites retain their renderbuffer depth attachment when no
volume is visible. The volume shader and its proxy-resource owner are loaded
only after authored demand, retain exact proxy geometry under the root's
persistent GPU budget, retry a denied claim only after capacity increases, and
release on scene removal or context disposal.

For each view, opaque and masked surfaces establish depth, transmission takes
its opaque scene-color snapshot, bounded volumes render back-to-front while
sampling that opaque depth, then transmission and alpha-blended surfaces
render. Consequently transparent surfaces always appear in front of a volume,
and a volume does not appear in transmission's screen-color source. Overlapping
volumes are ordinary ordered alpha composites rather than a coupled extinction
solve. These ordering limits are part of the current approximation, not a
promise of globally sorted transparent media. Canvas and WebXR use the active
view's projection semantics; an authored orthographic canvas camera does not
override a browser-supplied perspective XR view.

## Pass activation

The renderer privately compiles only passes needed by the visible frame. With
no transmission material, transmission screen-copy/refraction work MUST be
absent. With no PBR/environment use, IBL resources SHOULD remain lazy. With no
VT draw, VT shaders and bindings MUST be absent. With no clustered-light need,
cluster resources MUST NOT be updated.

Alpha-opaque and alpha-mask draws establish normal depth. Transparent and
transmission ordering MUST be deterministic, though perfect global order is not
promised. A material becoming ready MUST NOT leak prior draw state.

Depth-writing transmission is grouped into deterministic exact-state runs and
submitted front-to-back within each run before alpha-blended transmission,
which remains globally back-to-front. Because Royal's screen-space source
contains opaque scene color rather than previously drawn transmission, hidden
opaque transmission cannot contribute to a later surface and SHOULD be rejected
by depth before fragment work. Grouping MUST NOT cross an authored material,
program, binding, transform, geometry, or fixed-state difference.

Framebuffer alpha follows the authored alpha mode, not merely the sampled base
color. `OPAQUE` and surviving `MASK` fragments write alpha one; only `BLEND`
preserves factor/texture/vertex alpha. The choice is a shader feature selected
before submission, so ordinary opaque fragments pay no dynamic mode branch.

## Coplanar surfaces

Royal uses ordinary depth testing and does not infer a presentation order for
separately authored coplanar surfaces. Equal stored depth values pass in draw
order, but mathematically coplanar triangles can rasterize to different depth
values when their geometry, tessellation, or transform paths differ. Draw order
therefore cannot guarantee a continuous winner.

Applications and assets MUST represent distinct world surfaces with distinct
geometry. A small physical separation is the portable representation for a
surface resting visibly above another surface. Royal does not expose numeric
polygon offsets, depth tolerances, render-order fields, or an inferred contact
classification: each can incorrectly override physically distinguishable depth
and would make results depend on batching or backend precision. Depth-independent
presentation belongs in the explicit scene-overlay lane.

## Screen-space complementary coverage

`screenSpacePartition({ cellSizeCssPixels, count, index })` assigns one
material to one member of a deterministic, view-local screen-space partition.
It is accepted only by unlit and edge materials. Standard and wireframe
materials reject the field instead of approximating it through blending,
geometry offsets, or draw order. `cellSizeCssPixels` is positive and finite,
`count` is an integer in `[1, 4096]`, and `index` is an integer in
`[0, count)`.

Descriptors with equal cell size and count use the same spatial phase, so the
complete set of indices covers each fragment cell exactly once. Canvas
presentation scales cells from CSS pixels to backing pixels independently on
each axis. External XR presentation has no CSS coordinate space, so the same
numeric cell size is interpreted in each view's presentation pixels and the
phase begins at that view's viewport origin. The result is stable within a
view, not a world-space pattern or a promise that left and right eye fragments
select the same cells.

Partitioned unlit and screen-space segment fragments outside their selected
cells are discarded, which preserves ordinary raster ownership for the
selected coverage. Partitioned edge resolve writes zero alpha outside selected
cells because that full-screen resolve does not own scene depth. A one-way
partition is visually equivalent to full coverage. Picking deliberately
ignores this presentation-only partition and continues to query exact authored
geometry.

The renderer owns one deterministic, lazily allocated R16UI pattern per root
and shares it across world and overlay presentation. A scene with no
partitioned material allocates no pattern. This mechanism does not retain a
screen-sized texture, create a second scene renderer, or make temporal/stereo
comfort guarantees; those require separate physical-device evidence.

## Always-visible scene overlays

`SceneOverlay` is one independently replaceable, presentation-only lane after
the ordinary world. It disables depth testing and depth writes, uses normal
color management, creates no picking surface, and does not contribute to world
depth, transmission input, or depth prepasses. Direct meshes retain their
relative authored order, followed by screen-space segments in their relative
authored order, followed by outline resolves in their relative authored order.
This kind-lane order is explicit because an outline is a screen-space
postprocess and cannot interleave with direct draws. Direct overlay meshes are
limited to solid-color unlit or wireframe materials. The API does not expose
arbitrary draw order or raw WebGL depth state.

`screenSpaceSegment(...)` presents distinct world-space `start` and `end`
positions with square caps and the supplied `edgeMaterial`. Its width is in CSS
pixels on canvas and presentation pixels in each external/XR view, independent
of DPR, perspective, and endpoint depth; `widthCssPixels` must be finite and
within `(0, 16]`. Homogeneous near-plane clipping occurs before screen-space
expansion; a segment wholly behind the near plane emits no fragments. Segment
and outline RGB both use the same scene-linear-to-sRGB presentation encoding as
direct unlit overlays. Consecutive equal materials batch as instanced draws over
one root-budgeted retained float32 endpoint buffer. Replacing segment endpoints
rebuilds only that overlay buffer; ordinary frames upload nothing, and a scene
without segments creates no segment program, buffer, or vertex array.
The endpoint buffer and per-run vertex arrays are required presentation state:
budget denial or allocation failure follows the normal scheduled-frame or
explicit-call failure contract instead of selecting native lines, generated
mesh geometry, or another hidden fallback.

`outlineGltf(...)` is the accepted glTF overlay form. It requires an
`edgeMaterial`, reuses a currently rendered occurrence's prepared selected
scene, nested transforms, instances, active LOD and GPU geometry, and creates no
second source read or geometry upload. The edge lane derives boundary,
occurrence-boundary, and conservative crease edges through private
screen-space mask targets. It does not expose authored triangle diagonals as
wireframe edges. Edge width is in CSS pixels on canvas and presentation pixels
per external/XR view.

By default, an outline's presentation transform also identifies the rendered
source occurrence. `sourceTransform` may instead identify a stationary source
occurrence while `transform` independently places a displaced preview.
Source identity includes asset version, selected scene, primitive/cohort
identity and the complete source model transform. Coincident occurrences with
that same identity are presentation-equivalent and share any ready resident
geometry. A missing source occurrence fails before any edge draw; Royal does
not fall back to copied application geometry or choose LOD from the displaced
preview.

Automatic surface instancing retains the exact asset, original primitive
geometry identity, and mounted occurrence for every same-index stored instance
transform. An outline resolves that provenance using the cohort's float32
transform storage, borrows the cohort's resident geometry and vertex array,
and does not draw unrequested cohort members or disable world instancing.
Exact-compatible requested occurrences share one retained transform block and
one instanced mask submission. Compatible multi-primitive occurrences retain
one combined occurrence-major geometry allocation so primitive order cannot
cross occurrence order. Combined index preparation binds Royal's non-drawing
default vertex array before touching `ELEMENT_ARRAY_BUFFER`; it cannot rewrite a
borrowed world vertex array merely because that array was used by the preceding
draw. Allocation or optional batch-program failure falls back to the same
ordinary ordered mask draws. Adding, changing, or removing an outline therefore
does not re-lower the world scene or rebuild its instance buffers. Authored glTF
instance cohorts retain their existing whole-cohort outline behavior.

The mask target is full resolution and its depth attachment is discarded after
rasterization because no later pass samples it. Horizontal expansion reuses
overlapping mask texels and their decoded covered normals; vertical binary
expansion pairs adjacent texels through a linear sampler and thresholds the
result. The two sampled passes are
scissored to conservative projected overlay bounds plus their complete sampling
halo. The scratch halo is cleared before a partial pass, and indeterminate or
viewport-sized projection uses the full-target path. This is one canvas/XR
policy: it does not lower resolution, retain temporal pixels, inspect browser
identity, or expose a consumer quality switch.

When an overlay is active, the root may retain the completed world
presentation and restore it for overlay-only add, replace, clear, or transform
updates. That retained target is root-, size-, and context-generation-owned and
budget-governed. If it cannot be allocated, a complete world render is the
correct fallback. A scene with no overlay retains neither that presentation nor
edge targets, programs, or scratch.

## Transmission and dispersion

Transmission is a screen-space approximation of already-rendered scene color,
not path-traced refraction. It MUST obey material IOR, thickness/volume and
attenuation data within that model. Geometry outside the available screen copy
or behind unsupported ordering uses a stable documented fallback.

The implemented path is private and demand-loaded. For each active view, Royal
renders opaque/masked work into one scene-linear color/depth target, snapshots
that color for transmission, draws transmission followed by blended work, and
performs tone mapping/output encoding once while presenting to the destination
framebuffer. A renderable half-float target requires float-color support and,
only when a participating draw blends, float-blend support. Otherwise the same
transmission semantics use a clamped RGBA8 linear target. The opaque snapshot
texture and its mip chain are absent when the target serves terminal
presentation without transmission. Budget denial or target incompleteness
keeps the core PBR material as a stable opaque fallback rather than exposing
partial or stale screen color.

Rough transmission samples the opaque snapshot mip chain. Royal retains and
regenerates only the prefix reachable by the greatest visible authored
roughness; sharp transmission uses level zero, and a roughness texture cannot
raise the material's multiplicative roughness-factor ceiling. The shader keeps
the complete-resolution LOD scale, so truncating unreachable suffix levels does
not change samples within that ceiling. Sampled transmitted radiance is tinted
by the material's fully sampled base-color RGB. Thin transmission samples scene
color at the current fragment and does not compile volume-only refraction or
attenuation work. A nonzero-thickness volume variant projects the IOR-bent ray
back into the current view, and attenuation uses its grazing-angle-adjusted
travel distance. Samples outside the current view fall back to the material's
lit reflection result.
Royal's static profile requires `KHR_materials_volume` to be paired with
`KHR_materials_transmission`; inert factor-zero transmission and thickness
textures do not enter the loading lifecycle. For an active nonzero-thickness
volume boundary, authored `doubleSided` state has no effect, as required by the
glTF volume model.

Dispersion may use a bounded three-channel approximation. It MUST activate only
for materials that request it and MUST NOT impose shader or screen-copy cost on
ordinary materials.

Sudden reflection/refraction changes tied to screen position, stale screen-copy
content, or previous-frame material state are regressions, not accepted
approximation behavior.

## Fallback continuity

Progressive preparation may change fidelity but SHOULD preserve object presence,
base factors, silhouette, and stable neutral values. A legal lower-quality
texture, mip, LOD, ordinary representation, or uncompressed representation is
preferred to hiding the draw.

Royal MUST NOT use bright debug colors, uninitialized attachments, stale atlas
slots, or previous material uniforms as user-visible loading states. A fallback
transition invalidates one frame and is the same in canvas and XR.

## Physical quality targets

Correctness is evaluated against Khronos glTF sample assets and fixed Royal
visual oracles. Performance is evaluated at real device resolution without
example-specific cheats. Ordinary examples should sustain at least 60 Hz on
the declared target tier when their workload is within supported budgets; XR
should be architecturally capable of 90/120 Hz when the device and workload
permit, without weakening the 60 Hz minimum behavior.

Quality policy MAY cap render scale, DPR, HDR target size, anisotropy, or
optional effects by measured device capability. It MUST NOT special-case an
example, asset URL, browser product name, or benchmark flag to fabricate FPS.
