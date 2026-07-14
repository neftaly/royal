import type { TextureColorSpace } from "@royal/renderer-core";
import type { VirtualTexturePagePayload } from "../virtual-texture-runtime";
import {
  derivedVirtualTextureMipCount,
  encodeVirtualTexturePageTableRgba8,
  generatedVirtualTexturePageCount,
  parentVirtualTexturePage,
  VirtualTextureAtlasPageTable,
  virtualTextureStoredPageBytes,
  virtualTexturePageKey,
  virtualTextureMipDimension,
  virtualTextureStoredPageSize,
  type VirtualTextureAtlasAssignment,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
  type VirtualTexturePageTableUpdate,
} from "../virtual-texturing";
import { prepareTextureUpload } from "./imperative-state";
import {
  createOwnedTexture,
  ownsTexture,
  releaseOwnedTexture,
  type TextureHandleArena,
} from "./texture-handle-arena";
import { textureUploadInternalFormat } from "./texture-upload";

const MAX_PAGE_UPLOADS_PER_FRAME = 2;
// Preserve two-page throughput for the 256px generated-VT path, while keeping
// large authored pages from stacking multiple MiB-scale atlas writes into one
// presentation frame. One page always makes progress even when it exceeds the
// target by itself.
const TARGET_MAX_ATLAS_UPLOAD_BYTES_PER_FRAME = 1024 * 1024;
const PAGE_TABLE_UPLOAD_SCRATCH_BYTES = 64 * 1024;
const WEBGL_LINEAR = 0x2601;
const WEBGL_NEAREST = 0x2600;
const WEBGL_COMPRESSED_RGBA8_ETC2_EAC = 0x9278;
const WEBGL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC = 0x9279;
const MAX_ENCODED_PHYSICAL_SLOTS = 65_535;

declare const authority: unique symbol;

/** Owns virtual-texture GPU allocation and upload state without owning decoded images. */
export interface VirtualTextureGpuArena {
  readonly [authority]: "VirtualTextureGpuArena";
}

/** Transaction supplied by a root-wide governor before an atlas upload. */
export interface VirtualTextureGpuUploadReservation {
  cancel(): void;
  commit(): void;
}

export interface VirtualTextureGpuUploadAdmission {
  /** Returning undefined leaves the upload queued without performing GL work. */
  reserve(uploadBytes: number): VirtualTextureGpuUploadReservation | undefined;
}

export interface VirtualTextureGpuResource {
  readonly [authority]: "VirtualTextureGpuResource";
}

export interface VirtualTextureGpuResourceOptions {
  readonly atlasMagFilter?: "linear" | "nearest";
  /**
   * Logical texture minification filter. The physical atlas has one mip level,
   * so mipmapped variants use their leading `linear`/`nearest` component for
   * within-page filtering; virtual mip selection is performed by the page table.
   */
  readonly atlasMinFilter?:
    | "linear"
    | "linear-mipmap-linear"
    | "linear-mipmap-nearest"
    | "nearest"
    | "nearest-mipmap-linear"
    | "nearest-mipmap-nearest";
  readonly colorSpace: TextureColorSpace;
  readonly manifest: VirtualTextureManifestModel;
  readonly physicalSlots?: number;
  /** Identifies the manifest/page-source epoch accepted by this resource. */
  readonly sourceGeneration: number;
}

export interface VirtualTextureGpuPendingUpload {
  readonly payload: VirtualTexturePagePayload;
  readonly page: VirtualTexturePageId;
  readonly pageKey: string;
  readonly sourceGeneration: number;
}

export type VirtualTextureGpuOutcome = {
  readonly evictedPageKey?: string;
  readonly key: string;
  readonly kind: "completed" | "discarded";
  readonly upload: VirtualTextureGpuPendingUpload;
};

export interface VirtualTextureGpuReleaseResult {
  readonly releaseError: unknown;
  readonly releaseErrorPresent: boolean;
}

export interface VirtualTextureGpuResidency {
  readonly page: VirtualTexturePageId;
  readonly pageKey: string;
  readonly residentMip: number;
  readonly slot: number;
}

export interface VirtualTextureGpuBinding {
  /** Physical atlas cell edge in texels, including both gutters. */
  readonly atlasCellSize: number;
  readonly atlasGridColumns: number;
  readonly atlasGridRows: number;
  /** Gutter width on one side; the logical interior starts at this cell offset. */
  readonly borderTexels: number;
  readonly pageTableHeight: number;
  readonly pageTableWidth: number;
}

export interface VirtualTextureGpuResourceSnapshot {
  readonly activePages: number;
  readonly admissionKind: VirtualTextureGpuAdmissionResult["kind"];
  readonly allocated: boolean;
  readonly allocatedBytes: number;
  readonly atlasBytes: number;
  readonly cachedPages: number;
  readonly dirtyPageTableUpdates: number;
  readonly drawable: boolean;
  readonly generation?: number;
  readonly effectiveSlots: number;
  /**
   * Physical atlas slots claimed by cached pages or an in-flight upload.
   * Unlike `cachedPages`, this includes staged assignments whose texels are
   * not reusable yet and is therefore the capacity-planning count.
   */
  readonly occupiedSlots: number;
  readonly pendingUploads: number;
  readonly paddedSlots: number;
  readonly pageTableBytes: number;
  readonly pageTableUpdates: number;
  readonly sourceGeneration: number;
  readonly uploadedPageBytes: number;
  readonly uploadedPages: number;
  readonly atlasUploadBytesPerChunkMax: number;
  readonly atlasUploadBytesPerChunkMin: number;
  readonly atlasUploadChunkSamples: number;
  readonly uploadQueueWaitMaxMs: number;
  readonly uploadQueueWaitTotalMs: number;
  readonly uploadQueueWaitTotalMsByMip: readonly number[];
  readonly uploadQueueWaitSamplesByMip: readonly number[];
  readonly uploadQueueWaitSamples: number;
}

export interface VirtualTextureGpuArenaSnapshot {
  readonly allocatedBytes: number;
  readonly allocatedResources: number;
  readonly budgetBytes: number;
  readonly chargedBytes: number;
  readonly pendingUploads: number;
  readonly resources: number;
  readonly schedulerSlots: number;
  readonly quarantinedBytes: number;
}

export type VirtualTextureGpuAdmissionResult =
  | {
      readonly allocatedBytes: number;
      readonly atlasHeight: number;
      readonly atlasBytes: number;
      readonly atlasWidth: number;
      readonly effectiveSlots: number;
      readonly kind: "supported";
      readonly paddedSlots: number;
      readonly pageTableBytes: number;
      readonly pageTableHeight: number;
      readonly pageTableWidth: number;
    }
  | {
      /** Minimum bytes required for a page table and one physical page. */
      readonly requiredBytes: number;
      readonly kind: "dormant";
      readonly reason: "physical-budget-exceeded";
    }
  | {
      readonly kind: "unsupported";
      readonly reason:
        | "insufficient-texture-units"
        | "invalid-dimensions"
        | "invalid-sampler"
        | "texture-size-exceeded";
    };

