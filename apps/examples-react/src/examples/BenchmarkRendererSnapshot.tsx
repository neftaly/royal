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
  readonly gltfLoadDiagnostics?: unknown;
  readonly virtualTexturing?: unknown;
};

type GltfLoadDiagnosticsAsset = {
  readonly animationCount: number;
  readonly error?: string;
  readonly imageFailures: number;
  readonly imageLoaded: number;
  readonly imageRequests: number;
  readonly key: string;
  readonly lightCount: number;
  readonly nodeCount: number;
  readonly phaseMs: Record<string, number>;
  readonly primitiveCount: number;
  readonly status: string;
  readonly variantCount: number;
};

type GltfLoadDiagnosticsSnapshot = {
  readonly assets: readonly GltfLoadDiagnosticsAsset[];
  readonly errorAssets: number;
  readonly loadingAssets: number;
  readonly sceneReadyAssets: number;
};

type RendererBenchmarkSnapshot = {
  readonly frame: number;
  readonly gltfInstancing: GltfInstancingCounters | null;
  readonly gltfLoadDiagnostics: GltfLoadDiagnosticsSnapshot | null;
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
    if (typeof counter === 'number' && Number.isFinite(counter)) counters[key] = counter;
  }

  return Object.keys(counters).length === 0 ? null : counters;
};

const copyGltfLoadDiagnosticsAsset = (value: unknown): GltfLoadDiagnosticsAsset | null => {
  if (!isRecord(value)) return null;
  const phaseMs = copyNumberCounters(value.phaseMs);
  if (
    typeof value.animationCount !== 'number' ||
    typeof value.imageFailures !== 'number' ||
    typeof value.imageLoaded !== 'number' ||
    typeof value.imageRequests !== 'number' ||
    typeof value.key !== 'string' ||
    typeof value.lightCount !== 'number' ||
    typeof value.nodeCount !== 'number' ||
    phaseMs === null ||
    typeof value.primitiveCount !== 'number' ||
    typeof value.status !== 'string' ||
    typeof value.variantCount !== 'number'
  ) {
    return null;
  }

  return {
    animationCount: value.animationCount,
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    imageFailures: value.imageFailures,
    imageLoaded: value.imageLoaded,
    imageRequests: value.imageRequests,
    key: value.key,
    lightCount: value.lightCount,
    nodeCount: value.nodeCount,
    phaseMs,
    primitiveCount: value.primitiveCount,
    status: value.status,
    variantCount: value.variantCount,
  };
};

const copyGltfLoadDiagnosticsSnapshot = (value: unknown): GltfLoadDiagnosticsSnapshot | null => {
  if (!isRecord(value) || !Array.isArray(value.assets)) return null;
  if (
    typeof value.errorAssets !== 'number' ||
    typeof value.loadingAssets !== 'number' ||
    typeof value.sceneReadyAssets !== 'number'
  ) {
    return null;
  }
  const assets: GltfLoadDiagnosticsAsset[] = [];
  for (const asset of value.assets) {
    const copied = copyGltfLoadDiagnosticsAsset(asset);
    if (copied === null) return null;
    assets.push(copied);
  }

  return {
    assets,
    errorAssets: value.errorAssets,
    loadingAssets: value.loadingAssets,
    sceneReadyAssets: value.sceneReadyAssets,
  };
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
        gltfLoadDiagnostics: copyGltfLoadDiagnosticsSnapshot(rootSnapshot.gltfLoadDiagnostics),
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
