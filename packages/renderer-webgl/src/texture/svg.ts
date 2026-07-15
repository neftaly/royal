import { loadHtmlImage } from "./browser-image-loader";
import { abortError } from "../resource-io";
import {
  registerSvgVirtualTextureSource,
  type SvgVirtualTextureSource,
} from "../virtual-texture/svg-source";
import { createVirtualTextureCanvas, virtualTextureCanvasContext } from "../virtual-texture/canvas";
import { validateVirtualTexturePageImage } from "../virtual-texture/page-image";
import {
  virtualTexturePageKey,
  virtualTextureStoredPageSize,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
} from "../virtual-texture/model";

export { isSvgMimeType, isSvgUri } from "./svg-uri";
export {
  automaticSvgVirtualTextureManifest,
  isLoadedSvgTextureSource,
  svgVirtualTextureSourceForImage,
  type SvgVirtualTextureSource,
} from "../virtual-texture/svg-source";

const AUTOMATIC_SVG_DERIVED_VIEWPORT_MAX_DIMENSION = 1_024;

const svgRootPattern = /<svg\b([^>]*)>/iu;
const svgAttributePattern = /(^|\s+)([^\s"'<>/=]+)\s*=\s*(["'])([\s\S]*?)\3/gu;
const svgDimensionPattern = /^\s*([+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/iu;
const svgTextDecoder = new TextDecoder();
export type LoadedSvgTexture = {
  readonly image: HTMLImageElement;
  readonly text: string;
};

export type SvgTextureViewport = {
  readonly fromViewBox: boolean;
  readonly height: number;
  readonly width: number;
};

const positiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0;

const positiveFiniteProduct = (left: number, right: number): number => {
  if (left > Number.MAX_VALUE / right) return Number.MAX_VALUE;
  const product = left * right;
  // Ratios smaller than the representable range are still valid SVG geometry.
  // Keep the viewport positive; the generated raster will clamp it to one texel.
  return product > 0 ? product : Number.MIN_VALUE;
};

const viewportFromAuthoredWidth = (
  width: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
): SvgTextureViewport => {
  if (viewBoxHeight <= viewBoxWidth) {
    return {
      fromViewBox: true,
      height: positiveFiniteProduct(width, viewBoxHeight / viewBoxWidth),
      width,
    };
  }

  const ratio = viewBoxHeight / viewBoxWidth;
  if (Number.isFinite(ratio) && width <= Number.MAX_VALUE / ratio) {
    return { fromViewBox: true, height: width * ratio, width };
  }

  // The authored width and aspect cannot both fit in a finite Number. Scale the
  // pair uniformly instead of returning Infinity or distorting the aspect.
  return {
    fromViewBox: true,
    height: Number.MAX_VALUE,
    width: positiveFiniteProduct(Number.MAX_VALUE, viewBoxWidth / viewBoxHeight),
  };
};

const viewportFromAuthoredHeight = (
  height: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
): SvgTextureViewport => {
  if (viewBoxWidth <= viewBoxHeight) {
    return {
      fromViewBox: true,
      height,
      width: positiveFiniteProduct(height, viewBoxWidth / viewBoxHeight),
    };
  }

  const ratio = viewBoxWidth / viewBoxHeight;
  if (Number.isFinite(ratio) && height <= Number.MAX_VALUE / ratio) {
    return { fromViewBox: true, height, width: height * ratio };
  }

  return {
    fromViewBox: true,
    height: positiveFiniteProduct(Number.MAX_VALUE, viewBoxHeight / viewBoxWidth),
    width: Number.MAX_VALUE,
  };
};

type SvgAttributeMatch = {
  readonly end: number;
  readonly leadingWhitespace: string;
  readonly start: number;
  readonly value: string;
};

const findSvgAttribute = (attributes: string, name: string): SvgAttributeMatch | undefined => {
  for (const match of attributes.matchAll(svgAttributePattern)) {
    if ((match[2] ?? "").toLowerCase() !== name.toLowerCase()) continue;
    const start = match.index;
    return {
      end: start + match[0].length,
      leadingWhitespace: match[1] ?? "",
      start,
      value: match[4] ?? "",
    };
  }
  return undefined;
};

const svgAttributeValue = (attributes: string, name: string): string | undefined =>
  findSvgAttribute(attributes, name)?.value;

const parseSvgDimension = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const match = svgDimensionPattern.exec(value);
  if (match === null) return undefined;
  const parsed = Number.parseFloat(match[1] ?? "");
  if (!positiveFinite(parsed)) return undefined;

  const cssPixelsPerUnit = (() => {
    switch (match[2]?.toLowerCase()) {
      case "in": return 96;
      case "cm": return 96 / 2.54;
      case "mm": return 96 / 25.4;
      case "pt": return 96 / 72;
      case "pc": return 16;
      case "px":
      case undefined:
        return 1;
      default:
        return 1;
    }
  })();
  return positiveFiniteProduct(parsed, cssPixelsPerUnit);
};

export const svgTextureViewport = (svgText: string): SvgTextureViewport | undefined => {
  const svgRoot = svgRootPattern.exec(svgText);
  if (svgRoot === null) return undefined;

  const attributes = svgRoot[1] ?? "";
  const width = parseSvgDimension(svgAttributeValue(attributes, "width"));
  const height = parseSvgDimension(svgAttributeValue(attributes, "height"));
  if (width !== undefined && height !== undefined) {
    return {
      fromViewBox: false,
      height,
      width,
    };
  }

  const viewBox = svgAttributeValue(attributes, "viewBox");
  if (viewBox === undefined) return undefined;
  const values = viewBox.trim().split(/[\s,]+/u).map((value) => Number(value));
  if (
    values.length !== 4
    || !values.every((value) => Number.isFinite(value))
    || !positiveFinite(values[2] ?? Number.NaN)
    || !positiveFinite(values[3] ?? Number.NaN)
  ) return undefined;

  const viewBoxWidth = values[2]!;
  const viewBoxHeight = values[3]!;
  if (width !== undefined) {
    return viewportFromAuthoredWidth(width, viewBoxWidth, viewBoxHeight);
  }
  if (height !== undefined) {
    return viewportFromAuthoredHeight(height, viewBoxWidth, viewBoxHeight);
  }

  // A viewBox is a coordinate system, not a raster resolution. Give viewBox-only
  // documents a stable, bounded intrinsic viewport while preserving their ratio.
  const largestViewBoxDimension = Math.max(viewBoxWidth, viewBoxHeight);
  return {
    fromViewBox: true,
    height: positiveFiniteProduct(
      AUTOMATIC_SVG_DERIVED_VIEWPORT_MAX_DIMENSION,
      viewBoxHeight / largestViewBoxDimension,
    ),
    width: positiveFiniteProduct(
      AUTOMATIC_SVG_DERIVED_VIEWPORT_MAX_DIMENSION,
      viewBoxWidth / largestViewBoxDimension,
    ),
  };
};

const svgNumberAttribute = (value: number): string => {
  if (Number.isInteger(value)) return String(value);
  const rounded = Number(value.toFixed(6));
  return rounded === 0 && value !== 0 ? String(value) : String(rounded);
};

const escapeSvgAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const setSvgAttribute = (attributes: string, name: string, value: string): string => {
  const attribute = `${name}="${escapeSvgAttribute(value)}"`;
  const existing = findSvgAttribute(attributes, name);
  if (existing !== undefined) {
    return `${attributes.slice(0, existing.start)}${existing.leadingWhitespace}${attribute}${attributes.slice(existing.end)}`;
  }

  return `${attributes} ${attribute}`;
};

const svgTextWithFiniteImageDimensions = (
  svgText: string,
  label: string,
  { requireViewport = true }: { readonly requireViewport?: boolean } = {},
): string => {
  const viewport = svgTextureViewport(svgText);
  if (viewport === undefined) {
    if (!requireViewport) return svgText;
    throw new Error(`${label} requires a finite viewBox or finite width and height`);
  }
  if (!viewport.fromViewBox) return svgText;

  const svgRoot = svgRootPattern.exec(svgText);
  if (svgRoot === null) return svgText;

  let attributes = svgRoot[1] ?? "";
  if (viewport.fromViewBox) {
    attributes = setSvgAttribute(attributes, "width", svgNumberAttribute(viewport.width));
    attributes = setSvgAttribute(attributes, "height", svgNumberAttribute(viewport.height));
  }
  return `${svgText.slice(0, svgRoot.index)}<svg${attributes}>${svgText.slice(svgRoot.index + svgRoot[0].length)}`;
};

export const prepareSvgTextForImage = async (
  svgText: string,
  label: string,
): Promise<string> => svgTextWithFiniteImageDimensions(svgText, label);

const loadImageFromBlob = async (
  blob: Blob,
  label: string,
  signal?: AbortSignal,
): Promise<HTMLImageElement> => {
  if (
    typeof globalThis.URL?.createObjectURL !== "function"
    || typeof globalThis.URL.revokeObjectURL !== "function"
  ) {
    throw new Error(`Object URL loading is unavailable for ${label}`);
  }

  const url = globalThis.URL.createObjectURL(blob);
  try {
    // This URL is renderer-created and same-origin by construction, so CORS
    // mode is unnecessary and would add another browser provenance variable.
    return await loadHtmlImage(url, { applyCors: false, signal });
  } finally {
    globalThis.URL.revokeObjectURL(url);
  }
};

const loadSvgTextImage = async (
  svgText: string,
  label: string,
  signal?: AbortSignal,
): Promise<LoadedSvgTexture> => {
  const normalizedText = await prepareSvgTextForImage(svgText, label);
  const viewport = svgTextureViewport(normalizedText);
  const image = await loadImageFromBlob(new Blob([normalizedText], { type: "image/svg+xml" }), label, signal);
  if (viewport !== undefined) {
    registerSvgVirtualTextureSource(image, {
      height: viewport.height,
      image,
      label,
      text: normalizedText,
      width: viewport.width,
    });
  }

  return {
    image,
    text: normalizedText,
  };
};

const svgTextWithRasterViewport = (
  svgText: string,
  width: number,
  height: number,
  fallbackViewBox: Pick<SvgTextureViewport, "height" | "width">,
): string => {
  const svgRoot = svgRootPattern.exec(svgText);
  if (svgRoot === null) throw new Error("SVG virtual texture source is missing its root element");
  let attributes = svgRoot[1] ?? "";
  attributes = setSvgAttribute(attributes, "width", svgNumberAttribute(width));
  attributes = setSvgAttribute(attributes, "height", svgNumberAttribute(height));
  if (svgAttributeValue(attributes, "viewBox") === undefined) {
    attributes = setSvgAttribute(
      attributes,
      "viewBox",
      `0 0 ${svgNumberAttribute(fallbackViewBox.width)} ${svgNumberAttribute(fallbackViewBox.height)}`,
    );
  }
  return `${svgText.slice(0, svgRoot.index)}<svg${attributes}>${svgText.slice(svgRoot.index + svgRoot[0].length)}`;
};

/** @internal Builds one independently rasterizable vector page at its exact mip resolution. */
export const automaticSvgVirtualTexturePageText = (
  source: SvgVirtualTextureSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): string => {
  const storedPageSize = virtualTextureStoredPageSize(manifest);
  const mipScale = 2 ** page.mip;
  const sourceX = (page.x * manifest.pageSize - manifest.borderTexels) * mipScale;
  const sourceY = (page.y * manifest.pageSize - manifest.borderTexels) * mipScale;
  const sourceExtent = storedPageSize * mipScale;
  const nestedSource = svgTextWithRasterViewport(
    source.text,
    manifest.width,
    manifest.height,
    source,
  );
  const sourceRoot = svgRootPattern.exec(nestedSource);
  if (sourceRoot === null) throw new Error("SVG virtual texture source is missing its root element");
  const sourceElement = nestedSource.slice(sourceRoot.index);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${storedPageSize}" height="${storedPageSize}" viewBox="${svgNumberAttribute(sourceX)} ${svgNumberAttribute(sourceY)} ${svgNumberAttribute(sourceExtent)} ${svgNumberAttribute(sourceExtent)}">${sourceElement}</svg>`;
};

const rasterizeAutomaticSvgVirtualTexturePage = (
  image: HTMLImageElement,
  manifest: VirtualTextureManifestModel,
  label: string,
): ImageData => {
  const storedPageSize = virtualTextureStoredPageSize(manifest);
  const canvas = createVirtualTextureCanvas(storedPageSize, storedPageSize, label);
  const context = virtualTextureCanvasContext(canvas, label);
  context.drawImage(image, 0, 0, storedPageSize, storedPageSize);
  let pixels: ImageData;
  try {
    pixels = context.getImageData(0, 0, storedPageSize, storedPageSize);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} could not produce origin-clean pixels: ${detail}`);
  }
  if (validateVirtualTexturePageImage(manifest, pixels).kind !== "valid") {
    throw new Error(`${label} has an invalid stored extent`);
  }
  return pixels;
};

export const loadAutomaticSvgVirtualTexturePageImage = async (
  source: SvgVirtualTextureSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
  signal: AbortSignal,
): Promise<TexImageSource> => {
  if (signal.aborted) throw abortError();
  const label = `${source.label} virtual texture page ${virtualTexturePageKey(page)}`;
  const pageText = automaticSvgVirtualTexturePageText(source, manifest, page);
  const pageImage = await loadImageFromBlob(new Blob([pageText], { type: "image/svg+xml" }), label, signal);
  if (signal.aborted) throw abortError();
  return rasterizeAutomaticSvgVirtualTexturePage(pageImage, manifest, label);
};

export const loadSvgTextureFromUri = async (url: string, signal?: AbortSignal): Promise<LoadedSvgTexture> => {
  if (signal?.aborted === true) throw abortError();
  const response = await fetch(url, signal === undefined ? undefined : { signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  return loadSvgTextImage(
    await response.text(),
    `SVG texture ${response.url || url}`,
    signal,
  );
};

export const loadSvgTextureFromBytes = (
  bytes: ArrayBuffer,
  label: string,
  signal?: AbortSignal,
): Promise<LoadedSvgTexture> => loadSvgTextImage(
  svgTextDecoder.decode(bytes),
  label,
  signal,
);
