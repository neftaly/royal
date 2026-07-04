import { useCanvasRoot } from '@royal/react';
import { useLayoutEffect, type ReactNode } from 'react';

type RendererSnapshotBridge = typeof globalThis & {
  __royalExamplesGltfInstancingSnapshot?: () => RendererBenchmarkSnapshot | null;
  __royalExamplesRendererBenchmarkSnapshot?: () => RendererBenchmarkSnapshot | null;
};

type GltfInstancingCounters = {
  readonly batchInstancesTotal: number;
  readonly batchPlansBuilt: number;
  readonly drawCalls: number;
  readonly instancesDrawn: number;
  readonly localModelUploadBytes: number;
  readonly localModelUploadCalls: number;
  readonly rootPoseUploadBytes: number;
  readonly rootPoseUploadCalls: number;
  readonly rootScaleUploadBytes: number;
  readonly rootScaleUploadCalls: number;
};

type RendererRootSnapshot = {
  readonly frame?: unknown;
  readonly gltfInstancing?: unknown;
  readonly virtualTexturing?: unknown;
};

type RendererBenchmarkSnapshot = {
  readonly frame: number;
  readonly gltfInstancing: GltfInstancingCounters | null;
  readonly virtualTexturing: Record<string, number> | null;
};

const gltfInstancingCounterKeys = [
  'batchInstancesTotal',
  'batchPlansBuilt',
  'drawCalls',
  'instancesDrawn',
  'localModelUploadBytes',
  'localModelUploadCalls',
  'rootPoseUploadBytes',
  'rootPoseUploadCalls',
  'rootScaleUploadBytes',
  'rootScaleUploadCalls',
] as const satisfies readonly (keyof GltfInstancingCounters)[];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const copyGltfInstancingCounters = (value: unknown): GltfInstancingCounters | null => {
  if (!isRecord(value)) return null;

  const counters = {} as Record<keyof GltfInstancingCounters, number>;
  for (const key of gltfInstancingCounterKeys) {
    const counter = value[key];
    if (typeof counter !== 'number' || !Number.isFinite(counter)) return null;
    counters[key] = counter;
  }

  return counters;
};

const copyNumberCounters = (value: unknown): Record<string, number> | null => {
  if (!isRecord(value)) return null;

  const counters: Record<string, number> = {};
  for (const [key, counter] of Object.entries(value)) {
    if (typeof counter !== 'number' || !Number.isFinite(counter)) return null;
    counters[key] = counter;
  }

  return counters;
};

export const BenchmarkRendererSnapshot = (): ReactNode => {
  const root = useCanvasRoot();

  useLayoutEffect(() => {
    const bridge = globalThis as RendererSnapshotBridge;
    if (root === null) return undefined;

    const snapshot = (): RendererBenchmarkSnapshot | null => {
      const rootSnapshot = root.snapshot() as RendererRootSnapshot;
      if (typeof rootSnapshot.frame !== 'number' || !Number.isFinite(rootSnapshot.frame)) {
        return null;
      }

      return {
        frame: rootSnapshot.frame,
        gltfInstancing: copyGltfInstancingCounters(rootSnapshot.gltfInstancing),
        virtualTexturing: copyNumberCounters(rootSnapshot.virtualTexturing),
      };
    };
    bridge.__royalExamplesGltfInstancingSnapshot = snapshot;
    bridge.__royalExamplesRendererBenchmarkSnapshot = snapshot;

    return () => {
      if (bridge.__royalExamplesGltfInstancingSnapshot === snapshot) {
        delete bridge.__royalExamplesGltfInstancingSnapshot;
      }
      if (bridge.__royalExamplesRendererBenchmarkSnapshot === snapshot) {
        delete bridge.__royalExamplesRendererBenchmarkSnapshot;
      }
    };
  }, [root]);

  return null;
};
