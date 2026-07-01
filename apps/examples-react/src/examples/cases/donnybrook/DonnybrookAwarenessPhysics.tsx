import { useEffect, useState, type ReactNode } from 'react';
import { DonnybrookViewport } from './DonnybrookViewport';
import {
  budgetedAdmission,
  createNetworkedPhysicsLab,
  defineLanes,
  defineNetworkedPhysicsNode,
  donnybrookAwarenessPreset,
  fixedStep,
  hostFrameTopology,
  interestPipeline,
  laneScheduler,
  ownedByNode,
  predicted,
  replicaView,
  selectInterestSummary,
  selectSelectedActorDecision,
  simulatedTransport,
  viewpointOf,
  type ActorRecipe,
  type NetworkedPhysicsLab,
} from './networked-lab';
import {
  NetworkedLabProvider,
  useNetworkedLab,
  useNetworkedLabSelector,
} from './networked-lab-react';
import { createRapierPhysics } from './rapier-physics';

const actorRecipes = [
  {
    forward: [1, 0, 0],
    id: 'player',
    motion: { kind: 'ellipse', offsetTicks: 0, periodTicks: 520, radius: [1.95, 1.25] },
    ownerNodeId: 'local',
    position: [-0.55, 0.62, -1.15],
    priority: 1,
    scale: [0.52, 1.24, 0.52],
  },
  {
    id: 'near-runner',
    motion: { kind: 'ellipse', offsetTicks: 90, periodTicks: 360, radius: [0.7, 0.38] },
    ownerNodeId: 'host',
    position: [0.9, 0.62, -1.45],
    priority: 0.9,
    scale: [0.48, 1.1, 0.48],
  },
  {
    id: 'flanker',
    motion: { kind: 'ellipse', offsetTicks: 160, periodTicks: 440, radius: [0.62, 0.9] },
    ownerNodeId: 'host',
    position: [-0.75, 0.62, 1.18],
    priority: 0.68,
    scale: [0.52, 1.08, 0.52],
  },
  {
    id: 'distant-scout',
    motion: { kind: 'ellipse', offsetTicks: 230, periodTicks: 620, radius: [0.95, 0.62] },
    ownerNodeId: 'host',
    position: [3.65, 0.62, 2.0],
    priority: 0.42,
    scale: [0.46, 1.04, 0.46],
  },
  {
    id: 'outside-noise',
    motion: { kind: 'ellipse', offsetTicks: 70, periodTicks: 540, radius: [0.42, 0.32] },
    ownerNodeId: 'host',
    position: [5.35, 0.62, 2.85],
    priority: 0.18,
    scale: [0.5, 0.96, 0.5],
  },
] as const satisfies readonly ActorRecipe[];

const lanes = defineLanes({
  animation: { ordering: 'sequenced', reliability: 'unreliable' },
  combat: { ordering: 'ordered', reliability: 'reliable' },
  recovery: { ordering: 'ordered', reliability: 'reliable' },
  transform: { ordering: 'newest', reliability: 'unreliable' },
});

const createDonnybrookLab = async (): Promise<NetworkedPhysicsLab> => {
  const physics = await createRapierPhysics({ actors: actorRecipes });
  const node = defineNetworkedPhysicsNode({
    interest: interestPipeline({
      admit: budgetedAdmission({
        maxByBand: {
          cold: 8,
          hot: 2,
          warm: 4,
        },
        tieBreakers: ['bandRank', 'priority', 'score', 'lastSeenTick', 'actorId'],
      }),
      classify: donnybrookAwarenessPreset(),
      observer: viewpointOf(ownedByNode()),
      schedule: laneScheduler({
        bands: {
          cold: { cadenceTicks: 18, lanes: ['transform'] },
          dormant: { cadenceTicks: 0, lanes: [] },
          hot: { cadenceTicks: 1, lanes: ['transform', 'animation', 'combat'] },
          warm: { cadenceTicks: 4, lanes: ['transform', 'animation'] },
        },
      }),
    }),
    physics,
    replica: replicaView({
      prediction: predicted({ actors: ownedByNode(), leadTicks: 6 }),
      proxyByBand: {
        cold: 'none',
        dormant: 'none',
        hot: 'blocking',
        warm: 'ghost',
      },
    }),
  });

  return createNetworkedPhysicsLab({
    clock: fixedStep({ hz: 60 }),
    lanes,
    seed: 'donnybrook-awareness',
    topology: hostFrameTopology({
      authorityNodeId: 'host',
      node,
      viewerNodeIds: ['local'],
    }),
    traceLimit: 480,
    transport: simulatedTransport({
      lanes: {
        animation: { jitterTicks: 2, latencyTicks: 5, lossEvery: 23 },
        combat: { jitterTicks: 1, latencyTicks: 2, lossEvery: 29 },
        recovery: { latencyTicks: 9 },
        transform: { jitterTicks: 1, latencyTicks: 3, lossEvery: 17 },
      },
    }),
  });
};

