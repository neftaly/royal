import type { ResourceGovernorPolicy } from "./resource-governor";
import type { InternalWebGlRootOptions, ResolvedWebGlRootOptions } from "./root-types";
import { defineResourceGovernorPolicy } from "./resource-governor";

export type NormalizedInternalWebGlRootOptions = ResolvedWebGlRootOptions & {
  readonly resourceGovernorPolicy: ResourceGovernorPolicy;
};

const booleanOption = (value: unknown, fallback: boolean, label: string): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
};

/** Pure normalization boundary for internal root construction. */
export const normalizeWebGlRootOptions = (
  options: InternalWebGlRootOptions = {},
): NormalizedInternalWebGlRootOptions => {
  return Object.freeze({
    alpha: booleanOption(options.alpha, true, "WebGL root alpha"),
    antialias: booleanOption(options.antialias, true, "WebGL root antialias"),
    automaticVirtualTextures: booleanOption(
      options.automaticVirtualTextures,
      false,
      "WebGL root automaticVirtualTextures",
    ),
    resourceGovernorPolicy: defineResourceGovernorPolicy(options.resourceGovernorPolicy),
  });
};
