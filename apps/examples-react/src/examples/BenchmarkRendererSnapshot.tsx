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
  type RendererContextSnapshot,
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

const copyRendererContextSnapshot = (value: unknown): RendererContextSnapshot | null => {
  if (!isRecord(value)) return null;
  const lifecycle = value.lifecycle;
  if (
    typeof value.generation !== 'number' ||
    !Number.isFinite(value.generation) ||
    (lifecycle !== 'active' && lifecycle !== 'disposed' && lifecycle !== 'lost' && lifecycle !== 'restoring') ||
    typeof value.losses !== 'number' ||
    !Number.isFinite(value.losses) ||
    typeof value.restores !== 'number' ||
    !Number.isFinite(value.restores)
  ) return null;

  return {
    generation: value.generation,
    ...(typeof value.lastError === 'string' ? { lastError: value.lastError } : {}),
    lifecycle,
    losses: value.losses,
    restores: value.restores,
  };
};

const copyGltfLoadDiagnosticsAsset = (value: unknown): GltfLoadDiagnosticsAsset | null => {
  if (!isRecord(value)) return null;
  const phaseMs = copyNumberCounters(value.phaseMs);
  if (
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
    if (root === null) return undefined;

    const snapshot = (): RendererBenchmarkSnapshot | null => {
      const rootSnapshot = root.snapshot();
      const diagnostics: RoyalRendererDiagnosticsSnapshot = root.diagnostics();
      if (!Number.isFinite(rootSnapshot.frame)) {
        return null;
      }

      return {
        context: copyRendererContextSnapshot(diagnostics.context),
        frame: rootSnapshot.frame,
        gltfInstancing: copyGltfInstancingCounters(diagnostics.gltfInstancing),
        gltfLoadDiagnostics: copyGltfLoadDiagnosticsSnapshot(diagnostics.gltfLoadDiagnostics),
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
