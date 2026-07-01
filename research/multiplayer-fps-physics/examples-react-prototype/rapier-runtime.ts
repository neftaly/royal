import RAPIER, {
  type Collider,
  type ColliderDesc,
  type KinematicCharacterController,
  type RigidBody,
  type RigidBodyDesc,
  type Rotation,
  type Vector,
  type World,
} from '@dimforge/rapier3d-compat';

export type Vec3 = readonly [x: number, y: number, z: number];
export type Quat = readonly [x: number, y: number, z: number, w: number];

export type RapierBodyKind =
  | 'dynamic'
  | 'fixed'
  | 'kinematic-position'
  | 'kinematic-velocity';

export type RapierColliderSurface = {
  readonly density?: number;
  readonly friction?: number;
  readonly mass?: number;
  readonly restitution?: number;
};

export type RapierCuboidColliderRecipe = RapierColliderSurface & {
  readonly halfExtents: Vec3;
  readonly kind: 'cuboid';
  readonly offset?: Vec3;
};

export type RapierCapsuleColliderRecipe = RapierColliderSurface & {
  readonly halfHeight: number;
  readonly kind: 'capsule';
  readonly offset?: Vec3;
  readonly radius: number;
};

export type RapierColliderRecipe =
  | RapierCapsuleColliderRecipe
  | RapierCuboidColliderRecipe;

export type RapierBodyRecipe<Id extends string = string> = {
  readonly angularDamping?: number;
  readonly body: RapierBodyKind;
  readonly canSleep?: boolean;
  readonly ccd?: boolean;
  readonly colliders: readonly RapierColliderRecipe[];
  readonly id: Id;
  readonly linearDamping?: number;
  readonly position: Vec3;
  readonly rotation?: Quat;
};

export type RapierRuntimeOptions<Id extends string = string> = {
  readonly bodies: readonly RapierBodyRecipe<Id>[];
  readonly checkpointOnCreate?: boolean;
  readonly gravity?: Vec3;
  readonly solverIterations?: number;
  readonly timestep?: number;
};

export type RapierCheckpoint = {
  readonly bytes: number;
  readonly data: Uint8Array;
  readonly hash: string;
  readonly tick: number;
};

export type RapierBodyState<Id extends string = string> = {
  readonly id: Id;
  readonly position: Vec3;
  readonly rotation: Quat;
};

export type RapierBodyTransform<Id extends string = string> = RapierBodyState<Id> & {
  readonly eulerRotation: Vec3;
};

export type RapierRuntime<Id extends string = string> = {
  readonly bodiesById: Map<Id, RigidBody>;
  readonly collidersByBodyId: Map<Id, readonly Collider[]>;
  dispose(): void;
  lastCheckpoint: RapierCheckpoint | undefined;
  tick: number;
  readonly world: World;
};

export type RapierCharacterMovement = {
  readonly collisions: number;
  readonly grounded: boolean;
  readonly movement: Vec3;
};

export type RapierFpsCharacterControllerOptions = {
  readonly applyImpulsesToDynamicBodies?: boolean;
  readonly autostep?: {
    readonly includeDynamicBodies: boolean;
    readonly maxHeight: number;
    readonly minWidth: number;
  };
  readonly characterMass?: number;
  readonly maxSlopeClimbAngle?: number;
  readonly minSlopeSlideAngle?: number;
  readonly offset?: number;
  readonly snapToGround?: number;
  readonly up?: Vec3;
};

let rapierReadyPromise: Promise<void> | undefined;

export const ensureRapierReady = (): Promise<void> => {
  rapierReadyPromise ??= RAPIER.init();
  return rapierReadyPromise;
};

const vectorFromVec3 = ([x, y, z]: Vec3): Vector => ({ x, y, z });

const vec3FromVector = ({ x, y, z }: Vector): Vec3 => [x, y, z];

const quatFromRotation = ({ x, y, z, w }: Rotation): Quat => [x, y, z, w];

