import { useMemo, useSyncExternalStore } from "react";
import { useCanvasRoot } from "./canvas";
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

const sameStatus = (left: TextureAssetStatus, right: TextureAssetStatus): boolean =>
  left.kind === right.kind
  && left.state === right.state
  && left.error === right.error
  && (left.kind === "ordinary"
    || (right.kind === "virtual" && left.pendingPages === right.pendingPages));

/**
 * Observes the exact texture descriptor retained by the surrounding Canvas.
 * For authored VTs, `ready` means the manifest is accepted; `pendingPages`
 * reports visible detail still loading or awaiting GPU publication.
 */
export const useTextureAssetStatus = (texture: TextureAssetStatusInput): TextureAssetStatus => {
  validateTextureAssetRef(texture, "texture asset status input");
  const root = useCanvasRoot();
  const semanticKey = textureAssetSemanticKey(texture);
  const store = useMemo(() => {
    const idle = texture.kind === "asset" ? ordinaryIdle : virtualIdle;
    if (root === null) return createObservedExternalStore(idle, () => () => undefined, sameStatus);
    return createObservedExternalStore(
      root.textureAssetSnapshot(texture),
      (publish) => root.observeTextureAsset(texture, publish),
      sameStatus,
    );
  }, [root, semanticKey]);

  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => texture.kind === "asset" ? ordinaryIdle : virtualIdle,
  );
};
