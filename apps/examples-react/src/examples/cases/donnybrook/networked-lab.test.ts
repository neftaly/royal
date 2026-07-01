import { describe, expect, it } from 'vitest';
import {
  awarenessVolumes,
  budgetedAdmission,
  createNetworkedPhysicsLab,
  defineLanes,
  defineNetworkedPhysicsNode,
  fixedStep,
  focusCone,
  hostFrameTopology,
  interestPipeline,
  kinematicPhysics,
  laneScheduler,
  ownedByNode,
  ovoidAwareness,
  predicted,
  replicaView,
  simulatedTransport,
  viewpointOf,
  type ActorRecipe,
  type NetworkedPhysicsLab,
  type SimulatedLaneConfig,
} from './networked-lab';

const lanes = defineLanes({
  combat: { ordering: 'ordered', reliability: 'reliable' },
  transform: { ordering: 'newest', reliability: 'unreliable' },
});

const playerA = {
  forward: [1, 0, 0],
  id: 'player-a',
  ownerNodeId: 'peer-a',
  position: [0, 0.62, 0],
  priority: 1,
} satisfies ActorRecipe;

const playerB = {
  forward: [-1, 0, 0],
  id: 'player-b',
  ownerNodeId: 'peer-b',
  position: [10, 0.62, 0],
  priority: 1,
} satisfies ActorRecipe;

const createLab = ({
  actors,
  maxHot = 8,
  transport = { transform: { latencyTicks: 0 } },
  predictionLeadTicks,
}: {
  readonly actors: readonly ActorRecipe[];
  readonly maxHot?: number;
  readonly predictionLeadTicks?: number;
  readonly transport?: Readonly<Record<string, SimulatedLaneConfig>>;
}): NetworkedPhysicsLab => {
  const node = defineNetworkedPhysicsNode({
    interest: interestPipeline({
      admit: budgetedAdmission({
        maxByBand: { hot: maxHot },
        tieBreakers: ['bandRank', 'priority', 'score', 'lastSeenTick', 'actorId'],
      }),
      classify: awarenessVolumes([
        focusCone({
          halfAngle: Math.PI / 8,
          range: 4.25,
        }),
      ]),
      observer: viewpointOf(ownedByNode()),
      schedule: laneScheduler({
        bands: {
          dormant: { cadenceTicks: 0, lanes: [] },
          hot: { cadenceTicks: 1, lanes: ['transform'] },
        },
      }),
    }),
    physics: kinematicPhysics({ actors }),
    replica: replicaView({
      ...(predictionLeadTicks === undefined
        ? {}
        : { prediction: predicted({ actors: ownedByNode(), leadTicks: predictionLeadTicks }) }),
      proxyByBand: {
        dormant: 'none',
        hot: 'blocking',
      },
    }),
  });

  return createNetworkedPhysicsLab({
    clock: fixedStep({ hz: 60 }),
    lanes,
    seed: 'test-seed',
    topology: hostFrameTopology({
      authorityNodeId: 'host',
      node,
      viewerNodeIds: ['peer-a', 'peer-b'],
    }),
    transport: simulatedTransport({
      lanes: transport,
    }),
  });
};

