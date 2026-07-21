# Textures and virtual texturing

## Canonical texture semantics

Royal has one authored texture orientation: upper-left source origin. Ordinary
images, glTF images, generated VT pages, authored VT pages, and SVG raster pages
MUST produce the same visible U/V orientation. Upload-time or ingestion-time
normalization happens once; there is no public `flipY` policy and no shader path
may compensate differently by source kind.

Color textures decode from sRGB and sample into scene-linear values. Data
textures remain linear. Alpha semantics MUST remain consistent across ordinary
and virtual representations. A representation change MUST NOT visibly flip,
re-color, or re-premultiply content.

Samplers support nearest/linear mip filters and clamp/repeat/mirrored-repeat.
VT page gutters and addressing MUST reproduce the authored sampler at page
boundaries, including non-power-of-two dimensions.

## Canonical prepared representation

Source format is cold-path ingestion data. Every accepted complete texture
source—whether browser-decoded PNG/JPEG/WebP/AVIF, SVG, offline ETC2 KTX2, a
buffer view, a data URI, or a future decoder—MUST lower to one prepared texture
upload contract containing semantic storage class, dimensions, mip slices,
row/block layout, color/alpha interpretation, and reconstruction identity. This
sentence does not add a format to glTF or promise that every browser decodes it.
Resource reconciliation consumes the contract; material binding and draw
submission MUST NOT branch on source file format.

A VT page is an independently scheduled region, not a complete texture or mip
chain. It therefore lowers to the narrower page-transport contract, while
sharing the same storage-class, color-space, orientation, ETC2 parser, block
layout, and WebGL-format authorities. Forcing page identity/residency into the
complete-texture union would couple two lifecycles without simplifying binding
or drawing and is rejected.

Royal standardizes on the portable ETC2/EAC family for retained GPU-compressed
WebGL2 data. It does not force every texture into one physical format. The
canonical storage classes are deliberately few:

- color with alpha: sRGB or linear ETC2 RGBA, with RGBA8 fallback;
- two-channel data/normal: EAC RG where encodable, with RG8 fallback;
- scalar data: EAC R where encodable, with R8 fallback;
- HDR/environment: the explicit HDR representation required by that pipeline.

Opaque color MAY use a smaller RGB representation when alpha absence is proven
before upload. A complete authored mip chain may remain GPU-compressed. A direct
compressed source that is incomplete for its sampler or otherwise incompatible
fails during preparation rather than inventing a transcode or branching during
drawing. Browser-decoded AVIF/WebP is not automatically GPU compressed and
enters an uncompressed plan unless an offline container supplies blocks.

Optional ASTC or another native target MAY be added only if device measurements
show enough memory/bandwidth benefit to justify another representation revision,
cache key, upload validator, restoration recipe, and test matrix.

## Ordinary texture lifecycle

Decoded content identity is source or `contentKey` plus version. A logical
texture binding additionally includes color interpretation and sampler state.
Fetch/decode is shared by decoded content identity; GPU representation and
allocation remain root/context-owned. Sampling state MUST NOT change decoded
content identity even while the current backend includes it in an upload or
binding cache key.

Material rendering is progressive. Before color content is available, neutral
50% grey SHOULD be used for perceptual color where no semantic white/black
identity is required. Data inputs use their neutral material value: flat normal,
no occlusion, no emissive contribution, and factor-preserving metallic/roughness.
Failure placeholders MUST be stable and non-flashing; conspicuous debug colors
belong in explicit diagnostics, not ordinary presentation.

Decoded raster sources MAY be retained for context restoration or an active
automatic-VT representation only within CPU budget. Encoded SVG authority MAY
be retained for an active vector-backed representation and MUST be diagnosed
separately. Eviction MUST leave a reconstruction recipe or legal refetch path.

