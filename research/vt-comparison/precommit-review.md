# Final adversarial review — 2026-09-13

The full retained change set was reviewed again before the requested commit:
source selection and preview authority, cancellation and decode ownership,
ordinary GPU replacement, shared-pool admission, bounded migration and rollback,
context restoration, hot-path allocation, and the supporting benchmark evidence.
Historical reports retain their original checkpoint and no-commit statements.

One additional correctness issue was reproduced and fixed. During scene
replacement, removing an old authored resource can synchronously notify the
root before the new resources' surface lists have been rebuilt. The storage
reservation getter inspected those intermediate lists and cached `false`, even
though the incoming scene referenced a pending VT manifest. Ordinary textures
could consequently start fitting against an allowance already needed by VT.

The getter now consults the incoming canonical scene. Raster-source refresh uses
an explicit reconciliation flag instead of clearing that scene reference. The
check remains cached; this introduces no extra per-frame scene traversal.

The new reentrant-notification regression fails before the fix (`false` rather
than pending), then passes with the fix. A second review of the corrected paths
found no further blocker. Compaction's temporary detail reduction and possible
page rereads, fixed native atlas capacity, and impossible-budget limits remain
explicitly documented in the [previous review](three-review-fixes.md).

Final checks: 1,505 tests across 152 files, 65 glTF cases, TypeScript, lint,
packed entrypoint/codec consumers, bundle limits, and diff whitespace checks.
The [headless GPU budget recovery rerun](precommit-budget-recovery.json) confirms
that the fitted raster still upgrades from 1773×1773 to 2048×2048 and renders
[255,0,0,255]. Earlier ASTC 6×6/8×8 delayed-arrival tests establish full 336-page
coverage before and after restoration; their timings are regression evidence,
not a demonstrated speedup.

The commit contains implementation, tests, specifications and the research
record, including clearly labelled rejected experiments. The user-owned local
proposal is excluded. No push, deployment or version release is requested here.
