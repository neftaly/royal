import {
  resolveTransform,
  type Transform,
  type TransformOptions
} from './primitives';
import type { Vec3 } from './primitives';

export interface GltfAssetBounds {
  readonly max: Vec3;
  readonly min: Vec3;
}

export interface GltfAssetRef {
  readonly bounds?: GltfAssetBounds;
  readonly id: string;
  readonly revision?: number | string;
  readonly uri: string;
}

/** glTF asset node loaded from a src URL or explicit asset reference. */
export interface GltfNode {
  readonly kind: 'gltf';
  readonly asset: GltfAssetRef;
  readonly transform?: Transform;
}

export interface GltfExplicitAssetOptions {
  readonly asset: GltfAssetRef;
  readonly bounds?: never;
  readonly id?: never;
  readonly revision?: never;
  readonly src?: never;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
}

export interface GltfSrcOptions {
  readonly asset?: never;
  readonly bounds?: GltfAssetBounds;
  /** Optional override for advanced callers; defaults to src. */
  readonly id?: string;
  readonly revision?: GltfAssetRef['revision'];
  readonly src: string;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
}

export type GltfOptions = GltfExplicitAssetOptions | GltfSrcOptions;

const resolveAsset = (options: GltfOptions): GltfAssetRef => {
  if (options.asset !== undefined) return options.asset;

  return {
    ...(options.bounds === undefined ? {} : { bounds: options.bounds }),
    id: options.id ?? options.src,
    ...(options.revision === undefined ? {} : { revision: options.revision }),
    uri: options.src
  };
};

export function gltf(options: GltfSrcOptions): GltfNode;
export function gltf(options: GltfExplicitAssetOptions): GltfNode;
export function gltf(options: GltfOptions): GltfNode {
  const node = {
    kind: 'gltf',
    asset: resolveAsset(options)
  } satisfies Omit<GltfNode, 'transform'>;

  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
}
