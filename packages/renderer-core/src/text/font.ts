import opentype from 'opentype.js';
import type { Font as OpenTypeFont } from 'opentype.js';

type Woff2Decompress = (buffer: Uint8Array) => Promise<Uint8Array>;
type Woff2DecompressModule = {
  readonly default?: Woff2Decompress;
};

export type TextFontMetrics = {
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly lineHeight: number;
  readonly size: number;
};

export type TextFontDescriptor = {
  readonly family: string;
  readonly metrics: TextFontMetrics;
  readonly unitsPerEm: number;
};

export type TextFontData = ArrayBuffer | ArrayBufferView;

export type TextFontFace = {
  readonly ascender: number;
  readonly descender: number;
  readonly family: string;
  readonly lineGap: number;
  readonly source?: string;
  readonly unitsPerEm: number;
};

export interface CreateTextFontFaceOptions {
  readonly data: TextFontData;
  readonly family?: string;
  readonly source?: string;
}

const minimumTextUnit = 0.0001;
const fontFaceFonts = new WeakMap<TextFontFace, OpenTypeFont>();
let woff2Decompress: Promise<Woff2Decompress> | undefined;

export const missingTextFontMessage =
  'Royal text requires a TextFontFace. Load a font with createTextFontFace() or createTextFontFaceAsync() and pass it as font.';

const positiveTextUnit = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : minimumTextUnit;

const arrayBufferFromFontData = (data: TextFontData): ArrayBuffer => {
  if (data instanceof ArrayBuffer) return data.slice(0);

  const source = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const copy = new ArrayBuffer(source.byteLength);
  new Uint8Array(copy).set(source);
  return copy;
};

const firstNameValue = (record: Readonly<Record<string, string>> | undefined): string | undefined => {
  if (record === undefined) return undefined;
  return record.en ?? Object.values(record)[0];
};

const fontName = (font: OpenTypeFont, key: string): string | undefined =>
  firstNameValue(font.names?.windows?.[key]) ?? firstNameValue(font.names?.macintosh?.[key]);

const fontLineGap = (font: OpenTypeFont): number =>
  font.tables?.hhea?.lineGap ?? font.tables?.os2?.sTypoLineGap ?? 0;

const isWoff2Data = (data: ArrayBuffer): boolean => {
  const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 4));
  return bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32;
};

const loadWoff2Decompress = (): Promise<Woff2Decompress> => {
  woff2Decompress ??= import('wawoff2/decompress').then((module: Woff2DecompressModule) => {
    if (module.default === undefined) throw new Error('wawoff2/decompress did not provide a default export.');
    return module.default;
  });
  return woff2Decompress;
};

const parseTextFontFace = (options: CreateTextFontFaceOptions, data: ArrayBuffer): TextFontFace => {
  const font = opentype.parse(data);
  const face: TextFontFace = Object.freeze({
    ascender: font.ascender,
    descender: font.descender,
    family: options.family ?? fontName(font, 'fontFamily') ?? fontName(font, 'fullName') ?? 'font',
    lineGap: fontLineGap(font),
    ...(options.source === undefined ? {} : { source: options.source }),
    unitsPerEm: font.unitsPerEm
  });
  fontFaceFonts.set(face, font);
  return face;
};

export const createTextFontFace = (options: CreateTextFontFaceOptions): TextFontFace => {
  const data = arrayBufferFromFontData(options.data);
  if (isWoff2Data(data)) {
    throw new Error('WOFF2 text fonts require createTextFontFaceAsync() because WOFF2 decompression is asynchronous.');
  }
  return parseTextFontFace(options, data);
};

export const createTextFontFaceAsync = async (options: CreateTextFontFaceOptions): Promise<TextFontFace> => {
  const data = arrayBufferFromFontData(options.data);
  if (!isWoff2Data(data)) return parseTextFontFace(options, data);

  const decompress = await loadWoff2Decompress();
  const decoded = await decompress(new Uint8Array(data));
  return parseTextFontFace(options, arrayBufferFromFontData(decoded));
};

export const fontForFace = (face: TextFontFace): OpenTypeFont => {
  const font = fontFaceFonts.get(face);
  if (font !== undefined) return font;
  throw new Error('Text font face was not created by createTextFontFace()');
};

const fontFaceMetrics = (
  face: TextFontFace,
  fontSize: number,
  requestedLineHeight: number | undefined
): TextFontMetrics => {
  const size = positiveTextUnit(fontSize);
  const scale = size / face.unitsPerEm;
  const ascender = face.ascender * scale;
  const descender = face.descender * scale;
  const naturalLineHeight = (face.ascender - face.descender + face.lineGap) * scale;
  const lineHeight = positiveTextUnit(requestedLineHeight ?? naturalLineHeight);
  const lineGap = Math.max(0, lineHeight - (ascender - descender));

  return {
    ascender,
    descender,
    lineGap,
    lineHeight,
    size
  };
};

export const fontFaceDescriptor = (
  face: TextFontFace,
  fontSize: number,
  lineHeight: number | undefined
): TextFontDescriptor => ({
  family: face.family,
  metrics: fontFaceMetrics(face, fontSize, lineHeight),
  unitsPerEm: face.unitsPerEm
});

export const textFontDescriptor = (
  face: TextFontFace | undefined,
  fontSize: number,
  lineHeight: number | undefined
): TextFontDescriptor => {
  if (face === undefined) throw new Error(missingTextFontMessage);
  return fontFaceDescriptor(face, fontSize, lineHeight);
};
