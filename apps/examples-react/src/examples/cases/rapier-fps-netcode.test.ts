import { describe, expect, it } from 'vitest';
import {
  createInterestTracker,
  emptyInterestTrackerState,
  evaluateInterestPolicies,
  updateInterestTracker,
  type InterestActor,
  type InterestPolicyTable,
  type InterestState,
  type InterestTrackerState,
} from './rapier-fps-netcode';
import type { Vec3 } from './rapier-runtime';

type ActorId = 'remote';
type PolicyId = 'avatar';
type WritableActorMemory = {
  band: 'cold' | 'dormant' | 'hot' | 'warm';
  exitGraceTicks: number;
  interestPolicy: PolicyId;
};

const observer = [0, 0, 0] satisfies Vec3;
const policies = {
  avatar: {
    fallback: {
      band: 'dormant',
      cadence: 'idle',
      clientProxy: 'none',
      lanes: [],
      maxDistance: Infinity,
      priority: 0,
      replicated: false,
    },
    id: 'avatar',
    stages: [
      {
        band: 'hot',
        cadence: 'every-frame',
        clientProxy: 'blocking',
        hysteresis: { exitDistance: 12, graceTicks: 2 },
        lanes: ['transform', 'combat'],
        maxDistance: 10,
        priority: 1,
        replicated: true,
      },
      {
        band: 'warm',
        cadence: 'fast',
        clientProxy: 'ghost',
        lanes: ['transform'],
        maxDistance: 20,
        priority: 0.5,
        replicated: true,
      },
    ],
  },
} as const satisfies InterestPolicyTable<PolicyId>;
const unorderedPolicies = {
  avatar: {
    ...policies.avatar,
    stages: [policies.avatar.stages[1], policies.avatar.stages[0]],
  },
} as const satisfies InterestPolicyTable<PolicyId>;

const actorsAt = (distance: number): readonly InterestActor<ActorId, PolicyId>[] => [
  {
    id: 'remote',
    interestPolicy: 'avatar',
    position: [distance, 0, 0],
  },
];

const firstDecision = <Id extends string, Policy extends string>(
  decisions: readonly InterestState<Id, Policy>[],
): InterestState<Id, Policy> => {
  const decision = decisions[0];
  if (decision === undefined) {
    throw new Error('Expected one interest decision');
  }

  return decision;
};

describe('rapier FPS interest policies', () => {
  it('evaluates stateless policy stages by distance', () => {
    expect(firstDecision(evaluateInterestPolicies({
      actors: actorsAt(5),
      observer,
      policies,
    }))).toMatchObject({
      band: 'hot',
      cadence: 'every-frame',
      clientProxy: 'blocking',
      lanes: ['transform', 'combat'],
      replicated: true,
    });

    expect(firstDecision(evaluateInterestPolicies({
      actors: actorsAt(25),
      observer,
      policies,
    }))).toMatchObject({
      band: 'dormant',
      clientProxy: 'none',
      replicated: false,
    });

    expect(firstDecision(evaluateInterestPolicies({
      actors: actorsAt(5),
      observer,
      policies: unorderedPolicies,
    }))).toMatchObject({
      band: 'hot',
      clientProxy: 'blocking',
    });
  });

  it('holds stronger stages during hysteresis before downgrading', () => {
    let state: InterestTrackerState<ActorId, PolicyId> = emptyInterestTrackerState();
    const commit = (distance: number) => {
      const update = updateInterestTracker({
        actors: actorsAt(distance),
        observer,
        policies,
        previous: state,
      });
      state = update.state;
      return firstDecision(update.decisions);
    };

    expect(commit(5)).toMatchObject({ band: 'hot', reason: 'avatar:hot:distance<=10' });
    expect(state.actors.get('remote')).toMatchObject({ band: 'hot', exitGraceTicks: 0 });

    expect(commit(12)).toMatchObject({
      band: 'hot',
      reason: 'avatar:hot:held-by-hysteresis:0/2',
    });
    expect(state.actors.get('remote')).toMatchObject({ band: 'hot', exitGraceTicks: 0 });

    expect(commit(13)).toMatchObject({
      band: 'hot',
      reason: 'avatar:hot:held-by-hysteresis:1/2',
    });
    expect(state.actors.get('remote')).toMatchObject({ band: 'hot', exitGraceTicks: 1 });

    expect(commit(13)).toMatchObject({
      band: 'hot',
      reason: 'avatar:hot:held-by-hysteresis:2/2',
    });
    expect(state.actors.get('remote')).toMatchObject({ band: 'hot', exitGraceTicks: 2 });

    expect(commit(13)).toMatchObject({ band: 'warm', reason: 'avatar:warm:distance<=20' });
    expect(state.actors.get('remote')).toMatchObject({ band: 'warm', exitGraceTicks: 0 });
  });

  it('keeps preview evaluation separate from committed tracker state', () => {
    const tracker = createInterestTracker<ActorId, PolicyId>({ policies });

    const committed = tracker.commit({
      actors: actorsAt(15),
      observer,
    });

    expect(firstDecision(committed.decisions)).toMatchObject({ band: 'warm' });
    const leakedMemory = committed.state.actors.get('remote') as WritableActorMemory | undefined;
    if (leakedMemory === undefined) {
      throw new Error('Expected committed tracker memory');
    }
    leakedMemory.band = 'hot';
    expect(tracker.state().actors.get('remote')).toMatchObject({ band: 'warm' });

    expect(firstDecision(tracker.evaluate({
      actors: actorsAt(5),
      observer,
    }).decisions)).toMatchObject({ band: 'hot' });
    expect(tracker.state().actors.get('remote')).toMatchObject({ band: 'warm' });

    expect(firstDecision(tracker.commit({
      actors: actorsAt(5),
      observer,
    }).decisions)).toMatchObject({ band: 'hot' });
    expect(tracker.state().actors.get('remote')).toMatchObject({ band: 'hot' });
  });
});
