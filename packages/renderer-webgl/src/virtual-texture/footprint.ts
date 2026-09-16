/** Matches the fragment shader's ellipse minor axis, widened to cap anisotropy. */
export const virtualTextureFootprintSquared = (
  duDx: number, dvDx: number, duDy: number, dvDy: number, anisotropy: number,
): number => {
  const isotropic = Math.max(duDx * duDx + dvDx * dvDx, duDy * duDy + dvDy * dvDy);
  if (anisotropy <= 1 || !Number.isFinite(isotropic)) return isotropic;
  const a = duDx * duDx + duDy * duDy;
  const b = duDx * dvDx + duDy * dvDy;
  const c = dvDx * dvDx + dvDy * dvDy;
  const majorSquared = 0.5 * (a + c + Math.sqrt((a - c) ** 2 + 4 * b * b));
  const determinant = duDx * dvDy - duDy * dvDx;
  const minorSquared = majorSquared > 0 ? determinant * determinant / majorSquared : 0;
  return Math.max(minorSquared, majorSquared / (anisotropy * anisotropy));
};
