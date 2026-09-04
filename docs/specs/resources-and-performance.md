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

Canvas alpha compositing and browser/XR multisampling are explicit opt-ins.
Opaque non-multisampled targets are the default because both context attributes
carry persistent bandwidth and resolve/compositor cost even when a scene does
not need them. Applications retain exact control through immutable root and XR
layer options; Royal does not silently reduce backing resolution.

A settled ordinary scene performs no JavaScript frame work and no GL calls.
Camera-only frames do not reparse assets, rebuild scene topology, recreate
geometry, re-upload static instances, or resubscribe resources.

Frame submission does not call `flush`, `finish`, insert fences, or perform
readback. Canvas and WebXR presentation consume the ordered command stream when
the owning frame callback returns; internal texture copies remain ordered in
that same stream.

## Root-wide budgets

Each root exposes one consumer creation ceiling: retained persistent GPU bytes
(default 256 MiB). It is a ceiling, not a preallocation, promise that memory
exists, or target to fill. Hardware limits and subsystem-specific correctness
constraints may be stricter. The option is immutable for the root lifetime.

Ordinary-texture GPU upload traffic per frame and concurrent asynchronous
preparation jobs also have bounded root-owned ceilings, currently 32 MiB and
eight jobs respectively. Geometry and instance upload has a separate 4 MiB
ceiling. Those limits and their scheduling strategies are
implementation policy: diagnostics expose them, but consumers do not tune or
depend on them. This keeps later phase separation and browser-specific work
attribution from becoming breaking API changes.

The upload byte ceilings bound submitted source traffic; they do not promise a
maximum frame duration. WebGL submission time does not reveal when queued
upload, mip generation, shader link, or command-buffer work completes, and
inclusive browser trace categories overlap. Royal MUST NOT feed
`performance.now()` around submission calls back into admission as if it were
GPU time. A future adaptive policy requires delayed, non-disjoint GPU timer
evidence and must beat the byte policy on both exact-final time and worst frame.
One oversized first transaction remains necessary to prevent starvation.

Ordinary mipmapped images publish one complete GPU representation. Royal does
not temporarily bind a non-mipmap sampler to base storage and later promote the
same image: that would add a second completeness/sampler state, another visible
transition, and the same eventual mip-generation work. Offline complete
compressed pyramids remain the less-work path.

The asynchronous job ceiling is one root-owned, bounded-fair two-lane admission
authority shared by glTF CPU pipelines, authored-VT transport/decode, and
prefiltered-environment work. Newly claimed scene, environment, and visible-VT
work uses the foreground lane, so an existing detail backlog cannot delay first
usable geometry. Ordinary image transport is network wait, not CPU
preparation, and uses its separate bounded browser queue. FIFO order is
preserved within each shared-scheduler lane; after at most four foreground
starts while detail remains queued, one detail job starts. Active work is never
preempted.

A non-visual glTF claim enters this same foreground preparation lane. It does
not create a parallel preload cache, scheduler, or retention policy. Image
sources selected by its prepared materials enter the ordinary bounded
transport, decode, and CPU-handoff lifecycle before visibility, but do not
allocate WebGL storage or request frames. This is continuous render-ready claim
ownership, not a parallel cache, a time-based cache, or a metadata-only mode.

A job is one admitted CPU/decode preparation phase, not necessarily a complete
asset lifecycle or a promise that a browser created a worker. glTF root
transport has a separate root-owned staging owner: at most 16 reads execute,
at most 64 active-or-staged sources hold reservations, and new reads pause once
completed source storage reaches 32 MiB. One oversize source progresses alone.
Its completed bytes retain their reservation until the existing foreground
preparation scheduler actually begins consuming them. Root transport therefore
does not occupy scarce CPU preparation slots, while source memory cannot scale
unboundedly with claims. `resources.gltfSourceReads` reports the exact queue,
reservation, and completed-byte pressure.

