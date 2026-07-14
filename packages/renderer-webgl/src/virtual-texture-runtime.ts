import type { TextureColorSpace, TextureRef, TextureSamplerWrap } from "@royal/renderer-core";
import {
  isDecodedCompressedTexture,
  isDecodedRgbaTexture,
  type LoadedTextureSource,
} from "./texture-sources";
import type { Mat4 } from "./math/mat4";
import type { GltfTextureCoordinates } from "./gltf/texture-coordinates";
import { throwIfAborted } from "./resource-io";
import type { VirtualTextureCoverageProvider } from "./virtual-texture-coverage-provider";
import type { TextureAssetUploadRef } from "./webgl/materials";
import {
  generatedVirtualTextureManifest,
  type VirtualTextureManifestModel,
  type VirtualTextureManifestParseResult,
  type VirtualTexturePageId,
} from "./virtual-texturing";
import { createVirtualTextureCanvas, virtualTextureCanvasContext } from "./virtual-texture-canvas";
import { rasterizeGeneratedVirtualTexturePage } from "./virtual-texture-page-rasterizer";

const GENERATED_RASTER_VIRTUAL_TEXTURE_PAGE_SIZE = 256;
const GENERATED_RASTER_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP = 64;
const GENERATED_VIRTUAL_TEXTURE_MANIFEST_URI_PREFIX = "royal-generated-vt:";

export const GENERATED_RASTER_VIRTUAL_TEXTURE_MIN_DIMENSION = GENERATED_RASTER_VIRTUAL_TEXTURE_PAGE_SIZE + 1;
export const VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME = 4;
export const VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS = 4;
export const VIRTUAL_TEXTURE_MAX_DEMAND_PAGES_PER_DRAW = 32;
export const VIRTUAL_TEXTURE_MAX_PAGE_LOAD_RETRIES = 2;
export const VIRTUAL_TEXTURE_PAGE_RETRY_BASE_DELAY_MS = 50;

export type ViewportSize = readonly [width: number, height: number];
export type VirtualTextureRef = Extract<TextureRef, { readonly kind: "virtual-asset" }>;

export type RasterVirtualTextureSource = {
  canvasSource?: CanvasImageSource;
  readonly colorSpace?: TextureColorSpace;
  readonly decodedBytes: number;
  readonly height: number;
  readonly label: string;
  readonly source: LoadedTextureSource;
  readonly width: number;
};

export type VirtualTexturePagePayload =
  | {
      readonly close?: () => void;
      readonly image: TexImageSource;
      readonly kind: "image";
    }
  | {
      readonly data: Uint8Array;
      readonly format: number;
      readonly height: number;
      readonly kind: "compressed";
      readonly srgbFormat: number;
      readonly width: number;
    };

export type VirtualTexturePageLoad =
  | { readonly kind: "absent" }
  | { readonly kind: "page"; readonly promise: Promise<VirtualTexturePagePayload> };

type VirtualTexturePageLoader = (
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
  signal: AbortSignal,
) => VirtualTexturePageLoad;

type ImmediateVirtualTexturePageSource = {
  readonly loadManifest?: never;
  readonly manifest: VirtualTextureManifestParseResult;
};

type DeferredVirtualTexturePageSource = {
  readonly loadManifest: (signal: AbortSignal) => Promise<VirtualTextureManifestParseResult>;
  readonly manifest?: never;
};

/** Format adapter consumed by the runtime shell; demand and residency see only its manifest. */
export type VirtualTexturePageSource = (ImmediateVirtualTexturePageSource | DeferredVirtualTexturePageSource) & {
  readonly loadPage: VirtualTexturePageLoader;
  readonly manifestUri: string;
};

export type AutomaticVirtualTextureSource = VirtualTexturePageSource & {
  readonly manifest: VirtualTextureManifestParseResult & { readonly manifest: VirtualTextureManifestModel };
  readonly retainedSourceBytes: number;
};

