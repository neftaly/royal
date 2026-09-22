import { TextureAnisotropy } from "../texture/anisotropy";
import { IdleAstcEncoder } from "./astc/encoder";
import { IdleAstcStorage } from "./astc/storage";
import { COMPRESSED_SLOT_BASE } from "./residency";
import { ktx2Etc2StorageBytes } from "../texture/etc2-storage";
import { allocateVirtualTexturePoolBytes } from "./pool-budget";
import { AUTOMATIC_VT_PAGE_SIZE, AUTOMATIC_VT_BORDER_TEXELS, texturePreviewReady } from "./automatic-policy";
import type { SurfaceFrameView } from "../frame/surface-frame";
import { IDENTITY_TEXTURE_COORDINATES } from "../surface/texture-coordinates";
import {
  canonicalTextureSampler,
  type CanonicalTextureSampler,
} from "../texture/sampler";
import type { CanonicalSurfaceScene } from "../surface/scene-lowering";
import { nativeTextureAvailable } from "../texture/native-storage";
import { virtualTexturePageBytes } from "./layout";
import {
  type DecodedVirtualTexturePage,
  type VirtualTexturePageSource,
} from "./page-source";
import {
  automaticVirtualTextureEligible,
  automaticVirtualTextureHasPreview,
  createAutomaticPreviewPageSource,
  createAutomaticRasterPageSource,
} from "./automatic-page-source";
import {
  collectVirtualTextureDemand,
  virtualTextureDemandLod,
  createVirtualTextureDemandWorkspace,
  resetVirtualTextureDemand,
  truncateVirtualTextureDemand,
  type VirtualTextureDemandSurface,
  type VirtualTextureDemandWorkspace,
} from "./demand";
import {
  virtualTexturePageKeyParts,
  type VirtualTextureLayout,
  type VirtualTexturePageId,
} from "./layout";
import {
  selectVirtualTexturePoolSlot,
  addVirtualTexturePageTablePage,
  writeVirtualTexturePageTable,
  type VirtualTexturePageKey,
  type VirtualTexturePoolSlot,
} from "./residency";
import type {
  VirtualTextureGpuBinding,
  VirtualTextureRuntime,
  VirtualTextureFrameUpdate,
  VirtualTextureRuntimeSnapshot,
} from "./runtime-contract";
import {
  automaticVirtualTextureAssetKey,
} from "./runtime-contract";
import { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS } from "./shader-source";
import { copyVirtualTextureAtlasSlots } from "./atlas-copy";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import { type AsyncPreparationScheduler } from "../resource/async-preparation-owner";
import {
  decodedTextureKey,
  type DecodedTextureSource,
  type DecodedTextureLease,
  type TextureSourceRef,
} from "../texture/source";
import { FrameUploadBudgetOwner } from "../resource/frame-upload-budget";
import {
  planVirtualTextureAtlasStorage,
  type VirtualTextureAtlasStoragePlan,
  virtualTextureResidentPageCapacity,
} from "./storage-plan";

const automaticSourceBytes = (source: DecodedTextureSource): number => (source.kind === undefined
  ? source.width * source.height * 4 : ktx2Etc2StorageBytes(source)) + (source.preview?.retainedBytes ?? 0);

const MAX_DECODE_JOBS = 4;
const MAX_PENDING_PAGE_BYTES = 16 * 1024 * 1024;
const MAX_UPLOADS_PER_FRAME = 4;
const MAX_AUTOMATIC_PAGE_JOBS = 8;
const MAX_AUTOMATIC_UPLOADS_PER_FRAME = 8;
const MAX_AUTOMATIC_UPLOAD_MS = 2;
// Already-resident GPU copies need no decoding. Bound their bytes separately so
// atlas growth does not spend one presentation per four small pages before
// zoomed-in detail can even start loading. The shared upload budget still applies.
const MAX_ATLAS_COPY_BYTES_PER_FRAME = 1024 * 1024;
const MAX_ATLAS_COPIES_PER_FRAME = 64;
const MAX_DEMAND_PAGES = 512;
const MAX_AUTOMATIC_DECODED_BYTES = 64 * 1024 * 1024;
const UNCHANGED_ATLAS = { copied: 0, pending: false, changed: false };
const FRAME_RESULTS = [
  { pending: false, webGlStateChanged: false },
  { pending: true, webGlStateChanged: false },
  { pending: false, webGlStateChanged: true },
  { pending: true, webGlStateChanged: true },
];
const prepareDirectly: AsyncPreparationScheduler = (_signal, prepare) => prepare();

type ReadyPage = Readonly<{
  readyAt: number;
  page: VirtualTexturePageId;
  byteLength: number;
  decoded: DecodedVirtualTexturePage;
  pageKey: VirtualTexturePageKey;
}>;

type GpuVirtualTextureAtlas = VirtualTextureAtlasStoragePlan & {
  copyFramebuffer?: WebGLFramebuffer;
  validationPending?: boolean;
  validationFence?: WebGLSync;
  validationWaitFrames?: number;
  growth?: { replacement: GpuVirtualTextureAtlas; nextSlot: number; retainedSlots?: number[]; capacityLimited?: boolean; targetSlots: number };
  blockedGrowth?: string;
  atlasTexture: WebGLTexture;
  budgetIdentity: object;
  key: string;
  lastUsedFrames: Uint32Array;
  referenceCount: number;
  slots: (VirtualTexturePoolSlot | undefined)[];
};

type GpuVirtualTexture = {
  binding: VirtualTextureGpuBinding;
  atlas: GpuVirtualTextureAtlas;
  atlasSampler: WebGLSampler;
  budgetIdentity: object;
  maxResidentPages: number;
  pageTableDirty: boolean;
  pageTableRebuild: boolean;
  pageTableAdditions: VirtualTexturePageId[];
  pageTableBytes: Uint8Array;
  pageTableLevels: readonly Uint8Array[];
  pageTableSampler: WebGLSampler;
  pageTableTexture: WebGLTexture;
  residentSlots: Map<VirtualTexturePageKey, number>;
  astc?: IdleAstcStorage;
  compressedPages: number;
};

type RuntimeResource = {
  readonly abort: AbortController;
  readonly asset: TextureSourceRef;
  demandRevision: number;
  demandNeedsFit?: boolean;
  allocationBudgetBlocked?: boolean;
  admittedPageLimit?: number;
  desiredPageCount?: number;
  readonly failedPages: Set<VirtualTexturePageKey>;
  gpu: GpuVirtualTexture | undefined;
  readonly key: string;
  readonly loadingPages: Map<VirtualTexturePageKey, AbortController>;
  readonly lease?: DecodedTextureLease;
  layout?: VirtualTextureLayout;
  sourceFailure?: string;
  readonly readyPageKeys: Set<VirtualTexturePageKey>;
  readonly readyPages: ReadyPage[];
  compressionDisabled?: boolean;
  compressionBlockedBytes?: number;
  previewSourcePending?: boolean;
  previewSourceFailed?: boolean;
  readonly sampler: CanonicalTextureSampler;
  source?: VirtualTexturePageSource;
  readonly surfaces: VirtualTextureDemandSurface[];
  readonly workspace: VirtualTextureDemandWorkspace;
};

export type AutomaticVirtualTextureRuntimeOptions = Readonly<{
  acquireDecoded(asset: TextureSourceRef): DecodedTextureLease | undefined;
  /** Undefined while pending; null after terminal decode failure. */
  decoded(asset: TextureSourceRef): DecodedTextureSource | null | undefined;
  onChanged(presentationChanged: boolean): void;
}>;

const wrapCode = (value: string | undefined): number => {
  switch (value) {
    case "repeat": return 1;
    case "mirrored-repeat": return 2;
    default: return 0;
  }
};

const allocateTexture = (gl: WebGL2RenderingContext, label: string): WebGLTexture => {
  const texture = gl.createTexture();
  if (texture === null) throw new Error(`Royal could not allocate VT ${label}`);
  return texture;
};

const allocateSampler = (gl: WebGL2RenderingContext, label: string): WebGLSampler => {
  const sampler = gl.createSampler();
  if (sampler === null) throw new Error(`Royal could not allocate VT ${label}`);
  return sampler;
};

const virtualTextureAtlasKey = ({ asset, gpu }: RuntimeResource, layout: VirtualTextureLayout): string => gpu?.atlas.key ?? JSON.stringify([
  layout.pageSize + layout.borderTexels * 2,
  asset.colorSpace ?? layout.colorSpace,
]);