export const quaternionToEuler = ([x, y, z, w]: Quat): Vec3 => {
  const sinRollCosPitch = 2 * (w * x + y * z);
  const cosRollCosPitch = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinRollCosPitch, cosRollCosPitch);

  const sinPitch = 2 * (w * y - z * x);
  const pitch = Math.abs(sinPitch) >= 1
    ? Math.sign(sinPitch) * (Math.PI / 2)
    : Math.asin(sinPitch);

  const sinYawCosPitch = 2 * (w * z + x * y);
  const cosYawCosPitch = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinYawCosPitch, cosYawCosPitch);

  return [roll, pitch, yaw];
};

export const hashBytes = (bytes: Uint8Array): string => {
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
};

const createRigidBodyDesc = (recipe: RapierBodyRecipe): RigidBodyDesc => {
  const desc = (() => {
    switch (recipe.body) {
      case 'dynamic':
        return RAPIER.RigidBodyDesc.dynamic();
      case 'fixed':
        return RAPIER.RigidBodyDesc.fixed();
      case 'kinematic-position':
        return RAPIER.RigidBodyDesc.kinematicPositionBased();
      case 'kinematic-velocity':
        return RAPIER.RigidBodyDesc.kinematicVelocityBased();
    }
  })();

  desc.setTranslation(...recipe.position);
  if (recipe.rotation !== undefined) {
    const [x, y, z, w] = recipe.rotation;
    desc.setRotation({ x, y, z, w });
  }
  if (recipe.canSleep !== undefined) desc.setCanSleep(recipe.canSleep);
  if (recipe.ccd !== undefined) desc.setCcdEnabled(recipe.ccd);
  if (recipe.linearDamping !== undefined) desc.setLinearDamping(recipe.linearDamping);
  if (recipe.angularDamping !== undefined) desc.setAngularDamping(recipe.angularDamping);

  return desc;
};

const applyColliderSurface = (
  desc: ColliderDesc,
  surface: RapierColliderSurface,
): ColliderDesc => {
  if (surface.friction !== undefined) desc.setFriction(surface.friction);
  if (surface.restitution !== undefined) desc.setRestitution(surface.restitution);
  if (surface.density !== undefined) desc.setDensity(surface.density);
  if (surface.mass !== undefined) desc.setMass(surface.mass);
  return desc;
};

const createColliderDesc = (recipe: RapierColliderRecipe): ColliderDesc => {
  const desc = recipe.kind === 'cuboid'
    ? RAPIER.ColliderDesc.cuboid(...recipe.halfExtents)
    : RAPIER.ColliderDesc.capsule(recipe.halfHeight, recipe.radius);

  if (recipe.offset !== undefined) desc.setTranslation(...recipe.offset);
  return applyColliderSurface(desc, recipe);
};

export const createRapierRuntime = async <Id extends string>(
  options: RapierRuntimeOptions<Id>,
): Promise<RapierRuntime<Id>> => {
  await ensureRapierReady();

  const world = new RAPIER.World(vectorFromVec3(options.gravity ?? [0, -9.81, 0]));
  world.timestep = options.timestep ?? 1 / 60;
  if (options.solverIterations !== undefined) {
    world.numSolverIterations = options.solverIterations;
  }

  const bodiesById = new Map<Id, RigidBody>();
  const collidersByBodyId = new Map<Id, readonly Collider[]>();

  for (const bodyRecipe of options.bodies) {
    const body = world.createRigidBody(createRigidBodyDesc(bodyRecipe));
    const colliders = bodyRecipe.colliders.map((colliderRecipe) =>
      world.createCollider(createColliderDesc(colliderRecipe), body)
    );

    bodiesById.set(bodyRecipe.id, body);
    collidersByBodyId.set(bodyRecipe.id, colliders);
  }

  const runtime: RapierRuntime<Id> = {
    bodiesById,
    collidersByBodyId,
    dispose: () => world.free(),
    lastCheckpoint: undefined,
    tick: 0,
    world,
  };

  if (options.checkpointOnCreate === true) {
    takeRapierCheckpoint(runtime);
  }

  return runtime;
};

