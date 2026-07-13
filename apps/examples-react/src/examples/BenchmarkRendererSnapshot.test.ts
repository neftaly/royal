import { describe, expect, it } from 'vitest';
import { copyVirtualTexturingCounters } from './BenchmarkRendererSnapshotCounters';

describe('copyVirtualTexturingCounters', () => {
  it('flattens active and cached mip residency', () => {
    expect(copyVirtualTexturingCounters({
      activePages: 1,
      activePagesByMip: [0, 0, 0, 1],
      cachedPages: 12,
      cachedPagesByMip: [5, 4, 2, 1],
      uploadedPages: 12,
    })).toEqual({
      activePages: 1,
      activePagesMip0: 0,
      activePagesMip1: 0,
      activePagesMip2: 0,
      activePagesMip3: 1,
      cachedPages: 12,
      cachedPagesMip0: 5,
      cachedPagesMip1: 4,
      cachedPagesMip2: 2,
      cachedPagesMip3: 1,
      uploadedPages: 12,
    });
  });

  it('prefers an explicit cached mip histogram and ignores invalid counters', () => {
    expect(copyVirtualTexturingCounters({
      activePagesByMip: [1, Number.NaN, '2'],
      cachedPagesByMip: [2, 3],
    })).toEqual({
      activePagesMip0: 1,
      cachedPagesMip0: 2,
      cachedPagesMip1: 3,
    });
  });
});
