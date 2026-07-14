import type { GltfAssetRef } from "@royal/renderer-core";
import { useMemo, useSyncExternalStore } from "react";
import { useCanvasRoot } from "./canvas";
import { validateGltfAssetStatusInput } from "./gltf-asset-identity";
import { createObservedExternalStore } from "./observed-external-store";
import type { RoyalGltfAssetSnapshot } from "./root";

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

const sameStatus = (left: GltfAssetStatus, right: GltfAssetStatus): boolean =>
  left.state === right.state && left.error === right.error;

const sameVariants = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((name, index) => name === right[index]);

const statusFromAssetSnapshot = (snapshot: RoyalGltfAssetSnapshot): GltfAssetStatus =>
  snapshot.state === "idle"
    ? IDLE
    : snapshot.state === "loading"
      ? LOADING
      : snapshot.state === "ready"
        ? READY
        : Object.freeze({ error: snapshot.error ?? "glTF asset failed to load", state: "error" as const });

/**
 * Observes one glTF asset retained by the surrounding Canvas without polling.
 * A string matches an unversioned source URI; pass the original `GltfAssetRef`
 * when the scene uses an explicit `version`.
 */
export const useGltfAssetStatus = (input: GltfAssetStatusInput): GltfAssetStatus => {
  validateGltfAssetStatusInput(input);
  const root = useCanvasRoot();
  const sourceUri = typeof input === "string" ? input : input.uri;
  const sourceVersion = typeof input === "string" ? undefined : input.version;
  const store = useMemo(() => {
    if (root === null) {
      return createObservedExternalStore(IDLE, () => () => undefined, sameStatus);
    }
    const asset: GltfAssetRef = {
      uri: sourceUri,
      ...(sourceVersion === undefined ? {} : { version: sourceVersion }),
    };
    return createObservedExternalStore(
      statusFromAssetSnapshot(root.gltfAssetSnapshot(asset)),
      (publish) => root.observeGltfAsset(asset, (snapshot) => publish(statusFromAssetSnapshot(snapshot))),
      sameStatus,
    );
  }, [root, sourceUri, sourceVersion]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => IDLE);
};

/**
 * Observes the ordered `KHR_materials_variants` names declared by one retained
 * glTF asset. Returns an empty immutable list until that exact asset is ready.
 * The names can be passed directly to the scene descriptor's `variant` option.
 */
export const useGltfAssetVariants = (input: GltfAssetStatusInput): readonly string[] => {
  validateGltfAssetStatusInput(input);
  const root = useCanvasRoot();
  const sourceUri = typeof input === "string" ? input : input.uri;
  const sourceVersion = typeof input === "string" ? undefined : input.version;
  const store = useMemo(() => {
    if (root === null) {
      return createObservedExternalStore(NO_VARIANTS, () => () => undefined, sameVariants);
    }
    const asset: GltfAssetRef = {
      uri: sourceUri,
      ...(sourceVersion === undefined ? {} : { version: sourceVersion }),
    };
    const variants = (snapshot: RoyalGltfAssetSnapshot): readonly string[] =>
      snapshot.state === "ready" ? snapshot.variantNames : NO_VARIANTS;
    return createObservedExternalStore(
      variants(root.gltfAssetSnapshot(asset)),
      (publish) => root.observeGltfAsset(asset, (snapshot) => publish(variants(snapshot))),
      sameVariants,
    );
  }, [root, sourceUri, sourceVersion]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => NO_VARIANTS);
};
