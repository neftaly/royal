import type {
  RendererRootSnapshot,
  ResolvedCanvasSize,
  RendererRoot,
} from "@royal/renderer-webgl";
import { useSyncExternalStore } from "react";

type LifecycleSnapshot = RendererRootSnapshot["context"];

const UNAVAILABLE = undefined;
const subscribeUnavailable = (): (() => void) => () => undefined;
const getUnavailable = (): undefined => UNAVAILABLE;

/** @internal Observes context lifecycle without waking for frames or size changes. */
export const useLifecycleSnapshot = (
  root: RendererRoot | null,
): LifecycleSnapshot | undefined => useSyncExternalStore(
  root?.subscribeLifecycle ?? subscribeUnavailable,
  root?.getLifecycleSnapshot ?? getUnavailable,
  getUnavailable,
);

/** @internal Observes canvas size without waking for frames or lifecycle changes. */
export const useSizeSnapshot = (
  root: RendererRoot | null,
): ResolvedCanvasSize | null | undefined => useSyncExternalStore(
  root?.subscribeSize ?? subscribeUnavailable,
  root?.getSizeSnapshot ?? getUnavailable,
  getUnavailable,
);
