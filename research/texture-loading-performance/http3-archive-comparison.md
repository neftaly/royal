# HTTP/3 individual requests versus speculative ZIP

Decision: remove the uncommitted ZIP cache, worker, extraction policy, and tests
from Probability. Keep the existing individually validated file path. No schema,
sync/network protocol, or quality change is needed to use HTTP/3: the registry
advertises it and the tested browsers negotiated it normally. Browser fallback to
HTTP/2 remains available; the application does not force QUIC.

Same production build and assets in both arms. The profiling harness rejects only
the speculative whole-ZIP fetch in the control, before network I/O. Ordinary reads
never waited for it in either arm. Desktop uses a fresh Chromium profile, disabled
HTTP cache, Intel Iris Xe via ANGLE/Vulkan, 1280×800 DPR1. Six runs per arm,
alternating pair order (AB, BA, AB, BA, AB, BA). Every registry response reports h3;
a few cancelled requests have no response/protocol. Each trial used one registry
connection. These are shared-host observations; this session is slower than the
previous session, so the two sets are not pooled.

| Desktop median | Individual files | ZIP cache |
| --- | ---: | ---: |
| Interaction | 7.514 s | 7.936 s |
| Full detail | 11.260 s | 10.898 s |
| Registry requests | 552.5 | 250.5 |
| Registry response bytes (CDP) | 5.887 MB | 5.193 MB |

Full-detail ranges: individual 9.802–11.732 s, ZIP 10.423–14.529 s. These overlap
substantially. Fewer requests do not establish a useful loading improvement.
The first interaction comparison favors individual requests; full-detail medians
slightly favor ZIP. Sampling resolution is approximately 0.5 s.

Physical iPad, ABBA sequence, same build and viewport. The fixture sets no-store
on registry fetches in both arms. Safari resource timings also report h3 throughout.
Individual files: 29.228 / 28.914 s full detail. ZIP: 26.949 / 28.262 s. Both paths
pass trusted touch and report no page errors. The modest iPad gain does not justify
the speculative transport, extraction, cache, and integrity-fallback machinery
for this task, especially given the user's preference for less code. Safari's
zero reported transfer sizes are not used for byte comparisons.

Raw results: `/tmp/royal-nova-profiles/quic-default-*/result.json` and
`/tmp/royal-ipad-quic-*.json`. Portable measurements are in
`http3-archive-comparison.json`. This supersedes the archive-retention decision in
`cpu-pages-registry-follow-up.md`; the CPU VT page preparation changes remain.
