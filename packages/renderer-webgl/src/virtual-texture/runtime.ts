import { allocateVirtualTexturePoolBytes } from "./pool-budget";
import type { VirtualTextureAssetRef } from "@royal/renderer-core";
import type { SurfaceFrameView } from "../frame/surface-frame";
import { IDENTITY_TEXTURE_COORDINATES } from "../surface/texture-coordinates";
import {
  canonicalTextureSampler,
  type CanonicalTextureSampler,
} from "../texture/sampler";
import type { CanonicalSurfaceScene } from "../surface/scene-lowering";
import { etc2RgbaWebGlFormat } from "../texture/etc2-storage";
import {
  openAuthoredVirtualTexturePageSource,
  type DecodedVirtualTexturePage,
  type VirtualTexturePageSource,
} from "./browser-page-source";
import {
  automaticVirtualTextureEligible,
  automaticVirtualTextureIsSvg,
  automaticVirtualTextureHasPreview,
  createAutomaticSvgPreviewPageSource,
  createAutomaticRasterPageSource,
  createAutomaticSvgPageSource,
} from "./automatic-page-source";
import {
  collectVirtualTextureDemand,
  createVirtualTextureDemandWorkspace,
  resetVirtualTextureDemand,
  truncateVirtualTextureDemand,
  type VirtualTextureDemandSurface,
  type VirtualTextureDemandWorkspace,
} from "./demand";
import {
  virtualTexturePageKeyParts,
  type VirtualTextureManifest,
  type VirtualTexturePageId,
} from "./manifest";
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
  VirtualTextureAssetSnapshot,
  VirtualTextureFrameUpdate,
  VirtualTextureRuntimeSnapshot,
} from "./runtime-contract";
import {
  automaticVirtualTextureAssetKey,
  virtualTextureAssetKey,
} from "./runtime-contract";
import { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS } from "./shader-source";
import { SvgRasterCache } from "./svg-raster-cache";
import { copyVirtualTextureAtlasSlots } from "./atlas-copy";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import type { AsyncPreparationScheduler } from "../resource/async-preparation-owner";
import type {
  DecodedTextureSource,
  DecodedTextureLease,
  TextureSourceRef,
} from "../texture/source";
import { FrameUploadBudgetOwner } from "../resource/frame-upload-budget";
import {
  planVirtualTextureAtlasStorage,
  type VirtualTextureAtlasStoragePlan,
  virtualTextureResidentPageCapacity,
} from "./storage-plan";

const MAX_DECODE_JOBS = 4;
const MAX_PENDING_PAGE_BYTES = 16 * 1024 * 1024;
const MAX_UPLOADS_PER_FRAME = 4;
const MAX_DEMAND_PAGES = 512;
const ATLAS_SHRINK_DELAY_MS = 2000;
const MAX_AUTOMATIC_DECODED_BYTES = 64 * 1024 * 1024;
const IDLE_VIRTUAL_TEXTURE_SNAPSHOT: VirtualTextureAssetSnapshot = {
  failedPages: 0,
  pendingPages: 0,
  residentPages: 0,
  status: "idle",
};
const FRAME_RESULTS = [
  { pending: false, webGlStateChanged: false },
  { pending: true, webGlStateChanged: false },
  { pending: false, webGlStateChanged: true },
  { pending: true, webGlStateChanged: true },
];
const prepareDirectly: AsyncPreparationScheduler = (_signal, prepare) => prepare();

type ReadyPage = Readonly<{
  page: VirtualTexturePageId;
  preview: boolean;
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
  shrinkAfter?: number;
  blockedGrowth?: string;
  atlasTexture: WebGLTexture;
  budgetIdentity: object;
  key: string;
  lastUsedFrames: Uint32Array;
  referenceCount: number;
  slots: (VirtualTexturePoolSlot | undefined)[];
};

type GpuVirtualTexture = {
  previewCoarse?: boolean;
  atlas: GpuVirtualTextureAtlas;
  atlasSampler: WebGLSampler;
  budgetIdentity: object;
  binding: VirtualTextureGpuBinding;
  maxResidentPages: number;
  pageTableDirty: boolean;
  pageTableRebuild: boolean;
  pageTableAdditions: VirtualTexturePageId[];
  pageTableBytes: Uint8Array;
  pageTableLevels: readonly Uint8Array[];
  pageTableSampler: WebGLSampler;
  pageTableTexture: WebGLTexture;
  residentSlots: Map<VirtualTexturePageKey, number>;
};

type RuntimeResource = {
  readonly abort: AbortController;
  readonly asset: TextureSourceRef | VirtualTextureAssetRef;
  readonly authored: boolean;
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
  manifest?: VirtualTextureManifest;
  manifestFailure?: string;
  manifestFailureState?: "error" | "unsupported";
  manifestPending: boolean;
  readonly readyPageKeys: Set<VirtualTexturePageKey>;
  readonly readyPages: ReadyPage[];
  previewSourcePending?: boolean;
  previewSourceFailed?: boolean;
  readonly sampler: CanonicalTextureSampler;
  snapshot: VirtualTextureAssetSnapshot | undefined;
  source?: VirtualTexturePageSource;
  readonly surfaces: VirtualTextureDemandSurface[];
  readonly workspace: VirtualTextureDemandWorkspace;
};

