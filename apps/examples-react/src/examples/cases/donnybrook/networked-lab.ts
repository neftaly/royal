export type Vec3 = readonly [x: number, y: number, z: number];
export type ActorId = string;
export type BandId = string;
export type NetworkLaneId = string;
export type NodeId = string;
export type EpochId = string;
export type CursorId = string;

export type Reliability = 'recoverable' | 'reliable' | 'unreliable';
export type Ordering = 'newest' | 'ordered' | 'sequenced';
export type ReplicaProxyMode = 'blocking' | 'ghost' | 'none' | (string & {});

export type ActorMotion =
  | {
    readonly kind: 'patrol';
    readonly amplitude: number;
    readonly axis: 'x' | 'z';
    readonly offsetTicks?: number;
    readonly periodTicks: number;
  }
  | {
    readonly kind: 'ellipse';
    readonly offsetTicks?: number;
    readonly periodTicks: number;
    readonly radius: readonly [x: number, z: number];
  }
  | {
    readonly kind: 'square';
    readonly periodTicks: number;
    readonly speed: number;
  }
  | {
    readonly kind: 'static';
  };

export type ActorRecipe = {
  readonly id: ActorId;
  readonly ownerNodeId: NodeId;
  readonly position: Vec3;
  readonly forward?: Vec3;
  readonly motion?: ActorMotion;
  readonly priority?: number;
  readonly scale?: Vec3;
};

export type RuntimeActor = {
  readonly forward: Vec3;
  readonly id: ActorId;
  readonly ownerNodeId: NodeId;
  readonly position: Vec3;
  readonly previousPosition: Vec3;
  readonly priority: number;
  readonly scale: Vec3;
};

export type PhysicsRuntime = {
  readonly actors: () => readonly RuntimeActor[];
  readonly predict?: (input: {
    readonly actorId: ActorId;
    readonly leadTicks: number;
    readonly tick: number;
  }) => RuntimeActor | undefined;
  readonly reset: () => void;
  readonly step: (input: { readonly tick: number }) => readonly RuntimeActor[];
};

export type PhysicsAdapter = {
  readonly create: () => PhysicsRuntime;
};

export type ClockDefinition = {
  readonly hz: number;
};

export type LaneDefinition = {
  readonly ordering: Ordering;
  readonly reliability: Reliability;
};

export type LaneRegistry = Readonly<Record<NetworkLaneId, LaneDefinition>>;

export type BandSchedule = {
  readonly cadenceTicks: number;
  readonly lanes: readonly NetworkLaneId[];
};

export type LaneSchedulerDefinition = {
  readonly bands: Readonly<Record<BandId, BandSchedule>>;
};

export type InterestCandidate = {
  readonly actorId: ActorId;
  readonly band: BandId;
  readonly bandRank: number;
  readonly priority: number;
  readonly reason: string;
  readonly score: number;
  readonly volumeId: string | undefined;
};

export type InterestDecision = InterestCandidate & {
  readonly admitted: boolean;
  readonly cadenceTicks: number;
  readonly lanes: readonly NetworkLaneId[];
  readonly proxy: ReplicaProxyMode;
  readonly replicatedThisTick: boolean;
  readonly wantedBand: BandId;
};

export type AwarenessVolumeDebug =
  | {
    readonly band: BandId;
    readonly forward: Vec3;
    readonly halfAngle: number;
    readonly id: string;
    readonly kind: 'cone';
    readonly observerId: ActorId;
    readonly position: Vec3;
    readonly range: number;
  }
  | {
    readonly band: BandId;
    readonly forward: Vec3;
    readonly id: string;
    readonly kind: 'ovoid';
    readonly observerId: ActorId;
    readonly position: Vec3;
    readonly radii: Vec3;
  };

export type AwarenessVolume = {
  readonly band: BandId;
  readonly bandRank: number;
  readonly debug: (input: ClassifierInput) => AwarenessVolumeDebug;
  readonly evaluate: (input: ClassifierInput & { readonly actor: RuntimeActor }) =>
    | {
      readonly priority?: number;
      readonly reason: string;
      readonly score: number;
    }
    | undefined;
  readonly id: string;
};

export type ClassifierInput = {
  readonly observer: RuntimeActor;
  readonly recipientId: NodeId;
  readonly tick: number;
};

export type InterestClassifier = {
  readonly classify: (input: ClassifierInput & {
    readonly actors: readonly RuntimeActor[];
  }) => {
    readonly candidates: readonly InterestCandidate[];
    readonly volumes: readonly AwarenessVolumeDebug[];
  };
};

export type TieBreaker =
  | 'actorId'
  | 'bandRank'
  | 'lastSeenTick'
  | 'priority'
  | 'score';

export type AdmissionDefinition = {
  readonly maxByBand: Readonly<Record<BandId, number>>;
  readonly tieBreakers: readonly TieBreaker[];
};

export type OwnershipSelector = (input: {
  readonly actors: readonly RuntimeActor[];
  readonly nodeId: NodeId;
}) => readonly RuntimeActor[];

export type ObserverSelector = (input: {
  readonly actors: readonly RuntimeActor[];
  readonly nodeId: NodeId;
}) => RuntimeActor | undefined;