After a JSON glTF root read, Royal parses roots no larger than 256 KiB once on
the main side for lazy external-image discovery and source-derived geometry
task planning before transferring the same bytes to preparation. Producers
retain the zero-copy handoff. A root joining existing geometry work retains one
temporary root retry copy so its independent material/scene skeleton can prepare
immediately without losing failure isolation when the original storage is
transferred. A dedicated root-owned 16 MiB retry budget bounds those copies; at
pressure, later joiners keep their original staged source and wait instead.
Binary GLB and larger JSON roots retain ordinary preparation and post-transfer
exact interning. Released or superseded assets cannot publish planned claims,
and render-ready non-visual roots prepare selected images through the same
bounded texture source lifecycle without allocating WebGL storage.
This bounded cold parse is not a second asset loader, retained document cache,
or higher decode-concurrency policy.
The first glTF claim also begins the lazy root-planning and browser-preparation
module imports alongside root transport. It does not create or compile a worker
until ordinary preparation admission, and it adds nothing to apps which never
claim glTF.

Ordinary-texture transport does not consume a glTF CPU-preparation slot. Its
root-local queue admits 16 transports, while encoded read-ahead admits at most
16 of those reads and the texture owner bounds complete source lifecycles. The
bitmap queue admits up to 32 browser decode calls; the browser remains
responsible for actual codec threading. This keeps known image requests moving
while glTF workers are occupied without weakening decoded-handoff bounds. A
queued claim can be aborted without starting, and active phase work retains
its stage slot until that phase settles. Root diagnostics expose CPU-preparation
pressure separately from encoded transport, complete texture-source, and
browser-stage timings without polling or waking rendering.

Worker-worthy glTF jobs use a root-owned amortized worker set bounded by this
same job ceiling. The set is not another scheduler: admitted jobs borrow an
idle worker or create one below the ceiling. Successful and ordinary
asset-failure completions leave that worker reusable for a one-second idle
grace. Cancellation, worker/channel failure, root disposal, or idle expiry
terminates it. Root bytes and prepared results continue to cross by transfer;
reuse adds no defensive source or geometry copy.

Cancellation is terminal at every queued admission boundary, including the
separate browser transport and bitmap-decode queues. It rejects the abandoned
claim immediately and drops its captured work closure even when an earlier
browser operation is still active; the inert queue cell may remain until FIFO
drain, but it cannot retain asset bytes or begin work later.

Royal does not advertise a fabricated root-wide decoded-CPU or scratch-byte
ceiling. Browser image decode allocations and worker scratch peaks are not
reliably observable or predictable before work starts. Ordinary textures
instead admit at most 32 active preparations within 64 total active-or-handoff
source reservations, run at most 16 transports and 32 browser decode calls
concurrently, and stop new work once completed decoded handoff exceeds 64 MiB.
The browser still owns its internal codec thread count; Royal admits known
independent work rather than claiming one JS thread per image. Encoded
read-ahead has its own 16-read, 128-source, 32 MiB staged-blob authority so
transport can lead decode without unbounded retention. Draco workers, VT reads,
environment artifacts, and GPU/upload domains retain their own exact limits. A
future cross-domain byte admission policy requires measured peak evidence and
an accurate reservation contract rather than estimates attached to
heterogeneous promises.

Upload-traffic ceilings are reset exactly once per submitted canvas or XR
frame. New ordinary-texture and VT bytes share a 32 MiB progressive ceiling
because both improve texture fidelity after a usable frame. Canonical geometry
and packed instance bytes consume a separate internal 4 MiB ceiling so a
texture-only resource commit
cannot starve a later scene draw. Work that does not fit retains its legal
current representation and retries deterministically on a later demanded
frame. One individually oversized texture or surface transaction is admitted
into an otherwise empty domain so a valid resource cannot starve forever. The
diagnostic snapshot reports admitted—not necessarily driver-completed—bytes
and unique deferrals for each domain in the most recently submitted frame.

