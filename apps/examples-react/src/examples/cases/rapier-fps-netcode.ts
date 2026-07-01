import type { Vec3 } from './rapier-runtime';
import {
  clamp,
  horizontalDistanceVec3,
  lerpVec3,
  scaleVec3,
  vec3AtDistance,
} from './rapier-vector';

export type SnapshotBody<Id extends string = string> = {
  readonly id: Id;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
};

export type SnapshotFrame<Body extends SnapshotBody<string> = SnapshotBody> = {
  readonly bodies: readonly Body[];
  readonly lastProcessedInputTick: number;
  readonly serverTick: number;
};

export type RemoteInterpolationState<Body extends SnapshotBody<string>> = {
  readonly bodies: readonly Body[];
  readonly targetServerTick: number;
  readonly underflow: boolean;
};

export type HitscanBox<Id extends string> = {
  readonly id: Id;
  readonly kind: 'dynamic' | 'static';
  readonly position: Vec3;
  readonly scale: Vec3;
};

export type HitscanRayResult<Id extends string> = {
  readonly hit: boolean;
  readonly hitDistance: number;
  readonly hitId: Id | 'none';
  readonly hitKind: 'dynamic' | 'miss' | 'static';
  readonly hitPosition: Vec3;
};

export type InterestBand = 'cold' | 'dormant' | 'hot' | 'warm';
export type InterestCadence = 'every-frame' | 'fast' | 'idle' | 'slow';
export type InterestClientProxyMode = 'blocking' | 'ghost' | 'none';
export type InterestLane = 'animation' | 'combat' | 'full-state' | 'transform';

export type InterestStage = {
  readonly band: InterestBand;
  readonly cadence: InterestCadence;
  readonly clientProxy: InterestClientProxyMode;
  readonly lanes: readonly InterestLane[];
  readonly maxDistance: number;
  readonly priority: number;
  readonly replicated: boolean;
  readonly hysteresis?: {
    readonly exitDistance: number;
    readonly graceTicks: number;
  };
};

export type InterestPolicy<PolicyId extends string> = {
  readonly fallback: InterestStage;
  readonly id: PolicyId;
  readonly stages: readonly InterestStage[];
};

export type InterestPolicyTable<PolicyId extends string> = Readonly<
  Record<PolicyId, InterestPolicy<PolicyId>>
>;

export type InterestActor<Id extends string, PolicyId extends string> = {
  readonly id: Id;
  readonly interestPolicy: PolicyId;
  readonly position: Vec3;
};

export type InterestEvaluationInput<Id extends string, PolicyId extends string> = {
  readonly actors: readonly InterestActor<Id, PolicyId>[];
  readonly observer: Vec3;
};

export type InterestState<Id extends string, PolicyId extends string> = {
  readonly band: InterestBand;
  readonly cadence: InterestCadence;
  readonly clientProxy: InterestClientProxyMode;
  readonly distance: number;
  readonly id: Id;
  readonly interestPolicy: PolicyId;
  readonly lanes: readonly InterestLane[];
  readonly priority: number;
  readonly reason: string;
  readonly replicated: boolean;
};

export type InterestActorMemory<PolicyId extends string> = {
  readonly band: InterestBand;
  readonly exitGraceTicks: number;
  readonly interestPolicy: PolicyId;
};

export type InterestTrackerState<Id extends string, PolicyId extends string> = {
  readonly actors: ReadonlyMap<Id, InterestActorMemory<PolicyId>>;
};

export type InterestTrackerUpdate<Id extends string, PolicyId extends string> = {
  readonly decisions: readonly InterestState<Id, PolicyId>[];
  readonly state: InterestTrackerState<Id, PolicyId>;
};

export type InterestTracker<Id extends string, PolicyId extends string> = {
  readonly commit: (
    input: InterestEvaluationInput<Id, PolicyId>,
  ) => InterestTrackerUpdate<Id, PolicyId>;
  readonly evaluate: (
    input: InterestEvaluationInput<Id, PolicyId>,
  ) => InterestTrackerUpdate<Id, PolicyId>;
  readonly reset: (state?: InterestTrackerState<Id, PolicyId>) => void;
  readonly state: () => InterestTrackerState<Id, PolicyId>;
};

