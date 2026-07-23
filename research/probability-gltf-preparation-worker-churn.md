# Observation: one preparation worker lifecycle per glTF

Status: measured consumer criticism; Royal should choose the remedy only after
isolating startup cost from useful preparation work.

## Product trace

Probability's Settlers board claims 46 distinct HTTPS glTF roots at once. After
moving root parsing and non-visual preparation fully into Royal, a July 2026
Chromium reload recorded:

- 46 glTF root requests for 46 unique roots;
- 102 requests for 102 unique game model resources; and
- 46 requests for one
  `static-preparation-worker-*.js` module.

The complete page made 189 requests for 144 unique URLs. The worker module was
the only repeated URL. The trace is retained at
`/tmp/probability-claims-after.json.gz`.

Royal correctly admits no more than eight preparation jobs concurrently, but
`prepareStaticGltfInBrowser` creates and terminates a worker for every admitted
external glTF. The concurrency ceiling therefore bounds simultaneous workers,
not worker creation over the asset set. A many-piece application pays 46 worker
lifecycles and presents 46 worker-module request entries even though its
preparation work is one bounded root-owned queue.

Probability's LCP was 1.386 seconds in this run, improved from a previous
1.628-second trace after removing its duplicate root loader. This observation
does not yet attribute a specific portion of that remaining time to worker
startup, and browser module caching means 46 request entries do not imply 46
full network transfers.

## Desired renderer property

A bounded batch of independent glTF preparations should not pay unbounded
worker startup and module-evaluation overhead. The property belongs to Royal's
existing preparation scheduler and worker shell; it requires no consumer API
or Probability-specific batching protocol.

Candidate implementations include a root-owned reusable worker set, a worker
task queue, or amortized workers which accept another task before termination.
Royal should select among them using its cancellation, transferred-storage,
Draco, fault-isolation, and root-disposal invariants. Probability should
continue to submit ordinary complete asset claims.

## Acceptance evidence

1. A fixture claiming more glTF roots than the preparation concurrency ceiling
   creates at most a bounded number of preparation-worker lifecycles.
2. Each task retains independent cancellation and failure; one invalid asset
   cannot poison the worker or block later tasks.
3. Root disposal terminates every retained worker and releases queued task
   closures and bytes.
4. Transferred root, external-resource, prepared-geometry, and Draco storage
   keeps one clear owner; reuse does not add defensive copies by default.
5. A cold many-root browser trace reports worker starts, module evaluations,
   main-thread time, first usable geometry, and complete geometry before and
   after the change. A one-root fixture must not materially regress.

## Adversarial review

- Do not keep a global immortal pool. Worker lifetime belongs to a renderer
  root and its bounded scheduler.
- Do not expose pool size as consumer tuning without a demonstrated product
  need; the existing concurrency limit is renderer policy.
- Do not serialize all preparation through one worker merely to reduce request
  count. First usable and complete geometry matter more than the count itself.
- Do not infer speedup from duplicate request rows alone. Prove avoided startup,
  evaluation, GC, or scheduling cost on the Safari A10 and Chromium floors.
- Do not move external-resource fetching back into Probability. Royal already
  owns preparation, reads, cancellation, and asset identity.
