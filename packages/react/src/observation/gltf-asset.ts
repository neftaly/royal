import type { GltfAssetRef } from "@royal/renderer-core";
import type { GltfAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import {
  selectObservedRoot,
  type RendererObservationOptions,
} from "./select-root";

/** Only fields that participate in glTF loading/status identity. */
export type GltfAssetStatusIdentity = Readonly<Pick<GltfAssetRef, "src" | "version">>;
/** Source string or exact source/version identity observed by `useGltfAssetStatus`. */
export type GltfAssetStatusInput = string | GltfAssetStatusIdentity;
/** Focused lifecycle for one glTF asset; drawable states include bounds and texture progress. */
export type GltfAssetStatus = GltfAssetSnapshot;

const IDLE: GltfAssetSnapshot = { state: "idle" };
const subscribeIdle = (): (() => void) => () => undefined;
const getIdle = (): GltfAssetSnapshot => IDLE;

const resolveInput = (input: GltfAssetStatusInput): GltfAssetRef => {
  if (typeof input === "string") {
    if (input.length === 0) throw new TypeError("useGltfAssetStatus source must not be empty");
    return { src: input };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("useGltfAssetStatus input must be a source string or glTF asset identity");
  }
  if (typeof input.src !== "string" || input.src.length === 0) {
    throw new TypeError("useGltfAssetStatus source must not be empty");
  }
  if (input.version !== undefined && (
    (typeof input.version !== "string" || input.version.length === 0)
    && (typeof input.version !== "number" || !Number.isFinite(input.version))
  )) {
    throw new TypeError("useGltfAssetStatus version must be a non-empty string or finite number");
  }
  return input;
};

/** Observes one exact source/version without polling or waking for renderer frames. */
export const useGltfAssetStatus = (
  input: GltfAssetStatusInput,
  options?: RendererObservationOptions,
): GltfAssetStatus => {
  const root = selectObservedRoot(useOptionalCanvasRoot(), options, "useGltfAssetStatus");
  const source = typeof input === "string" ? input : input.src;
  const version = typeof input === "string" ? undefined : input.version;
  const asset = useMemo(() => resolveInput(
    version === undefined ? source : { src: source, version },
  ), [source, version]);
  const subscribe = useCallback(
    (listener: () => void) => root?.subscribeGltfAsset(asset, listener) ?? subscribeIdle(),
    [asset, root],
  );
  const getSnapshot = useCallback(
    () => root?.getGltfAssetSnapshot(asset) ?? getIdle(),
    [asset, root],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getIdle);
};
