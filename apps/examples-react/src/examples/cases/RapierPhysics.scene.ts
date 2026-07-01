import {
  type Collider,
  type KinematicCharacterController,
  type RigidBody,
} from '@dimforge/rapier3d-compat';
import {
  fixedCuboidBody,
  kinematicCapsuleBody,
  kinematicCuboidBody,
} from './rapier-recipes';
import {
  castHitscanRay,
  createInterestTracker,
  frameBody,
  interpolateSnapshotBodies,
  recordSnapshotFrame,
  selectRewindFrame,
  summarizeInterest,
  type HitscanRayResult,
  type InterestCadence,
  type InterestBand,
  type InterestClientProxyMode,
  type InterestLane,
  type InterestState,
  type InterestSummary,
  type InterestTracker,
  type RemoteInterpolationState,
  type SnapshotBody,
  type SnapshotFrame,
} from './rapier-fps-netcode';
import {
  enqueueNetworkPacket,
  takeReadyNetworkPackets,
  type NetworkPacket,
} from './rapier-network';
import {
  createRapierFpsCharacterController,
  createRapierRuntime,
  moveKinematicBodyWithController,
  readRapierBodyTransform,
  readRapierBodyTransforms,
  requireRapierBody,
  requireRapierCollider,
  stepRapierRuntime,
  type RapierBodyRecipe,
  type RapierRuntime,
  type Vec3,
} from './rapier-runtime';
import {
  addVec3,
  distanceVec3,
  normalizeVec3,
  scaleVec3,
  subtractVec3,
  vec3AtDistance,
  vector,
  zeroVec3,
} from './rapier-vector';

export type DynamicEntityId = 'player' | 'crate-a' | 'crate-b' | 'crate-c' | 'crate-d';
export type StaticEntityId =
  | 'cover-left'
  | 'ground'
  | 'low-step'
  | 'wall-east'
  | 'wall-north'
  | 'wall-south'
  | 'wall-west';
export type PhysicsEntityId = DynamicEntityId | StaticEntityId;
type RemoteActorId = Exclude<DynamicEntityId, 'player'>;
type RemoteActorInterestPolicy = 'flying-player' | 'walking-player';

export type BodyRenderState = SnapshotBody<DynamicEntityId> & {
  readonly id: DynamicEntityId;
};

export type RemoteActorRenderState = BodyRenderState & {
  readonly actorKind: 'remote-player';
  readonly cadence: InterestCadence;
  readonly clientProxy: InterestClientProxyMode;
  readonly interest: InterestBand;
  readonly interestDistance: number;
  readonly interestPolicy: RemoteActorInterestPolicy;
  readonly lanes: readonly InterestLane[];
  readonly priority: number;
  readonly reason: string;
  readonly replicated: boolean;
};

export type RapierNetworkStats = {
  readonly clientTick: number;
  readonly downlinkLatencyTicks: number;
  readonly droppedInputs: number;
  readonly droppedShots: number;
  readonly droppedSnapshots: number;
  readonly fireLossEvery: number;
  readonly inputLossEvery: number;
  readonly interpolation: 'remote-snapshot-buffer';
  readonly interpolationBufferFrames: number;
  readonly interpolationDelayTicks: number;
  readonly interpolationTargetServerTick: number;
  readonly interpolationUnderflows: number;
  readonly interestColdActors: number;
  readonly interestCombatActors: number;
  readonly interestDormantActors: number;
  readonly interestGhostProxies: number;
  readonly interestHotActors: number;
  readonly interestMode: 'profile-stages';
  readonly interestPolicyProfiles: string;
  readonly interestBlockingProxies: number;
  readonly interestReplicatedActors: number;
  readonly interestTotalActors: number;
  readonly interestTransformActors: number;
  readonly interestWarmActors: number;
  readonly jitterTicks: number;
  readonly lastPredictionError: number;
  readonly lastProcessedInputTick: number;
  readonly lastReconciledServerTick: number;
  readonly lastReceivedServerTick: number;
  readonly mode: 'server-authoritative';
  readonly pendingInputs: number;
  readonly pendingPredictedInputs: number;
  readonly pendingShots: number;
  readonly pendingSnapshots: number;
  readonly predictedTick: number;
  readonly prediction: 'client-player-replay';
  readonly reconciliationEpsilon: number;
  readonly reconciliations: number;
  readonly serverLeadTicks: number;
  readonly serverTick: number;
  readonly snapCorrectionDistance: number;
  readonly smoothing: 'visual-correction-offset';
  readonly smoothingOffset: number;
  readonly smoothingTicksRemaining: number;
  readonly snapshotIntervalTicks: number;
  readonly snapshotLossEvery: number;
  readonly uplinkLatencyTicks: number;
};

export type RapierHitscanState = {
  readonly adjudications: number;
  readonly clientFireTick: number;
  readonly direction: Vec3;
  readonly endpoint: Vec3;
  readonly hit: boolean;
  readonly hitDistance: number;
  readonly hitId: PhysicsEntityId | 'none';
  readonly hitKind: 'dynamic' | 'miss' | 'static';
  readonly hitPosition: Vec3;
  readonly historyFrames: number;
  readonly maxDistance: number;
  readonly mode: 'server-rewind-raycast';
  readonly origin: Vec3;
  readonly originError: number;
  readonly receivedServerTick: number;
  readonly rewindAgeTicks: number;
  readonly rewindServerTick: number;
  readonly sequence: number;
};

export type RapierSceneState = {
  readonly bodies: readonly RemoteActorRenderState[];
  readonly hitscan: RapierHitscanState;
  readonly network: RapierNetworkStats;
  readonly predictedPlayer: BodyRenderState;
  readonly serverPlayer: BodyRenderState;
};

type PredictionEntityId = StaticEntityId | DynamicEntityId;
type RemoteActorInterestTracker = InterestTracker<DynamicEntityId, RemoteActorInterestPolicy>;

