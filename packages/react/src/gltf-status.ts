import type { GltfAssetRef } from "@royal/renderer-core";
import { useMemo, useSyncExternalStore } from "react";
import { useCanvasRoot } from "./canvas";
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

const useGltfAssetSnapshot = (input: GltfAssetStatusInput): RoyalRendererGltfAssetSnapshot => {
  validateGltfAssetStatusInput(input);
  const root = useCanvasRoot();
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
 * Observes one glTF asset retained by the surrounding Canvas without polling.
 * A string matches an unversioned source URI; pass the original `GltfAssetRef`
 * when the scene uses an explicit `version`.
 */
export const useGltfAssetStatus = (input: GltfAssetStatusInput): GltfAssetStatus => {
  return useGltfAssetSnapshot(input);
};
