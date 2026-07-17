import { useMemo, useSyncExternalStore } from "react";
import { useAssetStatusRoot, type AssetStatusOptions } from "./asset-status-root";
import { createObservedExternalStore } from "./observed-external-store";
import type { RoyalRendererTextureAssetSnapshot } from "./root";
import {
  textureAssetSemanticKey,
  validateTextureAssetRef,
  type TextureAssetStatusInput,
} from "./texture-asset-identity";

export type { TextureAssetStatusInput } from "./texture-asset-identity";

/** Exact renderer readiness for an ordinary image or authored virtual texture. */
export type TextureAssetStatus = RoyalRendererTextureAssetSnapshot;

const ordinaryIdle: TextureAssetStatus = Object.freeze({ kind: "ordinary", state: "idle" });
const virtualIdle: TextureAssetStatus = Object.freeze({
  kind: "virtual",
  pendingPages: 0,
  state: "idle",
});

/**
 * Observes the exact retained texture descriptor. It uses the surrounding
 * Canvas by default; a parent can pass `{ root }` from `Canvas.rendererRef`.
 * For authored VTs, `ready` means the manifest is accepted; `pendingPages`
 * reports visible detail still loading or awaiting GPU publication.
 */
export const useTextureAssetStatus = (
  texture: TextureAssetStatusInput,
  options?: AssetStatusOptions,
): TextureAssetStatus => {
  validateTextureAssetRef(texture, "texture asset status input");
  const root = useAssetStatusRoot(options, "useTextureAssetStatus");
  const semanticKey = textureAssetSemanticKey(texture);
  const store = useMemo(() => {
    const idle = texture.kind === "asset" ? ordinaryIdle : virtualIdle;
    if (root === null) return createObservedExternalStore(idle, () => () => undefined);
    return createObservedExternalStore(
      root.textureAssetSnapshot(texture),
      (publish) => root.observeTextureAsset(texture, publish),
    );
  }, [root, semanticKey]);

  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => texture.kind === "asset" ? ordinaryIdle : virtualIdle,
  );
};
