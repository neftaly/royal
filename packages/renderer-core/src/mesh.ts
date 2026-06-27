import type { Geometry, GeometryKindValue } from './geometry';
import { RenderNodeKind } from './kind';
import type { Material } from './material';
import {
  resolveTransform,
  type Transform,
  type TransformOptions
} from './primitives';

/** Geometry plus material, with an optional transform. */
export interface MeshNode {
  readonly kind: RenderNodeKind.Mesh;
  readonly geometry: Geometry<GeometryKindValue>;
  readonly material: Material;
  readonly transform?: Transform;
}

export interface MeshOptions {
  readonly geometry: Geometry<GeometryKindValue>;
  readonly material: Material;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
}

export const mesh = (options: MeshOptions): MeshNode => {
  const node = {
    kind: RenderNodeKind.Mesh,
    geometry: options.geometry,
    material: options.material
  } satisfies Omit<MeshNode, 'transform'>;

  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
};