export type RapierPhysicsSimulation = {
  clientTick: number;
  readonly controller: KinematicCharacterController;
  currentServerInput: Vec3;
  dispose(): void;
  droppedInputs: number;
  droppedShots: number;
  droppedSnapshots: number;
  fireQueue: NetworkPacket<ClientFireSample>[];
  fireSequence: number;
  hitscanAdjudications: number;
  inputHistory: ClientInputSample[];
  inputQueue: NetworkPacket<ClientInputSample>[];
  inputSequence: number;
  readonly interestTracker: RemoteActorInterestTracker;
  lastPredictionError: number;
  lastProcessedInputTick: number;
  lastReceivedServerTick: number;
  lastReconciledServerTick: number;
  latestClientFrame: AuthoritativeFrame;
  readonly playerBody: RigidBody;
  readonly playerCollider: Collider;
  readonly predictedController: KinematicCharacterController;
  readonly predictedPlayerBody: RigidBody;
  readonly predictedPlayerCollider: Collider;
  readonly predictedRuntime: RapierRuntime<PredictionEntityId>;
  receivedFrames: AuthoritativeFrame[];
  remoteInterpolationUnderflows: number;
  reconciliations: number;
  readonly runtime: RapierRuntime<PhysicsEntityId>;
  serverFrameHistory: AuthoritativeFrame[];
  visualCorrectionOffset: Vec3;
  visualCorrectionTicksRemaining: number;
  snapshotQueue: NetworkPacket<AuthoritativeFrame>[];
  snapshotSequence: number;
  lastHitscan: RapierHitscanState;
};

type StaticBoxRecipe = {
  readonly id: StaticEntityId;
  readonly position: Vec3;
  readonly scale: Vec3;
};

type DynamicBoxRecipe = {
  readonly id: RemoteActorId;
  readonly interestPolicy: RemoteActorInterestPolicy;
  readonly position: Vec3;
  readonly scale: Vec3;
};

type AuthoritativeFrame = SnapshotFrame<BodyRenderState>;

type ClientInputSample = {
  readonly clientTick: number;
  readonly movement: Vec3;
  readonly sequence: number;
};

type ClientFireSample = {
  readonly clientTick: number;
  readonly direction: Vec3;
  readonly origin: Vec3;
  readonly sequence: number;
};

const fixedStepSeconds = 1 / 60;
const networkConfig = {
  downlinkLatencyTicks: 9,
  fireLossEvery: 97,
  inputLossEvery: 53,
  jitterTicks: 2,
  snapshotIntervalTicks: 3,
  snapshotLossEvery: 41,
  uplinkLatencyTicks: 6,
} as const;
const inputLaneConfig = {
  jitterTicks: networkConfig.jitterTicks,
  latencyTicks: networkConfig.uplinkLatencyTicks,
  lossEvery: networkConfig.inputLossEvery,
} as const;
const fireLaneConfig = {
  jitterTicks: networkConfig.jitterTicks,
  latencyTicks: networkConfig.uplinkLatencyTicks,
  lossEvery: networkConfig.fireLossEvery,
} as const;
const snapshotLaneConfig = {
  jitterTicks: networkConfig.jitterTicks,
  latencyTicks: networkConfig.downlinkLatencyTicks,
  lossEvery: networkConfig.snapshotLossEvery,
} as const;
const fireIntervalTicks = 54;
const firstFireClientTick = 14;
const hitscanEyeOffset = [0, 0.34, 0] satisfies Vec3;
const hitscanHistoryLimit = 180;
const hitscanMaxDistance = 8;
const interestPolicies = {
  'flying-player': {
    fallback: {
      band: 'dormant',
      cadence: 'idle',
      clientProxy: 'none',
      lanes: [],
      maxDistance: Infinity,
      priority: 0.05,
      replicated: false,
    },
    id: 'flying-player',
    stages: [
      {
        band: 'hot',
        cadence: 'every-frame',
        clientProxy: 'ghost',
        hysteresis: { exitDistance: 2.45, graceTicks: 12 },
        lanes: ['transform', 'animation'],
        maxDistance: 2.1,
        priority: 0.86,
        replicated: true,
      },
      {
        band: 'warm',
        cadence: 'fast',
        clientProxy: 'ghost',
        hysteresis: { exitDistance: 4.1, graceTicks: 18 },
        lanes: ['transform'],
        maxDistance: 3.7,
        priority: 0.58,
        replicated: true,
      },
      {
        band: 'cold',
        cadence: 'slow',
        clientProxy: 'none',
        hysteresis: { exitDistance: 6.2, graceTicks: 30 },
        lanes: ['transform'],
        maxDistance: 5.6,
        priority: 0.24,
        replicated: true,
      },
    ],
  },
  'walking-player': {
    fallback: {
      band: 'dormant',
      cadence: 'idle',
      clientProxy: 'none',
      lanes: [],
      maxDistance: Infinity,
      priority: 0.08,
      replicated: false,
    },
    id: 'walking-player',
    stages: [
      {
        band: 'hot',
        cadence: 'every-frame',
        clientProxy: 'blocking',
        hysteresis: { exitDistance: 1.7, graceTicks: 8 },
        lanes: ['transform', 'animation', 'combat'],
        maxDistance: 1.45,
        priority: 1,
        replicated: true,
      },
      {
        band: 'warm',
        cadence: 'fast',
        clientProxy: 'blocking',
        hysteresis: { exitDistance: 2.75, graceTicks: 16 },
        lanes: ['transform', 'animation'],
        maxDistance: 2.4,
        priority: 0.72,
        replicated: true,
      },
      {
        band: 'cold',
        cadence: 'slow',
        clientProxy: 'ghost',
        hysteresis: { exitDistance: 3.85, graceTicks: 24 },
        lanes: ['transform'],
        maxDistance: 3.4,
        priority: 0.35,
        replicated: true,
      },
    ],
  },
} as const;
const inputHistoryLimit = 240;
const interpolationDelayTicks = 6;
const interpolationFrameLimit = 32;
const reconciliationEpsilon = 0.025;
const snapCorrectionDistance = 0.75;
const smoothingDurationTicks = 8;
const playerScale = [0.52, 1.24, 0.52] satisfies Vec3;
const playerStart = [-2.15, 0.7, -1.65] satisfies Vec3;
const zeroRotation = [0, 0, 0] satisfies Vec3;

