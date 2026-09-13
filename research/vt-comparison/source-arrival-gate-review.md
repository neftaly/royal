# Source-arrival gate review

The starvation reproduction below is resolved by the subsequent
[independent manifest queue](manifest-transport-lane-review.md). The arrival-order
detail limitation remains separate.

The research fixture can now hold SVG source reads or native manifest reads
until the opposite source class has 168 resident pages. This tests established
pool allocation before late admission, rather than merely changing scene order.
The gate is restricted to sixteen healthy mixed sources. It runs before timed
frames and intentionally imposes a dependency that ordinary network transport
does not necessarily have.

Holding eight native manifests exposes [preparation starvation](reserve-gated-native-failure.json).
All eight root preparation jobs remain occupied by manifest transport; four
automatic page jobs are queued, and no SVG VT pages become resident. The
runtime wraps `openAuthoredVirtualTexturePageSource` in the foreground scheduler,
including `fetch` and `response.json()`. This is not proof of an unconditional
real-network deadlock: releasing the network dependency can permit progress.
It shows why slow manifest transport can block otherwise-ready page work. A
fix must preserve bounded manifest transport while separating it from page
preparation; simply launching unlimited fetches is not the intended solution.

Delayed SVG admission is separately [validated](reserve-gated-svg-admitted.json)
with both source classes ready and all admitted demand resident before context
loss. Initial fixture versions were too weak or too strict: one restored the
context before SVG arrival, another rejected valid source rereads, and another
required all 336 desired pages instead of allowing budget-driven coarsening.
Those runs do not establish the final gate contract.

An [observed coarsened state](reserve-gated-svg-final-failure.json) had 336
desired pages, 208 admitted/resident pages and no pending, failed or unresident
pages. It used 59,917,494 of 67,108,864 GPU budget bytes. Arrival timing can
therefore affect attainable detail: fixed native capacity and transient space
needed for image-atlas migration still matter. The up-front reservation fix
does not guarantee identical detail for arbitrary source completion orders.

The final gate waits for both classes' desired demand and checks the existing
admitted-coverage invariant, recording coarsening instead of labelling it a
loading failure. Research typechecking and builds pass. Production source is
unchanged in this review. Scheduler starvation remains unresolved. No commit.
