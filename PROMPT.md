# Royal Codex Restart Prompt

You are working in `/home/neftaly/dev/royal`. Use xhigh reasoning for architecture, marshalling, API review, and deciding how to split work. I want maximum throughput: act as the marshal, delegate aggressively to subagents, keep worker slots saturated where merge cost is worth it, and use cheaper/lower-effort workers for narrow implementation or verification tasks. Leave a few slots free for urgent fixes. Close completed agents.

## Operating Model

- Main agent should mostly plan, split work, review, integrate, and verify. Do not personally grind through large implementation unless it is on the critical path or needed to unblock workers.
- Prefer concrete execution over research. If research is needed, convert it into implementation slices with disjoint write scopes.
- Spawn workers with explicit ownership of files/modules. Remind them not to revert others.
- Avoid merge churn: split by package/app/scope, stage only owned files, and verify diffs before commits.
- Keep CI green. Check `gh run list --repo neftaly/royal --limit 10` after pushes.
- Use `rg`/`rg --files` first where available.
- Run focused checks for changed packages, then broader checks before push when practical.
- Push when logical, but do not commit unrelated dirt.

## Current Known State

- Repo: `/home/neftaly/dev/royal`
- Latest good main: `d535c30 Redesign virtual texturing terrain example`
- CI is green on latest main.
- Known local unrelated dirt may exist: `pnpm-lock.yaml` and untracked `apps/expo-hello/`. Do not touch or commit these unless explicitly asked.
- VT direction: no public `VirtualTextureNode` yet. VT should be a private texture/material lowering path, eventually automatic for glTF/material textures.
- Current VT demo should feel like a high-detail texture you keep zooming into: stable terrain, default low/blocky detail, slider to raise detail, atlas/page-table debug preview.

## Next Likely Royal Slices

1. Private `material-texture-binding.ts` seam in `packages/renderer-webgl`.
2. Private `virtual-texture-resource.ts` owning runtime/page-table/atlas/upload/stats.
3. Private VT manifest parser.
4. glTF cache should preserve material/texture identity instead of eagerly erasing to `WebGLTexture`.
5. One automatic VT base-color material path for mesh or glTF, not a public scene node.
6. Bench/smoke: upload budget, exact/fallback ratio, no full page-table rebuild after init, stable zoom-detail behavior.

## First Actions

1. Run `git status --short --branch`.
2. Run `git log -6 --oneline --decorate`.
3. Run `gh run list --repo neftaly/royal --limit 8`.
4. Spawn subagents for: VT material lowering seam, glTF texture identity seam, VT resource/manifest prototype, examples/smoke verification, and API review.
5. Keep reporting concise status and push verified commits when logical.