export const staticPhysicsBoxes = [
  { id: 'ground', position: [0, -0.08, 0], scale: [7, 0.16, 7] },
  { id: 'wall-north', position: [0, 0.3, -3.55], scale: [7, 0.6, 0.18] },
  { id: 'wall-south', position: [0, 0.3, 3.55], scale: [7, 0.6, 0.18] },
  { id: 'wall-east', position: [3.55, 0.3, 0], scale: [0.18, 0.6, 7] },
  { id: 'wall-west', position: [-3.55, 0.3, 0], scale: [0.18, 0.6, 7] },
  { id: 'low-step', position: [0.95, 0.11, 0.95], scale: [1.3, 0.22, 0.58] },
  { id: 'cover-left', position: [-1.18, 0.42, 0.82], scale: [0.48, 0.84, 1.35] },
] as const satisfies readonly StaticBoxRecipe[];

const remotePlayerRecipes = [
  { id: 'crate-a', interestPolicy: 'walking-player', position: [-0.78, 0.7, -1.18], scale: playerScale },
  { id: 'crate-b', interestPolicy: 'walking-player', position: [0.08, 0.7, -0.86], scale: playerScale },
  { id: 'crate-c', interestPolicy: 'walking-player', position: [1.35, 0.7, -0.34], scale: playerScale },
  { id: 'crate-d', interestPolicy: 'flying-player', position: [2.65, 1.7, 2.35], scale: playerScale },
] as const satisfies readonly DynamicBoxRecipe[];

const dynamicRenderBodies = [
  { id: 'player', position: playerStart, scale: playerScale },
  ...remotePlayerRecipes,
] as const satisfies readonly {
  readonly id: DynamicEntityId;
  readonly position: Vec3;
  readonly scale: Vec3;
}[];

const staticBodyRecipes = staticPhysicsBoxes.map((box) =>
  fixedCuboidBody({
    friction: box.id === 'ground' ? 0.92 : 0.74,
    id: box.id,
    position: box.position,
    restitution: box.id === 'ground' ? 0.02 : 0.03,
    size: box.scale,
  })
) satisfies readonly RapierBodyRecipe<StaticEntityId>[];

const playerBodyRecipe = kinematicCapsuleBody({
  canSleep: false,
  friction: 0.08,
  halfHeight: 0.38,
  id: 'player',
  position: playerStart,
  radius: 0.24,
  restitution: 0,
});

const bodyRecipes = [
  ...staticBodyRecipes,
  playerBodyRecipe,
  ...remotePlayerRecipes.map((actor) =>
    kinematicCuboidBody({
      canSleep: false,
      friction: 0.64,
      id: actor.id,
      position: actor.position,
      restitution: 0,
      size: actor.scale,
    })
  ),
] as const satisfies readonly RapierBodyRecipe<PhysicsEntityId>[];

const predictionBodyRecipes = [
  ...staticBodyRecipes,
  playerBodyRecipe,
  ...remotePlayerRecipes.map((actor) =>
    kinematicCuboidBody({
      canSleep: false,
      friction: 0.64,
      id: actor.id,
      position: actor.position,
      restitution: 0,
      size: actor.scale,
    })
  ),
] as const satisfies readonly RapierBodyRecipe<PredictionEntityId>[];

const dynamicRenderBodyIds = dynamicRenderBodies.map((body) => body.id);
const remoteRenderBodyIds = remotePlayerRecipes.map((body) => body.id);
const remoteActorStartPositions = {
  'crate-a': remotePlayerRecipes[0].position,
  'crate-b': remotePlayerRecipes[1].position,
  'crate-c': remotePlayerRecipes[2].position,
  'crate-d': remotePlayerRecipes[3].position,
} satisfies Record<RemoteActorId, Vec3>;
const remoteActorMotion = {
  'crate-a': { amplitude: 0.16, axis: 'x', offset: 0, period: 180 },
  'crate-b': { amplitude: 0.14, axis: 'z', offset: 45, period: 210 },
  'crate-c': { amplitude: 0.18, axis: 'x', offset: 90, period: 240 },
  'crate-d': { amplitude: 0.12, axis: 'z', offset: 135, period: 190 },
} satisfies Record<RemoteActorId, {
  readonly amplitude: number;
  readonly axis: 'x' | 'z';
  readonly offset: number;
  readonly period: number;
}>;
const remoteActorInterestPolicies = Object.fromEntries(
  remotePlayerRecipes.map((actor) => [actor.id, actor.interestPolicy]),
) as Record<RemoteActorId, RemoteActorInterestPolicy>;

const initialBodies = dynamicRenderBodies.map((body) => ({
  id: body.id,
  position: body.position,
  rotation: zeroRotation,
  scale: body.scale,
})) satisfies readonly BodyRenderState[];

const initialPlayerBody = {
  id: 'player',
  position: playerStart,
  rotation: zeroRotation,
  scale: playerScale,
} satisfies BodyRenderState;

const initialHitscanState: RapierHitscanState = {
  adjudications: 0,
  clientFireTick: -1,
  direction: [1, 0, 0],
  endpoint: [0, 0, 0],
  hit: false,
  hitDistance: hitscanMaxDistance,
  hitId: 'none',
  hitKind: 'miss',
  hitPosition: [0, 0, 0],
  historyFrames: 1,
  maxDistance: hitscanMaxDistance,
  mode: 'server-rewind-raycast',
  origin: [0, 0, 0],
  originError: 0,
  receivedServerTick: 0,
  rewindAgeTicks: 0,
  rewindServerTick: 0,
  sequence: -1,
};

