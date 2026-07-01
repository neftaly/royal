import {
  defaultTextureFallbackColor,
  type SolidTextureRef,
  type TextureAssetRef,
  type TextureRef,
  type VirtualTextureAssetRef,
} from "@royal/renderer-core";
import type { RendererWebGlContext } from "./gl";
import type { TextureAssetLoadResult, TextureCache } from "./texture-cache";
import type { VirtualTextureCache, VirtualTextureCacheLoadResult } from "./virtual-texture-cache";
import type {
  VirtualTextureFrameUploadResult,
  VirtualTexturePageRequestResult,
  VirtualTextureResource,
  VirtualTextureResourceStats,
  VirtualTextureTextureBindings,
  VirtualTextureUvFootprint,
} from "./virtual-texture-resource";

type MaterialTextureLoadCache = Pick<TextureCache, "loadTextureAssetBaseColor">;
type MaterialVirtualTextureLoadCache = Pick<VirtualTextureCache, "loadVirtualTexture">;

export type MaterialBaseColorBinding =
  | {
    readonly color: SolidTextureRef["color"];
    readonly kind: "solid";
    readonly source: SolidTextureRef;
  }
  | {
    readonly fallbackColor: SolidTextureRef["color"];
    readonly kind: "asset";
    readonly load: TextureAssetLoadResult;
    readonly source: TextureAssetRef;
  }
  | {
    readonly fallbackColor: SolidTextureRef["color"];
    readonly kind: "virtual-asset";
    readonly previewLoad?: TextureAssetLoadResult | undefined;
    readonly source: VirtualTextureAssetRef;
    readonly virtualLoad?: VirtualTextureCacheLoadResult | undefined;
  };

export type MaterialBaseColorUniforms = {
  readonly baseColor: WebGLUniformLocation;
  readonly color: WebGLUniformLocation;
  readonly useVirtualTexture: WebGLUniformLocation;
  readonly useBaseColorTexture: WebGLUniformLocation;
  readonly virtualAtlas: WebGLUniformLocation;
  readonly virtualBorderTexels: WebGLUniformLocation;
  readonly virtualMip: WebGLUniformLocation;
  readonly virtualPaddedPageSize: WebGLUniformLocation;
  readonly virtualPageSize: WebGLUniformLocation;
  readonly virtualPageTable: WebGLUniformLocation;
  readonly virtualPageTableSize: WebGLUniformLocation;
  readonly virtualPhysicalAtlasSize: WebGLUniformLocation;
};

export type MaterialBaseColorBindOptions = {
  readonly desiredMip?: number | undefined;
  readonly frame?: number;
  readonly onVirtualTextureSettled?: (() => void) | undefined;
  readonly onVirtualTextureRuntimeStats?: ((stats: MaterialVirtualTextureRuntimeStats) => void) | undefined;
  readonly virtualTextureDemand?: VirtualTextureDemand | undefined;
};

export type MaterialVirtualTextureSourceIdentity = {
  readonly id: string;
  readonly kind: "virtual-asset";
  readonly manifestId?: string | undefined;
  readonly manifestUri: string;
  readonly revision?: VirtualTextureAssetRef["revision"] | undefined;
};

export type MaterialVirtualTextureRuntimeStats = {
  readonly frame: number;
  readonly pageTableSize: readonly [number, number];
  readonly requestPages: VirtualTexturePageRequestResult;
  readonly resource: VirtualTextureResourceStats;
  readonly selectedMip: number;
  readonly source?: MaterialVirtualTextureSourceIdentity | undefined;
  readonly uploadFrame: VirtualTextureFrameUploadResult;
};

export type VirtualTextureDemand = {
  readonly desiredMip?: number | undefined;
  readonly screenFootprintPx?: readonly [width: number, height: number] | undefined;
  readonly uvFootprint?: VirtualTextureDemandUvFootprint | undefined;
};

export type VirtualTextureDemandUvFootprint = {
  readonly uMax: number;
  readonly uMin: number;
  readonly vMax: number;
  readonly vMin: number;
};

type VirtualTextureMipSelectionBindings = Pick<
  VirtualTextureTextureBindings,
  "pageTableMipDimensions" | "virtualSize"
>;

