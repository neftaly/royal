export type EncodedImageDimensions = Readonly<{
  height: number;
  width: number;
}>;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const isJpegStartOfFrame = (marker: number): boolean => (
  (marker >= 0xc0 && marker <= 0xc3)
  || (marker >= 0xc5 && marker <= 0xc7)
  || (marker >= 0xc9 && marker <= 0xcb)
  || (marker >= 0xcd && marker <= 0xcf)
);

const validDimensions = (width: number, height: number): EncodedImageDimensions | undefined =>
  width > 0 && height > 0 ? { height, width } : undefined;

const readPngDimensions = (bytes: Uint8Array): EncodedImageDimensions | undefined => {
  if (bytes.byteLength < 24) return undefined;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return undefined;
  }
  if (
    bytes[8] !== 0
    || bytes[9] !== 0
    || bytes[10] !== 0
    || bytes[11] !== 13
    || bytes[12] !== 0x49
    || bytes[13] !== 0x48
    || bytes[14] !== 0x44
    || bytes[15] !== 0x52
  ) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return validDimensions(view.getUint32(16), view.getUint32(20));
};

const readJpegDimensions = (bytes: Uint8Array): EncodedImageDimensions | undefined => {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) return undefined;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.byteLength) return undefined;
    const segmentLength = bytes[offset]! * 256 + bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return undefined;
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return undefined;
      const height = bytes[offset + 3]! * 256 + bytes[offset + 4]!;
      const width = bytes[offset + 5]! * 256 + bytes[offset + 6]!;
      return validDimensions(width, height);
    }
    offset += segmentLength;
  }
  return undefined;
};

/** Reads only a PNG/JPEG size hint; browser decoding remains the format authority. */
export const readEncodedImageDimensions = (
  bytes: Uint8Array,
): EncodedImageDimensions | undefined => readPngDimensions(bytes) ?? readJpegDimensions(bytes);
