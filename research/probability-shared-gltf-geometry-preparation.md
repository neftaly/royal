# Proposal: source-derived geometry identity and shared preparation

Status: accepted as an architecture target; deliberately not implemented as a
cache bolted onto the current whole-asset worker protocol.

## Product trace

Probability's Settlers board claims 46 distinct JSON glTF roots. They contain
only 11 distinct geometry declarations:

- 14 card roots share one external buffer and the same geometry layout;
- 12 tile and harbour roots share one external buffer and layout;
- 10 counter roots share one external buffer and layout;
- 3 large-card roots share one external buffer and layout; and
- the remaining 7 roots have unique geometry.

Thus 39 roots belong to four exact reusable geometry groups. Their materials,
textures, node transforms, and application meaning differ; their canonical
triangle geometry does not.

In an isolated Chromium software-WebGL run, all 46 claims began at about
1.66 seconds. First usable geometry appeared at 1.88 seconds and the last root
became drawable at 6.12 seconds. Summed external-resource and canonical
preparation spans were about 21.6 worker-seconds, or a 2.70-second ideal lower
bound across the eight available logical processors. Counting only one measured
member of each exact geometry group reduces that lower bound to about
1.11 seconds before the still-required per-root material and scene work.

The current `CanonicalTriangleGeometry.key` is derived from the glTF root
content key plus mesh and primitive indices. Consequently these exact shared
geometries have different renderer identities. Royal repeats canonical buffer
packing, accessor conversion, CPU geometry allocation, and GPU geometry
admission for them. Shared byte reads remove some transport, but do not make
prepared geometry shared.

## Desired renderer property

Exact immutable geometry referenced by distinct glTF roots should have one
source-derived canonical identity. Royal should prepare and upload that geometry
once while retaining independent materials, textures, variants, transforms,
lights, bounds, status, cancellation, and failure for each root.

This is a renderer resource property, not a Probability batching API. Consumers
should continue to claim ordinary glTF assets independently.

A useful decomposition would make these boundaries explicit:

1. source/resource identity and accessor declarations determine canonical
   geometry work;
2. root/scene identity determines nodes, transforms, lights, and selection; and
3. material declarations determine texture claims and surface material.

The exact implementation is Royal's decision. Candidate directions include a
root-owned retained geometry-preparation owner keyed by immutable external
resource identity plus the complete geometry extraction declaration, or a
two-stage worker plan which publishes geometry work separately from per-root
material/scene lowering.

GPU-only interning is a valid incremental step, but it does not address the
measured worker tail. The target is shared canonical preparation as well as
shared GPU storage.

## Correctness constraints

- Identity must include resource version and every declaration which changes
  emitted positions, indices, normals, tangents, colours, texture coordinates,
  primitive topology, quantization, meshopt/Draco output, or selected LOD.
- Distinct materials may reuse geometry only when the emitted vertex attributes
  required by those materials are identical.
- A weak hash must never make unequal geometry alias. A fingerprint may narrow
  candidates only if exact structural/content identity then proves equality.
- Root cancellation must release its claim without cancelling work still
  claimed by another root.
- One malformed root or material must not poison another root which references
  the same buffer.
- Retention belongs to the renderer root and remains bounded by explicit CPU and
  GPU byte budgets. It must not become a global immortal asset cache.
- The existing source/version contract, rather than URL text alone, defines
  immutable external bytes.

## Acceptance evidence

1. A fixture with several roots sharing a buffer and exact accessor layout
   performs one canonical geometry preparation and one GPU geometry upload.
2. Those roots may use different materials and textures and still render
   independently.
3. A one-field accessor, topology, compression, version, or required-attribute
   difference prevents reuse.
4. Concurrent cancellation and one-root failure preserve the remaining claims.
5. Root disposal releases retained geometry preparation and source bytes.
6. A cold Probability Settlers trace reports first usable geometry, last usable
   geometry, geometry worker-seconds, CPU retained bytes, uploaded geometry
   bytes, and final textured presentation before and after.

## Architecture decision

The current worker prepares one complete asset and transfers every canonical
geometry buffer to the main thread. Transfer detaches worker storage. A
worker-local cache would therefore retain detached arrays or copy every
geometry before publication; a main-thread cache would still receive duplicated
worker computation and could only remove GPU uploads. Routing a cached geometry
back through another whole-asset worker would add two copies and another
transfer. All three directions fail the proposal's CPU-worker target.

Do not use URL-only identity, root-relative mesh indices, or a weak output hash
to make the incremental GPU path appear shared. The canonical source step also
rewrites selected buffer views and may decode meshopt or Draco, so equality must
be established from the immutable resource/version identity plus the complete
extraction declaration and then preserved through output ownership.

The accepted implementation boundary is a two-stage preparation protocol:

1. parse and validate one root into geometry work identities plus a
   geometry-independent scene/material skeleton;
2. let a root-owned claim-aware geometry owner join or execute exact geometry
   tasks and publish canonical arrays once; and
3. compose each root's independent materials, transforms, variants, lights,
   bounds, picking, and status around borrowed canonical geometry on the main
   side.

That split must also separate buffer demand for geometry, embedded images, and
instancing; support cancellation while another root retains a geometry claim;
and transfer new geometry only once. It belongs with the planned replacement
architecture rather than a transitional cache. GPU-only exact interning remains
a valid later slice but is not reported as implementation of this proposal.

## Adversarial review

- Do not require an application manifest of duplicate roots. Royal already owns
  glTF parsing, immutable resource identity, preparation, and GPU residency.
- Do not treat a shared `.bin` URI alone as geometry identity; accessors and
  codec declarations can interpret the same bytes differently.
- Do not merge whole prepared assets. The measured roots intentionally differ
  in materials and textures.
- Do not claim success from fewer GPU uploads alone. The dominant remaining
  Settlers tail is repeated worker preparation.
- Do not raise worker concurrency to hide duplicate work. The trace already
  uses all eight reported logical processors.
- Do not regress first geometry while waiting to discover a complete batch.
  The first member of a geometry group should stream normally; later exact
  claims should join or reuse its work.
