import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const counters = (names) => Object.fromEntries(names.split(' ').map(name => [name, 0]));
const report = () => {
  const gl = counters('bindBuffer bindTexture bindVertexArray copyTexImage2D copyTexSubImage2D copyTexSubImage2DPixels stateChanges uniformCalls uniformMatrixCalls useProgram bufferSubDataBytes drawArraysInstanced drawCalls drawElementsInstanced instancedDrawCalls');
  const stats = { ...counters('averageMs jitterP95MinusP50Ms maxMs minMs p50Ms p95Ms p99Ms timeoutMs'), sampleCount: 1, requestedSampleCount: 1, timedOut: false };
  const snapshot = { frame: 1, lifecycle: { state: 'available', generation: 0, interruptions: 0, recoveries: 0 }, resourcePressure: counters('activePreparationJobs admittedOrdinaryTextureUploadBytes deferredOrdinaryTextureUploads ordinaryTextureUploadBudgetBytes preparationJobLimit queuedPreparationJobs persistentGpuBudgetBytes persistentGpuDeniedClaims persistentGpuRetainedBytes'), textureResidency: { fitted: 0, resources: 0 } };
  return {
    schema: 'royal-renderer-benchmark', schemaVersion: 1, generatedAt: '2026-09-24',
    source: { architecture: 'arm64', dirty: false, node: '24', platform: 'test', revision: 'test' },
    browser: { userAgent: 'test', hardwareConcurrency: null, deviceMemoryGiB: null, screen: { width: null, height: null } },
    options: { gpuTimersEnabled: true },
    routes: [{ id: 'webxr-vr', ready: true, navigationSynchronizationMs: 0, wallNavigationAndReadyMs: 1,
      display: { devicePixelRatio: 1, viewport: { width: 1, height: 1 }, canvas: { backingWidth: 1, backingHeight: 1, cssWidth: 1, cssHeight: 1 } },
      frameStats: stats, gl: { ...gl, setup: gl }, renderer: { snapshots: { setup: snapshot, beforeFrames: snapshot, afterFrames: snapshot } },
      virtualTextureClose: { durationMs: 1, initialDistance: 2, finalDistance: 1, targetDistance: 1, wheelEvents: 1, frameStats: stats, gl,
        screenshot: { width: 1, height: 1, outputPath: 'test.png' }, renderer: { virtualTexturing: { available: true, after: { failedPages: 0, pendingPages: 0, unresidentPages: 0, desiredPages: 5, admittedPages: 5, residentPages: 5 } } } },
    }],
    analysis: { slowestRoutesByP95: [], heaviestGlStateRoutes: [], heaviestUniformRoutes: [], heaviestDrawRoutes: [], heaviestCpuRoutes: [], heaviestGpuRoutes: [] },
  };
};
const check = (value) => {
  const dir = mkdtempSync(join(tmpdir(), 'royal-report-'));
  try {
    const file = join(dir, 'report.json');
    writeFileSync(file, JSON.stringify(value));
    return spawnSync(process.execPath, [new URL('./check-benchmark-report.mjs', import.meta.url).pathname, file], { encoding: 'utf8' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
describe('benchmark report validation', () => {
  it('accepts current VT counters and browser-only XR routes with GPU timers enabled', () => {
    const result = check(report());
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
  it.each(['failedPages', 'pendingPages', 'unresidentPages'])('rejects unfinished VT coverage: %s', (field) => {
    const value = report();
    value.routes[0].virtualTextureClose.renderer.virtualTexturing.after[field] = 1;
    const result = check(value);
    expect(result.status).toBe(1);
  });
  it('rejects incomplete admission', () => {
    const value = report();
    value.routes[0].virtualTextureClose.renderer.virtualTexturing.after.admittedPages = 4;
    const result = check(value);
    expect(result.status).toBe(1);
  });
  it('still requires immersive evidence when XR is enabled', () => {
    const value = report();
    value.options.realXrEnabled = true;
    const result = check(value);
    expect(result.status).toBe(1);
  });
});

it('reject coverage while current-view demand is pending', () => {
 const value = report();
 value.routes[0].virtualTextureClose.renderer.virtualTexturing.after.pendingDemandResources = 24;
 expect(check(value).status).toBe(1);
});
