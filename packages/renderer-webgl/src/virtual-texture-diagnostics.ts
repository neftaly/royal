import type { WebGlVirtualTexturingSnapshot } from "./root-types";
import { VirtualTextureRuntimeShell } from "./virtual-texture-runtime-shell";
import {
  accumulateVirtualTextureGpuActivePagesByMip,
  accumulateVirtualTextureGpuCachedPagesByMip,
  virtualTextureGpuArenaSnapshot,
  virtualTextureGpuResource,
  virtualTextureGpuResourceSnapshot,
  type VirtualTextureGpuArena,
} from "./webgl/virtual-texture-gpu-arena";

/** Builds the detached public VT diagnostics snapshot from live arena facts. */
export const virtualTextureDiagnosticsSnapshot = (
  runtime: VirtualTextureRuntimeShell,
  gpuArenaState: VirtualTextureGpuArena,
  rootUnsupportedDraws: number,
): WebGlVirtualTexturingSnapshot => {
  let activePages = 0;
  const activePagesByMip: number[] = [];
  let atlasTextures = 0;
  let cachedPages = 0;
  let demandAdmissions = 0;
  let publishedDemandPages = 0;
  let demandRetentionOverflows = 0;
  let demandRetentions = 0;
  let generatedManifestUses = 0;
  let generatedPageFailures = 0;
  let generatedPageRasterizeMaxMs = 0;
  let generatedPageRasterizeMs = 0;
  let generatedPageRequests = 0;
  let generatedPagesTarget = 0;
  let generatedSourceBytes = 0;
  let gpuAdmissionFailures = 0;
  let manifestFailures = 0;
  let manifestRequests = 0;
  let pageLoadFailures = 0;
  let manifestsReady = 0;
  let pageTableTextures = 0;
  let pageTableUpdates = 0;
  let pageLifecycleEntries = 0;
  let pendingPages = 0;
  let preparedResidencyResolutions = 0;
  let outstandingPageRequests = 0;
  const cachedPagesByMip: number[] = [];
  let shaderBinds = 0;
  let unreadyDraws = 0;
  let unsupportedDraws = rootUnsupportedDraws;
  let uploadedPageBytes = 0;
  let uploadedPages = 0;
  let textureUploadBytesPerChunkMax = 0;
  let textureUploadBytesPerChunkMin = 0;
  let textureUploadChunkSamples = 0;
  let uploadQueueWaitMaxMs = 0;
  let uploadQueueWaitTotalMs = 0;
  let uploadQueueWaitSamples = 0;
  const uploadQueueWaitTotalMsByMip: number[] = [];
  const uploadQueueWaitSamplesByMip: number[] = [];

  for (const state of runtime.resources.values()) {
    const resource = virtualTextureGpuResource(gpuArenaState, state.key);
    const gpu = resource === undefined ? undefined : virtualTextureGpuResourceSnapshot(resource);
    if (gpu?.allocated === true) {
      atlasTextures += 1;
      pageTableTextures += 1;
    }
    demandAdmissions += state.stats.demandAdmissions;
    publishedDemandPages += state.demandedPageKeys.size;
    demandRetentionOverflows += state.stats.demandRetentionOverflows;
    demandRetentions += state.stats.demandRetentions;
    generatedManifestUses += state.stats.generatedManifestUses;
    generatedPageFailures += state.stats.generatedPageFailures;
    generatedPageRasterizeMaxMs = Math.max(
      generatedPageRasterizeMaxMs,
      state.stats.generatedPageRasterizeMaxMs,
    );
    generatedPageRasterizeMs += state.stats.generatedPageRasterizeMs;
    generatedPageRequests += state.stats.generatedPageRequests;
    generatedPagesTarget += state.stats.generatedPagesTarget;
    generatedSourceBytes += state.stats.generatedSourceBytes;
    gpuAdmissionFailures += state.stats.gpuAdmissionFailures;
    manifestFailures += state.stats.manifestFailures;
    manifestRequests += state.stats.manifestRequests;
    pageLoadFailures += state.stats.pageLoadFailures;
    if (state.status === "ready") manifestsReady += 1;
    pageTableUpdates += gpu?.pageTableUpdates ?? 0;
    const requests = runtime.requests.snapshot(state);
    pageLifecycleEntries += requests.lifecycleEntries;
    pendingPages += requests.loadingPages + (gpu?.pendingUploads ?? 0);
    preparedResidencyResolutions += state.stats.preparedResidencyResolutions;
    outstandingPageRequests += requests.loadingPages + requests.queuedPages;
    activePages += gpu?.activePages ?? 0;
    cachedPages += gpu?.cachedPages ?? 0;
    if (resource !== undefined) {
      accumulateVirtualTextureGpuActivePagesByMip(resource, activePagesByMip);
      accumulateVirtualTextureGpuCachedPagesByMip(resource, cachedPagesByMip);
    }
    shaderBinds += state.stats.shaderBinds;
    unreadyDraws += state.stats.unreadyDraws;
    unsupportedDraws += state.stats.unsupportedDraws;
    uploadedPageBytes += gpu?.uploadedPageBytes ?? 0;
    uploadedPages += gpu?.uploadedPages ?? 0;
    if (gpu !== undefined) {
      textureUploadBytesPerChunkMax = Math.max(
        textureUploadBytesPerChunkMax,
        gpu.atlasUploadBytesPerChunkMax,
      );
      if (gpu.atlasUploadBytesPerChunkMin > 0) {
        textureUploadBytesPerChunkMin = textureUploadBytesPerChunkMin === 0
          ? gpu.atlasUploadBytesPerChunkMin
          : Math.min(textureUploadBytesPerChunkMin, gpu.atlasUploadBytesPerChunkMin);
      }
      textureUploadChunkSamples += gpu.atlasUploadChunkSamples;
      uploadQueueWaitMaxMs = Math.max(uploadQueueWaitMaxMs, gpu.uploadQueueWaitMaxMs);
      uploadQueueWaitTotalMs += gpu.uploadQueueWaitTotalMs;
      uploadQueueWaitSamples += gpu.uploadQueueWaitSamples;
      for (let mip = 0; mip < gpu.uploadQueueWaitTotalMsByMip.length; mip += 1) {
        uploadQueueWaitTotalMsByMip[mip] = (uploadQueueWaitTotalMsByMip[mip] ?? 0)
          + (gpu.uploadQueueWaitTotalMsByMip[mip] ?? 0);
        uploadQueueWaitSamplesByMip[mip] = (uploadQueueWaitSamplesByMip[mip] ?? 0)
          + (gpu.uploadQueueWaitSamplesByMip[mip] ?? 0);
      }
    }
  }

  const gpuArena = virtualTextureGpuArenaSnapshot(gpuArenaState);
  return {
    activePages,
    activePagesByMip,
    cachedPages,
    cachedPagesByMip,
    atlasTextures,
    demandAdmissions,
    publishedDemandPages,
    demandRetentionOverflows,
    demandRetentions,
    generatedManifestUses,
    generatedPageFailures,
    generatedPageRasterizeMaxMs,
    generatedPageRasterizeMs,
    generatedPageRequests,
    generatedPagesTarget,
    generatedSourceBytes,
    gpuAdmissionFailures,
    manifestFailures,
    manifestRequests,
    pageLoadFailures,
    manifestsReady,
    pageTableTextures,
    pageTableUpdates,
    pageLifecycleEntries,
    pendingPages,
    physicalAllocatedBytes: gpuArena.allocatedBytes,
    physicalBudgetBytes: gpuArena.budgetBytes,
    physicalQuarantinedBytes: gpuArena.quarantinedBytes,
    preparedResidencyResolutions,
    outstandingPageRequests,
    shaderBinds,
    unreadyDraws,
    unsupportedDraws,
    uploadedPageBytes,
    uploadedPages,
    textureUploadBytesPerChunkMax,
    textureUploadBytesPerChunkMin,
    textureUploadChunkSamples,
    uploadQueueWaitAverageMs: uploadQueueWaitSamples === 0
      ? 0
      : uploadQueueWaitTotalMs / uploadQueueWaitSamples,
    uploadQueueWaitMaxMs,
    uploadQueueWaitMsByMip: uploadQueueWaitTotalMsByMip.map((total, mip) =>
      total / (uploadQueueWaitSamplesByMip[mip] ?? 1)),
    uploadQueueWaitSamples,
  };
};
