import type {
  WebGlGltfLoadDiagnosticsAssetSnapshot,
  WebGlGltfLoadDiagnosticsPhaseKey,
  WebGlGltfLoadDiagnosticsSnapshot,
} from "../root-types";
import type { GltfLoadMetrics } from "./prepared-asset";
import type { PreparedGltfRuntime, PreparedGltfState } from "./prepared-runtime";
import type { Bounds3 } from "../math/picking";

export type GltfLoadDiagnosticsState = {
  readonly bounds?: Bounds3;
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

const gltfLoadDiagnosticsAssetSnapshot = (
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
    ...(state.bounds === undefined ? {} : {
      bounds: Object.freeze({
        max: Object.freeze([...state.bounds.max]) as [number, number, number],
        min: Object.freeze([...state.bounds.min]) as [number, number, number],
      }),
    }),
    ...(state.error === undefined ? {} : { error: state.error }),
    imageCandidates: load.imageCandidates ?? load.imageRequests,
    imageFailureDetails: Object.freeze((load.imageFailureDetails ?? []).map((failure) => Object.freeze({
      key: failure.key,
      message: failure.message,
    }))),
    imageFailures: load.imageFailures,
    imagesLoaded: load.imageLoaded,
    imageRequests: load.imageRequests,
    lightCount: state.lightCount,
    nodeCount: state.nodeCount,
    phaseMs,
    primitiveCount: state.primitiveCount,
    src: state.sourceUri,
    ...(state.sourceVersion === undefined ? {} : { version: state.sourceVersion }),
    status: state.status === "ready" ? "sceneReady" : state.status,
    variantNames: Object.freeze([...state.variants]),
  };
};

/** Pure public diagnostics projection from detached prepared-asset facts. */
export const gltfLoadDiagnosticsSnapshot = (
  states: Iterable<GltfLoadDiagnosticsState>,
): WebGlGltfLoadDiagnosticsSnapshot => ({
  assets: [...states].map(gltfLoadDiagnosticsAssetSnapshot),
});

/** Reads live prepared state into detached facts before applying the pure projection. */
export const preparedGltfLoadDiagnosticsSnapshot = (
  runtime: PreparedGltfRuntime,
): WebGlGltfLoadDiagnosticsSnapshot => gltfLoadDiagnosticsSnapshot(
  [...runtime.states.values()].map((state) => ({
    ...(state.bounds === undefined ? {} : { bounds: state.bounds }),
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

/** Focused projection for an observed prepared asset. */
export const preparedGltfLoadDiagnosticsAssetSnapshot = (
  state: PreparedGltfState | undefined,
): WebGlGltfLoadDiagnosticsAssetSnapshot | undefined => state === undefined
  ? undefined
  : gltfLoadDiagnosticsAssetSnapshot({
    ...(state.bounds === undefined ? {} : { bounds: state.bounds }),
    ...(state.error === undefined ? {} : { error: state.error }),
    lightCount: state.lights.length,
    load: state.load,
    nodeCount: state.nodeCount,
    primitiveCount: state.primitives.length,
    sourceUri: state.sourceUri,
    ...(state.sourceVersion === undefined ? {} : { sourceVersion: state.sourceVersion }),
    status: state.status,
    variants: state.variants,
  });
