import {
  resolveTransform,
  type LinearRgba,
  type Transform,
  type TransformOptions,
  type WorldPosition3,
} from './primitives';
import {
  resolveBounds3,
  resolveRgba,
  identityScalar,
  nonEmptyString,
  objectWithAllowedFields,
} from './descriptor-values';
import { resolvePickingId, type PickingId } from './picking';
import type { RenderObjectRef } from './render-object';
import { validateGeometry, type Geometry } from './geometry';

export interface GltfAssetBounds {
  /** Asset-space maximum in metres, following glTF's metre unit. */
  readonly max: WorldPosition3;
  /** Asset-space minimum in metres, following glTF's metre unit. */
  readonly min: WorldPosition3;
}

export interface GltfAssetRef {
  /** Optional declared asset-space bounds available before source preparation completes. */
  readonly bounds?: GltfAssetBounds;
  /** Zero-based glTF document scene to prepare; omit for the document default. */
  readonly sceneIndex?: number;
  /** URI of the glTF asset, using the same field name as `gltf(...)`. */
  readonly src: string;
  /** Revision of bytes at `src`; change it when the same URI serves different bytes. */
  readonly version?: number | string;
}

/** Exact `KHR_materials_variants` name selected from an asset. */
export type GltfMaterialVariantName = string;

/** glTF asset node loaded from a source URL. */
export interface GltfNode {
  readonly kind: 'gltf';
  readonly asset: GltfAssetRef;
  /** Exact triangle proxy in this node's local space, available before the asset loads. */
  readonly pickingGeometry?: Geometry;
  readonly pickingId?: PickingId;
  readonly ref?: RenderObjectRef;
  readonly transform?: Transform;
  /** Scene-linear RGBA multiplier applied to every selected base color. */
  readonly tint?: LinearRgba;
  /** Exact material-variant name. Unknown names fall back to the base material. */
  readonly materialVariant?: GltfMaterialVariantName;
}

export interface GltfOptions {
  /** Optional declared asset-space bounds available before source preparation completes. */
  readonly bounds?: GltfAssetBounds;
  /** Exact triangle proxy in this node's local space, available before the asset loads. */
  readonly pickingGeometry?: Geometry;
  /** Stable application id returned from renderer picking. */
  readonly pickingId?: PickingId;
  /** Optional imperative handle populated by renderer roots. */
  readonly ref?: RenderObjectRef;
  /** Zero-based glTF document scene to prepare; omit for the document default. */
  readonly sceneIndex?: number;
  readonly src: string;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
  /** Scene-linear RGBA multiplier applied to every selected base color. */
  readonly tint?: LinearRgba;
  /** Exact material-variant name. Unknown names fall back to the base material. */
  readonly materialVariant?: GltfMaterialVariantName;
  /** Revision of bytes at `src`; change it when the same URI serves different bytes. */
  readonly version?: GltfAssetRef['version'];
}

export type GltfInput = GltfOptions | GltfOptions['src'];

