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

Opaque and alpha-mask scenes present directly. Profiling on the representative
Sponza path showed that avoiding a view-sized half-float color/depth target and
full-screen sample was cheaper than moving the compact output transform out of
material shaders. This also avoids persistent target bytes and tile-memory
traffic on the device floor.

An all-standard scene with alpha-blended draws MAY retain one view-sized
half-float color/depth target so blending occurs before the shared output
transform. That path requires both `EXT_color_buffer_float` and
`EXT_float_blend`; otherwise direct presentation is the stable fallback.
Capability selection and material eligibility are retained lifecycle
decisions, not browser-name tests or per-draw extension queries. The target is
charged to the root persistent GPU budget and released when the need
deactivates. Direct and retained paths consume the same shared transform source
and MUST agree for opaque standard surfaces.

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

## Pass activation

The renderer privately compiles only passes needed by the visible frame. With
no transmission material, transmission screen-copy/refraction work MUST be
absent. With no PBR/environment use, IBL resources SHOULD remain lazy. With no
VT draw, VT shaders and bindings MUST be absent. With no clustered-light need,
cluster resources MUST NOT be updated.

Alpha-opaque and alpha-mask draws establish normal depth. Transparent and
transmission ordering MUST be deterministic, though perfect global order is not
promised. A material becoming ready MUST NOT leak prior draw state.

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

Rough transmission samples the opaque snapshot mip chain. Royal allocates and
regenerates that chain only when an active transmission material has meaningful
roughness or an authored metallic-roughness texture; sharp transmission uses
level zero. Refraction projects the IOR-bent volume ray back into the current
view, and attenuation uses its grazing-angle-adjusted travel distance. Samples
outside the current view fall back to the material's lit reflection result.
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
