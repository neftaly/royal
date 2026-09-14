import { canonicalMaterialHasTransmission, type CanonicalSurfaceMaterial } from "../surface/canonical-material";
import type { PreparedStaticGltf } from "./static-asset";

const orderIndependent = (material: CanonicalSurfaceMaterial): boolean =>
  material.alphaBlend !== true && !canonicalMaterialHasTransmission(material);

/** Conservative whole-asset eligibility. Per-instance LOD or sorted transparent
 * surfaces must retain individual mounts. Callers must also reject translucent
 * tint and preserve each instance's picking identity. */
export const supportsInstanceBatching = (prepared: PreparedStaticGltf): boolean =>
  prepared.lights.length === 0 && prepared.primitives.length > 0 &&
  prepared.primitives.every((primitive) =>
    primitive.lods === undefined && primitive.materialLod === undefined &&
    (primitive.materialVariantLods?.size ?? 0) === 0 &&
    orderIndependent(primitive.material) &&
    [...(primitive.materialVariants?.values() ?? [])].every(orderIndependent));