export const stepRapierRuntime = <Id extends string>(
  runtime: RapierRuntime<Id>,
): void => {
  runtime.world.step();
  runtime.tick += 1;
};

export const takeRapierCheckpoint = <Id extends string>(
  runtime: RapierRuntime<Id>,
): RapierCheckpoint => {
  const data = runtime.world.takeSnapshot();
  const checkpoint = {
    bytes: data.byteLength,
    data,
    hash: hashBytes(data),
    tick: runtime.tick,
  } satisfies RapierCheckpoint;

  runtime.lastCheckpoint = checkpoint;
  return checkpoint;
};

export const requireRapierBody = <Id extends string>(
  runtime: RapierRuntime<Id>,
  id: Id,
): RigidBody => {
  const body = runtime.bodiesById.get(id);
  if (body === undefined) throw new Error(`Missing Rapier body: ${id}`);
  return body;
};

export const requireRapierCollider = <Id extends string>(
  runtime: RapierRuntime<Id>,
  id: Id,
  index = 0,
): Collider => {
  const collider = runtime.collidersByBodyId.get(id)?.[index];
  if (collider === undefined) throw new Error(`Missing Rapier collider: ${id}[${index}]`);
  return collider;
};

export const readRapierBodyState = <Id extends string>(
  runtime: RapierRuntime<Id>,
  id: Id,
): RapierBodyState<Id> => {
  const body = requireRapierBody(runtime, id);

  return {
    id,
    position: vec3FromVector(body.translation()),
    rotation: quatFromRotation(body.rotation()),
  };
};

export const readRapierBodyTransform = <Id extends string>(
  runtime: RapierRuntime<Id>,
  id: Id,
): RapierBodyTransform<Id> => {
  const state = readRapierBodyState(runtime, id);

  return {
    ...state,
    eulerRotation: quaternionToEuler(state.rotation),
  };
};

export const readRapierBodyTransforms = <Id extends string>(
  runtime: RapierRuntime<Id>,
  ids: readonly Id[],
): readonly RapierBodyTransform<Id>[] =>
  ids.map((id) => readRapierBodyTransform(runtime, id));

export const createRapierFpsCharacterController = <Id extends string>(
  runtime: RapierRuntime<Id>,
  options: RapierFpsCharacterControllerOptions = {},
): KinematicCharacterController => {
  const controller = runtime.world.createCharacterController(options.offset ?? 0.035);
  controller.setUp(vectorFromVec3(options.up ?? [0, 1, 0]));
  controller.setApplyImpulsesToDynamicBodies(options.applyImpulsesToDynamicBodies ?? true);

  if (options.characterMass !== undefined) {
    controller.setCharacterMass(options.characterMass);
  }
  if (options.autostep !== undefined) {
    controller.enableAutostep(
      options.autostep.maxHeight,
      options.autostep.minWidth,
      options.autostep.includeDynamicBodies,
    );
  }
  if (options.snapToGround !== undefined) {
    controller.enableSnapToGround(options.snapToGround);
  }
  if (options.maxSlopeClimbAngle !== undefined) {
    controller.setMaxSlopeClimbAngle(options.maxSlopeClimbAngle);
  }
  if (options.minSlopeSlideAngle !== undefined) {
    controller.setMinSlopeSlideAngle(options.minSlopeSlideAngle);
  }

  return controller;
};

export const moveKinematicBodyWithController = (
  controller: KinematicCharacterController,
  body: RigidBody,
  collider: Collider,
  desiredTranslation: Vec3,
): RapierCharacterMovement => {
  controller.computeColliderMovement(collider, vectorFromVec3(desiredTranslation));
  const movement = controller.computedMovement();
  const position = body.translation();

  body.setNextKinematicTranslation({
    x: position.x + movement.x,
    y: position.y + movement.y,
    z: position.z + movement.z,
  });

  return {
    collisions: controller.numComputedCollisions(),
    grounded: controller.computedGrounded(),
    movement: vec3FromVector(movement),
  };
};
