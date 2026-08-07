/** Presentation-only depth intent for geometry authored on an opaque support surface. */
export type SurfaceDepth = 'contact';

export const resolveSurfaceDepth = (
  value: SurfaceDepth | undefined,
): SurfaceDepth | undefined => {
  if (value === undefined || value === 'contact') return value;
  throw new TypeError('surfaceDepth must be contact');
};
