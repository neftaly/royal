import {
  prefilteredEnvironment,
  type PrefilteredEnvironmentLight,
} from "@royal/renderer-core";
import type { PrefilteredEnvironmentAssetSnapshot } from "@royal/renderer-webgl";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useOptionalCanvasRoot } from "../runtime/canvas-context";
import { recordWithAllowedFields } from "../validation";
import {
  selectObservedRoot,
  type RendererHookOptions,
} from "./select-root";

/** Focused transport/preparation lifecycle for one offline environment artifact. */
export type PrefilteredEnvironmentStatus = PrefilteredEnvironmentAssetSnapshot;
/** Only fields that participate in offline-environment loading/status identity. */
export type PrefilteredEnvironmentStatusIdentity = Readonly<Pick<
  PrefilteredEnvironmentLight,
  "src" | "version"
>> & {
  readonly kind?: never;
  readonly radianceScaleNits?: never;
  readonly rotation?: never;
  readonly source?: never;
};
/** Source string, exact loading identity, or full constructor-produced environment ref. */
export type PrefilteredEnvironmentStatusInput =
  | string
  | PrefilteredEnvironmentStatusIdentity
  | PrefilteredEnvironmentLight;

const IDLE: PrefilteredEnvironmentAssetSnapshot = { status: "idle" };
const subscribeIdle = (): (() => void) => () => undefined;
const getIdle = (): PrefilteredEnvironmentAssetSnapshot => IDLE;
const PREFILTERED_ENVIRONMENT_STATUS_INPUT_FIELDS = [
  "kind", "radianceScaleNits", "rotation", "source", "src", "version",
] as const;

const validateInput = (input: PrefilteredEnvironmentStatusInput): void => {
  if (typeof input === "string") return;
  recordWithAllowedFields(
    input,
    PREFILTERED_ENVIRONMENT_STATUS_INPUT_FIELDS,
    "usePrefilteredEnvironmentStatus input",
  );
  const hasFullRefField = "kind" in input
    || "radianceScaleNits" in input
    || "rotation" in input
    || "source" in input;
  if (hasFullRefField
    && (input.kind !== "environment-light" || input.source !== "royal-prefiltered-v1")) {
    throw new TypeError(
      "usePrefilteredEnvironmentStatus presentation fields require a prefiltered environment ref",
    );
  }
  prefilteredEnvironment({
    ...(input.kind === "environment-light"
      ? {
        radianceScaleNits: input.radianceScaleNits,
        rotation: input.rotation,
      }
      : {}),
    src: input.src,
    ...(input.version === undefined ? {} : { version: input.version }),
  });
};

/** Observes one offline environment source/version without frame-wide subscriptions. */
export const usePrefilteredEnvironmentStatus = (
  input: PrefilteredEnvironmentStatusInput,
  options?: RendererHookOptions,
): PrefilteredEnvironmentStatus => {
  const root = selectObservedRoot(
    useOptionalCanvasRoot(),
    options,
    "usePrefilteredEnvironmentStatus",
  );
  validateInput(input);
  const src = typeof input === "string" ? input : input.src;
  const version = typeof input === "string" ? undefined : input.version;
  const environment = useMemo(() => prefilteredEnvironment({
    src,
    ...(version === undefined ? {} : { version }),
  }), [src, version]);
  const subscribe = useCallback(
    (listener: () => void) => root?.subscribePrefilteredEnvironment(
      environment,
      listener,
    ) ?? subscribeIdle(),
    [environment, root],
  );
  const getSnapshot = useCallback(
    () => root?.getPrefilteredEnvironmentSnapshot(environment) ?? getIdle(),
    [environment, root],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getIdle);
};