export type InterestSummary = Record<InterestBand, number> & {
  readonly dormantActors: number;
  readonly replicatedActors: number;
  readonly totalActors: number;
};

const interestBandRank = {
  dormant: 0,
  cold: 1,
  warm: 2,
  hot: 3,
} satisfies Record<InterestBand, number>;

const strongerInterestBand = (
  a: InterestBand,
  b: InterestBand,
): InterestBand => interestBandRank[a] >= interestBandRank[b] ? a : b;

export const recordSnapshotFrame = <Frame>(
  frames: readonly Frame[],
  frame: Frame,
  limit: number,
): Frame[] => [
  ...frames,
  frame,
].slice(-limit);

export const frameBody = <
  Body extends SnapshotBody<string>,
  Id extends Body['id'],
>(
  frame: SnapshotFrame<Body>,
  id: Id,
): Body | undefined => frame.bodies.find((body) => body.id === id);

export const requireFrameBody = <
  Body extends SnapshotBody<string>,
  Id extends Body['id'],
>(
  frame: SnapshotFrame<Body>,
  id: Id,
): Body => {
  const body = frameBody(frame, id);
  if (body === undefined) throw new Error(`Missing snapshot body: ${id}`);
  return body;
};

export const selectRewindFrame = <Body extends SnapshotBody<string>>(
  frames: readonly SnapshotFrame<Body>[],
  clientTick: number,
  fallback: SnapshotFrame<Body>,
): SnapshotFrame<Body> => {
  let candidate = frames[0] ?? fallback;

  for (const frame of frames) {
    if (frame.serverTick > clientTick) break;
    candidate = frame;
  }

  return candidate;
};

export const evaluateInterestPolicies = <
  Id extends string,
  PolicyId extends string,
>({
  actors,
  observer,
  policies,
}: {
  readonly actors: readonly InterestActor<Id, PolicyId>[];
  readonly observer: Vec3;
  readonly policies: InterestPolicyTable<PolicyId>;
}): readonly InterestState<Id, PolicyId>[] =>
  actors.map((actor) => {
    const policy = policies[actor.interestPolicy];
    if (policy === undefined) {
      throw new Error(`Missing interest policy: ${actor.interestPolicy}`);
    }
    const distance = horizontalDistanceVec3(observer, actor.position);
    const stage = interestStageForDistance(policy, distance);

    return interestDecision({
      actor,
      distance,
      reason: interestStageReason(actor.interestPolicy, stage),
      stage,
    });
  });

const interestStageForBand = <PolicyId extends string>(
  policy: InterestPolicy<PolicyId>,
  band: InterestBand,
): InterestStage | undefined =>
  policy.stages.find((stage) => stage.band === band) ??
  (policy.fallback.band === band ? policy.fallback : undefined);

const interestStageForDistance = <PolicyId extends string>(
  policy: InterestPolicy<PolicyId>,
  distance: number,
): InterestStage => {
  let stage: InterestStage | undefined;

  for (const candidate of policy.stages) {
    if (distance > candidate.maxDistance) continue;
    if (stage === undefined || candidate.maxDistance < stage.maxDistance) {
      stage = candidate;
    }
  }

  return stage ?? policy.fallback;
};

const interestStageReason = (
  policyId: string,
  stage: InterestStage,
): string => `${policyId}:${stage.band}:distance<=${stage.maxDistance}`;

const interestDecision = <
  Id extends string,
  PolicyId extends string,
>({
  actor,
  distance,
  reason,
  stage,
}: {
  readonly actor: InterestActor<Id, PolicyId>;
  readonly distance: number;
  readonly reason: string;
  readonly stage: InterestStage;
}): InterestState<Id, PolicyId> => ({
  band: stage.band,
  cadence: stage.cadence,
  clientProxy: stage.clientProxy,
  distance,
  id: actor.id,
  interestPolicy: actor.interestPolicy,
  lanes: stage.lanes,
  priority: stage.priority,
  reason,
  replicated: stage.replicated,
});

export const emptyInterestTrackerState = <
  Id extends string,
  PolicyId extends string,
>(): InterestTrackerState<Id, PolicyId> => ({
  actors: new Map(),
});

const cloneInterestTrackerState = <
  Id extends string,
  PolicyId extends string,
>(
  state: InterestTrackerState<Id, PolicyId>,
): InterestTrackerState<Id, PolicyId> => ({
  actors: new Map([...state.actors].map(([id, memory]) => [id, { ...memory }])),
});