export type InterestPipelineDefinition = {
  readonly admit: AdmissionDefinition;
  readonly classify: InterestClassifier;
  readonly observer: ObserverSelector;
  readonly schedule: LaneSchedulerDefinition;
};

export type ReplicaViewDefinition = {
  readonly prediction?: ReplicaPredictionDefinition;
  readonly proxyByBand: Readonly<Record<BandId, ReplicaProxyMode>>;
};

export type ReplicaPredictionDefinition = {
  readonly actors: OwnershipSelector;
  readonly leadTicks: number;
};

export type NetworkedPhysicsNodeDefinition = {
  readonly interest: InterestPipelineDefinition;
  readonly physics: PhysicsAdapter;
  readonly replica: ReplicaViewDefinition;
};

export type HostFrameTopologyDefinition = {
  readonly authorityNodeId: NodeId;
  readonly kind: 'host-frame';
  readonly node: NetworkedPhysicsNodeDefinition;
  readonly viewerNodeIds: readonly NodeId[];
};

export type NetworkTopologyDefinition = HostFrameTopologyDefinition;

export type SimulatedLaneConfig = {
  readonly jitterTicks?: number;
  readonly latencyTicks?: number;
  readonly lossEvery?: number;
};

export type SimulatedTransportDefinition = {
  readonly lanes: Readonly<Record<NetworkLaneId, SimulatedLaneConfig>>;
};

export type NetworkedPhysicsLabConfig = {
  readonly clock: ClockDefinition;
  readonly lanes: LaneRegistry;
  readonly seed: string;
  readonly topology: NetworkTopologyDefinition;
  readonly transport: SimulatedTransportDefinition;
  readonly traceLimit?: number;
};

export type SourceCursor = {
  readonly authorityId: NodeId;
  readonly cursor: CursorId;
  readonly epoch: EpochId;
};

export type ActorRenderState = {
  readonly actorId: ActorId;
  readonly admitted: boolean;
  readonly authorityForward: Vec3;
  readonly authorityPosition: Vec3;
  readonly authorityScale: Vec3;
  readonly band: BandId;
  readonly cadenceTicks: number;
  readonly forward: Vec3;
  readonly lanes: readonly NetworkLaneId[];
  readonly ownerNodeId: NodeId;
  readonly position: Vec3;
  readonly priority: number;
  readonly proxy: ReplicaProxyMode;
  readonly reason: string;
  readonly replicatedThisTick: boolean;
  readonly scale: Vec3;
  readonly score: number;
  readonly predictionLeadTicks: number;
  readonly staleTicks: number;
  readonly volumeId: string | undefined;
  readonly wantedBand: BandId;
};

export type InterestSummary = {
  readonly admittedByBand: Readonly<Record<BandId, number>>;
  readonly budgetRejected: number;
  readonly replicatedThisTick: number;
  readonly totalActors: number;
  readonly wantedByBand: Readonly<Record<BandId, number>>;
};

export type InterestFrame = {
  readonly decisions: readonly InterestDecision[];
  readonly observerActorId: ActorId | undefined;
  readonly recipientId: NodeId;
  readonly summary: InterestSummary;
  readonly volumes: readonly AwarenessVolumeDebug[];
};

export type NetworkLaneFrame = LaneDefinition & {
  readonly delivered: number;
  readonly dropped: number;
  readonly id: NetworkLaneId;
  readonly queued: number;
  readonly sent: number;
};

export type SimulatedNetworkFrame = {
  readonly lanes: readonly NetworkLaneFrame[];
  readonly topology: NetworkTopologyDefinition['kind'];
};

export type RenderFrame = {
  readonly actors: readonly ActorRenderState[];
  readonly awarenessVolumes: readonly AwarenessVolumeDebug[];
  readonly source: SourceCursor;
  readonly tick: number;
};

export type NetworkedLabFrame = {
  readonly interest: InterestFrame;
  readonly network: SimulatedNetworkFrame;
  readonly render: RenderFrame;
  readonly selectedActorId: ActorId | undefined;
  readonly source: SourceCursor;
  readonly tick: number;
  readonly viewNodeId: NodeId;
};

export type NetworkTraceRow =
  | {
    readonly actorId: ActorId;
    readonly at: number;
    readonly event: 'delivered' | 'dropped' | 'queued';
    readonly lane: NetworkLaneId;
    readonly recipientId: NodeId;
    readonly sequence: number;
  }
  | {
    readonly at: number;
    readonly event: 'reset';
    readonly seed: string;
  };

export type NetworkedPhysicsLabControls = {
  readonly pause: () => void;
  readonly resume: () => void;
  readonly selectActor: (actorId: ActorId | undefined) => void;
  readonly setViewNode: (nodeId: NodeId) => void;
  readonly step: (ticks?: number) => NetworkedLabFrame;
};

export type NetworkedPhysicsLab = NetworkedPhysicsLabControls & {
  readonly frame: (nodeId?: NodeId) => NetworkedLabFrame;
  readonly isPaused: () => boolean;
  readonly reset: (seed?: string) => NetworkedLabFrame;
  readonly subscribe: (listener: () => void) => () => void;
  readonly trace: () => readonly NetworkTraceRow[];
};

