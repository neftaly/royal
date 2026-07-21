export type ParsedSvgTextureSource = Readonly<{
  document: XMLDocument;
  viewBox: readonly [x: number, y: number, width: number, height: number];
}>;

const SVG_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/iu;
const MAX_SVG_SOURCE_BYTES = 16 * 1024 * 1024;
const FORBIDDEN_ELEMENTS = "a, animate, animateMotion, animateTransform, discard, foreignObject, image, script, set";

const svgLength = (value: string | null): number | undefined => {
  if (value === null || !SVG_NUMBER.test(value.trim())) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const unsupportedCss = (value: string): boolean => {
  if (/@import\b/iu.test(value)) return true;
  if (/\b(?:animation|transition)(?:-[\w-]+)?\s*:/iu.test(value)) return true;
  for (const match of value.matchAll(/url\(([^)]*)\)/giu)) {
    const target = match[1]?.trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/u, "$1$2") ?? "";
    if (!target.startsWith("#")) return true;
  }
  return false;
};

const validateSelfContainedProfile = (document: XMLDocument, root: Element): void => {
  if (document.doctype !== null) {
    throw new TypeError("Royal SVG textures do not allow document type declarations");
  }
  for (let index = 0; index < document.childNodes.length; index += 1) {
    if (document.childNodes[index]?.nodeType === 7) {
      throw new TypeError("Royal SVG textures do not allow processing instructions");
    }
  }
  const forbidden = root.querySelector(FORBIDDEN_ELEMENTS);
  if (forbidden !== null) {
    throw new TypeError(`Royal SVG textures do not allow <${forbidden.localName}>`);
  }
  const validateElement = (element: Element): void => {
    for (let attributeIndex = 0; attributeIndex < element.attributes.length; attributeIndex += 1) {
      const attribute = element.attributes[attributeIndex]!;
      const name = attribute.localName.toLowerCase();
      if (name.startsWith("on")) {
        throw new TypeError("Royal SVG textures do not allow event-handler attributes");
      }
      if (name === "base" && attribute.namespaceURI === "http://www.w3.org/XML/1998/namespace") {
        throw new TypeError("Royal SVG textures do not allow xml:base URI rewriting");
      }
      if ((name === "href" || name === "xlink:href") && !attribute.value.trim().startsWith("#")) {
        throw new TypeError("Royal SVG textures allow only local fragment references");
      }
      if (unsupportedCss(attribute.value)) {
        throw new TypeError("Royal SVG textures do not allow CSS animation or external resources");
      }
    }
    if (element.localName === "style" && unsupportedCss(element.textContent ?? "")) {
      throw new TypeError("Royal SVG textures do not allow CSS animation, external stylesheets, or fonts");
    }
  };
  validateElement(root);
  const elements = root.querySelectorAll("*");
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    validateElement(elements[elementIndex]!);
  }
};

/** Parses the bounded self-contained SVG profile shared by ordinary decode and automatic VT. */
export const parseSvgTextureSource = (source: string): ParsedSvgTextureSource => {
  if (typeof DOMParser !== "function") {
    throw new Error("Royal SVG texture validation requires DOMParser");
  }
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || root.querySelector("parsererror") !== null) {
    throw new TypeError("Royal SVG texture source is not valid SVG XML");
  }
  validateSelfContainedProfile(document, root);
  const viewBoxValues = root.getAttribute("viewBox")?.trim().split(/[\s,]+/u).map(Number);
  let viewBox: readonly [number, number, number, number] | undefined;
  if (
    viewBoxValues?.length === 4
    && viewBoxValues.every(Number.isFinite)
    && viewBoxValues[2]! > 0
    && viewBoxValues[3]! > 0
  ) viewBox = [viewBoxValues[0]!, viewBoxValues[1]!, viewBoxValues[2]!, viewBoxValues[3]!];
  if (viewBox === undefined) {
    const width = svgLength(root.getAttribute("width"));
    const height = svgLength(root.getAttribute("height"));
    if (width === undefined || height === undefined) {
      throw new TypeError("Royal SVG textures require a positive viewBox or intrinsic size");
    }
    viewBox = [0, 0, width, height];
  }
  return { document, viewBox };
};

export const validateSvgTextureBlob = async (
  blob: Blob,
  signal: AbortSignal,
): Promise<ParsedSvgTextureSource> => {
  if (blob.size > MAX_SVG_SOURCE_BYTES) {
    throw new RangeError("Royal SVG texture source exceeds the 16 MiB encoded limit");
  }
  if (signal.aborted) throw new DOMException("SVG texture validation was aborted", "AbortError");
  const source = await blob.text();
  if (signal.aborted) throw new DOMException("SVG texture validation was aborted", "AbortError");
  return parseSvgTextureSource(source);
};