export type VirtualTextureGpuResourceAdmissionResult =
  | { readonly kind: "ready"; readonly resource: VirtualTextureGpuResource }
  | { readonly kind: "dormant"; readonly resource: VirtualTextureGpuResource; readonly reason: "physical-budget-exceeded" }
  | Extract<VirtualTextureGpuAdmissionResult, { readonly kind: "unsupported" }>
  | { readonly error: unknown; readonly kind: "failed" };

type PhysicalAllocation = {
  readonly allocatedBytes: number;
  readonly atlasGridColumns: number;
  readonly atlasGridRows: number;
  readonly atlasTexture: WebGLTexture;
  readonly generation: number;
  readonly effectiveSlots: number;
  readonly pageTable: VirtualTextureAtlasPageTable;
  pageTableUploadChargedFor?: VirtualTexturePageTableUpdate;
  readonly pageTableHeight: number;
  readonly pageTableUploadScratch: Uint8Array;
  readonly pageTableTexture: WebGLTexture;
  readonly pageTableWidth: number;
};

type MutableResource = {
  admission: VirtualTextureGpuAdmissionResult;
  allocation?: PhysicalAllocation;
  atlasUploadBytesPerChunkMax: number;
  atlasUploadBytesPerChunkMin: number;
  atlasUploadChunkSamples: number;
  readonly desiredPageKeys: Set<string>;
  desiredPageKeysPublished: boolean;
  readonly key: string;
  inFlightUpload?: {
    readonly assignment: VirtualTextureAtlasAssignment;
    phase: "invalidate-evicted" | "publish-page-table" | "upload-atlas";
    readonly upload: VirtualTextureGpuPendingUpload;
  };
  readonly options: VirtualTextureGpuResourceOptions;
  orderIndex: number;
  pageTableUpdates: number;
  pendingHead: number;
  readonly pendingUploads: VirtualTextureGpuPendingUpload[];
  readonly protectedAncestorPageKeys: Set<string>;
  readonly protectedPageKeys: { has(pageKey: string): boolean };
  uploadedPageBytes: number;
  uploadedPages: number;
  uploadQueueWaitMaxMs: number;
  uploadQueueWaitMs: number;
  readonly uploadQueueWaitMsByMip: number[];
  readonly uploadQueueWaitSamplesByMip: number[];
  uploadQueueWaitSamples: number;
  readonly visibleAssignments: Map<string, VirtualTextureAtlasAssignment>;
};

type State = {
  allocatedBytes: number;
  atlasUploadBytesThisFrame: number;
  readonly budgetBytes: number;
  readonly gl: WebGL2RenderingContext;
  readonly handles: TextureHandleArena;
  readonly maxTextureSize: number;
  readonly maxTextureUnits: number;
  readonly outcomes: VirtualTextureGpuOutcome[];
  quarantinedBytes: number;
  resourceCursor: number;
  readonly resourceOrder: MutableResource[];
  readonly resources: Map<string, MutableResource>;
  uploadFrame: number;
  uploadsThisFrame: number;
  readonly uploadQueuedAt: WeakMap<VirtualTextureGpuPendingUpload, number>;
  wakeRequested: boolean;
};

const nowMs = (): number => globalThis.performance?.now?.() ?? Date.now();

const stateOf = (arena: VirtualTextureGpuArena): State => arena as unknown as State;
const mutableResource = (resource: VirtualTextureGpuResource): MutableResource =>
  resource as unknown as MutableResource;

export const createVirtualTextureGpuArena = (
  gl: WebGL2RenderingContext,
  handles: TextureHandleArena,
  options: { readonly maxPhysicalBytes: number },
): VirtualTextureGpuArena => {
  if (!Number.isSafeInteger(options.maxPhysicalBytes) || options.maxPhysicalBytes < 0) {
    throw new Error("Virtual texture physical byte maximum must be a non-negative safe integer");
  }
  const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const maxTextureUnits = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
  return {
    allocatedBytes: 0,
    atlasUploadBytesThisFrame: 0,
    budgetBytes: options.maxPhysicalBytes,
    gl,
    handles,
    maxTextureSize,
    maxTextureUnits,
    outcomes: [],
    quarantinedBytes: 0,
    resourceCursor: 0,
    resourceOrder: [],
    resources: new Map(),
    uploadFrame: -1,
    uploadsThisFrame: 0,
    uploadQueuedAt: new WeakMap(),
    wakeRequested: false,
  } as unknown as VirtualTextureGpuArena;
};

const physicalSlotCount = (options: VirtualTextureGpuResourceOptions): number =>
  options.physicalSlots ?? options.manifest.physicalSlots ?? 4;

const isPositiveSafeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0;

/** Pure admission check shared by callers and arena allocation. */
export const virtualTextureGpuAdmission = (
  options: VirtualTextureGpuResourceOptions,
  maxTextureSize: number,
  availablePhysicalBytes: number,
  maxTextureUnits: number,
): VirtualTextureGpuAdmissionResult => {
  const { manifest } = options;
  const requestedSlots = physicalSlotCount(options);
  if (
    (options.atlasMagFilter !== undefined
      && options.atlasMagFilter !== "nearest"
      && options.atlasMagFilter !== "linear")
    || (options.atlasMinFilter !== undefined
      && options.atlasMinFilter !== "nearest"
      && options.atlasMinFilter !== "linear"
      && options.atlasMinFilter !== "nearest-mipmap-nearest"
      && options.atlasMinFilter !== "linear-mipmap-nearest"
      && options.atlasMinFilter !== "nearest-mipmap-linear"
      && options.atlasMinFilter !== "linear-mipmap-linear")
  ) return { kind: "unsupported", reason: "invalid-sampler" };
  if (!isPositiveSafeInteger(maxTextureUnits) || maxTextureUnits < 2) {
    return { kind: "unsupported", reason: "insufficient-texture-units" };
  }
  if (
    !isPositiveSafeInteger(maxTextureSize)
    || !Number.isSafeInteger(availablePhysicalBytes)
    || availablePhysicalBytes < 0
    || !isPositiveSafeInteger(manifest.width)
    || !isPositiveSafeInteger(manifest.height)
    || !isPositiveSafeInteger(manifest.pageSize)
    || !isPositiveSafeInteger(manifest.borderTexels)
    || !isPositiveSafeInteger(requestedSlots)
    || (manifest.physicalByteBudget !== undefined && !isPositiveSafeInteger(manifest.physicalByteBudget))
  ) return { kind: "unsupported", reason: "invalid-dimensions" };
  const pageTableWidth = Math.ceil(manifest.width / manifest.pageSize);
  const pageTableHeight = Math.ceil(manifest.height / manifest.pageSize);
  const pageTableBytes = pageTableWidth * pageTableHeight * 4;
  if (
    !isPositiveSafeInteger(pageTableWidth)
    || !isPositiveSafeInteger(pageTableHeight)
    || !isPositiveSafeInteger(pageTableBytes)
  ) return { kind: "unsupported", reason: "invalid-dimensions" };
  if (pageTableWidth > maxTextureSize || pageTableHeight > maxTextureSize) {
    return { kind: "unsupported", reason: "texture-size-exceeded" };
  }
  const resourceBudget = Math.min(
    availablePhysicalBytes,
    manifest.physicalByteBudget ?? availablePhysicalBytes,
  );
  let atlasCellSize: number;
  let bytesPerSlotCell: number;
  try {
    atlasCellSize = virtualTextureStoredPageSize(manifest);
    bytesPerSlotCell = virtualTextureStoredPageBytes(manifest);
  } catch {
    return { kind: "unsupported", reason: "invalid-dimensions" };
  }
  if (manifest.pageEncoding === "ktx2-basis" && atlasCellSize % 4 !== 0) {
    return { kind: "unsupported", reason: "invalid-dimensions" };
  }
  const atlasCellsPerAxis = Math.floor(maxTextureSize / atlasCellSize);
  if (atlasCellsPerAxis < 1) return { kind: "unsupported", reason: "texture-size-exceeded" };
  const atlasCellBudget = Math.floor((resourceBudget - pageTableBytes) / bytesPerSlotCell);
  const requiredBytes = pageTableBytes + bytesPerSlotCell;
  if (atlasCellBudget < 1) {
    return { kind: "dormant", reason: "physical-budget-exceeded", requiredBytes };
  }
  const logicalPages = generatedVirtualTexturePageCount(
    manifest.width,
    manifest.height,
    manifest.pageSize,
  );
  const upperSlots = Math.min(
    requestedSlots,
    logicalPages,
    atlasCellsPerAxis * atlasCellsPerAxis,
    MAX_ENCODED_PHYSICAL_SLOTS,
  );
  let low = 1;
  let high = upperSlots;
  let effectiveSlots = 0;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const columns = Math.ceil(Math.sqrt(candidate));
    const rows = Math.ceil(candidate / columns);
    if (columns * rows <= atlasCellBudget) {
      effectiveSlots = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }
  if (effectiveSlots < 1) {
    return { kind: "dormant", reason: "physical-budget-exceeded", requiredBytes };
  }
  const atlasGridColumns = Math.ceil(Math.sqrt(effectiveSlots));
  const atlasGridRows = Math.ceil(effectiveSlots / atlasGridColumns);
  const paddedSlots = atlasGridColumns * atlasGridRows;
  const atlasWidth = atlasGridColumns * atlasCellSize;
  const atlasHeight = atlasGridRows * atlasCellSize;
  const atlasBytes = paddedSlots * bytesPerSlotCell;
  const allocatedBytes = atlasBytes + pageTableBytes;
  return {
    allocatedBytes,
    atlasHeight,
    atlasBytes,
    atlasWidth,
    effectiveSlots,
    kind: "supported",
    paddedSlots,
    pageTableBytes,
    pageTableHeight,
    pageTableWidth,
  };
};