type ReplicaActorState = {
  readonly decision: InterestDecision;
  readonly forward: Vec3;
  readonly lastUpdateTick: number;
  readonly position: Vec3;
  readonly scale: Vec3;
};

type PacketPayload = {
  readonly actor: RuntimeActor;
  readonly decision: InterestDecision;
  readonly kind: 'actor-state';
};

type QueuedPacket = {
  readonly deliverAtTick: number;
  readonly lane: NetworkLaneId;
  readonly payload: PacketPayload;
  readonly recipientId: NodeId;
  readonly sequence: number;
};

type LaneCounters = {
  delivered: number;
  dropped: number;
  sent: number;
};

type MutableState = {
  authorityActors: readonly RuntimeActor[];
  epoch: EpochId;
  laneCounters: Map<NetworkLaneId, LaneCounters>;
  lastInterestByRecipient: Map<NodeId, InterestFrame>;
  paused: boolean;
  predictedActors: Map<NodeId, Map<ActorId, RuntimeActor>>;
  queue: QueuedPacket[];
  replicas: Map<NodeId, Map<ActorId, ReplicaActorState>>;
  selectedActorId: ActorId | undefined;
  seed: string;
  sequenceByLane: Map<NetworkLaneId, number>;
  tick: number;
  trace: NetworkTraceRow[];
  viewNodeId: NodeId;
};

const defaultScale: Vec3 = [0.52, 1.16, 0.52];
const dormantBand = 'dormant';

export const fixedStep = (options: ClockDefinition): ClockDefinition => options;

export const defineLanes = <Lanes extends LaneRegistry>(lanes: Lanes): Lanes => lanes;

export const defineNetworkedPhysicsNode = (
  node: NetworkedPhysicsNodeDefinition,
): NetworkedPhysicsNodeDefinition => node;

export const interestPipeline = (
  pipeline: InterestPipelineDefinition,
): InterestPipelineDefinition => pipeline;

export const budgetedAdmission = (
  admission: AdmissionDefinition,
): AdmissionDefinition => admission;

export const laneScheduler = (
  schedule: LaneSchedulerDefinition,
): LaneSchedulerDefinition => schedule;

export const replicaView = (
  replica: ReplicaViewDefinition,
): ReplicaViewDefinition => replica;

export const hostFrameTopology = ({
  authorityNodeId = 'authority',
  node,
  viewerNodeIds,
}: {
  readonly authorityNodeId?: NodeId;
  readonly node: NetworkedPhysicsNodeDefinition;
  readonly viewerNodeIds: readonly NodeId[];
}): HostFrameTopologyDefinition => ({
  authorityNodeId,
  kind: 'host-frame',
  node,
  viewerNodeIds,
});

export const simulatedTransport = (
  transport: SimulatedTransportDefinition,
): SimulatedTransportDefinition => transport;

export const ownedByNode = (): OwnershipSelector =>
  ({ actors, nodeId }) => actors.filter((actor) => actor.ownerNodeId === nodeId);

export const viewpointOf = (selectActors: OwnershipSelector): ObserverSelector =>
  (input) => selectActors(input)[0];

export const predicted = (options: {
  readonly actors: OwnershipSelector;
  readonly leadTicks?: number;
}): ReplicaPredictionDefinition => ({
  actors: options.actors,
  leadTicks: options.leadTicks ?? 3,
});

export const remoteSnapshotInterpolation = (options: { readonly delayTicks: number }): {
  readonly delayTicks: number;
} => options;

export const smoothThenSnap = (options: {
  readonly epsilon: number;
  readonly snapDistance: number;
}): typeof options => options;

export const transformReconciliation = <Reconciliation>(reconciliation: Reconciliation): Reconciliation =>
  reconciliation;

export const kinematicPhysics = ({
  actors,
}: {
  readonly actors: readonly ActorRecipe[];
}): PhysicsAdapter => ({
  create: () => createKinematicRuntime(actors),
});

const createKinematicRuntime = (
  recipes: readonly ActorRecipe[],
): PhysicsRuntime => {
  let currentActors = recipes.map((recipe) => actorFromRecipe(recipe, 0));

  return {
    actors: () => currentActors,
    predict: ({ actorId, tick, leadTicks }) => {
      const recipe = recipes.find((entry) => entry.id === actorId);
      if (recipe === undefined) return undefined;
      return actorFromRecipe(recipe, tick + leadTicks);
    },
    reset: () => {
      currentActors = recipes.map((recipe) => actorFromRecipe(recipe, 0));
    },
    step: ({ tick }) => {
      const previous = new Map(currentActors.map((actor) => [actor.id, actor]));
      currentActors = recipes.map((recipe) => {
        const next = actorFromRecipe(recipe, tick);
        return {
          ...next,
          previousPosition: previous.get(recipe.id)?.position ?? next.position,
        };
      });
      return currentActors;
    },
  };
};

