# Projected Sphere Bounds Prototype

Small TypeScript research prototype for estimating 2D screen-space bounds of a
view-space sphere under perspective or orthographic projection.

The perspective path is inspired by Mara and McGuire, "2D Polyhedral Bounds of a
Clipped, Perspective-Projected 3D Sphere", JCGT 2(2), 2013:
https://jcgt.org/published/0002/02/05/

Scope notes:

- Inputs are already in view space. The camera looks down negative Z, matching
  the renderer projection convention.
- Spheres fully in front of the perspective near plane use analytic tangent
  bounds for the projected silhouette in X and Y.
- Spheres intersecting the near plane return a conservative full-viewport bound.
- Invalid radii and spheres entirely behind the near plane return `undefined`.
- This is intentionally not wired into production renderer code.
