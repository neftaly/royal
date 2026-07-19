import { virtualTexture, type VirtualTextureAssetRef } from "@royal/renderer-core";
import type { VirtualTextureAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
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

const inputDescriptor = (
  input: VirtualTextureStatusInput,
): VirtualTextureAssetRef | undefined => {
  if (typeof input === "string") return undefined;
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
  const descriptor = inputDescriptor(input);
  const manifestUri = descriptor === undefined ? input as string : descriptor.manifestUri;
  const colorSpace = descriptor?.colorSpace;
  const contentKey = descriptor?.contentKey;
  const version = descriptor?.version;
  const magFilter = descriptor?.sampler?.magFilter;
  const minFilter = descriptor?.sampler?.minFilter;
  const wrapS = descriptor?.sampler?.wrapS;
  const wrapT = descriptor?.sampler?.wrapT;
  const asset = useMemo(() => virtualTexture({
    manifestUri,
    ...(colorSpace === undefined ? {} : { colorSpace }),
    ...(contentKey === undefined ? {} : { contentKey }),
    ...(version === undefined ? {} : { version }),
    ...(magFilter === undefined
      && minFilter === undefined
      && wrapS === undefined
      && wrapT === undefined
      ? {}
      : { sampler: {
        ...(magFilter === undefined ? {} : { magFilter }),
        ...(minFilter === undefined ? {} : { minFilter }),
        ...(wrapS === undefined ? {} : { wrapS }),
        ...(wrapT === undefined ? {} : { wrapT }),
      } }),
  }), [colorSpace, contentKey, magFilter, manifestUri, minFilter, version, wrapS, wrapT]);
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
