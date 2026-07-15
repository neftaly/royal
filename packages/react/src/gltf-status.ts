import type { GltfAssetRef } from "@royal/renderer-core";
import { useMemo, useSyncExternalStore } from "react";
import { useCanvasRoot } from "./canvas";
import { validateGltfAssetStatusInput } from "./gltf-asset-identity";
import { createObservedExternalStore } from "./observed-external-store";
import type { RoyalRendererGltfAssetSnapshot } from "./root";

export { validateGltfAssetStatusInput } from "./gltf-asset-identity";

/** A discriminated glTF readiness snapshot; failures always include a message. */
export type GltfAssetStatus =
  | Readonly<{ error?: never; state: "idle" | "loading" | "ready" }>
  | Readonly<{ error: string; state: "error" }>;

/** An unversioned source URI, or the exact asset ref used by the scene. */
export type GltfAssetStatusInput = string | GltfAssetRef;

const IDLE: GltfAssetStatus = Object.freeze({ state: "idle" });
const LOADING: GltfAssetStatus = Object.freeze({ state: "loading" });
const READY: GltfAssetStatus = Object.freeze({ state: "ready" });
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
  && sameVariants(left.variantNames, right.variantNames);

const statusFromAssetSnapshot = (snapshot: RoyalRendererGltfAssetSnapshot): GltfAssetStatus =>
  snapshot.state === "idle"
    ? IDLE
    : snapshot.state === "loading"
      ? LOADING
      : snapshot.state === "ready"
        ? READY
        : Object.freeze({ error: snapshot.error ?? "glTF asset failed to load", state: "error" as const });

const useGltfAssetSnapshot = (input: GltfAssetStatusInput): RoyalRendererGltfAssetSnapshot => {
  validateGltfAssetStatusInput(input);
  const root = useCanvasRoot();
  const uri = typeof input === "string" ? input : input.uri;
  const version = typeof input === "string" ? undefined : input.version;
  const store = useMemo(() => {
    if (root === null) {
      return createObservedExternalStore(IDLE_ASSET, () => () => undefined, sameAssetSnapshot);
    }
    const asset: GltfAssetRef = {
      uri,
      ...(version === undefined ? {} : { version }),
    };
    return createObservedExternalStore(
      root.gltfAssetSnapshot(asset),
      (publish) => root.observeGltfAsset(asset, publish),
      sameAssetSnapshot,
    );
  }, [root, uri, version]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => IDLE_ASSET);
};

/**
 * Observes one glTF asset retained by the surrounding Canvas without polling.
 * A string matches an unversioned source URI; pass the original `GltfAssetRef`
 * when the scene uses an explicit `version`.
 */
export const useGltfAssetStatus = (input: GltfAssetStatusInput): GltfAssetStatus => {
  const snapshot = useGltfAssetSnapshot(input);
  return useMemo(() => statusFromAssetSnapshot(snapshot), [snapshot]);
};

/**
 * Observes the ordered `KHR_materials_variants` names declared by one retained
 * glTF asset. Returns an empty immutable list until that exact asset is ready.
 * The names can be passed directly to the scene descriptor's `materialVariant` option.
 */
export const useGltfAssetVariants = (input: GltfAssetStatusInput): readonly string[] => {
  const snapshot = useGltfAssetSnapshot(input);
  return snapshot.state === "ready" ? snapshot.variantNames : NO_VARIANTS;
};