export const actorFromRecipe = (recipe: ActorRecipe, tick: number): RuntimeActor => {
  const position = motionPosition(recipe, tick);
  const baseForward = normalizeHorizontal(recipe.forward ?? [1, 0, 0]);
  const previousPosition = tick > 0 ? motionPosition(recipe, tick - 1) : position;
  const delta = subtractVec3(position, previousPosition);
  const movedForward = horizontalLength(delta) > 0.0001 ? normalizeHorizontal(delta) : baseForward;

  return {
    forward: movedForward,
    id: recipe.id,
    ownerNodeId: recipe.ownerNodeId,
    position,
    previousPosition,
    priority: recipe.priority ?? 0.5,
    scale: recipe.scale ?? defaultScale,
  };
};

export const motionPosition = (recipe: ActorRecipe, tick: number): Vec3 => {
  const motion = recipe.motion ?? { kind: 'static' as const };
  if (motion.kind === 'static') return recipe.position;

  if (motion.kind === 'ellipse') {
    const phase = ((tick + (motion.offsetTicks ?? 0)) / Math.max(1, motion.periodTicks)) * Math.PI * 2;
    return [
      recipe.position[0] + Math.cos(phase) * motion.radius[0],
      recipe.position[1],
      recipe.position[2] + Math.sin(phase) * motion.radius[1],
    ];
  }

  if (motion.kind === 'patrol') {
    const offset = triangleWave(tick, motion.periodTicks, motion.offsetTicks ?? 0) * motion.amplitude;
    return motion.axis === 'x'
      ? [recipe.position[0] + offset, recipe.position[1], recipe.position[2]]
      : [recipe.position[0], recipe.position[1], recipe.position[2] + offset];
  }

  const period = Math.max(4, motion.periodTicks);
  const sideTicks = period / 4;
  const phase = Math.floor((tick % period) / sideTicks);
  const t = ((tick % period) % sideTicks) / sideTicks;
  const extent = motion.speed * sideTicks;
  switch (phase) {
    case 0:
      return [recipe.position[0] + t * extent, recipe.position[1], recipe.position[2]];
    case 1:
      return [recipe.position[0] + extent, recipe.position[1], recipe.position[2] + t * extent];
    case 2:
      return [recipe.position[0] + (1 - t) * extent, recipe.position[1], recipe.position[2] + extent];
    default:
      return [recipe.position[0], recipe.position[1], recipe.position[2] + (1 - t) * extent];
  }
};

export const awarenessVolumes = (
  volumes: readonly AwarenessVolume[],
): InterestClassifier => ({
  classify: ({ actors, observer, recipientId, tick }) => {
    const candidates = actors.flatMap((actor) => {
      if (actor.id === observer.id) return [];
      const matches = volumes.flatMap((volume) => {
        const match = volume.evaluate({ actor, observer, recipientId, tick });
        if (match === undefined) return [];
        return [{
          actorId: actor.id,
          band: volume.band,
          bandRank: volume.bandRank,
          priority: match.priority ?? actor.priority,
          reason: match.reason,
          score: match.score,
          volumeId: volume.id,
        } satisfies InterestCandidate];
      });
      return bestCandidate(matches);
    });

    return {
      candidates,
      volumes: volumes.map((volume) => volume.debug({ observer, recipientId, tick })),
    };
  },
});

export const focusCone = ({
  band = 'hot',
  bandRank = 3,
  halfAngle = Math.PI / 7,
  id = 'focus',
  priority = 1,
  range = 5.8,
}: {
  readonly band?: BandId;
  readonly bandRank?: number;
  readonly halfAngle?: number;
  readonly id?: string;
  readonly priority?: number;
  readonly range?: number;
} = {}): AwarenessVolume => ({
  band,
  bandRank,
  debug: ({ observer }) => ({
    band,
    forward: observer.forward,
    halfAngle,
    id,
    kind: 'cone',
    observerId: observer.id,
    position: observer.position,
    range,
  }),
  evaluate: ({ actor, observer }) => {
    const delta = subtractVec3(actor.position, observer.position);
    const distance = horizontalLength(delta);
    if (distance <= 0.0001 || distance > range) return undefined;
    const direction = normalizeHorizontal(delta);
    const alignment = dotHorizontal(observer.forward, direction);
    if (alignment < Math.cos(halfAngle)) return undefined;

    return {
      priority: actor.priority,
      reason: `${id}:inside-cone`,
      score: priority + actor.priority + alignment + (1 - distance / range),
    };
  },
  id,
});

export const ovoidAwareness = ({
  band,
  bandRank,
  id,
  priority,
  radii,
}: {
  readonly band: BandId;
  readonly bandRank: number;
  readonly id: string;
  readonly priority: number;
  readonly radii: Vec3;
}): AwarenessVolume => ({
  band,
  bandRank,
  debug: ({ observer }) => ({
    band,
    forward: observer.forward,
    id,
    kind: 'ovoid',
    observerId: observer.id,
    position: observer.position,
    radii,
  }),
  evaluate: ({ actor, observer }) => {
    const local = localAwarenessPosition(observer, actor.position);
    const normalized =
      (local[0] / radii[0]) ** 2 +
      (local[1] / radii[1]) ** 2 +
      (local[2] / radii[2]) ** 2;
    if (normalized > 1) return undefined;

    return {
      priority: actor.priority,
      reason: `${id}:inside-ovoid`,
      score: priority + actor.priority + (1 - normalized),
    };
  },
  id,
});

