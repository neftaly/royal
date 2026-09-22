import { AUTOMATIC_VT_PAGE_SIZE, AUTOMATIC_VT_BORDER_TEXELS } from "./automatic-policy";
export { AUTOMATIC_VT_MIN_LONG_EDGE, automaticVirtualTextureEligible, automaticVirtualTextureHasPreview } from "./automatic-policy";
import type { TextureSamplerWrap } from "@royal/renderer-core";
import type { CanonicalTextureSampler } from "../texture/sampler";
import type {
  DecodedImageTextureSource,
  TexturePreviewSource,
} from "../texture/source";
import {
  createGeneratedVirtualTextureLayout,
  type VirtualTexturePageId,
} from "./layout";
import type {
  DecodedVirtualTexturePage,
  VirtualTexturePageSource,
} from "./page-source";

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
  layout: ReturnType<typeof createGeneratedVirtualTextureLayout>,
  sampler: CanonicalTextureSampler,
  image: CanvasImageSource,
  sourceScaleX: number,
  sourceScaleY: number,
  page: VirtualTexturePageId,
  signal: AbortSignal,
): DecodedVirtualTexturePage => {
  if (signal.aborted) throw new DOMException("VT page generation was aborted", "AbortError");
  const canvas = document.createElement("canvas");
  const storedPageSize = layout.pageSize + layout.borderTexels * 2;
  canvas.width = storedPageSize;
  canvas.height = storedPageSize;
  const context = canvas.getContext("2d", { alpha: true });
  if (context === null) throw new Error("Royal automatic VT could not allocate a page canvas");
  context.clearRect(0, 0, storedPageSize, storedPageSize);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const sourceTexelsPerMipTexel = 2 ** page.mip;
  const sourceX = (page.x * layout.pageSize - layout.borderTexels)
    * sourceTexelsPerMipTexel;
  const sourceY = (page.y * layout.pageSize - layout.borderTexels)
    * sourceTexelsPerMipTexel;
  const sourceSpan = storedPageSize * sourceTexelsPerMipTexel;
  const xs = planAutomaticVirtualTextureAxis(
    sourceX,
    sourceSpan,
    layout.width,
    storedPageSize,
    sampler.wrapS,
  );
  const ys = planAutomaticVirtualTextureAxis(
    sourceY,
    sourceSpan,
    layout.height,
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
  size: Readonly<{ width: number; height: number }> = source,
): VirtualTexturePageSource => {
  const layout = createGeneratedVirtualTextureLayout({
    borderTexels: AUTOMATIC_VT_BORDER_TEXELS,
    colorSpace,
    height: size.height,
    pageSize: AUTOMATIC_VT_PAGE_SIZE,
    width: size.width,
  });
  return {
    layout,
    read: async (page, signal) => renderAutomaticPage(
      layout,
      sampler,
      source.source as CanvasImageSource,
      source.width / size.width,
      source.height / size.height,
      page,
      signal,
    ),
  };
};

/** Native preview detail uses the ordinary raster page source after lazy loading. */
export const createAutomaticPreviewPageSource = (
  preview: TexturePreviewSource,
  sampler: CanonicalTextureSampler,
  colorSpace: "linear" | "srgb",
): VirtualTexturePageSource => {
  const size = preview.size;
  const layout = createGeneratedVirtualTextureLayout({ ...size, colorSpace,
      pageSize: AUTOMATIC_VT_PAGE_SIZE, borderTexels: AUTOMATIC_VT_BORDER_TEXELS });
  let detailPages: VirtualTexturePageSource | undefined;
  let closed = false;
  return {
    layout,
    close: () => {
      closed = true;
      detailPages?.close?.();
      detailPages = undefined;
    },
    read: async (page, signal) => {
      if (closed || signal.aborted) throw new DOMException("Texture preview was aborted", "AbortError");
      const authority = await preview.load();
      if (closed || signal.aborted) throw new DOMException("Texture refinement was aborted", "AbortError");
      if (detailPages === undefined) {
        detailPages = createAutomaticRasterPageSource(authority, sampler, colorSpace, size);
      }
      return detailPages.read(page, signal);
    },
  };
};