export type AutomaticVirtualTextureSourceDefinition = {
  readonly loadPage: VirtualTexturePageLoader;
  readonly manifest: VirtualTextureManifestModel;
  readonly retainedSourceBytes: number;
};

type VirtualTextureRuntimeStatus = "error" | "loading" | "ready" | "unsupported";

export type VirtualTextureRuntimeStats = {
  demandAdmissions: number;
  demandRetentionOverflows: number;
  demandRetentions: number;
  automaticManifestUses: number;
  automaticPagesTarget: number;
  automaticSourceBytes: number;
  manifestFailures: number;
  gpuAdmissionFailures: number;
  pageLoadFailures: number;
  pageLoadDurationMaxMs: number;
  pageLoadDurationMs: number;
  pageLoadDurationSamples: number;
  pageLoadRequests: number;
  manifestRequests: number;
  preparedResidencyResolutions: number;
  shaderBinds: number;
  unreadyDraws: number;
  unsupportedDraws: number;
};

export type VirtualTextureRuntimeState = {
  activeSource: VirtualTexturePageSource;
  availablePageKeys?: ReadonlySet<string>;
  /** Stable root-policy ordering for admission and cold-reclamation ties. */
  readonly admissionTicket: number;
  demandPublished: boolean;
  /** Raw current draw demand before terminal-page convergence filtering. */
  demandedPageKeys: Set<string>;
  demandedPageKeysScratch: Set<string>;
  diagnosticsEnabled: boolean;
  /** GPU publication target: exact current demand plus bounded replacement overlap while converging. */
  desiredPageKeys: Set<string>;
  desiredPageKeysScratch: Set<string>;
  /** Ordered counterpart of `desiredPageKeys`; inactive physical cache is owned by the GPU arena. */
  desiredPages: VirtualTexturePageId[];
  desiredPagesScratch: VirtualTexturePageId[];
  readonly key: string;
  /** Most recent successfully committed frame that contained draw demand. */
  lastDemandFrame: number;
  manifestAbortController?: AbortController;
  manifest?: VirtualTextureManifestModel;
  sourceGeneration: number;
  stats: VirtualTextureRuntimeStats;
  status: VirtualTextureRuntimeStatus;
  readonly texture: VirtualTextureRef;
};

export type BaseColorTextureResidency =
  | { readonly kind: "none" }
  | { readonly kind: "ordinary"; readonly texture: TextureAssetUploadRef }
  | {
      readonly kind: "prepared-virtual";
      readonly ordinaryFallback?: TextureAssetUploadRef;
      readonly state: VirtualTextureRuntimeState;
    };

export type VirtualTextureDrawDemandModelSource =
  | { readonly kind: "composed"; readonly localModels: readonly Mat4[]; readonly rootModels: readonly Mat4[] }
  | { readonly kind: "single"; readonly model: Mat4 };

export type VirtualTextureDrawDemandContext = {
  readonly modelSource: VirtualTextureDrawDemandModelSource;
  readonly projection: Mat4;
  readonly provider: VirtualTextureCoverageProvider;
  readonly textureCoordinates?: GltfTextureCoordinates;
  readonly view: Mat4;
  readonly viewportSize: ViewportSize;
  /** Sampler addressing used by both demand projection and the VT shader. */
  readonly wrapS?: TextureSamplerWrap;
  /** Sampler addressing used by both demand projection and the VT shader. */
  readonly wrapT?: TextureSamplerWrap;
};

export type VirtualTextureScreenFootprint = {
  readonly maxU: number;
  readonly maxV: number;
  readonly minU: number;
  readonly minV: number;
  readonly screenHeight: number;
  readonly screenWidth: number;
};

export type VirtualTextureDrawDemand = {
  /** Sampler addressing crossed a discontinuity; demand uses bounded conservative refinement. */
  readonly addressingConservative?: true;
  readonly coverageCandidates?: readonly VirtualTexturePageId[];
  readonly demandCandidates: readonly VirtualTexturePageId[];
  readonly preferredCandidates?: readonly VirtualTexturePageId[];
  /** Fixed retained-polygon workspace overflowed; demand uses bounded conservative refinement. */
  readonly retentionOverflowed?: true;
};

