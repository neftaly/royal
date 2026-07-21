import { virtualTexture, type VirtualTextureAssetRef } from "@royal/renderer-core";
import type { VirtualTextureAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import { recordWithAllowedFields } from "../validation";
import {
  selectObservedRoot,
  type RendererHookOptions,
} from "./select-root";

/** Only descriptor fields that participate in authored VT identity and representation. */
export type VirtualTextureAssetStatusIdentity = Readonly<Pick<
  VirtualTextureAssetRef,
  "colorSpace" | "contentKey" | "manifestUri" | "sampler" | "version"
>>;
/** Manifest URI, compact identity, or complete authored VT asset observed by the hook. */
export type VirtualTextureAssetStatusInput =
  | string
  | VirtualTextureAssetStatusIdentity
  | VirtualTextureAssetRef;
/** Focused manifest lifecycle and current bounded page residency for one authored VT asset. */
export type VirtualTextureAssetStatus = VirtualTextureAssetSnapshot;

const IDLE: VirtualTextureAssetSnapshot = {
  failedPages: 0,
  pendingPages: 0,
  residentPages: 0,
  status: "idle",
};
const subscribeIdle = (): (() => void) => () => undefined;
const getIdle = (): VirtualTextureAssetSnapshot => IDLE;
const VIRTUAL_TEXTURE_STATUS_INPUT_FIELDS = [
  "colorSpace", "contentKey", "kind", "manifestUri", "sampler", "version",
] as const;

const inputDescriptor = (
  input: VirtualTextureAssetStatusInput,
): VirtualTextureAssetStatusIdentity | undefined => {
  if (typeof input === "string") return undefined;
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || ("kind" in input && input.kind !== "virtual-asset")
  ) {
    throw new TypeError(
      "useVirtualTextureAssetStatus input must be a manifest URI or virtual texture identity",
    );
  }
  recordWithAllowedFields(
    input,
    VIRTUAL_TEXTURE_STATUS_INPUT_FIELDS,
    "useVirtualTextureAssetStatus input",
  );
  return input;
};

/** Observes manifest readiness and bounded page residency without frame-wide polling. */
export const useVirtualTextureAssetStatus = (
  input: VirtualTextureAssetStatusInput,
  options?: RendererHookOptions,
): VirtualTextureAssetStatus => {
  const root = selectObservedRoot(
    useOptionalCanvasRoot(),
    options,
    "useVirtualTextureAssetStatus",
  );
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