export type AutomaticVirtualTextureRuntimeOptions = Readonly<{
  acquireDecoded(asset: TextureSourceRef): DecodedTextureLease | undefined;
  decoded(asset: TextureSourceRef): DecodedTextureSource | undefined;
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

const virtualTextureAtlasKey = (
  asset: Pick<TextureSourceRef | VirtualTextureAssetRef, "colorSpace">,
  manifest: VirtualTextureManifest,
): string => JSON.stringify([
  manifest.pageSize + manifest.borderTexels * 2,
  manifest.pageEncoding,
  asset.colorSpace ?? manifest.colorSpace,
]);

const createGpuVirtualTextureAtlas = (
  gl: WebGL2RenderingContext,
  asset: Pick<TextureSourceRef | VirtualTextureAssetRef, "colorSpace">,
  manifest: VirtualTextureManifest,
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
    const colorSpace = asset.colorSpace ?? manifest.colorSpace;
    gl.texStorage2D(
      gl.TEXTURE_2D,
      1,
      plan.compressed
        ? etc2RgbaWebGlFormat(colorSpace)
        : colorSpace === "srgb" ? gl.SRGB8_ALPHA8 : gl.RGBA8,
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
  asset: Pick<TextureSourceRef | VirtualTextureAssetRef, "colorSpace" | "sampler">,
  manifest: VirtualTextureManifest,
  budget: PersistentGpuBudgetOwner,
  atlas: GpuVirtualTextureAtlas,
  maxTextureSize: number,
): GpuVirtualTexture => {
  const maxResidentPages = virtualTextureResidentPageCapacity(
    manifest,
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
    if (!budget.tryClaim(budgetIdentity, manifest.tableByteLength)) {
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
    const pageTableBytes = new Uint8Array(manifest.tableByteLength);
    const pageTableLevels: Uint8Array[] = [];
    for (let mip = 0; mip < manifest.mipCount; mip += 1) {
      const offset = manifest.mipLayouts[mip]!.byteOffset;
      const width = Math.max(1, manifest.tableWidth / 2 ** mip);
      const height = Math.max(1, manifest.tableHeight / 2 ** mip);
      pageTableLevels.push(pageTableBytes.subarray(offset, offset + width * height * 4));
    }
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, pageTableTexture);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      manifest.mipCount,
      gl.RGBA8,
      manifest.tableWidth,
      manifest.tableHeight,
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
          manifest.width,
          manifest.height,
          manifest.pageSize,
          manifest.borderTexels,
        ]),
        settings1: new Float32Array([
          atlas.atlasColumns * atlas.storedPageSize,
          atlas.atlasRows * atlas.storedPageSize,
          manifest.tableWidth,
          manifest.tableHeight,
        ]),
        settings2: new Float32Array([
          manifest.mipCount,
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
  #viewCount = 0;
  #viewRevision = 0;
  #viewState = new Float64Array(0);
  readonly #gl: WebGL2RenderingContext;
  #maxTextureSize: number | undefined;
  readonly #etc2Available: boolean;
  readonly #atlases = new Map<string, GpuVirtualTextureAtlas>();
  readonly #atlasDemand = new Map<string, number>();
  readonly #atlasDemandBytes = new Map<string, number>();
  #atlasShares = new Map<string, number>();
  readonly #atlasMinimumSlots = new Map<string, number>();
  #atlasGrowthFailures = 0;
  #shrinkTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #svgRasterCache = new SvgRasterCache();
  readonly #automatic: AutomaticVirtualTextureRuntimeOptions;
  readonly #onChanged: (asset: VirtualTextureAssetRef, presentationChanged: boolean) => void;
  readonly #schedule: AsyncPreparationScheduler;
  readonly #scheduleDetail: AsyncPreparationScheduler;
  readonly #uploadBudget: FrameUploadBudgetOwner;
  readonly #resources = new Map<string, RuntimeResource>();
  readonly #protectedPoolPages = {
    has: (resourceKey: string, pageKey: VirtualTexturePageKey): boolean =>
      this.#resources.get(resourceKey)?.workspace.keys.has(pageKey) === true,
  };
  #scene: CanonicalSurfaceScene | null = null;
  readonly shaderSource = { declarations: VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS };

  constructor(
    gl: WebGL2RenderingContext,
    onChanged: (asset: VirtualTextureAssetRef, presentationChanged: boolean) => void,
    budget: PersistentGpuBudgetOwner,
    schedule: AsyncPreparationScheduler,
    automatic: AutomaticVirtualTextureRuntimeOptions,
    uploadBudget: FrameUploadBudgetOwner,
    etc2Available: boolean,
    scheduleDetail: AsyncPreparationScheduler,
  ) {
    this.#gl = gl;
    this.#onChanged = onChanged;
    this.#budget = budget;
    this.#schedule = schedule;
    this.#scheduleDetail = scheduleDetail;
    this.#automatic = automatic;
    this.#uploadBudget = uploadBudget;
    this.#etc2Available = etc2Available;
  }

  get bindingRevision(): number {
    return this.#bindingRevision;
  }

  binding(asset: VirtualTextureAssetRef): VirtualTextureGpuBinding | undefined {
    const resource = this.#resources.get(virtualTextureAssetKey(asset));
    return resource?.gpu !== undefined && resource.gpu.residentSlots.size > 0
      ? resource.gpu.binding
      : undefined;
  }

  automaticBinding(asset: TextureSourceRef): VirtualTextureGpuBinding | undefined {
    const resource = this.#resources.get(automaticVirtualTextureAssetKey(asset));
    return resource?.gpu !== undefined && resource.gpu.residentSlots.has(
      virtualTexturePageKeyParts(resource.manifest!.mipCount - 1, 0, 0),
    )
      ? resource.gpu.binding
      : undefined;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    clearTimeout(this.#shrinkTimer);
    for (const resource of this.#resources.values()) this.#destroyResource(resource, true);
    this.#resources.clear();
    this.#scheduleResources.length = 0;
    this.#scheduleCursor = 0;
    this.#scene = null;
  }

  invalidate(): void {
    this.#maxTextureSize = undefined;
    clearTimeout(this.#shrinkTimer);
    this.#shrinkTimer = undefined;
    for (const resource of this.#resources.values()) {
      if (resource.gpu !== undefined) {
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
    let automaticDecodedBytes = this.#svgRasterCache.byteLength;
    let automaticResources = 0;
    let failedPages = 0;
    let pendingPages = 0;
    let residentPages = 0;
    let desiredPages = 0;
    let unresidentPages = 0;
    let admittedPages = 0;
    for (const resource of this.#resources.values()) {
      if (!resource.authored) {
        automaticResources += 1;
        if (resource.lease !== undefined) {
          automaticDecodedBytes += resource.lease.source.width
            * resource.lease.source.height * 4;
        }
      }
      failedPages += resource.failedPages.size + (resource.previewSourceFailed ? 1 : 0);
      pendingPages += resource.loadingPages.size + resource.readyPages.length
        + (resource.previewSourcePending ? 1 : 0);
      residentPages += resource.gpu?.residentSlots.size ?? 0;
      desiredPages += resource.desiredPageCount ?? 0;
      admittedPages += resource.workspace.count;
      for (const key of resource.workspace.keys) {
        if (!resource.gpu?.residentSlots.has(key) || this.#needsCoarseAuthority(resource, key)) unresidentPages += 1;
      }
    }
    return {
      admittedUploadBytes: uploads.admittedBytes,
      atlasBytes,
      atlasPools: this.#atlases.size,
      atlasGrowthFailures: this.#atlasGrowthFailures,
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

  snapshot(asset: VirtualTextureAssetRef): VirtualTextureAssetSnapshot {
    const resource = this.#resources.get(virtualTextureAssetKey(asset));
    if (resource === undefined) return IDLE_VIRTUAL_TEXTURE_SNAPSHOT;
    let next: VirtualTextureAssetSnapshot;
    if (resource.manifestFailure !== undefined) {
      next = {
        error: resource.manifestFailure,
        failedPages: resource.failedPages.size,
        pendingPages: 0,
        residentPages: resource.gpu?.residentSlots.size ?? 0,
        status: resource.manifestFailureState ?? "error",
      };
    } else {
      next = {
        failedPages: resource.failedPages.size,
        pendingPages: resource.loadingPages.size + resource.readyPages.length,
        residentPages: resource.gpu?.residentSlots.size ?? 0,
        status: resource.manifestPending ? "loading" : "ready",
      };
    }
    const previous = resource.snapshot;
    if (
      previous !== undefined
      && previous.status === next.status
      && previous.failedPages === next.failedPages
      && previous.pendingPages === next.pendingPages
      && previous.residentPages === next.residentPages
      && previous.error === next.error
    ) return previous;
    resource.snapshot = next;
    return next;
  }

  setScene(scene: CanonicalSurfaceScene | null): void {
    if (this.#disposed || this.#scene === scene) return;
    this.#scene = scene;
    for (const resource of this.#resources.values()) resource.demandRevision = -1;
    const claimed = new Set<string>();
    for (const asset of scene?.virtualTextureAssets ?? []) {
      const key = virtualTextureAssetKey(asset);
      claimed.add(key);
      if (this.#resources.has(key)) continue;
      const resource: RuntimeResource = {
        abort: new AbortController(),
        asset,
        authored: true,
        demandRevision: -1,
        failedPages: new Set(),
        gpu: undefined,
        key,
        loadingPages: new Map(),
        manifestPending: true,
        readyPageKeys: new Set(),
        readyPages: [],
        sampler: canonicalTextureSampler(asset),
        snapshot: undefined,
        surfaces: [],
        workspace: createVirtualTextureDemandWorkspace(MAX_DEMAND_PAGES),
      };
      this.#resources.set(key, resource);
      void this.#openSource(resource);
    }
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
    for (const key of candidates.keys()) {
      const existing = this.#resources.get(key);
      if (existing?.lease !== undefined) {
        retainedDecodedBytes += existing.lease.source.width
          * existing.lease.source.height * 4;
      }
    }
    for (const [key, asset] of candidates) {
      const existing = this.#resources.get(key);
      if (existing !== undefined) {
        claimed.add(key);
        continue;
      }
      const decoded = this.#automatic.decoded(asset);
      if (decoded === undefined) {
        this.#automaticWaiting += 1;
        continue;
      }
      const svg = automaticVirtualTextureIsSvg(decoded);
      const preview = automaticVirtualTextureHasPreview(decoded);
      if (
        decoded.kind === "ktx2-etc2"
        || (!svg && !preview && !automaticVirtualTextureEligible(decoded))
      ) {
        this.#automaticIneligible += 1;
        continue;
      }
      const decodedBytes = decoded.width * decoded.height * 4;
      if (!svg && retainedDecodedBytes + decodedBytes > MAX_AUTOMATIC_DECODED_BYTES) {
        this.#automaticIneligible += 1;
        continue;
      }
      const sampler = canonicalTextureSampler(asset);
      let lease: DecodedTextureLease | undefined;
      let source: VirtualTexturePageSource;
      if (svg) {
        source = createAutomaticSvgPageSource(
          decoded.encodedSvg,
          decoded.width,
          decoded.height,
          sampler,
          asset.colorSpace ?? "srgb",
          this.#svgRasterCache,
        );
      } else {
        lease = this.#automatic.acquireDecoded(asset);
        if (lease === undefined) {
          this.#automaticWaiting += 1;
          continue;
        }
        if (!automaticVirtualTextureHasPreview(lease.source) && !automaticVirtualTextureEligible(lease.source)) {
          lease.release();
          this.#automaticIneligible += 1;
          continue;
        }
        retainedDecodedBytes += lease.source.width * lease.source.height * 4;
        source = automaticVirtualTextureHasPreview(lease.source)
          ? createAutomaticSvgPreviewPageSource(lease.source, sampler, asset.colorSpace ?? "srgb", this.#svgRasterCache)
          : createAutomaticRasterPageSource(lease.source, sampler, asset.colorSpace ?? "srgb");
      }
      claimed.add(key);
      this.#resources.set(key, {
        abort: new AbortController(),
        asset,
        authored: false,
        demandRevision: -1,
        failedPages: new Set(),
        gpu: undefined,
        key,
        ...(lease === undefined ? {} : { lease }),
        loadingPages: new Map(),
        manifest: source.manifest,
        manifestPending: false,
        readyPageKeys: new Set(),
        readyPages: [],
        sampler,
        snapshot: undefined,
        source,
        surfaces: [],
        workspace: createVirtualTextureDemandWorkspace(MAX_DEMAND_PAGES, "coarsest"),
      });
    }
    for (const [key, resource] of this.#resources) {
      if (claimed.has(key)) continue;
      this.#destroyResource(resource, true);
      this.#resources.delete(key);
      this.#bindingRevision += 1;
      this.#changed(resource);
    }
    for (const resource of this.#resources.values()) resource.surfaces.length = 0;
    for (const surface of scene?.surfaces ?? []) {
      const authoredAsset = surface.material.baseColorVirtualAsset;
      const automaticAsset = surface.material.baseColorAsset;
      const resource = authoredAsset !== undefined
        ? this.#resources.get(virtualTextureAssetKey(authoredAsset))
        : automaticAsset === undefined
          ? undefined
          : this.#resources.get(automaticVirtualTextureAssetKey(automaticAsset));
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
    let uploadsRemaining = MAX_UPLOADS_PER_FRAME;
    if (this.#demandViewsChanged(views)) this.#viewRevision += 1;

    this.#atlasDemand.clear();
    this.#atlasDemandBytes.clear();
    this.#atlasMinimumSlots.clear();
    const poolRequests = new Map<string, { key: string; minimumBytes: number; wantedBytes: number }>();
    let compressedBytes = 0;
    const compressedKeys = new Set<string>();
    for (const resource of this.#resources.values()) {
      this.#refreshFrameDemand(resource, views);
      const manifest = resource.manifest;
      if (manifest === undefined || resource.manifestFailure !== undefined) continue;
      const key = virtualTextureAtlasKey(resource.asset, manifest);
      const bytesPerPage = (manifest.pageSize + manifest.borderTexels * 2) ** 2 * (manifest.pageEncoding === "ktx2-etc2" ? 1 : 4);
      const count = Math.min(resource.desiredPageCount ?? 0, manifest.physicalSlots ?? Infinity,
        manifest.physicalByteBudget === undefined ? Infinity : Math.floor(manifest.physicalByteBudget / bytesPerPage));
      this.#atlasDemand.set(key, (this.#atlasDemand.get(key) ?? 0) + count);
      this.#atlasDemandBytes.set(key, (this.#atlasDemandBytes.get(key) ?? 0) + count * bytesPerPage);
      this.#atlasMinimumSlots.set(key, (this.#atlasMinimumSlots.get(key) ?? 0) + (count > 0 ? 1 : 0));
      if (count === 0 && !this.#atlases.has(key)) continue;
      if (manifest.pageEncoding === "ktx2-etc2") {
        if (!compressedKeys.has(key)) compressedBytes += this.#atlases.get(key)?.allocationBytes ?? 32 * 1024 * 1024;
        compressedKeys.add(key);
      } else {
        poolRequests.set(key, { key,
          minimumBytes: Math.max(1, this.#atlasMinimumSlots.get(key)!) * bytesPerPage,
          wantedBytes: 2 ** Math.ceil(Math.log2(Math.max(1, this.#atlasDemand.get(key)!))) * bytesPerPage,
        });
      }
    }
    this.#atlasShares = allocateVirtualTexturePoolBytes([...poolRequests.values()],
      Math.max(0, Math.floor(this.#budget.budgetBytes * 0.75) - compressedBytes));
    for (const atlas of this.#atlases.values()) {
      const growth = this.#resizeAtlas(atlas, uploadsRemaining);
      uploadsRemaining -= growth.copied;
      pending ||= growth.pending;
      webGlStateChanged ||= growth.changed;
    }

    // Share each physical pool among its visible logical textures as well.
    // Otherwise an earlier texture can protect every slot from later arrivals.
    for (const atlas of this.#atlases.values()) {
      const resources = [...this.#resources.values()].filter((resource) =>
        resource.manifest !== undefined && resource.manifestFailure === undefined
          && virtualTextureAtlasKey(resource.asset, resource.manifest) === atlas.key);
      if (!resources.some((resource) => resource.demandNeedsFit || resource.admittedPageLimit === undefined
        || resource.demandRevision !== this.#viewRevision)) continue;
      const requests = resources.filter((resource) => (resource.desiredPageCount ?? 0) > 0).map((resource) => {
        const manifest = resource.manifest!;
        return { key: resource.key, minimumBytes: 1,
          wantedBytes: Math.min(resource.desiredPageCount!, manifest.physicalSlots ?? atlas.slotCount,
            manifest.physicalByteBudget === undefined ? atlas.slotCount
              : Math.floor(manifest.physicalByteBudget / (atlas.allocationBytes / atlas.slotCount))),
        };
      });
      const shares = allocateVirtualTexturePoolBytes(requests, atlas.slotCount);
      for (const resource of resources) {
        const limit = Math.max(1, shares.get(resource.key) ?? atlas.slotCount);
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
      if (this.#prepareFrameDemand(resource)) webGlStateChanged = true;
      if (resource.workspace.count > 0 && resource.gpu === undefined && resource.manifestFailure === undefined && !resource.allocationBudgetBlocked) pending = true;
    }
    for (const resource of this.#resources.values()) {
      const manifest = resource.manifest;
      if (
        manifest === undefined
        || resource.manifestFailure !== undefined
        || resource.workspace.count === 0
        || resource.gpu === undefined
        || resource.gpu.atlas.growth !== undefined
      ) continue;
      const gpu = resource.gpu;
      let settledPages = 0;
      while (uploadsRemaining > 0 && resource.readyPages.length > 0) {
        const ready = resource.readyPages[0]!;
        const slot = this.#pageSlot(resource, ready.pageKey);
        if ((gpu.residentSlots.has(ready.pageKey) && !this.#needsCoarseAuthority(resource, ready.pageKey)) || slot < 0) {
          // A read can lose its cell before completion. Release its pixels
          // so a full atlas cannot hold the global preparation queue.
          this.#settleReadyPage(resource);
          ready.decoded.close();
          settledPages += 1;
          continue;
        }
        const evicted = gpu.atlas.slots[slot];
        const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
        const pageByteLength = ready.decoded.kind === "etc2-rgba"
          ? ready.decoded.blocks.byteLength
          : storedPageSize * storedPageSize * 4;
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
        try {
          this.#uploadReadyPage(resource, ready, slot, evicted);
        } catch (error) {
          this.#settleReadyPage(resource);
          ready.decoded.close();
          this.#publishDirtyPageTables();
          throw error;
        }
        this.#settleReadyPage(resource);
        ready.decoded.close();
        uploadsRemaining -= 1;
        settledPages += 1;
        webGlStateChanged = true;
      }
      // Uploads are presented by this frame; publish progress without asking
      // the host to redraw the unchanged scene again next frame.
      if (settledPages > 0) this.#changed(resource, false);
      if (resource.readyPages.length > 0 && uploadsRemaining === 0) pending = true;
    }
    if (this.#publishDirtyPageTables()) webGlStateChanged = true;
    this.#schedulePageReads();
    return FRAME_RESULTS[(pending ? 1 : 0) | (webGlStateChanged ? 2 : 0)]!;
  }

  #refreshFrameDemand(
    resource: RuntimeResource,
    views: readonly SurfaceFrameView[],
  ): void {
    const manifest = resource.manifest;
    if (manifest === undefined || resource.manifestFailure !== undefined) return;
    const demandChanged = resource.demandRevision !== this.#viewRevision;
    if (demandChanged) {
      for (let minimumMip = 0; minimumMip < manifest.mipCount; minimumMip += 1) {
        resetVirtualTextureDemand(resource.workspace);
        collectVirtualTextureDemand(
          resource.workspace,
          manifest,
          resource.surfaces,
          views,
          resource.sampler,
          minimumMip,
        );
        if (!resource.workspace.overflow) break;
      }
      resource.demandRevision = this.#viewRevision;
      resource.desiredPageCount = resource.workspace.count;
      resource.demandNeedsFit = true;
      this.#cancelStalePageReads(resource);
    }
  }

  #prepareFrameDemand(
    resource: RuntimeResource,
  ): boolean {
    const manifest = resource.manifest;
    if (manifest === undefined || resource.manifestFailure !== undefined) return false;
    const demandChanged = resource.demandNeedsFit === true;
    // Do not reserve an atlas before the asset contributes to a view.
    if (resource.workspace.count === 0) {
      if (demandChanged) {
        resource.demandNeedsFit = false;
        this.#clearReadyPages(resource);
        resource.source?.setDemand?.([]);
      }
      return false;
    }
    let gpuCreated = false;
    if (resource.gpu === undefined) {
      const atlas = this.#atlases.get(virtualTextureAtlasKey(resource.asset, manifest));
      const pageBytes = (manifest.pageSize + manifest.borderTexels * 2) ** 2
        * (manifest.pageEncoding === "ktx2-etc2" ? 1 : 4);
      resource.allocationBudgetBlocked = this.#budget.availableBytes < manifest.tableByteLength + (atlas === undefined ? pageBytes : 0)
        || (atlas === undefined && manifest.pageEncoding !== "ktx2-etc2" && this.#atlasAllowance(undefined, virtualTextureAtlasKey(resource.asset, manifest)) < pageBytes);
      if (resource.allocationBudgetBlocked) return false;
      if (!this.#uploadBudget.tryAdmitAllocation()) {
        resource.demandRevision = -1;
        return false;
      }
      try {
        resource.gpu = this.#createGpuResource(resource, manifest);
        gpuCreated = true;
      } catch (error) {
        resource.manifestFailure = error instanceof Error ? error.message : String(error);
        resource.manifestFailureState = "unsupported";
        this.#changed(resource);
        // Allocation may have borrowed texture units before rolling back.
        return true;
      }
    }
    const gpu = resource.gpu;
    if (demandChanged) {
      resource.demandNeedsFit = false;
      truncateVirtualTextureDemand(resource.workspace, Math.min(gpu.maxResidentPages, resource.admittedPageLimit ?? Infinity));
      resource.source?.setDemand?.(Array.from({ length: resource.workspace.count }, (_, index) => ({
        mip: resource.workspace.mips[index]!, x: resource.workspace.xs[index]!, y: resource.workspace.ys[index]!,
      })));
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
      if (slot !== undefined) gpu.atlas.lastUsedFrames[slot] = this.#frame;
    }
    return gpuCreated;
  }

  #destroyResource(resource: RuntimeResource, deleteGpu: boolean): void {
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

  #scheduleShrink(delay: number): void {
    if (this.#shrinkTimer !== undefined) return;
    this.#shrinkTimer = setTimeout(() => {
      this.#shrinkTimer = undefined;
      if (this.#disposed) return;
      const resource = this.#resources.values().next().value;
      if (resource !== undefined) this.#changed(resource);
    }, delay);
  }

  #resizeAtlas(atlas: GpuVirtualTextureAtlas, copyLimit: number): { copied: number; pending: boolean; changed: boolean } {
    let copied = 0;
    let changed = false;
    const result = (pending: boolean) => ({ copied, pending, changed });
    // ETC2 cannot be a framebuffer copy destination. Its existing bounded
    // allocation policy remains independent from generated RGBA atlas growth.
    if (atlas.compressed) return result(false);
    const demand = this.#atlasDemand.get(atlas.key) ?? 0;
    const targetSlots = this.#targetAtlasSlots(atlas.key);
    const capacityLimited = demand > targetSlots && targetSlots < atlas.slotCount;
    const shrinking = capacityLimited || targetSlots <= atlas.slotCount / 2;
    let missingBytes = 0;
    let replacementBytes = 0;
    for (const [key, count] of this.#atlasDemand) {
      const other = this.#atlases.get(key);
      if (key === atlas.key || count <= (other?.slotCount ?? 0)) continue;
      const wantedBytes = this.#atlasDemandBytes.get(key)!;
      missingBytes += Math.max(0, wantedBytes - (other?.allocationBytes ?? 0));
      replacementBytes = Math.max(replacementBytes, wantedBytes);
    }
    const pressure = missingBytes > this.#atlasAllowance()
      || replacementBytes > this.#budget.availableBytes;
    if (!shrinking) delete atlas.shrinkAfter;
    if (atlas.growth !== undefined && (
      atlas.growth.retainedSlots === undefined ? targetSlots <= atlas.slotCount
        : (atlas.growth.capacityLimited ? targetSlots > atlas.growth.targetSlots : demand > atlas.growth.replacement.slotCount)
          || atlas.growth.retainedSlots.some((slot) => atlas.slots[slot] === undefined)
    )) {
      destroyGpuVirtualTextureAtlas(this.#gl, atlas.growth.replacement, this.#budget);
      delete atlas.growth;
      changed = true;
      return result(shrinking);
    }
    const fingerprint = `${demand}:${this.#budget.availableBytes}:${this.#atlasAllowance(atlas)}`;
    if (atlas.growth === undefined) {
      if ((!shrinking && targetSlots <= atlas.slotCount) || atlas.blockedGrowth === fingerprint) return result(false);
      if (shrinking && !pressure && !capacityLimited) {
        atlas.shrinkAfter ??= performance.now() + ATLAS_SHRINK_DELAY_MS;
        const delay = atlas.shrinkAfter - performance.now();
        if (delay > 0) {
          this.#scheduleShrink(delay);
          return result(false);
        }
      }
      const resource = Array.from(this.#resources.values()).find((value) => value.gpu?.atlas === atlas);
      if (resource === undefined) return result(false);
      let plan: VirtualTextureAtlasStoragePlan;
      try {
        // The old atlas remains fully charged until migration commits. The
        // replacement must fit real unclaimed budget as well as final allowance.
        const maxTextureSize = this.#textureSizeLimit();
        plan = planVirtualTextureAtlasStorage(resource.manifest!, maxTextureSize,
          this.#budget.availableBytes, targetSlots, this.#atlasAllowance(atlas), "migration");
        const rows = plan.slotCount / atlas.atlasColumns;
        if (Number.isInteger(rows) && rows <= 256 && rows * atlas.storedPageSize <= maxTextureSize) {
          plan = { ...plan, atlasColumns: atlas.atlasColumns, atlasRows: rows };
        }
      } catch {
        atlas.blockedGrowth = fingerprint;
        return result(false);
      }
      if (shrinking ? plan.slotCount < Math.max(1, capacityLimited ? this.#atlasMinimumSlots.get(atlas.key) ?? 1 : demand) || plan.slotCount >= atlas.slotCount
        : plan.slotCount <= atlas.slotCount) {
        atlas.blockedGrowth = fingerprint;
        return result(false);
      }
      if (!this.#uploadBudget.tryAdmitAllocation()) return result(true);
      changed = true;
      try {
        const replacement = createGpuVirtualTextureAtlas(this.#gl, resource.asset, resource.manifest!, this.#budget, atlas.key, plan, true);
        const retainedSlots = shrinking ? atlas.slots.flatMap((entry, slot) =>
          entry === undefined ? [] : [slot]).sort((a, b) => {
          const priority = (slot: number): number => {
            const entry = atlas.slots[slot]!;
            const owner = this.#resources.get(entry.resourceKey);
            const coarse = entry.pageKey === virtualTexturePageKeyParts(owner!.manifest!.mipCount - 1, 0, 0);
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
      } catch {
        this.#atlasGrowthFailures += 1;
        atlas.blockedGrowth = fingerprint;
        return result(false);
      }
    }
    const growth = atlas.growth;
    const replacement = growth.replacement;
    if (replacement.validationPending || replacement.validationFence !== undefined) {
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
        if (this.#gl.getError() !== this.#gl.NO_ERROR) throw new Error("Royal VT atlas allocation failed");
      } catch {
        destroyGpuVirtualTextureAtlas(this.#gl, replacement, this.#budget);
        delete atlas.growth;
        atlas.blockedGrowth = `${demand}:${this.#budget.availableBytes}:${this.#atlasAllowance(atlas)}`;
        this.#atlasGrowthFailures += 1;
        changed = true;
        return result(false);
      }
    }
    // A view can change while copies are pending. Restart a shrink if it would
    // discard a newly demanded resident page; the old binding is still intact.
    if (!growth.capacityLimited && growth.retainedSlots !== undefined && atlas.slots.some((entry, slot) =>
      entry !== undefined && this.#protectedPoolPages.has(entry.resourceKey, entry.pageKey)
        && !growth.retainedSlots!.includes(slot))) {
      destroyGpuVirtualTextureAtlas(this.#gl, replacement, this.#budget);
      delete atlas.growth;
      return { copied: 0, pending: true, changed: true };
    }
    const slots: number[] = [];
    const targets: number[] = [];
    const copyCount = growth.retainedSlots?.length ?? atlas.slotCount;
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
        // First use can trigger deferred texture initialization even after the
        // allocation fence signaled. Validate copies only after their fence.
        replacement.validationPending = true;
        this.#gl.flush();
        return result(true);
      }
    } catch {
      destroyGpuVirtualTextureAtlas(this.#gl, growth.replacement, this.#budget);
      delete atlas.growth;
      atlas.blockedGrowth = `${demand}:${this.#budget.availableBytes}:${this.#atlasAllowance(atlas)}`;
      this.#atlasGrowthFailures += 1;
      return result(false);
    }
    if (growth.nextSlot < copyCount) return result(true);
    const resources = Array.from(this.#resources.values()).filter((value) => value.gpu?.atlas === atlas);
    const layoutChanged = growth.retainedSlots !== undefined || replacement.atlasColumns !== atlas.atlasColumns;
    const tableBytes = layoutChanged ? resources.reduce((sum, resource) => sum + resource.manifest!.tableByteLength, 0) : 0;
    if (!this.#uploadBudget.tryAdmit(tableBytes)) return result(true);
    replacement.referenceCount = atlas.referenceCount;
    for (let slot = 0; slot < copyCount; slot += 1) {
      const sourceSlot = growth.retainedSlots?.[slot] ?? slot;
      replacement.slots[slot] = atlas.slots[sourceSlot];
      replacement.lastUsedFrames[slot] = atlas.lastUsedFrames[sourceSlot]!;
    }
    if (growth.retainedSlots !== undefined) {
      for (const resource of resources) resource.gpu!.residentSlots.clear();
      replacement.slots.forEach((entry, slot) => {
        if (entry !== undefined) this.#resources.get(entry.resourceKey)?.gpu?.residentSlots.set(entry.pageKey, slot);
      });
    }
    const maxTextureSize = this.#textureSizeLimit();
    for (const resource of resources) {
      const gpu = resource.gpu!;
      gpu.atlas = replacement;
      gpu.maxResidentPages = virtualTextureResidentPageCapacity(resource.manifest!,
        maxTextureSize, replacement);
      gpu.binding = {
        ...gpu.binding,
        atlas: { ...gpu.binding.atlas, texture: replacement.atlasTexture },
        settings1: new Float32Array([replacement.atlasColumns * replacement.storedPageSize,
          replacement.atlasRows * replacement.storedPageSize, resource.manifest!.tableWidth, resource.manifest!.tableHeight]),
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
    manifest: VirtualTextureManifest,
  ): GpuVirtualTexture {
    if (manifest.pageEncoding === "ktx2-etc2" && !this.#etc2Available) {
      throw new Error("Royal ETC2 KTX2 VT pages require WEBGL_compressed_texture_etc");
    }
    const atlasKey = virtualTextureAtlasKey(resource.asset, manifest);
    const maxTextureSize = this.#textureSizeLimit();
    let atlas = this.#atlases.get(atlasKey);
    const created = atlas === undefined;
    if (atlas === undefined) {
      const plan = planVirtualTextureAtlasStorage(
        manifest,
        maxTextureSize,
        this.#budget.availableBytes,
        manifest.pageEncoding === "ktx2-etc2" ? Infinity : this.#targetAtlasSlots(atlasKey),
        manifest.pageEncoding === "ktx2-etc2" ? undefined : this.#atlasAllowance(undefined, atlasKey),
      );
      atlas = createGpuVirtualTextureAtlas(
        this.#gl,
        resource.asset,
        manifest,
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
        manifest,
        this.#budget,
        atlas,
        maxTextureSize,
      );
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

  #changed(resource: RuntimeResource, presentationChanged = true): void {
    if (resource.authored) this.#onChanged(resource.asset as VirtualTextureAssetRef, presentationChanged);
    else this.#automatic.onChanged(presentationChanged);
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
    const stride = 20;
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
      if (this.#viewState[offset + 16] !== viewport.x) changed = true;
      if (this.#viewState[offset + 17] !== viewport.y) changed = true;
      if (this.#viewState[offset + 18] !== viewport.width) changed = true;
      if (this.#viewState[offset + 19] !== viewport.height) changed = true;
      this.#viewState[offset + 16] = viewport.x;
      this.#viewState[offset + 17] = viewport.y;
      this.#viewState[offset + 18] = viewport.width;
      this.#viewState[offset + 19] = viewport.height;
    }
    this.#viewCount = views.length;
    return changed;
  }

  #publicationAncestorReady(
    resource: RuntimeResource,
    mip: number,
    x: number,
    y: number,
  ): boolean {
    const manifest = resource.manifest!;
    if (!resource.authored && mip !== manifest.mipCount - 1) {
      return resource.gpu!.residentSlots.has(virtualTexturePageKeyParts(manifest.mipCount - 1, 0, 0));
    }
    for (let ancestorMip = mip + 1; ancestorMip < manifest.mipCount; ancestorMip += 1) {
      x = Math.floor(x / 2);
      y = Math.floor(y / 2);
      const key = virtualTexturePageKeyParts(ancestorMip, x, y);
      const authored = manifest.pageAddressing === "complete" || manifest.entries.has(key);
      if (!authored) continue;
      if (resource.gpu!.residentSlots.has(key)) return true;
      if (!resource.failedPages.has(key)) return false;
    }
    return true;
  }

  #schedulePageReads(): void {
    const resources = this.#scheduleResources;
    let idleVisits = 0;
    while (
      resources.length > 0
      && idleVisits < resources.length
      && this.#activeJobs + this.#readyPages < MAX_DECODE_JOBS
    ) {
      // Consume already-rasterized target regions before a cold read evicts
      // them. This is bounded by the same four decoded/ready page slots.
      if (this.#detailJobs === 0) {
        let cached = false;
        for (let offset = 0; offset < resources.length; offset += 1) {
          const index = (this.#scheduleCursor + offset) % resources.length;
          if (this.#startNextPageRead(resources[index]!, true)) {
            this.#scheduleCursor = index + 1;
            cached = true;
            break;
          }
        }
        if (cached) { idleVisits = 0; continue; }
      }
      if (this.#scheduleCursor >= resources.length) this.#scheduleCursor = 0;
      const resource = resources[this.#scheduleCursor]!;
      this.#scheduleCursor += 1;
      if (this.#startNextPageRead(resource)) idleVisits = 0;
      else idleVisits += 1;
    }
  }

  #pageSlot(resource: RuntimeResource, key: VirtualTexturePageKey): number {
    const gpu = resource.gpu!;
    if (this.#needsCoarseAuthority(resource, key)) return gpu.residentSlots.get(key)!;
    return selectVirtualTexturePoolSlot(
      resource.key,
      key,
      gpu.atlas.slots,
      gpu.atlas.lastUsedFrames,
      this.#protectedPoolPages,
    );
  }

  #needsCoarseAuthority(resource: RuntimeResource, key: VirtualTexturePageKey): boolean {
    const source = resource.lease?.source;
    return resource.gpu?.previewCoarse === true && (resource.workspace.coarsestTarget || resource.workspace.count === 1)
      && resource.gpu.residentSlots.has(key)
      && key === virtualTexturePageKeyParts(resource.manifest!.mipCount - 1, 0, 0)
      && !resource.previewSourceFailed
      && !(source !== undefined && automaticVirtualTextureHasPreview(source) && source.svgPreview.error !== undefined);
  }

  #startNextPageRead(resource: RuntimeResource, cachedOnly = false): boolean {
    const gpu = resource.gpu;
    if (gpu === undefined || resource.source === undefined) return false;
    if (gpu.atlas.growth !== undefined) return false;
    if (cachedOnly && resource.source.hasCachedPage === undefined) return false;
    const preview = resource.lease?.source;
    const svgPreview = preview !== undefined && automaticVirtualTextureHasPreview(preview)
      ? preview.svgPreview : undefined;
    const manifest = resource.manifest!;
    const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
    const byteLength = manifest.pageEncoding === "ktx2-etc2"
      ? Math.ceil(storedPageSize / 4) ** 2 * 16
      : storedPageSize ** 2 * 4;
    for (let index = 0; index < resource.workspace.count; index += 1) {
      const mip = resource.workspace.mips[index]!;
      const x = resource.workspace.xs[index]!;
      const y = resource.workspace.ys[index]!;
      if (cachedOnly && !resource.source.hasCachedPage!({ mip, x, y })) continue;
      const key = virtualTexturePageKeyParts(mip, x, y);
      if (
        (gpu.residentSlots.has(key) && !this.#needsCoarseAuthority(resource, key))
        || resource.loadingPages.has(key)
        || resource.readyPageKeys.has(key)
        || resource.failedPages.has(key)
        || !this.#publicationAncestorReady(resource, mip, x, y)
      ) continue;
      // Avoid preparing pages while every atlas cell is protected.
      if (this.#pageSlot(resource, key) < 0) continue;
      const usePreview = resource.source.readPreview !== undefined && mip === manifest.mipCount - 1
        && ((!resource.workspace.coarsestTarget && resource.workspace.count > 1) || svgPreview?.error !== undefined);
      if (!usePreview && svgPreview !== undefined && svgPreview.encoded === undefined
        && !(mip === manifest.mipCount - 1 && svgPreview.error !== undefined)) {
        // A failed vector source cannot prevent restoring retained preview pixels.
        if (svgPreview.error !== undefined) continue;
        if (!resource.previewSourcePending) {
          resource.previewSourcePending = true;
          // Transport must not occupy the sole rasterization slot. Validation
          // re-enters the root detail lane after bytes arrive.
          void svgPreview.load().catch(() => {
            if (!resource.abort.signal.aborted) resource.previewSourceFailed = true;
          }).finally(() => {
            resource.previewSourcePending = false;
            if (!resource.abort.signal.aborted && !this.#disposed) this.#changed(resource);
          });
        }
        return false;
      }
      if (!usePreview && (gpu.residentSlots.size > 0 || svgPreview !== undefined) && this.#detailJobs > 0) return false;
      if (byteLength > MAX_PENDING_PAGE_BYTES) {
        resource.failedPages.add(key);
        this.#changed(resource);
        continue;
      }
      if (this.#pendingPageBytes + byteLength > MAX_PENDING_PAGE_BYTES) return false;
      this.#startPageRead(resource, { mip, x, y }, key, byteLength, usePreview);
      return true;
    }
    return false;
  }

  async #openSource(resource: RuntimeResource): Promise<void> {
    try {
      const source = await this.#schedule(
        resource.abort.signal,
        () => openAuthoredVirtualTexturePageSource(
          (resource.asset as VirtualTextureAssetRef).manifestUri,
          resource.abort.signal,
        ),
      );
      if (resource.abort.signal.aborted || this.#disposed) return;
      resource.source = source;
      resource.manifest = source.manifest;
      resource.manifestPending = false;
      this.#changed(resource);
    } catch (error) {
      if (resource.abort.signal.aborted || this.#disposed) return;
      resource.manifestPending = false;
      resource.manifestFailure = error instanceof Error ? error.message : String(error);
      resource.manifestFailureState = "error";
      this.#changed(resource);
    }
  }

  #startPageRead(
    resource: RuntimeResource,
    page: VirtualTexturePageId,
    pageKey: VirtualTexturePageKey,
    byteLength: number,
    preview = false,
  ): void {
    const source = resource.source;
    if (source === undefined) {
      resource.failedPages.add(pageKey);
      this.#changed(resource);
      return;
    }
    const controller = new AbortController();
    // Ordinary texture fallback already presents the portable preview. Even
    // the first SVG-backed VT page belongs in the background detail lane.
    const retainedSource = resource.lease?.source;
    const detail = !preview && (resource.gpu!.residentSlots.size > 0
      || (retainedSource !== undefined && automaticVirtualTextureHasPreview(retainedSource)));
    if (detail) this.#detailJobs += 1;
    this.#pendingPageBytes += byteLength;
    let retained = false;
    resource.loadingPages.set(pageKey, controller);
    this.#activeJobs += 1;
    this.#pageRequests += 1;
    this.#changed(resource, false);
    void (detail ? this.#scheduleDetail : this.#schedule)(
      controller.signal,
      () => preview ? source.readPreview!(page, controller.signal) : source.read(page, controller.signal),
    ).then((decoded) => {
      const current = resource.loadingPages.get(pageKey) === controller;
      if (decoded === undefined) {
        if (
          !controller.signal.aborted
          && current
          && !resource.abort.signal.aborted
          && resource.workspace.keys.has(pageKey)
        ) resource.failedPages.add(pageKey);
      } else if (
        controller.signal.aborted
        || !current
        || resource.abort.signal.aborted
        || this.#disposed
        || !resource.workspace.keys.has(pageKey)
      ) decoded.close();
      else {
        resource.readyPageKeys.add(pageKey);
        resource.readyPages.push({ byteLength, decoded, page, pageKey, preview });
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
        this.#changed(resource, retained);
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
    if (ready.decoded.kind === "etc2-rgba") {
      const expectedColorSpace = resource.asset.colorSpace ?? resource.manifest!.colorSpace;
      if (!atlas.compressed || ready.decoded.colorSpace !== expectedColorSpace) {
        throw new TypeError("Royal VT KTX2 page storage does not match its manifest color space");
      }
      gl.compressedTexSubImage2D(
        gl.TEXTURE_2D,
        0,
        slotX * storedPageSize,
        slotY * storedPageSize,
        storedPageSize,
        storedPageSize,
        etc2RgbaWebGlFormat(expectedColorSpace),
        ready.decoded.blocks,
      );
    } else {
      if (atlas.compressed) throw new TypeError("Royal VT compressed atlas received an image page");
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        slotX * storedPageSize,
        slotY * storedPageSize,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        ready.decoded.source,
      );
    }
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
        const lostCoverage = !evictedResource.authored
          && evicted.pageKey === virtualTexturePageKeyParts(evictedResource.manifest!.mipCount - 1, 0, 0);
        if ((hadOneResident || lostCoverage) && evictedResource !== resource) this.#bindingRevision += 1;
        if (evictedResource !== resource) this.#changed(evictedResource, false);
      }
    }
    atlas.slots[slot] = { pageKey: ready.pageKey, resourceKey: resource.key };
    atlas.lastUsedFrames[slot] = this.#frame;
    gpu.residentSlots.set(ready.pageKey, slot);
    if (ready.pageKey === virtualTexturePageKeyParts(resource.manifest!.mipCount - 1, 0, 0)) {
      gpu.previewCoarse = ready.preview;
      if (!resource.authored) this.#bindingRevision += 1;
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
    const manifest = resource.manifest!;
    if (gpu.pageTableRebuild) {
      writeVirtualTexturePageTable(manifest, gpu.residentSlots, gpu.atlas.atlasColumns, gpu.pageTableBytes);
    } else {
      for (const page of gpu.pageTableAdditions) {
        const slot = gpu.residentSlots.get(virtualTexturePageKeyParts(page.mip, page.x, page.y));
        if (slot !== undefined) addVirtualTexturePageTablePage(manifest, page, slot, gpu.atlas.atlasColumns, gpu.pageTableBytes);
      }
    }
    gpu.pageTableRebuild = false;
    gpu.pageTableAdditions.length = 0;
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, gpu.pageTableTexture);
    for (let mip = 0; mip < manifest.mipCount; mip += 1) {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        mip,
        0,
        0,
        Math.max(1, manifest.tableWidth / 2 ** mip),
        Math.max(1, manifest.tableHeight / 2 ** mip),
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        gpu.pageTableLevels[mip]!,
      );
    }
  }
}

export const createBrowserVirtualTextureRuntime = (
  gl: WebGL2RenderingContext,
  onChanged: (asset: VirtualTextureAssetRef, presentationChanged: boolean) => void,
  budget = new PersistentGpuBudgetOwner(),
  schedule: AsyncPreparationScheduler = prepareDirectly,
  automatic: AutomaticVirtualTextureRuntimeOptions = {
    acquireDecoded: () => undefined,
    decoded: () => undefined,
    onChanged: () => undefined,
  },
  uploadBudget = new FrameUploadBudgetOwner(),
  etc2Available = true,
  scheduleDetail: AsyncPreparationScheduler = schedule,
): VirtualTextureRuntime => new BrowserVirtualTextureRuntime(
  gl,
  onChanged,
  budget,
  schedule,
  automatic,
  uploadBudget,
  etc2Available,
  scheduleDetail,
);
