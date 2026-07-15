import type { CpuGeometry } from "../geometry-recipes";
import { prepareVirtualTextureCoverageProvider } from "./demand";
import type { VirtualTextureCoverageProvider } from "./coverage-provider";

type ProviderRow = {
  texCoords0?: VirtualTextureCoverageProvider;
  texCoords1?: VirtualTextureCoverageProvider;
};

export type VirtualTextureCoverageProviderCache = Map<number, ProviderRow>;

export const createVirtualTextureCoverageProviderCache = (): VirtualTextureCoverageProviderCache => new Map();

export const cachedVirtualTextureCoverageProvider = (
  cache: VirtualTextureCoverageProviderCache,
  geometryId: number,
  geometry: CpuGeometry,
  texCoordSet: 0 | 1,
): VirtualTextureCoverageProvider | undefined => {
  const texCoords = texCoordSet === 1 ? geometry.texCoords1 : geometry.texCoords0;
  if (texCoords === undefined) return undefined;
  const row = cache.get(geometryId) ?? {};
  let provider = texCoordSet === 1 ? row.texCoords1 : row.texCoords0;
  if (provider !== undefined) return provider;
  provider = prepareVirtualTextureCoverageProvider({
    ...(geometry.indices === undefined ? {} : { indices: geometry.indices }),
    positions: geometry.positions,
    texCoords,
  });
  if (texCoordSet === 1) row.texCoords1 = provider;
  else row.texCoords0 = provider;
  cache.set(geometryId, row);
  return provider;
};

/** Semantic geometry release, unlike WebGL context loss, owns this deletion. */
export const releaseVirtualTextureCoverageProviders = (
  cache: VirtualTextureCoverageProviderCache,
  geometryId: number,
): void => {
  cache.delete(geometryId);
};

export const clearVirtualTextureCoverageProviderCache = (
  cache: VirtualTextureCoverageProviderCache,
): void => {
  cache.clear();
};
