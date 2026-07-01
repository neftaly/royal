import { describe, expect, it } from 'vitest';
import { createRapierPhysics } from './rapier-physics';

describe('Rapier physics adapter', () => {
  it('steps actor recipes through a Rapier world and exposes prediction poses', async () => {
    const adapter = await createRapierPhysics({
      actors: [
        {
          id: 'player',
          motion: { kind: 'ellipse', periodTicks: 90, radius: [1.1, 0.4] },
          ownerNodeId: 'local',
          position: [0, 0.62, 0],
          scale: [0.52, 1.2, 0.52],
        },
      ],
      arenaBoxes: [],
    });
    const runtime = adapter.create();
    const initial = runtime.actors()[0];
    const stepped = runtime.step({ tick: 4 })[0];
    const predicted = runtime.predict?.({ actorId: 'player', leadTicks: 8, tick: 4 });

    expect(initial?.position).not.toEqual(stepped?.position);
    expect(predicted?.position).not.toEqual(stepped?.position);
    expect(stepped?.id).toBe('player');
  });
});
