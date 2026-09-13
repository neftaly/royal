# Release pending VT reservations after terminal decode failure

Retained fix: the root's automatic-source callback distinguishes a pending
source (undefined) from a terminal decode failure (null). VT counts the latter
as ineligible, releasing its coarse-page reservation. Previously both cases
looked pending, so failed sources could reserve future space indefinitely.

The callback first returns any available decoded source. It consults terminal
status only when no decoded source is available; ready sources do not incur
another source-key lookup. No persistent field, retry queue, cache or per-frame
object is added. Three textual production lines are added, including the
callback-contract comment.

## Evidence and adversarial review

The lifecycle regression keeps a failed automatic source in the scene. With a
64 KiB mocked-runtime budget, native allocation initially waits behind the
pending coarse-page reservation: 100 updates perform one manifest fetch, no
GPU storage allocations and no retained GPU-byte claims. Reporting terminal
failure clears that reservation and permits the same native identity to load.
It requires neither source removal nor a version change. Context invalidation
and disposal also pass.

The real browser fixture supplies HTTP 503 responses for two SVG sources
alongside two authored ASTC 8×8 resources. Native and failed-image surfaces are
spatially separated so failed-image presentation cannot obscure the native
pixel check. Both insertion orders pass on headless Chromium with the Intel
Iris Xe Vulkan host GPU at 16 MiB. Each SVG is fetched once; waiting sources
fall to zero; two sources count as ineligible; ten native pages remain resident;
the native white-center and GL-error checks pass through 120 moving frames.

Using the original root callback with the same final fixture fails the explicit
assertion that failed sources have released their reservations. This control
retains the candidate VT runtime; it specifically isolates the root callback
wiring rather than representing a complete old-build performance comparison.

First review checked the distinction between pending and terminal states,
embedded-source status access, and recovery without changing identity. Second
review checked ready-source short-circuiting, bounded transport on failure,
insertion order, and the initially misleading overlapping-plane pixel check.
The final fixture verifies native pixels separately. No general CPU/GC timing
improvement is claimed; this is failure ownership and liveness coverage.

## Validation and size

Full suite: 1,309 tests across 149 files plus the 65-case glTF manifest check.
Root/research types, lint and packed consumers pass. Initial size gates found
the package 130 bytes above its old ceiling, and affected total graphs 1–3 gzip
bytes above theirs; these are excesses over ceilings, not measured before/after
binary growth. Added named allowances of 160 package bytes and 8 total gzip
bytes. Final ceilings are 750,064 package bytes, 214,830 main-only gzip bytes
and 274,120 deployed gzip bytes. Other ceilings are unchanged; all pass.

Artifacts: [patch](failed-reservation.patch), [source hashes](failed-reservation-sources.json),
[SVG-first case](failed-reservation-svg-first.json),
[native-first case](failed-reservation-native-first.json),
[original-callback failure](failed-reservation-old-callback.txt).
Reproduce with the existing headless host runner and
`steady.html?case=mixed&motion=move&copies=4&budget=16&frames=120&fail-automatic`,
adding `&native-first` for the reverse order. Everything remains uncommitted.

The 44-case headless host-GPU source matrix also passes on the retained build
([results](failed-reservation-source-regression.json)).

## Malformed content and context restoration

The fixture additionally accepts `fail-automatic=decode`: the intercepted SVG
request succeeds with HTTP 200 and image/svg+xml, but the XML is malformed.
Diagnostic texture snapshots explicitly report `Royal SVG texture source is
not valid SVG XML`, confirming a decoder failure rather than transport failure.

Three-resource layouts exercise asymmetric insertion orders. Each run loses
and restores the actual headless Intel GPU context, then renders 120 moving
frames at a 16 MiB root budget:

| Order | Failed SVG requests | Final native resident pages | Final waiting sources |
| --- | --- | --- | --- |
| svg-first | 2 | 5 | 0 |
| native-first | 1 | 10 | 0 |

Every failed source is requested exactly once, including across restoration.
All error snapshots have terminal error status; native pixel and GL-error
checks pass; no native page failures or pending page reads remain. Unlike the
four-resource HTTP-error case above, these layouts contain two SVG/one native
or one SVG/two native resources, so resident-page totals differ intentionally.

[SVG-first result](malformed-reservation-svg-first.json),
[native-first result](malformed-reservation-native-first.json).
Append `&restore` to the decode-failure mode to reproduce. Research typechecking
passes; production runtime/root hashes still match the retained fix. No
production changes, size allowances or new timing/GC claims were made in this
follow-up.
