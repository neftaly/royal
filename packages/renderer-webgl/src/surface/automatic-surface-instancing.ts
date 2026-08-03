import { identityMat4 } from "../math/mat4";
import {
  canonicalTextureSampler,
  canonicalTextureSamplerKey,
} from "../texture/sampler";
import { textureStorageKey, type TextureSourceRef } from "../texture/source";
import { virtualTextureAssetKey } from "../virtual-texture/runtime-contract";
import {
  canonicalMaterialHasTransmission,
  type CanonicalSurfaceMaterial,
} from "./canonical-material";
import { surfaceGeometryLayoutKey } from "./gpu-admission";
import type { CanonicalDrawSurface } from "./scene-lowering";
import { emptyWorldBounds, includeWorldBounds } from "./surface-visibility";

const ordinaryTextureIdentity = (
  asset: TextureSourceRef | undefined,
): readonly unknown[] | null => asset === undefined ? null : [
  asset.kind === "embedded-asset"
    ? [
        "embedded",
        asset.mimeType,
        asset.sourceEncoding ?? null,
        asset.colorSpace ?? "srgb",
        asset.bytes.byteLength,
        numericArrayHash(asset.bytes),
        asset.fallback === undefined ? null : ordinaryTextureIdentity(asset.fallback),
      ]
    : ["declared", textureStorageKey(asset)],
  canonicalTextureSamplerKey(canonicalTextureSampler(asset)),
];

const numericArrayHashes = new WeakMap<object, string>();

/** Fast candidate bucket only; exact byte/value equality always guards convergence. */
const numericArrayHash = (values: ArrayBufferView): string => {
  const retained = numericArrayHashes.get(values);
  if (retained !== undefined) return retained;
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index]!;
    hash = Math.imul(hash, 0x01000193);
  }
  const key = `${bytes.byteLength}:${hash >>> 0}`;
  numericArrayHashes.set(values, key);
  return key;
};

const numericArraysEqual = (
  left: ArrayLike<number> | undefined,
  right: ArrayLike<number> | undefined,
): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined || left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

const textureAssetsEqual = (
  left: TextureSourceRef | undefined,
  right: TextureSourceRef | undefined,
): boolean => {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  if (
    textureStorageKey(left) === textureStorageKey(right)
    && canonicalTextureSamplerKey(canonicalTextureSampler(left))
      === canonicalTextureSamplerKey(canonicalTextureSampler(right))
  ) return true;
  if (left.kind !== "embedded-asset" || right.kind !== "embedded-asset") return false;
  return left.mimeType === right.mimeType
    && left.sourceEncoding === right.sourceEncoding
    && (left.colorSpace ?? "srgb") === (right.colorSpace ?? "srgb")
    && canonicalTextureSamplerKey(canonicalTextureSampler(left))
      === canonicalTextureSamplerKey(canonicalTextureSampler(right))
    && numericArraysEqual(left.bytes, right.bytes)
    && textureAssetsEqual(left.fallback, right.fallback);
};

const textureCoordinatesIdentity = (
  coordinates: CanonicalSurfaceMaterial["baseColorTextureCoordinates"],
): readonly unknown[] | null => coordinates === undefined
  ? null
  : [coordinates.row0, coordinates.row1];