const initialNetworkStats: RapierNetworkStats = {
  clientTick: 0,
  downlinkLatencyTicks: networkConfig.downlinkLatencyTicks,
  droppedInputs: 0,
  droppedShots: 0,
  droppedSnapshots: 0,
  fireLossEvery: networkConfig.fireLossEvery,
  inputLossEvery: networkConfig.inputLossEvery,
  interpolation: 'remote-snapshot-buffer',
  interpolationBufferFrames: 1,
  interpolationDelayTicks,
  interpolationTargetServerTick: 0,
  interpolationUnderflows: 0,
  interestColdActors: 0,
  interestCombatActors: 1,
  interestDormantActors: 2,
  interestGhostProxies: 1,
  interestHotActors: 1,
  interestMode: 'profile-stages',
  interestPolicyProfiles: 'walking-player,flying-player',
  interestBlockingProxies: 1,
  interestReplicatedActors: 2,
  interestTotalActors: 4,
  interestTransformActors: 2,
  interestWarmActors: 1,
  jitterTicks: networkConfig.jitterTicks,
  lastPredictionError: 0,
  lastProcessedInputTick: -1,
  lastReconciledServerTick: 0,
  lastReceivedServerTick: 0,
  mode: 'server-authoritative',
  pendingInputs: 0,
  pendingPredictedInputs: 0,
  pendingShots: 0,
  pendingSnapshots: 0,
  predictedTick: 0,
  prediction: 'client-player-replay',
  reconciliationEpsilon,
  reconciliations: 0,
  serverLeadTicks: 0,
  serverTick: 0,
  smoothing: 'visual-correction-offset',
  smoothingOffset: 0,
  smoothingTicksRemaining: 0,
  snapCorrectionDistance,
  snapshotIntervalTicks: networkConfig.snapshotIntervalTicks,
  snapshotLossEvery: networkConfig.snapshotLossEvery,
  uplinkLatencyTicks: networkConfig.uplinkLatencyTicks,
};

const delayedRemoteBodies = (
  frame: AuthoritativeFrame,
): readonly BodyRenderState[] => frame.bodies.filter((body) => body.id !== 'player');

const remoteActorsWithInterest = (
  observer: Vec3,
  bodies: readonly BodyRenderState[],
  tracker: RemoteActorInterestTracker,
  mode: 'commit' | 'evaluate' = 'evaluate',
): readonly RemoteActorRenderState[] => {
  const actors = bodies.map((body) => {
    const interestPolicy = remoteActorInterestPolicies[body.id as RemoteActorId];
    if (interestPolicy === undefined) {
      throw new Error(`Missing remote actor interest policy: ${body.id}`);
    }

    return {
      id: body.id,
      interestPolicy,
      position: body.position,
    };
  });
  const update = mode === 'commit'
    ? tracker.commit({ actors, observer })
    : tracker.evaluate({ actors, observer });
  const interest = new Map<DynamicEntityId, InterestState<DynamicEntityId, RemoteActorInterestPolicy>>(
    update.decisions.map((state) => [state.id, state]),
  );

  return bodies.map((body) => {
    const actorInterest = interest.get(body.id);
    if (actorInterest === undefined) {
      throw new Error(`Missing remote actor interest: ${body.id}`);
    }

    return {
      ...body,
      actorKind: 'remote-player',
      cadence: actorInterest.cadence,
      clientProxy: actorInterest.clientProxy,
      interest: actorInterest.band,
      interestDistance: actorInterest.distance,
      interestPolicy: actorInterest.interestPolicy,
      lanes: actorInterest.lanes,
      priority: actorInterest.priority,
      reason: actorInterest.reason,
      replicated: actorInterest.replicated,
    };
  });
};

const interestSummaryForActors = (
  actors: readonly RemoteActorRenderState[],
): InterestSummary => summarizeInterest(actors.map((actor) => ({
  band: actor.interest,
  cadence: actor.cadence,
  clientProxy: actor.clientProxy,
  distance: actor.interestDistance,
  id: actor.id,
  interestPolicy: actor.interestPolicy,
  lanes: actor.lanes,
  priority: actor.priority,
  reason: actor.reason,
  replicated: actor.replicated,
})));

const interestTransformActorCount = (
  actors: readonly RemoteActorRenderState[],
): number => actors.filter((actor) => actor.lanes.includes('transform')).length;

const interestLaneActorCount = (
  actors: readonly RemoteActorRenderState[],
  lane: InterestLane,
): number => actors.filter((actor) => actor.lanes.includes(lane)).length;

const interestClientProxyCount = (
  actors: readonly RemoteActorRenderState[],
  proxy: InterestClientProxyMode,
): number => actors.filter((actor) => actor.clientProxy === proxy).length;

export const initialRapierSceneState: RapierSceneState = {
  bodies: remoteActorsWithInterest(
    playerStart,
    delayedRemoteBodies({
      bodies: initialBodies,
      lastProcessedInputTick: -1,
      serverTick: 0,
    }),
    createInterestTracker<DynamicEntityId, RemoteActorInterestPolicy>({
      policies: interestPolicies,
    }),
  ),
  hitscan: initialHitscanState,
  network: initialNetworkStats,
  predictedPlayer: initialPlayerBody,
  serverPlayer: initialPlayerBody,
};

const playerInputForTick = (tick: number): Vec3 => {
  const phase = Math.floor((tick % 300) / 75);
  const speed = 0.046;

  switch (phase) {
    case 0:
      return [speed, -0.05, 0];
    case 1:
      return [0, -0.05, speed];
    case 2:
      return [-speed, -0.05, 0];
    default:
      return [0, -0.05, -speed];
  }
};

