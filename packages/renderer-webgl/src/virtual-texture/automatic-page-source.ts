import type { TextureSamplerWrap } from "@royal/renderer-core";
import type { CanonicalTextureSampler } from "../surface/canonical-material";
import type { DecodedImageTextureSource, DecodedTextureSource } from "../texture/asset-owner";
import type { EncodedSvgTextureSource } from "../texture/asset-owner";
import { decodeBrowserImageElement } from "../texture/browser-image-element";
import {
  createGeneratedVirtualTextureManifest,
  DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS,
  type VirtualTexturePageId,
} from "./manifest";
import type {
  DecodedVirtualTexturePage,
  VirtualTexturePageSource,
} from "./browser-page-source";

export const AUTOMATIC_VT_MIN_LONG_EDGE = 257;
const AUTOMATIC_VT_PAGE_SIZE = 128;
const AUTOMATIC_VT_BORDER_TEXELS = 2;
const AUTOMATIC_VT_MIN_SOURCE_TEXELS = DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS
  * (AUTOMATIC_VT_PAGE_SIZE + AUTOMATIC_VT_BORDER_TEXELS * 2) ** 2;
const AUTOMATIC_SVG_MAX_LONG_EDGE = 16_384;

type AxisSegment = Readonly<{
  destinationExtent: number;
  destinationStart: number;
  reversed: boolean;
  sourceExtent: number;
  sourceStart: number;
}>;

const segment = (
  origin: number,
  span: number,
  destinationExtent: number,
  sourceStart: number,
  sourceExtent: number,
  intervalStart: number,
  intervalExtent: number,
  reversed: boolean,
): AxisSegment => ({
  destinationExtent: intervalExtent / span * destinationExtent,
  destinationStart: (intervalStart - origin) / span * destinationExtent,
  reversed,
  sourceExtent,
  sourceStart,
});

/** Pure source/destination partition used for gutters and authored wrap behavior. */
export const planAutomaticVirtualTextureAxis = (
  origin: number,
  span: number,
  sourceExtent: number,
  destinationExtent: number,
  wrap: TextureSamplerWrap,
): readonly AxisSegment[] => {
  if (!(span > 0) || !(sourceExtent > 0) || !(destinationExtent > 0)) return [];
  const end = origin + span;
  if (wrap === "clamp-to-edge") {
    const segments: AxisSegment[] = [];
    const beforeEnd = Math.min(end, 0);
    if (origin < beforeEnd) {
      segments.push(segment(
        origin, span, destinationExtent, 0, Math.min(1, sourceExtent),
        origin, beforeEnd - origin, false,
      ));
    }
    const insideStart = Math.max(origin, 0);
    const insideEnd = Math.min(end, sourceExtent);
    if (insideStart < insideEnd) {
      segments.push(segment(
        origin, span, destinationExtent, insideStart, insideEnd - insideStart,
        insideStart, insideEnd - insideStart, false,
      ));
    }
    const afterStart = Math.max(origin, sourceExtent);
    if (afterStart < end) {
      segments.push(segment(
        origin, span, destinationExtent, Math.max(0, sourceExtent - 1),
        Math.min(1, sourceExtent), afterStart, end - afterStart, false,
      ));
    }
    return segments;
  }

  const segments: AxisSegment[] = [];
  let cursor = origin;
  while (cursor < end) {
    const period = Math.floor(cursor / sourceExtent);
    const local = cursor - period * sourceExtent;
    const intervalExtent = Math.min(end - cursor, sourceExtent - local);
    const reversed = wrap === "mirrored-repeat" && Math.abs(period % 2) === 1;
    segments.push(segment(
      origin,
      span,
      destinationExtent,
      reversed ? sourceExtent - local - intervalExtent : local,
      intervalExtent,
      cursor,
      intervalExtent,
      reversed,
    ));
    cursor += intervalExtent;
  }
  return segments;
};

const drawSegment = (
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  x: AxisSegment,
  y: AxisSegment,
  sourceScaleX = 1,
  sourceScaleY = 1,
): void => {
  context.save();
  context.translate(
    x.destinationStart + (x.reversed ? x.destinationExtent : 0),
    y.destinationStart + (y.reversed ? y.destinationExtent : 0),
  );
  context.scale(x.reversed ? -1 : 1, y.reversed ? -1 : 1);
  context.drawImage(
    source,
    x.sourceStart * sourceScaleX,
    y.sourceStart * sourceScaleY,
    x.sourceExtent * sourceScaleX,
    y.sourceExtent * sourceScaleY,
    0,
    0,
    x.destinationExtent,
    y.destinationExtent,
  );
  context.restore();
};

export const automaticVirtualTextureEligible = (
  source: DecodedTextureSource,
): source is DecodedImageTextureSource => source.kind !== "ktx2-etc2"
  && Math.max(source.width, source.height) >= AUTOMATIC_VT_MIN_LONG_EDGE
  && source.width * source.height > AUTOMATIC_VT_MIN_SOURCE_TEXELS;

