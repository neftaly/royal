# Royal 0.0.25 adversarial review

Scope: imported-light control, optional capture entry points, linked Probability
adoption and proposal reconciliation. Reviewed before release on 2026-09-11.

## Findings and fixes

- **Elapsed capture deadline:** relying only on the timeout task allowed an
  encoding callback to succeed after the deadline if task scheduling delayed
  the timeout callback. Capture now checks elapsed monotonic time at every
  validity check, including before accepting encoded pixels. Regression cases
  cover late encoding and a late preparation frame without firing the timer.
- **Malformed cancellation input:** invalid JavaScript signal objects could
  fail during cleanup. Validate the signal shape before installing listeners
  or starting preparation; four invalid forms have regression coverage.
- **Stale proposal claims:** historical full-scene outline lookup and the optional
  capture module were still described as pending. Archive the original outline
  investigation and keep implemented behavior separate from hardware follow-up.

## Reviewed contracts

Imported-light opt-out is per mount and does not change shared asset identity,
geometry, material, picking or default lighting. Both ordinary and instanced
mounts omit directional/point/spot imports without retaining light-update bindings.
The current limits remain four directional and eight point/spot lights combined.

Capture borrows existing resource owners, enforces one request per root and
releases the capability after success or failure. Source/GPU readiness and
admitted VT residency precede the final redraw. Encoding begins in the redraw
task; cancellation, context loss, disposal, scene/size changes and late callbacks
are covered. The caller must hold camera, transforms and resources stable.
Overlays and external frame clocks are explicitly unsupported. A failed VT page
can wait until the deadline; this helper does not change texture budget policy.

Capture implementation is exposed through optional subpaths. The measured small
main-graph allowance covers the root capability and imported-light option;
package allowance covers the module, declarations and maps. No runtime VT
opt-out was accepted: the native exploratory comparison changed pixels.

## Validation

Local release checks passed: 1,106 tests in 143 files, the 65-case glTF lab
manifest, typecheck, strict lint, build, public package imports, packed consumer
declarations/codecs and bundle limits. The BLEND browser regression passed all
150 pixel samples. GitHub CI provides the deployment record. The
linked Probability integration was exercised through its root development
server: model face capture, onboarding loading/cardcutter and Play browser smoke.
Software-GPU checks establish behavior, not physical-device throughput.