When the persistent budget requires a smaller ordinary PNG/JPEG/WebP/AVIF,
Royal reads a bounded encoded-header prefix through a pure, non-authoritative
dimension parser and asks the browser to decode directly to the selected fitted
size. Fixed-header PNG and WebP reads stop at 24 and 30 bytes respectively;
JPEG reads stop at 16 KiB, while AVIF and missing-MIME container reads stop at
128 KiB. AVIF dimensions are accepted only from the primary item's associated
BMFF spatial property; Royal does not scan for plausible width/height bytes.
Malformed, truncated, unsupported, or unusually deep headers fall back to the
browser-authoritative decode-then-fit path. The hint cannot expand an image,
change aspect ratio, accept a format, or bypass browser validation; it avoids a
second full decoded bitmap only when the same budget decision is known early.

Browser decode prefers `createImageBitmap` with a direct fitted resize. When
that API is absent or rejects an otherwise browser-decodable source, the DOM
image/canvas path MUST apply the same fitted storage plan and preserve the
original source dimensions. Capability detection is behavioral; user-agent or
engine-name branching is not part of the texture contract.

Ordinary images used by pickable `MASK` materials additionally retain one
8-bit alpha plane at the already fitted upload dimensions. This demand is
keyed by decoded content, shared across color interpretations and samplers, and
is absent for ordinary opaque/blended textures and authoritative picking
proxies. Browser images use a transient canvas RGBA readback only during
demanded decode. Offline ETC2 RGBA decodes only its EAC alpha blocks into that
same one-byte plane; RGB remains compressed and no GPU readback occurs. The
upload source is released after GPU upload. Removing the final mask claim
releases the alpha plane. Decode failure keeps the visible/pick fallback opaque
rather than inventing a cutout.

### Direct offline ETC2 KTX2 subset

An ordinary `textureAsset` or `imageTexture` URI ending in `.ktx2`, or served as
`image/ktx2`, enters the same root-owned texture lifecycle as a browser image.
Royal accepts only two-dimensional, non-array, single-face, unsupercompressed
ETC2 RGBA KTX2 with Vulkan format 151 (linear) or 152 (sRGB). The declared format
MUST match the asset color-space request. Level storage is bounds-, size-,
alignment-, and overlap-validated before publication, and upload borrows the
level byte views without a second block copy. Orientation is absent/default
`rd` or explicitly `rd`, swizzle is absent/identity `rgba`, and premultiplied
alpha descriptors are rejected so this path cannot violate Royal's canonical
upper-left, straight-alpha contract.

A mipmapped sampler requires a complete authored pyramid. Under a per-texture
storage ceiling, Royal MAY drop the largest authored levels and rebase a
complete remaining suffix; it never resamples compressed texels or calls
`generateMipmap` for this path. Exact compressed bytes, not an RGBA estimate,
participate in the persistent GPU budget. Experimental `GS_texture_etc2` may
select this same source profile from glTF and then disappears into the ordinary
texture lifecycle. `KHR_texture_basisu` is a separate glTF delivery contract
and remains unsupported because Royal ships no Basis runtime transcoder.
Direct ETC2 upload additionally requires the root to enable
`WEBGL_compressed_texture_etc`. Optional glTF ETC2 sources select their core
fallback when it is absent; required glTF ETC2 and direct Royal KTX2 sources
fail explicitly before an unsupported GPU upload. Authored compressed VT pages
settle as unsupported/error rather than allocating an invalid atlas.

## Representation choice

Authored `virtualTexture(...)` always requests the authored VT path. Automatic
VT is a root creation policy and is disabled by default. When enabled, the
current raster policy considers base-color triangle textures whose decoded
RGBA texel count exceeds the default 24-slot atlas payload and whose longest
edge spans more than two 128-texel pages. This prevents the representation from
costing more GPU storage than the ordinary image it replaces. SVG uses the same
logical page-source boundary but is selected for scalable detail rather than
that raster-memory threshold.

Representation choice is sticky for one capability/content generation. Royal
MUST NOT oscillate ordinary/virtual strategies frame by frame. Context
restoration MAY choose a new representation revision after capabilities are
re-evaluated.

Automatic VT is progressive: the ordinary texture remains the drawable source
until generated VT coverage is valid. Transition occurs through one material
binding policy and MUST NOT expose an uninitialized page table, white frame, or
debug-color frame.