export const automaticVirtualTextureIsSvg = (
  source: DecodedTextureSource,
): source is DecodedImageTextureSource & Readonly<{ encodedSvg: EncodedSvgTextureSource }> =>
  source.kind !== "ktx2-etc2" && source.encodedSvg !== undefined;

const renderAutomaticPage = (
  manifest: ReturnType<typeof createGeneratedVirtualTextureManifest>,
  sampler: CanonicalTextureSampler,
  image: CanvasImageSource,
  sourceScaleX: number,
  sourceScaleY: number,
  page: VirtualTexturePageId,
  signal: AbortSignal,
): DecodedVirtualTexturePage => {
  if (signal.aborted) throw new DOMException("VT page generation was aborted", "AbortError");
  const canvas = document.createElement("canvas");
  const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
  canvas.width = storedPageSize;
  canvas.height = storedPageSize;
  const context = canvas.getContext("2d", { alpha: true });
  if (context === null) throw new Error("Royal automatic VT could not allocate a page canvas");
  context.clearRect(0, 0, storedPageSize, storedPageSize);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const sourceTexelsPerMipTexel = 2 ** page.mip;
  const sourceX = (page.x * manifest.pageSize - manifest.borderTexels)
    * sourceTexelsPerMipTexel;
  const sourceY = (page.y * manifest.pageSize - manifest.borderTexels)
    * sourceTexelsPerMipTexel;
  const sourceSpan = storedPageSize * sourceTexelsPerMipTexel;
  const xs = planAutomaticVirtualTextureAxis(
    sourceX,
    sourceSpan,
    manifest.width,
    storedPageSize,
    sampler.wrapS,
  );
  const ys = planAutomaticVirtualTextureAxis(
    sourceY,
    sourceSpan,
    manifest.height,
    storedPageSize,
    sampler.wrapT,
  );
  for (const y of ys) for (const x of xs) {
    drawSegment(context, image, x, y, sourceScaleX, sourceScaleY);
  }
  if (signal.aborted) {
    canvas.width = 1;
    canvas.height = 1;
    throw new DOMException("VT page generation was aborted", "AbortError");
  }
  return {
    close: () => {
      canvas.width = 1;
      canvas.height = 1;
    },
    kind: "image",
    source: canvas,
  };
};

/** Browser raster adapter; it owns page canvases but no demand, residency, or GL state. */
export const createAutomaticRasterPageSource = (
  source: DecodedImageTextureSource,
  sampler: CanonicalTextureSampler,
  colorSpace: "linear" | "srgb",
): VirtualTexturePageSource => {
  const manifest = createGeneratedVirtualTextureManifest({
    borderTexels: AUTOMATIC_VT_BORDER_TEXELS,
    colorSpace,
    height: source.height,
    pageSize: AUTOMATIC_VT_PAGE_SIZE,
    width: source.width,
  });
  return {
    manifest,
    read: async (page, signal) => renderAutomaticPage(
      manifest,
      sampler,
      source.source as CanvasImageSource,
      1,
      1,
      page,
      signal,
    ),
  };
};

type ParsedSvgSource = Readonly<{
  document: XMLDocument;
  viewBox: readonly [x: number, y: number, width: number, height: number];
}>;

const SVG_NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/iu;

const svgLength = (value: string | null): number | undefined => {
  if (value === null || !SVG_NUMBER.test(value.trim())) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const parseSvgSource = (source: string): ParsedSvgSource => {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const root = document.documentElement;
  if (root.localName !== "svg" || root.querySelector("parsererror") !== null) {
    throw new TypeError("Royal automatic SVG VT source is not valid SVG XML");
  }
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
      throw new TypeError("Royal automatic SVG VT requires a positive viewBox or intrinsic size");
    }
    viewBox = [0, 0, width, height];
  }
  return { document, viewBox };
};

