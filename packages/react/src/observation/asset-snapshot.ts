import { useCallback, useSyncExternalStore } from "react";

const unsubscribeIdle = (): void => {};

/** Shared subscription mechanics; each public hook retains its own validation and identity. */
export const useAssetSnapshot = <Asset, Snapshot>(
  asset: Asset,
  subscribeAsset: ((asset: Asset, listener: () => void) => () => void) | undefined,
  readAsset: ((asset: Asset) => Snapshot) | undefined,
  getIdle: () => Snapshot,
): Snapshot => {
  const subscribe = useCallback(
    (listener: () => void) => subscribeAsset?.(asset, listener) ?? unsubscribeIdle,
    [asset, subscribeAsset],
  );
  const getSnapshot = useCallback(
    () => readAsset?.(asset) ?? getIdle(),
    [asset, readAsset, getIdle],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getIdle);
};
