import {
  type RapierBodyRecipe,
  type RapierColliderRecipe,
  type RapierColliderSurface,
  type Vec3,
} from './rapier-runtime';

export type CuboidBodyOptions<Id extends string> = RapierColliderSurface & {
  readonly angularDamping?: number;
  readonly canSleep?: boolean;
  readonly ccd?: boolean;
  readonly id: Id;
  readonly linearDamping?: number;
  readonly position: Vec3;
  readonly size: Vec3;
};

export type CapsuleBodyOptions<Id extends string> = RapierColliderSurface & {
  readonly canSleep?: boolean;
  readonly halfHeight: number;
  readonly id: Id;
  readonly position: Vec3;
  readonly radius: number;
};

const halfExtents = ([x, y, z]: Vec3): Vec3 => [x / 2, y / 2, z / 2];

const surfaceOptions = (
  options: RapierColliderSurface,
): RapierColliderSurface => ({
  ...(options.density === undefined ? {} : { density: options.density }),
  ...(options.friction === undefined ? {} : { friction: options.friction }),
  ...(options.mass === undefined ? {} : { mass: options.mass }),
  ...(options.restitution === undefined ? {} : { restitution: options.restitution }),
});

export const cuboidCollider = (
  size: Vec3,
  surface: RapierColliderSurface = {},
): RapierColliderRecipe => ({
  halfExtents: halfExtents(size),
  kind: 'cuboid',
  ...surfaceOptions(surface),
});

export const fixedCuboidBody = <Id extends string>(
  options: CuboidBodyOptions<Id>,
): RapierBodyRecipe<Id> => ({
  body: 'fixed',
  colliders: [cuboidCollider(options.size, options)],
  id: options.id,
  position: options.position,
});

export const dynamicCuboidBody = <Id extends string>(
  options: CuboidBodyOptions<Id>,
): RapierBodyRecipe<Id> => ({
  ...(options.angularDamping === undefined ? {} : { angularDamping: options.angularDamping }),
  body: 'dynamic',
  ...(options.canSleep === undefined ? {} : { canSleep: options.canSleep }),
  ...(options.ccd === undefined ? {} : { ccd: options.ccd }),
  colliders: [cuboidCollider(options.size, options)],
  id: options.id,
  ...(options.linearDamping === undefined ? {} : { linearDamping: options.linearDamping }),
  position: options.position,
});

export const kinematicCuboidBody = <Id extends string>(
  options: CuboidBodyOptions<Id>,
): RapierBodyRecipe<Id> => ({
  body: 'kinematic-position',
  ...(options.canSleep === undefined ? {} : { canSleep: options.canSleep }),
  colliders: [cuboidCollider(options.size, options)],
  id: options.id,
  position: options.position,
});

export const kinematicCapsuleBody = <Id extends string>(
  options: CapsuleBodyOptions<Id>,
): RapierBodyRecipe<Id> => ({
  body: 'kinematic-position',
  ...(options.canSleep === undefined ? {} : { canSleep: options.canSleep }),
  colliders: [
    {
      halfHeight: options.halfHeight,
      kind: 'capsule',
      radius: options.radius,
      ...surfaceOptions(options),
    },
  ],
  id: options.id,
  position: options.position,
});