type PreparedVirtualTextureResource = {
  readonly bindings: VirtualTextureTextureBindings;
  readonly mip: number;
  readonly pageTableSize: readonly [number, number];
};

type VirtualTextureDemandSelection = {
  readonly footprint: VirtualTextureUvFootprint;
  readonly mip: number;
  readonly pageTableSize: readonly [number, number];
};

const defaultVirtualTexturePageTableUploadBudget = 8;
const defaultVirtualTexturePhysicalAtlasUploadBudget = 1;
const pendingVirtualTextureRequestSettles = new WeakSet<VirtualTextureResource>();
const pendingVirtualTextureUploadContinuations = new WeakSet<VirtualTextureResource>();

export const lowerMaterialBaseColorBinding = (
  baseColor: TextureRef,
  options: {
    readonly onTextureSettled?: (() => void) | undefined;
    readonly textureCache: MaterialTextureLoadCache;
    readonly virtualTextureCache?: MaterialVirtualTextureLoadCache | undefined;
  },
): MaterialBaseColorBinding => {
  if (baseColor.kind === "solid") {
    return {
      color: baseColor.color,
      kind: "solid",
      source: baseColor,
    };
  }

  if (baseColor.kind === "virtual-asset") {
    return {
      fallbackColor:
        baseColor.fallback?.color ??
        baseColor.preview?.fallback?.color ??
        defaultTextureFallbackColor,
      kind: "virtual-asset",
      ...(baseColor.preview === undefined
        ? {}
        : {
          previewLoad: options.textureCache.loadTextureAssetBaseColor(
            baseColor.preview,
            options.onTextureSettled,
          ),
        }),
      source: baseColor,
      ...(options.virtualTextureCache === undefined
        ? {}
        : {
          virtualLoad: options.virtualTextureCache.loadVirtualTexture(
            baseColor,
            options.onTextureSettled,
          ),
        }),
    };
  }

  return {
    fallbackColor: baseColor.fallback?.color ?? defaultTextureFallbackColor,
    kind: "asset",
    load: options.textureCache.loadTextureAssetBaseColor(
      baseColor,
      options.onTextureSettled,
    ),
    source: baseColor,
  };
};

export const bindMaterialBaseColor = (
  gl: RendererWebGlContext,
  uniforms: MaterialBaseColorUniforms,
  binding: MaterialBaseColorBinding,
  textureUnit = 0,
  options: MaterialBaseColorBindOptions = {},
): void => {
  if (binding.kind === "virtual-asset") {
    if (bindVirtualMaterialBaseColor(gl, uniforms, binding, textureUnit, options)) return;
  }

  const load = binding.kind === "asset" ? binding.load : binding.kind === "virtual-asset" ? binding.previewLoad : undefined;
  if (load?.kind === "ready") {
    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(gl.TEXTURE_2D, load.texture);
    gl.uniform1i(uniforms.baseColor, textureUnit);
    gl.uniform1i(uniforms.useBaseColorTexture, 1);
    gl.uniform1i(uniforms.useVirtualTexture, 0);
    return;
  }

  gl.uniform4fv(
    uniforms.color,
    binding.kind === "solid" ? binding.color : binding.fallbackColor,
  );
  gl.uniform1i(uniforms.useBaseColorTexture, 0);
  gl.uniform1i(uniforms.useVirtualTexture, 0);
};

const bindVirtualMaterialBaseColor = (
  gl: RendererWebGlContext,
  uniforms: MaterialBaseColorUniforms,
  binding: Extract<MaterialBaseColorBinding, { readonly kind: "virtual-asset" }>,
  textureUnit: number,
  options: MaterialBaseColorBindOptions,
): boolean => {
  if (binding.virtualLoad?.kind !== "ready") return false;

  const prepared = prepareVirtualTextureResource(binding.virtualLoad.resource, binding.source, options);
  if (prepared === null) return false;

  const { bindings, mip, pageTableSize } = prepared;
  gl.activeTexture(gl.TEXTURE0 + textureUnit);
  gl.bindTexture(gl.TEXTURE_2D, bindings.pageTableTexture);
  gl.uniform1i(uniforms.virtualPageTable, textureUnit);

  gl.activeTexture(gl.TEXTURE0 + textureUnit + 1);
  gl.bindTexture(gl.TEXTURE_2D, bindings.physicalAtlasTexture);
  gl.uniform1i(uniforms.virtualAtlas, textureUnit + 1);

  gl.uniform1f(uniforms.virtualMip, mip);
  gl.uniform2fv(uniforms.virtualPageTableSize, pageTableSize);
  gl.uniform1f(uniforms.virtualPageSize, bindings.pageSize);
  gl.uniform1f(uniforms.virtualPaddedPageSize, bindings.paddedPageSize);
  gl.uniform1f(uniforms.virtualBorderTexels, bindings.borderTexels);
  gl.uniform2fv(uniforms.virtualPhysicalAtlasSize, bindings.physicalAtlasSize);
  gl.uniform4fv(uniforms.color, binding.fallbackColor);
  gl.uniform1i(uniforms.useBaseColorTexture, 0);
  gl.uniform1i(uniforms.useVirtualTexture, 1);
  return true;
};

