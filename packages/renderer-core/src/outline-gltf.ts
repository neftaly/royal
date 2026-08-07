import { objectWithAllowedFields } from './descriptor-values';
import { validateEdgeMaterial, type EdgeMaterial } from './edge-material';
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
  /** Base-scene occurrence transform which lends geometry and active LOD. Defaults to `transform`. */
  readonly sourceTransform?: Transform;
  /** Independent overlay presentation transform. */
  readonly transform?: Transform;
}

export interface OutlineGltfOptions extends GltfAssetOptions {
  readonly material: EdgeMaterial;
  /** Base-scene occurrence transform which lends geometry and active LOD. Defaults to `transform`. */
  readonly sourceTransform?: TransformOptions;
  /** Overlay presentation transform. Omit for identity. */
  readonly transform?: TransformOptions;
}

const OUTLINE_GLTF_FIELDS = [
  'bounds', 'material', 'sceneIndex', 'sourceTransform', 'src', 'transform', 'version',
] as const;

/** Reuses one rendered glTF occurrence as a non-picking edge overlay. */
export const outlineGltf = (options: OutlineGltfOptions): OutlineGltfNode => {
  objectWithAllowedFields(options, OUTLINE_GLTF_FIELDS, 'outline glTF');
  validateEdgeMaterial(options.material, 'outline glTF material');
  const node = {
    asset: resolveGltfAsset(options),
    kind: 'outline-gltf',
    material: options.material,
  } satisfies Omit<OutlineGltfNode, 'sourceTransform' | 'transform'>;
  return {
    ...node,
    ...(options.sourceTransform === undefined
      ? {}
      : { sourceTransform: resolveTransform(options.sourceTransform) }),
    ...(options.transform === undefined
      ? {}
      : { transform: resolveTransform(options.transform) }),
  };
};
