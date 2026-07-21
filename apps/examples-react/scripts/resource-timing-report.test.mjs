import { describe, expect, it } from 'vitest';

import {
  resourceTimingBootstrapSource,
  summarizeResourceTimings,
} from './resource-timing-report.mjs';

describe('resource timing benchmark report', () => {
  it('installs the requested capacity before recording overflows', () => {
    const source = resourceTimingBootstrapSource(10_000);

    expect(source).toContain('setResourceTimingBufferSize(capacity)');
    expect(source).toContain('const capacity = 10000');
    expect(source).toContain("addEventListener('resourcetimingbufferfull'");
  });

  it('retains exact rows while producing bounded attribution summaries', () => {
    const rows = [
      {
        decodedBodySize: 20,
        duration: 30,
        encodedBodySize: 10,
        initiatorType: 'fetch',
        name: 'http://example.test/textures/wall.avif?v=1',
        startTime: 5,
        transferSize: 12,
      },
      {
        decodedBodySize: 40,
        duration: 10,
        encodedBodySize: 30,
        initiatorType: 'fetch',
        name: 'http://example.test/scene.bin',
        startTime: 2,
        transferSize: 32,
      },
      {
        decodedBodySize: 5,
        duration: 20,
        encodedBodySize: 4,
        initiatorType: '',
        name: 'blob:',
        startTime: 4,
        transferSize: 0,
      },
    ];

    const summary = summarizeResourceTimings(rows, {
      bufferFullCount: 0,
      capacity: 10_000,
      slowestCount: 2,
    });

    expect(summary).toMatchObject({
      bufferFullCount: 0,
      capacity: 10_000,
      count: 3,
      overflowed: false,
      totalDecodedBodySize: 65,
      totalDuration: 60,
      totalEncodedBodySize: 44,
      totalTransferSize: 44,
    });
    expect(summary.byInitiator.fetch).toMatchObject({ count: 2, duration: 40 });
    expect(summary.byInitiator.unknown).toMatchObject({ count: 1, duration: 20 });
    expect(summary.byKind.avif).toMatchObject({ count: 1, duration: 30 });
    expect(summary.byKind.bin).toMatchObject({ count: 1, duration: 10 });
    expect(summary.slowest.map((row) => row.duration)).toEqual([30, 20]);
    expect(summary.entries).toBe(rows);
  });

  it('marks full or overflow-signalled captures as incomplete', () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({
      duration: index,
      initiatorType: 'fetch',
      name: `/texture-${index}.avif`,
    }));

    expect(summarizeResourceTimings(rows, { capacity: 2 }).overflowed).toBe(true);
    expect(summarizeResourceTimings([], {
      bufferFullCount: 1,
      capacity: 10,
    }).overflowed).toBe(true);
  });
});
