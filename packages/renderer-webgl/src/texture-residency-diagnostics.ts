import { OrdinaryTextureResidencyController } from "./ordinary-texture-residency-controller";
import {
  resourceArenaOrdinaryTextureResidencySnapshot,
  resourceArenaPreparedSourceValues,
  type ResourceArena,
} from "./resource-arena";
import type { WebGlTextureResidencySnapshot } from "./root-types";
import {
  isDecodedRgbaTexture,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "./texture-sources";

/** Builds the detached public ordinary-texture residency snapshot. */
export const textureResidencyDiagnosticsSnapshot = (
  resourceArena: ResourceArena,
  ordinaryTextures: OrdinaryTextureResidencyController,
): WebGlTextureResidencySnapshot => {
  const sources = new Set<LoadedTextureSource>();
  for (const prepared of resourceArenaPreparedSourceValues(resourceArena)) {
    sources.add(prepared.source);
  }
  let preparedBytes = 0;
  for (const source of sources) {
    if (isDecodedRgbaTexture(source)) preparedBytes += source.data.byteLength;
    else {
      const [width, height] = loadedTextureSourceSize(source);
      if (Number.isFinite(width) && Number.isFinite(height)) {
        preparedBytes += Math.max(0, Math.ceil(width)) * Math.max(0, Math.ceil(height)) * 4;
      }
    }
  }
  const ordinary = resourceArenaOrdinaryTextureResidencySnapshot(resourceArena);
  return {
    activeLeases: ordinary.activeLeases,
    activeReferences: ordinary.activeReferences,
    preparedBytes,
    preparedSources: sources.size,
    resources: ordinaryTextures.snapshot().resources,
  };
};