const loadSvgSource = async (
  blob: Blob,
  signal: AbortSignal,
): Promise<ParsedSvgSource> => {
  if (signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
  const source = await blob.text();
  if (signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
  return parseSvgSource(source);
};

const rasterizeSvgRegion = async (
  source: ParsedSvgSource,
  logicalWidth: number,
  logicalHeight: number,
  x: AxisSegment,
  y: AxisSegment,
  signal: AbortSignal,
): Promise<DecodedImageTextureSource> => {
  if (signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
  const root = source.document.documentElement.cloneNode(true) as SVGSVGElement;
  const [viewX, viewY, viewWidth, viewHeight] = source.viewBox;
  root.setAttribute("viewBox", [
    viewX + x.sourceStart / logicalWidth * viewWidth,
    viewY + y.sourceStart / logicalHeight * viewHeight,
    x.sourceExtent / logicalWidth * viewWidth,
    y.sourceExtent / logicalHeight * viewHeight,
  ].join(" "));
  const width = Math.max(1, Math.ceil(x.destinationExtent));
  const height = Math.max(1, Math.ceil(y.destinationExtent));
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  const blob = new Blob([new XMLSerializer().serializeToString(root)], { type: "image/svg+xml" });
  try {
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      imageOrientation: "none",
      premultiplyAlpha: "none",
    });
    return {
      close: () => bitmap.close(),
      height: bitmap.height,
      source: bitmap,
      width: bitmap.width,
    };
  } catch {
    return decodeBrowserImageElement(blob, signal);
  }
};

const drawRasterizedSvgRegion = (
  context: CanvasRenderingContext2D,
  decoded: DecodedImageTextureSource,
  x: AxisSegment,
  y: AxisSegment,
): void => {
  context.save();
  context.translate(
    x.destinationStart + (x.reversed ? x.destinationExtent : 0),
    y.destinationStart + (y.reversed ? y.destinationExtent : 0),
  );
  context.scale(x.reversed ? -1 : 1, y.reversed ? -1 : 1);
  context.drawImage(
    decoded.source as CanvasImageSource,
    0,
    0,
    decoded.width,
    decoded.height,
    0,
    0,
    x.destinationExtent,
    y.destinationExtent,
  );
  context.restore();
};

const exactPageSegment = (
  axis: readonly AxisSegment[],
  storedPageSize: number,
): AxisSegment | undefined => {
  if (axis.length !== 1) return undefined;
  const value = axis[0]!;
  return !value.reversed
    && value.destinationStart === 0
    && value.destinationExtent === storedPageSize
    ? value
    : undefined;
};

const proveOriginClean = (
  source: CanvasImageSource,
): void => {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const context = probe.getContext("2d", { alpha: true });
  if (context === null) throw new Error("Royal automatic SVG VT could not allocate its origin probe");
  context.drawImage(source, 0, 0, 1, 1);
  context.getImageData(0, 0, 1, 1);
  probe.width = 1;
};

/** Vector-backed automatic source: logical detail grows without a full-resolution bitmap. */
export const createAutomaticSvgPageSource = (
  encodedSource: EncodedSvgTextureSource,
  intrinsicWidth: number,
  intrinsicHeight: number,
  sampler: CanonicalTextureSampler,
  colorSpace: "linear" | "srgb",
): VirtualTexturePageSource => {
  const scale = AUTOMATIC_SVG_MAX_LONG_EDGE / Math.max(intrinsicWidth, intrinsicHeight);
  const width = Math.max(1, Math.round(intrinsicWidth * scale));
  const height = Math.max(1, Math.round(intrinsicHeight * scale));
  const manifest = createGeneratedVirtualTextureManifest({
    borderTexels: AUTOMATIC_VT_BORDER_TEXELS,
    colorSpace,
    height,
    pageSize: AUTOMATIC_VT_PAGE_SIZE,
    width,
  });
  let opened: Promise<ParsedSvgSource> | undefined;
  let encoded: Blob | undefined = encodedSource.blob;
  let closed = false;
  let originClean = false;
  return {
    close: () => {
      closed = true;
      encoded = undefined;
      opened = undefined;
    },
    manifest,
    read: async (page, signal) => {
      if (closed) throw new Error("Royal automatic SVG VT page source is closed");
      opened ??= loadSvgSource(encoded!, signal);
      const source = await opened;
      const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
      const sourceTexelsPerMipTexel = 2 ** page.mip;
      const sourceX = (page.x * manifest.pageSize - manifest.borderTexels)
        * sourceTexelsPerMipTexel;
      const sourceY = (page.y * manifest.pageSize - manifest.borderTexels)
        * sourceTexelsPerMipTexel;
      const sourceSpan = storedPageSize * sourceTexelsPerMipTexel;
      const xs = planAutomaticVirtualTextureAxis(
        sourceX, sourceSpan, manifest.width, storedPageSize, sampler.wrapS,
      );
      const ys = planAutomaticVirtualTextureAxis(
        sourceY, sourceSpan, manifest.height, storedPageSize, sampler.wrapT,
      );
      const exactX = exactPageSegment(xs, storedPageSize);
      const exactY = exactPageSegment(ys, storedPageSize);
      if (exactX !== undefined && exactY !== undefined) {
        const decoded = await rasterizeSvgRegion(source, width, height, exactX, exactY, signal);
        if (!originClean) {
          proveOriginClean(decoded.source as CanvasImageSource);
          originClean = true;
        }
        return {
          close: () => decoded.close?.(),
          kind: "image",
          source: decoded.source,
        };
      }
      const canvas = document.createElement("canvas");
      canvas.width = storedPageSize;
      canvas.height = storedPageSize;
      const context = canvas.getContext("2d", { alpha: true });
      if (context === null) throw new Error("Royal automatic SVG VT could not allocate a page canvas");
      context.clearRect(0, 0, storedPageSize, storedPageSize);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      for (const y of ys) for (const x of xs) {
        const decoded = await rasterizeSvgRegion(source, width, height, x, y, signal);
        try {
          drawRasterizedSvgRegion(context, decoded, x, y);
        } finally {
          decoded.close?.();
        }
      }
      if (!originClean) {
        context.getImageData(0, 0, 1, 1);
        originClean = true;
      }
      return {
        close: () => {
          canvas.width = 1;
          canvas.height = 1;
        },
        kind: "image",
        source: canvas,
      };
    },
  };
};
