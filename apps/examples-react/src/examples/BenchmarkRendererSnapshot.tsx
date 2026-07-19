import type { GltfAssetRef } from '@royal/react/scene';
import {
  useCanvasRoot,
  type GltfAssetStatus,
} from '@royal/react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import {
  installRendererBenchmarkBridge,
  type GltfLoadDiagnosticsAsset,
  type RendererBenchmarkSnapshot,
} from '../example-contract';

export type BenchmarkRendererSnapshotProps = Readonly<{
  asset?: GltfAssetRef;
  status?: GltfAssetStatus;
}>;

/** @internal Pure adapter shared with the benchmark contract test. */
export const benchmarkGltfDiagnostics = (
  asset: GltfAssetRef | undefined,
  status: GltfAssetStatus | undefined,
): GltfLoadDiagnosticsAsset | undefined => {
  if (asset === undefined || status === undefined || status.state === 'idle') return undefined;
  const usable = status.state === 'streaming'
    || status.state === 'ready'
    || status.state === 'degraded';
  return {
    ...(status.state === 'error' ? { error: status.error } : {}),
    imageCandidates: usable ? status.textures.total : 0,
    imageFailures: usable ? status.textures.failed : 0,
    imagesLoaded: usable ? status.textures.ready : 0,
    imageRequests: usable ? status.textures.total : 0,
    lightCount: 0,
    nodeCount: 0,
    phaseMs: {},
    primitiveCount: usable ? status.primitiveCount : 0,
    src: asset.src,
    status: status.state,
    variantNames: [],
    ...(asset.version === undefined ? {} : { version: asset.version }),
  };
};

/** Installs the benchmark-only bridge using public product observation APIs. */
export const BenchmarkRendererSnapshot = ({
  asset,
  status,
}: BenchmarkRendererSnapshotProps = {}): ReactNode => {
  const root = useCanvasRoot();
  const observation = useRef({ asset, status });
  observation.current.asset = asset;
  observation.current.status = status;

  useLayoutEffect(() => {
    if (root === null) return undefined;
    const snapshot = (): RendererBenchmarkSnapshot => {
      const current = root.getSnapshot();
      const observed = observation.current;
      const gltf = benchmarkGltfDiagnostics(observed.asset, observed.status);
      return {
        frame: current.frame,
        gltfInstancing: null,
        gltfLoadDiagnostics: { assets: gltf === undefined ? [] : [gltf] },
        lifecycle: {
          generation: current.context.generation,
          interruptions: current.context.interruptions,
          recoveries: current.context.recoveries,
          state: current.context.phase === 'active'
            ? 'available'
            : current.context.phase === 'disposed' ? 'disposed' : 'unavailable',
        },
        planning: null,
        resourcePressure: {
          persistentGpuBudgetBytes: current.resources.persistentGpu.budgetBytes,
          persistentGpuDeniedClaims: current.resources.persistentGpu.deniedClaims,
          persistentGpuRetainedBytes: current.resources.persistentGpu.retainedBytes,
        },
        resourceLifetime: null,
        textureResidency: {
          resources: current.resources.ordinaryTextures.residentTextures,
        },
        virtualTexturing: null,
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