const prepareVirtualTextureResource = (
  resource: VirtualTextureResource,
  source: VirtualTextureAssetRef | undefined,
  options: MaterialBaseColorBindOptions,
): PreparedVirtualTextureResource | null => {
  const bindings = resource.getTextureBindings();
  const statsBeforeRequest = resource.stats();
  const demand = selectVirtualTextureResourceDemand(
    bindings,
    statsBeforeRequest,
    options,
  );
  if (demand === null) return null;

  const frame = options.frame ?? 0;
  const requested = requestVirtualTexturePages(
    resource,
    demand.footprint,
    frame,
    options.onVirtualTextureSettled,
  );
  const uploaded = uploadVirtualTextureFrame(
    resource,
    frame,
    options.onVirtualTextureSettled,
  );
  const stats = resource.stats();

  emitVirtualTextureRuntimeStats(options.onVirtualTextureRuntimeStats, {
    frame,
    pageTableSize: demand.pageTableSize,
    requestPages: requested,
    resource: stats,
    selectedMip: demand.mip,
    source,
    uploadFrame: uploaded,
  });
  if (!isVirtualTextureReadyToBind(stats)) return null;

  return {
    bindings,
    mip: demand.mip,
    pageTableSize: demand.pageTableSize,
  };
};

const selectVirtualTextureResourceDemand = (
  bindings: VirtualTextureTextureBindings,
  statsBeforeRequest: VirtualTextureResourceStats,
  options: MaterialBaseColorBindOptions,
): VirtualTextureDemandSelection | null => {
  const mip = selectVirtualTextureMip(bindings, {
    cacheCapacity: statsBeforeRequest.cache.capacity,
    desiredMip: options.desiredMip,
    residentPages: statsBeforeRequest.cache.residentPages,
    virtualTextureDemand: options.virtualTextureDemand,
  });
  const pageTableMip = bindings.pageTableMipDimensions[mip];
  if (pageTableMip === undefined) return null;

  return {
    footprint: virtualTextureUvFootprintForDemand(
      options.virtualTextureDemand,
      mip,
      pageTableMip,
    ),
    mip,
    pageTableSize: [pageTableMip.width, pageTableMip.height],
  };
};

const fullVirtualTextureUvFootprint = (mip: number): VirtualTextureUvFootprint => ({
  mip,
  uMax: 1,
  uMin: 0,
  vMax: 1,
  vMin: 0,
});

const virtualTextureUvFootprintForDemand = (
  demand: VirtualTextureDemand | undefined,
  mip: number,
  pageTableMip: { readonly height: number; readonly width: number },
): VirtualTextureUvFootprint => {
  const footprint = demand?.uvFootprint;
  if (footprint === undefined) return fullVirtualTextureUvFootprint(mip);

  const { uMax, uMin, vMax, vMin } = footprint;
  if (
    !Number.isFinite(uMin) ||
    !Number.isFinite(uMax) ||
    !Number.isFinite(vMin) ||
    !Number.isFinite(vMax) ||
    !Number.isFinite(pageTableMip.width) ||
    !Number.isFinite(pageTableMip.height) ||
    pageTableMip.width <= 0 ||
    pageTableMip.height <= 0 ||
    uMin >= uMax ||
    vMin >= vMax
  ) {
    return fullVirtualTextureUvFootprint(mip);
  }

  const uPad = 1 / pageTableMip.width;
  const vPad = 1 / pageTableMip.height;
  const padded = {
    mip,
    uMax: clampVirtualTextureUv(uMax + uPad),
    uMin: clampVirtualTextureUv(uMin - uPad),
    vMax: clampVirtualTextureUv(vMax + vPad),
    vMin: clampVirtualTextureUv(vMin - vPad),
  };

  if (
    !Number.isFinite(uPad) ||
    !Number.isFinite(vPad) ||
    !Number.isFinite(padded.uMin) ||
    !Number.isFinite(padded.uMax) ||
    !Number.isFinite(padded.vMin) ||
    !Number.isFinite(padded.vMax) ||
    padded.uMin >= padded.uMax ||
    padded.vMin >= padded.vMax
  ) {
    return fullVirtualTextureUvFootprint(mip);
  }

  return padded;
};