/** Stable candidate bucket for cold automatic convergence. */
export const canonicalMaterialInstanceIdentityKey = (
  material: CanonicalSurfaceMaterial,
): string => {
  const common: readonly unknown[] = [
    material.kind,
    material.alphaBlend === true,
    material.alphaCutoff ?? null,
    material.baseColor,
    ordinaryTextureIdentity(material.baseColorAsset),
    material.baseColorVirtualAsset === undefined
      ? null
      : virtualTextureAssetKey(material.baseColorVirtualAsset),
    textureCoordinatesIdentity(material.baseColorTextureCoordinates),
    material.doubleSided === true,
    material.requiresTextureCoordinates,
  ];
  if (material.kind === "unlit") {
    return JSON.stringify([
      common,
      material.coverage === undefined ? null : [
        material.coverage.cellSizeCssPixels,
        material.coverage.count,
        material.coverage.index,
      ],
    ]);
  }
  return JSON.stringify([
    common,
    material.attenuationColor ?? null,
    material.attenuationDistance ?? null,
    ordinaryTextureIdentity(material.emissiveAsset),
    material.emissiveFactor,
    textureCoordinatesIdentity(material.emissiveTextureCoordinates),
    material.indexOfRefraction ?? null,
    material.metallicFactor,
    ordinaryTextureIdentity(material.metallicRoughnessAsset),
    textureCoordinatesIdentity(material.metallicRoughnessTextureCoordinates),
    ordinaryTextureIdentity(material.normalAsset),
    material.normalScale,
    textureCoordinatesIdentity(material.normalTextureCoordinates),
    ordinaryTextureIdentity(material.occlusionAsset),
    material.occlusionStrength,
    textureCoordinatesIdentity(material.occlusionTextureCoordinates),
    material.roughnessFactor,
    ordinaryTextureIdentity(material.specularColorAsset),
    material.specularColorFactor ?? null,
    textureCoordinatesIdentity(material.specularColorTextureCoordinates),
    material.specularFactor ?? null,
    ordinaryTextureIdentity(material.specularTextureAsset),
    textureCoordinatesIdentity(material.specularTextureCoordinates),
    ordinaryTextureIdentity(material.thicknessAsset),
    material.thicknessFactor ?? null,
    textureCoordinatesIdentity(material.thicknessTextureCoordinates),
    ordinaryTextureIdentity(material.transmissionAsset),
    material.transmissionFactor ?? null,
    textureCoordinatesIdentity(material.transmissionTextureCoordinates),
  ]);
};

const materialTextureAssetsEqual = (
  left: CanonicalSurfaceMaterial,
  right: CanonicalSurfaceMaterial,
): boolean => {
  if (!textureAssetsEqual(left.baseColorAsset, right.baseColorAsset)) return false;
  if (left.kind === "unlit" || right.kind === "unlit") return left.kind === right.kind;
  return textureAssetsEqual(left.emissiveAsset, right.emissiveAsset)
    && textureAssetsEqual(left.metallicRoughnessAsset, right.metallicRoughnessAsset)
    && textureAssetsEqual(left.normalAsset, right.normalAsset)
    && textureAssetsEqual(left.occlusionAsset, right.occlusionAsset)
    && textureAssetsEqual(left.specularColorAsset, right.specularColorAsset)
    && textureAssetsEqual(left.specularTextureAsset, right.specularTextureAsset)
    && textureAssetsEqual(left.thicknessAsset, right.thicknessAsset)
    && textureAssetsEqual(left.transmissionAsset, right.transmissionAsset);
};

const geometryBucketKey = (surface: CanonicalDrawSurface): string => {
  const geometry = surface.geometry;
  const array = (values: ArrayBufferView | undefined): string | null => values === undefined
    ? null
    : numericArrayHash(values);
  return JSON.stringify([
    array(geometry.positions),
    array(geometry.indices),
    array(geometry.normals),
    array(geometry.tangents),
    array(geometry.textureCoordinates0),
    array(geometry.textureCoordinates1),
    array(geometry.colors),
  ]);
};

const surfaceGeometriesEqual = (
  left: CanonicalDrawSurface,
  right: CanonicalDrawSurface,
): boolean => {
  const leftGeometry = left.geometry;
  const rightGeometry = right.geometry;
  return numericArraysEqual(leftGeometry.positions, rightGeometry.positions)
    && numericArraysEqual(leftGeometry.indices, rightGeometry.indices)
    && numericArraysEqual(leftGeometry.normals, rightGeometry.normals)
    && numericArraysEqual(leftGeometry.tangents, rightGeometry.tangents)
    && numericArraysEqual(
      leftGeometry.textureCoordinates0,
      rightGeometry.textureCoordinates0,
    )
    && numericArraysEqual(
      leftGeometry.textureCoordinates1,
      rightGeometry.textureCoordinates1,
    )
    && numericArraysEqual(leftGeometry.colors, rightGeometry.colors);
};

