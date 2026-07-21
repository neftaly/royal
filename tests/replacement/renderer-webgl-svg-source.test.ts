import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSvgTextureSource } from "../../packages/renderer-webgl/src/texture/svg-source";

afterEach(() => vi.unstubAllGlobals());

type FakeAttribute = Readonly<{ localName: string; namespaceURI?: string; value: string }>;

const parserReturning = (options: Readonly<{
  attributes?: readonly FakeAttribute[];
  doctype?: boolean;
  forbidden?: string;
  height?: string | null;
  viewBox?: string | null;
  width?: string | null;
}> = {}): void => {
  const attributes = options.attributes ?? [];
  const root = {
    attributes,
    getAttribute: (name: string): string | null => {
      if (name === "viewBox") return options.viewBox ?? null;
      if (name === "width") return options.width ?? null;
      if (name === "height") return options.height ?? null;
      return null;
    },
    localName: "svg",
    querySelector: (selector: string) => selector === "parsererror" || options.forbidden === undefined
      ? null
      : { localName: options.forbidden },
    querySelectorAll: () => ({ length: 0 }),
    textContent: "",
  };
  vi.stubGlobal("DOMParser", class {
    parseFromString = (): object => ({
      childNodes: { length: 0 },
      doctype: options.doctype === true ? {} : null,
      documentElement: root,
    });
  });
};

describe("SVG texture source profile", () => {
  it("accepts a finite positive viewBox or unitless intrinsic viewport", () => {
    parserReturning({ viewBox: "-2 3 16 8" });
    expect(parseSvgTextureSource("<svg/>").viewBox).toEqual([-2, 3, 16, 8]);

    parserReturning({ height: "8px", width: "16" });
    expect(parseSvgTextureSource("<svg/>").viewBox).toEqual([0, 0, 16, 8]);
  });

  it("rejects executable, nested-image, and external-resource profile escapes", () => {
    parserReturning({ attributes: [{ localName: "onclick", value: "run()" }], viewBox: "0 0 1 1" });
    expect(() => parseSvgTextureSource("<svg/>")).toThrow("event-handler");

    parserReturning({
      attributes: [{
        localName: "base",
        namespaceURI: "http://www.w3.org/XML/1998/namespace",
        value: "https://example.test/",
      }],
      viewBox: "0 0 1 1",
    });
    expect(() => parseSvgTextureSource("<svg/>")).toThrow("xml:base");

    parserReturning({ forbidden: "image", viewBox: "0 0 1 1" });
    expect(() => parseSvgTextureSource("<svg/>")).toThrow("do not allow <image>");

    parserReturning({ doctype: true, viewBox: "0 0 1 1" });
    expect(() => parseSvgTextureSource("<svg/>")).toThrow("document type");

    parserReturning({
      attributes: [{ localName: "style", value: "fill: url(https://example.test/a.svg)" }],
      viewBox: "0 0 1 1",
    });
    expect(() => parseSvgTextureSource("<svg/>")).toThrow("external resources");
  });

  it("rejects context-dependent or empty intrinsic dimensions", () => {
    parserReturning({ height: "100%", width: "100%" });
    expect(() => parseSvgTextureSource("<svg/>")).toThrow("positive viewBox or intrinsic size");
  });
});