const clampVirtualTextureUv = (value: number): number =>
  Math.min(Math.max(0, value), 1);

const requestVirtualTexturePages = (
  resource: VirtualTextureResource,
  footprint: VirtualTextureUvFootprint,
  frame: number,
  onVirtualTextureSettled: (() => void) | undefined,
): VirtualTexturePageRequestResult => {
  const requested = resource.requestPages(footprint, frame);
  if (requested.scheduled > 0) {
    scheduleVirtualTextureRequestSettled(resource, onVirtualTextureSettled);
  }

  return requested;
};

const uploadVirtualTextureFrame = (
  resource: VirtualTextureResource,
  frame: number,
  onVirtualTextureSettled: (() => void) | undefined,
): VirtualTextureFrameUploadResult => {
  const uploaded = resource.uploadFrame({
    frame,
    pageTableUploads: defaultVirtualTexturePageTableUploadBudget,
    physicalAtlasUploads: defaultVirtualTexturePhysicalAtlasUploadBudget,
  });
  if (uploaded.pendingUploadCount > 0) {
    scheduleVirtualTextureUploadContinuation(resource, onVirtualTextureSettled);
  }

  return uploaded;
};

const emitVirtualTextureRuntimeStats = (
  onVirtualTextureRuntimeStats: ((stats: MaterialVirtualTextureRuntimeStats) => void) | undefined,
  stats: {
    readonly frame: number;
    readonly pageTableSize: readonly [number, number];
    readonly requestPages: VirtualTexturePageRequestResult;
    readonly resource: VirtualTextureResourceStats;
    readonly selectedMip: number;
    readonly source: VirtualTextureAssetRef | undefined;
    readonly uploadFrame: VirtualTextureFrameUploadResult;
  },
): void => {
  onVirtualTextureRuntimeStats?.(virtualTextureRuntimeStats(stats));
};

const virtualTextureRuntimeStats = (stats: {
  readonly frame: number;
  readonly pageTableSize: readonly [number, number];
  readonly requestPages: VirtualTexturePageRequestResult;
  readonly resource: VirtualTextureResourceStats;
  readonly selectedMip: number;
  readonly source: VirtualTextureAssetRef | undefined;
  readonly uploadFrame: VirtualTextureFrameUploadResult;
}): MaterialVirtualTextureRuntimeStats => {
  const sourceIdentity = virtualTextureSourceIdentity(stats.source);

  return {
    frame: stats.frame,
    pageTableSize: stats.pageTableSize,
    requestPages: stats.requestPages,
    resource: stats.resource,
    selectedMip: stats.selectedMip,
    ...(sourceIdentity === undefined ? {} : { source: sourceIdentity }),
    uploadFrame: stats.uploadFrame,
  };
};

const isVirtualTextureReadyToBind = (stats: VirtualTextureResourceStats): boolean =>
  stats.cache.residentPages !== 0 && stats.mappings.mappedPages !== 0;

const virtualTextureSourceIdentity = (
  source: VirtualTextureAssetRef | undefined,
): MaterialVirtualTextureSourceIdentity | undefined => {
  if (source === undefined) return undefined;

  return {
    id: source.id,
    kind: source.kind,
    ...(source.manifestId === undefined ? {} : { manifestId: source.manifestId }),
    manifestUri: source.manifestUri,
    ...(source.revision === undefined ? {} : { revision: source.revision }),
  };
};

