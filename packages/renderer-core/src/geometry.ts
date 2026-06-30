import type { GeometryKind } from './kind';
import type { Vec3 } from './primitives';

/** Discriminant type for built-in and custom geometry kinds. */
export type GeometryKindValue = string;

export interface Geometry<Kind extends GeometryKindValue = GeometryKind> {
  readonly kind: Kind;
}

/** Box geometry sized in world units. */
export interface BoxGeometry extends Geometry<'box'> {
  readonly size: Vec3;
}

export interface BoxGeometryOptions {
  /** Box dimensions in world units. */
  readonly size: Vec3;
}

/** XY plane geometry sized in world units with UVs mapped from bottom-left to top-right. */
export interface PlaneGeometry extends Geometry<'plane'> {
  readonly size: readonly [width: number, height: number];
}

export interface PlaneGeometryOptions {
  /** Plane dimensions in world units. */
  readonly size: readonly [width: number, height: number];
}

export const boxGeometry = (options: BoxGeometryOptions): BoxGeometry => ({
  kind: 'box',
  size: options.size
});

export const planeGeometry = (options: PlaneGeometryOptions): PlaneGeometry => ({
  kind: 'plane',
  size: options.size
});