const triangleWave = (
  tick: number,
  period: number,
  offset: number,
): number => {
  const phase = ((tick + offset) % period) / period;
  return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
};

const remoteActorPositionForTick = (
  id: RemoteActorId,
  tick: number,
): Vec3 => {
  const start = remoteActorStartPositions[id];
  const motion = remoteActorMotion[id];
  const offset = triangleWave(tick, motion.period, motion.offset) * motion.amplitude;

  return motion.axis === 'x'
    ? [start[0] + offset, start[1], start[2]]
    : [start[0], start[1], start[2] + offset];
};

const setKinematicBodyPosition = <Id extends string>(
  runtime: RapierRuntime<Id>,
  id: Id,
  position: Vec3,
): void => {
  const nextPosition = vector(position);
  const body = requireRapierBody(runtime, id);
  body.setTranslation(nextPosition, true);
  body.setNextKinematicTranslation(nextPosition);
};

const syncServerRemoteActors = (
  simulation: Pick<RapierPhysicsSimulation, 'runtime'>,
  tick: number,
): void => {
  for (const id of remoteRenderBodyIds) {
    setKinematicBodyPosition(simulation.runtime, id, remoteActorPositionForTick(id, tick));
  }
};

const disabledClientProxyPosition = [50, -50, 50] satisfies Vec3;

const syncPredictedClientProxies = (
  simulation: Pick<RapierPhysicsSimulation, 'predictedRuntime'>,
  actors: readonly RemoteActorRenderState[],
): void => {
  for (const actor of actors) {
    setKinematicBodyPosition(
      simulation.predictedRuntime,
      actor.id,
      actor.clientProxy === 'blocking' ? actor.position : disabledClientProxyPosition,
    );
  }
};

const createCharacterController = <Id extends string>(
  runtime: RapierRuntime<Id>,
  includeDynamicBodies: boolean,
): KinematicCharacterController =>
  createRapierFpsCharacterController(runtime, {
    autostep: {
      includeDynamicBodies,
      maxHeight: 0.32,
      minWidth: 0.18,
    },
    characterMass: 80,
    maxSlopeClimbAngle: Math.PI / 4,
    minSlopeSlideAngle: Math.PI / 3,
    snapToGround: 0.36,
  });

const serverPlayerFromFrame = (frame: AuthoritativeFrame): BodyRenderState => {
  const player = frame.bodies.find((body) => body.id === 'player');
  if (player === undefined) throw new Error('Missing authoritative player body');
  return player;
};

const predictedPlayerFromRuntime = (
  simulation: Pick<RapierPhysicsSimulation, 'predictedRuntime'>,
): BodyRenderState => {
  const transform = readRapierBodyTransform(simulation.predictedRuntime, 'player');

  return {
    id: 'player',
    position: transform.position,
    rotation: zeroRotation,
    scale: playerScale,
  };
};

const visualPredictedPlayer = (
  simulation: Pick<RapierPhysicsSimulation, 'predictedRuntime' | 'visualCorrectionOffset'>,
): BodyRenderState => {
  const predictedPlayer = predictedPlayerFromRuntime(simulation);

  return {
    ...predictedPlayer,
    position: addVec3(predictedPlayer.position, simulation.visualCorrectionOffset),
  };
};

const remoteInterpolationState = (
  simulation: RapierPhysicsSimulation,
): RemoteInterpolationState<BodyRenderState> =>
  interpolateSnapshotBodies({
    bodyIds: remoteRenderBodyIds,
    delayTicks: interpolationDelayTicks,
    frames: simulation.receivedFrames,
    lastReceivedServerTick: simulation.lastReceivedServerTick,
    latestFrame: simulation.latestClientFrame,
  });

const readAuthoritativeFrame = (
  simulation: Pick<RapierPhysicsSimulation, 'lastProcessedInputTick' | 'runtime'>,
): AuthoritativeFrame => {
  const transformsById = new Map(
    readRapierBodyTransforms(simulation.runtime, dynamicRenderBodyIds).map((transform) => [
      transform.id,
      transform,
    ]),
  );

  return {
    bodies: dynamicRenderBodies.map((renderBody) => {
      const transform = transformsById.get(renderBody.id);
      if (transform === undefined) throw new Error(`Missing render body: ${renderBody.id}`);

      return {
        id: renderBody.id,
        position: transform.position,
        rotation: renderBody.id === 'player' ? zeroRotation : transform.eulerRotation,
        scale: renderBody.scale,
      };
    }),
    lastProcessedInputTick: simulation.lastProcessedInputTick,
    serverTick: simulation.runtime.tick,
  };
};

const recordServerFrame = (
  simulation: RapierPhysicsSimulation,
  frame: AuthoritativeFrame,
): void => {
  simulation.serverFrameHistory = recordSnapshotFrame(
    simulation.serverFrameHistory,
    frame,
    hitscanHistoryLimit,
  );
};

const adjudicateHitscan = (
  simulation: RapierPhysicsSimulation,
  shot: ClientFireSample,
): void => {
  const rewindFrame = selectRewindFrame(
    simulation.serverFrameHistory,
    shot.clientTick,
    simulation.latestClientFrame,
  );
  const shooter = serverPlayerFromFrame(rewindFrame);
  const origin = addVec3(shooter.position, hitscanEyeOffset);
  const direction = normalizeVec3(shot.direction);
  const hit = castHitscanRay({
    boxes: [
      ...staticPhysicsBoxes.map((box) => ({
        id: box.id,
        kind: 'static' as const,
        position: box.position,
        scale: box.scale,
      })),
      ...delayedRemoteBodies(rewindFrame).map((body) => ({
        id: body.id,
        kind: 'dynamic' as const,
        position: body.position,
        scale: body.scale,
      })),
    ],
    direction,
    maxDistance: hitscanMaxDistance,
    origin,
  }) satisfies HitscanRayResult<PhysicsEntityId>;
  simulation.hitscanAdjudications += 1;
  simulation.lastHitscan = {
    ...hit,
    adjudications: simulation.hitscanAdjudications,
    clientFireTick: shot.clientTick,
    direction,
    endpoint: vec3AtDistance(origin, direction, hit.hitDistance),
    historyFrames: simulation.serverFrameHistory.length,
    maxDistance: hitscanMaxDistance,
    mode: 'server-rewind-raycast',
    origin,
    originError: distanceVec3(origin, shot.origin),
    receivedServerTick: simulation.runtime.tick,
    rewindAgeTicks: Math.max(0, simulation.runtime.tick - rewindFrame.serverTick),
    rewindServerTick: rewindFrame.serverTick,
    sequence: shot.sequence,
  };
};

