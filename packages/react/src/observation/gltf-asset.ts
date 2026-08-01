import { gltfAsset, type GltfAssetRef } from "@royal/renderer-core";
import type { GltfAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import { recordWithAllowedFields } from "../validation";
import {
  selectObservedRoot,
  type RendererHookOptions,
} from "./select-root";

/** Only fields that participate in glTF loading/status identity. */
export type GltfAssetStatusIdentity = Readonly<Pick<GltfAssetRef, "sceneIndex" | "src" | "version">>;
/** Source string, exact loading identity, or full constructor-produced asset reference. */
export type GltfAssetStatusInput = string | GltfAssetStatusIdentity | GltfAssetRef;
/** Focused lifecycle for one glTF asset; drawable states include bounds and texture progress. */
export type GltfAssetStatus = GltfAssetSnapshot;

const IDLE: GltfAssetSnapshot = { status: "idle" };
const subscribeIdle = (): (() => void) => () => undefined;
const getIdle = (): GltfAssetSnapshot => IDLE;
const GLTF_STATUS_INPUT_FIELDS = ["bounds", "sceneIndex", "src", "version"] as const;

const validateInputShape = (input: GltfAssetStatusInput): void => {
  if (typeof input === "string") return;
  recordWithAllowedFields(input, GLTF_STATUS_INPUT_FIELDS, "useGltfAssetStatus input");
  gltfAsset(input);
};

const resolveInput = (input: GltfAssetStatusInput): GltfAssetRef => {
  if (typeof input === "string") return gltfAsset(input);
  return gltfAsset({
    ...(input.sceneIndex === undefined ? {} : { sceneIndex: input.sceneIndex }),
    src: input.src,
    ...(input.version === undefined ? {} : { version: input.version }),
  });
};

/** Observes one exact source/version/scene selection without polling renderer frames. */
export const useGltfAssetStatus = (
  input: GltfAssetStatusInput,
  options?: RendererHookOptions,
): GltfAssetStatus => {
  const root = selectObservedRoot(useOptionalCanvasRoot(), options, "useGltfAssetStatus");
  validateInputShape(input);
  const source = typeof input === "string" ? input : input.src;
  const version = typeof input === "string" ? undefined : input.version;
  const sceneIndex = typeof input === "string" ? undefined : input.sceneIndex;
  const asset = useMemo(() => resolveInput(
    {
      ...(sceneIndex === undefined ? {} : { sceneIndex }),
      src: source,
      ...(version === undefined ? {} : { version }),
    },
  ), [sceneIndex, source, version]);
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
