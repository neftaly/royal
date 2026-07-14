import {
  useCanvasRoot,
  type RoyalRendererDiagnosticsSnapshot,
} from '@royal/react';
import { useLayoutEffect, type ReactNode } from 'react';
import {
  copyNumberCounters,
  copyVirtualTexturingCounters,
  isRecord,
} from './BenchmarkRendererSnapshotCounters';
import {
  exampleContract,
  installRendererBenchmarkBridge,
  type GltfInstancingCounters,
  type GltfLoadDiagnosticsAsset,
  type GltfLoadDiagnosticsSnapshot,
  type RendererBenchmarkSnapshot,
  type RendererLifecycleSnapshot,
} from '../example-contract';

const gltfInstancingCounterKeys = exampleContract.benchmark.gltfInstancingCounterFields;

const copyGltfInstancingCounters = (value: unknown): GltfInstancingCounters | null => {
  if (!isRecord(value)) return null;

  const counters: Record<string, number> = {};
  for (const key of gltfInstancingCounterKeys) {
    const counter = value[key];
    if (typeof counter !== 'number' || !Number.isFinite(counter)) return null;
    counters[key] = counter;
  }

  return counters;
};

const copyRendererLifecycleSnapshot = (value: unknown): RendererLifecycleSnapshot | null => {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (
    typeof value.generation !== 'number' ||
    !Number.isFinite(value.generation) ||
    typeof value.interruptions !== 'number' ||
    !Number.isFinite(value.interruptions) ||
    typeof value.recoveries !== 'number' ||
    !Number.isFinite(value.recoveries) ||
    (state !== 'available' && state !== 'disposed' && state !== 'failed' && state !== 'unavailable')
  ) return null;

  return {
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    generation: value.generation,
    interruptions: value.interruptions,
    recoveries: value.recoveries,
    state,
  };
};

const copyGltfLoadDiagnosticsAsset = (value: unknown): GltfLoadDiagnosticsAsset | null => {
  if (!isRecord(value)) return null;
  const phaseMs = copyNumberCounters(value.phaseMs);
  if (
    typeof value.imageFailures !== 'number' ||
    typeof value.imageLoaded !== 'number' ||
    typeof value.imageRequests !== 'number' ||
    typeof value.lightCount !== 'number' ||
    typeof value.nodeCount !== 'number' ||
    phaseMs === null ||
    typeof value.primitiveCount !== 'number' ||
    typeof value.sourceUri !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.variantCount !== 'number'
  ) {
    return null;
  }

  return {
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    imageFailures: value.imageFailures,
    imageLoaded: value.imageLoaded,
    imageRequests: value.imageRequests,
    lightCount: value.lightCount,
    nodeCount: value.nodeCount,
    phaseMs,
    primitiveCount: value.primitiveCount,
    sourceUri: value.sourceUri,
    ...(typeof value.sourceVersion === 'number' || typeof value.sourceVersion === 'string'
      ? { sourceVersion: value.sourceVersion }
      : {}),
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
    if (root === null) return undefined;

    const snapshot = (): RendererBenchmarkSnapshot | null => {
      const rootSnapshot = root.snapshot();
      const diagnostics: RoyalRendererDiagnosticsSnapshot = root.diagnostics();
      if (!Number.isFinite(rootSnapshot.frame)) {
        return null;
      }

      return {
        frame: rootSnapshot.frame,
        gltfInstancing: copyGltfInstancingCounters(diagnostics.gltfInstancing),
        gltfLoadDiagnostics: copyGltfLoadDiagnosticsSnapshot(diagnostics.gltfLoads),
        lifecycle: copyRendererLifecycleSnapshot(rootSnapshot.lifecycle),
        planning: copyNumberCounters(diagnostics.planning),
        resourceGovernor: diagnostics.resourceGovernor,
        resourceLifetime: copyNumberCounters(diagnostics.resourceLifetime),
        virtualTexturing: copyVirtualTexturingCounters(diagnostics.virtualTexturing),
      };
    };
    const renderNow = (): void => {
      root.invalidate();
      root.flushInvalidated();
    };
    return installRendererBenchmarkBridge(snapshot, renderNow);
  }, [root]);

  return null;
};