export const updateInterestTracker = <
  Id extends string,
  PolicyId extends string,
>({
  actors,
  observer,
  policies,
  previous,
}: {
  readonly actors: readonly InterestActor<Id, PolicyId>[];
  readonly observer: Vec3;
  readonly policies: InterestPolicyTable<PolicyId>;
  readonly previous: InterestTrackerState<Id, PolicyId>;
}): InterestTrackerUpdate<Id, PolicyId> => {
  const nextActors = new Map<Id, InterestActorMemory<PolicyId>>();
  const decisions = actors.map((actor) => {
    const policy = policies[actor.interestPolicy];
    if (policy === undefined) {
      throw new Error(`Missing interest policy: ${actor.interestPolicy}`);
    }

    const distance = horizontalDistanceVec3(observer, actor.position);
    const rawStage = interestStageForDistance(policy, distance);
    const memory = previous.actors.get(actor.id);
    const heldStage = memory?.interestPolicy === actor.interestPolicy
      ? interestStageForBand(policy, strongerInterestBand(memory.band, rawStage.band))
      : undefined;
    const downgrade = heldStage !== undefined &&
      interestBandRank[heldStage.band] > interestBandRank[rawStage.band];
    const hysteresis = downgrade ? heldStage.hysteresis : undefined;

    if (hysteresis !== undefined) {
      const outsideExitDistance = distance > hysteresis.exitDistance;
      const exitGraceTicks = outsideExitDistance
        ? (memory?.exitGraceTicks ?? 0) + 1
        : 0;

      if (exitGraceTicks <= hysteresis.graceTicks) {
        nextActors.set(actor.id, {
          band: heldStage.band,
          exitGraceTicks,
          interestPolicy: actor.interestPolicy,
        });

        return interestDecision({
          actor,
          distance,
          reason: [
            actor.interestPolicy,
            heldStage.band,
            `held-by-hysteresis:${exitGraceTicks}/${hysteresis.graceTicks}`,
          ].join(':'),
          stage: heldStage,
        });
      }
    }

    nextActors.set(actor.id, {
      band: rawStage.band,
      exitGraceTicks: 0,
      interestPolicy: actor.interestPolicy,
    });

    return interestDecision({
      actor,
      distance,
      reason: interestStageReason(actor.interestPolicy, rawStage),
      stage: rawStage,
    });
  });

  return {
    decisions,
    state: { actors: nextActors },
  };
};

export const createInterestTracker = <
  Id extends string,
  PolicyId extends string,
>({
  initialState,
  policies,
}: {
  readonly initialState?: InterestTrackerState<Id, PolicyId>;
  readonly policies: InterestPolicyTable<PolicyId>;
}): InterestTracker<Id, PolicyId> => {
  let currentState = initialState === undefined
    ? emptyInterestTrackerState<Id, PolicyId>()
    : cloneInterestTrackerState(initialState);

  const evaluate = (
    input: InterestEvaluationInput<Id, PolicyId>,
  ): InterestTrackerUpdate<Id, PolicyId> => updateInterestTracker({
    ...input,
    policies,
    previous: currentState,
  });

  return {
    commit: (input) => {
      const update = evaluate(input);
      currentState = update.state;
      return {
        decisions: update.decisions,
        state: cloneInterestTrackerState(update.state),
      };
    },
    evaluate,
    reset: (state) => {
      currentState = state === undefined
        ? emptyInterestTrackerState<Id, PolicyId>()
        : cloneInterestTrackerState(state);
    },
    state: () => cloneInterestTrackerState(currentState),
  };
};

export const summarizeInterest = (
  interest: readonly InterestState<string, string>[],
): InterestSummary => {
  const summary = {
    cold: 0,
    dormant: 0,
    dormantActors: 0,
    hot: 0,
    replicatedActors: 0,
    totalActors: interest.length,
    warm: 0,
  } satisfies InterestSummary;

  for (const actor of interest) {
    summary[actor.band] += 1;
    if (actor.replicated) {
      summary.replicatedActors += 1;
    } else {
      summary.dormantActors += 1;
    }
  }

  return summary;
};

export const remoteInterpolationTargetServerTick = (
  lastReceivedServerTick: number,
  delayTicks: number,
): number => Math.max(0, lastReceivedServerTick - delayTicks);

