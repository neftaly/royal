import { objectWithAllowedFields } from './descriptor-values';
import type { EdgeMaterial } from './edge-material';
import {
  resolveGltfAsset,
  type GltfAssetOptions,
  type GltfAssetRef,
} from './gltf';
import {
  resolveTransform,
  type Transform,
  type TransformOptions,
} from './primitives';

/** One non-picking glTF occurrence presented as screen-space boundary and crease edges. */
export interface OutlineGltfNode {
  readonly kind: 'outline-gltf';
  readonly asset: GltfAssetRef;
  readonly material: EdgeMaterial;
  readonly transform?: Transform;
}

export interface OutlineGltfOptions extends GltfAssetOptions {
  readonly material: EdgeMaterial;
  /** Omit for an identity outer transform. */
  readonly transform?: TransformOptions;
}

const OUTLINE_GLTF_FIELDS = [
  'bounds', 'material', 'sceneIndex', 'src', 'transform', 'version',
] as const;

/** Reuses one rendered glTF occurrence as a non-picking edge overlay. */
export const outlineGltf = (options: OutlineGltfOptions): OutlineGltfNode => {
  objectWithAllowedFields(options, OUTLINE_GLTF_FIELDS, 'outline glTF');
  if (
    typeof options.material !== 'object'
    || options.material === null
    || options.material.kind !== 'edge'
  ) {
    throw new TypeError('outline glTF material must be an edge material');
  }
  const node = {
    asset: resolveGltfAsset(options),
    kind: 'outline-gltf',
    material: options.material,
  } satisfies Omit<OutlineGltfNode, 'transform'>;
  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
};
