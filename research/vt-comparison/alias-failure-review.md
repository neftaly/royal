# Failed-authority alias diagnostics

Date: 2026-09-13. Uncommitted follow-up to shared-atlas failure isolation.

A sampler alias created after its shared native preview authority has failed
correctly avoids detail demand and GPU allocation, but previously reported zero
failures. It bypasses the load path that normally sets `previewSourceFailed`.
The runtime now sets that existing flag when it observes the shared source error.
This adds one assignment, with no retry, allocation, or new resource state.

The strengthened alias regression failed before the fix (expected one failure,
received zero) and passes afterward. Both shared-atlas insertion-order tests now
wait for failure and zero pending reads together: observing the error can precede
the rejected load's promise cleanup. Their binding identity, deletion, residency,
and final budget assertions remain intact.

Review checked that the flag is consumed by diagnostics, while the existing
manifest failure still prevents repeated demand work. A second review checked
that failure detection does not imply synchronous promise settlement and that
the tests retain their settled-state assertions.

Validation: all 88 runtime/growth tests, root type checking, lint, packed consumer
checks, bundle size limits, and whitespace checks pass. No size allowance changed.
No new GPU benchmark was run for this diagnostic assignment; earlier GPU failure
and restoration measurements apply to the preceding rendering implementation.
[Source hashes](alias-failure-sources.json) identify the one-line runtime change
against the recorded failed-authority checkpoint.