export const donnybrookAwarenessPreset = ({
  volumes = [
    focusCone(),
    ovoidAwareness({
      band: 'warm',
      bandRank: 2,
      id: 'peripheral',
      priority: 0.6,
      radii: [4.9, 2.4, 4.1],
    }),
    ovoidAwareness({
      band: 'cold',
      bandRank: 1,
      id: 'ambient',
      priority: 0.2,
      radii: [7.6, 3.2, 6.2],
    }),
  ],
}: {
  readonly volumes?: readonly AwarenessVolume[];
} = {}): InterestClassifier => awarenessVolumes(volumes);

export const createNetworkedPhysicsLab = (
  config: NetworkedPhysicsLabConfig,
): NetworkedPhysicsLab => {
  const runtime = config.topology.node.physics.create();
  const listeners = new Set<() => void>();
  const frameCache = new Map<NodeId, NetworkedLabFrame>();
  const state: MutableState = {
    authorityActors: runtime.actors(),
    epoch: `${config.seed}:0`,
    laneCounters: new Map(Object.keys(config.lanes).map((lane) => [
      lane,
      { delivered: 0, dropped: 0, sent: 0 },
    ])),
    lastInterestByRecipient: new Map(),
    paused: false,
    predictedActors: new Map(),
    queue: [],
    replicas: new Map(config.topology.viewerNodeIds.map((nodeId) => [nodeId, new Map()])),
    selectedActorId: undefined,
    seed: config.seed,
    sequenceByLane: new Map(),
    tick: 0,
    trace: [{ at: 0, event: 'reset', seed: config.seed }],
    viewNodeId: config.topology.viewerNodeIds[0] ?? config.topology.authorityNodeId,
  };

  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  const clearFrameCache = (): void => {
    frameCache.clear();
  };
  const cachedFrame = (nodeId = state.viewNodeId): NetworkedLabFrame => {
    const existing = frameCache.get(nodeId);
    if (existing !== undefined) return existing;
    const next = frameFor(config, state, nodeId);
    frameCache.set(nodeId, next);
    return next;
  };
  const step = (ticks = 1): NetworkedLabFrame => {
    const count = Math.max(1, Math.floor(ticks));
    clearFrameCache();
    for (let index = 0; index < count; index += 1) {
      state.tick += 1;
      state.authorityActors = runtime.step({ tick: state.tick });
      updatePredictions(config, state, runtime);
      evaluateRecipients(config, state);
      deliverReadyPackets(config, state);
    }
    const nextFrame = cachedFrame(state.viewNodeId);
    notify();
    return nextFrame;
  };

  const frame = (nodeId = state.viewNodeId): NetworkedLabFrame => cachedFrame(nodeId);

  return {
    frame,
    isPaused: () => state.paused,
    pause: () => {
      state.paused = true;
      notify();
    },
    reset: (seed = config.seed) => {
      runtime.reset();
      state.authorityActors = runtime.actors();
      state.epoch = `${seed}:0`;
      state.lastInterestByRecipient.clear();
      state.paused = false;
      state.predictedActors = new Map();
      state.queue = [];
      state.replicas = new Map(config.topology.viewerNodeIds.map((nodeId) => [nodeId, new Map()]));
      state.seed = seed;
      state.sequenceByLane.clear();
      state.tick = 0;
      state.trace = [{ at: 0, event: 'reset', seed }];
      for (const counters of state.laneCounters.values()) {
        counters.delivered = 0;
        counters.dropped = 0;
        counters.sent = 0;
      }
      clearFrameCache();
      const nextFrame = frame();
      notify();
      return nextFrame;
    },
    resume: () => {
      state.paused = false;
      notify();
    },
    selectActor: (actorId) => {
      state.selectedActorId = actorId;
      clearFrameCache();
      notify();
    },
    setViewNode: (nodeId) => {
      state.viewNodeId = nodeId;
      clearFrameCache();
      notify();
    },
    step,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    trace: () => state.trace,
  };
};

const evaluateRecipients = (
  config: NetworkedPhysicsLabConfig,
  state: MutableState,
): void => {
  for (const recipientId of config.topology.viewerNodeIds) {
    const interestFrame = interestFrameForRecipient(config, state, recipientId);
    state.lastInterestByRecipient.set(recipientId, interestFrame);

    for (const decision of interestFrame.decisions) {
      if (!decision.admitted || decision.cadenceTicks <= 0) continue;
      if (state.tick % decision.cadenceTicks !== 0) continue;
      const actor = state.authorityActors.find((entry) => entry.id === decision.actorId);
      if (actor === undefined) continue;

      for (const lane of decision.lanes) {
        enqueuePacket(config, state, {
          actor,
          decision: {
            ...decision,
            replicatedThisTick: true,
          },
          kind: 'actor-state',
        }, recipientId, lane);
      }
    }
  }
};

