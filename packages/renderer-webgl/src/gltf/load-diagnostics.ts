import type {
  WebGlGltfLoadDiagnosticsAssetSnapshot,
  WebGlGltfLoadDiagnosticsPhaseKey,
  WebGlGltfLoadDiagnosticsSnapshot,
} from "../root-types";
import type { GltfLoadMetrics } from "./prepared-asset";
import type { PreparedGltfRuntime } from "./prepared-runtime";

export type GltfLoadDiagnosticsState = {
  readonly error?: string;
  readonly lightCount: number;
  readonly load: GltfLoadMetrics;
  readonly nodeCount: number;
  readonly primitiveCount: number;
  readonly sourceUri: string;
  readonly sourceVersion?: number | string;
  readonly status: "error" | "loading" | "ready";
  readonly variants: readonly string[];
};

const elapsedMs = (start: number | undefined, end: number | undefined): number | undefined =>
  start === undefined || end === undefined ? undefined : Math.max(0, end - start);

const assetSnapshot = (
  state: GltfLoadDiagnosticsState,
): WebGlGltfLoadDiagnosticsAssetSnapshot => {
  const load = state.load;
  const phaseMs: Partial<Record<WebGlGltfLoadDiagnosticsPhaseKey, number>> = {};
  const addPhase = (
    key: WebGlGltfLoadDiagnosticsPhaseKey,
    start: number | undefined,
    end: number | undefined,
  ): void => {
    const duration = elapsedMs(start, end);
    if (duration !== undefined) phaseMs[key] = duration;
  };
  addPhase("buffers", load.documentLoadedAt, load.buffersLoadedAt);
  addPhase("document", load.startedAt, load.documentLoadedAt);
  addPhase("draco", load.meshoptDecodedAt, load.dracoDecodedAt);
  addPhase("firstImageComplete", load.imageLoadStartedAt, load.firstImageSettledAt);
  addPhase("imagesComplete", load.imageLoadStartedAt, load.imagesSettledAt);
  addPhase("meshopt", load.buffersLoadedAt, load.meshoptDecodedAt);
  addPhase("scene", load.dracoDecodedAt, load.sceneReadAt);
  addPhase("toSceneReady", load.startedAt, load.readyAt);

  return {
    ...(state.error === undefined ? {} : { error: state.error }),
    imageFailures: load.imageFailures,
    imageLoaded: load.imageLoaded,
    imageRequests: load.imageRequests,
    lightCount: state.lightCount,
    nodeCount: state.nodeCount,
    phaseMs,
    primitiveCount: state.primitiveCount,
    sourceUri: state.sourceUri,
    ...(state.sourceVersion === undefined ? {} : { sourceVersion: state.sourceVersion }),
    status: state.status === "ready" ? "sceneReady" : state.status,
    variantCount: state.variants.length,
    variantNames: Object.freeze([...state.variants]),
  };
};

/** Pure public diagnostics projection from detached prepared-asset facts. */
export const gltfLoadDiagnosticsSnapshot = (
  states: Iterable<GltfLoadDiagnosticsState>,
): WebGlGltfLoadDiagnosticsSnapshot => {
  const assets = [...states].map(assetSnapshot);
  let errorAssets = 0;
  let loadingAssets = 0;
  let sceneReadyAssets = 0;
  for (const asset of assets) {
    if (asset.status === "error") errorAssets += 1;
    else if (asset.status === "loading") loadingAssets += 1;
    else sceneReadyAssets += 1;
  }
  return { assets, errorAssets, loadingAssets, sceneReadyAssets };
};

/** Reads live prepared state into detached facts before applying the pure projection. */
export const preparedGltfLoadDiagnosticsSnapshot = (
  runtime: PreparedGltfRuntime,
): WebGlGltfLoadDiagnosticsSnapshot => gltfLoadDiagnosticsSnapshot(
  [...runtime.states.values()].map((state) => ({
    ...(state.error === undefined ? {} : { error: state.error }),
    lightCount: state.lights.length,
    load: state.load,
    nodeCount: state.nodeCount,
    primitiveCount: state.primitives.length,
    sourceUri: state.sourceUri,
    ...(state.sourceVersion === undefined ? {} : { sourceVersion: state.sourceVersion }),
    status: state.status,
    variants: state.variants,
  })),
);
