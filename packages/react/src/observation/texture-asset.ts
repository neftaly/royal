import { textureAsset, type TextureAssetRef } from "@royal/renderer-core";
import type { TextureAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas";
import {
  selectObservedRoot,
  type RendererObservationOptions,
} from "./select-root";

export type TextureAssetStatusInput = string | TextureAssetRef;
export type TextureAssetStatus = TextureAssetSnapshot;

const IDLE: TextureAssetSnapshot = { state: "idle" };
const subscribeIdle = (): (() => void) => () => undefined;
const getIdle = (): TextureAssetSnapshot => IDLE;

const resolveInput = (input: TextureAssetStatusInput): TextureAssetRef => {
  if (typeof input === "string") {
    return textureAsset({ src: input });
  }
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || input.kind !== "asset"
  ) {
    throw new TypeError("useTextureAssetStatus input must be a source string or texture asset identity");
  }
  return textureAsset({
    src: input.src,
    ...(input.contentKey === undefined ? {} : { contentKey: input.contentKey }),
    ...(input.version === undefined ? {} : { version: input.version }),
  });
};

/** Observes one decoded content/version identity without polling or frame-wide subscriptions. */
export const useTextureAssetStatus = (
  input: TextureAssetStatusInput,
  options?: RendererObservationOptions,
): TextureAssetStatus => {
  const root = selectObservedRoot(useOptionalCanvasRoot(), options, "useTextureAssetStatus");
  const source = typeof input === "string" ? input : input.src;
  const contentKey = typeof input === "string" ? undefined : input.contentKey;
  const version = typeof input === "string" ? undefined : input.version;
  const asset = useMemo(() => resolveInput(typeof input === "string"
    ? source
    : {
      kind: "asset",
      src: source,
      ...(contentKey === undefined ? {} : { contentKey }),
      ...(version === undefined ? {} : { version }),
    }), [contentKey, source, version]);
  const subscribe = useCallback(
    (listener: () => void) => root?.subscribeTextureAsset(asset, listener) ?? subscribeIdle(),
    [asset, root],
  );
  const getSnapshot = useCallback(
    () => root?.getTextureAssetSnapshot(asset) ?? getIdle(),
    [asset, root],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getIdle);
};