const interpolateSnapshotBody = <Id extends string>(
  before: SnapshotBody<Id>,
  after: SnapshotBody<Id>,
  t: number,
): SnapshotBody<Id> => ({
  id: before.id,
  position: lerpVec3(before.position, after.position, t),
  rotation: lerpVec3(before.rotation, after.rotation, t),
  scale: before.scale,
});

export const interpolateSnapshotBodies = <
  Body extends SnapshotBody<string>,
  Id extends Body['id'],
>({
  bodyIds,
  delayTicks,
  frames,
  lastReceivedServerTick,
  latestFrame,
}: {
  readonly bodyIds: readonly Id[];
  readonly delayTicks: number;
  readonly frames: readonly SnapshotFrame<Body>[];
  readonly lastReceivedServerTick: number;
  readonly latestFrame: SnapshotFrame<Body>;
}): RemoteInterpolationState<Body> => {
  const targetTick = remoteInterpolationTargetServerTick(lastReceivedServerTick, delayTicks);
  const fallback = (): RemoteInterpolationState<Body> => ({
    bodies: bodyIds.map((id) => requireFrameBody(latestFrame, id)),
    targetServerTick: targetTick,
    underflow: true,
  });

  if (frames.length < 2) return fallback();

  let before = frames[0];
  let after = frames[frames.length - 1];

  for (let index = 0; index < frames.length - 1; index += 1) {
    const current = frames[index];
    const next = frames[index + 1];
    if (current === undefined || next === undefined) continue;

    if (current.serverTick <= targetTick && next.serverTick >= targetTick) {
      before = current;
      after = next;
      break;
    }
  }

  if (before === undefined || after === undefined) return fallback();
  if (targetTick < before.serverTick || targetTick > after.serverTick) return fallback();

  const span = Math.max(1, after.serverTick - before.serverTick);
  const t = clamp((targetTick - before.serverTick) / span, 0, 1);

  return {
    bodies: bodyIds.map((id) =>
      interpolateSnapshotBody(requireFrameBody(before, id), requireFrameBody(after, id), t) as Body
    ),
    targetServerTick: targetTick,
    underflow: false,
  };
};

const rayAabbDistance = ({
  center,
  direction,
  halfExtents,
  maxDistance,
  origin,
}: {
  readonly center: Vec3;
  readonly direction: Vec3;
  readonly halfExtents: Vec3;
  readonly maxDistance: number;
  readonly origin: Vec3;
}): number | undefined => {
  let tMin = 0;
  let tMax = maxDistance;

  for (const axis of [0, 1, 2] as const) {
    const min = center[axis] - halfExtents[axis];
    const max = center[axis] + halfExtents[axis];
    const component = direction[axis];

    if (Math.abs(component) <= 0.000_001) {
      if (origin[axis] < min || origin[axis] > max) return undefined;
      continue;
    }

    const inverse = 1 / component;
    const a = (min - origin[axis]) * inverse;
    const b = (max - origin[axis]) * inverse;
    const near = Math.min(a, b);
    const far = Math.max(a, b);
    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);

    if (tMin > tMax) return undefined;
  }

  return tMin <= maxDistance ? tMin : undefined;
};

export const castHitscanRay = <Id extends string>({
  boxes,
  direction,
  maxDistance,
  origin,
}: {
  readonly boxes: readonly HitscanBox<Id>[];
  readonly direction: Vec3;
  readonly maxDistance: number;
  readonly origin: Vec3;
}): HitscanRayResult<Id> => {
  let hitDistance = maxDistance;
  let hitId: Id | 'none' = 'none';
  let hitKind: HitscanRayResult<Id>['hitKind'] = 'miss';

  for (const box of boxes) {
    const distance = rayAabbDistance({
      center: box.position,
      direction,
      halfExtents: scaleVec3(box.scale, 0.5),
      maxDistance: hitDistance,
      origin,
    });

    if (distance !== undefined && distance < hitDistance) {
      hitDistance = distance;
      hitId = box.id;
      hitKind = box.kind;
    }
  }

  return {
    hit: hitId !== 'none',
    hitDistance,
    hitId,
    hitKind,
    hitPosition: vec3AtDistance(origin, direction, hitDistance),
  };
};
