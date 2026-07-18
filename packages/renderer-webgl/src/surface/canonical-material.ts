import type { LinearRgba, Material } from "@royal/renderer-core";

export type CanonicalUnlitMaterial = Readonly<{
  baseColor: LinearRgba;
  kind: "unlit";
}>;

export type CanonicalStandardMaterial = Readonly<{
  baseColor: LinearRgba;
  kind: "standard";
  metallicFactor: number;
  roughnessFactor: number;
}>;

export type CanonicalSurfaceMaterial = CanonicalStandardMaterial | CanonicalUnlitMaterial;

/** Erases the public material shape before frame or WebGL work. */
export const prepareSolidCanonicalMaterial = (material: Material): CanonicalSurfaceMaterial => {
  if (material.kind === "wireframe") {
    throw new Error("Royal canonical surface slice does not yet support wireframe materials");
  }
  if (material.baseColor.kind !== "solid") {
    throw new Error("Royal canonical surface slice does not yet support image or virtual textures");
  }
  if (material.baseColor.color[3] !== 1) {
    throw new Error("Royal canonical surface slice does not yet support non-opaque materials");
  }
  return material.kind === "unlit"
    ? { baseColor: material.baseColor.color, kind: "unlit" }
    : {
      baseColor: material.baseColor.color,
      kind: "standard",
      metallicFactor: material.metallicFactor,
      roughnessFactor: material.roughnessFactor,
    };
};
