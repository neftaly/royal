/** Final-fidelity readiness after the browser has restored a WebGL context. */
export const contextLossResourcesRecovered = (snapshot, hadVirtualTexturing = false) => {
  if (snapshot?.lifecycle?.state !== 'available') return false;
  const assets = snapshot.gltfLoadDiagnostics?.assets ?? [];
  if (!assets.every((asset) =>
    (asset.status === 'ready' || asset.status === 'degraded')
    && Number.isFinite(asset.imageRequests)
    && Number.isFinite(asset.imagesLoaded)
    && Number.isFinite(asset.imageFailures)
    && asset.imagesLoaded + asset.imageFailures >= asset.imageRequests
  )) return false;
  if ([
    'activePreparationJobs',
    'activeTexturePreparations',
    'deferredGeometryUploads',
    'deferredOrdinaryTextureUploads',
    'pendingOrdinaryTextureStorageRepresentations',
    'pendingSurfaceUploads',
    'queuedPreparationJobs',
    'sourceReservations',
  ].some((field) =>
    (snapshot.resourcePressure?.[field] ?? 0) > 0
  )) return false;
  if (!hadVirtualTexturing) return true;
  const vt = snapshot.virtualTexturing;
  return (vt?.residentPages ?? 0) > 0
    && vt?.pendingPages === 0
    && (vt?.automaticWaiting ?? 0) === 0;
};