Geometry admission governs source transfer separately from arena storage.
There is no independent surface-count cursor. The exact per-frame byte owner
stops before the first surface whose new geometry or instance transfer does not
fit; every following surface which reuses already admitted resources and costs
zero upload bytes may publish in the same transaction.
Compatible geometry is greedily partitioned into at-most-4-MiB arena chunks,
except that one indivisible primitive may be larger. A chunk claims persistent
budget and creates its stable buffers/VAO only when its first surface transaction
is admitted. Later surfaces reuse that storage without buffer growth or copying.
Arena allocation is not misreported as uploaded bytes, and the chunk boundary
may end an otherwise legal multi-draw run rather than reserve a whole scene up
front.

Exact post-preparation glTF geometry interning is root-owned and claim-bound.
`resources.gltfSharedGeometry` reports primitive claims, unique canonical
geometries, reused claims, retained canonical CPU bytes, pending/prepared
source-derived tasks, task bytes, joined task claims, and producer preparation
time. Exact pre-read task identity lets joined roots avoid geometry buffer
demand, conversion, transfer, and upload. Source-derived keys only narrow the
fallback post-transfer interner, where byte equality still proves aliases. The
last owning root releases both task and geometry.
Ratified meshopt placeholder buffers are derived decode destinations, not
resource authority. They may participate in pre-read task planning without a
URI only when the extension graph proves every reference is compressed and the
required-extension rule permits omission; compressed source identity, decoded
extent, and the full decode/extraction declaration still distinguish tasks.

Virtual-texture publication retains both a four-page count ceiling and a
separate 4 MiB byte ceiling. A transaction accounts the exact compressed block
bytes or canonical RGBA page bytes plus one page-table publication per affected
resource. A denied page remains decoded and ready for the next demanded frame;
one oversize first transaction still makes progress. Residency chooses a slot
through an allocation-free pure core and does not remove the old mapping unless
replacement validation and atlas upload succeed.
Render-target `texStorage`/allocation is persistent or transient capacity, not
source upload traffic, and MUST NOT be added to these transfer counters.

The pinned prefiltered-environment profile is a separately bounded atomic
domain: 256×256 maximum faces, six packed four-byte faces, and a complete mip
pyramid cap source transfer at 2,097,144 bytes. The whole cubemap becomes
bindable only after all faces succeed. Its uploader borrows one source word view
with per-face offsets rather than allocating up to 54 temporary views. This
static format ceiling is the admission justification; accepting a larger
environment profile requires a progressive byte-governed transaction first.

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

Ordinary browser-decoded images share at most 75% of the persistent ceiling.
Before decode, Royal subtracts the exact cold-plan storage for retained geometry,
instances, and the current size-dependent composite or volume-occlusion target;
the smaller allowance governs the texture set. Royal keeps authored dimensions when their
complete RGBA mip representations fit; otherwise it selects the largest
aspect-preserving decoded size that fits each active storage share before upload.
This bounds ordinary glTF sets without an asset-specific branch. Authored
close-range detail that must remain independent of scene-wide residency belongs
in KTX2/VT representations.

The 256 MiB default is a portable safety ceiling, not a recommended texture
working-set size. It keeps unoptimized ordinary assets viable on the A10/Safari
floor; offline ETC2/KTX2 retains materially more authored detail inside the same
ceiling. Applications with measured headroom may explicitly raise the immutable
root option.

CPU alpha retained for exact `MASK` picking is bounded to one byte per fitted
pixel, at most one quarter of the corresponding admitted RGBA base-level bytes,
and exists only while a canonical mask-pick claim is live. It MUST NOT retain a
second RGBA copy or keep the browser image source alive after upload.

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

A retained terminal-presentation target is justified only by semantics that
need a shared linear image, currently transmission or supported linear alpha
blending. Measured opaque scenes present directly. Royal accounts target color
and depth bytes before allocation, omits the separate scene-color snapshot when
transmission is inactive, and falls back to direct presentation on admission
denial. It MUST NOT silently lower canvas resolution or skip authored work to
improve a frame-rate report.