const networkStats = (
  simulation: RapierPhysicsSimulation,
  actors: readonly RemoteActorRenderState[],
  interestSummary: InterestSummary,
  remoteInterpolation: RemoteInterpolationState<BodyRenderState>,
): RapierNetworkStats => ({
  clientTick: simulation.clientTick,
  downlinkLatencyTicks: networkConfig.downlinkLatencyTicks,
  droppedInputs: simulation.droppedInputs,
  droppedShots: simulation.droppedShots,
  droppedSnapshots: simulation.droppedSnapshots,
  fireLossEvery: networkConfig.fireLossEvery,
  inputLossEvery: networkConfig.inputLossEvery,
  interpolation: 'remote-snapshot-buffer',
  interpolationBufferFrames: simulation.receivedFrames.length,
  interpolationDelayTicks,
  interpolationTargetServerTick: remoteInterpolation.targetServerTick,
  interpolationUnderflows: simulation.remoteInterpolationUnderflows,
  interestColdActors: interestSummary.cold,
  interestCombatActors: interestLaneActorCount(actors, 'combat'),
  interestDormantActors: interestSummary.dormantActors,
  interestGhostProxies: interestClientProxyCount(actors, 'ghost'),
  interestHotActors: interestSummary.hot,
  interestMode: 'profile-stages',
  interestPolicyProfiles: 'walking-player,flying-player',
  interestBlockingProxies: interestClientProxyCount(actors, 'blocking'),
  interestReplicatedActors: interestSummary.replicatedActors,
  interestTotalActors: interestSummary.totalActors,
  interestTransformActors: interestTransformActorCount(actors),
  interestWarmActors: interestSummary.warm,
  jitterTicks: networkConfig.jitterTicks,
  lastPredictionError: simulation.lastPredictionError,
  lastProcessedInputTick: simulation.lastProcessedInputTick,
  lastReconciledServerTick: simulation.lastReconciledServerTick,
  lastReceivedServerTick: simulation.lastReceivedServerTick,
  mode: 'server-authoritative',
  pendingInputs: simulation.inputQueue.length,
  pendingPredictedInputs: simulation.inputHistory.length,
  pendingShots: simulation.fireQueue.length,
  pendingSnapshots: simulation.snapshotQueue.length,
  predictedTick: simulation.predictedRuntime.tick,
  prediction: 'client-player-replay',
  reconciliationEpsilon,
  reconciliations: simulation.reconciliations,
  serverLeadTicks: Math.max(0, simulation.runtime.tick - simulation.lastReceivedServerTick),
  serverTick: simulation.runtime.tick,
  snapCorrectionDistance,
  smoothing: 'visual-correction-offset',
  smoothingOffset: distanceVec3(simulation.visualCorrectionOffset, zeroVec3),
  smoothingTicksRemaining: simulation.visualCorrectionTicksRemaining,
  snapshotIntervalTicks: networkConfig.snapshotIntervalTicks,
  snapshotLossEvery: networkConfig.snapshotLossEvery,
  uplinkLatencyTicks: networkConfig.uplinkLatencyTicks,
});

const stepPredictedPlayer = (
  simulation: RapierPhysicsSimulation,
  movement: Vec3,
): void => {
  moveKinematicBodyWithController(
    simulation.predictedController,
    simulation.predictedPlayerBody,
    simulation.predictedPlayerCollider,
    movement,
  );
  stepRapierRuntime(simulation.predictedRuntime);
};

const resetPredictedPlayer = (
  simulation: RapierPhysicsSimulation,
  position: Vec3,
): void => {
  const nextPosition = vector(position);
  simulation.predictedPlayerBody.setTranslation(nextPosition, true);
  simulation.predictedPlayerBody.setNextKinematicTranslation(nextPosition);
};

const replayPredictedInputs = (
  simulation: RapierPhysicsSimulation,
  afterClientTick: number,
): void => {
  simulation.predictedRuntime.tick = afterClientTick;

  for (const input of simulation.inputHistory) {
    if (input.clientTick <= afterClientTick) continue;
    stepPredictedPlayer(simulation, input.movement);
  }
};

const reconcilePredictedPlayer = (
  simulation: RapierPhysicsSimulation,
  frame: AuthoritativeFrame,
): void => {
  const authoritativePlayer = serverPlayerFromFrame(frame);
  const predictedPlayer = predictedPlayerFromRuntime(simulation);
  const visualBeforeCorrection = visualPredictedPlayer(simulation);
  const error = distanceVec3(predictedPlayer.position, authoritativePlayer.position);

  simulation.lastPredictionError = error;
  simulation.lastReconciledServerTick = frame.serverTick;
  if (error > reconciliationEpsilon) {
    simulation.reconciliations += 1;
  }

  resetPredictedPlayer(simulation, authoritativePlayer.position);
  replayPredictedInputs(simulation, frame.lastProcessedInputTick);
  simulation.inputHistory = simulation.inputHistory.filter((input) =>
    input.clientTick > frame.lastProcessedInputTick
  );

  if (error <= reconciliationEpsilon || error >= snapCorrectionDistance) {
    simulation.visualCorrectionOffset = zeroVec3;
    simulation.visualCorrectionTicksRemaining = 0;
    return;
  }

  const correctedPlayer = predictedPlayerFromRuntime(simulation);
  simulation.visualCorrectionOffset = subtractVec3(
    visualBeforeCorrection.position,
    correctedPlayer.position,
  );
  simulation.visualCorrectionTicksRemaining = smoothingDurationTicks;
};

