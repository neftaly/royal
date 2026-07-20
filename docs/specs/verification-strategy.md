# Specification verification strategy

Status: accepted review policy

Adversarial architecture review is necessary but does not establish that an
implementation conforms. Every normative behavior must have an evidence class,
an owner, and an explicit status in the conformance ledger.

## Evidence classes

### Consumer and type review

Compile representative applications against packed packages. Check that the
React-first path is the shortest documented path, types expose units, defaults,
and lifecycle, errors identify author mistakes, and backend details do not leak.
Review declarations and editor-visible documentation, not only runtime exports.

### Deterministic semantic review

Use focused examples and unit tests for validation, normalization, identity,
transforms, LOD, picking math, state transitions, failure classification, and
resource arithmetic. A pure reference implementation is preferred where the
production form retains mutable workspaces.

### Property, differential, and fuzz review

Use property tests for broad valid domains and invariants, differential tests
between readable reference and retained production planners, and fuzzers for
untrusted parse/validation boundaries. A fuzzer without semantic assertions or
bounded resource expectations is not evidence.

### Lifecycle and failure-injection review

Inject cancellation, stale completion, cache hits, partial failure, admission
denial, context loss/restoration, XR session rejection/suspension/end, Strict
Mode remount, observer reentrancy, and disposal at every asynchronous boundary.
Verify ownership and absence of later work, not merely final status text.

### Format conformance review

Use official specifications, validators, and sample assets for glTF, codecs,
and registered extensions. Record the exact accepted profile. Unknown optional
fallback and required failure are separate tests. Royal fixtures cover
Royal-specific VT and SVG behavior but do not redefine glTF.

### Visual and color review

Use analytic images and fixed assets for orientation, alpha, color domains,
normal handedness, material factors, transmission, LOD continuity, VT borders,
stereo coverage, and fallback transitions. Compare pixels or bounded metrics
where possible; “looks fine” is supplemental human evidence only.

### Browser and physical-device review

Run current target paths on Safari 17/A10-class hardware and Quest 2 in addition
to desktop browsers. Record resolution, DPR/render scale, refresh rate, browser,
camera, scene revision, thermal/session state, capability selection, console,
frame timing, and GPU timer data where reliable.
The page report and server MUST expose the same unique build identity, full
revision, and dirty state. A remembered server start, URL, or open tab is not
evidence for the code under test, and a harness MUST reject a mismatched build
before accepting device results.

### Performance and resource review

Separate startup, parsing, worker decode, upload, CPU frame, GC, GPU frame,
fragment/vertex work, retained/transient CPU/GPU memory, and deployed/reachable
gzip. Test idle settlement and worst coherent scene positions. An FPS number
without resolution, timing attribution, and thermal state is not evidence.

### Security and authority review

Treat asset bytes, SVG, URIs, extension graphs, codec output, and diagnostics as
untrusted. Exercise bounded recursion/arithmetic/messages, malformed inputs,
external-resource rules, and required failure. Browser decoding is not called
sanitization and asset content never gains application authority.

### Package and deletion review

Pack and consume every public entrypoint, inspect side effects and reachable
chunks, and verify lazy features are absent when unused. When replacing code,
prove that abandoned modules, compatibility flags, duplicated tests, and old
runtime paths are unreachable or deleted.

The package review also executes minimal entrypoints to prove import-time
purity, attributes initial versus lazy reachable gzip, checks dependency cycles,
and detects optional feature code pulled through internal barrels or registries.

### Maintainability and agent-context review

Starting from the repository root, a new contributor should identify the public
API, normative specs, frame pipeline, mutable owners, subsystem entrypoints,
tests, and physical harnesses without reading a monolithic root. Review source
maps against actual imports and ownership; do not score arbitrary file length.

### Architecture fitness review

Automate negative boundaries where practical:

- pure/core packages cannot import React, DOM, WebGL, fetch, workers, or XR;
- GL calls occur only in the imperative WebGL execution/resource lane;
- optional entrypoints have no import-time effects and do not enter minimal
  reachable graphs;
- package/module dependency cycles fail the check;
- replacement code cannot import a legacy runtime path;
- frame/draw code cannot query capabilities, parse formats, or build diagnostic
  strings;
- public barrels expose only reviewed symbols;
- TypeScript output contains no accidental enum/namespace/decorator helpers.

Fitness checks protect dependency direction; they do not enforce arbitrary file
length, one class/function style, or mock interfaces around stable pure code.

## Claim-to-evidence rule

Each ledger row names:

- the normative claim or bounded profile;
- current status: conforms, partial, gap, deferred, or proposal;
- automated evidence and its oracle;
- required browser/physical evidence;
- the owner of the remaining gap.

One test may prove several tightly related claims, but a large integration test
does not prove every behavior it happens to traverse. Conversely, do not create
one hand-authored test per malformed value when one property/fuzz boundary
expresses the invariant more completely.

## Primary review map

| Specification area | Primary evidence |
| --- | --- |
| Product and public API | Packed-consumer compilation, task examples, declaration/TSDoc review, author-error tests, reachable exports and gzip. |
| Runtime lifecycle | Transition properties, fake clocks, stale completion, cancellation, context loss, disposal, Strict Mode and observer reentrancy. |
| Scene-to-frame pipeline | Reference/differential planning, packet/state transition models, allocation traces and minimal GL-call evidence. |
| Assets and glTF | Official validators/assets, fuzzed arithmetic and graphs, codec output validation, progressive/failure integration and security review. |
| Textures and VT | Analytic orientation/color/alpha images, demand/publication properties, transactional GPU tests, browser decode and close-view physical cases. |
| Rendering and presentation | Pixel/color oracles, pass-activation traces, material fixtures, GPU timings, transparent/transmission camera-motion tests. |
| Interaction and XR | Analytic ray/triangle properties, visual/pick equivalence, identity tests, session failure injection and physical multi-view runs. |
| Resources and performance | Admission/accounting properties, peak/retained measurements, upload and GC traces, bundle attribution and idle-settlement tests. |
| Module graph and decoupling | Import-cycle/boundary checks, module-evaluation purity, minimal reachable chunks, owner/design-card review and deletion reachability. |
| TypeScript and emitted JavaScript | Declaration consumer tests, exhaustive unions, `unknown` validation, runtime export checks, emitted helper/import inspection and target-engine smoke tests. |
| GS SVG proposal | Schema/sample validation, aware/unaware fallback, required failure, viewport/orientation/color tests and hostile-content boundary review. |

## Review independence

The implementation author performs the first review, but at least one later
pass starts from the normative claim and oracle rather than from the code diff.
For visual or physical claims, capture the observation so a later reviewer can
distinguish device evidence from recollection. A review that only explains why
the implementation is reasonable is not independent conformance evidence.

## Review cadence

- Before a slice: resolve behavior, consumer vocabulary, failure, and oracle.
- During a slice: differential/property and lifecycle review at pure/effect
  boundaries.
- At slice completion: packed-consumer, browser visual, performance/resource,
  and conformance-ledger review.
- Before replacement integration: full physical-device, security, bundle, and
  deletion review.
- After a reported regression: add the smallest durable oracle at the semantic
  boundary, then re-run the affected cross-cut reviews.

Reviews produce evidence or gaps. They do not authorize speculative features or
preserve behavior solely because the previous implementation had it.
