# Native page CPU preparation benchmark

The [browser fixture](native-page-read.ts) measures the actual authored native
page reader, including a fresh Response and body buffer, native KTX2 parsing,
source-contract validation and close. Six 144×144 stored-page formats run eight
rounds of 100 reads each, alternating format order after 100 warm-up reads per
format. Total measured reads: 4,800. The benchmark uses the headless Chromium
host-GPU runner, but this measured operation itself is CPU-only.

| Encoding | Block bytes per page | Median microseconds per read |
| --- | ---: | ---: |
| ktx2-etc2 | 20,736 | 62.0 |
| ktx2-astc-6x6 | 9,216 | 51.5 |
| ktx2-astc-8x8 | 5,184 | 30.5 |
| ktx2-bc1 | 10,368 | 40.5 |
| ktx2-bc3 | 20,736 | 58.5 |
| ktx2-bc7 | 20,736 | 53.5 |

Values are per-read averages of each 100-read batch, with the median taken across
eight batches; they are not individual-read latency percentiles. The combined
run records nine GC events totaling 13.204 ms, and retained backing storage is
108,345 bytes before and after forced GC. The benchmark retains its result rows,
so a small live JS increase is not attributed to production code alone.

A preparation assertion confirms parser block views share the fixture buffer;
this does not mean the whole read is zero-copy. Response construction and
arrayBuffer consumption copy/allocate body storage and are included. Payloads
are structural native fixtures, not a rendered image-quality comparison.
No network, runtime page scheduling, binding validation, GPU upload, transcoding,
or raster decoding is measured. These figures establish preparation scale under
this harness, not end-to-end loading speed or a platform-independent format
ranking. Engine/GC variation and payload size both affect batch times.

[Raw results](native-page-read-results.json) retain all batches, browser renderer,
and GC measurements. The first fixture attempt omitted the mandatory page token
in the URI template and failed module initialization; it produced no measurements.
The corrected fixture uses `{page}.ktx2`. Research typechecking and diff whitespace
checks pass. This adds research infrastructure only; no production changes or
commits were made.

## Isolated parser comparison

A parser-only mode uses retained input bytes and synchronous calls, consuming
returned block lengths. It performs 10,000 warm-up parses per format followed by
eight alternating-order batches of 10,000 parses per format (480,000 measured
parses). This avoids response-body handling and async source work. A second
full-read run uses the same build and its original 100-read batch settings.

| Encoding | Parser µs/page | Full read repeat µs/page |
| --- | ---: | ---: |
| ktx2-etc2 | 0.445 | 54.5 |
| ktx2-astc-6x6 | 0.455 | 38.5 |
| ktx2-astc-8x8 | 0.455 | 30.5 |
| ktx2-bc1 | 0.485 | 41.0 |
| ktx2-bc3 | 0.520 | 55.0 |
| ktx2-bc7 | 0.485 | 55.5 |

The parser run records 253 GC events totaling 22.021 ms across 480,000 parses;
the full-read repeat records nine totaling 13.072 ms across 4,800 reads. Raw
counts have different denominators and must not be compared as GC improvements.
Full-read ASTC 6x6 varies from 51.5 µs in the first run to 38.5 µs in the repeat;
8x8 remains 30.5 µs in both. These results reinforce reporting scale rather than
promising a stable cross-format ranking.

The roughly sub-microsecond isolated parser cost suggests parser optimization
is a low-priority target relative to the complete browser read path. It does
not prove an exact percentage attributable to Response copying: warm-up counts,
synchronous versus asynchronous execution, JIT optimization, and source-level
validation differ. Reused buffers can be cache-hot, and the synchronous benchmark
need not retain all temporary objects that a caller would. No runtime change
is justified by this experiment alone.

[Parser results](native-parser-results.json),
[full-read repeat](native-page-read-repeat.json).
Research typechecking passes. The production runtime hash remains unchanged;
only the research fixture and evidence changed, with no commits.

## Local HTTP comparison

The HTTP mode reads the same structural payloads from the local static server,
using browser Fetch with `cache: no-store`. It keeps sequential source reads,
100 warm-up reads per format, eight alternating-order rounds, and 100 reads per
batch (4,800 measured reads). The wrapper maps each request to its format's
fixture path; response bytes are supplied by the server rather than an in-memory
Response constructor.

| Encoding | Median batch-average ms/page |
| --- | ---: |
| ktx2-etc2 | 2.115 |
| ktx2-astc-6x6 | 2.147 |
| ktx2-astc-8x8 | 2.162 |
| ktx2-bc1 | 2.140 |
| ktx2-bc3 | 2.145 |
| ktx2-bc7 | 2.140 |

