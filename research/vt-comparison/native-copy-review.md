# Constructor-copy experiment: not retained

The candidate replaces `blocks.slice()` with `new Uint8Array(blocks)`, preserving
exact-size separate backing storage with no added source lines or persistent
state. Isolated correctness checks cover all payload sizes used by the six native
formats and offsets 0, 7, 160 and 1024, comparing every byte and backing bounds.

Initial Node CPU screening was mixed: constructor copies improved smaller sizes
but regressed 20,736-byte copies by about 16%. A headless Chromium copy-only run
instead favored the constructor by about 6–21% across all sizes. These are isolated
copy loops, not complete page reads, and use different engine/runtime conditions.
The browser result warranted a full-path comparison rather than a production edit.

Four sequential headless browser full-read runs used current slice / candidate /
candidate / current slice order. Each has 4,800 fresh in-memory response-body
reads, eight alternating-format rounds and 100 reads per batch. Source maps were
verified against the exact candidate/current file hashes.

| Format | Slice µs/page | Constructor | Constructor repeat | Slice repeat |
| --- | ---: | ---: | ---: | ---: |
| ktx2-etc2 | 46.5 | 49.5 | 53.0 | 46.0 |
| ktx2-astc-6x6 | 40.0 | 39.0 | 41.5 | 39.5 |
| ktx2-astc-8x8 | 37.0 | 32.5 | 31.0 | 35.0 |
| ktx2-bc1 | 46.0 | 54.5 | 44.0 | 54.0 |
| ktx2-bc3 | 62.5 | 69.0 | 72.0 | 73.5 |
| ktx2-bc7 | 65.5 | 58.0 | 55.5 | 69.5 |

Constructor helps ASTC 8x8 and BC7 in these runs, but ETC2 is consistently slower,
ASTC 6x6 is similar, and BC1/BC3 vary. GC event counts/durations in run order are
8/10.554 ms, 10/11.745 ms, 9/12.443 ms, and 10/14.174 ms. This does not show a
consistent overall read-path or GC benefit. Keep the existing slice expression;
no per-format special case is justified. No production source was edited for
this experiment: a research build substituted the candidate from a temporary
file. The exact-memory compaction fix remains intact.

Evidence: [Node screen](native-copy-comparison.json),
[browser copy loop](native-copy-browser-results.json),
[slice full read](native-copy-full-slice.json),
[constructor full read](native-copy-full-constructor.json),
[constructor repeat](native-copy-full-constructor-repeat.json),
[slice repeat](native-copy-full-slice-repeat.json),
[candidate patch](native-constructor-copy.patch),
[source hashes](native-copy-source-hashes.json).
Research typechecking and diff whitespace checks pass. No commits were made.
