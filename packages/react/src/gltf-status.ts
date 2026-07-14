import type { GltfAssetRef } from "@royal/renderer-core";
import { useMemo, useSyncExternalStore } from "react";
import { useCanvasRoot } from "./canvas";
import { createObservedExternalStore } from "./observed-external-store";

/** Readiness states reported for a glTF asset retained by the current scene. */
export type GltfAssetLoadState = "error" | "idle" | "loading" | "ready";

/** A discriminated glTF readiness snapshot; failures always include a message. */
export type GltfAssetStatus =
  | Readonly<{ error?: never; state: "idle" | "loading" | "ready" }>
  | Readonly<{ error: string; state: "error" }>;

/** An unversioned source URI, or the exact asset ref used by the scene. */
export type GltfAssetStatusInput = string | GltfAssetRef;

const IDLE: GltfAssetStatus = Object.freeze({ state: "idle" });
const LOADING: GltfAssetStatus = Object.freeze({ state: "loading" });
const READY: GltfAssetStatus = Object.freeze({ state: "ready" });

const sameStatus = (left: GltfAssetStatus, right: GltfAssetStatus): boolean =>
  left.state === right.state && left.error === right.error;

const readStatus = (
  root: NonNullable<ReturnType<typeof useCanvasRoot>>,
  sourceUri: string,
  sourceVersion: GltfAssetRef["version"],
): GltfAssetStatus => {
  const asset = root.diagnostics().gltfLoads.assets.find((candidate) =>
    candidate.sourceUri === sourceUri && candidate.sourceVersion === sourceVersion);
  return asset === undefined
    ? IDLE
    : asset.status === "loading"
      ? LOADING
      : asset.status === "sceneReady"
        ? READY
        : Object.freeze({ error: asset.error ?? "glTF asset failed to load", state: "error" as const });
};

/**
 * Observes one glTF asset retained by the surrounding Canvas without polling.
 * A string matches an unversioned source URI; pass the original `GltfAssetRef`
 * when the scene uses an explicit `version`.
 */
export const useGltfAssetStatus = (input: GltfAssetStatusInput): GltfAssetStatus => {
  const root = useCanvasRoot();
  const sourceUri = typeof input === "string" ? input : input.uri;
  const sourceVersion = typeof input === "string" ? undefined : input.version;
  const store = useMemo(() => {
    if (root === null) {
      return createObservedExternalStore(IDLE, () => () => undefined, sameStatus);
    }
    const read = (): GltfAssetStatus => readStatus(root, sourceUri, sourceVersion);
    return createObservedExternalStore(
      read(),
      (publish) => root.observeFrame(() => publish(read())),
      sameStatus,
    );
  }, [root, sourceUri, sourceVersion]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => IDLE);
};
