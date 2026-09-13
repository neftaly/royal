# Large-authority budget contention

Date: 2026-09-13. Research-only pass; no renderer changes or commits.

The new `?large-contention=1` fixture places two independent 4096x4096 PNG
authorities in one renderer root. Each fitted bitmap exceeds half the 64 MiB
automatic decoded-source budget. The glTF, raster and ASTC URLs are distinct;
identical PNG content therefore cannot make this a shared decoded-source test.

Both ASTC LDR 6x6 and 8x8 cases pass on headless Intel Iris Xe / ANGLE Vulkan:

1. The first texture loads its full authority and renders blue.
2. Adding the second texture renders its red native preview. Across 120 further
   frames the first stays blue, the second stays red, and no second raster read
   starts. No failure is recorded for budget denial.
3. Removing the first texture frees capacity. The second reads its raster once
   and becomes blue without a new version or scene/root replacement.
4. Removing the final texture returns decoded bytes, automatic resources, atlas
   storage and pending work to zero.

| State | 6x6 retained source bytes | 8x8 retained source bytes |
|---|---:|---:|
| First authority | 50,325,668 | 50,325,220 |
| First authority + waiting preview | 50,326,500 | 50,325,604 |
| Second authority after removal | 50,325,668 | 50,325,220 |
| Final removal | 0 | 0 |

The root remains below its decoded-source ceiling on every inspected frame. Reads
are exactly first ASTC, first raster, second ASTC, second raster. While waiting,
there is one unresident detail page and zero pending reads; this is expected
deferred demand with usable native coverage, not a page failure. Atlas storage
grows from 69,696 to 139,392 bytes for the two-resource demand and is fully released
on final removal. This test does not claim that waiting avoids all GPU allocation.

Review checked independent identities, visible coverage at separate pixel
positions, a genuine two-authority budget conflict and the absence of an explicit
retry/version change. A second pass checked exact read order, per-frame budget
limits and complete final ownership release. An initial fixture assertion used
48 MiB as an exact lower bound; the fitted bitmap is slightly smaller. It was
corrected to the actual contention invariant: each authority exceeds 32 MiB.

Real browser PNG decoding and retained accounting are exercised. Peak browser
memory, transient decoder allocations and encoding the fixture canvas are outside
this budget. Aggregate trace data includes setup and is not performance evidence.
Research TypeScript, Vite build and whitespace checks pass.

Evidence: [two host cases](large-contention-results.json),
[source hashes](large-contention-sources.json), [fixture](large-contention.ts).
