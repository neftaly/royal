import {
  resolveTransform,
  type Transform,
  type TransformOptions
} from './primitives';
import type { Vec3 } from './primitives';
import type { PickingId } from './picking';
import type { RenderObjectRef } from './render-object';

export interface GltfAssetBounds {
  readonly max: Vec3;
  readonly min: Vec3;
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
  readonly src: string;
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

const resolveAsset = (options: GltfOptions): GltfAssetRef => ({
  ...(options.bounds === undefined ? {} : { bounds: options.bounds }),
  uri: options.src,
  ...(options.version === undefined ? {} : { version: options.version })
});

export function gltf(src: string): GltfNode;
export function gltf(options: GltfSrcOptions): GltfNode;
export function gltf(input: GltfInput): GltfNode {
  const options = gltfOptions(input);
  const asset = resolveAsset(options);
  const node = {
    kind: 'gltf',
    asset,
    ...(options.pickingId === undefined ? {} : { pickingId: options.pickingId }),
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    src: asset.uri,
    ...(options.variant === undefined ? {} : { variant: options.variant })
  } satisfies Omit<GltfNode, 'transform'>;

  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
}
