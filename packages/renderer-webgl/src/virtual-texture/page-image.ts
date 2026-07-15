import {
  virtualTextureStoredPageSize,
  type VirtualTextureManifestModel,
} from "./model";

export type VirtualTexturePageImageDimensions = {
  readonly height?: number;
  readonly width?: number;
};

export type VirtualTexturePageImageValidation =
  | {
      readonly height: number;
      readonly kind: "valid";
      readonly storedPageSize: number;
      readonly width: number;
    }
  | {
      readonly height?: number;
      readonly kind: "invalid";
      readonly storedPageSize: number;
      readonly width?: number;
    };

type DimensionSource = {
  readonly displayHeight?: unknown;
  readonly displayWidth?: unknown;
  readonly height?: unknown;
  readonly naturalHeight?: unknown;
  readonly naturalWidth?: unknown;
  readonly videoHeight?: unknown;
  readonly videoWidth?: unknown;
  readonly width?: unknown;
};

const decodedDimension = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/** Reads decoded browser image dimensions in their authoritative DOM priority order. */
export const virtualTexturePageImageDimensions = (
  image: TexImageSource,
): VirtualTexturePageImageDimensions => {
  const source = image as DimensionSource;
  const width = decodedDimension(source.naturalWidth)
    ?? decodedDimension(source.videoWidth)
    ?? decodedDimension(source.displayWidth)
    ?? decodedDimension(source.width);
  const height = decodedDimension(source.naturalHeight)
    ?? decodedDimension(source.videoHeight)
    ?? decodedDimension(source.displayHeight)
    ?? decodedDimension(source.height);
  return {
    ...(height === undefined ? {} : { height }),
    ...(width === undefined ? {} : { width }),
  };
};

/**
 * Authored and generated page images share one decoded-size contract: every
 * upload is a complete physical atlas cell, including gutters on both sides.
 */
export const validateVirtualTexturePageImage = (
  manifest: VirtualTextureManifestModel,
  image: TexImageSource,
): VirtualTexturePageImageValidation => {
  const storedPageSize = virtualTextureStoredPageSize(manifest);
  const { height, width } = virtualTexturePageImageDimensions(image);
  if (width === storedPageSize && height === storedPageSize) {
    return { height, kind: "valid", storedPageSize, width };
  }
  return {
    ...(height === undefined ? {} : { height }),
    kind: "invalid",
    storedPageSize,
    ...(width === undefined ? {} : { width }),
  };
};
