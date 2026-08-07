import { validateGeometry, type Geometry } from './geometry';
import { validateMaterial, type Material } from './material';
import {
  resolveTransform,
  type Transform,
  type TransformOptions
} from './primitives';
import { resolvePickingId, type PickingId } from './picking';
import type { RenderObjectRef } from './render-object';
import { objectWithAllowedFields } from './descriptor-values';

/** Geometry plus material, with an optional transform. */
export interface MeshNode {
  readonly kind: 'mesh';
  readonly geometry: Geometry;
  readonly material: Material;
  /** Exact triangle proxy in this mesh's local space. It does not affect rendering. */
  readonly pickingGeometry?: Geometry;
  readonly pickingId?: PickingId;
  readonly ref?: RenderObjectRef;
  readonly transform?: Transform;
}

export interface MeshOptions {
  readonly geometry: Geometry;
  readonly material: Material;
  /** Exact triangle proxy in this mesh's local space. It does not affect rendering. */
  readonly pickingGeometry?: Geometry;
  /** Stable application id returned from renderer picking. */
  readonly pickingId?: PickingId;
  /** Optional imperative handle populated by renderer roots. */
  readonly ref?: RenderObjectRef;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
}

const MESH_FIELDS = [
  'geometry', 'material', 'pickingGeometry', 'pickingId', 'ref', 'transform',
] as const;

/** Creates one directly authored mesh node with optional exact picking geometry. */
export const mesh = (options: MeshOptions): MeshNode => {
  objectWithAllowedFields(options, MESH_FIELDS, 'mesh');
  validateGeometry(options.geometry, 'mesh geometry');
  validateMaterial(options.material, 'mesh material');
  if (options.pickingGeometry !== undefined) {
    validateGeometry(options.pickingGeometry, 'mesh pickingGeometry');
  }
  const pickingId = resolvePickingId(options.pickingId, 'mesh pickingId');
  const node = {
    kind: 'mesh',
    geometry: options.geometry,
    material: options.material,
    ...(options.pickingGeometry === undefined ? {} : { pickingGeometry: options.pickingGeometry }),
    ...(pickingId === undefined ? {} : { pickingId }),
    ...(options.ref === undefined ? {} : { ref: options.ref }),
  } satisfies Omit<MeshNode, 'transform'>;

  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
};