const decayVisualCorrection = (
  simulation: RapierPhysicsSimulation,
): void => {
  if (simulation.visualCorrectionTicksRemaining <= 0) return;

  const nextTicks = simulation.visualCorrectionTicksRemaining - 1;
  simulation.visualCorrectionOffset = nextTicks === 0
    ? zeroVec3
    : scaleVec3(
      simulation.visualCorrectionOffset,
      nextTicks / simulation.visualCorrectionTicksRemaining,
    );
  simulation.visualCorrectionTicksRemaining = nextTicks;
};

const recordClientInput = (
  simulation: RapierPhysicsSimulation,
  input: ClientInputSample,
): void => {
  simulation.inputHistory.push(input);
  if (simulation.inputHistory.length > inputHistoryLimit) {
    simulation.inputHistory = simulation.inputHistory.slice(-inputHistoryLimit);
  }
};

const createClientInput = (
  simulation: RapierPhysicsSimulation,
): ClientInputSample => {
  const sequence = simulation.inputSequence;
  simulation.inputSequence += 1;

  return {
    clientTick: simulation.clientTick,
    movement: playerInputForTick(simulation.clientTick),
    sequence,
  };
};

const enqueueClientInput = (
  simulation: RapierPhysicsSimulation,
  input: ClientInputSample,
): void => {
  const result = enqueueNetworkPacket({
    baseTick: simulation.runtime.tick,
    config: inputLaneConfig,
    payload: input,
    sequence: input.sequence,
  });

  if (result.dropped) {
    simulation.droppedInputs += 1;
    return;
  }

  simulation.inputQueue.push(result.packet);
};

const createClientFire = (
  simulation: RapierPhysicsSimulation,
): ClientFireSample | undefined => {
  if (simulation.clientTick < firstFireClientTick) return undefined;
  if ((simulation.clientTick - firstFireClientTick) % fireIntervalTicks !== 0) return undefined;

  const sequence = simulation.fireSequence;
  simulation.fireSequence += 1;
  const shooter = predictedPlayerFromRuntime(simulation);
  const origin = addVec3(shooter.position, hitscanEyeOffset);
  const target = frameBody(simulation.latestClientFrame, 'crate-c') ??
    frameBody(simulation.latestClientFrame, 'crate-a');
  const targetPosition = target === undefined
    ? addVec3(origin, [1, 0, 0])
    : [target.position[0], origin[1], target.position[2]] satisfies Vec3;

  return {
    clientTick: simulation.clientTick,
    direction: normalizeVec3(subtractVec3(targetPosition, origin)),
    origin,
    sequence,
  };
};

const enqueueClientFire = (
  simulation: RapierPhysicsSimulation,
  shot: ClientFireSample | undefined,
): void => {
  if (shot === undefined) return;

  const result = enqueueNetworkPacket({
    baseTick: simulation.runtime.tick,
    config: fireLaneConfig,
    payload: shot,
    sequence: shot.sequence,
  });

  if (result.dropped) {
    simulation.droppedShots += 1;
    return;
  }

  simulation.fireQueue.push(result.packet);
};

const deliverInputsToServer = (
  simulation: RapierPhysicsSimulation,
): void => {
  const { pending, ready } = takeReadyNetworkPackets(
    simulation.inputQueue,
    simulation.runtime.tick,
  );
  simulation.inputQueue = pending;

  for (const packet of ready.sort((a, b) => a.sequence - b.sequence)) {
    const input = packet.payload;
    if (input.clientTick < simulation.lastProcessedInputTick) continue;
    simulation.currentServerInput = input.movement;
    simulation.lastProcessedInputTick = input.clientTick;
  }
};

const deliverShotsToServer = (
  simulation: RapierPhysicsSimulation,
): void => {
  const { pending, ready } = takeReadyNetworkPackets(
    simulation.fireQueue,
    simulation.runtime.tick,
  );
  simulation.fireQueue = pending;

  for (const packet of ready.sort((a, b) => a.sequence - b.sequence)) {
    adjudicateHitscan(simulation, packet.payload);
  }
};

const enqueueServerSnapshot = (
  simulation: RapierPhysicsSimulation,
  frame: AuthoritativeFrame,
): void => {
  if (simulation.runtime.tick % networkConfig.snapshotIntervalTicks !== 0) return;

  const sequence = simulation.snapshotSequence;
  simulation.snapshotSequence += 1;
  const result = enqueueNetworkPacket({
    baseTick: simulation.clientTick,
    config: snapshotLaneConfig,
    payload: frame,
    sequence,
  });

  if (result.dropped) {
    simulation.droppedSnapshots += 1;
    return;
  }

  simulation.snapshotQueue.push(result.packet);
};

const deliverSnapshotsToClient = (
  simulation: RapierPhysicsSimulation,
): void => {
  const { pending, ready } = takeReadyNetworkPackets(
    simulation.snapshotQueue,
    simulation.clientTick,
  );
  simulation.snapshotQueue = pending;

  for (const packet of ready.sort((a, b) => a.payload.serverTick - b.payload.serverTick)) {
    const frame = packet.payload;
    if (frame.serverTick < simulation.lastReceivedServerTick) continue;
    simulation.latestClientFrame = frame;
    simulation.lastReceivedServerTick = frame.serverTick;
    simulation.receivedFrames = [
      ...simulation.receivedFrames,
      frame,
    ].slice(-interpolationFrameLimit);
    reconcilePredictedPlayer(simulation, frame);
  }
};

