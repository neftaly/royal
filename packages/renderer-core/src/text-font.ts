import opentype from 'opentype.js';
import type { Font as OpenTypeFont } from 'opentype.js';

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

const builtinTextFamily = 'royal-ascii-prototype';
const minimumTextUnit = 0.0001;
const fontFaceFonts = new WeakMap<TextFontFace, OpenTypeFont>();

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

export const createTextFontFace = (options: CreateTextFontFaceOptions): TextFontFace => {
  const font = opentype.parse(arrayBufferFromFontData(options.data));
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

export const fontForFace = (face: TextFontFace): OpenTypeFont => {
  const font = fontFaceFonts.get(face);
  if (font !== undefined) return font;
  throw new Error('Text font face was not created by createTextFontFace()');
};

const fontMetrics = (fontSize: number, requestedLineHeight: number | undefined): TextFontMetrics => {
  const size = positiveTextUnit(fontSize);
  const naturalLineHeight = size * 1.2;
  const lineHeight = positiveTextUnit(requestedLineHeight ?? naturalLineHeight);
  const ascender = size * 0.82;
  const descender = -size * 0.22;
  const lineGap = Math.max(0, lineHeight - (ascender - descender));

  return {
    ascender,
    descender,
    lineGap,
    lineHeight,
    size
  };
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

export const fontDescriptor = (fontSize: number, lineHeight: number | undefined): TextFontDescriptor => ({
  family: builtinTextFamily,
  metrics: fontMetrics(fontSize, lineHeight),
  unitsPerEm: 1
});

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
): TextFontDescriptor =>
  face === undefined ? fontDescriptor(fontSize, lineHeight) : fontFaceDescriptor(face, fontSize, lineHeight);
