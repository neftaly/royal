# Royal specifications

Status: pre-release architectural contract

Last reviewed: 2026-09-05

This directory defines Royal's reviewable intended behavior and the boundaries
that implementations must preserve. Package READMEs explain how to use the
current API; tests provide evidence for individual properties; these
specifications explain what the whole system is intended to mean. None of those
sources proves its own claims: contradictions belong in the conformance ledger.

Royal is still pre-release. A specification may deliberately require a breaking
implementation change. Such a difference belongs in the conformance ledger,
not in an undocumented compatibility path.

## Reading order

1. [Product and public API](product-and-api.md)
2. [Consumer API contract](consumer-api.md)
3. [Runtime lifecycle](runtime-lifecycle.md)
4. [Scene-to-frame pipeline](scene-to-frame-pipeline.md)
5. [Architecture pattern selection](architecture-patterns.md)
6. [Assets and glTF ingestion](assets-and-gltf.md)
7. [Optional glTF feature profile](optional-gltf-features.md)
8. [glTF required-extension conformance ledger](gltf-extension-conformance.md)
9. [Textures and virtual texturing](textures-and-virtual-texturing.md)
10. [Experimental `GS_texture_svg` glTF extension](gs-texture-svg-extension.md)
11. [Rendering and presentation](rendering-and-presentation.md)
12. [Interaction and XR](interaction-and-xr.md)
13. [Resources and performance](resources-and-performance.md)
14. [Hot-path normalization](hot-path-normalization.md)
15. [Failures and diagnostics](failures-and-diagnostics.md)
16. [Specification verification strategy](verification-strategy.md)
17. [Conformance and adversarial review](conformance-and-review.md)

## Normative language

`MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are normative. A section
labelled **Rationale** or **Example** is explanatory. A section labelled
**Open decision** is intentionally not a contract.

The contracts are ordered by authority:

1. safety, ownership, and lifecycle invariants;
2. observable product behavior;
3. format compatibility;
4. performance and quality policy;
5. implementation preferences.

When two requirements appear to conflict, the higher item wins and the conflict
must be recorded in the conformance ledger.

## Product sentence

Royal is a React-first, demand-rendered WebGL2 renderer for attractive glTF
scenes containing many repeated, high-resolution assets on desktop, mobile, and
WebXR devices.

Its primary workload is a mixture of authored glTF geometry, ordinary and
virtual raster or SVG textures, stable picking identities, and many instances.
Royal is not an application state model, scene ECS, physics engine, UI toolkit,
public render graph, or general cross-backend abstraction.

The browser floor is Safari 17. Physical performance targets include A10-class
iPad hardware and Quest 2 WebXR. Optional acceleration must preserve correct
behavior on that floor.

## Contract shape

Every supported path follows the same shape:

```text
author intent
  -> validate and normalize
  -> content-addressed preparation
  -> retained canonical state
  -> pure frame selection
  -> governed resource reconciliation
  -> explicit WebGL submission
  -> bounded observation
```

A feature is not complete if it bypasses this path for rendering, picking,
loading, XR, or fallback behavior.

## Change discipline

A behavior change MUST update the relevant specification and tests in the same
change. New public API MUST identify its owner, lifetime, identity semantics,
failure model, scheduling cost, and tree-shaking boundary. A new internal path
MUST justify why an existing normalization, preparation, selection, or executor
path cannot represent it.

The [conformance ledger](conformance-and-review.md) records known mismatches and
review results. It is not a backlog for speculative features.
