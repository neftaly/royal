# Probability: displaced glTF edge overlays

Status: implemented in Royal after Probability integration and browser
verification.

## Blocker

Probability keeps the document model stationary while a drag is pending. The
presence operation describes the intended destination, and only the selection
outline and movement guide move. The document model moves once the drop
commits.

The implemented `outlineGltf(...)` path cannot express that behavior. It lowers
the outline at its presentation transform, then
`SurfaceGpuOwner.borrowPresentedGeometry(...)` requires the resulting model
matrix to equal a rendered base-scene occurrence. The first displaced drag
frame therefore reports:

```text
Royal outline glTF "<src>" must match one rendered base-scene occurrence
```

Probability reproduced this in its ordinary Chromium interaction suite after
replacing copied support-shape wireframes with `outlineGltf(...)`. Static
selection works; moving the intent outline while leaving the authoritative
model still does not.

This is not an optional animation feature. It is the app's document/presence
boundary: pending intent must not mutate or visually move document state.

## Required behavior

An edge overlay needs two independent facts:

- which rendered occurrence lends its exact selected scene, LOD, primitive
  geometry, instances, and GPU allocations;
- where that borrowed geometry is presented in the overlay.

The common case keeps both transforms equal. A drag supplies the source
occurrence's current transform and a different presentation transform. Royal
must still borrow rather than prepare or upload duplicate geometry.

Royal's closed descriptor is:

```ts
outlineGltf({
  src,
  sourceTransform: documentTransform,
  transform: intentTransform,
  material,
});
```

`sourceTransform` is optional and defaults to `transform`, preserving the
current static API.

The source transform selects the rendered occurrence and its active LOD. The
presentation transform determines the mask draw matrix and world bounds. Do
not choose a new LOD from the displaced intent and do not require another base
occurrence at the intent position.

## Implemented ownership

For an explicitly displaced outline, edge lowering retains two matrices for
each selected primitive:

- `sourceModel` composes `sourceTransform` with the asset's nested node
  transform and is used only to find the base occurrence;
- `model` composes `transform` with the same nested node transform and is used
  for mask drawing, handedness, and presentation world bounds.

The ordinary base `SurfaceGpuOwner` matches asset source, version, selected
scene, primitive geometry, internal instance cohort, and the complete
`sourceModel`. It then lends only the resource belonging to that mounted
occurrence's currently active base-scene LOD. The presentation position never
runs an independent LOD choice.

Mounted occurrence identity is lowering-owned and remains distinct even when
one immutable `gltf(...)` descriptor object is repeated in the scene. Zero
source occurrences reports `missing`; more than one reports `ambiguous`.
`EdgeOverlayOwner` preflights every surface before any edge draw (and before
pipeline compilation on a cold edge lane), so one invalid occurrence cannot
leave a partially drawn edge overlay.

No explicit `sourceTransform` keeps the existing single-lowering static path.
An explicit source transform adds only canonical CPU lowering for the source
matrices. It reuses prepared geometry references and creates no source read,
geometry upload, instance upload, picking surface, or hidden world occurrence.

## Adversarial constraints

- Moving the ordinary glTF node would make presence intent look like committed
  document state and breaks Probability's interaction model.
- Publishing a hidden duplicate glTF at the destination adds world work and a
  false geometry occurrence.
- Falling back to Probability's `SupportShape` recreates the visual-authority
  mismatch this primitive was intended to remove.
- Matching only by `src` is insufficient when selected scenes, versions,
  active LODs, or differently transformed occurrences diverge.
- A mutable render-object reference is not required. Probability can replace
  the retained overlay declaratively on pointer movement.

## Acceptance

- A source glTF remains at transform A while its edge overlay presents at B.
- The overlay borrows A's exact selected scene, active LOD, primitive geometry,
  nested node transforms, instance cohort, index ranges, and GPU allocations.
- Only the outer presentation transform changes from A to B.
- Static outlines retain their current behavior without a required new field.
- Displaced outlines remain non-picking, always visible, retained-overlay
  updates and do not redraw or republish the base world.
- Missing or ambiguous source occurrences fail before drawing, with diagnostics
  that distinguish the source-occurrence transform from the presentation
  transform.
- Probability's drag interaction produces no scheduled-frame error while the
  model stays stationary and the outline follows the pointer.

Royal regression coverage verifies a warm displaced update against a nested
glTF transform. The retained base is restored without a world redraw, the mask
uses the intent matrix, only one borrowed edge geometry draw occurs, and no
buffer or glTF source upload is repeated. Separate tests cover the default
static behavior, authored glTF instance cohorts, missing sources, and ambiguous
repeated descriptor occurrences.
