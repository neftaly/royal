import { textureAsset, type TextureAssetRef } from "@royal/renderer-core";
import type { TextureAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import { recordWithAllowedFields } from "../validation";
import {
  selectObservedRoot,
  type RendererObservationOptions,
} from "./select-root";

/** Only descriptor fields that participate in decoded ordinary-texture identity. */
export type TextureAssetStatusIdentity = Readonly<Pick<
  TextureAssetRef,
  "contentKey" | "src" | "version"
>>;
/** Source string, compact identity, or complete texture asset observed by `useTextureAssetStatus`. */
export type TextureAssetStatusInput = string | TextureAssetStatusIdentity | TextureAssetRef;
/** Focused decode lifecycle for one ordinary texture asset. */
export type TextureAssetStatus = TextureAssetSnapshot;

const IDLE: TextureAssetSnapshot = { status: "idle" };
const subscribeIdle = (): (() => void) => () => undefined;
const getIdle = (): TextureAssetSnapshot => IDLE;
const TEXTURE_STATUS_INPUT_FIELDS = [
  "colorSpace", "contentKey", "kind", "sampler", "src", "version",
] as const;

const validateInput = (input: TextureAssetStatusInput): void => {
  if (typeof input === "string") return;
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || ("kind" in input && input.kind !== "asset")
  ) {
    throw new TypeError("useTextureAssetStatus input must be a source string or texture asset identity");
  }
  recordWithAllowedFields(input, TEXTURE_STATUS_INPUT_FIELDS, "useTextureAssetStatus input");
};

const resolveInput = (input: TextureAssetStatusInput): TextureAssetRef => {
  if (typeof input === "string") return textureAsset({ src: input });
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
  validateInput(input);
  const source = typeof input === "string" ? input : input.src;
  const contentKey = typeof input === "string" ? undefined : input.contentKey;
  const version = typeof input === "string" ? undefined : input.version;
  const asset = useMemo(() => resolveInput(typeof input === "string"
    ? source
    : {
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
