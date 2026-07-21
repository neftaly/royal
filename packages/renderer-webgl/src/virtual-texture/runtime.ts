import type { VirtualTextureAssetRef } from "@royal/renderer-core";
import { IDENTITY_TEXTURE_COORDINATES } from "../gltf/texture-coordinates";
import {
  canonicalTextureSampler,
  type CanonicalTextureSampler,
} from "../surface/canonical-material";
import type { CanonicalSurfaceScene } from "../surface/scene-lowering";
import type { SurfaceFrameView } from "../surface/surface-gpu-owner";
import { etc2RgbaWebGlFormat } from "../texture/etc2-storage";
import {
  openAuthoredVirtualTexturePageSource,
  type DecodedVirtualTexturePage,
  type VirtualTexturePageSource,
} from "./browser-page-source";
import {
  automaticVirtualTextureEligible,
  automaticVirtualTextureIsSvg,
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
  DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS,
  virtualTexturePageKeyParts,
  type VirtualTextureManifest,
  type VirtualTexturePageId,
} from "./manifest";
import {
  selectVirtualTexturePoolSlot,
  virtualTexturePageTableByteLength,
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
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import type { AsyncPreparationScheduler } from "../resource/async-preparation-owner";
import type {
  DecodedTextureSource,
  DecodedTextureLease,
  TextureSourceRef,
} from "../texture/asset-owner";
import { FrameUploadBudgetOwner } from "../resource/frame-upload-budget";

const DEFAULT_PHYSICAL_BYTES = 32 * 1024 * 1024;
const MAX_DECODE_JOBS = 4;
const MAX_UPLOADS_PER_FRAME = 4;
const MAX_DEMAND_PAGES = 512;
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
  decoded: DecodedVirtualTexturePage;
  pageKey: VirtualTexturePageKey;
}>;

type GpuVirtualTextureAtlas = {
  allocationBytes: number;
  atlasColumns: number;
  atlasRows: number;
  atlasTexture: WebGLTexture;
  budgetIdentity: object;
  compressed: boolean;
  key: string;
  lastUsedFrames: Uint32Array;
  referenceCount: number;
  slots: (VirtualTexturePoolSlot | undefined)[];
  storedPageSize: number;
};

type GpuVirtualTexture = {
  atlas: GpuVirtualTextureAtlas;
  atlasSampler: WebGLSampler;
  budgetIdentity: object;
  binding: VirtualTextureGpuBinding;
  maxResidentPages: number;
  pageTableDirty: boolean;
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
  readonly sampler: CanonicalTextureSampler;
  snapshot: VirtualTextureAssetSnapshot | undefined;
  source?: VirtualTexturePageSource;
  readonly surfaces: VirtualTextureDemandSurface[];
  readonly workspace: VirtualTextureDemandWorkspace;
};

