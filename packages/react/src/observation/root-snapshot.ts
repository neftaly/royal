import type {
  RendererRootSnapshot,
  ResolvedCanvasSize,
  RoyalRendererRoot,
} from "@royal/renderer-webgl";
import { useSyncExternalStore } from "react";

type LifecycleSnapshot = RendererRootSnapshot["context"];

const UNAVAILABLE = undefined;
const subscribeUnavailable = (): (() => void) => () => undefined;
const getUnavailable = (): undefined => UNAVAILABLE;

/** @internal Observes context lifecycle without waking for frames or size changes. */
export const useLifecycleSnapshot = (
  root: RoyalRendererRoot | null,
): LifecycleSnapshot | undefined => useSyncExternalStore(
  root?.subscribeLifecycle ?? subscribeUnavailable,
  root?.getLifecycleSnapshot ?? getUnavailable,
  getUnavailable,
);

/** @internal Observes canvas size without waking for frames or lifecycle changes. */
export const useSizeSnapshot = (
  root: RoyalRendererRoot | null,
): ResolvedCanvasSize | null | undefined => useSyncExternalStore(
  root?.subscribeSize ?? subscribeUnavailable,
  root?.getSizeSnapshot ?? getUnavailable,
  getUnavailable,
);