When transmission roughness cannot reach the complete scene-color mip pyramid,
admission and allocation retain only the reachable prefix while shading keeps
the full-resolution LOD scale. This removes unreachable persistent bytes and
mip generation without changing authored roughness behavior.

Work may move to the GPU when it removes a measured CPU bottleneck without
introducing blocking readback, excessive bandwidth, duplicate state, or an
incompatible fallback architecture. Work may move to the CPU when a GPU pass or
fragment branch costs every pixel for sparse benefit.

WebGL2 does not provide modern bindless resources. Royal SHOULD instead compile
stable binding plans, batch compatible draws, reuse texture units, and avoid
redundant binds. Texture atlases/VT are content representations, not a generic
bindless abstraction.

Edge-overlay batch structure is retained resource-lifecycle state, not a
view-local frame product. Royal rebuilds it only when the canonical overlay or
the borrowed surface resource/mode changes. Each frame writes the union of
occurrences visible to the submitted views into one retained transform block,
omits occurrences outside every view, and reuses that upload across stereo
draws. Fewer than two visible compatible occurrences, optional batch-resource
denial, or batch-program setup failure uses the same ordered ordinary mask
draws; those are correctness fallbacks, not hidden quality tiers.

Screen-space overlay segments retain one packed start/end float32 buffer per
root and one vertex array per consecutive material run. Overlay replacement may
replace that buffer; camera motion, stereo views, repeated invalidation, and
unchanged endpoint presentation do not upload endpoint or expanded geometry.
Expansion is view-local shader work, so DPR and perspective changes do not
create another CPU geometry path.

A measured dynamic-import split for the segment owner was rejected. It reduced
the ordinary initial graph by about 1.0 kB gzip but increased complete deployed
JavaScript from about 281.7 to 283.0 kB gzip and delayed the first guide by an
extra frame. Probability uses this path, so the smaller complete static graph
is the accepted representation.

Lit fragment programs specialize their bounded directional and punctual light
array sizes to the canonical scene counts. Absent lights compile out, static
loops contain no runtime count branch, and the imperative shell uploads only
the exact prefix of its retained maximum-capacity workspace. Count changes may
compile another cached fragment variant, while vertex variants remain shared;
this bounded cold cost avoids reserving the four-directional/eight-punctual
maximum in every lit fragment on constrained GPUs.

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

SVG source validation is cold, bounded to 16 MiB of encoded input, and produces
one parsed authority retained only when automatic VT may need it. Ordinary SVG
decode and generated VT consume that authority without a second fetch, text
decode, or DOM parse. A raster fallback is fetched only after preferred SVG
failure, so compatibility does not impose unconditional duplicate work.

Potential future GPU culling, transform evaluation, or feedback MUST preserve
logical identity and have a no-readback frame path. It is not justified until
CPU traces show that canonical retained selection is a material bottleneck.

## Async scheduling and workers

Workers are appropriate for demanded, heavy, independent decode or preparation
whose transfer/serialization cost is lower than main-thread blocking. Royal
does not currently transcode Basis at runtime. Any future codec heavy enough to
need a worker must first justify its code, startup, transfer, cancellation, and
target-browser costs; worker availability is not itself a format promise.

Royal MUST NOT create a worker at module import or root creation when no job
needs it. Worker startup is lazy, jobs obey the same cancellation/generation
rules, and transferred buffers have explicit ownership. Small jobs SHOULD stay
local when worker startup and copying would dominate.

Workers execute CPU preparation only. Referenced-resource reads cross the
root's injected resource-I/O port, even when a worker requests them, so custom
authentication, caching, cancellation, and diagnostics cannot be bypassed by
the chosen executor.

glTF root and referenced-resource transport deduplicates exact identities in a
single claim-aware owner. Its retained successful-byte ceiling is 32 MiB across
both domains; eviction and last-claim release retire settled bytes, while
oversized results receive in-flight deduplication without becoming retained
cache entries. Genuinely shared preparation inputs are copies because browser
workers transfer their buffers; a single consumer keeps zero-copy delivery.
This bounded cold allocation is preferred to either duplicate network and
ArrayBuffer materialization or accidental detachment of a shared authority.

