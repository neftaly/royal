import {
  resolveTransform,
  type Transform,
  type TransformOptions
} from './primitives';
import { frozenBounds3, nonEmptyString } from './descriptor-values';
import type { WorldPosition3 } from './primitives';
import type { PickingId } from './picking';
import type { RenderObjectRef } from './render-object';

export interface GltfAssetBounds {
  /** Asset-space maximum in metres, following glTF's metre unit. */
  readonly max: WorldPosition3;
  /** Asset-space minimum in metres, following glTF's metre unit. */
  readonly min: WorldPosition3;
}

export interface GltfAssetRef {
  readonly bounds?: GltfAssetBounds;
  readonly uri: string;
  readonly version?: number | string;
}

/** glTF asset node loaded from a source URL. */
export interface GltfNode {
  readonly kind: 'gltf';
  readonly asset: GltfAssetRef;
  readonly pickingId?: PickingId;
  readonly ref?: RenderObjectRef;
  readonly transform?: Transform;
  /** Selected `KHR_materials_variants` variant name or index. */
  readonly variant?: number | string;
}

export interface GltfSrcOptions {
  readonly bounds?: GltfAssetBounds;
  /** Stable application id returned from renderer picking. */
  readonly pickingId?: PickingId;
  /** Optional imperative handle populated by renderer roots. */
  readonly ref?: RenderObjectRef;
  readonly src: string;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
  /** Selected `KHR_materials_variants` variant name or index. */
  readonly variant?: number | string;
  /** Preferred asset version override for cache keys. */
  readonly version?: GltfAssetRef['version'];
}

export type GltfOptions = GltfSrcOptions;

export type GltfInput = GltfOptions | GltfSrcOptions['src'];

const gltfOptions = (input: GltfInput): GltfOptions =>
  typeof input === 'string' ? { src: input } : input;

export const resolveGltfAsset = (options: {
  readonly bounds?: GltfAssetBounds;
  readonly src: string;
  readonly version?: GltfAssetRef['version'];
}): GltfAssetRef => Object.freeze({
  ...(options.bounds === undefined ? {} : { bounds: frozenBounds3(options.bounds, 'glTF asset bounds') }),
  uri: nonEmptyString(options.src, 'glTF source'),
  ...(options.version === undefined ? {} : { version: options.version })
});

export const validateGltfVariant = (variant: number | string | undefined): number | string | undefined => {
  if (variant === undefined) return undefined;
  if (typeof variant === 'string') return nonEmptyString(variant, 'glTF material variant');
  if (!Number.isInteger(variant) || variant < 0) {
    throw new Error('glTF material variant index must be a non-negative integer');
  }
  return variant;
};

export function gltf(src: string): GltfNode;
export function gltf(options: GltfSrcOptions): GltfNode;
export function gltf(input: GltfInput): GltfNode {
  const options = gltfOptions(input);
  const asset = resolveGltfAsset(options);
  const variant = validateGltfVariant(options.variant);
  const node = {
    kind: 'gltf',
    asset,
    ...(options.pickingId === undefined ? {} : { pickingId: options.pickingId }),
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    ...(variant === undefined ? {} : { variant })
  } satisfies Omit<GltfNode, 'transform'>;

  return Object.freeze(options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) });
}
