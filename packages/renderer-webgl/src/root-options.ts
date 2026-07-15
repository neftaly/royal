import type { ResourceGovernorPolicy } from "./resource-governor";
import type {
  InternalWebGlRootOptions,
  ResolvedWebGlRootOptions,
  WebGlRootOptions,
} from "./root-types";
import { defineResourceGovernorPolicy } from "./resource-governor";
import { objectWithAllowedFields } from "./option-values";

export type NormalizedInternalWebGlRootOptions = ResolvedWebGlRootOptions & {
  readonly resourceGovernorPolicy: ResourceGovernorPolicy;
};

const booleanOption = (value: unknown, fallback: boolean, label: string): boolean => {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be a boolean`);
  return value;
};

const WEBGL_ROOT_OPTION_FIELDS = ["alpha", "antialias", "automaticVirtualTextures"] as const;
const INTERNAL_WEBGL_ROOT_OPTION_FIELDS = [...WEBGL_ROOT_OPTION_FIELDS, "resourceGovernorPolicy"] as const;

const resolveOptions = (
  options: WebGlRootOptions,
  allowedFields: readonly string[],
): ResolvedWebGlRootOptions => {
  objectWithAllowedFields(options, allowedFields, "Renderer options");
  return Object.freeze({
    alpha: booleanOption(options.alpha, true, "Renderer alpha"),
    antialias: booleanOption(options.antialias, true, "Renderer antialias"),
    automaticVirtualTextures: booleanOption(
      options.automaticVirtualTextures,
      false,
      "Renderer automaticVirtualTextures",
    ),
  });
};

/** Resolves and validates the public WebGL root creation contract. */
export const resolveWebGlRootOptions = (
  options: WebGlRootOptions = {},
): ResolvedWebGlRootOptions => resolveOptions(options, WEBGL_ROOT_OPTION_FIELDS);

/** Pure normalization boundary for internal root construction. */
export const normalizeWebGlRootOptions = (
  options: InternalWebGlRootOptions = {},
): NormalizedInternalWebGlRootOptions => {
  const resolved = resolveOptions(options, INTERNAL_WEBGL_ROOT_OPTION_FIELDS);
  return Object.freeze({
    ...resolved,
    resourceGovernorPolicy: defineResourceGovernorPolicy(options.resourceGovernorPolicy),
  });
};