Parsing/preparation SHOULD yield or chunk only where it measurably improves
input responsiveness. Lifecycle complexity is not justified solely to make a
synthetic progress counter move.

Shader stages compile before one program-link synchronization. Successful
startup MUST NOT poll each stage separately; link failure is the validation
boundary and includes the program plus non-empty vertex/fragment logs. Optional
parallel-compilation publication remains unjustified while it delays first
usable presentation or requires a second fallback-program lifecycle.

## Load performance

Large scenes should become useful progressively:

1. document and required geometry prepare;
2. a coherent scene revision becomes renderable;
3. visible/relevant images and codecs settle under bounded concurrency;
4. optional fidelity such as finer VT pages streams by view demand.

Requests SHOULD prioritize work that can make visible content renderable.
Parallelism is bounded globally. Bounded-priority foreground/detail admission
keeps a detail backlog from delaying first-visible scene work while forcing
regular detail progress. FIFO order within each lane prevents later work from
overtaking already-demanded work in that lane; richer visibility priority
remains a later scheduler refinement.

Selected-scene external-buffer transport is a functional-core/imperative-shell
boundary: a pure document walk produces bounded byte ranges, while the browser
shell owns HTTP negotiation, cancellation, response validation, and full-read
fallback. Plans with too many intervals or at least 80% byte coverage choose a
complete read. This avoids request fan-out that costs more than it saves and
keeps servers without range support correct without a parallel parser path.
The pure walk shares material structure and texture-source selection with
canonical preparation. It therefore includes selected material variants and
LOD fallbacks without conservatively transferring embedded images owned only by
another scene, and capability fallback cannot diverge between transport and
rendering.
Cache hits still publish asynchronously but SHOULD avoid duplicate parsing,
decoding, copying, and GPU uploads.

One optional root-scoped complete-byte reader replaces default glTF transport
without replacing ownership. It handles roots, buffers, and external images;
Royal retains claim-based cancellation and bounded sharing. External images use
resolved URI plus inherited root version as decode identity, not the parent
document identity, so separate glTF roots can converge on one transport/decode
chain. Direct image-texture assets remain on their ordinary transport unless an
equal decoded identity is already shared by the root.

Focused glTF status exposes monotonic timings for claim-to-source-start,
root-source reading, preparation-queue wait, referenced-resource reading,
canonical preparation, first drawable geometry, and terminal image completion.
Concurrent referenced reads report one wall span from the first read start
through the final completion, rather than a sum of overlapping requests. Root
read, queue wait, referenced-resource span, and preparation are disjoint;
`firstDrawableAfterMs` is the direct elapsed milestone rather than a
reconstructed sum. Image completion is likewise elapsed from the exact
source/version claim. The values are diagnostics, not scheduling inputs, and
observing them does not poll or wake the frame loop.

Ordinary image preparation has explicit nested bounds. At most sixteen complete
source lifecycles hold active preparation slots, while its dedicated browser
transport and decode queues are separately capped at 16 and 32 active stages.
Network transport is deliberately not admitted through the
glTF/VT/environment CPU scheduler: coupling the already-bounded fetch queue to
eight occupied glTF worker slots delayed a measured 46-root workload's first
known AVIF request by several seconds without reducing decode or retained-byte
pressure. After
decode selects an exact browser-image or
ETC2 representation, the retained upload source is charged by its actual bytes,
including retained picking alpha, until every claimed GPU representation
consumes it, rejects it, or the claim is cancelled. New decodes pause when
completed handoff storage reaches 64 MiB or the root holds 64 source
reservations. Already-active jobs may complete beyond the byte threshold, but
the active bounds make that overshoot finite. Deterministic source order is
preserved. Bounding only active decoder calls is insufficient: fast decoders
can otherwise leave an unbounded queue of completed RGBA images waiting behind
progressive GPU admission.

