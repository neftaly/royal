import type { TextureRef } from "@royal/renderer-core";
import {
  isDecodedRgbaTexture,
  type LoadedTextureSource,
} from "./texture-sources";
import type { SvgVirtualTextureSource } from "./svg-texture";
import type { Mat4 } from "./math/mat4";
import type { GltfTextureCoordinates } from "./gltf/texture-coordinates";
import type { TextureAssetUploadRef } from "./webgl/materials";
import {
  generatedVirtualTextureManifest,
  virtualTexturePageKey,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
} from "./virtual-texturing";
import type { VirtualTexturePageLifecycle } from "./virtual-texture-page-lifecycle";
import { createVirtualTextureCanvas, virtualTextureCanvasContext } from "./virtual-texture-canvas";

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
  readonly colorSpace?: NonNullable<TextureRef["colorSpace"]>;
  readonly height: number;
  readonly label: string;
  readonly source: LoadedTextureSource;
  readonly width: number;
};

export type VirtualTextureGeneratedPageSource =
  | { readonly kind: "raster"; readonly source: RasterVirtualTextureSource }
  | { readonly kind: "svg"; readonly source: SvgVirtualTextureSource };

export type VirtualTextureManifestSource =
  | { readonly kind: "generated"; readonly manifestUri: string; readonly pageSource: VirtualTextureGeneratedPageSource }
  | { readonly kind: "sidecar"; readonly manifestUri: string };

export type GeneratedVirtualTextureSource = Extract<VirtualTextureManifestSource, { readonly kind: "generated" }>;

type VirtualTextureRuntimeStatus = "error" | "loading" | "ready" | "unsupported";

export type VirtualTextureRuntimeStats = {
  demandAdmissions: number;
  demandRetentionOverflows: number;
  demandRetentions: number;
  generatedManifestUses: number;
  generatedPageFailures: number;
  generatedPageRasterizeMaxMs: number;
  generatedPageRasterizeMs: number;
  generatedPageRequests: number;
  generatedPagesTarget: number;
  manifestFailures: number;
  gpuAdmissionFailures: number;
  pageLoadFailures: number;
  manifestRequests: number;
  preparedResidencyResolutions: number;
  shaderBinds: number;
  unreadyDraws: number;
  unsupportedDraws: number;
};

export type VirtualTextureRuntimeState = {
  activeSource: VirtualTextureManifestSource;
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
  /** Incremental count of page lifecycles currently in the loading state. */
  loadingPageCount: number;
  /** Most recent successfully committed frame that contained draw demand. */
  lastDemandFrame: number;
  manifestAbortController?: AbortController;
  readonly pageLifecycles: Map<string, VirtualTexturePageLifecycle>;
  readonly pageLoadAbortControllers: Map<string, AbortController>;
  readonly pageRetryTimers: Map<string, ReturnType<typeof setTimeout>>;
  manifest?: VirtualTextureManifestModel;
  pageUrisByKey?: ReadonlyMap<string, string>;
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
  readonly indices?: Uint8Array | Uint16Array | Uint32Array;
  readonly modelSource: VirtualTextureDrawDemandModelSource;
  readonly positions: Float32Array;
  readonly projection: Mat4;
  readonly texCoords: Float32Array;
  readonly textureCoordinates?: GltfTextureCoordinates;
  readonly view: Mat4;
  readonly viewportSize: ViewportSize;
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

export const orientVirtualTextureDemandVRange = (
  minV: number,
  maxV: number,
  flipY: boolean,
): readonly [number, number] => flipY ? [1 - maxV, 1 - minV] : [minV, maxV];

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

export const virtualTextureNow = (): number =>
  typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now();

export const generatedVirtualTextureSource = (
  textureKey: string,
  pageSource: VirtualTextureGeneratedPageSource,
): GeneratedVirtualTextureSource => ({
  kind: "generated",
  manifestUri: generatedVirtualTextureManifestUri(textureKey),
  pageSource,
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
  const mipScale = 2 ** page.mip;
  const sourceX = page.x * manifest.pageSize * mipScale;
  const sourceY = page.y * manifest.pageSize * mipScale;
  const sourceWidth = Math.max(1, Math.min(manifest.pageSize * mipScale, manifest.width - sourceX));
  const sourceHeight = Math.max(1, Math.min(manifest.pageSize * mipScale, manifest.height - sourceY));
  const canvas = createVirtualTextureCanvas(
    manifest.pageSize,
    manifest.pageSize,
    `generated raster virtual texture page ${source.label} ${virtualTexturePageKey(page)}`,
  );
  const context = virtualTextureCanvasContext(canvas, source.label);
  context.clearRect(0, 0, manifest.pageSize, manifest.pageSize);
  context.drawImage(
    rasterVirtualTextureCanvasSource(source),
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    manifest.pageSize,
    manifest.pageSize,
  );
  return canvas;
};
