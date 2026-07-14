import type { LoadedTextureSource } from "./texture-sources";
import {
  abortError,
  dataUriMediaType,
} from "./gltf/io";

const GENERATED_SVG_DERIVED_VIEWPORT_MAX_DIMENSION = 1_024;

const svgRootPattern = /<svg\b([^>]*)>/iu;
const svgAttributePattern = /(^|\s+)([^\s"'<>/=]+)\s*=\s*(["'])([\s\S]*?)\3/gu;
const svgDimensionPattern = /^\s*([+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:e[+-]?\d+)?)\s*(px|pt|pc|mm|cm|in)?\s*$/iu;
const svgTextDecoder = new TextDecoder();
const loadedSvgTextureSources = new WeakSet<object>();

export type LoadedSvgTexture = {
  readonly image: HTMLImageElement;
  readonly text: string;
};

export type SvgTextureViewport = {
  readonly fromViewBox: boolean;
  readonly height: number;
  readonly width: number;
};

export const isSvgMimeType = (mimeType: string | undefined): boolean =>
  mimeType?.toLowerCase() === "image/svg+xml";

export const isSvgUri = (uri: string): boolean =>
  uri.startsWith("data:")
    ? isSvgMimeType(dataUriMediaType(uri))
    : /\.svg(?:$|[?#])/iu.test(uri);

/** True for sources produced by Royal's safe ordinary SVG ingestion path. */
export const isLoadedSvgTextureSource = (source: LoadedTextureSource): boolean =>
  typeof source === "object" && source !== null && loadedSvgTextureSources.has(source);

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
      GENERATED_SVG_DERIVED_VIEWPORT_MAX_DIMENSION,
      viewBoxHeight / largestViewBoxDimension,
    ),
    width: positiveFiniteProduct(
      GENERATED_SVG_DERIVED_VIEWPORT_MAX_DIMENSION,
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

const loadImage = (
  src: string,
  signal?: AbortSignal,
  applyCors = true,
): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const ImageConstructor = globalThis.Image;
  if (ImageConstructor === undefined) {
    reject(new Error(`Image loading is unavailable for texture ${src}`));
    return;
  }

  const image = new ImageConstructor();
  if (applyCors) image.crossOrigin = "anonymous";
  let settled = false;

  const cleanup = (): void => {
    image.removeEventListener("load", onLoad);
    image.removeEventListener("error", onError);
    signal?.removeEventListener("abort", onAbort);
  };
  const settle = (complete: () => void): void => {
    if (settled) return;
    settled = true;
    cleanup();
    complete();
  };
  const onAbort = (): void => {
    settle(() => {
      image.src = "";
      reject(abortError());
    });
  };
  const onLoad = (): void => {
    image.decode().then(() => {
      settle(() => resolve(image));
    }, (error: unknown) => {
      settle(() => reject(error));
    });
  };
  const onError = (event: Event): void => {
    const message = "message" in event && typeof event.message === "string"
      ? event.message
      : `Image load failed for ${src}`;
    settle(() => reject(new Error(message)));
  };

  image.addEventListener("load", onLoad);
  image.addEventListener("error", onError);
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted === true) {
    onAbort();
    return;
  }
  image.src = src;

  if (image.complete) onLoad();
});

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
    return await loadImage(url, signal, false);
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
  const image = await loadImageFromBlob(new Blob([normalizedText], { type: "image/svg+xml" }), label, signal);
  loadedSvgTextureSources.add(image);

  return {
    image,
    text: normalizedText,
  };
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
