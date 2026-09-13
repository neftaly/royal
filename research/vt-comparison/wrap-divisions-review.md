# Wrapped UV division experiment: rejected

The latest retained [heap profile](empty-failed-atlas-profile-after.json) attributes
its largest sample to wrapped-range demand. Source attribution does not identify
individual arithmetic operations as allocations; this experiment only screens
whether computing each vertex's perspective division once helps CPU work.

The candidate stores six divided UV values before calculating minimum and maximum
bounds, replacing twelve written divisions. It adds two source lines and six
locals, with no persistent state. Production source was never edited.

The [comparison script](compare-wrap-divisions.mjs) extracts and transpiles the
actual current addWrappedRange block, replacing only page insertion with sequence
capture for correctness and a checksum for timing. All 10,000 deterministic cases
match in page coordinates and order across clamp, repeat, and mirrored-repeat
samplers and varying perspective divisors. These finite, moderate-coordinate cases
are not exhaustive coverage of malformed UVs or clipping.

Six alternating rounds of 500,000 calls after 50,000 warmups each yielded median
144.59 ms before and 146.58 ms after
(1.37% slower). Individual rounds vary; there is no
consistent improvement to justify changing production or running a full GPU
comparison. This is isolated Node CPU screening, not browser frame time, GPU time,
or GC evidence. All checksums match. No claim is made about whether a particular
JIT already eliminates repeated divisions.

[Raw measurements](wrap-divisions-comparison.json) include the exact production
source SHA-256; [candidate block](wrap-divisions-candidate.txt) preserves the rejected
experiment. The source hash was verified again after measurement. No production
changes or commits were made.
