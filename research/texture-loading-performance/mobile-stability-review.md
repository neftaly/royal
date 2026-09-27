# Mobile stability review

The repeated adversarial review fixed native decode pressure and two independent
restoration failures. The final pass found no additional actionable defect in the
reviewed changes. All work remains uncommitted on Royal main. Detailed findings
are in [the review](../texture-memory-reliability/adversarial-review.md); compact
measurements are in [mobile-stability-summary.json](mobile-stability-summary.json).

## Physical iPad

The available device is **iPad7,6 running iPadOS 17.7.11**.
Device kernel logs confirm Safari's GPU process was killed at its 300 MiB
high-water mark (307201 and 307233 KiB). Royal's retained GPU accounting cannot
include all browser-native decode/canvas allocations. The device's 2D context
attributes do not report support for `willReadFrequently`; the hint alone did not
fix the reset. The byte-gate-only run took 70.483 s with a reset; adding canvas
hints still took 72.047 s with a reset. These are failed stability experiments.

Avoiding the large AVIF ImageBitmap intermediate completed in 42.661 s without a
reset. Three subsequent loads completed in **44.179, 46.635 and 54.728 s**, all
without an interruption and with trusted touch selection. The final build reached
full detail in **47.423 s**, then passed deliberately forced context loss,
restoration, full-detail readiness and trusted touch at **80.580 s total**. Its
single interruption was the injected loss; there was no spontaneous reset.

The first recovery test revealed blank cached browser pixels; after that fix,
another test revealed incorrect blend state on translucent ground. Neither is
counted as a visual pass. The final before/after restoration capture has maximum
mean channel error **0.02082/255**, with **0.0724%** of pixels differing by more
than eight channel values. Ground color matches, textures remain visible, and
`compare-canvases.py` passes its explicit tolerances (mean <=0.1, fraction <=0.2%).
The preceding corrected-state run also passed, with maximum mean error 0.01502.

The large-AVIF path changes browser resampling: its earlier comparison against the
old no-reset image had mean RGB error about 0.15/255 and 0.49% of pixels over eight.
The captures were visually inspected with no missing texture or evident quality
drop; they are not bit-identical. No source-resolution or VT demand threshold was
lowered to obtain these results. Several successful runs are bounded evidence,
not a guarantee against every native-memory failure on every document/device.

## Physical Quest 2 and local development

The final Quest run uses **Adreno 650**, not SwiftShader. All 211 interaction models
were ready at **34.495 s** and full detail at **35.700 s**, with 325 images and
147 pages resident, no page errors and no context interruption. Trusted pointer
input selected the picked piece. This is stationary Quest Browser testing with
tracking disabled, not immersive XR/controller validation. Timing variation from
the previous 33.818 s run does not establish an additional Quest speedup.

The final literal-root Probability `pnpm dev` was restarted after rebuilding the
linked Royal package. Nova reached full detail in 39.446 s on hardware Intel
Vulkan, with no page exception, failed script, Vite overlay or development-server
error. Vite emits existing warnings about intentionally dynamic codec/worker
imports; their modules loaded successfully. A transient navigation-probe failure
(`document.body` was not yet available) was fixed before this final smoke check.

Royal passes **1,452 tests / 167 files**, the 64-case glTF manifest check, typecheck
and lint. Royal renderer and Probability production builds pass. Final code review
covered byte admission/cancellation, source ownership, generation races, GPU claims,
GL state, working-set visibility, Big-O, React scene identity and obsolete paths.
No speculative batching or approximate occlusion change was kept. Quest draw-call
submission remains a measured opportunity, not a claim of completed optimization.

Raw final device captures/results are `/tmp/royal-ipad-review-complete.*` and
`/tmp/royal-nova-profiles/quest-review-complete/`; root dev evidence is under
`/tmp/royal-nova-profiles/dev-review-complete/`. The compact checked-in summary
preserves counters and outcomes without copying unrelated device system logs.