const createGpuVirtualTextureAtlas = (
  gl: WebGL2RenderingContext,
  asset: Pick<TextureSourceRef, "colorSpace">,
  layout: VirtualTextureLayout,
  budget: PersistentGpuBudgetOwner,
  key: string,
  plan: VirtualTextureAtlasStoragePlan,
  deferValidation = false,
): GpuVirtualTextureAtlas => {
  const budgetIdentity = {};
  let atlasTexture: WebGLTexture | null = null;
  try {
    atlasTexture = allocateTexture(gl, "atlas texture");
    if (!budget.tryClaim(budgetIdentity, plan.allocationBytes)) {
      throw new Error("Royal persistent GPU budget denied virtual texture storage");
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    const colorSpace = asset.colorSpace ?? layout.colorSpace;
    gl.texStorage2D(
      gl.TEXTURE_2D,
      1,
      colorSpace === "srgb" ? gl.SRGB8_ALPHA8 : gl.RGBA8,
      plan.atlasColumns * plan.storedPageSize,
      plan.atlasRows * plan.storedPageSize,
    );
    if (deferValidation) {
      gl.flush();
    } else if (gl.getError() !== gl.NO_ERROR) throw new Error("Royal VT atlas allocation failed");
    return {
      ...plan,
      ...(deferValidation ? { validationPending: true } : {}),
      atlasTexture,
      budgetIdentity,
      key,
      lastUsedFrames: new Uint32Array(plan.slotCount),
      referenceCount: 0,
      slots: Array<VirtualTexturePoolSlot | undefined>(plan.slotCount),
    };
  } catch (error) {
    if (atlasTexture !== null) gl.deleteTexture(atlasTexture);
    budget.release(budgetIdentity);
    throw error;
  }
};

const createGpuVirtualTexture = (
  gl: WebGL2RenderingContext,
  asset: Pick<TextureSourceRef, "colorSpace" | "sampler">,
  layout: VirtualTextureLayout,
  budget: PersistentGpuBudgetOwner,
  atlas: GpuVirtualTextureAtlas,
  maxTextureSize: number,
): GpuVirtualTexture => {
  const maxResidentPages = virtualTextureResidentPageCapacity(
    layout,
    maxTextureSize,
    atlas,
  );
  const budgetIdentity = {};
  let budgetClaimed = false;
  let atlasSampler: WebGLSampler | null = null;
  let pageTableTexture: WebGLTexture | null = null;
  let pageTableSampler: WebGLSampler | null = null;
  try {
    atlasSampler = allocateSampler(gl, "atlas sampler");
    pageTableTexture = allocateTexture(gl, "page-table texture");
    pageTableSampler = allocateSampler(gl, "page-table sampler");
    if (!budget.tryClaim(budgetIdentity, layout.tableByteLength)) {
      throw new Error("Royal persistent GPU budget denied virtual texture page-table storage");
    }
    budgetClaimed = true;
    gl.samplerParameteri(
      atlasSampler,
      gl.TEXTURE_MAG_FILTER,
      asset.sampler?.magFilter === "nearest" ? gl.NEAREST : gl.LINEAR,
    );
    gl.samplerParameteri(
      atlasSampler,
      gl.TEXTURE_MIN_FILTER,
      asset.sampler?.minFilter?.startsWith("nearest") === true ? gl.NEAREST : gl.LINEAR,
    );
    gl.samplerParameteri(atlasSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(atlasSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const pageTableBytes = new Uint8Array(layout.tableByteLength);
    const pageTableLevels: Uint8Array[] = [];
    for (let mip = 0; mip < layout.mipCount; mip += 1) {
      const offset = layout.mipLayouts[mip]!.byteOffset;
      const width = Math.max(1, layout.tableWidth / 2 ** mip);
      const height = Math.max(1, layout.tableHeight / 2 ** mip);
      pageTableLevels.push(pageTableBytes.subarray(offset, offset + width * height * 4));
    }
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, pageTableTexture);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      layout.mipCount,
      gl.RGBA8,
      layout.tableWidth,
      layout.tableHeight,
    );
    gl.samplerParameteri(pageTableSampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(pageTableSampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(pageTableSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(pageTableSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return {
      atlas,
      atlasSampler,
      budgetIdentity,
      binding: {
        atlas: { sampler: atlasSampler, target: "2d", texture: atlas.atlasTexture },
        pageTable: { sampler: pageTableSampler, target: "2d", texture: pageTableTexture },
        settings0: new Float32Array([
          layout.width,
          layout.height,
          layout.pageSize,
          layout.borderTexels,
        ]),
        settings1: new Float32Array([
          atlas.atlasColumns * atlas.storedPageSize,
          atlas.atlasRows * atlas.storedPageSize,
          (asset.sampler?.minFilter ?? "linear-mipmap-linear").endsWith("mipmap-linear") ? 1 : 0,
          0,
        ]),
        settings2: new Float32Array([
          layout.mipCount,
          wrapCode(asset.sampler?.wrapS),
          wrapCode(asset.sampler?.wrapT),
          atlas.storedPageSize,
        ]),
      },
      maxResidentPages,
      pageTableDirty: false,
      pageTableRebuild: true,
      pageTableAdditions: [],
      pageTableBytes,
      pageTableLevels,
      pageTableSampler,
      pageTableTexture,
      residentSlots: new Map(),
      compressedPages: 0,
    };
  } catch (error) {
    if (atlasSampler !== null) gl.deleteSampler(atlasSampler);
    if (pageTableSampler !== null) gl.deleteSampler(pageTableSampler);
    if (pageTableTexture !== null) gl.deleteTexture(pageTableTexture);
    if (budgetClaimed) budget.release(budgetIdentity);
    throw error;
  }
};

const destroyGpuVirtualTexture = (
  gl: WebGL2RenderingContext,
  gpu: GpuVirtualTexture,
  budget: PersistentGpuBudgetOwner,
): void => {
  gl.deleteSampler(gpu.atlasSampler);
  gl.deleteSampler(gpu.pageTableSampler);
  gl.deleteTexture(gpu.pageTableTexture);
  budget.release(gpu.budgetIdentity);
};

const destroyGpuVirtualTextureAtlas = (
  gl: WebGL2RenderingContext,
  atlas: GpuVirtualTextureAtlas,
  budget: PersistentGpuBudgetOwner,
): void => {
  if (atlas.growth !== undefined) destroyGpuVirtualTextureAtlas(gl, atlas.growth.replacement, budget);
  if (atlas.validationFence !== undefined) gl.deleteSync(atlas.validationFence);
  if (atlas.copyFramebuffer !== undefined) gl.deleteFramebuffer(atlas.copyFramebuffer);
  gl.deleteTexture(atlas.atlasTexture);
  budget.release(atlas.budgetIdentity);
};

class BrowserVirtualTextureRuntime implements VirtualTextureRuntime {
  #activeJobs = 0;
  #automaticCandidates = 0;
  #pendingPageBytes = 0;
  #detailJobs = 0;
  #automaticIneligible = 0;
  #automaticWaiting = 0;
  #bindingRevision = 0;
  #disposed = false;
  #frame = 0;
  #pageRequests = 0;
  #readyPages = 0;
  #scheduleCursor = 0;
  readonly #scheduleResources: RuntimeResource[] = [];
  #uploadedPages = 0;
  readonly #pageTiming = { queueMs: 0, readMs: 0, readyWaitMs: 0, reads: 0, uploads: 0, growthFrames: 0 };
  #idleTimer: ReturnType<typeof setTimeout> | undefined;
  #idleEncoder: IdleAstcEncoder | undefined;
  #idleSupported: boolean | undefined;
  #lastForeground = 0;
  #compressionFailure: string | undefined;
  #compressionGeneration = 0;
  readonly #pagePixels = new Map<string, { resource: RuntimeResource; pageKey: VirtualTexturePageKey; decoded: DecodedVirtualTexturePage }>();
  #pixelCacheHits = 0;
  #idleSourceReads = 0;
  #compressionJob: { resource: RuntimeResource; gpu: GpuVirtualTexture; key: VirtualTexturePageKey; slot: number; abort: AbortController; blocks?: Uint8Array; fence?: WebGLSync; compressedSlot?: number; waits: number } | undefined;
  #viewCount = 0;
  #viewRevision = 0;
  #viewState = new Float64Array(0);
  readonly #gl: WebGL2RenderingContext;
  #maxTextureSize: number | undefined;
  readonly #atlases = new Map<string, GpuVirtualTextureAtlas>();
  readonly #atlasDemand = new Map<string, number>();
  readonly #atlasDemandBytes = new Map<string, number>();
  #atlasShares = new Map<string, number>();
  readonly #atlasMinimumSlots = new Map<string, number>();
  #atlasGrowthFailures = 0;
  #lastAtlasGrowthFailure: string | undefined;
  readonly #anisotropy: TextureAnisotropy;
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #automatic: AutomaticVirtualTextureRuntimeOptions;
  readonly #schedule: AsyncPreparationScheduler;
  readonly #scheduleDetail: AsyncPreparationScheduler;
  readonly #uploadBudget: FrameUploadBudgetOwner;
  readonly #resources = new Map<string, RuntimeResource>();
  readonly #seenDecoded = new WeakMap<DecodedTextureSource, number>();
  #decodedScan = 0;
  readonly #protectedPoolPages = {
    has: (resourceKey: string, pageKey: VirtualTexturePageKey): boolean =>
      this.#resources.get(resourceKey)?.workspace.keys.has(pageKey) === true,
  };
  #scene: CanonicalSurfaceScene | null = null;
  #sceneNeedsReconcile = false;
  readonly shaderSource = { declarations: VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS };

  constructor(
    gl: WebGL2RenderingContext,
    budget: PersistentGpuBudgetOwner,
    schedule: AsyncPreparationScheduler,
    automatic: AutomaticVirtualTextureRuntimeOptions,
    uploadBudget: FrameUploadBudgetOwner,
    scheduleDetail: AsyncPreparationScheduler,
    anisotropy: TextureAnisotropy,
  ) {
    this.#anisotropy = anisotropy;
    this.#gl = gl;
    this.#budget = budget;
    this.#schedule = schedule;
    this.#scheduleDetail = scheduleDetail;
    this.#automatic = automatic;
    this.#uploadBudget = uploadBudget;
  }

  get bindingRevision(): number {
    return this.#bindingRevision;
  }

  automaticBinding(asset: TextureSourceRef): VirtualTextureGpuBinding | undefined {
    const resource = this.#resources.get(automaticVirtualTextureAssetKey(asset));
    return resource?.gpu !== undefined && resource.gpu.residentSlots.has(
      virtualTexturePageKeyParts(resource.layout!.mipCount - 1, 0, 0),
    )
      ? resource.gpu.binding
      : undefined;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#stopCompression();
    for (const resource of this.#resources.values()) this.#destroyResource(resource, true);
    this.#resources.clear();
    this.#scheduleResources.length = 0;
    this.#scheduleCursor = 0;
    this.#scene = null;
  }

  invalidate(): void {
    this.#anisotropy.invalidate();
    this.#stopCompression(false);
    this.#maxTextureSize = undefined;
    for (const resource of this.#resources.values()) {
      resource.demandRevision = -1;
      if (resource.gpu !== undefined) {
        resource.gpu.astc?.dispose(false);
        this.#budget.release(resource.gpu.budgetIdentity);
        resource.gpu = undefined;
        this.#bindingRevision += 1;
      }
      this.#clearReadyPages(resource);
    }
    for (const atlas of this.#atlases.values()) {
      this.#budget.release(atlas.budgetIdentity);
      if (atlas.growth !== undefined) this.#budget.release(atlas.growth.replacement.budgetIdentity);
    }
    this.#atlases.clear();
  }

  runtimeSnapshot(): VirtualTextureRuntimeSnapshot {
    const uploads = this.#uploadBudget.snapshot();
    let atlasBytes = 0;
    for (const atlas of this.#atlases.values()) atlasBytes += atlas.allocationBytes + (atlas.growth?.replacement.allocationBytes ?? 0);
    for (const resource of this.#resources.values()) atlasBytes += resource.gpu?.astc?.byteLength ?? 0;
    let automaticDecodedBytes = this.#pagePixels.size * 132 ** 2 * 4;
    for (const resource of this.#resources.values()) automaticDecodedBytes += resource.gpu?.astc?.cpuBytes ?? 0;
    let automaticResources = 0;
    let failedPages = 0;
    let pendingPages = 0;
    let residentPages = 0;
    let desiredPages = 0;
    let unresidentPages = 0;
    let admittedPages = 0;
    let detailWeight = 0, residentDetailWeight = 0;
    const scan = ++this.#decodedScan;
    for (const resource of this.#resources.values()) {
      {
        automaticResources += 1;
        if (resource.lease !== undefined && this.#seenDecoded.get(resource.lease.source) !== scan) {
          this.#seenDecoded.set(resource.lease.source, scan);
          automaticDecodedBytes += automaticSourceBytes(resource.lease.source);
        }
      }
      failedPages += resource.failedPages.size + (resource.previewSourceFailed ? 1 : 0);
      pendingPages += resource.loadingPages.size + resource.readyPages.length
        + (resource.previewSourcePending ? 1 : 0);
      residentPages += resource.gpu?.residentSlots.size ?? 0;
      desiredPages += resource.desiredPageCount ?? 0;
      admittedPages += resource.workspace.count;
      for (const key of resource.workspace.keys) {
        if (typeof key === "number" && key % 256 !== (resource.layout?.mipCount ?? 1) - 1) {
          const weight = resource.workspace.importance.get(key) ?? 0;
          detailWeight += weight;
          if (resource.gpu?.residentSlots.has(key)) residentDetailWeight += weight;
        }
        if (!resource.gpu?.residentSlots.has(key)) unresidentPages += 1;
      }
    }
    return {
      ...(detailWeight === 0 ? {} : { visibleDetailFraction: residentDetailWeight / detailWeight }),
      ...(this.#pixelCacheHits === 0 ? {} : { idleAstcPixelHits: this.#pixelCacheHits }),
      ...(this.#idleSourceReads === 0 ? {} : { idleAstcSourceReads: this.#idleSourceReads }),
      ...(this.#pagePixels.size === 0 ? {} : { retainedPagePixelBytes: this.#pagePixels.size * 132 ** 2 * 4 }),
      ...(this.#idleStorageBytes() === 0 ? {} : { idleAstcBytes: this.#idleStorageBytes() }),
      ...(this.#compressionFailure === undefined ? {} : { idleAstcFailure: this.#compressionFailure }),
      ...(this.#pageRequests === 0 ? {} : { pageQueueMs: this.#pageTiming.queueMs, pageReadMs: this.#pageTiming.readMs, pageReadyWaitMs: this.#pageTiming.readyWaitMs, pageTimedReads: this.#pageTiming.reads, pageTimedUploads: this.#pageTiming.uploads, atlasGrowthFrames: this.#pageTiming.growthFrames }),
      admittedUploadBytes: uploads.admittedBytes,
      atlasBytes,
      atlasPools: this.#atlases.size,
      atlasGrowthFailures: this.#atlasGrowthFailures,
      ...(this.#lastAtlasGrowthFailure === undefined ? {} : { lastAtlasGrowthFailure: this.#lastAtlasGrowthFailure }),
      desiredPages,
      admittedPages,
      unresidentPages,
      automaticCandidates: this.#automaticCandidates,
      automaticDecodedBytes,
      automaticIneligible: this.#automaticIneligible,
      automaticResources,
      automaticWaiting: this.#automaticWaiting,
      deferredUploads: uploads.deferredUploads,
      failedPages,
      pageRequests: this.#pageRequests,
      pendingPages,
      pendingPageBytes: this.#pendingPageBytes,
      pendingPageByteLimit: MAX_PENDING_PAGE_BYTES,
      residentPages,
      uploadedPages: this.#uploadedPages,
      uploadBudgetBytes: uploads.budgetBytes,
    };
  }

  setScene(scene: CanonicalSurfaceScene | null): void {
    if (this.#disposed || (this.#scene === scene && !this.#sceneNeedsReconcile)) return;
    this.#sceneNeedsReconcile = false;
    this.#scene = scene;
    for (const resource of this.#resources.values()) resource.demandRevision = -1;
    const claimed = new Set<string>();
    this.#automaticCandidates = 0;
    this.#automaticIneligible = 0;
    this.#automaticWaiting = 0;
    const candidates = new Map<string, TextureSourceRef>();
    for (const surface of scene?.surfaces ?? []) {
      const asset = surface.material.baseColorAsset;
      if (asset === undefined) continue;
      const key = automaticVirtualTextureAssetKey(asset);
      if (!candidates.has(key)) candidates.set(key, asset);
    }
    this.#automaticCandidates = candidates.size;
    let retainedDecodedBytes = 0;
    const scan = ++this.#decodedScan;
    for (const key of candidates.keys()) {
      const existing = this.#resources.get(key);
      if (existing?.lease !== undefined && this.#seenDecoded.get(existing.lease.source) !== scan) {
        this.#seenDecoded.set(existing.lease.source, scan);
        retainedDecodedBytes += automaticSourceBytes(existing.lease.source);
      }
    }
    for (const [key, asset] of candidates) {
      const existing = this.#resources.get(key);
      if (existing !== undefined) {
        claimed.add(key);
        continue;
      }
      const decoded = this.#automatic.decoded(asset);
      if (decoded == null) {
        if (decoded === undefined) this.#automaticWaiting += 1;
        else this.#automaticIneligible += 1;
        continue;
      }
      const preview = automaticVirtualTextureHasPreview(decoded);
      if (
        !preview && !automaticVirtualTextureEligible(decoded)
      ) {
        this.#automaticIneligible += 1;
        continue;
      }
      const decodedBytes = this.#seenDecoded.get(decoded) === scan ? 0 : automaticSourceBytes(decoded);
      if (retainedDecodedBytes + decodedBytes > MAX_AUTOMATIC_DECODED_BYTES) {
        this.#automaticIneligible += 1;
        continue;
      }
      const sampler = canonicalTextureSampler(asset);
      const lease = this.#automatic.acquireDecoded(asset);
      if (lease === undefined) {
        this.#automaticWaiting += 1;
        continue;
      }
      if (!automaticVirtualTextureHasPreview(lease.source) && !automaticVirtualTextureEligible(lease.source)) {
        lease.release();
        this.#automaticIneligible += 1;
        continue;
      }
      if (this.#seenDecoded.get(lease.source) !== scan) {
        this.#seenDecoded.set(lease.source, scan);
        retainedDecodedBytes += automaticSourceBytes(lease.source);
      }
      const source = automaticVirtualTextureHasPreview(lease.source)
        ? createAutomaticPreviewPageSource(lease.source.preview, sampler, asset.colorSpace ?? "srgb")
        : createAutomaticRasterPageSource(lease.source, sampler, asset.colorSpace ?? "srgb");
      claimed.add(key);
      this.#resources.set(key, {
        abort: new AbortController(),
        asset,
        demandRevision: -1,
        failedPages: new Set(),
        gpu: undefined,
        key,
        lease,
        loadingPages: new Map(),
        layout: source.layout,
        readyPageKeys: new Set(),
        readyPages: [],
        sampler,
        source,
        surfaces: [],
        workspace: createVirtualTextureDemandWorkspace(MAX_DEMAND_PAGES),
      });
    }
    for (const [key, resource] of this.#resources) {
      if (claimed.has(key)) continue;
      this.#destroyResource(resource, true);
      this.#resources.delete(key);
      this.#bindingRevision += 1;
      this.#changed();
    }
    for (const resource of this.#resources.values()) resource.surfaces.length = 0;
    for (const surface of scene?.surfaces ?? []) {
      const asset = surface.material.baseColorAsset;
      const resource = asset === undefined ? undefined : this.#resources.get(automaticVirtualTextureAssetKey(asset));
      if (resource === undefined) continue;
      resource.surfaces.push({
        geometry: surface.geometry,
        ...(surface.instances === undefined ? {} : { instances: surface.instances }),
        model: surface.model,
        textureCoordinates: surface.material.baseColorTextureCoordinates
          ?? IDENTITY_TEXTURE_COORDINATES,
        worldBounds: surface.worldBounds,
      });
    }
    this.#scheduleResources.length = 0;
    for (const resource of this.#resources.values()) {
      if (resource.surfaces.length > 0) this.#scheduleResources.push(resource);
    }
    if (this.#scheduleCursor >= this.#scheduleResources.length) this.#scheduleCursor = 0;
  }

  /** Ordinary storage can regain detail while its previous GPU texture remains visible. */
  releaseRasterSource(asset: TextureSourceRef): void {
    const decodedKey = decodedTextureKey(asset);
    let released = false;
    for (const [key, resource] of this.#resources) {
      if (decodedTextureKey(resource.asset) !== decodedKey) continue;
      this.#destroyResource(resource, true);
      this.#resources.delete(key);
      const index = this.#scheduleResources.indexOf(resource);
      if (index >= 0) this.#scheduleResources.splice(index, 1);
      released = true;
    }
    if (!released) return;
    this.#bindingRevision++;
    this.#sceneNeedsReconcile = true;
    this.#scheduleCursor = 0;
  }

  /** Re-evaluates demand after retained instance matrices move in the same scene. */
  invalidateSceneGeometry(): void {
    for (const resource of this.#resources.values()) resource.demandRevision = -1;
  }

  update(views: readonly SurfaceFrameView[], beginUploadFrame = true): VirtualTextureFrameUpdate {
    if (this.#disposed) return FRAME_RESULTS[0]!;
    if (beginUploadFrame) this.#uploadBudget.beginFrame();
    this.#frame += 1;
    let pending = false;
    let webGlStateChanged = false;
    let uploadsRemaining = MAX_AUTOMATIC_UPLOADS_PER_FRAME;
    let uploadStartedAt: number | undefined;
    if (this.#demandViewsChanged(views)) { this.#viewRevision += 1; this.#lastForeground = performance.now(); }

    this.#atlasDemand.clear();
    this.#atlasDemandBytes.clear();
    this.#atlasMinimumSlots.clear();
    const poolRequests = new Map<string, { key: string; minimumBytes: number; wantedBytes: number }>();
    for (const resource of this.#resources.values()) {
      this.#refreshFrameDemand(resource, views);
      const layout = resource.layout;
      if (layout === undefined || resource.sourceFailure !== undefined) continue;
      const key = virtualTextureAtlasKey(resource, layout);
      const bytesPerPage = virtualTexturePageBytes(layout);
      const compressedDemand = this.#compressedDemand(resource);
      const count = Math.max(0, (resource.desiredPageCount ?? 0) - compressedDemand);
      this.#atlasDemand.set(key, (this.#atlasDemand.get(key) ?? 0) + count);
      this.#atlasDemandBytes.set(key, (this.#atlasDemandBytes.get(key) ?? 0) + count * bytesPerPage);
      this.#atlasMinimumSlots.set(key, (this.#atlasMinimumSlots.get(key) ?? 0) + (count > 0 ? 1 : 0));
      if (count === 0 && !this.#atlases.has(key)) continue;
      if (!poolRequests.has(key)) poolRequests.set(key, { key, minimumBytes: bytesPerPage, wantedBytes: 0 });
    }
    // Foreground allocations must never wait for optional replacement storage
    // held by a paused encoder. The published ASTC atlas remains available.
    if (this.#compressionBusy()) this.#compressionJob?.gpu.astc?.cancelGrowth();
    for (const request of poolRequests.values()) {
      request.wantedBytes ||= 2 ** Math.ceil(Math.log2(Math.max(1, this.#atlasDemand.get(request.key)!))) * request.minimumBytes;
      request.minimumBytes *= Math.max(1, this.#atlasMinimumSlots.get(request.key)!);
    }
    this.#atlasShares = allocateVirtualTexturePoolBytes([...poolRequests.values()],
      Math.max(0, Math.floor(this.#budget.budgetBytes * 0.75) - this.#idleStorageBytes()
        - this.#automaticWaiting * (AUTOMATIC_VT_PAGE_SIZE + AUTOMATIC_VT_BORDER_TEXELS * 2) ** 2 * 4));
    let copyBytesRemaining = MAX_ATLAS_COPY_BYTES_PER_FRAME;
    let copiesRemaining = MAX_ATLAS_COPIES_PER_FRAME;
    for (const atlas of this.#atlases.values()) {
      const pageBytes = atlas.storedPageSize ** 2 * 4;
      const copyLimit = Math.min(copiesRemaining,
        Math.max(copyBytesRemaining === MAX_ATLAS_COPY_BYTES_PER_FRAME ? 1 : 0,
          Math.floor(copyBytesRemaining / pageBytes)));
      const previousGrowth = atlas.growth;
      const growth = this.#resizeAtlas(atlas, copyLimit);
      if (previousGrowth !== atlas.growth) for (const resource of this.#resources.values()) {
        if (resource.gpu?.atlas === atlas) resource.demandRevision = -1;
      }
      if (growth.pending) this.#pageTiming.growthFrames++;
      copyBytesRemaining = Math.max(0, copyBytesRemaining - growth.copied * pageBytes);
      copiesRemaining -= growth.copied;
      pending ||= growth.pending;
      webGlStateChanged ||= growth.changed;
    }

    // Share pool slots so earlier textures cannot protect every slot.
    for (const atlas of this.#atlases.values()) {
      const resources = [];
      let needsFit = false;
      for (const resource of this.#resources.values()) {
        if (resource.layout === undefined || resource.sourceFailure !== undefined
          || virtualTextureAtlasKey(resource, resource.layout) !== atlas.key) continue;
        resources.push(resource);
        needsFit ||= resource.demandNeedsFit || resource.admittedPageLimit === undefined || resource.demandRevision !== this.#viewRevision;
      }
      if (!needsFit) continue;
      const preparationSlots = this.#preparationAtlas(atlas).slotCount;
      const requests = resources.filter((resource) => (resource.desiredPageCount ?? 0) > 0).map((resource) => {
        return { key: resource.key, minimumBytes: 1,
          wantedBytes: Math.max(1, Math.min(resource.desiredPageCount! - this.#compressedDemand(resource), preparationSlots)),
        };
      });
      const shares = allocateVirtualTexturePoolBytes(requests, preparationSlots);
      for (const resource of resources) {
        const limit = Math.max(1, shares.get(resource.key) ?? preparationSlots) + this.#compressedDemand(resource);
        if (resource.admittedPageLimit === limit) continue;
        resource.admittedPageLimit = limit;
        resource.demandRevision = -1;
      }
    }

    // Resolve every resource's current demand before consulting the shared
    // atlas protection set. Admission must never depend on Map insertion order
    // or another resource's previous-frame visibility.
    for (const resource of this.#resources.values()) {
      this.#refreshFrameDemand(resource, views);
      if (this.#prepareFrameDemand(resource)) { webGlStateChanged = true; pending = true; }
      if (resource.workspace.count > 0 && resource.gpu === undefined && resource.sourceFailure === undefined && !resource.allocationBudgetBlocked) pending = true;
    }
    for (const resource of this.#resources.values()) {
      const layout = resource.layout;
      if (
        layout === undefined
        || resource.sourceFailure !== undefined
        || resource.workspace.count === 0
        || resource.gpu === undefined
        || resource.gpu.atlas.growth !== undefined
      ) continue;
      const gpu = resource.gpu;
      let settledPages = 0;
      while (uploadsRemaining > 0 && resource.readyPages.length > 0) {
        if (uploadsRemaining <= MAX_AUTOMATIC_UPLOADS_PER_FRAME - MAX_UPLOADS_PER_FRAME
          && uploadStartedAt !== undefined && performance.now() - uploadStartedAt >= MAX_AUTOMATIC_UPLOAD_MS) {
          uploadsRemaining = 0; pending = true; break;
        }
        const ready = resource.readyPages[0]!;
        const slot = this.#pageSlot(resource, ready.pageKey);
        if ((gpu.residentSlots.has(ready.pageKey)) || slot < 0) {
          // A read can lose its cell before completion. Release its pixels
          // so a full atlas cannot hold the global preparation queue.
          this.#settleReadyPage(resource);
          ready.decoded.close();
          settledPages += 1;
          continue;
        }
        const evicted = gpu.atlas.slots[slot];
        const storedPageSize = layout.pageSize + layout.borderTexels * 2;
        const pageByteLength = storedPageSize * storedPageSize * 4;
        const evictedGpu = evicted === undefined
          ? undefined
          : this.#resources.get(evicted.resourceKey)?.gpu;
        const uploadByteLength = pageByteLength
          + (gpu.pageTableDirty ? 0 : gpu.pageTableBytes.byteLength)
          + (evictedGpu === undefined || evictedGpu === gpu || evictedGpu.pageTableDirty
            ? 0
            : evictedGpu.pageTableBytes.byteLength);
        if (!this.#uploadBudget.tryAdmit(uploadByteLength)) {
          uploadsRemaining = 0;
          pending = true;
          break;
        }
        uploadStartedAt ??= performance.now();
        try {
          this.#uploadReadyPage(resource, ready, slot, evicted);
          this.#pageTiming.readyWaitMs += performance.now() - ready.readyAt;
          this.#pageTiming.uploads++;
        } catch (error) {
          this.#settleReadyPage(resource);
          ready.decoded.close();
          this.#publishDirtyPageTables();
          throw error;
        }
        this.#settleReadyPage(resource);
        if (!this.#retainPagePixels(resource, ready)) ready.decoded.close();
        uploadsRemaining -= 1;
        settledPages += 1;
        webGlStateChanged = true;
      }
      // Uploads are presented by this frame; publish progress without asking
      // the host to redraw the unchanged scene again next frame.
      if (settledPages > 0) this.#changed(false);
      if (resource.readyPages.length > 0 && (uploadsRemaining === 0)) pending = true;
    }
    if (this.#publishDirtyPageTables()) webGlStateChanged = true;
    this.#schedulePageReads();
    if (this.#compressionBusy()) this.#lastForeground = performance.now();
    else if (this.#publishCompression()) webGlStateChanged = true;
    this.#scheduleCompression();
    return FRAME_RESULTS[(pending ? 1 : 0) | (webGlStateChanged ? 2 : 0)]!;
  }

  #retainPagePixels(resource: RuntimeResource, ready: ReadyPage): boolean {
    if (resource.gpu?.atlas.storedPageSize !== 132
      || (resource.asset.colorSpace ?? resource.layout?.colorSpace) !== "srgb"
      || typeof Worker === "undefined" || typeof createImageBitmap === "undefined") return false;
    try { this.#idleSupported ??= nativeTextureAvailable(this.#gl, "astc-6x6", "srgb"); }
    catch (error) {
      this.#compressionFailure = String(error); this.#idleSupported = false;
      this.#clearPagePixels(); return false;
    }
    if (!this.#idleSupported || resource.compressionDisabled || this.#idleEncoder?.failed) return false;
    const key = `${resource.key}:${ready.pageKey}`;
    this.#pagePixels.get(key)?.decoded.close(); this.#pagePixels.delete(key);
    // Transfer ownership of existing pixels: no foreground readback or bitmap copy.
    while (this.#pagePixels.size >= 8) {
      const oldest = this.#pagePixels.entries().next().value!;
      oldest[1].decoded.close(); this.#pagePixels.delete(oldest[0]);
    }
    this.#pagePixels.set(key, { resource, pageKey: ready.pageKey, decoded: ready.decoded });
    return true;
  }

  #clearPagePixels(resource?: RuntimeResource): void {
    for (const [key, pixels] of this.#pagePixels) {
      if (resource !== undefined && pixels.resource !== resource) continue;
      pixels.decoded.close(); this.#pagePixels.delete(key);
    }
  }

  #idleStorageBytes(): number {
    let bytes = 0;
    for (const resource of this.#resources.values()) bytes += resource.gpu?.astc?.byteLength ?? 0;
    return bytes;
  }

  #compressedDemand(resource: RuntimeResource): number {
    if (resource.gpu?.astc === undefined) return 0;
    let count = 0;
    for (const key of resource.workspace.keys) if ((resource.gpu.residentSlots.get(key) ?? -1) >= COMPRESSED_SLOT_BASE) count++;
    return count;
  }

  #atlasHasCompression(atlas: GpuVirtualTextureAtlas): boolean {
    for (const resource of this.#resources.values()) {
      if (resource.gpu?.atlas === atlas && resource.gpu.astc !== undefined) return true;
    }
    return false;
  }

  #compressionBusy(): boolean {
    if (this.#activeJobs > 0 || this.#readyPages > 0 || this.#automaticWaiting > 0) return true;
    for (const atlas of this.#atlases.values()) if (atlas.growth !== undefined) return true;
    for (const resource of this.#resources.values()) {
      if (resource.previewSourcePending) return true;
      if (resource.sourceFailure !== undefined) continue;
      for (const key of resource.workspace.keys) {
        if (!resource.failedPages.has(key) && (!resource.gpu?.residentSlots.has(key))) return true;
      }
    }
    return false;
  }

  #cancelCompression(deleteGpu = true): void {
    const job = this.#compressionJob;
    this.#compressionJob = undefined;
    this.#compressionGeneration++;
    job?.abort.abort();
    this.#idleEncoder?.cancel();
    if (job?.fence !== undefined && deleteGpu) this.#gl.deleteSync(job.fence);
    job?.gpu.astc?.cancelGrowth(deleteGpu);
    if (job?.compressedSlot !== undefined && job.compressedSlot === (job.gpu.astc?.blocks.length ?? 0) - 1) job.gpu.astc!.blocks.pop();
  }

  #stopCompression(deleteGpu = true): void {
    clearTimeout(this.#idleTimer); this.#idleTimer = undefined;
    this.#cancelCompression(deleteGpu);
    this.#clearPagePixels();
    this.#idleEncoder?.dispose(); this.#idleEncoder = undefined;
    this.#idleSupported = undefined;
  }

  #scheduleCompression(): void {
    if (this.#disposed || this.#idleTimer !== undefined || typeof Worker === "undefined" || typeof createImageBitmap === "undefined") return;
    if (this.#idleEncoder?.failed) {
      this.#idleEncoder.dispose(); this.#idleEncoder = undefined; this.#idleSupported = false;
    }
    if (this.#idleSupported === false) { this.#clearPagePixels(); return; }
    this.#idleTimer = setTimeout(() => {
      this.#idleTimer = undefined;
      if (this.#disposed) return;
      if (this.#compressionBusy() || performance.now() - this.#lastForeground < 50) {
        this.#scheduleCompression(); return;
      }
      try {
        this.#idleSupported ??= nativeTextureAvailable(this.#gl, "astc-6x6", "srgb");
        if (!this.#idleSupported) return;
        const job = this.#compressionJob;
        if (job !== undefined) {
          const currentSlot = job.gpu.residentSlots.get(job.key);
          if (job.resource.gpu !== job.gpu || currentSlot === undefined || currentSlot >= COMPRESSED_SLOT_BASE) {
            this.#cancelCompression(); this.#scheduleCompression(); return;
          }
          job.slot = currentSlot;
          if (job.blocks !== undefined) this.#changed();
          else this.#idleEncoder?.grant();
          return;
        }
        let cpuBytes = 0;
        for (const resource of this.#resources.values()) cpuBytes += resource.gpu?.astc?.cpuBytes ?? 0;
        if (cpuBytes + 7744 > 8 * 1024 * 1024) {
          this.#clearPagePixels();
          this.#idleEncoder?.dispose(); this.#idleEncoder = undefined; return;
        }
        // Visible pages first, then cached pages.
        for (const visible of [true, false]) for (const cached of [true, false]) for (const resource of this.#resources.values()) {
          const gpu = resource.gpu, layout = resource.layout;
          if (resource.compressionDisabled || resource.compressionBlockedBytes === this.#budget.availableBytes || gpu === undefined || layout === undefined
            || gpu.atlas.storedPageSize !== 132 || resource.source === undefined
            || (resource.asset.colorSpace ?? layout.colorSpace) !== "srgb"
            || (gpu.astc?.blocks.length ?? 0) >= 512) continue;
          for (const [key, slot] of gpu.residentSlots) {
            if (this.#pagePixels.has(`${resource.key}:${key}`) !== cached || slot >= COMPRESSED_SLOT_BASE || typeof key !== "number" || resource.workspace.keys.has(key) !== visible
            ) continue;
            const abort = new AbortController();
            const generation = this.#compressionGeneration;
            this.#compressionJob = { resource, gpu, key, slot, abort, waits: 0 };
            const page = { mip: key % 256, x: Math.floor(key / 256) % 65536, y: Math.floor(key / 0x1000000) };
            const retained = this.#pagePixels.get(`${resource.key}:${key}`);
            this.#pagePixels.delete(`${resource.key}:${key}`);
            if (retained !== undefined) this.#pixelCacheHits++; else this.#idleSourceReads++;
            void (retained === undefined ? resource.source.read(page, abort.signal) : Promise.resolve(retained.decoded)).then(async decoded => {
              if (decoded === undefined) throw new Error("Idle ASTC source unavailable");
              try {
                if (decoded.kind !== "image") throw new Error("Idle ASTC requires RGBA pixels");
                if (abort.signal.aborted || generation !== this.#compressionGeneration) return;
                const bitmap = await createImageBitmap(decoded.source);
                if (abort.signal.aborted || generation !== this.#compressionGeneration) { bitmap.close(); return; }
                try { this.#idleEncoder ??= new IdleAstcEncoder(() => this.#scheduleCompression()); }
                catch (error) { bitmap.close(); throw error; }
                const blocks = await this.#idleEncoder.start(bitmap, 132);
                if (abort.signal.aborted || generation !== this.#compressionGeneration) return;
                if (blocks === undefined) { this.#cancelCompression(); return; }
                const current = this.#compressionJob;
                if (current?.abort === abort) { current.blocks = blocks; this.#scheduleCompression(); }
              } finally { decoded.close(); }
            }).catch(() => {
              if (generation !== this.#compressionGeneration) return;
              resource.compressionDisabled = true;
              this.#clearPagePixels(resource);
              this.#cancelCompression(); this.#scheduleCompression();
            });
            return;
          }
        }
        this.#clearPagePixels();
        this.#idleEncoder?.dispose(); this.#idleEncoder = undefined;
      } catch {
        this.#clearPagePixels();
        this.#idleSupported = false; this.#cancelCompression();
      }
    }, Math.max(this.#compressionBusy() ? 50 : 4, 50 - (performance.now() - this.#lastForeground)));
  }

  #publishCompression(): boolean {
    const job = this.#compressionJob;
    if (job?.blocks === undefined || performance.now() - this.#lastForeground < 50) return false;
    const { resource, gpu, key, blocks } = job;
    const currentSlot = gpu.residentSlots.get(key);
    if (resource.gpu !== gpu || currentSlot === undefined || currentSlot >= COMPRESSED_SLOT_BASE || gpu.atlas.growth !== undefined) {
      this.#cancelCompression(); return false;
    }
    try {
      gpu.astc ??= new IdleAstcStorage(this.#gl, this.#budget, 132);
      const storage = gpu.astc;
      // Growth can repack existing entries, so reserve their table upload
      // before allowing the replacement texture to become authoritative.
      if (!this.#uploadBudget.tryAdmit(gpu.pageTableBytes.byteLength)) return true;
      const previous = storage.texture;
      if (job.compressedSlot === undefined && !storage.ensureCapacity(bytes => this.#uploadBudget.tryAdmit(bytes), this.#textureSizeLimit(), this.#atlasAllowance(), () => this.#uploadBudget.tryAdmitAllocation())) {
        this.#scheduleCompression(); return true;
      }
      if (storage.texture !== previous) {
        gpu.binding = { ...gpu.binding,
          compressedAtlas: { sampler: gpu.atlasSampler, target: "2d", texture: storage.texture! },
          compressedSettings: new Float32Array([storage.columns * 132, storage.rows * 132, 0, 0]),
        };
        gpu.pageTableDirty = gpu.pageTableRebuild = true;
        this.#bindingRevision++;
        this.#publishDirtyPageTables();
      }
      if (job.compressedSlot === undefined) {
        if (!this.#uploadBudget.tryAdmit(blocks.byteLength + gpu.pageTableBytes.byteLength)) return true;
        job.compressedSlot = storage.append(blocks);
        const fence = this.#gl.fenceSync(this.#gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (fence === null) throw new Error("ASTC publication fence failed");
        job.fence = fence; this.#gl.flush();
        return true;
      }
      if (job.fence !== undefined) {
        const status = this.#gl.clientWaitSync(job.fence, 0, 0);
        if (status === this.#gl.TIMEOUT_EXPIRED && ++job.waits < 120) return true;
        if (status !== this.#gl.ALREADY_SIGNALED && status !== this.#gl.CONDITION_SATISFIED) throw new Error("ASTC publication failed");
        this.#gl.deleteSync(job.fence!); delete job.fence;
        if (this.#gl.getError() !== this.#gl.NO_ERROR) throw new Error("ASTC upload validation failed");
      }
      if (!this.#uploadBudget.tryAdmit(gpu.pageTableBytes.byteLength)) return true;
      gpu.residentSlots.set(key, COMPRESSED_SLOT_BASE + job.compressedSlot);
      gpu.compressedPages++;
      gpu.atlas.slots[currentSlot] = undefined;
      gpu.pageTableDirty = gpu.pageTableRebuild = true;
      resource.demandRevision = -1;
      this.#publishDirtyPageTables();
      this.#compressionJob = undefined;
      this.#changed();
      this.#scheduleCompression();
      return true;
    } catch (error) {
      this.#compressionFailure = String(error);
      const denied = String(error).includes("denied");
      if (!denied) resource.compressionDisabled = true;
      this.#cancelCompression();
      if (gpu.astc !== undefined && !Array.from(gpu.residentSlots.values()).some(value => value >= COMPRESSED_SLOT_BASE)) {
        gpu.astc.dispose(); delete gpu.astc;
        gpu.binding = { ...gpu.binding, compressedAtlas: gpu.binding.atlas };
        this.#bindingRevision++;
      }
      if (denied) resource.compressionBlockedBytes = this.#budget.availableBytes;
      return true;
    }
  }

  #refreshFrameDemand(
    resource: RuntimeResource,
    views: readonly SurfaceFrameView[],
  ): void {
    const layout = resource.layout;
    if (layout === undefined || resource.sourceFailure !== undefined) return;
    const source = resource.lease?.source;
    if (source?.kind !== undefined && source.preview?.error !== undefined) {
      resource.sourceFailure = source.preview.error;
      resource.previewSourceFailed = true;
      resource.desiredPageCount = 0;
      resetVirtualTextureDemand(resource.workspace);
      return;
    }
    const demandChanged = resource.demandRevision !== this.#viewRevision;
    if (demandChanged) {
      for (let minimumMip = 0; minimumMip < layout.mipCount; minimumMip += 1) {
        resetVirtualTextureDemand(resource.workspace);
        collectVirtualTextureDemand(
          resource.workspace,
          layout,
          resource.surfaces,
          views,
          resource.sampler,
          minimumMip,
          this.#anisotropy.forSampler(resource.sampler),
        );
        if (!resource.workspace.overflow) break;
      }
      resource.demandRevision = this.#viewRevision;
      resource.desiredPageCount = resource.workspace.count;
      resource.demandNeedsFit = true;
      this.#cancelStalePageReads(resource);
    }
    if (resource.workspace.count > 0 && resource.failedPages.size >= resource.workspace.count
      && (resource.gpu?.residentSlots.size ?? 0) === 0) {
      let allFailed = true;
      for (const key of resource.workspace.keys) if (!resource.failedPages.has(key)) { allFailed = false; break; }
      if (allFailed) {
        resetVirtualTextureDemand(resource.workspace);
        resource.desiredPageCount = 0;
        resource.demandNeedsFit = true;
      }
    }
  }

  #prepareFrameDemand(
    resource: RuntimeResource,
  ): boolean {
    const layout = resource.layout;
    if (layout === undefined) return false;
    if (resource.sourceFailure !== undefined) {
      if (resource.gpu === undefined) return false;
      this.#releaseGpuResource(resource);
      return true;
    }
    const demandChanged = resource.demandNeedsFit === true;
    // Do not reserve an atlas before the asset contributes to a view.
    if (resource.workspace.count === 0) {
      if (demandChanged) {
        resource.demandNeedsFit = false;
        this.#clearReadyPages(resource);
      }
      if (resource.failedPages.size > 0 && resource.gpu?.residentSlots.size === 0) {
        this.#releaseGpuResource(resource);
        return true;
      }
      return false;
    }
    if (this.#nativePreviewSufficient(resource)) return false;
    let gpuCreated = false;
    if (resource.gpu === undefined) {
      const atlas = this.#atlases.get(virtualTextureAtlasKey(resource, layout));
      const pageBytes = virtualTexturePageBytes(layout);
      resource.allocationBudgetBlocked = this.#budget.availableBytes < layout.tableByteLength + (atlas === undefined ? pageBytes : 0)
        || (atlas === undefined && this.#atlasAllowance(undefined, virtualTextureAtlasKey(resource, layout)) < pageBytes);
      if (resource.allocationBudgetBlocked) return false;
      if (!this.#uploadBudget.tryAdmitAllocation()) {
        resource.demandRevision = -1;
        return false;
      }
      try {
        resource.gpu = this.#createGpuResource(resource, layout);
        gpuCreated = true;
      } catch (error) {
        resource.sourceFailure = error instanceof Error ? error.message : String(error);
        this.#changed();
        // Allocation may have borrowed texture units before rolling back.
        return true;
      }
    }
    const gpu = resource.gpu;
    if (demandChanged) {
      resource.demandNeedsFit = false;
      const preparationAtlas = this.#preparationAtlas(gpu.atlas);
      const capacity = preparationAtlas === gpu.atlas ? gpu.maxResidentPages
        : virtualTextureResidentPageCapacity(layout, this.#textureSizeLimit(), preparationAtlas);
      truncateVirtualTextureDemand(resource.workspace, Math.min(capacity + this.#compressedDemand(resource), resource.admittedPageLimit ?? Infinity));
      const workspace = resource.workspace;
      for (let index = 0; index < workspace.count; index++) workspace.order[index] = index;
      {
        const score = (index: number): number => {
          const mip = workspace.mips[index]!, x = workspace.xs[index]!, y = workspace.ys[index]!;
          const key = virtualTexturePageKeyParts(mip, x, y);
          let parent = mip;
          for (; parent < layout.mipCount - 1; parent++) {
            const divisor = 2 ** (parent - mip);
            if (gpu.residentSlots.has(virtualTexturePageKeyParts(parent, Math.floor(x / divisor), Math.floor(y / divisor)))) break;
          }
          return (workspace.importance.get(key) ?? 0) * (1 + Math.min(4, parent - mip));
        };
        for (let index = 0; index < workspace.count; index++) workspace.scores[index] = score(index);
        workspace.order.subarray(0, workspace.count).sort((a, b) => workspace.scores[b]! - workspace.scores[a]! || a - b);
      }
      this.#cancelStalePageReads(resource);
      let retainedReadyPages = 0;
      for (let index = 0; index < resource.readyPages.length; index += 1) {
        const ready = resource.readyPages[index]!;
        if (!resource.workspace.keys.has(ready.pageKey)) {
          ready.decoded.close();
          resource.readyPageKeys.delete(ready.pageKey);
          this.#readyPages -= 1;
          this.#pendingPageBytes -= ready.byteLength;
          continue;
        }
        resource.readyPages[retainedReadyPages] = ready;
        retainedReadyPages += 1;
      }
      resource.readyPages.length = retainedReadyPages;
    }
    for (let index = 0; index < resource.workspace.count; index += 1) {
      const key = virtualTexturePageKeyParts(
        resource.workspace.mips[index]!,
        resource.workspace.xs[index]!,
        resource.workspace.ys[index]!,
      );
      const slot = gpu.residentSlots.get(key);
      if (slot !== undefined && slot < COMPRESSED_SLOT_BASE) gpu.atlas.lastUsedFrames[slot] = this.#frame;
    }
    return gpuCreated;
  }

  #destroyResource(resource: RuntimeResource, deleteGpu: boolean): void {
    this.#clearPagePixels(resource);
    if (this.#compressionJob?.resource === resource) this.#cancelCompression();
    resource.abort.abort();
    for (const controller of resource.loadingPages.values()) controller.abort();
    resource.loadingPages.clear();
    this.#clearReadyPages(resource);
    if (deleteGpu && resource.gpu !== undefined) {
      this.#releaseGpuResource(resource);
    }
    resource.source?.close?.();
    resource.lease?.release();
  }

  #targetAtlasSlots(key: string): number {
    const count = this.#atlasDemand.get(key) ?? 0;
    const pageBytes = count > 0 ? this.#atlasDemandBytes.get(key)! / count
      : (this.#atlases.get(key)?.storedPageSize ?? NaN) ** 2 * 4;
    const share = this.#atlasShares.get(key);
    return Math.min(2 ** Math.ceil(Math.log2(Math.max(1, count))),
      share === undefined || !Number.isFinite(pageBytes) ? Infinity : Math.floor(share / pageBytes));
  }

  #atlasAllowance(except?: GpuVirtualTextureAtlas, key = except?.key): number {
    let otherBytes = 0;
    for (const resource of this.#resources.values()) otherBytes += resource.gpu?.astc?.byteLength ?? 0;
    for (const atlas of this.#atlases.values()) {
      if (atlas !== except) {
        // A shrink can still be cancelled. Its old capacity cannot be lent to
        // another pool until the replacement has actually committed.
        otherBytes += Math.max(atlas.allocationBytes, atlas.growth?.replacement.allocationBytes ?? 0);
      }
    }
    return Math.min(key === undefined ? Infinity : this.#atlasShares.get(key) ?? Infinity,
      Math.max(0, Math.floor(this.#budget.budgetBytes * 0.75) - otherBytes));
  }

  #resizeAtlas(atlas: GpuVirtualTextureAtlas, copyLimit: number) {
    const demand = this.#atlasDemand.get(atlas.key) ?? 0;
    let missingBytes = 0, replacementBytes = 0;
    for (const [key, count] of this.#atlasDemand) {
      const other = this.#atlases.get(key);
      if (key === atlas.key || count <= (other?.slotCount ?? 0)) continue;
      const wantedBytes = this.#atlasDemandBytes.get(key)!;
      missingBytes += Math.max(0, wantedBytes - (other?.allocationBytes ?? 0));
      replacementBytes = Math.max(replacementBytes, wantedBytes);
    }
    const competingPressure = missingBytes > this.#atlasAllowance()
      || replacementBytes > this.#budget.availableBytes;
    const preserveCached = this.#atlasHasCompression(atlas) && !competingPressure;
    const liveSlots = preserveCached ? atlas.slots.reduce((sum, entry) => sum + (entry === undefined ? 0 : 1), 0) : 0;
    let workingPages = 0;
    if (preserveCached) for (const resource of this.#resources.values()) {
      if (resource.gpu?.atlas === atlas) workingPages += resource.desiredPageCount ?? 0;
    }
    // Keep up to one upload batch, scaled to a quarter of current working demand.
    // This is pool capacity, not an expiry timer, and competing pressure wins.
    const warmSlots = preserveCached ? Math.min(atlas.slotCount, MAX_AUTOMATIC_UPLOADS_PER_FRAME,
      2 ** Math.floor(Math.log2(Math.max(1, workingPages / 4)))) : 0;
    const targetSlots = Math.max(this.#targetAtlasSlots(atlas.key), warmSlots,
      preserveCached ? 2 ** Math.ceil(Math.log2(Math.max(1, liveSlots))) : 0);
    let capacityLimited = demand > targetSlots && targetSlots < atlas.slotCount;
    const shareLimited = targetSlots < Math.min(atlas.slotCount,
      2 ** Math.ceil(Math.log2(Math.max(1, demand))));
    let shrinking = capacityLimited || shareLimited || targetSlots <= atlas.slotCount / 2;
    if (atlas.growth === undefined && !shrinking && targetSlots <= atlas.slotCount) return UNCHANGED_ATLAS;
    let copied = 0, changed = false;
    const result = (pending: boolean) => ({ copied, pending, changed });
    const compressionSavings = preserveCached && targetSlots <= atlas.slotCount / 2;
    const pressure = compressionSavings || competingPressure;
    // A compaction of existing storage may retain more cache than the current
    // demand-only share. It never grows that allocation or lends its old bytes.
    const allowance = preserveCached && shrinking
      ? Math.max(this.#atlasAllowance(atlas), Math.min(atlas.allocationBytes, targetSlots * atlas.storedPageSize ** 2 * 4))
      : this.#atlasAllowance(atlas);
    if (atlas.growth !== undefined && (
      atlas.growth.retainedSlots === undefined ? targetSlots <= atlas.slotCount
        : (!atlas.growth.capacityLimited && !pressure && !shareLimited)
          || (atlas.growth.capacityLimited ? targetSlots > atlas.growth.targetSlots : demand > atlas.growth.replacement.slotCount)
          || atlas.growth.retainedSlots.some((slot) => atlas.slots[slot] === undefined)
    )) {
      destroyGpuVirtualTextureAtlas(this.#gl, atlas.growth.replacement, this.#budget);
      delete atlas.growth;
      changed = true;
      return result(shrinking);
    }
    const fingerprint = `${demand}:${this.#budget.availableBytes}:${this.#atlasAllowance(atlas)}:${this.#uploadedPages}`;
    if (atlas.growth === undefined) {
      if (atlas.blockedGrowth === fingerprint) return result(false);
      // Low demand alone is not a reason to discard reusable resident pages.
      // Compact only to make room for competing demand or a reduced pool share.
      if (shrinking && !pressure && !capacityLimited && !shareLimited) return result(false);
      const resource = Array.from(this.#resources.values()).find((value) => value.gpu?.atlas === atlas);
      if (resource === undefined) return result(false);
      let plan: VirtualTextureAtlasStoragePlan;
      try {
        // The old atlas remains fully charged until migration commits. The
        // replacement must fit real unclaimed budget as well as final allowance.
        const maxTextureSize = this.#textureSizeLimit();
        plan = planVirtualTextureAtlasStorage(resource.layout!, maxTextureSize,
          this.#budget.availableBytes, targetSlots, allowance, "migration");
        if (!shrinking && plan.slotCount <= atlas.slotCount) {
          // Compact to resident roots only when the final atlas will fit after
          // retiring the old storage. Both migrations remain fully charged.
          let roots = 0;
          for (const owner of this.#resources.values()) {
            if (owner.gpu?.atlas !== atlas || owner.workspace.count === 0) continue;
            const layout = owner.layout!;
            const root = layout.mipLayouts[layout.mipCount - 1]!;
            if (root.width !== 1 || root.height !== 1
              || !owner.gpu.residentSlots.has(virtualTexturePageKeyParts(layout.mipCount - 1, 0, 0))) {
              roots = 0;
              break;
            }
            roots++;
          }
          const finalPlan = planVirtualTextureAtlasStorage(resource.layout!, maxTextureSize,
            this.#budget.availableBytes + atlas.allocationBytes - roots * virtualTexturePageBytes(resource.layout!),
            targetSlots, this.#atlasAllowance(atlas), "migration");
          if (roots > 0 && finalPlan.slotCount > atlas.slotCount
            && roots * virtualTexturePageBytes(resource.layout!) + finalPlan.allocationBytes
              <= this.#budget.availableBytes + atlas.allocationBytes) {
            plan = planVirtualTextureAtlasStorage(resource.layout!, maxTextureSize,
              this.#budget.availableBytes, roots, this.#atlasAllowance(atlas), "migration");
            if (plan.slotCount === roots) shrinking = capacityLimited = true;
          }
        }
        const rows = plan.slotCount / atlas.atlasColumns;
        if (Number.isInteger(rows) && rows <= 256 && rows * atlas.storedPageSize <= maxTextureSize) {
          plan = { ...plan, atlasColumns: atlas.atlasColumns, atlasRows: rows };
        }
      } catch {
        atlas.blockedGrowth = fingerprint;
        return result(false);
      }
      if (preserveCached && shrinking && plan.slotCount < liveSlots) return result(false);
      if (shrinking ? plan.slotCount < Math.max(1, capacityLimited ? this.#atlasMinimumSlots.get(atlas.key) ?? 1 : demand) || plan.slotCount >= atlas.slotCount
        : plan.slotCount <= atlas.slotCount) {
        atlas.blockedGrowth = fingerprint;
        return result(false);
      }
      if (!this.#uploadBudget.tryAdmitAllocation()) return result(true);
      changed = true;
      try {
        const replacement = createGpuVirtualTextureAtlas(this.#gl, resource.asset, resource.layout!, this.#budget, atlas.key, plan, true);
        const retainedSlots = shrinking ? atlas.slots.flatMap((entry, slot) =>
          entry === undefined ? [] : [slot]).sort((a, b) => {
          const priority = (slot: number): number => {
            const entry = atlas.slots[slot]!;
            const owner = this.#resources.get(entry.resourceKey);
            const coarse = entry.pageKey === virtualTexturePageKeyParts(owner!.layout!.mipCount - 1, 0, 0);
            if (coarse && owner!.workspace.count > 0) return 3;
            if (owner?.workspace.keys.has(entry.pageKey)) return 2;
            return coarse ? 1 : 0;
          };
          return priority(b) - priority(a) || atlas.lastUsedFrames[b]! - atlas.lastUsedFrames[a]!;
        }).slice(0, replacement.slotCount) : undefined;
        atlas.growth = { replacement, nextSlot: 0, targetSlots, capacityLimited, ...(retainedSlots === undefined ? {} : { retainedSlots }) };
        // Never query allocation errors in the submitting frame: that query
        // can synchronously wait for the entire replacement's initialization.
        return result(true);
      } catch (error) {
        this.#lastAtlasGrowthFailure = `allocate: ${String(error)}`;
        this.#atlasGrowthFailures += 1;
        atlas.blockedGrowth = fingerprint;
        return result(false);
      }
    }
    const growth = atlas.growth;
    const replacement = growth.replacement;
    const copyCount = growth.retainedSlots?.length ?? atlas.slotCount;
    if ((replacement.validationPending && (growth.nextSlot === 0 || growth.nextSlot >= copyCount))
      || replacement.validationFence !== undefined) {
      try {
        if (replacement.validationPending) {
          // WebKit can round-trip even fence creation. Submit work in the
          // previous frame so initialization/copy can run before this call.
          const fence = this.#gl.fenceSync(this.#gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
          if (fence === null) throw new Error("Royal VT could not fence atlas allocation");
          replacement.validationFence = fence;
          delete replacement.validationPending;
          replacement.validationWaitFrames = 0;
          this.#gl.flush();
          return result(true);
        }
        const status = this.#gl.clientWaitSync(replacement.validationFence!, 0, 0);
        replacement.validationWaitFrames = (replacement.validationWaitFrames ?? 0) + 1;
        if (status === this.#gl.TIMEOUT_EXPIRED && replacement.validationWaitFrames < 120) return result(true);
        if (status !== this.#gl.ALREADY_SIGNALED && status !== this.#gl.CONDITION_SATISFIED) {
          throw new Error("Royal VT atlas migration did not complete");
        }
        this.#gl.deleteSync(replacement.validationFence!);
        delete replacement.validationFence;
        const glError = this.#gl.getError();
        if (glError !== this.#gl.NO_ERROR) {
          throw new Error(`Royal VT atlas validation failed (WebGL 0x${glError.toString(16)})`);
        }
      } catch (error) {
        this.#lastAtlasGrowthFailure = `validate: ${String(error)}`;
        destroyGpuVirtualTextureAtlas(this.#gl, replacement, this.#budget);
        delete atlas.growth;
        atlas.blockedGrowth = `${demand}:${this.#budget.availableBytes}:${this.#atlasAllowance(atlas)}:${this.#uploadedPages}`;
        this.#atlasGrowthFailures += 1;
        changed = true;
        return result(false);
      }
    }
    // A view can change while copies are pending. Restart a shrink if it would
    // discard a newly demanded resident page; the old binding is still intact.
    if (growth.retainedSlots !== undefined && atlas.slots.some((entry, slot) =>
      entry !== undefined && this.#protectedPoolPages.has(entry.resourceKey, entry.pageKey)
        && (!growth.capacityLimited || entry.pageKey === virtualTexturePageKeyParts(this.#resources.get(entry.resourceKey)!.layout!.mipCount - 1, 0, 0))
        && !growth.retainedSlots!.includes(slot))) {
      destroyGpuVirtualTextureAtlas(this.#gl, replacement, this.#budget);
      delete atlas.growth;
      return { copied: 0, pending: true, changed: true };
    }
    const slots: number[] = [];
    const targets: number[] = [];
    while (growth.nextSlot < copyCount) {
      const sourceSlot = growth.retainedSlots?.[growth.nextSlot] ?? growth.nextSlot;
      if (atlas.slots[sourceSlot] === undefined) {
        growth.nextSlot += 1;
        continue;
      }
      if (slots.length >= copyLimit || !this.#uploadBudget.tryAdmit(atlas.storedPageSize ** 2 * 4)) break;
      targets.push(growth.nextSlot++);
      slots.push(sourceSlot);
    }
    try {
      if (slots.length > 0) {
        changed = true;
        copied = slots.length;
        copyVirtualTextureAtlasSlots(this.#gl, atlas, growth.replacement, slots, false, targets);
        // Queue bounded batches on consecutive frames. One fence after all
        // copies covers every batch; no replacement is published before it.
        replacement.validationPending = true;
        this.#gl.flush();
        return result(true);
      }
    } catch (error) {
      this.#lastAtlasGrowthFailure = `copy: ${String(error)}`;
      destroyGpuVirtualTextureAtlas(this.#gl, growth.replacement, this.#budget);
      delete atlas.growth;
      atlas.blockedGrowth = `${demand}:${this.#budget.availableBytes}:${this.#atlasAllowance(atlas)}:${this.#uploadedPages}`;
      this.#atlasGrowthFailures += 1;
      return result(false);
    }
    if (growth.nextSlot < copyCount) return result(true);
    // The final slots may be empty, leaving an earlier batch still unfenced.
    if (replacement.validationPending) return result(true);
    const resources = Array.from(this.#resources.values()).filter((value) => value.gpu?.atlas === atlas);
    const layoutChanged = growth.retainedSlots !== undefined || replacement.atlasColumns !== atlas.atlasColumns;
    const tableBytes = layoutChanged ? resources.reduce((sum, resource) => sum + resource.layout!.tableByteLength, 0) : 0;
    if (!this.#uploadBudget.tryAdmit(tableBytes)) return result(true);
    replacement.referenceCount = atlas.referenceCount;
    for (let slot = 0; slot < copyCount; slot += 1) {
      const sourceSlot = growth.retainedSlots?.[slot] ?? slot;
      replacement.slots[slot] = atlas.slots[sourceSlot];
      replacement.lastUsedFrames[slot] = atlas.lastUsedFrames[sourceSlot]!;
    }
    if (growth.retainedSlots !== undefined) {
      for (const resource of resources) {
        for (const [key, slot] of resource.gpu!.residentSlots) if (slot < COMPRESSED_SLOT_BASE) resource.gpu!.residentSlots.delete(key);
      }
      replacement.slots.forEach((entry, slot) => {
        if (entry !== undefined) this.#resources.get(entry.resourceKey)?.gpu?.residentSlots.set(entry.pageKey, slot);
      });
    }
    const maxTextureSize = this.#textureSizeLimit();
    for (const resource of resources) {
      const gpu = resource.gpu!;
      gpu.atlas = replacement;
      gpu.maxResidentPages = virtualTextureResidentPageCapacity(resource.layout!,
        maxTextureSize, replacement);
      gpu.binding = {
        ...gpu.binding,
        atlas: { ...gpu.binding.atlas, texture: replacement.atlasTexture },
        settings1: new Float32Array([replacement.atlasColumns * replacement.storedPageSize,
          replacement.atlasRows * replacement.storedPageSize, gpu.binding.settings1[2]!, gpu.binding.settings1[3]!]),
      };
      if (layoutChanged) {
        gpu.pageTableDirty = true;
        gpu.pageTableRebuild = true;
      }
      resource.demandRevision = -1;
    }
    this.#atlases.set(atlas.key, replacement);
    delete atlas.growth;
    destroyGpuVirtualTextureAtlas(this.#gl, atlas, this.#budget);
    this.#bindingRevision += 1;
    changed = true;
    return result(false);
  }

  #textureSizeLimit(): number {
    return this.#maxTextureSize ??= this.#gl.getParameter(this.#gl.MAX_TEXTURE_SIZE) as number;
  }

  #createGpuResource(
    resource: RuntimeResource,
    layout: VirtualTextureLayout,
  ): GpuVirtualTexture {
    const atlasKey = virtualTextureAtlasKey(resource, layout);
    const maxTextureSize = this.#textureSizeLimit();
    let atlas = this.#atlases.get(atlasKey);
    const created = atlas === undefined;
    if (atlas === undefined) {
      const plan = planVirtualTextureAtlasStorage(
        layout,
        maxTextureSize,
        this.#budget.availableBytes,
        this.#targetAtlasSlots(atlasKey),
        this.#atlasAllowance(undefined, atlasKey),
      );
      atlas = createGpuVirtualTextureAtlas(
        this.#gl,
        resource.asset,
        layout,
        this.#budget,
        atlasKey,
        plan,
      );
      this.#atlases.set(atlasKey, atlas);
    }
    try {
      const gpu = createGpuVirtualTexture(
        this.#gl,
        resource.asset,
        layout,
        this.#budget,
        atlas,
        maxTextureSize,
      );
      gpu.binding.settings1[3] = this.#anisotropy.forSampler(resource.sampler);
      atlas.referenceCount += 1;
      return gpu;
    } catch (error) {
      if (created) {
        destroyGpuVirtualTextureAtlas(this.#gl, atlas, this.#budget);
        this.#atlases.delete(atlasKey);
      }
      throw error;
    }
  }

  #releaseGpuResource(resource: RuntimeResource): void {
    const gpu = resource.gpu!;
    const atlas = gpu.atlas;
    for (const [pageKey, slot] of gpu.residentSlots) {
      const resident = atlas.slots[slot];
      if (resident?.resourceKey === resource.key && resident.pageKey === pageKey) {
        atlas.slots[slot] = undefined;
      }
    }
    gpu.astc?.dispose();
    destroyGpuVirtualTexture(this.#gl, gpu, this.#budget);
    resource.gpu = undefined;
    atlas.referenceCount -= 1;
    if (atlas.referenceCount === 0) {
      destroyGpuVirtualTextureAtlas(this.#gl, atlas, this.#budget);
      this.#atlases.delete(atlas.key);
    }
  }

  #publishDirtyPageTables(): boolean {
    let published = false;
    for (const resource of this.#resources.values()) {
      if (resource.gpu?.pageTableDirty !== true) continue;
      this.#publishPageTable(resource);
      resource.gpu.pageTableDirty = false;
      published = true;
    }
    return published;
  }

  #changed(presentationChanged = true): void {
    this.#automatic.onChanged(presentationChanged);
  }

  #cancelStalePageReads(resource: RuntimeResource): void {
    for (const [key, controller] of resource.loadingPages) {
      if (resource.workspace.keys.has(key)) continue;
      controller.abort();
      resource.loadingPages.delete(key);
    }
  }

  #demandViewsChanged(
    views: readonly SurfaceFrameView[],
  ): boolean {
    const stride = 18;
    const length = views.length * stride;
    if (this.#viewState.length !== length) this.#viewState = new Float64Array(length);
    let changed = this.#viewCount !== views.length;
    for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
      const view = views[viewIndex]!;
      const offset = viewIndex * stride;
      for (let component = 0; component < 16; component += 1) {
        const value = view.viewProjection[component]!;
        if (this.#viewState[offset + component] !== value) changed = true;
        this.#viewState[offset + component] = value;
      }
      const viewport = view.viewport;
      if (this.#viewState[offset + 16] !== viewport.width) changed = true;
      if (this.#viewState[offset + 17] !== viewport.height) changed = true;
      this.#viewState[offset + 16] = viewport.width;
      this.#viewState[offset + 17] = viewport.height;
    }
    this.#viewCount = views.length;
    return changed;
  }

  #publicationAncestorReady(
    resource: RuntimeResource,
    mip: number,
  ): boolean {
    const layout = resource.layout!;
    if (mip !== layout.mipCount - 1) {
      return resource.gpu!.residentSlots.has(virtualTexturePageKeyParts(layout.mipCount - 1, 0, 0));
    }
    return true;
  }

  #schedulePageReads(): void {
    const resources = this.#scheduleResources;
    let idleVisits = 0;
    while (
      resources.length > 0
      && idleVisits < resources.length
      && this.#activeJobs < MAX_DECODE_JOBS
      && this.#activeJobs + this.#readyPages < MAX_AUTOMATIC_PAGE_JOBS
    ) {
      if (this.#scheduleCursor >= resources.length) this.#scheduleCursor = 0;
      const resource = resources[this.#scheduleCursor]!;
      this.#scheduleCursor += 1;
      if (this.#startNextPageRead(resource)) idleVisits = 0;
      else idleVisits += 1;
    }
  }

  #pageSlot(resource: RuntimeResource, key: VirtualTexturePageKey): number {
    const gpu = resource.gpu!;
    return selectVirtualTexturePoolSlot(
      resource.key,
      key,
      gpu.atlas.slots,
      gpu.atlas.lastUsedFrames,
      this.#protectedPoolPages,
      gpu.residentSlots.size - gpu.compressedPages >= gpu.maxResidentPages ? gpu.residentSlots : undefined,
    );
  }

  #nativePreviewSufficient(resource: RuntimeResource): boolean {
    const source = resource.lease?.source;
    return source?.kind !== undefined && source.preview !== undefined && !texturePreviewReady(source.preview)
      && virtualTextureDemandLod(resource.workspace) >= Math.log2(Math.max(
        resource.layout!.width / source.width, resource.layout!.height / source.height));
  }

  #canLoadRasterPreview(bytes: number): boolean {
    const scan = ++this.#decodedScan;
    for (const resource of this.#resources.values()) {
      const source = resource.lease?.source;
      if (source === undefined || this.#seenDecoded.get(source) === scan) continue;
      this.#seenDecoded.set(source, scan);
      bytes += automaticSourceBytes(source);
    }
    return bytes <= MAX_AUTOMATIC_DECODED_BYTES;
  }

  #preparationAtlas(atlas: GpuVirtualTextureAtlas): GpuVirtualTextureAtlas {
    const growth = atlas.growth;
    // Only fully reserved expansion can prepare pixels ahead of publication.
    if (growth === undefined || growth.retainedSlots !== undefined) return atlas;
    return growth.replacement;
  }

  #startNextPageRead(resource: RuntimeResource): boolean {
    const gpu = resource.gpu;
    if (gpu === undefined || resource.source === undefined) return false;
    const preparingGrowth = this.#preparationAtlas(gpu.atlas) !== gpu.atlas;
    if (gpu.atlas.growth !== undefined && !preparingGrowth) return false;
    if (preparingGrowth) {
      // Bound concurrent page preparation while atlas migration is pending.
      let growthJobs = 0;
      for (const owner of this.#resources.values()) if (owner.gpu?.atlas.growth !== undefined) {
        growthJobs += owner.loadingPages.size + owner.readyPages.length;
      }
      if (growthJobs >= 2) return false;
    }
    const preview = resource.lease?.source;
    const detailSource = preview !== undefined && automaticVirtualTextureHasPreview(preview)
      ? preview.preview : undefined;
    // Native preview stays bound until screen demand needs authoritative detail.
    if (preview?.kind !== undefined && detailSource !== undefined
      && (detailSource.error !== undefined || resource.previewSourceFailed
        || this.#nativePreviewSufficient(resource))) return false;
    const layout = resource.layout!;
    const byteLength = virtualTexturePageBytes(layout);
    for (let position = 0; position < resource.workspace.count; position += 1) {
      const index = resource.workspace.order[position]!;
      const mip = resource.workspace.mips[index]!;
      const x = resource.workspace.xs[index]!;
      const y = resource.workspace.ys[index]!;
      const key = virtualTexturePageKeyParts(mip, x, y);
      if (
        gpu.residentSlots.has(key)
        || resource.loadingPages.has(key)
        || resource.readyPageKeys.has(key)
        || resource.failedPages.has(key)
        || !this.#publicationAncestorReady(resource, mip)
      ) continue;
      // Avoid preparing pages while every atlas cell is protected.
      if (!preparingGrowth && this.#pageSlot(resource, key) < 0) continue;
      if (detailSource !== undefined && !texturePreviewReady(detailSource)) {
        if (!resource.previewSourcePending) {
          if (detailSource.retainedBytes === 0
            && !this.#canLoadRasterPreview(detailSource.rasterBytes)) return false;
          resource.previewSourcePending = true;
          // Transport runs before the raster decode enters the detail lane.
          void detailSource.load().catch(() => {
            if (!resource.abort.signal.aborted) resource.previewSourceFailed = true;
          }).finally(() => {
            resource.previewSourcePending = false;
            if (!resource.abort.signal.aborted && !this.#disposed) this.#changed();
          });
        }
        return false;
      }
      if ((gpu.residentSlots.size > 0 || detailSource !== undefined) && this.#detailJobs > 0) return false;
      if (byteLength > MAX_PENDING_PAGE_BYTES) {
        resource.failedPages.add(key);
        this.#changed();
        continue;
      }
      if (this.#pendingPageBytes + byteLength > MAX_PENDING_PAGE_BYTES) return false;
      this.#startPageRead(resource, { mip, x, y }, key, byteLength);
      return true;
    }
    return false;
  }

  #startPageRead(
    resource: RuntimeResource,
    page: VirtualTexturePageId,
    pageKey: VirtualTexturePageKey,
    byteLength: number,
  ): void {
    const source = resource.source;
    if (source === undefined) {
      resource.failedPages.add(pageKey);
      this.#changed();
      return;
    }
    const controller = new AbortController();
    // The native preview stays bound while its raster detail uses the background lane.
    const retainedSource = resource.lease?.source;
    const detail = (resource.gpu!.residentSlots.size > 0
      || (retainedSource !== undefined && automaticVirtualTextureHasPreview(retainedSource)));
    if (detail) this.#detailJobs += 1;
    this.#pendingPageBytes += byteLength;
    let retained = false;
    resource.loadingPages.set(pageKey, controller);
    this.#activeJobs += 1;
    this.#pageRequests += 1;
    this.#changed(false);
    // Generated page work uses the bounded foreground or detail preparation lane.
    const queuedAt = performance.now();
    void (detail ? this.#scheduleDetail : this.#schedule)(
      controller.signal,
      async () => {
        const startedAt = performance.now();
        this.#pageTiming.queueMs += startedAt - queuedAt;
        this.#pageTiming.reads++;
        try { return await (source.read(page, controller.signal)); }
        finally { this.#pageTiming.readMs += performance.now() - startedAt; }
      },
    ).then((decoded) => {
      const current = resource.loadingPages.get(pageKey) === controller;
      if (
        controller.signal.aborted
        || !current
        || resource.abort.signal.aborted
        || this.#disposed
        || !resource.workspace.keys.has(pageKey)
      ) decoded.close();
      else {
        resource.readyPageKeys.add(pageKey);
        resource.readyPages.push({ byteLength, decoded, page, pageKey, readyAt: performance.now() });
        retained = true;
        this.#readyPages += 1;
      }
    }).catch(() => {
      if (!controller.signal.aborted && !resource.abort.signal.aborted) {
        resource.failedPages.add(pageKey);
      }
    }).finally(() => {
      if (resource.loadingPages.get(pageKey) === controller) {
        resource.loadingPages.delete(pageKey);
      }
      this.#activeJobs -= 1;
      if (detail) this.#detailJobs -= 1;
      if (!retained) this.#pendingPageBytes -= byteLength;
      if (!resource.abort.signal.aborted && !this.#disposed) {
        this.#changed(retained);
        this.#schedulePageReads();
      }
    });
  }

  #uploadReadyPage(
    resource: RuntimeResource,
    ready: ReadyPage,
    slot: number,
    evicted: VirtualTexturePoolSlot | undefined,
  ): void {
    const gpu = resource.gpu!;
    const atlas = gpu.atlas;
    const storedPageSize = atlas.storedPageSize;
    const slotX = slot % atlas.atlasColumns;
    const slotY = Math.floor(slot / atlas.atlasColumns);
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas.atlasTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        slotX * storedPageSize,
        slotY * storedPageSize,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        ready.decoded.source,
      );
    // Commit logical eviction only after validation and the replacement upload
    // succeed, so a rejected page cannot destroy a usable ancestor fallback.
    const firstResident = gpu.residentSlots.size === 0;
    if (evicted !== undefined) {
      const evictedResource = this.#resources.get(evicted.resourceKey);
      const evictedGpu = evictedResource?.gpu;
      if (evictedResource !== undefined && evictedGpu !== undefined) {
        const hadOneResident = evictedGpu.residentSlots.size === 1;
        evictedGpu.residentSlots.delete(evicted.pageKey);
        evictedGpu.pageTableDirty = true;
        evictedGpu.pageTableRebuild = true;
        const lostCoverage = evicted.pageKey === virtualTexturePageKeyParts(evictedResource.layout!.mipCount - 1, 0, 0);
        if ((hadOneResident || lostCoverage) && evictedResource !== resource) this.#bindingRevision += 1;
        if (evictedResource !== resource) this.#changed(false);
      }
    }
    atlas.slots[slot] = { pageKey: ready.pageKey, resourceKey: resource.key };
    atlas.lastUsedFrames[slot] = this.#frame;
    gpu.residentSlots.set(ready.pageKey, slot);
    if (ready.pageKey === virtualTexturePageKeyParts(resource.layout!.mipCount - 1, 0, 0)) {
      this.#bindingRevision += 1;
    }
    gpu.pageTableDirty = true;
    gpu.pageTableAdditions.push(ready.page);
    this.#uploadedPages += 1;
    if (firstResident) this.#bindingRevision += 1;
  }

  #clearReadyPages(resource: RuntimeResource): void {
    for (const ready of resource.readyPages) {
      ready.decoded.close();
      this.#pendingPageBytes -= ready.byteLength;
    }
    this.#readyPages -= resource.readyPages.length;
    resource.readyPageKeys.clear();
    resource.readyPages.length = 0;
  }

  #settleReadyPage(resource: RuntimeResource): void {
    const ready = resource.readyPages.shift()!;
    this.#pendingPageBytes -= ready.byteLength;
    resource.readyPageKeys.delete(ready.pageKey);
    this.#readyPages -= 1;
  }

  #publishPageTable(resource: RuntimeResource): void {
    const gpu = resource.gpu!;
    const layout = resource.layout!;
    let highestMip = gpu.pageTableRebuild ? layout.mipCount - 1 : 0;
    if (gpu.pageTableRebuild) {
      writeVirtualTexturePageTable(layout, gpu.residentSlots, gpu.atlas.atlasColumns, gpu.pageTableBytes, gpu.astc?.columns);
    } else {
      for (const page of gpu.pageTableAdditions) {
        highestMip = Math.max(highestMip, page.mip);
        const slot = gpu.residentSlots.get(virtualTexturePageKeyParts(page.mip, page.x, page.y));
        if (slot !== undefined) addVirtualTexturePageTablePage(layout, page, slot, gpu.atlas.atlasColumns, gpu.pageTableBytes, gpu.astc?.columns);
      }
    }
    gpu.pageTableRebuild = false;
    gpu.pageTableAdditions.length = 0;
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, gpu.pageTableTexture);
    for (let mip = 0; mip <= highestMip; mip += 1) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        mip,
        0,
        0,
        Math.max(1, layout.tableWidth / 2 ** mip),
        Math.max(1, layout.tableHeight / 2 ** mip),
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        gpu.pageTableLevels[mip]!,
      );
    }
  }
}

export const createBrowserVirtualTextureRuntime = (
  gl: WebGL2RenderingContext,
  budget = new PersistentGpuBudgetOwner(),
  schedule: AsyncPreparationScheduler = prepareDirectly,
  automatic: AutomaticVirtualTextureRuntimeOptions = {
    acquireDecoded: () => undefined,
    decoded: () => undefined,
    onChanged: () => undefined,
  },
  uploadBudget = new FrameUploadBudgetOwner(),
  scheduleDetail: AsyncPreparationScheduler = schedule,
  anisotropy = new TextureAnisotropy(gl),
): VirtualTextureRuntime => new BrowserVirtualTextureRuntime(
  gl,
  budget,
  schedule,
  automatic,
  uploadBudget,
  scheduleDetail,
  anisotropy,
);