const updatePredictions = (
  config: NetworkedPhysicsLabConfig,
  state: MutableState,
  runtime: PhysicsRuntime,
): void => {
  const prediction = config.topology.node.replica.prediction;
  if (prediction === undefined) return;

  for (const nodeId of config.topology.viewerNodeIds) {
    const predictedActors = new Map<ActorId, RuntimeActor>();
    for (const actor of prediction.actors({ actors: state.authorityActors, nodeId })) {
      const predictedActor = runtime.predict?.({
        actorId: actor.id,
        leadTicks: prediction.leadTicks,
        tick: state.tick,
      }) ?? actor;
      predictedActors.set(actor.id, predictedActor);
    }
    state.predictedActors.set(nodeId, predictedActors);
  }
};

const interestFrameForRecipient = (
  config: NetworkedPhysicsLabConfig,
  state: MutableState,
  recipientId: NodeId,
): InterestFrame => {
  const node = config.topology.node;
  const observer = node.interest.observer({
    actors: state.authorityActors,
    nodeId: recipientId,
  });
  if (observer === undefined) {
    return emptyInterestFrame(recipientId);
  }
  const classified = node.interest.classify.classify({
    actors: state.authorityActors,
    observer,
    recipientId,
    tick: state.tick,
  });
  const decisions = scheduleDecisions({
    candidates: classified.candidates,
    node,
    previous: state.lastInterestByRecipient.get(recipientId),
    tick: state.tick,
  });

  return {
    decisions,
    observerActorId: observer.id,
    recipientId,
    summary: summarizeInterest(decisions),
    volumes: classified.volumes,
  };
};

const emptyInterestFrame = (recipientId: NodeId): InterestFrame => ({
  decisions: [],
  observerActorId: undefined,
  recipientId,
  summary: {
    admittedByBand: {},
    budgetRejected: 0,
    replicatedThisTick: 0,
    totalActors: 0,
    wantedByBand: {},
  },
  volumes: [],
});

const scheduleDecisions = ({
  candidates,
  node,
  previous,
  tick,
}: {
  readonly candidates: readonly InterestCandidate[];
  readonly node: NetworkedPhysicsNodeDefinition;
  readonly previous: InterestFrame | undefined;
  readonly tick: number;
}): readonly InterestDecision[] => {
  const byBand = new Map<BandId, InterestCandidate[]>();
  for (const candidate of candidates) {
    byBand.set(candidate.band, [...(byBand.get(candidate.band) ?? []), candidate]);
  }

  const admittedIds = new Set<ActorId>();
  const candidatesById = new Map(candidates.map((candidate) => [candidate.actorId, candidate]));
  const previousById = new Map(previous?.decisions.map((decision) => [decision.actorId, decision]) ?? []);
  for (const [band, bandCandidates] of byBand) {
    const limit = node.interest.admit.maxByBand[band] ?? Number.POSITIVE_INFINITY;
    const sorted = [...bandCandidates].sort((a, b) =>
      compareCandidates(a, b, node.interest.admit.tieBreakers, previousById)
    );
    for (const candidate of sorted.slice(0, limit)) {
      admittedIds.add(candidate.actorId);
    }
  }

  return [...candidatesById.values()]
    .sort((a, b) => a.actorId.localeCompare(b.actorId))
    .map((candidate) => {
      const admitted = admittedIds.has(candidate.actorId);
      const band = admitted ? candidate.band : dormantBand;
      const schedule = node.interest.schedule.bands[band] ?? {
        cadenceTicks: 0,
        lanes: [],
      };
      const proxy = node.replica.proxyByBand[band] ?? 'none';
      const replicatedThisTick = admitted &&
        schedule.cadenceTicks > 0 &&
        tick % schedule.cadenceTicks === 0;

      return {
        ...candidate,
        admitted,
        band,
        cadenceTicks: schedule.cadenceTicks,
        lanes: schedule.lanes,
        proxy,
        reason: admitted ? candidate.reason : `${candidate.reason}:budget-overflow`,
        replicatedThisTick,
        wantedBand: candidate.band,
      };
    });
};

const compareCandidates = (
  a: InterestCandidate,
  b: InterestCandidate,
  tieBreakers: readonly TieBreaker[],
  previousById: ReadonlyMap<ActorId, InterestDecision>,
): number => {
  for (const tieBreaker of tieBreakers) {
    const result = compareTieBreaker(a, b, tieBreaker, previousById);
    if (result !== 0) return result;
  }
  return a.actorId.localeCompare(b.actorId);
};

const compareTieBreaker = (
  a: InterestCandidate,
  b: InterestCandidate,
  tieBreaker: TieBreaker,
  previousById: ReadonlyMap<ActorId, InterestDecision>,
): number => {
  switch (tieBreaker) {
    case 'actorId':
      return a.actorId.localeCompare(b.actorId);
    case 'bandRank':
      return b.bandRank - a.bandRank;
    case 'lastSeenTick':
      return Number(previousById.has(b.actorId)) - Number(previousById.has(a.actorId));
    case 'priority':
      return b.priority - a.priority;
    case 'score':
      return b.score - a.score;
  }
};

