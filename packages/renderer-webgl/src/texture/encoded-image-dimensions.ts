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

const matchesAscii = (bytes: Uint8Array, offset: number, text: string): boolean => {
  if (offset + text.length > bytes.byteLength) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[offset + index] !== text.charCodeAt(index)) return false;
  }
  return true;
};

const uint24LittleEndian = (bytes: Uint8Array, offset: number): number =>
  bytes[offset]! | bytes[offset + 1]! << 8 | bytes[offset + 2]! << 16;

const readWebpDimensions = (bytes: Uint8Array): EncodedImageDimensions | undefined => {
  if (
    bytes.byteLength < 20
    || !matchesAscii(bytes, 0, "RIFF")
    || !matchesAscii(bytes, 8, "WEBP")
  ) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkBytes = view.getUint32(16, true);
  if (matchesAscii(bytes, 12, "VP8X")) {
    if (chunkBytes < 10 || bytes.byteLength < 30) return undefined;
    return validDimensions(
      uint24LittleEndian(bytes, 24) + 1,
      uint24LittleEndian(bytes, 27) + 1,
    );
  }
  if (matchesAscii(bytes, 12, "VP8L")) {
    if (chunkBytes < 5 || bytes.byteLength < 25 || bytes[20] !== 0x2f) return undefined;
    const bits = view.getUint32(21, true);
    return validDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (
    matchesAscii(bytes, 12, "VP8 ")
    && chunkBytes >= 10
    && bytes.byteLength >= 30
    && bytes[23] === 0x9d
    && bytes[24] === 0x01
    && bytes[25] === 0x2a
  ) {
    return validDimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
  }
  return undefined;
};

/** Reads only a PNG/JPEG/WebP size hint; browser decoding remains the format authority. */
export const readEncodedImageDimensions = (
  bytes: Uint8Array,
): EncodedImageDimensions | undefined => readPngDimensions(bytes)
  ?? readJpegDimensions(bytes)
  ?? readWebpDimensions(bytes);