const assertCompatibleOptions = (
  resource: MutableResource,
  options: VirtualTextureGpuResourceOptions,
): void => {
  const current = resource.options;
  if (
    current.manifest !== options.manifest
    || current.colorSpace !== options.colorSpace
    || current.atlasMagFilter !== options.atlasMagFilter
    || current.atlasMinFilter !== options.atlasMinFilter
    || physicalSlotCount(current) !== physicalSlotCount(options)
    || current.sourceGeneration !== options.sourceGeneration
  ) throw new Error(`Virtual texture ${resource.key} was ensured with different options`);
};

const setSampler = (
  gl: WebGL2RenderingContext,
  magFilter: number,
  minFilter: number,
): void => {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

const releaseAllocationHandles = (
  state: State,
  allocation: Pick<PhysicalAllocation, "atlasTexture" | "pageTableTexture">,
): { readonly error: unknown; readonly present: boolean } => {
  let releaseError: unknown;
  let releaseErrorPresent = false;
  for (const texture of [allocation.pageTableTexture, allocation.atlasTexture]) {
    try {
      releaseOwnedTexture(state.handles, texture);
    } catch (error) {
      if (!releaseErrorPresent) {
        releaseError = error;
        releaseErrorPresent = true;
      }
    }
  }
  return { error: releaseError, present: releaseErrorPresent };
};

const allocate = (
  state: State,
  resource: MutableResource,
  generation: number,
  admission: Extract<VirtualTextureGpuAdmissionResult, { readonly kind: "supported" }>,
): PhysicalAllocation => {
  const { gl } = state;
  const slots = admission.effectiveSlots;
  const atlasGridColumns = Math.ceil(Math.sqrt(slots));
  const atlasGridRows = Math.ceil(slots / atlasGridColumns);
  const { pageTableHeight, pageTableWidth } = admission;
  let atlasTexture: WebGLTexture | undefined;
  let pageTableTexture: WebGLTexture | undefined;
  try {
    atlasTexture = createOwnedTexture(state.handles);
    pageTableTexture = createOwnedTexture(state.handles);
    prepareTextureUpload(gl);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    if (resource.options.manifest.pageEncoding === "ktx2-basis") {
      gl.texStorage2D(
        gl.TEXTURE_2D,
        1,
        resource.options.colorSpace === "srgb"
          ? WEBGL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC
          : WEBGL_COMPRESSED_RGBA8_ETC2_EAC,
        admission.atlasWidth,
        admission.atlasHeight,
      );
    } else {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        textureUploadInternalFormat(gl, resource.options.colorSpace),
        admission.atlasWidth,
        admission.atlasHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
    }
    setSampler(
      gl,
      resource.options.atlasMagFilter === "nearest" ? WEBGL_NEAREST : WEBGL_LINEAR,
      // Virtual LOD comes from the page table; the single-level atlas retains
      // only the filter's leading within-page minification component.
      resource.options.atlasMinFilter?.startsWith("nearest") === true ? WEBGL_NEAREST : WEBGL_LINEAR,
    );
    gl.bindTexture(gl.TEXTURE_2D, pageTableTexture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      pageTableWidth,
      pageTableHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    setSampler(gl, gl.NEAREST, gl.NEAREST);
    const pageTable = new VirtualTextureAtlasPageTable({ slotCount: slots });
    if (resource.desiredPageKeysPublished) {
      pageTable.reconcileActivePageKeys(resource.desiredPageKeys);
    }
    return {
      allocatedBytes: admission.allocatedBytes,
      atlasGridColumns,
      atlasGridRows,
      atlasTexture,
      effectiveSlots: admission.effectiveSlots,
      generation,
      pageTable,
      pageTableHeight,
      pageTableUploadScratch: new Uint8Array(PAGE_TABLE_UPLOAD_SCRATCH_BYTES),
      pageTableTexture,
      pageTableWidth,
    };
  } catch (error) {
    let rollbackDeleteFailed = false;
    if (pageTableTexture !== undefined) {
      try { releaseOwnedTexture(state.handles, pageTableTexture); } catch { rollbackDeleteFailed = true; }
    }
    if (atlasTexture !== undefined) {
      try { releaseOwnedTexture(state.handles, atlasTexture); } catch { rollbackDeleteFailed = true; }
    }
    if (rollbackDeleteFailed) state.quarantinedBytes += admission.allocatedBytes;
    throw error;
  }
};

export const admitVirtualTextureGpuResource = (
  arena: VirtualTextureGpuArena,
  key: string,
  generation: number,
  options: VirtualTextureGpuResourceOptions,
): VirtualTextureGpuResourceAdmissionResult => {
  const state = stateOf(arena);
  let resource = state.resources.get(key);
  const created = resource === undefined;
  if (resource !== undefined) {
    assertCompatibleOptions(resource, options);
    const existing = resource.allocation;
    if (existing !== undefined) {
      if (existing.generation !== generation) {
        throw new Error(`Virtual texture ${key} belongs to stale context generation ${existing.generation}`);
      }
      return { kind: "ready", resource: resource as unknown as VirtualTextureGpuResource };
    }
  }
  const admission = virtualTextureGpuAdmission(
    options,
    state.maxTextureSize,
    state.budgetBytes - state.allocatedBytes - state.quarantinedBytes,
    state.maxTextureUnits,
  );
  if (admission.kind === "unsupported") return admission;
  if (resource === undefined) {
    const desiredPageKeys = new Set<string>();
    const protectedAncestorPageKeys = new Set<string>();
    resource = {
      admission,
      desiredPageKeys,
      desiredPageKeysPublished: false,
      key,
      visibleAssignments: new Map(),
      options,
      orderIndex: state.resourceOrder.length,
      pageTableUpdates: 0,
      pendingHead: 0,
      pendingUploads: [],
      protectedAncestorPageKeys,
      protectedPageKeys: {
        has: (pageKey) => desiredPageKeys.has(pageKey) || protectedAncestorPageKeys.has(pageKey),
      },
      atlasUploadBytesPerChunkMax: 0,
      atlasUploadBytesPerChunkMin: 0,
      atlasUploadChunkSamples: 0,
      uploadedPageBytes: 0,
      uploadedPages: 0,
      uploadQueueWaitMaxMs: 0,
      uploadQueueWaitMs: 0,
      uploadQueueWaitMsByMip: [],
      uploadQueueWaitSamplesByMip: [],
      uploadQueueWaitSamples: 0,
    };
    state.resources.set(key, resource);
    state.resourceOrder.push(resource);
  } else {
    resource.admission = admission;
  }
  if (admission.kind === "dormant") {
    return { kind: "dormant", reason: admission.reason, resource: resource as unknown as VirtualTextureGpuResource };
  }
  try {
    resource.allocation = allocate(state, resource, generation, admission);
    state.allocatedBytes += admission.allocatedBytes;
  } catch (error) {
    if (created) {
      state.resources.delete(key);
      removeResourceOrder(state, resource);
    }
    return { error, kind: "failed" };
  }
  if (resource.pendingHead < resource.pendingUploads.length) state.wakeRequested = true;
  return { kind: "ready", resource: resource as unknown as VirtualTextureGpuResource };
};

export const virtualTextureGpuResource = (
  arena: VirtualTextureGpuArena,
  key: string,
): VirtualTextureGpuResource | undefined =>
  stateOf(arena).resources.get(key) as unknown as VirtualTextureGpuResource | undefined;

const removeResourceOrder = (state: State, resource: MutableResource): void => {
  const removedIndex = resource.orderIndex;
  state.resourceOrder.splice(removedIndex, 1);
  for (let index = removedIndex; index < state.resourceOrder.length; index += 1) {
    const shifted = state.resourceOrder[index];
    if (shifted !== undefined) shifted.orderIndex = index;
  }
  if (removedIndex < state.resourceCursor) state.resourceCursor -= 1;
  if (state.resourceOrder.length === 0) {
    state.resourceCursor = 0;
  }
  else {
    state.resourceCursor %= state.resourceOrder.length;
  }
};

const validVirtualTexturePage = (
  manifest: VirtualTextureManifestModel,
  page: VirtualTexturePageId,
): boolean => {
  if (
    !Number.isSafeInteger(page.mip)
    || !Number.isSafeInteger(page.x)
    || !Number.isSafeInteger(page.y)
    || page.mip < 0
    || page.x < 0
    || page.y < 0
  ) return false;
  const baseWidth = Math.ceil(manifest.width / manifest.pageSize);
  const baseHeight = Math.ceil(manifest.height / manifest.pageSize);
  const mipCount = manifest.mipCount
    ?? derivedVirtualTextureMipCount(manifest.width, manifest.height, manifest.pageSize);
  if (page.mip >= mipCount) return false;
  const mipWidth = virtualTextureMipDimension(baseWidth, page.mip);
  const mipHeight = virtualTextureMipDimension(baseHeight, page.mip);
  return page.x < mipWidth && page.y < mipHeight;
};

const validVirtualTextureGpuPayload = (
  manifest: VirtualTextureManifestModel,
  payload: VirtualTexturePagePayload,
): boolean => {
  if (manifest.pageEncoding === "image") return payload.kind === "image";
  if (payload.kind !== "compressed") return false;
  const storedPageSize = virtualTextureStoredPageSize(manifest);
  return payload.format === WEBGL_COMPRESSED_RGBA8_ETC2_EAC
    && payload.srgbFormat === WEBGL_COMPRESSED_SRGB8_ALPHA8_ETC2_EAC
    && payload.width === storedPageSize
    && payload.height === storedPageSize
    && payload.data.byteLength === virtualTextureStoredPageBytes(manifest);
};

export const queueVirtualTextureGpuUpload = (
  arena: VirtualTextureGpuArena,
  resource: VirtualTextureGpuResource,
  upload: VirtualTextureGpuPendingUpload,
): boolean => {
  const state = stateOf(arena);
  const mutable = mutableResource(resource);
  if (state.resources.get(mutable.key) !== mutable) return false;
  const allocation = mutable.allocation;
  // False leaves payload ownership with the caller; only an indexed outcome transfers it back.
  if (
    upload.sourceGeneration !== mutable.options.sourceGeneration
    || (mutable.desiredPageKeysPublished && !mutable.desiredPageKeys.has(upload.pageKey))
    || !validVirtualTexturePage(mutable.options.manifest, upload.page)
    || !validVirtualTextureGpuPayload(mutable.options.manifest, upload.payload)
    || upload.pageKey !== virtualTexturePageKey(upload.page)
    || allocation?.pageTable.residentSlot(upload.page) !== undefined
  ) return false;
  for (let index = mutable.pendingHead; index < mutable.pendingUploads.length; index += 1) {
    if (mutable.pendingUploads[index]?.pageKey === upload.pageKey) return false;
  }
  mutable.pendingUploads.push(upload);
  state.uploadQueuedAt.set(upload, nowMs());
  if (allocation !== undefined) state.wakeRequested = true;
  return true;
};

/**
 * Publishes the resource's latest desired working set and returns ownership of
 * obsolete queued payloads through ordinary discarded outcomes. An upload whose
 * atlas/page-table transaction has started remains owned until it completes or
 * the resource is released.
 */
export const setVirtualTextureGpuDesiredPageKeys = (
  arena: VirtualTextureGpuArena,
  resource: VirtualTextureGpuResource,
  pageKeys: ReadonlySet<string>,
): boolean => {
  const state = stateOf(arena);
  const mutable = mutableResource(resource);
  if (state.resources.get(mutable.key) !== mutable) return false;

  mutable.desiredPageKeys.clear();
  for (const pageKey of pageKeys) mutable.desiredPageKeys.add(pageKey);
  mutable.desiredPageKeysPublished = true;

  const allocation = mutable.allocation;
  if (allocation !== undefined) {
    const changed = allocation.pageTable.reconcileActivePageKeys(mutable.desiredPageKeys);
    // Withdraw stale logical visibility before its queued GPU invalidation.
    // Newly active cached pages remain withheld until the page-table flush
    // succeeds and synchronizes them below.
    for (const pageKey of mutable.visibleAssignments.keys()) {
      if (!mutable.desiredPageKeys.has(pageKey)) mutable.visibleAssignments.delete(pageKey);
    }
    if (changed && allocation.pageTable.dirtyPageTableUpdateCount > 0) {
      state.wakeRequested = true;
    }
  }

  const firstCancelable = mutable.pendingHead + (mutable.inFlightUpload === undefined ? 0 : 1);
  let writeIndex = firstCancelable;
  for (let readIndex = firstCancelable; readIndex < mutable.pendingUploads.length; readIndex += 1) {
    const upload = mutable.pendingUploads[readIndex];
    if (upload === undefined) continue;
    if (mutable.desiredPageKeys.has(upload.pageKey)) {
      mutable.pendingUploads[writeIndex] = upload;
      writeIndex += 1;
    } else {
      publish(state, mutable, "discarded", upload);
    }
  }
  mutable.pendingUploads.length = writeIndex;
  compactPending(mutable);
  return true;
};

const synchronizeVisibleAssignments = (
  resource: MutableResource,
  allocation: PhysicalAllocation,
): void => {
  resource.visibleAssignments.clear();
  for (const record of allocation.pageTable.activeResidentPages()) {
    resource.visibleAssignments.set(record.pageKey, record);
  }
};

const pageTableRegion = (
  allocation: PhysicalAllocation,
  update: VirtualTexturePageTableUpdate,
): {
  readonly height: number;
  readonly residentMip: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
} | undefined => {
  const coverage = 2 ** update.page.mip;
  const x = update.page.x * coverage;
  const y = update.page.y * coverage;
  const width = Math.min(allocation.pageTableWidth, x + coverage) - x;
  const height = Math.min(allocation.pageTableHeight, y + coverage) - y;
  if (width <= 0 || height <= 0) return undefined;
  return {
    height,
    residentMip: update.slot === undefined ? 0 : update.residentMip ?? update.page.mip,
    width,
    x,
    y,
  };
};

const flushNextPageTableUpdate = (
  state: State,
  resource: MutableResource,
  allocation: PhysicalAllocation,
  admission?: VirtualTextureGpuUploadAdmission,
): "blocked" | "empty" | "flushed" => {
  if (!ownsTexture(state.handles, allocation.pageTableTexture)) return "empty";
  const update = allocation.pageTable.dirtyPageTableUpdate(0);
  if (update === undefined) return "empty";
  if (
    allocation.pageTableUploadChargedFor !== undefined
    && allocation.pageTableUploadChargedFor !== update
  ) delete allocation.pageTableUploadChargedFor;
  const uploadAlreadyCharged = allocation.pageTableUploadChargedFor === update;
  const region = pageTableRegion(allocation, update);
  const uploadBytes = region === undefined ? 0 : region.width * region.height * 4;
  const reservation = uploadBytes === 0 || uploadAlreadyCharged
    ? undefined
    : admission?.reserve(uploadBytes);
  if (
    uploadBytes !== 0
    && !uploadAlreadyCharged
    && admission !== undefined
    && reservation === undefined
  ) return "blocked";
  const { gl } = state;
  let attempted = false;
  try {
    prepareTextureUpload(gl);
    gl.bindTexture(gl.TEXTURE_2D, allocation.pageTableTexture);
    if (region !== undefined) {
      const texel = encodeVirtualTexturePageTableRgba8({
        residentMip: region.residentMip,
        ...(update.slot === undefined ? {} : { slot: update.slot }),
      });
      const scratch = allocation.pageTableUploadScratch;
      for (let index = 0; index < scratch.length; index += 4) scratch.set(texel, index);
      const maxCells = scratch.length / 4;
      const chunkWidth = Math.min(region.width, maxCells);
      const chunkHeight = Math.max(1, Math.floor(maxCells / chunkWidth));
      for (let y = 0; y < region.height; y += chunkHeight) {
        const height = Math.min(chunkHeight, region.height - y);
        for (let x = 0; x < region.width; x += chunkWidth) {
          const width = Math.min(chunkWidth, region.width - x);
          const byteLength = width * height * 4;
          attempted = true;
          allocation.pageTableUploadChargedFor = update;
          gl.texSubImage2D(
            gl.TEXTURE_2D,
            0,
            region.x + x,
            region.y + y,
            width,
            height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            byteLength === scratch.length ? scratch : scratch.subarray(0, byteLength),
          );
        }
      }
      resource.pageTableUpdates += region.width * region.height;
    }
    reservation?.commit();
  } catch (error) {
    if (attempted) reservation?.commit();
    else reservation?.cancel();
    throw error;
  }
  allocation.pageTable.commitDirtyPageTableUpdate();
  delete allocation.pageTableUploadChargedFor;
  return "flushed";
};

const flushPageTable = (
  state: State,
  resource: MutableResource,
  allocation: PhysicalAllocation,
  admission?: VirtualTextureGpuUploadAdmission,
): boolean => {
  for (;;) {
    const result = flushNextPageTableUpdate(state, resource, allocation, admission);
    if (result === "blocked") return false;
    if (result === "empty") {
      synchronizeVisibleAssignments(resource, allocation);
      return true;
    }
    // Drain complete page-table updates; a thrown GL call leaves the current
    // update uncommitted so the owning upload phase can retry it idempotently.
  }
};

const protectedUploadPages = (
  resource: MutableResource,
  page: VirtualTexturePageId,
): { has(pageKey: string): boolean } => {
  const protectedAncestors = resource.protectedAncestorPageKeys;
  protectedAncestors.clear();
  const manifest = resource.options.manifest;
  const maxMip = manifest.mipCount
    ?? derivedVirtualTextureMipCount(manifest.width, manifest.height, manifest.pageSize);
  let parent = parentVirtualTexturePage(page);
  while (parent.mip < maxMip) {
    protectedAncestors.add(virtualTexturePageKey(parent));
    parent = parentVirtualTexturePage(parent);
  }
  return resource.protectedPageKeys;
};

const publish = (
  state: State,
  resource: MutableResource,
  kind: VirtualTextureGpuOutcome["kind"],
  upload: VirtualTextureGpuPendingUpload,
  evictedPageKey?: string,
): void => {
  if (kind === "discarded") state.uploadQueuedAt.delete(upload);
  state.outcomes.push({
    ...(evictedPageKey === undefined ? {} : { evictedPageKey }),
    key: resource.key,
    kind,
    upload,
  });
};

const compactPending = (resource: MutableResource): void => {
  if (resource.pendingHead < resource.pendingUploads.length) return;
  resource.pendingHead = 0;
  resource.pendingUploads.length = 0;
};

const acknowledgeInFlightUpload = (state: State, resource: MutableResource): void => {
  const inFlight = resource.inFlightUpload;
  if (inFlight === undefined) return;
  const { assignment, upload } = inFlight;
  const allocation = resource.allocation;
  if (allocation !== undefined) synchronizeVisibleAssignments(resource, allocation);
  resource.pendingHead += 1;
  publish(state, resource, "completed", upload, assignment.evicted?.pageKey);
  resource.uploadedPageBytes += virtualTextureStoredPageBytes(resource.options.manifest);
  resource.uploadedPages += 1;
  const uploadBytes = virtualTextureStoredPageBytes(resource.options.manifest);
  resource.atlasUploadChunkSamples += 1;
  resource.atlasUploadBytesPerChunkMax = Math.max(resource.atlasUploadBytesPerChunkMax, uploadBytes);
  resource.atlasUploadBytesPerChunkMin = resource.atlasUploadBytesPerChunkMin === 0
    ? uploadBytes
    : Math.min(resource.atlasUploadBytesPerChunkMin, uploadBytes);
  const queuedAt = state.uploadQueuedAt.get(upload);
  state.uploadQueuedAt.delete(upload);
  if (queuedAt !== undefined) {
    const waitMs = Math.max(0, nowMs() - queuedAt);
    const mip = upload.page.mip;
    resource.uploadQueueWaitMs += waitMs;
    resource.uploadQueueWaitMaxMs = Math.max(resource.uploadQueueWaitMaxMs, waitMs);
    resource.uploadQueueWaitSamples += 1;
    resource.uploadQueueWaitMsByMip[mip] = (resource.uploadQueueWaitMsByMip[mip] ?? 0) + waitMs;
    resource.uploadQueueWaitSamplesByMip[mip] = (resource.uploadQueueWaitSamplesByMip[mip] ?? 0) + 1;
  }
  state.uploadsThisFrame += 1;
  delete resource.inFlightUpload;
  compactPending(resource);
  // Settlement can make a previously admitted page physically resident even
  // when this was the final actionable GPU operation. Wake demand planning so
  // bounded replacement can admit its next tranche or drop transition overlap.
  state.wakeRequested = true;
};

const resumeInFlightUpload = (
  state: State,
  resource: MutableResource,
  allocation: PhysicalAllocation,
  admission?: VirtualTextureGpuUploadAdmission,
): boolean => {
  const inFlight = resource.inFlightUpload;
  if (inFlight === undefined) return true;
  const { assignment, upload } = inFlight;
  if (inFlight.phase === "invalidate-evicted") {
    const result = flushNextPageTableUpdate(state, resource, allocation, admission);
    if (result === "blocked") return false;
    if (result === "empty") {
      throw new Error("Virtual texture eviction is missing its page-table invalidation");
    }
    inFlight.phase = "upload-atlas";
  }
  if (inFlight.phase === "upload-atlas") {
    const { gl } = state;
    const atlasCellSize = virtualTextureStoredPageSize(resource.options.manifest);
    prepareTextureUpload(gl);
    gl.bindTexture(gl.TEXTURE_2D, allocation.atlasTexture);
    const x = (assignment.slot % allocation.atlasGridColumns) * atlasCellSize;
    const y = Math.floor(assignment.slot / allocation.atlasGridColumns) * atlasCellSize;
    if (upload.payload.kind === "compressed") {
      gl.compressedTexSubImage2D(
        gl.TEXTURE_2D,
        0,
        x,
        y,
        upload.payload.width,
        upload.payload.height,
        resource.options.colorSpace === "srgb" ? upload.payload.srgbFormat : upload.payload.format,
        upload.payload.data,
      );
    } else {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        x,
        y,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        upload.payload.image,
      );
    }
    state.atlasUploadBytesThisFrame += virtualTextureStoredPageBytes(resource.options.manifest);
    inFlight.phase = "publish-page-table";
  }
  if (inFlight.phase === "publish-page-table") {
    if (!flushPageTable(state, resource, allocation, admission)) return false;
    acknowledgeInFlightUpload(state, resource);
  }
  return true;
};

const startUpload = (
  state: State,
  resource: MutableResource,
  allocation: PhysicalAllocation,
  upload: VirtualTextureGpuPendingUpload,
  admission?: VirtualTextureGpuUploadAdmission,
): boolean => {
  const transaction = allocation.pageTable.planResident(upload.page, {
    protectedPages: protectedUploadPages(resource, upload.page),
  });
  const assignment = transaction.assignment;
  const evictionNeedsInvalidation = assignment.evicted !== undefined
    && allocation.pageTable.isActivePageKey(assignment.evicted.pageKey);
  allocation.pageTable.commitResident(transaction);
  resource.inFlightUpload = {
    assignment,
    phase: evictionNeedsInvalidation ? "invalidate-evicted" : "upload-atlas",
    upload,
  };
  if (assignment.evicted !== undefined) {
    // CPU visibility is withdrawn before the old GPU mapping is invalidated.
    resource.visibleAssignments.delete(assignment.evicted.pageKey);
  }
  return resumeInFlightUpload(state, resource, allocation, admission);
};

const atlasUploadWasSpent = (resource: MutableResource): boolean =>
  resource.inFlightUpload?.phase === "publish-page-table";

const canSpendAtlasUploadBytes = (state: State, uploadBytes: number): boolean =>
  state.atlasUploadBytesThisFrame === 0
  || state.atlasUploadBytesThisFrame + uploadBytes <= TARGET_MAX_ATLAS_UPLOAD_BYTES_PER_FRAME;

export const processVirtualTextureGpuUploads = (
  arena: VirtualTextureGpuArena,
  frame: number,
  admission?: VirtualTextureGpuUploadAdmission,
): void => {
  const state = stateOf(arena);
  if (state.uploadFrame !== frame) {
    state.uploadFrame = frame;
    state.uploadsThisFrame = 0;
    state.atlasUploadBytesThisFrame = 0;
  }
  let scansWithoutUpload = 0;
  while (
    state.uploadsThisFrame < MAX_PAGE_UPLOADS_PER_FRAME
    && scansWithoutUpload < state.resourceOrder.length
  ) {
    if (state.resourceOrder.length === 0) break;
    const resource = state.resourceOrder[state.resourceCursor];
    state.resourceCursor = (state.resourceCursor + 1) % state.resourceOrder.length;
    scansWithoutUpload += 1;
    if (resource === undefined || state.resources.get(resource.key) !== resource) continue;
    const allocation = resource.allocation;
    if (allocation === undefined) continue;
    if (
      !ownsTexture(state.handles, allocation.atlasTexture)
      || !ownsTexture(state.handles, allocation.pageTableTexture)
    ) continue;
    if (resource.inFlightUpload !== undefined) {
      const phaseBefore = resource.inFlightUpload.phase;
      const requiresAtlasUpload = resource.inFlightUpload.phase !== "publish-page-table";
      const uploadBytes = virtualTextureStoredPageBytes(resource.options.manifest);
      if (requiresAtlasUpload && !canSpendAtlasUploadBytes(state, uploadBytes)) continue;
      const reservation = requiresAtlasUpload
        ? admission?.reserve(uploadBytes)
        : undefined;
      if (requiresAtlasUpload && admission !== undefined && reservation === undefined) continue;
      try {
        const completed = resumeInFlightUpload(state, resource, allocation, admission);
        if (completed || atlasUploadWasSpent(resource)) reservation?.commit();
        else reservation?.cancel();
        if (completed || resource.inFlightUpload?.phase !== phaseBefore) scansWithoutUpload = 0;
      } catch (error) {
        // Once the atlas write succeeded, upload bandwidth was spent even if
        // the subsequent page-table publication failed. Its retry must not be
        // charged a second time.
        if (atlasUploadWasSpent(resource)) reservation?.commit();
        else reservation?.cancel();
        throw error;
      }
    } else if (!flushPageTable(state, resource, allocation, admission)) {
      // Independent reconciliation must reach the GPU before a new atlas
      // transaction can claim or overwrite a slot. In particular, do not let
      // an upload jump past a budget-blocked invalidation.
      continue;
    }
    const upload = resource.pendingUploads[resource.pendingHead];
    if (upload !== undefined && resource.inFlightUpload === undefined) {
      const uploadBytes = virtualTextureStoredPageBytes(resource.options.manifest);
      if (!canSpendAtlasUploadBytes(state, uploadBytes)) continue;
      const reservation = admission?.reserve(uploadBytes);
      if (admission !== undefined && reservation === undefined) continue;
      try {
        const completed = startUpload(state, resource, allocation, upload, admission);
        if (completed || atlasUploadWasSpent(resource)) reservation?.commit();
        else reservation?.cancel();
      } catch (error) {
        if (atlasUploadWasSpent(resource)) reservation?.commit();
        else reservation?.cancel();
        throw error;
      }
      scansWithoutUpload = 0;
    }
  }
  if (virtualTextureGpuHasActionableUploads(arena)) state.wakeRequested = true;
};

export const flushVirtualTextureGpuPageTables = (
  arena: VirtualTextureGpuArena,
  admission?: VirtualTextureGpuUploadAdmission,
): void => {
  const state = stateOf(arena);
  for (const resource of state.resources.values()) {
    const allocation = resource.allocation;
    if (allocation !== undefined) {
      if (resource.inFlightUpload === undefined) flushPageTable(state, resource, allocation, admission);
      else resumeInFlightUpload(state, resource, allocation, admission);
    }
  }
};

export const virtualTextureGpuHasActionableUploads = (
  arena: VirtualTextureGpuArena,
): boolean => {
  const state = stateOf(arena);
  for (const resource of state.resources.values()) {
    const allocation = resource.allocation;
    if (
      allocation !== undefined
      && ownsTexture(state.handles, allocation.atlasTexture)
      && ownsTexture(state.handles, allocation.pageTableTexture)
      && (
        resource.pendingHead < resource.pendingUploads.length
        || allocation.pageTable.dirtyPageTableUpdateCount > 0
      )
    ) return true;
  }
  return false;
};

export const consumeVirtualTextureGpuWake = (arena: VirtualTextureGpuArena): boolean => {
  const state = stateOf(arena);
  const wake = state.wakeRequested;
  state.wakeRequested = false;
  return wake;
};

export const virtualTextureGpuOutcomeCount = (arena: VirtualTextureGpuArena): number =>
  stateOf(arena).outcomes.length;

export const virtualTextureGpuOutcome = (
  arena: VirtualTextureGpuArena,
  index: number,
): VirtualTextureGpuOutcome | undefined => stateOf(arena).outcomes[index];

export const clearVirtualTextureGpuOutcomes = (arena: VirtualTextureGpuArena): void => {
  stateOf(arena).outcomes.length = 0;
};

const assignmentResidency = (
  assignment: VirtualTextureAtlasAssignment,
): VirtualTextureGpuResidency => ({
  page: assignment.page,
  pageKey: assignment.pageKey,
  residentMip: assignment.page.mip,
  slot: assignment.slot,
});

export const virtualTextureGpuExactResidency = (
  arena: VirtualTextureGpuArena,
  key: string,
  page: VirtualTexturePageId,
): VirtualTextureGpuResidency | undefined => {
  const resource = stateOf(arena).resources.get(key);
  const assignment = resource?.visibleAssignments.get(virtualTexturePageKey(page));
  return assignment === undefined ? undefined : assignmentResidency(assignment);
};

/** Pure physical-cache query; inactive cached pages are intentionally included. */
export const virtualTextureGpuCachedResidency = (
  arena: VirtualTextureGpuArena,
  key: string,
  page: VirtualTexturePageId,
): VirtualTextureGpuResidency | undefined => {
  const resource = stateOf(arena).resources.get(key);
  const allocation = resource?.allocation;
  const record = allocation?.pageTable.residentPage(virtualTexturePageKey(page));
  if (record === undefined) return undefined;
  const inFlight = resource?.inFlightUpload;
  if (
    inFlight?.assignment.pageKey === record.pageKey
    && inFlight.phase !== "publish-page-table"
  ) return undefined;
  return assignmentResidency(record);
};

/** Pure fallback coverage query; does not touch clock reference bits. */
export const virtualTextureGpuCoverage = (
  arena: VirtualTextureGpuArena,
  key: string,
  requested: VirtualTexturePageId,
  maxMip = requested.mip + 32,
): VirtualTextureGpuResidency | undefined => {
  let page = requested;
  while (page.mip <= maxMip) {
    const residency = virtualTextureGpuExactResidency(arena, key, page);
    if (residency !== undefined) return residency;
    page = parentVirtualTexturePage(page);
  }
  return undefined;
};

/** Resolves fallback coverage and explicitly touches its eviction reference bit. */
export const touchVirtualTextureGpuResidency = (
  arena: VirtualTextureGpuArena,
  key: string,
  requested: VirtualTexturePageId,
  maxMip?: number,
): VirtualTextureGpuResidency | undefined => {
  const allocation = stateOf(arena).resources.get(key)?.allocation;
  const visible = virtualTextureGpuCoverage(arena, key, requested, maxMip);
  if (visible === undefined) return undefined;
  allocation?.pageTable.resolveResidentFallback(visible.page, { maxMip: visible.page.mip });
  return visible;
};

export const virtualTextureGpuDrawable = (arena: VirtualTextureGpuArena, key: string): boolean => {
  const allocation = stateOf(arena).resources.get(key)?.allocation;
  return allocation !== undefined && (stateOf(arena).resources.get(key)?.visibleAssignments.size ?? 0) > 0;
};

export const bindVirtualTextureGpuResource = (
  arena: VirtualTextureGpuArena,
  key: string,
  atlasTextureUnit: number,
  pageTableTextureUnit: number,
): VirtualTextureGpuBinding | undefined => {
  const state = stateOf(arena);
  if (
    !Number.isSafeInteger(atlasTextureUnit)
    || !Number.isSafeInteger(pageTableTextureUnit)
    || atlasTextureUnit < 0
    || pageTableTextureUnit < 0
    || atlasTextureUnit === pageTableTextureUnit
    || atlasTextureUnit >= state.maxTextureUnits
    || pageTableTextureUnit >= state.maxTextureUnits
  ) return undefined;
  const resource = state.resources.get(key);
  const allocation = resource?.allocation;
  if (
    resource === undefined
    || allocation === undefined
    || resource.visibleAssignments.size === 0
    || !ownsTexture(state.handles, allocation.atlasTexture)
    || !ownsTexture(state.handles, allocation.pageTableTexture)
  ) return undefined;
  state.gl.activeTexture(state.gl.TEXTURE0 + atlasTextureUnit);
  state.gl.bindTexture(state.gl.TEXTURE_2D, allocation.atlasTexture);
  state.gl.activeTexture(state.gl.TEXTURE0 + pageTableTextureUnit);
  state.gl.bindTexture(state.gl.TEXTURE_2D, allocation.pageTableTexture);
  return {
    atlasCellSize: virtualTextureStoredPageSize(resource.options.manifest),
    atlasGridColumns: allocation.atlasGridColumns,
    atlasGridRows: allocation.atlasGridRows,
    borderTexels: resource.options.manifest.borderTexels,
    pageTableHeight: allocation.pageTableHeight,
    pageTableWidth: allocation.pageTableWidth,
  };
};

export const virtualTextureGpuResourceSnapshot = (
  resource: VirtualTextureGpuResource,
): VirtualTextureGpuResourceSnapshot => {
  const mutable = mutableResource(resource);
  const allocation = mutable.allocation;
  const supported = mutable.admission.kind === "supported" ? mutable.admission : undefined;
  const stagedPageKey = mutable.inFlightUpload?.phase === "publish-page-table"
    ? undefined
    : mutable.inFlightUpload?.assignment.pageKey;
  const occupiedPages = allocation?.pageTable.residentPages() ?? [];
  const cachedPages = occupiedPages.filter((record) => record.pageKey !== stagedPageKey).length;
  return {
    activePages: mutable.visibleAssignments.size,
    admissionKind: mutable.admission.kind,
    allocated: allocation !== undefined,
    allocatedBytes: allocation?.allocatedBytes ?? 0,
    atlasBytes: supported?.atlasBytes ?? 0,
    cachedPages,
    dirtyPageTableUpdates: allocation?.pageTable.dirtyPageTableUpdateCount ?? 0,
    drawable: mutable.visibleAssignments.size > 0,
    effectiveSlots: supported?.effectiveSlots ?? 0,
    occupiedSlots: occupiedPages.length,
    ...(allocation === undefined ? {} : { generation: allocation.generation }),
    pendingUploads: mutable.pendingUploads.length - mutable.pendingHead,
    paddedSlots: supported?.paddedSlots ?? 0,
    pageTableBytes: supported?.pageTableBytes ?? 0,
    pageTableUpdates: mutable.pageTableUpdates,
    sourceGeneration: mutable.options.sourceGeneration,
    uploadedPageBytes: mutable.uploadedPageBytes,
    uploadedPages: mutable.uploadedPages,
    atlasUploadBytesPerChunkMax: mutable.atlasUploadBytesPerChunkMax,
    atlasUploadBytesPerChunkMin: mutable.atlasUploadBytesPerChunkMin,
    atlasUploadChunkSamples: mutable.atlasUploadChunkSamples,
    uploadQueueWaitMaxMs: mutable.uploadQueueWaitMaxMs,
    uploadQueueWaitTotalMs: mutable.uploadQueueWaitMs,
    uploadQueueWaitTotalMsByMip: [...mutable.uploadQueueWaitMsByMip],
    uploadQueueWaitSamplesByMip: [...mutable.uploadQueueWaitSamplesByMip],
    uploadQueueWaitSamples: mutable.uploadQueueWaitSamples,
  };
};

/** Adds this resource's active page counts to a diagnostics-owned mip histogram. */
export const accumulateVirtualTextureGpuActivePagesByMip = (
  resource: VirtualTextureGpuResource,
  target: number[],
): void => {
  for (const assignment of mutableResource(resource).visibleAssignments.values()) {
    while (target.length <= assignment.page.mip) target.push(0);
    target[assignment.page.mip] = target[assignment.page.mip]! + 1;
  }
};

/** Adds this resource's cached atlas page counts to a diagnostics-owned mip histogram. */
export const accumulateVirtualTextureGpuCachedPagesByMip = (
  resource: VirtualTextureGpuResource,
  target: number[],
): void => {
  const allocation = mutableResource(resource).allocation;
  if (allocation === undefined) return;
  const inFlight = mutableResource(resource).inFlightUpload;
  const stagedPageKey = inFlight?.phase === "publish-page-table"
    ? undefined
    : inFlight?.assignment.pageKey;
  for (const record of allocation.pageTable.residentPages()) {
    if (record.pageKey === stagedPageKey) continue;
    while (target.length <= record.page.mip) target.push(0);
    target[record.page.mip] = target[record.page.mip]! + 1;
  }
};

export const virtualTextureGpuArenaSnapshot = (
  arena: VirtualTextureGpuArena,
): VirtualTextureGpuArenaSnapshot => {
  const state = stateOf(arena);
  let allocatedResources = 0;
  let pendingUploads = 0;
  for (const resource of state.resources.values()) {
    if (resource.allocation !== undefined) allocatedResources += 1;
    pendingUploads += resource.pendingUploads.length - resource.pendingHead;
  }
  return {
    allocatedBytes: state.allocatedBytes,
    allocatedResources,
    budgetBytes: state.budgetBytes,
    chargedBytes: state.allocatedBytes + state.quarantinedBytes,
    pendingUploads,
    resources: state.resources.size,
    schedulerSlots: state.resourceOrder.length,
    quarantinedBytes: state.quarantinedBytes,
  };
};

const releaseVirtualTextureAllocation = (
  state: State,
  resource: MutableResource,
): VirtualTextureGpuReleaseResult => {
  for (let index = resource.pendingHead; index < resource.pendingUploads.length; index += 1) {
    const upload = resource.pendingUploads[index];
    if (upload !== undefined) publish(state, resource, "discarded", upload);
  }
  resource.pendingUploads.length = 0;
  resource.pendingHead = 0;
  delete resource.inFlightUpload;
  resource.visibleAssignments.clear();
  const allocation = resource.allocation;
  delete resource.allocation;
  if (allocation === undefined) return { releaseError: undefined, releaseErrorPresent: false };
  const release = releaseAllocationHandles(state, allocation);
  state.allocatedBytes -= allocation.allocatedBytes;
  if (release.present) state.quarantinedBytes += allocation.allocatedBytes;
  return { releaseError: release.error, releaseErrorPresent: release.present };
};

/** Releases only the physical allocation, retaining resource identity and desired-page state. */
export const releaseVirtualTextureGpuAllocation = (
  arena: VirtualTextureGpuArena,
  key: string,
): VirtualTextureGpuReleaseResult => {
  const state = stateOf(arena);
  const resource = state.resources.get(key);
  return resource === undefined
    ? { releaseError: undefined, releaseErrorPresent: false }
    : releaseVirtualTextureAllocation(state, resource);
};

export const releaseVirtualTextureGpuResource = (
  arena: VirtualTextureGpuArena,
  key: string,
): VirtualTextureGpuReleaseResult => {
  const state = stateOf(arena);
  const resource = state.resources.get(key);
  if (resource === undefined) return { releaseError: undefined, releaseErrorPresent: false };
  state.resources.delete(key);
  removeResourceOrder(state, resource);
  return releaseVirtualTextureAllocation(state, resource);
};

/** Drops context-generation state without deleting GL handles or surrendering queued payloads. */
export const dropVirtualTextureGpuContext = (arena: VirtualTextureGpuArena): void => {
  const state = stateOf(arena);
  for (const resource of state.resources.values()) {
    delete resource.allocation;
    delete resource.inFlightUpload;
    resource.visibleAssignments.clear();
  }
  state.allocatedBytes = 0;
  state.atlasUploadBytesThisFrame = 0;
  state.quarantinedBytes = 0;
  state.uploadFrame = -1;
  state.uploadsThisFrame = 0;
  state.resourceCursor = 0;
  state.wakeRequested = false;
};
