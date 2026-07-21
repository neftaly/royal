export type EncodedImageDimensions = Readonly<{
  height: number;
  width: number;
}>;

const CONTAINER_DIMENSION_PREFIX_BYTES = 128 * 1024;
const JPEG_DIMENSION_PREFIX_BYTES = 16 * 1024;

/** Pure bounded-read policy for the formats whose dimensions Royal can inspect. */
export const encodedImageDimensionPrefixByteLength = (
  mimeType: string,
): number | undefined => {
  switch (mimeType.split(";", 1)[0]!.trim().toLowerCase()) {
    case "image/png": return 24;
    case "image/webp": return 30;
    case "image/jpeg": return JPEG_DIMENSION_PREFIX_BYTES;
    case "":
    case "image/avif":
      return CONTAINER_DIMENSION_PREFIX_BYTES;
    default: return undefined;
  }
};

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

type BmffBox = Readonly<{
  end: number;
  payload: number;
  type: number;
}>;

const AVIF = 0x61766966;
const AVIS = 0x61766973;
const FTYP = 0x66747970;
const IPMA = 0x69706d61;
const IPCO = 0x6970636f;
const IPRP = 0x69707270;
const ISPE = 0x69737065;
const META = 0x6d657461;
const PITM = 0x7069746d;

const bmffBox = (
  view: DataView,
  offset: number,
  parentEnd: number,
): BmffBox | undefined => {
  if (offset < 0 || parentEnd - offset < 8) return undefined;
  let byteLength = view.getUint32(offset);
  let headerBytes = 8;
  if (byteLength === 1) {
    if (parentEnd - offset < 16) return undefined;
    const high = view.getUint32(offset + 8);
    const low = view.getUint32(offset + 12);
    byteLength = high * 0x1_0000_0000 + low;
    headerBytes = 16;
  } else if (byteLength === 0) byteLength = parentEnd - offset;
  if (
    !Number.isSafeInteger(byteLength)
    || byteLength < headerBytes
    || byteLength > parentEnd - offset
  ) return undefined;
  return {
    end: offset + byteLength,
    payload: offset + headerBytes,
    type: view.getUint32(offset + 4),
  };
};

const avifFileType = (view: DataView): boolean => {
  const box = bmffBox(view, 0, view.byteLength);
  if (box?.type !== FTYP || box.end - box.payload < 8) return false;
  const majorBrand = view.getUint32(box.payload);
  if (majorBrand === AVIF || majorBrand === AVIS) return true;
  for (let offset = box.payload + 8; offset + 4 <= box.end; offset += 4) {
    const brand = view.getUint32(offset);
    if (brand === AVIF || brand === AVIS) return true;
  }
  return false;
};

const primaryItemId = (view: DataView, box: BmffBox): number | undefined => {
  if (box.end - box.payload < 6) return undefined;
  const version = view.getUint8(box.payload);
  if (version === 0) return view.getUint16(box.payload + 4);
  if ((version === 1 || version === 2) && box.end - box.payload >= 8) {
    return view.getUint32(box.payload + 4);
  }
  return undefined;
};

const itemPropertyAssociations = (
  view: DataView,
  box: BmffBox,
  itemId: number,
): readonly number[] | undefined => {
  if (box.end - box.payload < 8) return undefined;
  const version = view.getUint8(box.payload);
  if (version > 1) return undefined;
  const flags = view.getUint8(box.payload + 1) * 0x1_0000
    + view.getUint16(box.payload + 2);
  const wideAssociation = (flags & 1) !== 0;
  const associationBytes = wideAssociation ? 2 : 1;
  const entryCount = view.getUint32(box.payload + 4);
  let offset = box.payload + 8;
  for (let entry = 0; entry < entryCount; entry += 1) {
    const itemIdBytes = version === 0 ? 2 : 4;
    if (box.end - offset < itemIdBytes + 1) return undefined;
    const candidate = itemIdBytes === 2 ? view.getUint16(offset) : view.getUint32(offset);
    offset += itemIdBytes;
    const associationCount = view.getUint8(offset);
    offset += 1;
    if (associationCount > Math.floor((box.end - offset) / associationBytes)) return undefined;
    if (candidate !== itemId) {
      offset += associationCount * associationBytes;
      continue;
    }
    const properties: number[] = [];
    for (let index = 0; index < associationCount; index += 1) {
      const association = associationBytes === 1
        ? view.getUint8(offset)
        : view.getUint16(offset);
      offset += associationBytes;
      const propertyIndex = association & (wideAssociation ? 0x7fff : 0x7f);
      if (propertyIndex !== 0) properties.push(propertyIndex);
    }
    return properties;
  }
  return undefined;
};

const itemProperties = (
  view: DataView,
  box: BmffBox,
  itemId: number,
): EncodedImageDimensions | undefined => {
  let propertyDimensions: Array<EncodedImageDimensions | undefined> = [undefined];
  let associations: readonly number[] | undefined;
  for (let offset = box.payload; offset < box.end;) {
    const child = bmffBox(view, offset, box.end);
    if (child === undefined) return undefined;
    if (child.type === IPCO) {
      propertyDimensions = [undefined];
      for (let propertyOffset = child.payload; propertyOffset < child.end;) {
        const property = bmffBox(view, propertyOffset, child.end);
        if (property === undefined) return undefined;
        propertyDimensions.push(property.type === ISPE && property.end - property.payload >= 12
          ? validDimensions(
              view.getUint32(property.payload + 4),
              view.getUint32(property.payload + 8),
            )
          : undefined);
        propertyOffset = property.end;
      }
    } else if (child.type === IPMA) {
      associations = itemPropertyAssociations(view, child, itemId);
    }
    offset = child.end;
  }
  if (associations === undefined) return undefined;
  for (const propertyIndex of associations) {
    const dimensions = propertyDimensions[propertyIndex];
    if (dimensions !== undefined) return dimensions;
  }
  return undefined;
};

const readAvifDimensions = (bytes: Uint8Array): EncodedImageDimensions | undefined => {
  if (bytes.byteLength < 16) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!avifFileType(view)) return undefined;
  for (let offset = 0; offset < view.byteLength;) {
    const box = bmffBox(view, offset, view.byteLength);
    if (box === undefined) return undefined;
    if (box.type === META) {
      if (box.end - box.payload < 4) return undefined;
      let itemId: number | undefined;
      let properties: BmffBox | undefined;
      for (let childOffset = box.payload + 4; childOffset < box.end;) {
        const child = bmffBox(view, childOffset, box.end);
        if (child === undefined) return undefined;
        if (child.type === PITM) itemId = primaryItemId(view, child);
        else if (child.type === IPRP) properties = child;
        childOffset = child.end;
      }
      if (itemId !== undefined && properties !== undefined) {
        return itemProperties(view, properties, itemId);
      }
    }
    offset = box.end;
  }
  return undefined;
};

/** Reads a bounded image size hint; browser decoding remains the format authority. */
export const readEncodedImageDimensions = (
  bytes: Uint8Array,
): EncodedImageDimensions | undefined => readPngDimensions(bytes)
  ?? readJpegDimensions(bytes)
  ?? readWebpDimensions(bytes)
  ?? readAvifDimensions(bytes);
