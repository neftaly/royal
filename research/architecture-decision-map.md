# Royal Architecture Decision Map

Date: 2026-06-30

Status: canonical research/strategy tracker. This document does not add public
APIs, examples, package exports, app routes, tests, or implementation work.

## Architecture Position

Royal's public API should stay centered on JSX scene authoring and
`@royal/renderer-core` descriptors: scenes, passes, cameras, meshes, materials,
text, glTF references, and stable asset ids. Asset and material manifests are
the integration seam between author intent, content pipelines, and renderers.

Virtual texturing, dynamic LOD, impostors, shader lowering, page residency,
terrain chunking, and backend capability selection are renderer-private
strategies until measured product examples prove a smaller public contract is
needed.

## Goals

- Keep public scene authoring declarative and DOM-free.
- Promote renderer work through measured gates instead of demo pressure.
- Make assets, materials, bounds, revisions, artifacts, and fallback choices
  explicit in manifests before runtime streaming becomes default behavior.
- Keep WebGL/WebGPU backend differences behind renderer-private descriptors,
  diagnostics, probes, and fallback policy.
- Give future agents a short decision map before they touch APIs or examples.

## Non-Goals

- No public algorithm nodes for virtual textures, impostors, LOD, terrain
  chunks, shader variants, page tables, or worker transport.
- No product blessing for `/testing` routes, internal probes, or research-only
  subpaths.
- No large terrain or virtual-texture workload as the primary example while the
  resource substrate is still private.
- No compatibility promise for research manifests, fixtures, or diagnostics.

## Milestones

| Stage | Decision Boundary | Deliverable | Exit Gate |
| --- | --- | --- | --- |
| Commit boundary now | Freeze the public/private split before more demos land. | This map plus existing research notes remain the reference. | Future patches can cite which lane they are in. |
| Resource substrate next | Build material and texture indirection behind current descriptors. | Private material resources, asset/material manifest rows, fallback textures, and lifetime tracking. | WebGL tests/probes prove ordinary textures and fallback resources still work. |
| Renderer-private policy | Connect visibility packets, asset rows, capability rows, and resource demand. | Private reducers for LOD, VT demand, shader/material variants, and diagnostics. | Deterministic probes show bounded CPU/upload cost and named fallback labels. |
| Browser readiness | Exercise the policy in headless/browser routes without product claims. | Browser smoke, perf budgets, visual probes, capability fallback, and rollback hooks. | Repeated runs meet thresholds on supported and fallback paths. |
| Default-ready | Make the automatic path opt-in for real examples. | Default-off feature flag or internal option, public docs limited to behavior and fallback. | Browser/perf gates, probes, fallback, and rollback are documented and green. |
| Always-on | Remove the opt-in only after regressions are unlikely and observable. | Default automatic renderer behavior with diagnostics. | Rollback is cheap, fallback is proven, and public API did not grow algorithm knobs. |

## Promotion Ladder

Use these labels before moving work toward public behavior:

1. **Research**: documents, fixtures, schemas, and deterministic scripts under
   `research/**`; no examples, exports, or renderer behavior required.
2. **Prototype**: focused package-private or research-only implementation that
   proves one responsibility: normalization, upload planning, policy selection,
   rendering equivalence, or fallback.
3. **Internal**: renderer-private integration behind existing public
   descriptors, with diagnostics and tests that cover failure labels.
4. **Default-ready**: opt-in or internally enabled behavior with browser gates,
   perf thresholds, visual probes, fallback paths, and a clear rollback plan.
5. **Always-on**: default behavior after repeated green checks and no need for
   public algorithm controls.

Default-on work must have all of these before promotion: browser coverage, perf
gates, visual or state probes, fallback behavior, diagnostics, and rollback.

## Stop-Doing Guardrails

- Do not add DOM fallbacks to make renderer gaps look solved.
- Do not treat `/testing` subpaths as product examples or stable API evidence.
- Do not grow huge virtual-textured terrain into the primary example.
- Do not expose public algorithm nodes for VT, LOD, impostors, terrain chunks,
  shader lowering, page residency, or backend-private caches.
- Do not bypass manifests by letting examples smuggle resource identity through
  bespoke props.
- Do not use shader or material research to force public backend-specific JSX.

## Active Risks

- **Demo gravity**: visually impressive routes can freeze unstable architecture.
  Keep them research-only until gates and fallback are real.
- **Manifest drift**: VT, terrain, impostors, glTF, and material fixtures can
  diverge. Normalize asset/material vocabulary before runtime coupling.
- **Backend leakage**: WebGL2/WebGPU constraints can leak into JSX props. Keep
  capability choice and lowering private unless a product need is measured.
- **Default-on regressions**: automatic LOD/VT/shader policy can hide failures.
  Require probes, diagnostics, and rollback before broad enablement.
- **Example scale mismatch**: a large terrain scene can obscure whether the
  renderer substrate works for ordinary assets. Use compact fixtures first.

## Next Architecture Backlog

1. Define the private material/texture resource substrate: slots, fallbacks,
   ordinary textures, virtual textures, lifetime ownership, and diagnostics.
2. Consolidate asset/material manifest vocabulary across current research
   fixtures without making it public API.
3. Specify the renderer-private policy inputs: visibility packets, capability
   rows, asset/material rows, camera facts, and frame budgets.
4. Add browser/perf gate requirements for default-ready promotion, including
   supported path, fallback path, visual/state probes, and rollback criteria.
5. Write the small examples policy: examples should show ordinary declarative
   scenes first, while advanced VT/LOD/shader behavior remains automatic and
   inspectable through diagnostics.
6. Audit future proposals against the stop-doing guardrails before accepting
   public JSX props, routes, or package exports.
