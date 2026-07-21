import { describe, expect, it } from 'vitest';

import {
  isIpadSafariBenchmarkEnvelope,
  validateIpadSafariBenchmarkEnvelope,
} from './ipad-benchmark-report-check.mjs';

const validEnvelope = () => ({
  browserDiagnostics: { droppedEntries: 0, entries: [] },
  cameraDrag: true,
  coldCache: false,
  receivedAt: '2026-07-21T00:00:01.000Z',
  report: {
    device: {
      dpr: 2,
      userAgent: 'Safari',
      webgl: { renderer: 'WebKit WebGL', version: 'WebGL 2.0' },
    },
    example: { id: 'virtual-texture-stress', path: '/virtual-texture-stress' },
    frameStats: {
      averageMs: 16,
      complete: true,
      failed: false,
      maxMs: 17,
      minMs: 15,
      p50Ms: 16,
      p95Ms: 17,
      p99Ms: 17,
      requestedSampleCount: 24,
      sampleCount: 24,
      samplesMissing: 0,
      timedOut: false,
      timeoutMs: 30_000,
    },
    generatedAt: '2026-07-21T00:00:00.000Z',
    gl: {
      frames: { drawCalls: 24, stateChanges: 0, uniformCalls: 24 },
      setup: { drawCalls: 2, stateChanges: 8, uniformCalls: 12 },
    },
    ready: true,
    renderer: {
      after: {
        gltfLoadDiagnostics: null,
        virtualTexturing: {
          failedPages: 0,
          manifestFailures: 0,
          pendingPages: 0,
          residentPages: 10,
        },
      },
    },
    source: {
      buildId: 'abc-clean-build',
      builtAt: '2026-07-21T00:00:00.000Z',
      dirty: false,
      revision: 'abcdef',
    },
    url: 'http://example.test/virtual-texture-stress',
    warmupComplete: true,
    warnings: [],
  },
});

describe('iPad Safari benchmark report validation', () => {
  it('accepts a complete physical report envelope', () => {
    const report = validEnvelope();
    expect(isIpadSafariBenchmarkEnvelope(report)).toBe(true);
    expect(validateIpadSafariBenchmarkEnvelope(report)).toEqual({ errors: [], warnings: [] });
  });

  it('rejects incomplete samples, unsettled VT, and browser errors together', () => {
    const report = validEnvelope();
    report.browserDiagnostics.entries.push({ kind: 'exception', level: 'error', text: 'boom' });
    report.report.frameStats.sampleCount = 23;
    report.report.renderer.after.virtualTexturing.pendingPages = 1;

    const result = validateIpadSafariBenchmarkEnvelope(report);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('contains a browser error'),
      expect.stringContaining('sampleCount must match'),
      expect.stringContaining('pendingPages must be 0'),
    ]));
  });
});