## VT manifest contract version 2

An authored manifest is JSON with `contractVersion: 2` and:

- positive `virtualSize: [width, height]`, `pageSize`, and `borderTexels`;
- optional `colorSpace` of `srgb` or `linear`;
- optional positive `mipCount` no larger than the derived full chain;
- optional `pageEncoding` of `image` (default) or `ktx2-etc2`;
- `pages.entries`, a URI template, or both;
- optional positive `physicalSlots` and `physicalByteBudget` quality ceilings.

An explicit entry wins over the template for the same page. Template tokens are
`{page}`, `{mip}`, `{x}`, `{y}`, and `{key}`. Entries MUST be unique, in bounds,
and well formed. A template denotes complete addressing; entries alone denote
sparse addressing. For KTX2/ETC2, stored page extent including both gutters
MUST be block compatible. Pages are offline-authored, unsupercompressed ETC2
RGBA blocks; Royal does not ship a Basis WASM transcoder.

Manifest ceilings do not preallocate memory and do not override stricter root
budgets or hardware limits.

## Demand and coverage

Demand derives from actual projected textured coverage across every render
view. Close inspection, oblique surfaces, large ground planes, UV transforms,
repeated wrapping, partial clipping, geometry crossing the near plane, stereo
eyes, and camera motion are required stress cases.

Demand MUST be conservative enough that a visible fragment can resolve to a
resident page or ancestor. It MUST be bounded by visible geometry and quality
policy; it MUST NOT request the whole virtual texture merely because one draw is
visible. Degenerate or non-finite projections must fall back safely without
unbounded demand.

Perspective-varying triangles use bounded demand-only subdivision when sampled
mip requirements differ. Each leaf requests its finest observed requirement;
the subdivision never mutates or tessellates rendered geometry. Four fixed
levels and caller-owned numeric scratch bound CPU, memory, and stack work while
preventing a far corner of a two-triangle ground plane from forcing its close
region to an unnecessarily coarse mip. Near-plane clipping happens before this
analysis and uses the same path.

The coarsest usable ancestor SHOULD be requested first. A finer page MUST NOT be
published to the page table until its atlas upload is complete. Missing fine
pages sample the closest resident ancestor. Sparse-addressing holes use the
nearest authored ancestor when one exists and otherwise use the ordinary or
neutral fallback—never stale atlas contents.

When current demand exceeds physical capacity, Royal drops complete fine mip
levels until the retained working set fits. It does not keep an arbitrary
spatial prefix at fine detail, because a stable uniformly coarser image is
preferred to a hard moving boundary between sharp and ancestor-resolved areas.

The GPU page table is one mipmapped `RGBA8` texture. Its base page grid is
padded to power-of-two dimensions so every ceil-divided logical grid fits the
corresponding WebGL mip level; unused cells remain invalid. Sampling selects
the desired mip with derivatives and performs one explicit-level page-table
fetch followed by one atlas fetch. This avoids dynamic uniform-array indexing
in every fragment. Publication uploads each retained table level after an atlas
batch, trading a few cold driver calls and bounded padding bytes for the smaller
Quest/Safari fragment path. All padded storage is charged to the VT GPU and
per-frame upload budgets.

Scene publication indexes each VT resource directly to its canonical demand
surfaces. Per-frame demand MUST NOT rescan unrelated surfaces once per resource.
Each ordered view computes one retained frustum broad phase for all of those
surfaces. Canonical world bounds reject off-screen surfaces before triangle
clipping; surfaces that survive still use exact clipped projected coverage, so
the broad phase cannot reduce visible demand.
Instanced surfaces additionally test each affine-transformed local bound against
that retained frustum before visiting its triangles. One retained bounds
workspace avoids per-instance allocation, and exact clipped coverage remains authoritative for
every surviving instance.
Atlas uploads admitted in one resource/frame batch normally publish through one
complete page-table revision and one lifecycle notification after every
successful atlas write. A failed overwrite may publish an immediate repair
revision only to remove the now-invalid old slot mapping; failed or partial
page bytes never receive a logical mapping.

