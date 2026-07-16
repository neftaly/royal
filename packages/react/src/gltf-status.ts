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

const sameVariants = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);

const sameAssetSnapshot = (
  left: RoyalRendererGltfAssetSnapshot,
  right: RoyalRendererGltfAssetSnapshot,
): boolean => left.state === right.state
  && left.error === right.error
  && sameVariants(left.variantNames, right.variantNames)
  && (left.state === "idle" || right.state === "idle" || (
    left.images.failed === right.images.failed
    && left.images.loaded === right.images.loaded
    && left.images.pending === right.images.pending
    && left.images.requested === right.images.requested
    && left.images.total === right.images.total
    && left.scene.lights === right.scene.lights
    && left.scene.nodes === right.scene.nodes
    && left.scene.primitives === right.scene.primitives
    && left.phaseMs.buffers === right.phaseMs.buffers
    && left.phaseMs.document === right.phaseMs.document
    && left.phaseMs.draco === right.phaseMs.draco
    && left.phaseMs.firstImageComplete === right.phaseMs.firstImageComplete
    && left.phaseMs.imagesComplete === right.phaseMs.imagesComplete
    && left.phaseMs.meshopt === right.phaseMs.meshopt
    && left.phaseMs.scene === right.phaseMs.scene
    && left.phaseMs.toSceneReady === right.phaseMs.toSceneReady
  ));

const useGltfAssetSnapshot = (input: GltfAssetStatusInput): RoyalRendererGltfAssetSnapshot => {
  validateGltfAssetStatusInput(input);
  const root = useCanvasRoot();
  const src = typeof input === "string" ? input : input.src;
  const version = typeof input === "string" ? undefined : input.version;
  const store = useMemo(() => {
    if (root === null) {
      return createObservedExternalStore(IDLE_ASSET, () => () => undefined, sameAssetSnapshot);
    }
    const asset: GltfAssetRef = {
      src,
      ...(version === undefined ? {} : { version }),
    };
    return createObservedExternalStore(
      root.gltfAssetSnapshot(asset),
      (publish) => root.observeGltfAsset(asset, publish),
      sameAssetSnapshot,
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
