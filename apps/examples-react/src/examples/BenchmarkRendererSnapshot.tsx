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
  manifestFailures: status.state === 'error' || status.state === 'unsupported' ? 1 : 0,
  manifestRequests: status.state === 'idle' ? 0 : 1,
  manifestsReady: status.state === 'ready' ? 1 : 0,
  pendingPages: status.pendingPages,
  residentPages: status.residentPages,
};

const benchmarkAutomaticVirtualTextureDiagnostics = (
  snapshot: RendererRootSnapshot['resources']['virtualTextures'],
): Record<string, number> | null => snapshot.automaticEnabled === 0 ? null : { ...snapshot };

/** @internal Pure adapter shared with the benchmark contract test. */
export const benchmarkGltfDiagnostics = (
  asset: GltfAssetRef | undefined,
  status: GltfAssetStatus | undefined,
): GltfLoadDiagnosticsAsset | undefined => {
  if (asset === undefined || status === undefined || status.state === 'idle') return undefined;
  const usable = status.state === 'streaming'
    || status.state === 'ready'
    || status.state === 'degraded';
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
  return {
    ...(status.state === 'error' ? { error: status.error } : {}),
    imageCandidates: usable ? status.textures.total : 0,
    imageFailures: usable ? status.textures.failed : 0,
    imagesLoaded: usable ? status.textures.ready : 0,
    imageRequests: usable ? status.textures.total : 0,
    lightCount: usable ? status.lightCount : 0,
    nodeCount: usable ? status.nodeCount : 0,
    phaseMs,
    primitiveCount: usable ? status.primitiveCount : 0,
    src: asset.src,
    status: status.state,
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
        },
        textureResidency: {
          fitted: current.resources.ordinaryTextures.fittedTextures,
          resources: current.resources.ordinaryTextures.residentTextures,
        },
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
