import type { GltfAssetRef } from "@royal/renderer-core";
import { useEffect, useState } from "react";
import { useCanvasRoot } from "./canvas";

export type GltfAssetLoadState = "error" | "idle" | "loading" | "ready";

export type GltfAssetStatus = Readonly<{
  /** Present when `state` is `error`. */
  error?: string;
  state: GltfAssetLoadState;
}>;

export type GltfAssetStatusInput = string | GltfAssetRef;

const IDLE: GltfAssetStatus = Object.freeze({ state: "idle" });
const LOADING: GltfAssetStatus = Object.freeze({ state: "loading" });
const READY: GltfAssetStatus = Object.freeze({ state: "ready" });

const sameStatus = (left: GltfAssetStatus, right: GltfAssetStatus): boolean =>
  left.state === right.state && left.error === right.error;

/** Observes one glTF asset retained by the surrounding Canvas without polling. */
export const useGltfAssetStatus = (input: GltfAssetStatusInput): GltfAssetStatus => {
  const root = useCanvasRoot();
  const sourceUri = typeof input === "string" ? input : input.uri;
  const sourceVersion = typeof input === "string" ? undefined : input.version;
  const [status, setStatus] = useState<GltfAssetStatus>(IDLE);

  useEffect(() => {
    if (root === null) {
      setStatus(IDLE);
      return undefined;
    }

    return root.observeFrame(() => {
      const asset = root.diagnostics().gltfLoads.assets.find((candidate) =>
        candidate.sourceUri === sourceUri && candidate.sourceVersion === sourceVersion);
      const next = asset === undefined
        ? IDLE
        : asset.status === "loading"
          ? LOADING
          : asset.status === "sceneReady"
            ? READY
            : Object.freeze({ error: asset.error ?? "glTF asset failed to load", state: "error" as const });
      setStatus((current) => sameStatus(current, next) ? current : next);
    });
  }, [root, sourceUri, sourceVersion]);

  return status;
};