const summarizeInterest = (
  decisions: readonly InterestDecision[],
): InterestSummary => {
  const admittedByBand: Record<BandId, number> = {};
  const wantedByBand: Record<BandId, number> = {};
  let budgetRejected = 0;
  let replicatedThisTick = 0;

  for (const decision of decisions) {
    wantedByBand[decision.wantedBand] = (wantedByBand[decision.wantedBand] ?? 0) + 1;
    admittedByBand[decision.band] = (admittedByBand[decision.band] ?? 0) + 1;
    if (!decision.admitted) budgetRejected += 1;
    if (decision.replicatedThisTick) replicatedThisTick += 1;
  }

  return {
    admittedByBand,
    budgetRejected,
    replicatedThisTick,
    totalActors: decisions.length,
    wantedByBand,
  };
};

const enqueuePacket = (
  config: NetworkedPhysicsLabConfig,
  state: MutableState,
  payload: PacketPayload,
  recipientId: NodeId,
  lane: NetworkLaneId,
): void => {
  const sequence = state.sequenceByLane.get(lane) ?? 0;
  state.sequenceByLane.set(lane, sequence + 1);
  const counters = requireLaneCounters(state, lane);
  counters.sent += 1;
  const laneConfig = config.transport.lanes[lane] ?? {};

  if (shouldDrop(sequence, laneConfig.lossEvery ?? 0)) {
    counters.dropped += 1;
    pushTrace(config, state, {
      actorId: payload.actor.id,
      at: state.tick,
      event: 'dropped',
      lane,
      recipientId,
      sequence,
    });
    return;
  }

  const latencyTicks = laneConfig.latencyTicks ?? 0;
  const deliverAtTick = Math.max(
    state.tick,
    state.tick + latencyTicks + jitterFor(sequence, laneConfig.jitterTicks ?? 0),
  );
  state.queue.push({
    deliverAtTick,
    lane,
    payload,
    recipientId,
    sequence,
  });
  pushTrace(config, state, {
    actorId: payload.actor.id,
    at: state.tick,
    event: 'queued',
    lane,
    recipientId,
    sequence,
  });
};

const deliverReadyPackets = (
  config: NetworkedPhysicsLabConfig,
  state: MutableState,
): void => {
  const ready = state.queue
    .filter((packet) => packet.deliverAtTick <= state.tick)
    .sort((a, b) => a.deliverAtTick - b.deliverAtTick || a.sequence - b.sequence);
  state.queue = state.queue.filter((packet) => packet.deliverAtTick > state.tick);

  for (const packet of ready) {
    const replica = state.replicas.get(packet.recipientId);
    if (replica === undefined) continue;
    const previous = replica.get(packet.payload.actor.id);
    const lane = config.lanes[packet.lane];
    if (lane?.ordering === 'newest' && previous !== undefined && previous.lastUpdateTick > packet.deliverAtTick) {
      continue;
    }
    replica.set(packet.payload.actor.id, {
      decision: packet.payload.decision,
      forward: packet.payload.actor.forward,
      lastUpdateTick: state.tick,
      position: packet.payload.actor.position,
      scale: packet.payload.actor.scale,
    });
    requireLaneCounters(state, packet.lane).delivered += 1;
    pushTrace(config, state, {
      actorId: packet.payload.actor.id,
      at: state.tick,
      event: 'delivered',
      lane: packet.lane,
      recipientId: packet.recipientId,
      sequence: packet.sequence,
    });
  }
};

const frameFor = (
  config: NetworkedPhysicsLabConfig,
  state: MutableState,
  viewNodeId: NodeId,
): NetworkedLabFrame => {
  const interest = state.lastInterestByRecipient.get(viewNodeId) ?? interestFrameForRecipient(config, state, viewNodeId);
  const replica = state.replicas.get(viewNodeId) ?? new Map<ActorId, ReplicaActorState>();
  const predictedActors = state.predictedActors.get(viewNodeId) ?? new Map<ActorId, RuntimeActor>();
  const predictionLeadTicks = config.topology.node.replica.prediction?.leadTicks ?? 0;
  const decisionById = new Map(interest.decisions.map((decision) => [decision.actorId, decision]));
  const source = sourceCursor(config, state);
  const actors = state.authorityActors.map((actor) => {
    const isOwned = actor.ownerNodeId === viewNodeId;
    const replicaActor = replica.get(actor.id);
    const predictedActor = predictedActors.get(actor.id);
    const decision = decisionById.get(actor.id) ?? replicaActor?.decision ?? localDecision(actor, isOwned);
    const position = isOwned ? predictedActor?.position ?? actor.position : replicaActor?.position ?? actor.position;
    const forward = isOwned ? predictedActor?.forward ?? actor.forward : replicaActor?.forward ?? actor.forward;
    const scale = isOwned ? predictedActor?.scale ?? actor.scale : replicaActor?.scale ?? actor.scale;

    return {
      actorId: actor.id,
      admitted: decision.admitted,
      authorityForward: actor.forward,
      authorityPosition: actor.position,
      authorityScale: actor.scale,
      band: isOwned ? 'local' : decision.band,
      cadenceTicks: decision.cadenceTicks,
      forward,
      lanes: decision.lanes,
      ownerNodeId: actor.ownerNodeId,
      position,
      priority: decision.priority,
      proxy: isOwned ? 'blocking' : decision.proxy,
      reason: isOwned ? 'owned-by-view-node' : decision.reason,
      replicatedThisTick: decision.replicatedThisTick,
      scale,
      score: decision.score,
      predictionLeadTicks: isOwned ? predictionLeadTicks : 0,
      staleTicks: isOwned ? 0 : Math.max(0, state.tick - (replicaActor?.lastUpdateTick ?? 0)),
      volumeId: decision.volumeId,
      wantedBand: isOwned ? 'local' : decision.wantedBand,
    } satisfies ActorRenderState;
  });

  return {
    interest,
    network: {
      lanes: Object.entries(config.lanes).map(([id, lane]) => {
        const counters = requireLaneCounters(state, id);
        return {
          id,
          ...lane,
          delivered: counters.delivered,
          dropped: counters.dropped,
          queued: state.queue.filter((packet) => packet.lane === id).length,
          sent: counters.sent,
        };
      }),
      topology: config.topology.kind,
    },
    render: {
      actors,
      awarenessVolumes: interest.volumes,
      source,
      tick: state.tick,
    },
    selectedActorId: state.selectedActorId,
    source,
    tick: state.tick,
    viewNodeId,
  };
};

