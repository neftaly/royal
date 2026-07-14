import type { ResourceGovernorPolicy } from "./resource-governor";
import type { InternalWebGlRootOptions, ResolvedWebGlRootOptions } from "./root-types";
import { defineResourceGovernorPolicy } from "./resource-governor";

export type NormalizedInternalWebGlRootOptions = ResolvedWebGlRootOptions & {
  readonly resourceGovernorPolicy: ResourceGovernorPolicy;
};

/** Pure normalization boundary for internal root construction. */
export const normalizeWebGlRootOptions = (
  options: InternalWebGlRootOptions = {},
): NormalizedInternalWebGlRootOptions => {
  return Object.freeze({
    alpha: options.alpha ?? true,
    antialias: options.antialias ?? true,
    generatedImageVirtualTextures: options.generatedImageVirtualTextures ?? false,
    resourceGovernorPolicy: defineResourceGovernorPolicy(options.resourceGovernorPolicy),
  });
};
