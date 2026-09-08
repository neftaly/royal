import { AUTOMATIC_VT_PAGE_SIZE, AUTOMATIC_VT_BORDER_TEXELS } from "./automatic-policy";
export { AUTOMATIC_VT_MIN_LONG_EDGE, automaticVirtualTextureEligible, automaticVirtualTextureIsSvg, automaticVirtualTextureHasPreview } from "./automatic-policy";
import type { TextureSamplerWrap } from "@royal/renderer-core";
import type { CanonicalTextureSampler } from "../texture/sampler";
import type {
  DecodedImageTextureSource,
  EncodedSvgTextureSource,
} from "../texture/source";
import type { ParsedSvgTextureSource } from "../texture/svg-source";
import { decodeBrowserImageElement } from "../texture/browser-image-element";
import { SvgRasterCache } from "./svg-raster-cache";
import {
  createGeneratedVirtualTextureManifest,
  type VirtualTexturePageId,
} from "./manifest";
import type {
  DecodedVirtualTexturePage,
  VirtualTexturePageSource,
} from "./browser-page-source";

const AUTOMATIC_SVG_MAX_LONG_EDGE = 16_384;
const AUTOMATIC_SVG_PAGE_SIZE = 256;

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

const rasterizeSvgRegion = async (
  source: ParsedSvgTextureSource,
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
    return decodeBrowserImageElement(blob, signal, { output: "canvas" });
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

/** One bounded image covers a clamped page and its edge/corner gutters. */
const clampedRasterAxis = (segments: readonly AxisSegment[], texelsPerPixel: number): AxisSegment => {
  let start = Infinity;
  let end = -Infinity;
  for (const segment of segments) {
    start = Math.min(start, segment.sourceStart);
    end = Math.max(end, segment.sourceStart + segment.sourceExtent);
  }
  return { sourceStart: start, sourceExtent: end - start, destinationStart: 0,
    destinationExtent: Math.max(1, Math.ceil((end - start) / texelsPerPixel)), reversed: false };
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
const automaticSvgManifest = (
  intrinsicWidth: number,
  intrinsicHeight: number,
  colorSpace: "linear" | "srgb",
): ReturnType<typeof createGeneratedVirtualTextureManifest> => {
  const scale = AUTOMATIC_SVG_MAX_LONG_EDGE / Math.max(intrinsicWidth, intrinsicHeight);
  const width = Math.max(1, Math.round(intrinsicWidth * scale));
  const height = Math.max(1, Math.round(intrinsicHeight * scale));
  return createGeneratedVirtualTextureManifest({
    borderTexels: AUTOMATIC_VT_BORDER_TEXELS,
    colorSpace,
    height,
    pageSize: AUTOMATIC_SVG_PAGE_SIZE,
    width,
  });
};

/** Small preview coverage and vector detail share one logical page source. */
export const createAutomaticSvgPreviewPageSource = (
  preview: DecodedImageTextureSource & Readonly<{ svgPreview: NonNullable<DecodedImageTextureSource["svgPreview"]> }>,
  sampler: CanonicalTextureSampler,
  colorSpace: "linear" | "srgb",
  rasterCache = new SvgRasterCache(),
): VirtualTexturePageSource => {
  const manifest = automaticSvgManifest(preview.width, preview.height, colorSpace);
  let vector: VirtualTexturePageSource | undefined;
  let closed = false;
  let demand: readonly VirtualTexturePageId[] = [];
  return {
    manifest,
    hasCachedPage: (page) => vector?.hasCachedPage?.(page) ?? false,
    setDemand: (pages) => {
      demand = pages;
      vector?.setDemand?.(pages);
    },
    readPreview: async (page, signal) => {
      if (closed || signal.aborted) throw new DOMException("SVG preview was aborted", "AbortError");
      return renderAutomaticPage(manifest, sampler, preview.source as CanvasImageSource,
        preview.width / manifest.width, preview.height / manifest.height, page, signal);
    },
    close: () => {
      closed = true;
      vector?.close?.();
      vector = undefined;
    },
    read: async (page, signal) => {
      if (closed || signal.aborted) throw new DOMException("SVG preview was aborted", "AbortError");
      // The portable image is a loading/error fallback, not authoritative
      // coarse detail. Small on-screen pieces may never request a finer mip.
      if (page.mip === manifest.mipCount - 1 && preview.svgPreview.error !== undefined) {
        return renderAutomaticPage(
          manifest, sampler, preview.source as CanvasImageSource,
          preview.width / manifest.width, preview.height / manifest.height,
          page, signal,
        );
      }
      const encoded = await preview.svgPreview.load();
      if (closed || signal.aborted) throw new DOMException("SVG refinement was aborted", "AbortError");
      if (vector === undefined) {
        vector = createAutomaticSvgPageSource(encoded, preview.width, preview.height, sampler, colorSpace, rasterCache);
        vector.setDemand?.(demand);
      }
      return vector.read(page, signal);
    },
  };
};

export const createAutomaticSvgPageSource = (
  encodedSource: EncodedSvgTextureSource,
  intrinsicWidth: number,
  intrinsicHeight: number,
  sampler: CanonicalTextureSampler,
  colorSpace: "linear" | "srgb",
  rasterCache = new SvgRasterCache(),
): VirtualTexturePageSource => {
  const manifest = automaticSvgManifest(intrinsicWidth, intrinsicHeight, colorSpace);
  const { width, height } = manifest;
  let parsed: ParsedSvgTextureSource | undefined = encodedSource.parsed;
  let closed = false;
  let originClean = false;
  const abort = new AbortController();
  const sharedMips = new Map<number, object>();
  const regionPages = 512 / manifest.pageSize;
  const sharedRegions = new Map<string, { x: AxisSegment; y: AxisSegment }>();
  const regionFor = (page: VirtualTexturePageId): string => `${page.mip}:${Math.floor(page.x / regionPages)}:${Math.floor(page.y / regionPages)}`;
  const regionAxis = (size: number, startPage: number, scale: number): AxisSegment => {
    const start = Math.max(0, (startPage * manifest.pageSize - manifest.borderTexels) * scale);
    const end = Math.min(size, ((startPage + regionPages) * manifest.pageSize + manifest.borderTexels) * scale);
    return { sourceStart: start, sourceExtent: end - start, destinationStart: 0,
      destinationExtent: Math.ceil((end - start) / scale), reversed: false };
  };
  return {
    hasCachedPage: (page) => {
      const key = sharedMips.get(page.mip) ?? sharedRegions.get(regionFor(page));
      return key !== undefined && rasterCache.has(key);
    },
    setDemand: (pages) => {
      const counts = new Map<number, number>();
      for (const page of pages) counts.set(page.mip, (counts.get(page.mip) ?? 0) + 1);
      for (const [mip, key] of sharedMips) {
        if ((counts.get(mip) ?? 0) <= 1) {
          rasterCache.delete(key);
          sharedMips.delete(mip);
        }
      }
      for (const [mip, count] of counts) {
        if (count > 1 && Math.ceil(Math.max(width, height) / 2 ** mip) <= 512 && !sharedMips.has(mip)) {
          sharedMips.set(mip, {});
        }
      }
      const groups = new Map<string, { page: VirtualTexturePageId; count: number }>();
      if (sampler.wrapS === "clamp-to-edge" && sampler.wrapT === "clamp-to-edge") {
        for (const page of pages) {
          if (Math.ceil(Math.max(width, height) / 2 ** page.mip) <= 512) continue;
          const key = regionFor(page);
          const group = groups.get(key);
          if (group === undefined) groups.set(key, { page, count: 1 });
          else group.count += 1;
        }
      }
      for (const [key, region] of sharedRegions) {
        if ((groups.get(key)?.count ?? 0) <= 1) {
          rasterCache.delete(region);
          sharedRegions.delete(key);
        }
      }
      for (const [key, { page, count }] of groups) {
        if (count <= 1 || sharedRegions.has(key)) continue;
        const scale = 2 ** page.mip;
        const region = {
          x: regionAxis(width, Math.floor(page.x / regionPages) * regionPages, scale),
          y: regionAxis(height, Math.floor(page.y / regionPages) * regionPages, scale),
        };
        // Rounding a partial edge raster would stretch every page in its
        // group. Keep those edges on the existing per-page path instead.
        if (region.x.sourceExtent / scale !== region.x.destinationExtent
          || region.y.sourceExtent / scale !== region.y.destinationExtent) continue;
        sharedRegions.set(key, region);
      }
    },
    close: () => {
      closed = true;
      parsed = undefined;
      abort.abort();
      for (const key of sharedMips.values()) rasterCache.delete(key);
      sharedMips.clear();
      for (const key of sharedRegions.values()) rasterCache.delete(key);
      sharedRegions.clear();
    },
    manifest,
    read: async (page, signal) => {
      if (closed) throw new Error("Royal automatic SVG VT page source is closed");
      if (signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
      const source = parsed!;
      const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
      const sourceTexelsPerMipTexel = 2 ** page.mip;
      const imageWidth = Math.max(1, Math.ceil(width / sourceTexelsPerMipTexel));
      const imageHeight = Math.max(1, Math.ceil(height / sourceTexelsPerMipTexel));
      const region = sharedRegions.get(regionFor(page));
      if (region !== undefined) {
        const cached = await rasterCache.use(region, region.x.destinationExtent * region.y.destinationExtent * 4,
          () => rasterizeSvgRegion(source, width, height, region.x, region.y, abort.signal),
          (decoded) => {
            if (closed || signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
            if (!originClean) {
              proveOriginClean(decoded.source as CanvasImageSource);
              originClean = true;
            }
            const canvas = document.createElement("canvas");
            canvas.width = storedPageSize;
            canvas.height = storedPageSize;
            const context = canvas.getContext("2d", { alpha: true });
            if (context === null) throw new Error("Royal automatic SVG VT could not allocate a page canvas");
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = "high";
            const xs = planAutomaticVirtualTextureAxis((page.x * manifest.pageSize - manifest.borderTexels) * sourceTexelsPerMipTexel,
              storedPageSize * sourceTexelsPerMipTexel, width, storedPageSize, sampler.wrapS);
            const ys = planAutomaticVirtualTextureAxis((page.y * manifest.pageSize - manifest.borderTexels) * sourceTexelsPerMipTexel,
              storedPageSize * sourceTexelsPerMipTexel, height, storedPageSize, sampler.wrapT);
            for (const y of ys) for (const x of xs) drawSegment(context, decoded.source as CanvasImageSource,
              { ...x, sourceStart: x.sourceStart - region.x.sourceStart },
              { ...y, sourceStart: y.sourceStart - region.y.sourceStart },
              region.x.destinationExtent / region.x.sourceExtent, region.y.destinationExtent / region.y.sourceExtent);
            return { kind: "image" as const, source: canvas, close: () => { canvas.width = 1; canvas.height = 1; } };
          });
        if (cached !== undefined) return cached;
      }
      const rasterKey = sharedMips.get(page.mip);
      if (rasterKey !== undefined) {
        const cached = await rasterCache.use(rasterKey, imageWidth * imageHeight * 4,
          () => rasterizeSvgRegion(source, width, height,
            { sourceStart: 0, sourceExtent: width, destinationStart: 0, destinationExtent: imageWidth, reversed: false },
            { sourceStart: 0, sourceExtent: height, destinationStart: 0, destinationExtent: imageHeight, reversed: false },
            abort.signal),
          (decoded) => {
            if (closed || signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
            if (!originClean) {
              proveOriginClean(decoded.source as CanvasImageSource);
              originClean = true;
            }
            return renderAutomaticPage(manifest, sampler, decoded.source as CanvasImageSource,
              imageWidth / width, imageHeight / height, page, signal);
          });
        if (cached !== undefined) return cached;
      }
      if (page.mip === manifest.mipCount - 1) {
        // The whole coarsest image fits in one page. Rasterize once, then
        // populate wrapped/clamped gutters without nine separate SVG decodes.
        const decoded = await rasterizeSvgRegion(source, width, height,
          { sourceStart: 0, sourceExtent: width, destinationStart: 0, destinationExtent: imageWidth, reversed: false },
          { sourceStart: 0, sourceExtent: height, destinationStart: 0, destinationExtent: imageHeight, reversed: false },
          signal);
        try {
          if (closed || signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
          if (!originClean) {
            proveOriginClean(decoded.source as CanvasImageSource);
            originClean = true;
          }
          return renderAutomaticPage(manifest, sampler, decoded.source as CanvasImageSource,
            imageWidth / width, imageHeight / height, page, signal);
        } finally {
          decoded.close?.();
        }
      }
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
        try {
          if (closed || signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
          if (!originClean) {
            proveOriginClean(decoded.source as CanvasImageSource);
            originClean = true;
          }
        } catch (error) {
          decoded.close?.();
          throw error;
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
      if (sampler.wrapS === "clamp-to-edge" && sampler.wrapT === "clamp-to-edge") {
        const regionX = clampedRasterAxis(xs, sourceTexelsPerMipTexel);
        const regionY = clampedRasterAxis(ys, sourceTexelsPerMipTexel);
        const decoded = await rasterizeSvgRegion(source, width, height, regionX, regionY, signal);
        try {
          if (closed || signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
          for (const y of ys) for (const x of xs) {
            drawSegment(context, decoded.source as CanvasImageSource,
              { ...x, sourceStart: x.sourceStart - regionX.sourceStart },
              { ...y, sourceStart: y.sourceStart - regionY.sourceStart },
              regionX.destinationExtent / regionX.sourceExtent,
              regionY.destinationExtent / regionY.sourceExtent);
          }
        } finally {
          decoded.close?.();
        }
      } else {
        for (const y of ys) for (const x of xs) {
          const decoded = await rasterizeSvgRegion(source, width, height, x, y, signal);
          try {
            if (closed || signal.aborted) throw new DOMException("SVG page source was aborted", "AbortError");
            drawRasterizedSvgRegion(context, decoded, x, y);
          } finally {
            decoded.close?.();
          }
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
