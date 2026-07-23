# Proposal: observable glTF root extras without a second parser

Status: accepted and implemented. Royal publishes optional typed `rootExtras`
on drawable glTF snapshots from its existing canonical parse. The public value
takes one cold ownership copy, remains reference-stable across texture-progress
publication, and is not interpreted by the renderer. The normative contract is
in `docs/specs/consumer-api.md`; this file retains the motivating measurements.

## Consumer need

Probability puts optional application capabilities in standard glTF root
`extras`. Royal already reads and prepares that root, publishes authoritative
asset bounds, and exposes a focused asset lifecycle. Probability currently
fetches and parses every root a second time only to obtain those extras and an
early bounds approximation.

This is not a request for Probability-specific behavior or a public glTF scene
graph. The potentially general primitive is the parsed root `extras` JSON value
on the existing focused asset observation.

A possible shape is an optional, immutable `rootExtras` field on drawable
`GltfAssetSnapshot` states. Naming and exact typing are Royal's decision. Useful
semantics would be:

- derived from the same root parse already used for preparation;
- scoped to the exact source/version/selected-scene claim like the snapshot;
- referentially stable across unrelated texture-progress publications;
- absent when the root has no extras;
- no extension interpretation, Probability schema knowledge, or mutable user
  data inside Royal; and
- no whole parsed document or prepared scene graph exposed as public API.

Publishing extras with `streaming`/`ready`/`degraded` is sufficient for
Probability. It does not need to delay usable geometry or add a separate
loading protocol.

## Why this is preferable to a host cache

A July 2026 cold Settlers trace showed:

- 46 HTTPS glTF root reads by Probability for bounds/metadata;
- the same 46 root reads when Royal prepared the assets; and
- 150 fetch requests overall.

An app experiment connected both consumers through Royal's existing
`gltfResourceReader`. It reduced the trace to 104 requests and removed every
duplicate root read, but LCP changed from 1.628 s to 1.679 s. That is no
measurable improvement and may be a small regression from extra promise/copy
and lifetime plumbing. It also retained potentially large GLB bytes at the app
boundary. The experiment was reverted.

The roots in this fixture are small, immutable Cloudflare-cache hits. Avoiding
the requests is still useful for bandwidth, parsing, memory churn, and simpler
ownership, but an application cache is the wrong way to achieve it. If Royal
exposes the already-parsed extras, Probability can delete its runtime glTF
parser and root fetch pass. Its custom reader remains only where the host
actually owns transport policy: I&S files, authenticated bytes, and release
digest verification.

## Separate observation: sequential shared-resource reuse

The reduced trace still fetched at least one identical external buffer twice
(`buffer-65f85b6318cd0fbe.bin`). `GltfAssetOwner` keys shared reads by resolved
URI/request/version, but `SharedByteReadOwner` retires a settled single-waiter
entry because that consumer may receive transferable storage. A second asset
which requests the same URI just after settlement therefore rereads it.

This is worth a Royal-side benchmark, not an assumed request to retain every
source. Candidate directions include a small bounded copy-on-settlement window,
keeping immutable source storage and copying delivery views, or scheduling
preparation so identical pending URI claims overlap. Any solution should retain
Royal's cancellation and memory bounds and prove that copies cost less than the
avoided transport/decode work. It is independent of the root-extras API.

Decision after inspection: retain the existing policy pending a focused
benchmark. Concurrent exact reads already share transport and receive
caller-owned storage under a 32 MiB LRU bound. A settled single-consumer read is
deliberately zero-copy and therefore cannot also be retained after its storage
may be mutated or transferred. Retaining every such read would add a full byte
copy and potentially 32 MiB of live CPU storage.

Correction: the reduced host-sharing trace does contain the same
`buffer-65f85b6318cd0fbe.bin` request twice. Both requests are Royal external
resource reads; Probability's resource projection reads roots, not their
external buffers. This confirms the sequential-reuse gap described above. It
does not show that copying and retaining every settled read is faster: the
host-cache experiment still did not improve LCP, and this buffer is a small
immutable cache hit. Revisit the policy with the two-root fixture in acceptance
item 5 and report avoided transport/decode time against copy cost and retained
bytes.

Royal follow-up adds that deterministic two-root fixture. With the current
policy, two non-overlapping claims for one external URI perform two reads; the
shared-read owner copies zero transport bytes and retains zero settled source
bytes. A
copy-on-settlement policy would avoid the second read only by copying and
retaining the complete first result, then copying again for every later
caller-owned delivery.

A seven-trial Node 24.12 host microbenchmark measured representative
`Uint8Array.slice()` medians of 2.3 microseconds for 1,672 bytes, 11.9
microseconds for 64 KiB, and 44.2 microseconds for 256 KiB. Those CPU costs are
small, but they do not establish a product benefit: removing 46 duplicate root
requests in the host-cache experiment did not improve LCP, and the duplicate
external request was an immutable browser-cache hit. Retaining even a small
window would impose copies and live bytes on every qualifying unique resource
to optimize one observed repeat.

Decision: keep zero-copy single-consumer delivery and concurrent-only sharing.
This is now a measured rejection rather than a denial of the duplicate. Reopen
it if a trace shows sequential transport or decode on the critical path, then
select explicit per-entry and total byte limits from that workload rather than
turning the existing 32 MiB concurrent-sharing bound into a general cache.

## Suggested acceptance evidence

1. A renderer using ordinary `fetch` observes root extras without another read
   or parse.
2. Two subscribers to the same exact asset see one stable extras value while
   texture progress changes.
3. Missing or unusual extras do not make an otherwise supported asset fail.
4. The public value cannot mutate Royal's prepared asset.
5. A fixture with two roots referencing the same external URI records whether
   sequential reads are reused, with retained bytes and copy cost reported.

Probability traces are retained at:

- `/tmp/probability-shared-before.json.gz`
- `/tmp/probability-shared-after.json.gz`

Those paths are diagnostic context only and are not expected to become Royal
fixtures.