The [HTTP run](native-page-http-results.json) records 25 GC events totaling
30.788 ms. Roughly 2.1–2.2 ms per read across all formats shows request/server and
browser handling dominate these small payload differences in this sequential
localhost setup. This does not measure remote network conditions, cold filesystem
I/O, concurrent VT throughput, or GPU upload. The actual runtime overlaps native
transport; these numbers must not be presented as frame cost or its page-rate
limit. `no-store` prevents ordinary browser response-cache reuse, while the local
server/filesystem is warm. No compression-quality conclusion follows.

Regenerate payloads with `node research/vt-comparison/generate-native-read.mjs`,
then run the normal research client build and use `native-page-read.html?http`.
The generator uses the same native structural fixture as the in-memory mode.
Research typechecking, generator syntax, and diff whitespace checks pass.
Production source hash is unchanged. No production changes or commits were made.

## Four-read transport comparison

HTTP `?http&parallel` runs groups of four page reads with Promise.all, matching
the runtime's maximum number of outstanding page jobs. A complete group settles
before the next begins; unlike the runtime's refill scheduling, this harness can
wait for a group's slowest request. Both modes retain the same eight alternating
format-order rounds, 100 reads per batch, and 4,800 measured reads. The parallel
run and a fresh sequential control ran one after another on the same client build.

| Encoding | Sequential ms/page | Four-read ms/page | Lower batch-average time |
| --- | ---: | ---: | ---: |
| ktx2-etc2 | 2.202 | 1.594 | 27.6% |
| ktx2-astc-6x6 | 2.165 | 1.561 | 27.9% |
| ktx2-astc-8x8 | 2.138 | 1.545 | 27.7% |
| ktx2-bc1 | 2.146 | 1.552 | 27.7% |
| ktx2-bc3 | 2.164 | 1.606 | 25.8% |
| ktx2-bc7 | 2.202 | 1.639 | 25.6% |

The four-read run recorded 14 GC events / 25.173 ms; the sequential control
recorded 20 / 28.514 ms. These whole-run observations do not establish an intrinsic
allocation reduction: the parallel harness adds Promise.all and batch arrays,
and GC timing depends on execution. The consistent throughput benefit supports
keeping the existing bounded overlap, but does not identify an optimal limit or
justify increasing it. Local server/browser scheduling limits scaling; this is
not a remote-network or GPU-upload benchmark. No production policy changed.

[Four-read results](native-page-http-parallel.json),
[sequential control](native-page-http-sequential-repeat.json).
Research typechecking and diff whitespace checks pass. Production runtime hash
is unchanged, with no commits.

## Runtime refill regression

The authored overlap runtime matrix now adds a refill mode for PNG, ASTC 6x6,
and ASTC 8x8. A 512×512 virtual source loads its coarsest page and holds four
subsequent transports open. Completing only the first of those requests permits
its upload and a fifth transport while the other three remain unresolved and
unaborted. The snapshot shows two resident pages, four pending pages, and exactly
four pages' reserved bytes. The decode scheduler remains idle while these reads
wait for transport. Disposal cancels the remainder and returns pending bytes
to zero.

A temporary mutation made scheduling return whenever any active page job existed.
All three refill tests failed because a fifth read could not start. The runtime
was restored byte-for-byte in a finally block. The restored runtime/growth suites
pass 165 tests, root typechecking and diff whitespace checks pass. This deterministic
mocked-transport/GL check verifies the runtime refills rather than waiting for an
entire group, so the preceding HTTP batch benchmark is conservative in that
respect. It does not quantify the difference under real network conditions.
No production changes or commits were made.

## Refill after transport failure

The overlap matrix additionally rejects one of four pending requests for PNG,
ASTC 6x6, and ASTC 8x8. A fifth read starts directly from asynchronous settlement,
without another runtime.update call. The existing coarse page stays resident;
one failed page is recorded, and four pending pages retain exactly four pages'
byte reservation. After 100 further updates, the request count remains five and
the outstanding signals remain unaborted. Disposal settles the remaining pending
bytes to zero.

A temporary mutation scheduled replacement work only after successful read
completion. All three failure-refill regressions failed, detecting the missing
asynchronous reschedule. The runtime was restored byte-for-byte in a finally
block. All 168 runtime/growth tests and root typechecking pass; diff whitespace
checks pass. This verifies a scheduling contract with deterministic mocked
transport and GL, not a latency guarantee under network or upload contention.
No production changes or commits were made.
