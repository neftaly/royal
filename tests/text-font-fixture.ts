import { readFile } from "node:fs/promises";
import { createTextFontFace, type TextFontFace } from "@royal/renderer-core/text/font";

export const testTextFontUrl = (extension: "woff" | "woff2"): URL =>
  new URL(
    `../packages/renderer-core/node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.${extension}`,
    import.meta.url,
  );

let testFont: Promise<TextFontFace> | undefined;

export const loadTestTextFont = (): Promise<TextFontFace> => {
  testFont ??= readFile(testTextFontUrl("woff")).then((data) =>
    createTextFontFace({
      data,
      source: testTextFontUrl("woff").pathname,
    }));
  return testFont;
};
