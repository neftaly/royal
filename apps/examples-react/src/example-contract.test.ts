import { describe, expect, it, vi } from 'vitest';
import {
  exampleContract,
  exampleRoutes,
  installRendererBenchmarkBridge,
  readRendererBenchmarkSnapshot,
  type RendererBenchmarkSnapshot,
} from './example-contract';
import { examples } from './examples';

describe('examples contract', () => {
  it('is a versioned serializable source of route metadata', () => {
    expect(JSON.parse(JSON.stringify(exampleContract))).toEqual(exampleContract);
    expect(exampleContract.schema).toBe('royal-examples-contract');
    expect(exampleContract.version).toBe(1);
    expect(new Set(exampleRoutes.map(({ id }) => id)).size).toBe(exampleRoutes.length);
    expect(new Set(exampleRoutes.map(({ path }) => path)).size).toBe(exampleRoutes.length);
    expect(examples.map(({ load: _load, ...entry }) => entry)).toEqual(exampleRoutes);
  });

  it('installs, reads, and conditionally removes the named benchmark bridge', () => {
    const target: Record<string, unknown> = {};
    const snapshot = vi.fn(() => ({ frame: 7 }) as RendererBenchmarkSnapshot);
    const renderNow = vi.fn();
    const cleanup = installRendererBenchmarkBridge(snapshot, renderNow, target);

    expect(readRendererBenchmarkSnapshot(target)).toEqual({ frame: 7 });
    expect(snapshot).toHaveBeenCalledOnce();
    expect(target[exampleContract.benchmark.bridge.renderNowGlobal]).toBe(renderNow);

    target[exampleContract.benchmark.bridge.rendererSnapshotGlobal] = () => null;
    cleanup();
    expect(target[exampleContract.benchmark.bridge.rendererSnapshotGlobal]).toBeTypeOf('function');
    expect(target[exampleContract.benchmark.bridge.renderNowGlobal]).toBeUndefined();
  });
});
