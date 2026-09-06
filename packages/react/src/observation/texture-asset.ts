import { useAssetSnapshot } from "./asset-snapshot";
import { textureAsset, type TextureAssetRef } from "@royal/renderer-core";
import type { TextureAssetSnapshot } from "@royal/renderer-webgl";
import { useMemo } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import { recordWithAllowedFields } from "../validation";
import {
  selectObservedRoot,
  type RendererHookOptions,
} from "./select-root";

/** Only descriptor fields that participate in decoded ordinary-texture identity. */
export type TextureAssetStatusIdentity = Readonly<Pick<
  TextureAssetRef,
  "contentKey" | "src" | "version"
>> & {
  readonly colorSpace?: never;
  readonly kind?: never;
  readonly sampler?: never;
};
/** Source string, exact decoded identity, or full constructor-produced asset reference. */
export type TextureAssetStatusInput = string | TextureAssetStatusIdentity | TextureAssetRef;
/** Focused decode lifecycle for one ordinary texture asset. */
export type TextureAssetStatus = TextureAssetSnapshot;

const IDLE: TextureAssetSnapshot = { status: "idle" };
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
    || (("colorSpace" in input || "sampler" in input) && input.kind !== "asset")
  ) {
    throw new TypeError("useTextureAssetStatus input must be a source string or texture asset identity");
  }
  recordWithAllowedFields(input, TEXTURE_STATUS_INPUT_FIELDS, "useTextureAssetStatus input");
  textureAsset({
    ...(input.kind === "asset" && input.colorSpace !== undefined
      ? { colorSpace: input.colorSpace }
      : {}),
    ...(input.contentKey === undefined ? {} : { contentKey: input.contentKey }),
    ...(input.kind === "asset" && input.sampler !== undefined
      ? { sampler: input.sampler }
      : {}),
    src: input.src,
    ...(input.version === undefined ? {} : { version: input.version }),
  });
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
  options?: RendererHookOptions,
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
  return useAssetSnapshot(asset, root?.subscribeTextureAsset, root?.getTextureAssetSnapshot, getIdle);
};
