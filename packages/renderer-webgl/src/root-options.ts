import type { NormalizedWebGlRootOptions, WebGlRootOptions } from "./root-types";
import { defineResourceGovernorPolicy } from "./resource-governor";
import { GENERATED_SVG_VIRTUAL_TEXTURE_DEFAULT_RASTER_DENSITY } from "./svg-texture";

const canonicalOptionValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "number:NaN";
    if (value === Infinity) return "number:Infinity";
    if (value === -Infinity) return "number:-Infinity";
    if (Object.is(value, -0)) return "number:-0";
    return `number:${String(value)}`;
  }
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (Array.isArray(value)) {
    return `[${value.map(canonicalOptionValue).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalOptionValue(record[key])}`)
      .join(",")}}`;
  }

  // WebGlRootOptions is deliberately data-only. Ignore unsupported enumerable
  // values so an accidental extra property cannot destabilize Canvas lifetime.
  return "unsupported";
};

/**
 * Canonical semantic identity for immutable renderer creation options.
 *
 * React uses this backend-owned boundary to decide when a Canvas must recreate
 * its renderer. The normalized shape makes omitted and explicit defaults equal;
 * its exhaustive type also requires new backend options to declare a default here.
 */
export const webGlRootOptionsSemanticKey = (
  options: WebGlRootOptions | undefined,
): string => {
  const normalized: NormalizedWebGlRootOptions = {
    alpha: options?.alpha ?? true,
    antialias: options?.antialias ?? true,
    generatedImageVirtualTextures: options?.generatedImageVirtualTextures ?? false,
    generatedSvgVirtualTextureRasterDensity:
      options?.generatedSvgVirtualTextureRasterDensity
      ?? GENERATED_SVG_VIRTUAL_TEXTURE_DEFAULT_RASTER_DENSITY,
    resourceGovernorPolicy: defineResourceGovernorPolicy(options?.resourceGovernorPolicy),
  };
  return canonicalOptionValue(normalized);
};