At very close range, required detail is capped by source resolution, configured
quality, hardware limits, and budgets rather than by an arbitrary camera
distance. Near-plane clipping is camera geometry, not a VT quality policy.

## Raster and SVG page sources

Raster automatic VT may decode one source image and crop/downsample requested
pages. It MUST account for the retained decoded source against ordinary texture
CPU ownership as well as report it in VT diagnostics; the same bytes are not
two independent allocations. The current root retains at most 64 MiB of such
decoded raster sources for automatic VT; candidates beyond that ceiling remain
on the ordinary texture path instead of stalling the shared decode queue.

SVG automatic VT rasterizes requested pages from the vector source without
retaining a full-resolution bitmap. Its current maximum raster long edge is
16,384 texels; this is a quality/capability ceiling, not the SVG's logical
dimension. Browser feature decisions MUST follow successful decode and
origin-clean canvas readback capabilities rather than user-agent strings.

When automatic VT is enabled, ordinary SVG decode MUST retain the already-read
encoded SVG as the vector authority. The automatic page source parses that
authority once and MUST NOT refetch the URI or maintain a second source cache.
The ordinary decoded bitmap may close after GPU upload; retained encoded bytes
are reported separately from decoded handoff bytes and are released when the
source is no longer claimed. Roots without automatic VT MUST NOT retain the
encoded SVG after ordinary decode.

A page source owns fetch/decode/raster only. It MUST NOT own atlas slots, page
tables, shader bindings, demand selection, or render scheduling.

## Residency and eviction

Atlas allocation is transactional. A slot selected for reuse cannot become
visible for the new page until upload completes, and the old mapping cannot be
invalidated in a way that samples new/partial bytes under the old identity.
Failed, cancelled, or generation-stale uploads abort publication.

Declaring or preparing a VT source does not itself allocate an atlas. The first
non-empty projected demand does, so off-screen automatic and authored assets do
not each reserve the default physical working set merely by existing in a scene.

Compatible logical textures share one root-owned physical atlas pool. Pool
compatibility is exact stored-page extent, compression class, and color space;
samplers and page tables remain per logical texture. Manifest `physicalSlots`
and `physicalByteBudget` cap that texture's resident working set rather than
causing another atlas allocation. A pool targets the existing default 24-page
physical footprint (and never more than 32 MiB), then yields to the stricter
remaining root GPU budget. This keeps one VT's
allocation unchanged and reduces memory for each additional compatible VT;
pool growth requires separate measured justification. Diagnostics report
`atlasPools` and `atlasBytes` separately from logical `residentPages`.

Shared slots are identified by both resource and page identity. Cross-resource
eviction invalidates the evicted logical mapping and republishes every dirty
page table before the next draw, so an overwritten cell cannot appear under a
different texture's identity.

Protected pages required by the current frame are not eviction candidates.
Eviction policy MAY approximate recency but MUST terminate under full pressure.
Backoff and denial state MUST be bounded and wake when capacity or demand
changes; permanent failures MUST NOT retry every frame.

GPU atlas, page tables, decoded pages, source images, request jobs, transient
raster data, and per-frame upload bytes all participate in the root resource
governor.

## Observable readiness

For an authored VT, `ready` means the manifest and runtime representation are
accepted; visible detail may still stream. `pendingPages` reports pages loading,
decoding, or queued for GPU publication. It is not a promise that all possible
pages will ever become resident.

`unsupported` means the requested VT representation cannot be used on this
root. Automatic VT falls back to ordinary rendering. An explicitly authored VT
without a legal ordinary fallback reports the unsupported state and renders a
neutral fallback rather than hanging.

The React observation is `useVirtualTextureAssetStatus(manifestUriOrRef)`. Its
snapshot reports lifecycle state plus `residentPages`, `pendingPages`, and
`failedPages`; observation is identity-focused and does not subscribe the
component to every renderer frame.