export type AutomaticVirtualTextureRuntimeOptions = Readonly<{
  acquireDecoded(asset: TextureSourceRef): DecodedTextureLease | undefined;
  decoded(asset: TextureSourceRef): DecodedTextureSource | undefined;
  onChanged(): void;
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
  physicalByteLimit: number,
): GpuVirtualTextureAtlas => {
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (!Number.isSafeInteger(maxTextureSize) || maxTextureSize < 1) {
    throw new RangeError("Royal VT received an invalid WebGL2 texture limit");
  }
  const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
  const maximumAxisSlots = Math.min(256, Math.floor(maxTextureSize / storedPageSize));
  const compressed = manifest.pageEncoding === "ktx2-etc2";
  const bytesPerPage = storedPageSize * storedPageSize * (compressed ? 1 : 4);
  const slotCount = Math.min(
    Math.floor(physicalByteLimit / bytesPerPage),
    maximumAxisSlots * maximumAxisSlots,
  );
  if (slotCount < 1) throw new RangeError("Royal VT budget cannot hold one physical page");
  const atlasColumns = Math.min(maximumAxisSlots, Math.ceil(Math.sqrt(slotCount)));
  const atlasRows = Math.ceil(slotCount / atlasColumns);
  const allocationBytes = atlasColumns * atlasRows * bytesPerPage;
  const budgetIdentity = {};
  let atlasTexture: WebGLTexture | null = null;
  try {
    atlasTexture = allocateTexture(gl, "atlas texture");
    if (!budget.tryClaim(budgetIdentity, allocationBytes)) {
      throw new Error("Royal persistent GPU budget denied virtual texture storage");
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    const colorSpace = asset.colorSpace ?? manifest.colorSpace;
    gl.texStorage2D(
      gl.TEXTURE_2D,
      1,
      compressed
        ? etc2RgbaWebGlFormat(colorSpace)
        : colorSpace === "srgb" ? gl.SRGB8_ALPHA8 : gl.RGBA8,
      atlasColumns * storedPageSize,
      atlasRows * storedPageSize,
    );
    return {
      allocationBytes,
      atlasColumns,
      atlasRows,
      atlasTexture,
      budgetIdentity,
      compressed,
      key,
      lastUsedFrames: new Uint32Array(slotCount),
      referenceCount: 0,
      slots: Array<VirtualTexturePoolSlot | undefined>(slotCount),
      storedPageSize,
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
): GpuVirtualTexture => {
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (
    manifest.tableWidth > maxTextureSize
    || manifest.tableHeight > maxTextureSize
  ) throw new RangeError("Royal VT page table exceeds this WebGL2 context's texture limit");
  const bytesPerPage = atlas.storedPageSize * atlas.storedPageSize * (atlas.compressed ? 1 : 4);
  const byteSlots = Math.floor((manifest.physicalByteBudget ?? Infinity) / bytesPerPage);
  const maxResidentPages = Math.min(
    manifest.physicalSlots ?? DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS,
    byteSlots,
    atlas.slots.length,
  );
  if (maxResidentPages < 1) throw new RangeError("Royal VT budget cannot hold one physical page");
  const budgetIdentity = {};
  let budgetClaimed = false;
  let atlasSampler: WebGLSampler | null = null;
  let pageTableTexture: WebGLTexture | null = null;
  let pageTableSampler: WebGLSampler | null = null;
  try {
    atlasSampler = allocateSampler(gl, "atlas sampler");
    pageTableTexture = allocateTexture(gl, "page-table texture");
    pageTableSampler = allocateSampler(gl, "page-table sampler");
    if (!budget.tryClaim(budgetIdentity, virtualTexturePageTableByteLength(manifest))) {
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
    const pageTableBytes = new Uint8Array(virtualTexturePageTableByteLength(manifest));
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
  gl.deleteTexture(atlas.atlasTexture);
  budget.release(atlas.budgetIdentity);
};

class BrowserVirtualTextureRuntime implements VirtualTextureRuntime {
  #activeJobs = 0;
  #automaticCandidates = 0;
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
  readonly #etc2Available: boolean;
  readonly #atlases = new Map<string, GpuVirtualTextureAtlas>();
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #automatic: AutomaticVirtualTextureRuntimeOptions | undefined;
  readonly #onChanged: (asset: VirtualTextureAssetRef) => void;
  readonly #schedule: AsyncPreparationScheduler;
  readonly #uploadBudget: FrameUploadBudgetOwner;
  readonly #resources = new Map<string, RuntimeResource>();
  readonly #protectedPoolPages = {
    has: (resourceKey: string, pageKey: VirtualTexturePageKey): boolean =>
      this.#resources.get(resourceKey)?.workspace.keys.has(pageKey) === true,
  };
  readonly #assetKeys = new WeakMap<VirtualTextureAssetRef, string>();
  #scene: CanonicalSurfaceScene | null = null;
  readonly shaderSource = { declarations: VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS };

  constructor(
    gl: WebGL2RenderingContext,
    onChanged: (asset: VirtualTextureAssetRef) => void,
    budget: PersistentGpuBudgetOwner,
    schedule: AsyncPreparationScheduler,
    automatic: AutomaticVirtualTextureRuntimeOptions | undefined,
    uploadBudget: FrameUploadBudgetOwner,
    etc2Available: boolean,
  ) {
    this.#gl = gl;
    this.#onChanged = onChanged;
    this.#budget = budget;
    this.#schedule = schedule;
    this.#automatic = automatic;
    this.#uploadBudget = uploadBudget;
    this.#etc2Available = etc2Available;
  }

  get bindingRevision(): number {
    return this.#bindingRevision;
  }

  binding(asset: VirtualTextureAssetRef): VirtualTextureGpuBinding | undefined {
    const resource = this.#resources.get(this.#keyForAsset(asset));
    return resource?.gpu !== undefined && resource.gpu.residentSlots.size > 0
      ? resource.gpu.binding
      : undefined;
  }

  automaticBinding(asset: TextureSourceRef): VirtualTextureGpuBinding | undefined {
    const resource = this.#resources.get(automaticVirtualTextureAssetKey(asset));
    return resource?.gpu !== undefined && resource.gpu.residentSlots.size > 0
      ? resource.gpu.binding
      : undefined;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const resource of this.#resources.values()) this.#destroyResource(resource, true);
    this.#resources.clear();
    this.#scheduleResources.length = 0;
    this.#scheduleCursor = 0;
    this.#scene = null;
  }

  invalidate(): void {
    for (const resource of this.#resources.values()) {
      if (resource.gpu !== undefined) {
        this.#budget.release(resource.gpu.budgetIdentity);
        resource.gpu = undefined;
        this.#bindingRevision += 1;
      }
      this.#clearReadyPages(resource);
    }
    for (const atlas of this.#atlases.values()) this.#budget.release(atlas.budgetIdentity);
    this.#atlases.clear();
  }

  runtimeSnapshot(): VirtualTextureRuntimeSnapshot {
    const uploads = this.#uploadBudget.snapshot();
    let atlasBytes = 0;
    for (const atlas of this.#atlases.values()) atlasBytes += atlas.allocationBytes;
    let automaticDecodedBytes = 0;
    let automaticResources = 0;
    let failedPages = 0;
    let pendingPages = 0;
    let residentPages = 0;
    for (const resource of this.#resources.values()) {
      if (!resource.authored) {
        automaticResources += 1;
        if (resource.lease !== undefined) {
          automaticDecodedBytes += resource.lease.source.width
            * resource.lease.source.height * 4;
        }
      }
      failedPages += resource.failedPages.size;
      pendingPages += resource.loadingPages.size + resource.readyPages.length;
      residentPages += resource.gpu?.residentSlots.size ?? 0;
    }
    return {
      admittedUploadBytes: uploads.admittedBytes,
      atlasBytes,
      atlasPools: this.#atlases.size,
      automaticCandidates: this.#automaticCandidates,
      automaticDecodedBytes,
      automaticEnabled: this.#automatic !== undefined,
      automaticIneligible: this.#automaticIneligible,
      automaticResources,
      automaticWaiting: this.#automaticWaiting,
      deferredUploads: uploads.deferredUploads,
      failedPages,
      pageRequests: this.#pageRequests,
      pendingPages,
      residentPages,
      uploadedPages: this.#uploadedPages,
      uploadBudgetBytes: uploads.budgetBytes,
    };
  }

  snapshot(asset: VirtualTextureAssetRef): VirtualTextureAssetSnapshot {
    const resource = this.#resources.get(this.#keyForAsset(asset));
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
      this.#assetKeys.set(asset, key);
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
    if (this.#automatic !== undefined) {
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
        const svg = automaticVirtualTextureIsSvg(asset);
        if (
          decoded.kind === "ktx2-etc2"
          || (!svg && !automaticVirtualTextureEligible(decoded))
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
            asset.src,
            decoded.width,
            decoded.height,
            sampler,
            asset.colorSpace ?? "srgb",
          );
        } else {
          lease = this.#automatic.acquireDecoded(asset);
          if (lease === undefined) {
            this.#automaticWaiting += 1;
            continue;
          }
          if (!automaticVirtualTextureEligible(lease.source)) {
            lease.release();
            this.#automaticIneligible += 1;
            continue;
          }
          retainedDecodedBytes += lease.source.width * lease.source.height * 4;
          source = createAutomaticRasterPageSource(
            lease.source,
            sampler,
            asset.colorSpace ?? "srgb",
          );
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
          workspace: createVirtualTextureDemandWorkspace(MAX_DEMAND_PAGES),
        });
      }
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
        ? this.#resources.get(this.#keyForAsset(authoredAsset))
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

  update(views: readonly SurfaceFrameView[]): VirtualTextureFrameUpdate {
    if (this.#disposed) return FRAME_RESULTS[0]!;
    this.#uploadBudget.beginFrame();
    this.#frame += 1;
    let pending = false;
    let webGlStateChanged = false;
    let uploadsRemaining = MAX_UPLOADS_PER_FRAME;
    if (this.#demandViewsChanged(views)) this.#viewRevision += 1;

    // Resolve every resource's current demand before consulting the shared
    // atlas protection set. Admission must never depend on Map insertion order
    // or another resource's previous-frame visibility.
    for (const resource of this.#resources.values()) {
      if (this.#prepareFrameDemand(resource, views)) webGlStateChanged = true;
    }
    for (const resource of this.#resources.values()) {
      const manifest = resource.manifest;
      if (
        manifest === undefined
        || resource.manifestFailure !== undefined
        || resource.workspace.count === 0
        || resource.gpu === undefined
      ) continue;
      const gpu = resource.gpu;
      let settledPages = 0;
      while (uploadsRemaining > 0 && resource.readyPages.length > 0) {
        const ready = resource.readyPages[0]!;
        if (gpu.residentSlots.has(ready.pageKey)) {
          this.#settleReadyPage(resource);
          ready.decoded.close();
          settledPages += 1;
          continue;
        }
        const slot = selectVirtualTexturePoolSlot(
          resource.key,
          ready.pageKey,
          gpu.atlas.slots,
          gpu.atlas.lastUsedFrames,
          this.#protectedPoolPages,
        );
        if (slot < 0) break;
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
      if (settledPages > 0) this.#changed(resource);
      if (resource.readyPages.length > 0 && uploadsRemaining === 0) pending = true;
    }
    if (this.#publishDirtyPageTables()) webGlStateChanged = true;
    this.#schedulePageReads();
    return FRAME_RESULTS[(pending ? 1 : 0) | (webGlStateChanged ? 2 : 0)]!;
  }

  #prepareFrameDemand(
    resource: RuntimeResource,
    views: readonly SurfaceFrameView[],
  ): boolean {
    const manifest = resource.manifest;
    if (manifest === undefined || resource.manifestFailure !== undefined) return false;
    const demandChanged = resource.demandRevision !== this.#viewRevision;
    if (demandChanged) {
      resetVirtualTextureDemand(resource.workspace);
      collectVirtualTextureDemand(
        resource.workspace,
        manifest,
        resource.surfaces,
        views,
        resource.sampler,
      );
      resource.demandRevision = this.#viewRevision;
      this.#cancelStalePageReads(resource);
    }
    // Do not reserve an atlas before the asset contributes to a view.
    if (resource.workspace.count === 0) {
      if (demandChanged) this.#clearReadyPages(resource);
      return false;
    }
    let gpuCreated = false;
    if (resource.gpu === undefined) {
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
      truncateVirtualTextureDemand(resource.workspace, gpu.maxResidentPages);
      this.#cancelStalePageReads(resource);
      let retainedReadyPages = 0;
      for (let index = 0; index < resource.readyPages.length; index += 1) {
        const ready = resource.readyPages[index]!;
        if (!resource.workspace.keys.has(ready.pageKey)) {
          ready.decoded.close();
          resource.readyPageKeys.delete(ready.pageKey);
          this.#readyPages -= 1;
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

  #createGpuResource(
    resource: RuntimeResource,
    manifest: VirtualTextureManifest,
  ): GpuVirtualTexture {
    if (manifest.pageEncoding === "ktx2-etc2" && !this.#etc2Available) {
      throw new Error("Royal ETC2 KTX2 VT pages require WEBGL_compressed_texture_etc");
    }
    const atlasKey = virtualTextureAtlasKey(resource.asset, manifest);
    let atlas = this.#atlases.get(atlasKey);
    const created = atlas === undefined;
    if (atlas === undefined) {
      const remainingBytes = this.#budget.availableBytes;
      const pageTableBytes = virtualTexturePageTableByteLength(manifest);
      const availableAtlasBytes = Math.max(0, remainingBytes - pageTableBytes);
      const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
      const bytesPerPage = storedPageSize * storedPageSize
        * (manifest.pageEncoding === "ktx2-etc2" ? 1 : 4);
      const targetAtlasBytes = Math.min(
        DEFAULT_PHYSICAL_BYTES,
        bytesPerPage * DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS,
      );
      const atlasByteLimit = Math.min(
        targetAtlasBytes,
        availableAtlasBytes,
        Math.max(bytesPerPage, Math.floor(availableAtlasBytes * 0.75)),
      );
      atlas = createGpuVirtualTextureAtlas(
        this.#gl,
        resource.asset,
        manifest,
        this.#budget,
        atlasKey,
        atlasByteLimit,
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

  #changed(resource: RuntimeResource): void {
    if (resource.authored) this.#onChanged(resource.asset as VirtualTextureAssetRef);
    else this.#automatic?.onChanged();
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

  #keyForAsset(asset: VirtualTextureAssetRef): string {
    const retained = this.#assetKeys.get(asset);
    if (retained !== undefined) return retained;
    const key = virtualTextureAssetKey(asset);
    this.#assetKeys.set(asset, key);
    return key;
  }

  #publicationAncestorReady(
    resource: RuntimeResource,
    mip: number,
    x: number,
    y: number,
  ): boolean {
    const manifest = resource.manifest!;
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
      if (this.#scheduleCursor >= resources.length) this.#scheduleCursor = 0;
      const resource = resources[this.#scheduleCursor]!;
      this.#scheduleCursor += 1;
      if (this.#startNextPageRead(resource)) idleVisits = 0;
      else idleVisits += 1;
    }
  }

  #startNextPageRead(resource: RuntimeResource): boolean {
    const gpu = resource.gpu;
    if (gpu === undefined || resource.source === undefined) return false;
    for (let index = 0; index < resource.workspace.count; index += 1) {
      const mip = resource.workspace.mips[index]!;
      const x = resource.workspace.xs[index]!;
      const y = resource.workspace.ys[index]!;
      const key = virtualTexturePageKeyParts(mip, x, y);
      if (
        gpu.residentSlots.has(key)
        || resource.loadingPages.has(key)
        || resource.readyPageKeys.has(key)
        || resource.failedPages.has(key)
        || !this.#publicationAncestorReady(resource, mip, x, y)
      ) continue;
      this.#startPageRead(resource, { mip, x, y }, key);
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
  ): void {
    const source = resource.source;
    if (source === undefined) {
      resource.failedPages.add(pageKey);
      this.#changed(resource);
      return;
    }
    const controller = new AbortController();
    resource.loadingPages.set(pageKey, controller);
    this.#activeJobs += 1;
    this.#pageRequests += 1;
    this.#changed(resource);
    void this.#schedule(
      controller.signal,
      () => source.read(page, controller.signal),
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
        resource.readyPages.push({ decoded, pageKey });
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
      if (!resource.abort.signal.aborted && !this.#disposed) this.#changed(resource);
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
        if (hadOneResident && evictedResource !== resource) this.#bindingRevision += 1;
        if (evictedResource !== resource) this.#changed(evictedResource);
      }
    }
    atlas.slots[slot] = { pageKey: ready.pageKey, resourceKey: resource.key };
    atlas.lastUsedFrames[slot] = this.#frame;
    gpu.residentSlots.set(ready.pageKey, slot);
    gpu.pageTableDirty = true;
    this.#uploadedPages += 1;
    if (firstResident) this.#bindingRevision += 1;
  }

  #clearReadyPages(resource: RuntimeResource): void {
    for (const ready of resource.readyPages) ready.decoded.close();
    this.#readyPages -= resource.readyPages.length;
    resource.readyPageKeys.clear();
    resource.readyPages.length = 0;
  }

  #settleReadyPage(resource: RuntimeResource): void {
    const ready = resource.readyPages.shift()!;
    resource.readyPageKeys.delete(ready.pageKey);
    this.#readyPages -= 1;
  }

  #publishPageTable(resource: RuntimeResource): void {
    const gpu = resource.gpu!;
    const manifest = resource.manifest!;
    writeVirtualTexturePageTable(
      manifest,
      gpu.residentSlots,
      gpu.atlas.atlasColumns,
      gpu.pageTableBytes,
    );
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
  onChanged: (asset: VirtualTextureAssetRef) => void,
  budget = new PersistentGpuBudgetOwner(),
  schedule: AsyncPreparationScheduler = prepareDirectly,
  automatic?: AutomaticVirtualTextureRuntimeOptions,
  uploadBudget = new FrameUploadBudgetOwner(),
  etc2Available = true,
): VirtualTextureRuntime => new BrowserVirtualTextureRuntime(
  gl,
  onChanged,
  budget,
  schedule,
  automatic,
  uploadBudget,
  etc2Available,
);