const localDecision = (
  actor: RuntimeActor,
  isOwned: boolean,
): InterestDecision => ({
  actorId: actor.id,
  admitted: true,
  band: isOwned ? 'local' : dormantBand,
  bandRank: isOwned ? 4 : 0,
  cadenceTicks: isOwned ? 1 : 0,
  lanes: isOwned ? ['local'] : [],
  priority: actor.priority,
  proxy: isOwned ? 'blocking' : 'none',
  reason: isOwned ? 'owned-by-view-node' : 'unclassified',
  replicatedThisTick: false,
  score: actor.priority,
  volumeId: undefined,
  wantedBand: isOwned ? 'local' : dormantBand,
});

const sourceCursor = (
  config: NetworkedPhysicsLabConfig,
  state: MutableState,
): SourceCursor => ({
  authorityId: config.topology.authorityNodeId,
  cursor: `${state.epoch}:${state.tick}`,
  epoch: state.epoch,
});

const requireLaneCounters = (
  state: MutableState,
  lane: NetworkLaneId,
): LaneCounters => {
  const counters = state.laneCounters.get(lane);
  if (counters !== undefined) return counters;
  const created = { delivered: 0, dropped: 0, sent: 0 };
  state.laneCounters.set(lane, created);
  return created;
};

const pushTrace = (
  config: NetworkedPhysicsLabConfig,
  state: MutableState,
  row: NetworkTraceRow,
): void => {
  state.trace = [...state.trace, row].slice(-(config.traceLimit ?? 600));
};

const bestCandidate = (
  matches: readonly InterestCandidate[],
): readonly InterestCandidate[] => {
  if (matches.length === 0) return [];
  const sorted = [...matches].sort((a, b) =>
    b.bandRank - a.bandRank ||
    b.priority - a.priority ||
    b.score - a.score ||
    a.actorId.localeCompare(b.actorId)
  );
  return [sorted[0] as InterestCandidate];
};

const shouldDrop = (sequence: number, lossEvery: number): boolean =>
  lossEvery > 0 && sequence > 0 && sequence % lossEvery === 0;

const jitterFor = (sequence: number, jitterTicks: number): number => {
  if (jitterTicks <= 0) return 0;
  const range = jitterTicks * 2 + 1;
  return (sequence * 17) % range - jitterTicks;
};

const triangleWave = (
  tick: number,
  periodTicks: number,
  offsetTicks: number,
): number => {
  const period = Math.max(1, periodTicks);
  const phase = ((tick + offsetTicks) % period) / period;
  return phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4;
};

const localAwarenessPosition = (
  observer: RuntimeActor,
  position: Vec3,
): Vec3 => {
  const delta = subtractVec3(position, observer.position);
  const forward = normalizeHorizontal(observer.forward);
  const right: Vec3 = [forward[2], 0, -forward[0]];

  return [
    dotHorizontal(delta, right),
    delta[1],
    dotHorizontal(delta, forward),
  ];
};

export const addVec3 = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

export const subtractVec3 = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];

export const scaleVec3 = (value: Vec3, scale: number): Vec3 => [
  value[0] * scale,
  value[1] * scale,
  value[2] * scale,
];

export const horizontalLength = (value: Vec3): number =>
  Math.hypot(value[0], value[2]);

export const normalizeHorizontal = (value: Vec3): Vec3 => {
  const length = horizontalLength(value);
  if (length <= 0.0001) return [1, 0, 0];
  return [value[0] / length, 0, value[2] / length];
};

export const dotHorizontal = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[2] * b[2];

export const yawFromForward = (forward: Vec3): number =>
  -Math.atan2(forward[2], forward[0]);

export const selectRenderScene = (frame: NetworkedLabFrame): RenderFrame => frame.render;
export const selectInterestSummary = (frame: NetworkedLabFrame): InterestSummary => frame.interest.summary;
export const selectSelectedActorDecision = (
  frame: NetworkedLabFrame,
): ActorRenderState | undefined =>
  frame.render.actors.find((actor) => actor.actorId === frame.selectedActorId) ??
  frame.render.actors.find((actor) => actor.band === 'hot') ??
  frame.render.actors[0];
