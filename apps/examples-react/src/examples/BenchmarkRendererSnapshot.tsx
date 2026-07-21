import type { GltfAssetRef } from '@royal/react/scene';
import {
  useCanvasRoot,
  useGltfAssetStatus,
  type GltfAssetStatus,
  type RendererRootSnapshot,
  type VirtualTextureAssetStatus,
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
  virtualTextureStatus?: VirtualTextureAssetStatus;
}>;

/** Observes one glTF asset for examples that do not otherwise render its status. */
export const BenchmarkGltfRendererSnapshot = ({
  asset,
}: Readonly<{ asset: GltfAssetRef }>): ReactNode => {
  const status = useGltfAssetStatus(asset);
  return <BenchmarkRendererSnapshot asset={asset} status={status} />;
};

/** @internal Focused VT adapter; it does not poll the root frame snapshot. */
export const benchmarkVirtualTextureDiagnostics = (
  status: VirtualTextureAssetStatus | undefined,
): Record<string, number> | null => status === undefined ? null : {
  failedPages: status.failedPages,
  manifestFailures: status.status === 'error' || status.status === 'unsupported' ? 1 : 0,
  manifestRequests: status.status === 'idle' ? 0 : 1,
  manifestsReady: status.status === 'ready' ? 1 : 0,
  pendingPages: status.pendingPages,
  residentPages: status.residentPages,
};

const benchmarkAutomaticVirtualTextureDiagnostics = (
  snapshot: RendererRootSnapshot['resources']['virtualTextures'],
): Record<string, number> | null => {
  if (!snapshot.automaticEnabled) return null;
  const { automaticEnabled: _automaticEnabled, ...counters } = snapshot;
  return counters;
};

/** @internal Pure projection from the public cold snapshot to benchmark counters. */
export const benchmarkTextureResidency = (
  snapshot: RendererRootSnapshot['resources']['ordinaryTextures'],
): Record<string, number> => ({
  bytes: snapshot.residentBytes,
  compressedBytes: snapshot.compressedBytes,
  compressedResources: snapshot.compressedTextures,
  fitted: snapshot.fittedTextures,
  resources: snapshot.residentTextures,
});

/** @internal Pure adapter shared with the benchmark contract test. */
export const benchmarkGltfDiagnostics = (
  asset: GltfAssetRef | undefined,
  status: GltfAssetStatus | undefined,
): GltfLoadDiagnosticsAsset | undefined => {
  if (asset === undefined || status === undefined || status.status === 'idle') return undefined;
  const usable = status.status === 'streaming'
    || status.status === 'ready'
    || status.status === 'degraded';
  const phaseMs = usable
    ? {
        firstUsable: status.timings.sourceReadDurationMs
          + status.timings.externalResourceReadDurationMs
          + status.timings.preparationDurationMs,
        ...(status.timings.imagesCompleteAfterMs === undefined
          ? {}
          : { imagesComplete: status.timings.imagesCompleteAfterMs }),
        preparation: status.timings.preparationDurationMs,
        externalResourceRead: status.timings.externalResourceReadDurationMs,
        sourceRead: status.timings.sourceReadDurationMs,
      }
    : {};
  const sceneIndex = usable ? status.sceneIndex : asset.sceneIndex;
  return {
    ...(status.status === 'error' ? { error: status.error } : {}),
    imageCandidates: usable ? status.textures.total : 0,
    imageFallbacks: usable ? status.textures.fallback : 0,
    imageFailures: usable ? status.textures.failed : 0,
    imagesLoaded: usable ? status.textures.ready : 0,
    imageRequests: usable ? status.textures.total : 0,
    lightCount: usable ? status.lightCount : 0,
    nodeCount: usable ? status.nodeCount : 0,
    phaseMs,
    primitiveCount: usable ? status.primitiveCount : 0,
    ...(sceneIndex === undefined ? {} : { sceneIndex }),
    src: asset.src,
    status: status.status,
    variantNames: usable ? status.variantNames : [],
    ...(asset.version === undefined ? {} : { version: asset.version }),
  };
};

/** Installs the benchmark-only bridge using public product observation APIs. */
export const BenchmarkRendererSnapshot = ({
  asset,
  status,
  virtualTextureStatus,
}: BenchmarkRendererSnapshotProps = {}): ReactNode => {
  const root = useCanvasRoot();
  const observation = useRef({ asset, status, virtualTextureStatus });
  observation.current.asset = asset;
  observation.current.status = status;
  observation.current.virtualTextureStatus = virtualTextureStatus;

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
        resourcePressure: {
          activePreparationJobs: current.resources.asyncPreparation.activeJobs,
          activeTextureDecodes:
            current.resources.ordinaryTexturePreparation.activeDecodes,
          admittedGeometryUploadBytes: current.resources.geometryUploads.admittedBytes,
          admittedOrdinaryTextureUploadBytes:
            current.resources.ordinaryTextureUploads.admittedBytes,
          decodeReservationLimit:
            current.resources.ordinaryTexturePreparation.decodeReservationLimit,
          decodeReservations:
            current.resources.ordinaryTexturePreparation.decodeReservations,
          decodedTextureHandoffBytes:
            current.resources.ordinaryTexturePreparation.decodedHandoffBytes,
          decodedTextureHandoffThresholdBytes:
            current.resources.ordinaryTexturePreparation.decodedHandoffThresholdBytes,
          deferredGeometryUploads: current.resources.geometryUploads.deferredUploads,
          deferredOrdinaryTextureUploads:
            current.resources.ordinaryTextureUploads.deferredUploads,
          ordinaryTextureUploadBudgetBytes:
            current.resources.ordinaryTextureUploads.budgetBytes,
          preparationJobLimit: current.resources.asyncPreparation.jobLimit,
          queuedDetailPreparationJobs:
            current.resources.asyncPreparation.queuedDetailJobs,
          queuedForegroundPreparationJobs:
            current.resources.asyncPreparation.queuedForegroundJobs,
          queuedPreparationJobs: current.resources.asyncPreparation.queuedJobs,
          persistentGpuBudgetBytes: current.resources.persistentGpu.budgetBytes,
          persistentGpuDeniedClaims: current.resources.persistentGpu.deniedClaims,
          persistentGpuRetainedBytes: current.resources.persistentGpu.retainedBytes,
          pendingOrdinaryTextureStorageRepresentations:
            current.resources.ordinaryTexturePreparation.pendingStorageRepresentations,
          pendingSurfaceUploads: current.resources.geometryUploads.pendingSurfaces,
          retainedEncodedTextureSourceBytes:
            current.resources.ordinaryTexturePreparation.retainedEncodedSourceBytes,
        },
        textureResidency: benchmarkTextureResidency(current.resources.ordinaryTextures),
        virtualTexturing: benchmarkVirtualTextureDiagnostics(observed.virtualTextureStatus)
          ?? benchmarkAutomaticVirtualTextureDiagnostics(current.resources.virtualTextures),
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