export const createRapierPhysicsSimulation = async (): Promise<RapierPhysicsSimulation> => {
  const [runtime, predictedRuntime] = await Promise.all([
    createRapierRuntime<PhysicsEntityId>({
      bodies: bodyRecipes,
      gravity: [0, -9.81, 0],
      solverIterations: 6,
      timestep: fixedStepSeconds,
    }),
    createRapierRuntime<PredictionEntityId>({
      bodies: predictionBodyRecipes,
      gravity: [0, -9.81, 0],
      solverIterations: 6,
      timestep: fixedStepSeconds,
    }),
  ]);
  const simulationBase = {
    lastProcessedInputTick: -1,
    runtime,
  } satisfies Pick<RapierPhysicsSimulation, 'lastProcessedInputTick' | 'runtime'>;
  const initialFrame = readAuthoritativeFrame(simulationBase);

  return {
    clientTick: 0,
    controller: createCharacterController(runtime, true),
    currentServerInput: [0, -0.05, 0],
    dispose: () => {
      predictedRuntime.dispose();
      runtime.dispose();
    },
    droppedInputs: 0,
    droppedShots: 0,
    droppedSnapshots: 0,
    fireQueue: [],
    fireSequence: 0,
    hitscanAdjudications: 0,
    inputHistory: [],
    inputQueue: [],
    inputSequence: 0,
    interestTracker: createInterestTracker<DynamicEntityId, RemoteActorInterestPolicy>({
      policies: interestPolicies,
    }),
    lastPredictionError: 0,
    lastProcessedInputTick: -1,
    lastReceivedServerTick: initialFrame.serverTick,
    lastReconciledServerTick: initialFrame.serverTick,
    latestClientFrame: initialFrame,
    playerBody: requireRapierBody(runtime, 'player'),
    playerCollider: requireRapierCollider(runtime, 'player'),
    predictedController: createCharacterController(predictedRuntime, false),
    predictedPlayerBody: requireRapierBody(predictedRuntime, 'player'),
    predictedPlayerCollider: requireRapierCollider(predictedRuntime, 'player'),
    predictedRuntime,
    receivedFrames: [initialFrame],
    remoteInterpolationUnderflows: 0,
    reconciliations: 0,
    runtime,
    serverFrameHistory: [initialFrame],
    visualCorrectionOffset: zeroVec3,
    visualCorrectionTicksRemaining: 0,
    snapshotQueue: [],
    snapshotSequence: 0,
    lastHitscan: {
      ...initialHitscanState,
      historyFrames: 1,
    },
  };
};

export const disposeRapierPhysicsSimulation = (
  simulation: RapierPhysicsSimulation,
): void => simulation.dispose();

export const readRapierPhysicsSimulation = (
  simulation: RapierPhysicsSimulation,
): RapierSceneState => {
  const remoteInterpolation = remoteInterpolationState(simulation);
  const remoteActors = remoteActorsWithInterest(
    visualPredictedPlayer(simulation).position,
    remoteInterpolation.bodies,
    simulation.interestTracker,
  );

  return {
    bodies: remoteActors,
    hitscan: {
      ...simulation.lastHitscan,
      adjudications: simulation.hitscanAdjudications,
      historyFrames: simulation.serverFrameHistory.length,
    },
    network: networkStats(
      simulation,
      remoteActors,
      interestSummaryForActors(remoteActors),
      remoteInterpolation,
    ),
    predictedPlayer: visualPredictedPlayer(simulation),
    serverPlayer: serverPlayerFromFrame(simulation.latestClientFrame),
  };
};

export const stepRapierPhysicsSimulation = (
  simulation: RapierPhysicsSimulation,
): RapierSceneState => {
  simulation.clientTick += 1;
  decayVisualCorrection(simulation);
  const input = createClientInput(simulation);
  recordClientInput(simulation, input);
  enqueueClientInput(simulation, input);
  const predictionRemoteInterpolation = remoteInterpolationState(simulation);
  const predictionRemoteActors = remoteActorsWithInterest(
    visualPredictedPlayer(simulation).position,
    predictionRemoteInterpolation.bodies,
    simulation.interestTracker,
  );
  syncPredictedClientProxies(simulation, predictionRemoteActors);
  stepPredictedPlayer(simulation, input.movement);
  enqueueClientFire(simulation, createClientFire(simulation));
  deliverInputsToServer(simulation);
  syncServerRemoteActors(simulation, simulation.runtime.tick + 1);
  moveKinematicBodyWithController(
    simulation.controller,
    simulation.playerBody,
    simulation.playerCollider,
    simulation.currentServerInput,
  );
  stepRapierRuntime(simulation.runtime);
  const serverFrame = readAuthoritativeFrame(simulation);
  recordServerFrame(simulation, serverFrame);
  enqueueServerSnapshot(simulation, serverFrame);
  deliverShotsToServer(simulation);
  deliverSnapshotsToClient(simulation);
  const remoteInterpolation = remoteInterpolationState(simulation);
  if (remoteInterpolation.underflow) {
    simulation.remoteInterpolationUnderflows += 1;
  }
  const predictedPlayer = visualPredictedPlayer(simulation);
  const remoteActors = remoteActorsWithInterest(
    predictedPlayer.position,
    remoteInterpolation.bodies,
    simulation.interestTracker,
    'commit',
  );
  syncPredictedClientProxies(simulation, remoteActors);

  return {
    bodies: remoteActors,
    hitscan: {
      ...simulation.lastHitscan,
      adjudications: simulation.hitscanAdjudications,
      historyFrames: simulation.serverFrameHistory.length,
    },
    network: networkStats(
      simulation,
      remoteActors,
      interestSummaryForActors(remoteActors),
      remoteInterpolation,
    ),
    predictedPlayer,
    serverPlayer: serverPlayerFromFrame(simulation.latestClientFrame),
  };
};

export const rapierPhysicsErrorFrame = (): RapierSceneState => initialRapierSceneState;