Built-in browser preparation records monotonic times at the existing transport
and decode queue boundaries. Focused texture readiness reports queue and work
durations plus claim-to-ready elapsed time; the broad root snapshot optionally
sums the four browser-stage durations across currently retained ready sources.
These are attribution diagnostics, not unbounded request logs, performance
entries, or scheduler controls.

GPU resource commitment and scene presentation are separate lifecycle effects.
The first usable surface set, first decoded texture, and terminal settled
resource set present immediately. Intermediate geometry admissions and
ordinary-texture improvements commit promptly so upload work progresses and
decode reservations are released, while scene presentation is coalesced to a
bounded 250 ms cadence. A resource-only commit MUST NOT clear the framebuffer,
submit scene draws, or increment the public presented-frame counter. A frame
already presenting the committed state resets that cadence rather than
scheduling a duplicate presentation. Camera, scene, size, context, VT, or
application invalidation always overrides the cadence and presents the latest
committed resources.

Ordinary-texture completions are collected by stable content key until the next
submitted frame. Canonical lowering then clones the surface list once and
re-resolves each affected surface once, even when several completed maps belong
to it. The imperative root publishes that batch to the retained GPU packets in
one transaction. Focused asset readiness remains immediate and independent;
coalescing scene work MUST NOT delay a subscriber's ready/error observation or
turn texture completion into a periodic polling loop.

Committing one map in a visually coherent material group MUST NOT rebuild its
retained draw packet while the sampled texture-unit mask is unchanged. The GPU
storage commit still proceeds immediately; packet/program publication occurs
once the coherent group becomes drawable. Context restoration and source
identity replacement remain full resource transitions rather than this
incremental path.

Canonical scene lowering deduplicates ordinary image claims by GPU storage
identity. It orders every selected surface's base-color claim before emissive,
metallic-roughness, normal, and occlusion claims, preserving stable authored
order within each tier. Material LOD sets contribute their lowest authored
base-color level first, followed by progressively preferred levels; FIFO
preparation therefore starts every preview before a replacement can consume a
new worker slot. This reduces neutral-grey first display without a camera-
specific scheduler; panel and XR consume the same claim order.

Encoding can materially improve load time: GLB reduces request overhead;
Meshopt/Draco reduce geometry bytes and parsing; offline ETC2 KTX2 reduces texture
bytes, upload footprint, and GPU memory without a runtime transcoder; authored
LOD can improve time to useful pixels and steady-state vertex/fragment work.
Geometry compression alone does not reduce submitted triangles after decode.
Encoding never excuses an unbounded or serial runtime pipeline.

Opaque depth prepass admission is also a resource trade, not a universal
"optimization." Royal admits it only for a sufficiently large retained set of
expensive, coverage-independent PBR draws and only when compatible draws can be
amortized through multi-draw. Cameras inside the aggregate opaque volume retain
the established cost case. An outside camera additionally requires a direct
multisampled default target and at least 2× summed retained-bound coverage along
its dominant outside axis; single-sample composites and sparse outside views
stay single-pass. A retained cold plan makes the frame decision allocation-free
and a 5% exit margin prevents boundary thrash. It adds vertex submissions and a
tiny retained program to reject hidden full-PBR fragments; it does not allocate
another framebuffer, duplicate geometry, change authored coverage, or add a
public mode. Cheap unlit work and coverage-dependent materials stay
single-pass.

For selected-scene Draco workloads, container reads and multi-buffer packing
first converge on one canonical source. Only primitives reachable through the
selected child/`MSFT_lod` graph become serializable codec tasks. The browser
preparation worker balances those tasks largest-first across at most two child
workers, transfers copied compressed slices, and receives canonical typed
results by transfer. This keeps the main thread free and avoids decoding other
glTF scenes while bounding decoder heaps and transient compressed storage on
Quest-class devices. A missing worker capability or spawn failure before task
submission uses the same serial task executor; codec/content failures remain
asset failures. The pool reuses Royal's lazy preparation-worker asset rather
than shipping another decoder implementation.

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
