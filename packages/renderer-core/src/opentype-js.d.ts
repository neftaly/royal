declare module 'earcut' {
  export default function earcut(data: readonly number[], holeIndices?: readonly number[], dim?: number): number[];
}

declare module 'opentype.js' {
  export interface GlyphRenderOptions {
    readonly features?: Readonly<Record<string, boolean>>;
    readonly hinting?: boolean;
    readonly kerning?: boolean;
  }

  export type PathCommand =
    | { readonly type: 'M'; readonly x: number; readonly y: number }
    | { readonly type: 'L'; readonly x: number; readonly y: number }
    | {
      readonly type: 'C';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly x: number;
      readonly y: number;
    }
    | { readonly type: 'Q'; readonly x1: number; readonly y1: number; readonly x: number; readonly y: number }
    | { readonly type: 'Z' };

  export interface BoundingBox {
    readonly x1: number;
    readonly x2: number;
    readonly y1: number;
    readonly y2: number;
  }

  export interface Path {
    readonly commands: readonly PathCommand[];
    getBoundingBox(): BoundingBox;
  }

  export interface Glyph {
    readonly advanceWidth?: number;
    readonly index: number;
    readonly name?: string;
    readonly path?: Path;
    readonly unicode?: number;
    readonly unicodes?: readonly number[];
    readonly xMax?: number;
    readonly xMin?: number;
    readonly yMax?: number;
    readonly yMin?: number;
    getBoundingBox(): BoundingBox;
    getPath(x?: number, y?: number, fontSize?: number, options?: GlyphRenderOptions, font?: Font): Path;
  }

  export interface GlyphSet {
    get(index: number): Glyph | undefined;
  }

  export interface Font {
    readonly ascender: number;
    readonly descender: number;
    readonly glyphs: GlyphSet;
    readonly names?: {
      readonly macintosh?: Readonly<Record<string, Readonly<Record<string, string>>>>;
      readonly windows?: Readonly<Record<string, Readonly<Record<string, string>>>>;
    };
    readonly tables?: {
      readonly hhea?: { readonly lineGap?: number };
      readonly os2?: { readonly sTypoLineGap?: number };
    };
    readonly unitsPerEm: number;
    charToGlyph(char: string): Glyph;
    forEachGlyph(
      text: string,
      x: number,
      y: number,
      fontSize: number,
      options: GlyphRenderOptions,
      callback: (glyph: Glyph, x: number, y: number, fontSize: number, options: GlyphRenderOptions) => void
    ): number;
    getKerningValue(leftGlyph: Glyph, rightGlyph: Glyph): number;
    hasChar(char: string): boolean;
    stringToGlyphs(text: string, options?: GlyphRenderOptions): readonly Glyph[];
  }

  const opentype: {
    readonly parse: (buffer: ArrayBuffer) => Font;
  };

  export default opentype;
}
