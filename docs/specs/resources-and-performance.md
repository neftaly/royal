# Resources and performance

## Performance contract

Royal optimizes the product path rather than examples. Performance changes MUST
preserve observable correctness, shared rendering/picking paths, and functional
core boundaries. A benchmark-only branch, reduced example resolution, hidden
content, or asset-name special case is not an optimization.

Clean ownership and understandable canonical data take precedence over fragile
engine-specific micro-optimizations. Royal should be friendly to
JavaScriptCore, V8, and SpiderMonkey by using stable shapes, bounded lifetime,
and low allocation naturally; it does not contort source around speculative JIT
behavior.

A settled ordinary scene performs no JavaScript frame work and no GL calls.
Camera-only frames do not reparse assets, rebuild scene topology, recreate
geometry, re-upload static instances, or resubscribe resources.

## Root-wide budgets

Each root admits work against five public ceilings:

- retained decoded CPU bytes (default 512 MiB);
- retained persistent GPU bytes (default 1280 MiB);
- concurrent transient/scratch peak bytes (default 192 MiB);
- GPU upload traffic per rendered frame (default 16 MiB);
- concurrent asynchronous preparation jobs (default 8).

These are ceilings, not preallocations, promises that memory exists, or targets
to fill. Hardware limits and subsystem-specific correctness constraints may be
stricter. Omitted overrides retain defaults; options are immutable for the root
lifetime.

One physical allocation MUST have one accounting owner. Diagnostics may project
the same allocation in a subsystem view but MUST identify overlap rather than
sum it as independent memory. Persistent, transient, upload-traffic, and decoded
CPU domains MUST NOT be conflated.

## Admission behavior

Every potentially large decoded source, prepared asset, GPU allocation,
transient job, and upload participates in admission before committing state.
Arithmetic uses finite safe integers and cannot wrap.

Admission denial chooses one of:

- defer until capacity changes;
- evict unclaimed/reconstructible content then retry under bounded policy;
- select a legal lower-cost representation or fallback;
- settle as a captured resource failure.

It MUST NOT busy-loop each frame, partially publish, exceed the ceiling
silently, or make settled work permanently unwakeable. Reserved correctness
floors and lending policy remain internal unless applications need to control
them demonstrably.

## Allocation and GC discipline

Hot paths include frame selection, matrix resolution, culling, instance change
application, packet building, resource lookup, texture binding, draw submission,
VT demand, and pointer picking.

In those paths Royal SHOULD:

- reuse caller- or owner-held arrays, typed arrays, maps, and records;
- reset logical lengths instead of reallocating capacity;
- use numeric/structural keys where strings are not required externally;
- avoid iterator, rest/spread, closure, tuple, and temporary-vector allocation
  inside per-object/per-draw loops;
- grow capacity geometrically and report high-water values;
- avoid assignments that merely mirror another mutable source of truth;
- publish detached TypeScript-readonly snapshots only on cold observer paths.

Allocation-free is not absolute. A retained allocation that adds ownership or
cache complexity must beat the simpler form in representative profiling.
Optimizations SHOULD include a differential/property test for semantics and a
benchmark or trace for the claimed hot path.

## JavaScript engine behavior

Royal targets current Safari/JavaScriptCore, Chromium/V8, and Firefox/SpiderMonkey.
It MUST NOT depend on one engine's non-standard optimization. Hot structures
SHOULD retain stable shapes and field types. Sparse arrays, polymorphic object
bags, megamorphic property access, exception-driven normal control flow, and
large short-lived graphs SHOULD be avoided where traces show material cost.

No source-level micro-optimization is accepted solely because it appears
faster by inspection. Warm and cold behavior, deoptimization, GC pauses, code
size, and readability are part of the tradeoff.

The primary engine/device floor is Safari 17 on A10-class iPad hardware and the
Quest 2 Chromium/WebXR stack. An optimization that regresses either floor needs
a stronger product reason than a desktop microbenchmark gain.

## CPU versus GPU