export const normalizeVirtualTextureDemandUvRange = (
  min: number,
  max: number,
): readonly [number, number] => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (max - min >= 1 || min < 0 || max > 1) return [0, 1];
  return [Math.max(0, min), Math.min(1, max)];
};

export const virtualTextureDemandPageDistance = (
  page: VirtualTexturePageId,
  centerX: number,
  centerY: number,
): number => {
  const pageCenterX = page.x + 0.5;
  const pageCenterY = page.y + 0.5;
  return (pageCenterX - centerX) ** 2 + (pageCenterY - centerY) ** 2;
};

const generatedVirtualTextureManifestUri = (key: string): string =>
  `${GENERATED_VIRTUAL_TEXTURE_MANIFEST_URI_PREFIX}${encodeURIComponent(key)}`;

export const automaticVirtualTextureSource = (
  textureKey: string,
  definition: AutomaticVirtualTextureSourceDefinition,
): AutomaticVirtualTextureSource => ({
  loadPage: definition.loadPage,
  manifest: { diagnostics: [], manifest: definition.manifest },
  manifestUri: generatedVirtualTextureManifestUri(textureKey),
  retainedSourceBytes: definition.retainedSourceBytes,
});

export const automaticRasterVirtualTextureSource = (
  textureKey: string,
  source: RasterVirtualTextureSource,
): AutomaticVirtualTextureSource => automaticVirtualTextureSource(textureKey, {
  loadPage: (activeManifest, page, signal) => {
    throwIfAborted(signal);
    return {
      kind: "page",
      promise: Promise.resolve({
        image: generatedRasterVirtualTexturePageImage(source, activeManifest, page),
        kind: "image",
      }),
    };
  },
  manifest: generatedRasterVirtualTextureManifest(source),
  retainedSourceBytes: source.decodedBytes,
});

export const generatedRasterVirtualTextureManifest = (
  source: RasterVirtualTextureSource,
): VirtualTextureManifestModel => generatedVirtualTextureManifest({
    ...(source.colorSpace === undefined ? {} : { colorSpace: source.colorSpace }),
    height: source.height,
    pageSize: GENERATED_RASTER_VIRTUAL_TEXTURE_PAGE_SIZE,
    physicalSlotCap: GENERATED_RASTER_VIRTUAL_TEXTURE_PHYSICAL_SLOT_CAP,
    width: source.width,
  });

const rasterVirtualTextureCanvasSource = (
  source: RasterVirtualTextureSource,
): CanvasImageSource => {
  if (source.canvasSource !== undefined) return source.canvasSource;
  if (isDecodedCompressedTexture(source.source)) {
    throw new Error(`Compressed source ${source.label} cannot be cropped through Canvas 2D`);
  }
  if (!isDecodedRgbaTexture(source.source)) {
    source.canvasSource = source.source;
    return source.canvasSource;
  }

  const canvas = createVirtualTextureCanvas(source.width, source.height, source.label);
  const context = virtualTextureCanvasContext(canvas, source.label);
  if (typeof globalThis.ImageData !== "function") {
    throw new Error(`ImageData is unavailable for ${source.label}`);
  }
  const imageData = new globalThis.ImageData(
    new Uint8ClampedArray(source.source.data),
    source.source.width,
    source.source.height,
  );
  context.putImageData(imageData, 0, 0);
  source.canvasSource = canvas;
  return source.canvasSource;
};

export const generatedRasterVirtualTexturePageImage = (
  source: RasterVirtualTextureSource,
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): TexImageSource => {
  return rasterizeGeneratedVirtualTexturePage({
    height: source.height,
    image: rasterVirtualTextureCanvasSource(source),
    label: source.label,
    width: source.width,
  }, manifest, page);
};