/** Returns the world-aligned bounds produced by one Royal node transform. */
export const transformGltfAssetBounds = (
  bounds: GltfAssetBounds,
  transform?: TransformOptions,
): GltfAssetBounds => {
  const validatedBounds = resolveBounds3(bounds, 'glTF asset bounds');
  const { position, rotation, scale } = resolveTransform(transform ?? {});
  const [rotationX, rotationY, rotationZ] = rotation;
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosZ = Math.cos(rotationZ);
  const sinZ = Math.sin(rotationZ);
  const matrix00 = cosZ * cosY * scale[0];
  const matrix01 = (cosZ * sinY * sinX - sinZ * cosX) * scale[1];
  const matrix02 = (cosZ * sinY * cosX + sinZ * sinX) * scale[2];
  const matrix10 = sinZ * cosY * scale[0];
  const matrix11 = (sinZ * sinY * sinX + cosZ * cosX) * scale[1];
  const matrix12 = (sinZ * sinY * cosX - cosZ * sinX) * scale[2];
  const matrix20 = -sinY * scale[0];
  const matrix21 = cosY * sinX * scale[1];
  const matrix22 = cosY * cosX * scale[2];
  const centerX = (validatedBounds.min[0] + validatedBounds.max[0]) * 0.5;
  const centerY = (validatedBounds.min[1] + validatedBounds.max[1]) * 0.5;
  const centerZ = (validatedBounds.min[2] + validatedBounds.max[2]) * 0.5;
  const extentX = (validatedBounds.max[0] - validatedBounds.min[0]) * 0.5;
  const extentY = (validatedBounds.max[1] - validatedBounds.min[1]) * 0.5;
  const extentZ = (validatedBounds.max[2] - validatedBounds.min[2]) * 0.5;
  const transformedCenterX = matrix00 * centerX + matrix01 * centerY + matrix02 * centerZ + position[0];
  const transformedCenterY = matrix10 * centerX + matrix11 * centerY + matrix12 * centerZ + position[1];
  const transformedCenterZ = matrix20 * centerX + matrix21 * centerY + matrix22 * centerZ + position[2];
  const transformedExtentX = Math.abs(matrix00) * extentX + Math.abs(matrix01) * extentY + Math.abs(matrix02) * extentZ;
  const transformedExtentY = Math.abs(matrix10) * extentX + Math.abs(matrix11) * extentY + Math.abs(matrix12) * extentZ;
  const transformedExtentZ = Math.abs(matrix20) * extentX + Math.abs(matrix21) * extentY + Math.abs(matrix22) * extentZ;
  return resolveBounds3({
    max: [
      transformedCenterX + transformedExtentX,
      transformedCenterY + transformedExtentY,
      transformedCenterZ + transformedExtentZ,
    ],
    min: [
      transformedCenterX - transformedExtentX,
      transformedCenterY - transformedExtentY,
      transformedCenterZ - transformedExtentZ,
    ],
  }, 'transformed glTF asset bounds');
};

const GLTF_FIELDS = [
  'bounds', 'materialVariant', 'pickingGeometry', 'pickingId', 'ref', 'sceneIndex', 'src', 'tint', 'transform', 'version',
] as const;

const gltfOptions = (input: GltfInput): GltfOptions =>
  typeof input === 'string' ? { src: input } : input;

export const resolveGltfAsset = (options: {
  readonly bounds?: GltfAssetBounds;
  readonly sceneIndex?: number;
  readonly src: string;
  readonly version?: GltfAssetRef['version'];
}): GltfAssetRef => {
  if (options.sceneIndex !== undefined) {
    if (typeof options.sceneIndex !== 'number' || !Number.isFinite(options.sceneIndex)) {
      throw new TypeError('glTF sceneIndex must be a finite number');
    }
    if (!Number.isSafeInteger(options.sceneIndex) || options.sceneIndex < 0) {
      throw new RangeError('glTF sceneIndex must be a non-negative safe integer');
    }
  }
  const version = options.version === undefined
    ? undefined
    : identityScalar(options.version, 'glTF asset version');
  return {
    ...(options.bounds === undefined ? {} : { bounds: resolveBounds3(options.bounds, 'glTF asset bounds') }),
    ...(options.sceneIndex === undefined ? {} : { sceneIndex: options.sceneIndex }),
    src: nonEmptyString(options.src, 'glTF source'),
    ...(version === undefined ? {} : { version })
  };
};

export const validateGltfMaterialVariantName = (
  materialVariant: GltfMaterialVariantName | undefined,
): GltfMaterialVariantName | undefined => materialVariant === undefined
  ? undefined
  : nonEmptyString(materialVariant, 'glTF materialVariant');

/** Creates one glTF scene node from a source URI or exact asset options. */
export function gltf(src: string): GltfNode;
export function gltf(options: GltfOptions): GltfNode;
export function gltf(input: GltfInput): GltfNode {
  const options = gltfOptions(input);
  objectWithAllowedFields(options, GLTF_FIELDS, 'glTF');
  if (options.pickingGeometry !== undefined) {
    validateGeometry(options.pickingGeometry, 'glTF pickingGeometry');
  }
  const asset = resolveGltfAsset(options);
  const pickingId = resolvePickingId(options.pickingId, 'glTF pickingId');
  const materialVariant = validateGltfMaterialVariantName(options.materialVariant);
  const tint = options.tint === undefined ? undefined : resolveRgba(options.tint, 'glTF tint');
  const node = {
    kind: 'gltf',
    asset,
    ...(options.pickingGeometry === undefined ? {} : { pickingGeometry: options.pickingGeometry }),
    ...(pickingId === undefined ? {} : { pickingId }),
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    ...(materialVariant === undefined ? {} : { materialVariant }),
    ...(tint === undefined ? {} : { tint }),
  } satisfies Omit<GltfNode, 'transform'>;

  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
}
