# Manifest queue under rapid scene replacement

The independent manifest lane retains a running transport's slot until its
promise settles, even after its source is removed. This keeps the real outstanding
work bounded when a transport ignores abort. Releasing the slot immediately on
abort would let repeated scene replacements create arbitrarily many unfinished
transports. No production change was made.

A regression replaces three eight-source scenes while the first eight transports
ignore cancellation. After 100 updates, exactly eight requests have started and
all eight signals are aborted. Settling one obsolete request starts exactly one
source from the latest scene without publishing an obsolete notification or
allocating a texture. Settling the remaining seven starts the latest seven;
the intermediate scene never fetches. All eight current manifests then become
ready, with sixteen total reads.

Two isolated controls fail this test:

- Raising concurrency from eight to thirty-two starts twenty-four reads before
  any old transport settles, failing the eight-request bound.
- Removing the successful-response cancellation guard adds one obsolete
  notification, failing the unchanged-publication assertion.

Production was restored byte-for-byte after both controls. The seven manifest
scheduling tests and root TypeScript check pass. These deterministic mocked
transport checks establish ordering and operation counts, not browser latency,
heap retention or a GPU performance improvement.

The remaining limitation is explicit: eight indefinitely unresolved transports
that ignore abort can delay subsequent manifest work indefinitely. Native Fetch
cancellation normally settles the transport; a custom transport must honor the
signal or eventually settle to make bounded progress. Adding a timeout or
logical slot release does not make an uncooperative underlying operation end.
No commit was made.
