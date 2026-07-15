import {
  resolveTransform,
  type Transform,
  type TransformOptions
} from './primitives';
import { frozenBounds3, identityScalar, nonEmptyString } from './descriptor-values';
import type { WorldPosition3 } from './primitives';
import { resolvePickingId, type PickingId } from './picking';
import type { RenderObjectRef } from './render-object';
import type { Geometry } from './geometry';

export interface GltfAssetBounds {
  /** Asset-space maximum in metres, following glTF's metre unit. */
  readonly max: WorldPosition3;
  /** Asset-space minimum in metres, following glTF's metre unit. */
  readonly min: WorldPosition3;
}

export interface GltfAssetRef {
  readonly bounds?: GltfAssetBounds;
  readonly uri: string;
  /** Non-empty string or finite number identifying one revision of source bytes. */
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
  /** Exact material-variant name. Unknown names fall back to the base material. */
  readonly materialVariant?: GltfMaterialVariantName;
}

export interface GltfOptions {
  readonly bounds?: GltfAssetBounds;
  /** Exact triangle proxy in this node's local space, available before the asset loads. */
  readonly pickingGeometry?: Geometry;
  /** Stable application id returned from renderer picking. */
  readonly pickingId?: PickingId;
  /** Optional imperative handle populated by renderer roots. */
  readonly ref?: RenderObjectRef;
  readonly src: string;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
  /** Exact material-variant name. Unknown names fall back to the base material. */
  readonly materialVariant?: GltfMaterialVariantName;
  /** Preferred asset version override for cache keys. */
  readonly version?: GltfAssetRef['version'];
}

export type GltfInput = GltfOptions | GltfOptions['src'];

const gltfOptions = (input: GltfInput): GltfOptions =>
  typeof input === 'string' ? { src: input } : input;

export const resolveGltfAsset = (options: {
  readonly bounds?: GltfAssetBounds;
  readonly src: string;
  readonly version?: GltfAssetRef['version'];
}): GltfAssetRef => {
  const version = options.version === undefined
    ? undefined
    : identityScalar(options.version, 'glTF asset version');
  return Object.freeze({
    ...(options.bounds === undefined ? {} : { bounds: frozenBounds3(options.bounds, 'glTF asset bounds') }),
    uri: nonEmptyString(options.src, 'glTF source'),
    ...(version === undefined ? {} : { version })
  });
};

export const validateGltfMaterialVariantName = (
  materialVariant: GltfMaterialVariantName | undefined,
): GltfMaterialVariantName | undefined => materialVariant === undefined
  ? undefined
  : nonEmptyString(materialVariant, 'glTF materialVariant');

export function gltf(src: string): GltfNode;
export function gltf(options: GltfOptions): GltfNode;
export function gltf(input: GltfInput): GltfNode {
  const options = gltfOptions(input);
  const asset = resolveGltfAsset(options);
  const pickingId = resolvePickingId(options.pickingId, 'glTF pickingId');
  const materialVariant = validateGltfMaterialVariantName(options.materialVariant);
  const node = {
    kind: 'gltf',
    asset,
    ...(options.pickingGeometry === undefined ? {} : { pickingGeometry: options.pickingGeometry }),
    ...(pickingId === undefined ? {} : { pickingId }),
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    ...(materialVariant === undefined ? {} : { materialVariant })
  } satisfies Omit<GltfNode, 'transform'>;

  return Object.freeze(options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) });
}
