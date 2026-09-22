import type { DecodedTextureSource, TextureSourceRef } from "./source";

/** Consumer policy for a borrowed, bounded image. Return true to permit display. */
export type TexturePredicate = (image: HTMLCanvasElement, signal: AbortSignal) => Promise<boolean>;
/** Immutable root policy. Change key when the model or thresholds change. */
export type TextureInspection = Readonly<{ key: string; allow: TexturePredicate }>;

/** Shared cold inspection service, loaded only when a configured root needs pixels. */
export interface TextureInspector {
  accept(asset: TextureSourceRef, decoded: DecodedTextureSource, signal: AbortSignal): Promise<DecodedTextureSource>;
  inspect(key: string, sample: (signal: AbortSignal) => Promise<HTMLCanvasElement>, signal: AbortSignal): Promise<void>;
  inspectPixels(key: string, sample: () => Promise<HTMLCanvasElement>, signal: AbortSignal): Promise<void>;
  sample(source: DecodedTextureSource, mip?: number): Promise<HTMLCanvasElement>;
  dispose(): void;
}

/** A declared preview is not evidence about the authoritative image's pixels. */
export const textureInspectionSource = (asset: TextureSourceRef): TextureSourceRef => {
  if (asset.rasterPreview === undefined) return asset;
  const { astc: _preview, rasterPreview: _size, ...raster } = asset;
  return raster;
};

export const createTextureInspectionOwner = (policy: TextureInspection): TextureInspector => {
  let pending: Promise<TextureInspector> | undefined;
  let loaded: TextureInspector | undefined;
  let disposed = false;
  const get = (): Promise<TextureInspector> => {
    if (disposed) return Promise.reject(new DOMException("Texture inspection was aborted", "AbortError"));
    return pending ??= import("./inspection").then(({ TextureInspectionOwner }) => {
      if (disposed) throw new DOMException("Texture inspection was aborted", "AbortError");
      return loaded = new TextureInspectionOwner(policy);
    });
  };
  return {
    accept: async (asset, source, signal) => {
      const owner = await get().catch((error: unknown) => { source.close?.(); throw error; });
      return owner.accept(asset, source, signal);
    },
    inspect: async (key, sample, signal) => (await get()).inspect(key, sample, signal),
    inspectPixels: async (key, sample, signal) => (await get()).inspectPixels(key, sample, signal),
    sample: async (source, mip) => (await get()).sample(source, mip),
    dispose: () => { disposed = true; loaded?.dispose(); },
  };
};
