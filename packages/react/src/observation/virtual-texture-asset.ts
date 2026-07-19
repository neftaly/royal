import { virtualTexture, type VirtualTextureAssetRef } from "@royal/renderer-core";
import type { VirtualTextureAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas";
import {
  selectObservedRoot,
  type RendererObservationOptions,
} from "./select-root";

export type VirtualTextureStatusInput = string | VirtualTextureAssetRef;
export type VirtualTextureStatus = VirtualTextureAssetSnapshot;

const IDLE: VirtualTextureAssetSnapshot = {
  failedPages: 0,
  pendingPages: 0,
  residentPages: 0,
  state: "idle",
};
const subscribeIdle = (): (() => void) => () => undefined;
const getIdle = (): VirtualTextureAssetSnapshot => IDLE;

const resolveInput = (input: VirtualTextureStatusInput): VirtualTextureAssetRef => {
  if (typeof input === "string") return virtualTexture(input);
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || input.kind !== "virtual-asset"
  ) {
    throw new TypeError(
      "useVirtualTextureStatus input must be a manifest URI or virtual texture identity",
    );
  }
  return input;
};

/** Observes manifest readiness and bounded page residency without frame-wide polling. */
export const useVirtualTextureStatus = (
  input: VirtualTextureStatusInput,
  options?: RendererObservationOptions,
): VirtualTextureStatus => {
  const root = selectObservedRoot(useOptionalCanvasRoot(), options, "useVirtualTextureStatus");
  const asset = useMemo(() => resolveInput(input), [input]);
  const subscribe = useCallback(
    (listener: () => void) => root?.subscribeVirtualTextureAsset(asset, listener) ?? subscribeIdle(),
    [asset, root],
  );
  const getSnapshot = useCallback(
    () => root?.getVirtualTextureAssetSnapshot(asset) ?? getIdle(),
    [asset, root],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getIdle);
};