const automaticInstanceCandidateKey = (
  surface: CanonicalDrawSurface,
): string | undefined => {
  const node = surface.node;
  if (
    node.kind !== "gltf"
    || node.ref !== undefined
    || surface.gltfOccurrence === undefined
    || surface.instances !== undefined
    || surface.lods !== undefined
    || surface.topology !== undefined
    || surface.objectLocalModel !== undefined
    || surface.material.alphaBlend === true
    || canonicalMaterialHasTransmission(surface.material)
  ) return undefined;
  return JSON.stringify([
    surfaceGeometryLayoutKey(surface),
    geometryBucketKey(surface),
    canonicalMaterialInstanceIdentityKey(surface.materialSource),
    surface.modelHandedness,
  ]);
};

type AutomaticInstanceCohort = {
  key: string;
  members: Array<Readonly<{ index: number; surface: CanonicalDrawSurface }>>;
};

const surfaceMatchesCohort = (
  surface: CanonicalDrawSurface,
  cohort: AutomaticInstanceCohort,
): boolean => {
  const representative = cohort.members[0]!.surface;
  return !cohort.members.some((member) =>
    member.surface.gltfOccurrence === surface.gltfOccurrence)
    && surfaceGeometriesEqual(surface, representative)
    && materialTextureAssetsEqual(surface.materialSource, representative.materialSource);
};

const collapsedCohort = (
  cohort: AutomaticInstanceCohort,
): CanonicalDrawSurface => {
  const representative = cohort.members[0]!.surface;
  const localModels = new Float32Array(cohort.members.length * 16);
  const worldBounds = emptyWorldBounds();
  const membership: number[] = [];
  for (let instance = 0; instance < cohort.members.length; instance += 1) {
    const member = cohort.members[instance]!;
    localModels.set(member.surface.model, instance * 16);
    includeWorldBounds(worldBounds, member.surface.worldBounds);
    membership.push(member.index);
  }
  const identity = identityMat4();
  return {
    ...representative,
    instances: {
      automaticSourceOccurrences: cohort.members.map(({ surface }) => {
        if (surface.node.kind !== "gltf" || surface.gltfOccurrence === undefined) {
          throw new Error("Royal automatic instance cohort lost its glTF occurrence");
        }
        return {
          asset: surface.node.asset,
          geometryKey: surface.geometry.key,
          gltfOccurrence: surface.gltfOccurrence,
        };
      }),
      count: cohort.members.length,
      key: JSON.stringify(["automatic-surface-instances-v1", cohort.key, membership]),
      localModels,
      // Full float contents make retained-buffer invalidation exact across scene replacements.
      revision: Array.from(localModels).join(","),
    },
    model: identity,
    normalTransform: identityMat4(),
    worldBounds,
  };
};

/**
 * Converges static, opaque glTF occurrences onto the existing canonical instance path.
 * Picking remains occurrence-based; unsafe or singleton surfaces retain their source order.
 */
export const automaticallyInstanceCanonicalSurfaces = (
  surfaces: readonly CanonicalDrawSurface[],
): readonly CanonicalDrawSurface[] => {
  const cohortsByKey = new Map<string, AutomaticInstanceCohort[]>();
  const cohortBySurfaceIndex = new Map<number, AutomaticInstanceCohort>();
  for (let index = 0; index < surfaces.length; index += 1) {
    const surface = surfaces[index]!;
    const key = automaticInstanceCandidateKey(surface);
    if (key === undefined) continue;
    let cohorts = cohortsByKey.get(key);
    if (cohorts === undefined) {
      cohorts = [];
      cohortsByKey.set(key, cohorts);
    }
    let cohort = cohorts.find((candidate) => surfaceMatchesCohort(surface, candidate));
    if (cohort === undefined) {
      cohort = { key: `${key}:exact:${cohorts.length}`, members: [] };
      cohorts.push(cohort);
    }
    cohort.members.push({ index, surface });
    cohortBySurfaceIndex.set(index, cohort);
  }
  if (![...cohortsByKey.values()].some((cohorts) =>
    cohorts.some((cohort) => cohort.members.length > 1))) {
    return surfaces;
  }
  const collapsed: CanonicalDrawSurface[] = [];
  for (let index = 0; index < surfaces.length; index += 1) {
    const cohort = cohortBySurfaceIndex.get(index);
    if (cohort === undefined || cohort.members.length === 1) {
      collapsed.push(surfaces[index]!);
      continue;
    }
    if (cohort.members[0]!.index === index) collapsed.push(collapsedCohort(cohort));
  }
  return collapsed;
};
