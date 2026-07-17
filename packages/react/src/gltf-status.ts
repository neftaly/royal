import type { GltfAssetRef } from "@royal/renderer-core";
import { useMemo, useSyncExternalStore } from "react";
import { useAssetStatusRoot, type AssetStatusOptions } from "./asset-status-root";
import { validateGltfAssetStatusInput } from "./gltf-asset-identity";
import { createObservedExternalStore } from "./observed-external-store";
import type { RoyalRendererGltfAssetSnapshot } from "./root";

export { validateGltfAssetStatusInput } from "./gltf-asset-identity";

/** Observable scene readiness, image progress, timings, and variants for one exact glTF asset. */
export type GltfAssetStatus = RoyalRendererGltfAssetSnapshot;

/** An unversioned source URI, or the exact asset ref used by the scene. */
export type GltfAssetStatusInput = string | GltfAssetRef;

const NO_VARIANTS: readonly string[] = Object.freeze([]);
const IDLE_ASSET: RoyalRendererGltfAssetSnapshot = Object.freeze({
  state: "idle",
  variantNames: NO_VARIANTS,
});

const useGltfAssetSnapshot = (
  input: GltfAssetStatusInput,
  options: AssetStatusOptions | undefined,
): RoyalRendererGltfAssetSnapshot => {
  validateGltfAssetStatusInput(input);
  const root = useAssetStatusRoot(options, "useGltfAssetStatus");
  const src = typeof input === "string" ? input : input.src;
  const version = typeof input === "string" ? undefined : input.version;
  const store = useMemo(() => {
    if (root === null) {
      return createObservedExternalStore(IDLE_ASSET, () => () => undefined);
    }
    const asset: GltfAssetRef = {
      src,
      ...(version === undefined ? {} : { version }),
    };
    return createObservedExternalStore(
      root.gltfAssetSnapshot(asset),
      (publish) => root.observeGltfAsset(asset, publish),
    );
  }, [root, src, version]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => IDLE_ASSET);
};

/**
 * Observes one retained glTF asset without polling. It uses the surrounding
 * Canvas by default; a parent can pass `{ root }` from `Canvas.rendererRef`.
 * A string matches an unversioned source URI; pass the original `GltfAssetRef`
 * when the scene uses an explicit `version`.
 */
export const useGltfAssetStatus = (
  input: GltfAssetStatusInput,
  options?: AssetStatusOptions,
): GltfAssetStatus => {
  return useGltfAssetSnapshot(input, options);
};
