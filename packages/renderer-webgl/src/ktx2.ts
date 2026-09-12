import { parseKtx2Native } from "./texture/ktx2-native";
import { ktx2Etc2StorageBytes, parseKtx2Etc2 } from "./texture/ktx2-etc2";

/** Stable, allocation-small summary returned by the offline ETC2 validator. */
export type Etc2Ktx2Inspection = Readonly<{
  /** Transfer function declared by the validated KTX2 payload. */
  colorSpace: "linear" | "srgb";
  height: number;
  levelCount: number;
  /** Exact ETC2/EAC block bytes across all retained mip levels. */
  storageBytes: number;
  width: number;
}>;

/**
 * Validates Royal's directly uploadable ETC2 RGBA KTX2 profile without WebGL,
 * browser decoding, transcoding, or copying level payloads.
 */
export const inspectEtc2Ktx2 = (bytes: Uint8Array): Etc2Ktx2Inspection => {
  const texture = parseKtx2Etc2(bytes);
  return {
    colorSpace: texture.colorSpace,
    height: texture.height,
    levelCount: texture.levels.length,
    storageBytes: ktx2Etc2StorageBytes(texture),
    width: texture.width,
  };
};

/** Inspects any supported native LDR format, including ETC2, ASTC and BC. */
export const inspectNativeKtx2 = (bytes: Uint8Array): Etc2Ktx2Inspection & Readonly<{
  format: import("./texture/native-storage").NativeTextureFormat;
}> => {
  const texture = parseKtx2Native(bytes);
  return {
    format: texture.format,
    colorSpace: texture.colorSpace,
    height: texture.height,
    levelCount: texture.levels.length,
    storageBytes: ktx2Etc2StorageBytes(texture),
    width: texture.width,
  };
};
