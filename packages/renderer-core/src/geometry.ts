import { GeometryKind } from './kind';
import type { Vec3 } from './primitives';

/** Discriminant type for built-in and custom geometry kinds. */
export type GeometryKindValue = string | number;

export interface Geometry<Kind extends GeometryKindValue = GeometryKind> {
  readonly kind: Kind;
}

/** Box geometry sized in world units. */
export interface BoxGeometry extends Geometry<GeometryKind.Box> {
  readonly size: Vec3;
}

export interface BoxGeometryOptions {
  /** Box dimensions in world units. */
  readonly size: Vec3;
}

export const boxGeometry = (options: BoxGeometryOptions): BoxGeometry => ({
  kind: GeometryKind.Box,
  size: options.size
});