The CPU owns scene semantics, async orchestration, coarse visibility, LOD
selection, resource admission, exact interaction queries, and compact packet
construction. The GPU owns vertex transforms, rasterization, material shading,
depth, texture sampling, clustered-light lookup, and presentation passes.

Work may move to the GPU when it removes a measured CPU bottleneck without
introducing blocking readback, excessive bandwidth, duplicate state, or an
incompatible fallback architecture. Work may move to the CPU when a GPU pass or
fragment branch costs every pixel for sparse benefit.

WebGL2 does not provide modern bindless resources. Royal SHOULD instead compile
stable binding plans, batch compatible draws, reuse texture units, and avoid
redundant binds. Texture atlases/VT are content representations, not a generic
bindless abstraction.

## Hot-path vocabulary budget

Cold boundaries absorb variety; hot paths operate on a deliberately small
vocabulary. Adding a hot-path union case requires evidence that it avoids more
work than it adds. In particular:

- file/container formats stop at preparation;
- glTF extension names stop at lowering;
- source URLs stop at content lookup;
- React object shapes stop at descriptor normalization;
- browser event shapes stop at input validation;
- lifecycle transitions stop at their owner state machines;
- capability alternatives stop at representation/pipeline selection.

The selected frame works with numeric revisions, canonical records, compact
packet kinds, prepared upload plans, and resolved handles. It does not repeatedly
ask which browser, asset format, extension, source kind, fallback chain, or
React constructor produced them.

Canonicalization is not permission for eager copying. A compatible decoded
buffer or typed-array view SHOULD be borrowed or transferred under explicit
ownership. Repacking is justified when it enables lasting GPU compression,
coalesced upload, shared storage, or a measurably cheaper repeated hot path.

Potential future GPU culling, transform evaluation, or feedback MUST preserve
logical identity and have a no-readback frame path. It is not justified until
CPU traces show that canonical retained selection is a material bottleneck.

## Async scheduling and workers

Workers are appropriate for demanded, heavy, independent decode or preparation
whose transfer/serialization cost is lower than main-thread blocking. Royal
currently requires worker support for Basis transcoding and may isolate other
codecs similarly.

Royal MUST NOT create a worker at module import or root creation when no job
needs it. Worker startup is lazy, jobs obey the same cancellation/generation
rules, and transferred buffers have explicit ownership. Small jobs SHOULD stay
local when worker startup and copying would dominate.

Parsing/preparation SHOULD yield or chunk only where it measurably improves
input responsiveness. Lifecycle complexity is not justified solely to make a
synthetic progress counter move.

## Load performance

Large scenes should become useful progressively:

1. document and required geometry prepare;
2. a coherent scene revision becomes renderable;
3. visible/relevant images and codecs settle under bounded concurrency;
4. optional fidelity such as finer VT pages streams by view demand.

Requests SHOULD prioritize work that can make visible content renderable.
Parallelism is bounded globally so one asset cannot starve all other work.
Cache hits still publish asynchronously but SHOULD avoid duplicate parsing,
decoding, copying, and GPU uploads.

Encoding can materially improve load time: GLB reduces request overhead;
Meshopt/Draco reduce geometry bytes and parsing; KTX2/Basis reduce texture bytes,
decode/upload footprint, and GPU memory; authored LOD can improve time to useful
pixels. Encoding never excuses an unbounded or serial runtime pipeline.

## Measurement

Performance work MUST distinguish:

- network/transport time;
- main-thread parse/preparation time;
- worker decode time;
- upload traffic and queue wait;
- CPU frame time and GC;
- GPU frame time and fragment/vertex cost;
- deployed gzip bytes;
- retained CPU/GPU memory.

Examples and harnesses SHOULD capture console errors, lifecycle, frame timing,
resource/VT diagnostics, traces, and GPU timer data when supported. XR testing
SHOULD exit the session after a measurement to avoid accidental thermal load.
Comparisons record render resolution, refresh target, browser, device, thermal
state, and scene/camera position.
