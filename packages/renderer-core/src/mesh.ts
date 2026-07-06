import type { Geometry, GeometryKindValue } from './geometry';
import type { Material } from './material';
import {
  resolveTransform,
  type Transform,
  type TransformOptions
} from './primitives';
import type { PickingId } from './picking';
import type { RenderObjectRef } from './render-object';
import type { UiNodeSemantics } from './ui';

/** Geometry plus material, with an optional transform. */
export interface MeshNode {
  readonly kind: 'mesh';
  readonly geometry: Geometry<GeometryKindValue>;
  readonly material: Material;
  readonly pickingId?: PickingId;
  readonly ref?: RenderObjectRef;
  readonly semantics?: UiNodeSemantics;
  readonly transform?: Transform;
}

export interface MeshOptions {
  readonly geometry: Geometry<GeometryKindValue>;
  readonly material: Material;
  /** Stable application id returned from renderer picking. */
  readonly pickingId?: PickingId;
  /** Optional imperative handle populated by renderer roots. */
  readonly ref?: RenderObjectRef;
  /** Optional renderer-neutral UI semantics associated with this descriptor. */
  readonly semantics?: UiNodeSemantics;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
}

export const mesh = (options: MeshOptions): MeshNode => {
  const node = {
    kind: 'mesh',
    geometry: options.geometry,
    material: options.material,
    ...(options.pickingId === undefined ? {} : { pickingId: options.pickingId }),
    ...(options.ref === undefined ? {} : { ref: options.ref }),
    ...(options.semantics === undefined ? {} : { semantics: options.semantics })
  } satisfies Omit<MeshNode, 'transform'>;

  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
};
