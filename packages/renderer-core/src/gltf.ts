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

/** glTF asset node loaded from an explicit asset reference. */
export interface GltfNode {
  readonly kind: 'gltf';
  readonly asset: GltfAssetRef;
  readonly transform?: Transform;
}

export interface GltfOptions {
  readonly asset: GltfAssetRef;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
}

export const gltf = (options: GltfOptions): GltfNode => {
  const node = {
    kind: 'gltf',
    asset: options.asset
  } satisfies Omit<GltfNode, 'transform'>;

  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
};