describe('networked Donnybrook lab model', () => {
  it('evaluates awareness per recipient observer rather than globally', () => {
    const lab = createLab({
      actors: [
        playerA,
        playerB,
        {
          id: 'target-a',
          ownerNodeId: 'host',
          position: [3, 0.62, 0],
        },
        {
          id: 'target-b',
          ownerNodeId: 'host',
          position: [7, 0.62, 0],
        },
      ],
    });

    lab.step();

    const peerAHot = lab.frame('peer-a').interest.decisions
      .filter((decision) => decision.band === 'hot')
      .map((decision) => decision.actorId);
    const peerBHot = lab.frame('peer-b').interest.decisions
      .filter((decision) => decision.band === 'hot')
      .map((decision) => decision.actorId);

    expect(peerAHot).toEqual(['target-a']);
    expect(peerBHot).toEqual(['target-b']);
    expect(lab.frame('peer-a').source).toEqual({
      authorityId: 'host',
      cursor: 'test-seed:0:1',
      epoch: 'test-seed:0',
    });
  });

  it('uses the same observer-forward basis for ovoid interest decisions', () => {
    const node = defineNetworkedPhysicsNode({
      interest: interestPipeline({
        admit: budgetedAdmission({
          maxByBand: { warm: 4 },
          tieBreakers: ['bandRank', 'priority', 'score', 'lastSeenTick', 'actorId'],
        }),
        classify: awarenessVolumes([
          ovoidAwareness({
            band: 'warm',
            bandRank: 2,
            id: 'forward-ovoid',
            priority: 0.6,
            radii: [1, 1, 3],
          }),
        ]),
        observer: viewpointOf(ownedByNode()),
        schedule: laneScheduler({
          bands: {
            dormant: { cadenceTicks: 0, lanes: [] },
            warm: { cadenceTicks: 1, lanes: ['transform'] },
          },
        }),
      }),
      physics: kinematicPhysics({
        actors: [
          {
            ...playerA,
            forward: [0, 0, 1],
          },
          {
            id: 'inside-forward-ovoid',
            ownerNodeId: 'host',
            position: [0, 0.62, 2.7],
          },
          {
            id: 'outside-side-ovoid',
            ownerNodeId: 'host',
            position: [2.7, 0.62, 0],
          },
        ],
      }),
      replica: replicaView({
        proxyByBand: {
          dormant: 'none',
          warm: 'ghost',
        },
      }),
    });
    const ovoidLab = createNetworkedPhysicsLab({
      clock: fixedStep({ hz: 60 }),
      lanes,
      seed: 'ovoid-test',
      topology: hostFrameTopology({
        authorityNodeId: 'host',
        node,
        viewerNodeIds: ['peer-a'],
      }),
      transport: simulatedTransport({
        lanes: { transform: { latencyTicks: 0 } },
      }),
    });

    ovoidLab.step();
    const decisions = ovoidLab.frame('peer-a').interest.decisions;

    expect(decisions.find((decision) => decision.actorId === 'inside-forward-ovoid')).toMatchObject({
      band: 'warm',
      volumeId: 'forward-ovoid',
    });
    expect(decisions.find((decision) => decision.actorId === 'outside-side-ovoid')).toBeUndefined();
    expect(ovoidLab.frame('peer-a').interest.volumes[0]).toMatchObject({
      forward: [0, 0, 1],
      id: 'forward-ovoid',
      kind: 'ovoid',
      radii: [1, 1, 3],
    });
  });

  it('admits hot actors through deterministic budgeted priority', () => {
    const lab = createLab({
      actors: [
        playerA,
        {
          id: 'low-priority',
          ownerNodeId: 'host',
          position: [2.4, 0.62, 0.2],
          priority: 0.2,
        },
        {
          id: 'high-priority',
          ownerNodeId: 'host',
          position: [2.8, 0.62, -0.1],
          priority: 0.95,
        },
      ],
      maxHot: 1,
    });

    lab.step();
    const frame = lab.frame('peer-a');
    const high = frame.interest.decisions.find((decision) => decision.actorId === 'high-priority');
    const low = frame.interest.decisions.find((decision) => decision.actorId === 'low-priority');

    expect(high?.admitted).toBe(true);
    expect(high?.band).toBe('hot');
    expect(low?.admitted).toBe(false);
    expect(low?.band).toBe('dormant');
    expect(low?.reason).toContain('budget-overflow');
    expect(frame.interest.summary).toMatchObject({
      admittedByBand: { dormant: 1, hot: 1 },
      budgetRejected: 1,
      wantedByBand: { hot: 2 },
    });
  });

  it('schedules transform packets through a deterministic simulated lane', () => {
    const lab = createLab({
      actors: [
        playerA,
        {
          id: 'target',
          ownerNodeId: 'host',
          position: [2.2, 0.62, 0],
        },
      ],
      transport: {
        transform: {
          latencyTicks: 0,
          lossEvery: 2,
        },
      },
    });

    lab.step(3);
    const transformLane = lab.frame('peer-a').network.lanes
      .find((lane) => lane.id === 'transform');

    expect(transformLane).toMatchObject({
      delivered: 2,
      dropped: 1,
      queued: 0,
      sent: 3,
    });
    expect(lab.trace().filter((row) => row.event === 'dropped')).toHaveLength(1);
  });

  it('keeps predicted presentation separate from authority transform', () => {
    const lab = createLab({
      actors: [
        {
          ...playerA,
          motion: { kind: 'ellipse', periodTicks: 120, radius: [1.2, 0.4] },
          position: [0, 0.62, 0],
        },
      ],
      predictionLeadTicks: 8,
    });

    lab.step(1);
    const player = lab.frame('peer-a').render.actors.find((actor) => actor.actorId === 'player-a');

    expect(player?.band).toBe('local');
    expect(player?.predictionLeadTicks).toBe(8);
    expect(player?.position).not.toEqual(player?.authorityPosition);
    expect(player?.authorityPosition).toEqual(lab.frame('peer-a').render.actors[0]?.authorityPosition);
  });
});