const bandCount = (
  counts: Readonly<Record<string, number>>,
  band: string,
): number => counts[band] ?? 0;

const distance = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const DonnybrookInspector = (): ReactNode => {
  const lab = useNetworkedLab();
  const summary = useNetworkedLabSelector(selectInterestSummary);
  const selected = useNetworkedLabSelector(selectSelectedActorDecision);
  const lanes = useNetworkedLabSelector((frame) => frame.network.lanes);
  const actors = useNetworkedLabSelector((frame) => frame.render.actors);
  const tick = useNetworkedLabSelector((frame) => frame.tick);

  return (
    <aside className="donnybrook-inspector" aria-label="Donnybrook simulation inspector">
      <div className="donnybrook-metrics">
        {['hot', 'warm', 'cold', 'dormant'].map((band) => (
          <div className={`donnybrook-metric ${band}`} key={band}>
            <span>{band}</span>
            <strong>{bandCount(summary.admittedByBand, band)}</strong>
            <small>{bandCount(summary.wantedByBand, band)} wanted</small>
          </div>
        ))}
      </div>

      <div className="donnybrook-panel-row">
        <section className="donnybrook-panel" aria-label="Selected actor">
          <h2>Actor</h2>
          <strong>{selected?.actorId ?? 'none'}</strong>
          <dl>
            <div>
              <dt>band</dt>
              <dd>{selected?.band ?? 'none'}</dd>
            </div>
            <div>
              <dt>proxy</dt>
              <dd>{selected?.proxy ?? 'none'}</dd>
            </div>
            <div>
              <dt>volume</dt>
              <dd>{selected?.volumeId ?? 'none'}</dd>
            </div>
            <div>
              <dt>stale</dt>
              <dd>{selected?.staleTicks ?? 0} ticks</dd>
            </div>
            <div>
              <dt>predict</dt>
              <dd>
                {selected?.predictionLeadTicks ?? 0} ticks
                {selected === undefined
                  ? ''
                  : `, ${distance(selected.position, selected.authorityPosition).toFixed(2)}m error`}
              </dd>
            </div>
            <div>
              <dt>reason</dt>
              <dd>{selected?.reason ?? 'none'}</dd>
            </div>
          </dl>
        </section>

        <section className="donnybrook-panel" aria-label="Network lanes">
          <h2>Lanes</h2>
          <div className="donnybrook-lanes">
            {lanes.map((lane) => (
              <div className="donnybrook-lane" key={lane.id}>
                <span>{lane.id}</span>
                <strong>{lane.delivered}/{lane.sent}</strong>
                <small>{lane.dropped} dropped</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="donnybrook-controls">
        <span>tick {tick}</span>
        <button type="button" onClick={() => lab.pause()}>Pause</button>
        <button type="button" onClick={() => lab.resume()}>Run</button>
        <button type="button" onClick={() => lab.step()}>Step</button>
      </div>

      <div className="donnybrook-actor-strip" aria-label="Actors">
        {actors.map((actor) => (
          <button
            className={actor.actorId === selected?.actorId ? 'active' : undefined}
            key={actor.actorId}
            onClick={() => lab.selectActor(actor.actorId)}
            type="button"
          >
            {actor.actorId}
          </button>
        ))}
      </div>
    </aside>
  );
};

export const DonnybrookAwarenessPhysics = (): ReactNode => {
  const [lab, setLab] = useState<NetworkedPhysicsLab | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    createDonnybrookLab()
      .then((created) => {
        if (!cancelled) setLab(created);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== undefined) {
    return (
      <div className="donnybrook-lab-state" role="alert">
        Rapier failed to initialize: {error}
      </div>
    );
  }

  if (lab === undefined) {
    return (
      <div className="donnybrook-lab-state" aria-busy="true">
        Initializing Rapier simulation
      </div>
    );
  }

  return (
    <NetworkedLabProvider lab={lab}>
      <div className="donnybrook-lab">
        <section className="donnybrook-stage" aria-label="Donnybrook awareness scene">
          <DonnybrookViewport />
        </section>
        <DonnybrookInspector />
      </div>
    </NetworkedLabProvider>
  );
};
