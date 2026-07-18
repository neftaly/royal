# Product and public API

## Scope

`@royal/react` is the primary product surface. `@royal/renderer-core` contains
backend-neutral scene descriptors and controllers. `@royal/renderer-webgl` is
the lower-level backend for hosts that own a canvas. WebXR is reachable only
through the dedicated React or WebGL XR entrypoints.

Royal MUST make these paths first-class:

- immutable scenes with perspective or orthographic cameras;
- glTF 2.0 metallic-roughness rendering;
- ordinary raster, KTX2/Basis, and self-contained SVG texture sources;
- explicit bulk instances and authored GPU instances;
- authored and automatic virtual texturing where beneficial;
- stable mesh, glTF occurrence, and instance picking;
- transparent or opaque canvas presentation with correct color handling;
- demand rendering in ordinary canvas mode and session-driven WebXR;
- context loss, cancellation, partial readiness, and bounded failure reporting.

Royal MUST NOT absorb application state, physics, layout, networking, or asset
authoring policy into the renderer API.

## Public vocabulary

The friendly React vocabulary consists of:

- `Canvas`, renderer lifecycle/status hooks, and explicit invalidation;
- pure scene constructors exported by `@royal/react/scene`;
- orbit-camera controls and camera fitting;
- frame callbacks for explicitly time-driven application work;
- stable picking and pointer-event bindings;
- XR session lifecycle through `@royal/react/xr`.

The public scene is one description, never a sequence of render passes. HDR,
transmission, tone mapping, picking, virtual-texture feedback, LOD, stereo
views, and intermediate targets remain renderer-private consequences.

## DX priority

Consumer DX is the first API constraint. A common React task SHOULD have one
obvious documented path, editor-visible types and defaults, a small import
surface, actionable author errors, and no requirement to understand backend
owners, frame packets, caches, or WebGL. Similar observations and lifecycle
operations SHOULD use consistent names and result shapes. Pre-release aliases
are worse than one direct correction when no real consumer needs them.

Codebase and agent DX is second. Source layout, ownership maps, focused files,
and subsystem documentation SHOULD make the implementation navigable, but MUST
NOT introduce public abstractions or extra runtime layers merely to organize
source. An internal name should describe the semantic owner or transition it
contains; generic utility or manager modules require a demonstrably cohesive
boundary.

## React contract

`Canvas` MUST use the ordinary React tree. It MUST NOT create a hidden React
root or custom JSX reconciler. Context, error boundaries, suspense boundaries,
and sibling UI therefore retain normal React behavior.

React owns coarse author intent. It MUST NOT be required to reconcile per-frame
objects, VT pages, draw packets, shader variants, or GPU resources. A React
commit supplies the newest complete scene snapshot. Imperative controllers MAY
modify explicitly versioned channels, such as camera views, transforms, and
bulk instance ranges, without forcing a React render.

`Canvas` owns exactly one renderer root for its attached canvas. Changing a
creation option MAY replace that root; changing scene intent MUST NOT recreate
it. Children are controls and observers, not renderable JSX nodes.

## Descriptor contract

Public scene constructors MUST:

- validate at the authoring boundary;
- reject unknown option fields rather than hiding misspellings;
- normalize defaults once;
- return detached immutable data;
- avoid DOM, WebGL, React, fetch, and codec objects;
- use discriminated unions and literal strings instead of runtime TypeScript
  enums;
- retain self-documenting field names across input and normalized output.

Descriptors express meaning, not storage. Object identity MUST NOT be the only
semantic identity. Callers MAY rebuild equal descriptors without changing the
meaning of content, picking, or resources.

## Units and coordinate convention

One Royal world unit is exactly one metre. Royal uses a right-handed, +Y-up
world with the conventional camera looking along -Z. glTF and WebXR enter at
their native metre scale. Ingestion MUST NOT apply a hidden global scale.

Positions, translations, camera clipping distances, orthographic bounds,
light ranges, glTF bounds, picking points, and hit distances are metres.
Angles are radians. Scale and direction vectors are dimensionless. Pointer
coordinates are CSS pixels. Frame time is seconds; fields ending in `Ms` are
milliseconds. Texture dimensions are texels and resource budgets are bytes.

Public color values are scene-linear unless explicitly named sRGB. APIs MUST
NOT infer a color domain from a JavaScript container type.

## Identity

Royal distinguishes four identities:

- **logical identity**: authored object or application identity used by picks;
- **content identity**: equivalence of decoded/prepared content;
- **representation revision**: capability-, quality-, or version-specific
  encoding of content;
- **allocation identity**: one resource owned by one renderer/context generation.

URLs, JavaScript references, batch slots, draw order, and GPU handles MUST NOT
silently substitute for another identity class.

`version` means that bytes behind one source have changed. `contentKey` means
that sources are known to decode to equivalent content and may share prepared
results. A false `contentKey` is a caller contract violation; it does not grant
origin or trust authority.

## API compatibility before release

There are no external compatibility consumers yet. Royal SHOULD prefer a
smaller, self-documenting, internally coherent API over aliases or deprecation
layers. A renamed or removed pre-release API MUST be changed directly across
Royal, examples, and tests. Compatibility aliases require an identified real
consumer and a planned removal date.

## Package and loading boundaries

The core scene vocabulary MUST remain usable without React or WebGL. Importing
the ordinary React entrypoint MUST NOT eagerly make XR, SVG paging, VT, IBL
transport, or optional glTF codecs execute. Optional subsystems SHOULD become
reachable only when selected by an entrypoint, descriptor, asset declaration,
or renderer option.

Tree shaking is part of the API contract. A module marked side-effect-free
MUST perform no observable registration, probing, fetch, worker creation, or
GL work merely because it was imported.

## Explicit non-features

The current product does not yet promise glTF animation, skins, morph targets,
glTF-authored camera ownership, automatic browser-side mesh simplification,
physics, occlusion queries, particles, text layout, or a public shader/pass
graph. Required asset semantics that depend on an unsupported feature MUST fail
clearly; Royal MUST NOT render a knowingly incorrect substitute.

Basic glTF node-transform animation is a deliberately deferred, very
low-priority candidate. The current architecture must leave it representable,
but no runtime or public controller is added until the behavior and visual
oracles in the asset specification are proven.
