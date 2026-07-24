# Proposal: cross-root texture source/decode reuse

Status: accepted narrowly and implemented in Royal. End-to-end Probability
improvement remains to be remeasured.

## Royal decision

Royal already canonicalized decoded identity across source URL/content,
version, encoding and fallback recipe, then forked color-space storage and
sampler state only at their actual later boundaries. The repeated request was
therefore not evidence for another cache. A scene-composition gap could release
the last visible texture claim even while an explicit non-visual claim retained
the prepared glTF root; a later visual publication recreated browser work.

The implemented ownership rule remains lazy:

- a never-visible non-visual glTF claim prepares no material images;
- once visible demand establishes a root's texture claims, overlapping root
  ownership retains those canonical identities across a temporary visual gap;
- the last visual and non-visual root owner releases them immediately; and
- no encoded-byte copy, grace timer, detached LRU, consumer manifest or
  all-ready barrier was added.

A focused two-root oracle uses one shared external image, proves no eager
decode, crosses a visual gap, observes one decode, then proves last-owner
release. Existing texture-owner oracles cover shared decode across sampler and
color-space forks, distinct version/encoding recipes, alpha-demand upgrades,
GPU denial and context restoration.

The built-in browser path now attributes transport queue, transport, decode
queue and decode durations at its existing asynchronous boundaries. Focused
ready texture state includes claim-to-ready and complete preparation timing;
the broad root snapshot optionally sums browser-stage durations across
currently retained ready sources. These diagnostics are bounded current state,
not a retained request log.

Probability still needs to rerun the same CDP oracle. Fewer browser-decode
initiations are acceptance evidence for this lifecycle fix; a faster final
content-changing frame must be measured separately before claiming an
end-to-end loading win.

## Consumer evidence

Probability's Settlers fixture submits 46 independent glTF roots that remain
claimed together. A July 24 production Play build against Royal `44fb94da`
reached its last observed content-changing canvas frame at about 9.6 seconds
and network/pixel quiet at about 11.8 seconds in one cold headless Chromium run.
Those wall-clock values are noisy and do not identify a cause.

CDP does identify a narrower repeated operation. Several AVIF URLs issue two
script-initiated `fetch` requests from Royal's browser decode path. For each
observed pair:

- the first response is a normal HTTP 200;
- the second response is HTTP 200 with `fromDiskCache: true`;
- both have the same browser-decode initiator stack; and
- the glTF root claims overlap for the lifetime of the board.

The second request therefore does not prove duplicate wire transfer. It does
show that browser HTTP caching, rather than one retained Royal source/decode
claim, is currently absorbing repeated cross-root demand. The possible waste is
request lifecycle, image decode, decoded storage, upload, or publication work;
stage diagnostics are needed before attributing the 9.6-second tail.

## Requested primitive

Please evaluate root-owned, canonical texture source/decode claims that can be
shared by overlapping glTF roots. The reusable boundary should be the earliest
correct common stage, not necessarily one final GPU texture.

In particular, the key must preserve every semantic that changes decoding or
pixel interpretation. Different glTF samplers, colour-space uses, alpha-mask
requirements, mip policies, or GPU representations may need distinct later
views/uploads even when they can safely share one encoded read and perhaps one
decoded image. URL equality alone is not sufficient authority.

The desired default behavior is:

1. overlapping compatible claims cause one encoded source read;
2. compatible decode semantics cause one image decode;
3. later sampler/material/GPU variants fork only at their actual semantic
   boundary;
4. one root releasing its claim cannot cancel or evict work still owned by
   another root; and
5. errors, retries, cancellation, and memory accounting remain root-owned and
   observable.

This should require no Probability manifest, preload list, game-name branch,
consumer cache, concurrency knob, or all-ready barrier. Progressive first
geometry and independently resolving textures must remain intact.

## Diagnostics and acceptance evidence

Please expose or use existing diagnostics to count, per canonical source:

- demand/claim count;
- encoded reads and bytes;
- decode starts/completions and decoded bytes;
- GPU view/upload variants and bytes; and
- first demand, first usable presentation, and final release.

A focused oracle should claim the same image from multiple independent glTF
roots, include both compatible and deliberately incompatible usages, then prove
one read/decode only where semantics permit. The Probability follow-up should
confirm fewer browser-decode initiations and a causally improved
content-changing-frame trace before claiming an end-to-end loading win.

## Adversarial review

- Do not call a browser disk-cache hit full reuse; it may still repeat decode
  and publication work.
- Do not merge incompatible colour-space, alpha, mip, sampler, or GPU
  requirements merely because URLs match.
- Do not retain decoded images indefinitely to optimize one board.
- Do not move texture discovery into Probability or add a fourth public state
  boundary.
- Do not trade away early progressive presentation for a whole-scene texture
  batch.
