import RAPIER, {
  type Collider,
  type KinematicCharacterController,
  type RigidBody,
  type World,
} from '@dimforge/rapier3d-compat';
import {
  actorFromRecipe,
  subtractVec3,
  type ActorRecipe,
  type PhysicsAdapter,
  type PhysicsRuntime,
  type RuntimeActor,
  type Vec3,
} from './networked-lab';

export type RapierArenaBox = {
  readonly id: string;
  readonly position: Vec3;
  readonly scale: Vec3;
};

export type RapierPhysicsOptions = {
  readonly actors: readonly ActorRecipe[];
  readonly arenaBoxes?: readonly RapierArenaBox[];
  readonly maxTranslationPerTick?: number;
  readonly timestep?: number;
};

type ActorBody = {
  readonly body: RigidBody;
  readonly collider: Collider;
  readonly controller: KinematicCharacterController;
  readonly recipe: ActorRecipe;
};

const rapierInit = RAPIER.init();

export const defaultRapierArenaBoxes = [
  { id: 'ground', position: [1.7, -0.08, 0.55], scale: [10.2, 0.16, 7.4] },
  { id: 'north-wall', position: [1.7, 0.76, -3.2], scale: [10.2, 1.52, 0.34] },
  { id: 'south-wall', position: [1.7, 0.76, 4.28], scale: [10.2, 1.52, 0.34] },
  { id: 'west-wall', position: [-3.48, 0.76, 0.55], scale: [0.34, 1.52, 7.4] },
  { id: 'east-wall', position: [6.9, 0.76, 0.55], scale: [0.34, 1.52, 7.4] },
  { id: 'cover-a', position: [-0.65, 0.64, 0.2], scale: [0.48, 1.28, 1.42] },
  { id: 'cover-b', position: [2.35, 0.52, -0.95], scale: [1.42, 1.04, 0.48] },
] as const satisfies readonly RapierArenaBox[];

export const createRapierPhysics = async (
  options: RapierPhysicsOptions,
): Promise<PhysicsAdapter> => {
  await rapierInit;

  return {
    create: () => createRapierRuntime(options),
  };
};

const createRapierRuntime = ({
  actors,
  arenaBoxes = defaultRapierArenaBoxes,
  maxTranslationPerTick = 0.07,
  timestep = 1 / 60,
}: RapierPhysicsOptions): PhysicsRuntime => {
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = timestep;

  for (const box of arenaBoxes) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(...box.position),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.scale[0] / 2, box.scale[1] / 2, box.scale[2] / 2)
        .setFriction(0.88)
        .setRestitution(0.02),
      body,
    );
  }

  const bodies = new Map(actors.map((recipe) => {
    const initial = actorFromRecipe(recipe, 0);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc
        .kinematicPositionBased()
        .setCanSleep(false)
        .setTranslation(...initial.position),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(
        initial.scale[0] / 2,
        initial.scale[1] / 2,
        initial.scale[2] / 2,
      )
        .setFriction(0.38)
        .setRestitution(0),
      body,
    );
    const controller = createCharacterController(world);
    return [recipe.id, { body, collider, controller, recipe } satisfies ActorBody];
  }));
  let currentActors = readActors(bodies, 0);

  return {
    actors: () => currentActors,
    predict: ({ actorId, leadTicks, tick }) => {
      const actor = bodies.get(actorId);
      if (actor === undefined) return undefined;
      return actorFromRecipe(actor.recipe, tick + leadTicks);
    },
    reset: () => {
      for (const actor of bodies.values()) {
        const initial = actorFromRecipe(actor.recipe, 0);
        actor.body.setTranslation(vector(initial.position), true);
        actor.body.setNextKinematicTranslation(vector(initial.position));
      }
      currentActors = readActors(bodies, 0);
    },
    step: ({ tick }) => {
      for (const actor of bodies.values()) {
        moveBodyTowardPlannedPose(actor, tick, maxTranslationPerTick);
      }
      world.step();
      currentActors = readActors(bodies, tick);
      return currentActors;
    },
  };
};

const createCharacterController = (
  world: World,
): KinematicCharacterController => {
  const controller = world.createCharacterController(0.035);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.enableAutostep(0.28, 0.16, false);
  controller.enableSnapToGround(0.28);
  controller.setMaxSlopeClimbAngle(Math.PI / 4);
  controller.setMinSlopeSlideAngle(Math.PI / 3);
  return controller;
};

const moveBodyTowardPlannedPose = (
  actor: ActorBody,
  tick: number,
  maxTranslationPerTick: number,
): void => {
  const target = actorFromRecipe(actor.recipe, tick);
  const current = actor.body.translation();
  const desired = clampTranslation(
    subtractVec3(target.position, [current.x, current.y, current.z]),
    maxTranslationPerTick,
  );
  actor.controller.computeColliderMovement(actor.collider, vector(desired));
  const movement = actor.controller.computedMovement();
  actor.body.setNextKinematicTranslation({
    x: current.x + movement.x,
    y: current.y + movement.y,
    z: current.z + movement.z,
  });
};

const clampTranslation = (
  translation: Vec3,
  maxLength: number,
): Vec3 => {
  const length = Math.hypot(...translation);
  if (length <= maxLength || length <= 0.000_001) return translation;
  const scale = maxLength / length;
  return [
    translation[0] * scale,
    translation[1] * scale,
    translation[2] * scale,
  ];
};

const readActors = (
  bodies: ReadonlyMap<string, ActorBody>,
  tick: number,
): readonly RuntimeActor[] => [...bodies.values()].map((actor) => {
  const planned = actorFromRecipe(actor.recipe, tick);
  const previous = actorFromRecipe(actor.recipe, Math.max(0, tick - 1));
  const position = vec3(actor.body.translation());
  const previousPosition = tick <= 0 ? position : previous.position;

  return {
    ...planned,
    forward: planned.forward,
    position,
    previousPosition,
  };
});

const vector = ([x, y, z]: Vec3): { readonly x: number; readonly y: number; readonly z: number } => ({
  x,
  y,
  z,
});

const vec3 = ({ x, y, z }: { readonly x: number; readonly y: number; readonly z: number }): Vec3 => [
  x,
  y,
  z,
];
