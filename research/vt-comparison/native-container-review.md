# Native KTX2 subviews and duplicate metadata

Added ten parser regressions covering ASTC 6×6/8×8, BC1 RGBA, BC3 and BC7.
For each format, a three-mip KTX2 with valid orientation/swizzle metadata starts
seven bytes into a larger backing allocation. Parsing must retain exactly
three mip views, all sharing that backing buffer, with the exact container-
relative offsets and indexed byte lengths. Their bytes must match the original
container. No compressed payload copy is introduced.

A truncated subview must be rejected even though its missing bytes remain
present elsewhere in the backing allocation. The parser correctly validates
the supplied Uint8Array boundary rather than the entire ArrayBuffer. Separate
cases reject repeated KTXorientation and KTXswizzle declarations, even when
both declarations individually contain the accepted value.

Mutation check: temporarily changing the level-storage bound from
`bytes.byteLength` to `bytes.buffer.byteLength` causes all five truncated-view
cases to fail because the malformed container no longer throws. The original
parser was restored in a finally block; git reports no parser diff. All 59
native/ETC2 tests pass after restoration, and root typechecking passes.

This establishes payload-view ownership and malformed-input rejection, not a
CPU timing or GC improvement. The parser itself performs no WebGL operations.
It rejects duplicate metadata before constructing mip views. An authored VT
runtime can allocate a physical atlas after reading a valid manifest and before
fetching an invalid page, so these parser checks must not be interpreted as a
guarantee of zero GPU allocation for malformed authored pages. Page rejection
and atlas lifetime are separate runtime responsibilities.

No production changes, package allowances, GPU benchmarking or commits were
made in this pass. The relevant tests live in
`tests/replacement/renderer-webgl-native-texture.test.ts`; run them alongside
`tests/replacement/renderer-webgl-vt-ktx2.test.ts` to repeat the 59-test check.