const scheduleVirtualTextureRequestSettled = (
  resource: VirtualTextureResource,
  onVirtualTextureSettled: (() => void) | undefined,
): void => {
  if (onVirtualTextureSettled === undefined || pendingVirtualTextureRequestSettles.has(resource)) return;
  pendingVirtualTextureRequestSettles.add(resource);
  const settle = (): void => {
    pendingVirtualTextureRequestSettles.delete(resource);
    onVirtualTextureSettled();
  };
  void resource.waitForPendingRequests().then(settle, settle);
};

const scheduleVirtualTextureUploadContinuation = (
  resource: VirtualTextureResource,
  onVirtualTextureSettled: (() => void) | undefined,
): void => {
  if (onVirtualTextureSettled === undefined || pendingVirtualTextureUploadContinuations.has(resource)) return;
  pendingVirtualTextureUploadContinuations.add(resource);
  queueMicrotask(() => {
    pendingVirtualTextureUploadContinuations.delete(resource);
    onVirtualTextureSettled();
  });
};

export const selectVirtualTextureMip = (
  bindings: VirtualTextureMipSelectionBindings,
  options: {
    readonly cacheCapacity?: number | undefined;
    readonly desiredMip?: number | undefined;
    readonly residentPages?: number | undefined;
    readonly virtualTextureDemand?: VirtualTextureDemand | undefined;
  } = {},
): number => {
  const lastMip = coarsestVirtualTextureMip(bindings);
  if (options.residentPages === 0) return lastMip;

  const explicitMip = options.desiredMip ?? options.virtualTextureDemand?.desiredMip;
  if (explicitMip !== undefined) return clampVirtualTextureMip(explicitMip, lastMip);

  const footprint = options.virtualTextureDemand?.screenFootprintPx;
  if (footprint === undefined) return lastMip;

  const screenMip = virtualTextureScreenMip(bindings.virtualSize, footprint);
  if (screenMip === null) return lastMip;

  return clampVirtualTextureMip(
    Math.max(screenMip, virtualTextureCapacityMip(bindings, options)),
    lastMip,
  );
};

const coarsestVirtualTextureMip = (bindings: VirtualTextureMipSelectionBindings): number =>
  Math.max(0, bindings.pageTableMipDimensions.length - 1);

const clampVirtualTextureMip = (mip: number, lastMip: number): number =>
  Number.isFinite(mip)
    ? Math.min(Math.max(0, Math.trunc(mip)), lastMip)
    : lastMip;

const virtualTextureScreenMip = (
  virtualSize: readonly [number, number],
  screenFootprintPx: readonly [number, number],
): number | null => {
  const [virtualWidth, virtualHeight] = virtualSize;
  const [widthPx, heightPx] = screenFootprintPx;
  if (
    !Number.isFinite(virtualWidth) ||
    !Number.isFinite(virtualHeight) ||
    !Number.isFinite(widthPx) ||
    !Number.isFinite(heightPx) ||
    virtualWidth <= 0 ||
    virtualHeight <= 0 ||
    widthPx < 0 ||
    heightPx < 0
  ) {
    return null;
  }

  return Math.floor(Math.log2(Math.max(
    virtualWidth / Math.max(1, widthPx),
    virtualHeight / Math.max(1, heightPx),
  )));
};

const virtualTextureCapacityMip = (
  bindings: VirtualTextureMipSelectionBindings,
  options: {
    readonly cacheCapacity?: number | undefined;
    readonly residentPages?: number | undefined;
  },
): number => {
  const lastMip = coarsestVirtualTextureMip(bindings);
  const capacity = options.cacheCapacity;
  if (capacity === undefined || !Number.isFinite(capacity) || capacity <= 0) return lastMip;
  const effectiveCapacity = (options.residentPages ?? 0) > 0
    ? Math.max(1, capacity - 1)
    : capacity;

  for (let mip = 0; mip < bindings.pageTableMipDimensions.length; mip += 1) {
    const dimension = bindings.pageTableMipDimensions[mip];
    if (dimension === undefined) continue;

    const pages = dimension.width * dimension.height;
    if (Number.isFinite(pages) && pages <= effectiveCapacity) return mip;
  }

  return lastMip;
};
