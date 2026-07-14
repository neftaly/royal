import type { GltfTextureCoordinates } from "./gltf/texture-coordinates";
import type { TextureSamplerWrap } from "@royal/renderer-core";
import type { Mat4 } from "./math/mat4";
import type {
  VirtualTextureDrawDemandModelSource,
  ViewportSize,
} from "./virtual-texture-runtime";
import type { VirtualTextureDemandPlanningWorkspace, VirtualTextureProjection } from "./virtual-texture-demand";
import type { VirtualTextureManifestModel } from "./virtual-texturing";

export type VirtualTextureCoverageGeometry = {
  readonly indices?: Uint8Array | Uint16Array | Uint32Array;
  readonly positions: Float32Array;
  readonly texCoords: Float32Array;
};

export type VirtualTextureCoverageQuery = {
  readonly flipY: boolean;
  readonly modelSource: VirtualTextureDrawDemandModelSource;
  readonly projection: Mat4;
  readonly textureCoordinates?: GltfTextureCoordinates;
  readonly view: Mat4;
  readonly viewportSize: ViewportSize;
  readonly wrapS?: TextureSamplerWrap;
  readonly wrapT?: TextureSamplerWrap;
};

type ExactCoverageEvaluator = (
  geometry: VirtualTextureCoverageGeometry,
  query: VirtualTextureCoverageQuery,
  workspace: VirtualTextureDemandPlanningWorkspace,
  manifest?: VirtualTextureManifestModel,
) => VirtualTextureProjection;

const providerState = Symbol("royal.virtual-texture-coverage-provider-state");

type VirtualTextureCoverageProviderState = {
  readonly evaluate: ExactCoverageEvaluator;
  readonly geometry: VirtualTextureCoverageGeometry;
  readonly validationFailure?: string;
};

/** Package-private prepared geometry adapter; future coverage backends replace this seam. */
export type VirtualTextureCoverageProvider = {
  readonly [providerState]: VirtualTextureCoverageProviderState;
};

const geometryValidationFailure = (geometry: VirtualTextureCoverageGeometry): string | undefined => {
  if (geometry.positions.length === 0 || geometry.positions.length % 3 !== 0) {
    return "positions must contain complete xyz vertices";
  }
  const vertexCount = geometry.positions.length / 3;
  if (geometry.texCoords.length !== vertexCount * 2) {
    return "texture coordinates must contain one uv pair per position";
  }
  for (let index = 0; index < geometry.positions.length; index += 1) {
    if (!Number.isFinite(geometry.positions[index])) return "positions contain a non-finite component";
  }
  for (let index = 0; index < geometry.texCoords.length; index += 1) {
    if (!Number.isFinite(geometry.texCoords[index])) return "texture coordinates contain a non-finite component";
  }
  const indices = geometry.indices;
  if (indices === undefined) {
    return vertexCount % 3 === 0 ? undefined : "non-indexed geometry must contain complete triangles";
  }
  if (indices.length === 0 || indices.length % 3 !== 0) {
    return "indices must contain complete triangles";
  }
  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index]! >= vertexCount) return "indices reference a missing vertex";
  }
  return undefined;
};

/**
 * Borrows immutable geometry arrays and validates them once. Changed bytes need
 * a new semantic geometry declaration and therefore a new provider.
 */
export const createVirtualTextureCoverageProvider = (
  geometry: VirtualTextureCoverageGeometry,
  evaluate: ExactCoverageEvaluator,
): VirtualTextureCoverageProvider => {
  const validationFailure = geometryValidationFailure(geometry);
  return {
    [providerState]: {
      evaluate,
      geometry,
      ...(validationFailure === undefined ? {} : { validationFailure }),
    },
  };
};

export const queryVirtualTextureCoverage = (
  provider: VirtualTextureCoverageProvider,
  query: VirtualTextureCoverageQuery,
  workspace: VirtualTextureDemandPlanningWorkspace,
  manifest?: VirtualTextureManifestModel,
): VirtualTextureProjection => {
  const state = provider[providerState];
  if (state.validationFailure !== undefined) return { kind: "indeterminate" };
  return state.evaluate(state.geometry, query, workspace, manifest);
};
