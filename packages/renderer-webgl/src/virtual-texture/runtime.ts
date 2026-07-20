import type { VirtualTextureAssetRef } from "@royal/renderer-core";
import { IDENTITY_TEXTURE_COORDINATES } from "../gltf/texture-coordinates";
import {
  canonicalTextureSampler,
  type CanonicalTextureSampler,
} from "../surface/canonical-material";
import type { CanonicalSurfaceScene } from "../surface/scene-lowering";
import type { SurfaceFrameView } from "../surface/surface-gpu-owner";
import {
  ETC2_RGBA8_WEBGL_FORMAT,
  ETC2_SRGB8_ALPHA8_WEBGL_FORMAT,
} from "../texture/etc2-storage";
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
  planVirtualTextureAdmission,
  virtualTexturePageTableByteLength,
  writeVirtualTexturePageTable,
  type VirtualTexturePageKey,
  type VirtualTextureAdmissionPlan,
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
const MAX_SHADER_MIPS = 16;
const MAX_AUTOMATIC_DECODED_BYTES = 64 * 1024 * 1024;
const IDLE_VIRTUAL_TEXTURE_SNAPSHOT: VirtualTextureAssetSnapshot = {
  failedPages: 0,
  pendingPages: 0,
  residentPages: 0,
  state: "idle",
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
  page: VirtualTexturePageId;
  pageKey: VirtualTexturePageKey;
}>;

type GpuVirtualTexture = Readonly<{
  atlasColumns: number;
  atlasRows: number;
  atlasSampler: WebGLSampler;
  atlasTexture: WebGLTexture;
  budgetIdentity: object;
  binding: VirtualTextureGpuBinding;
  compressed: boolean;
  lastUsedFrames: Uint32Array;
  pageTableBytes: Uint8Array;
  pageTableSampler: WebGLSampler;
  pageTableTexture: WebGLTexture;
  residentSlots: Map<VirtualTexturePageKey, number>;
  slotKeys: (VirtualTexturePageKey | undefined)[];
}>;

type RuntimeResource = {
  readonly abort: AbortController;
  readonly asset: TextureSourceRef | VirtualTextureAssetRef;
  readonly authored: boolean;
  readonly failedPages: Set<VirtualTexturePageKey>;
  gpu: GpuVirtualTexture | undefined;
  readonly key: string;
  readonly loadingPages: Set<VirtualTexturePageKey>;
  readonly lease?: DecodedTextureLease;
  manifest?: VirtualTextureManifest;
  manifestFailure?: string;
  manifestFailureState?: "error" | "unsupported";
  manifestPending: boolean;
  readonly readyPages: ReadyPage[];
  readonly sampler: CanonicalTextureSampler;
  snapshot: VirtualTextureAssetSnapshot | undefined;
  source?: VirtualTexturePageSource;
  readonly surfaces: VirtualTextureDemandSurface[];
  viewCount: number;
  viewState: Float64Array;
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

const createGpuVirtualTexture = (
  gl: WebGL2RenderingContext,
  asset: Pick<TextureSourceRef | VirtualTextureAssetRef, "colorSpace" | "sampler">,
  manifest: VirtualTextureManifest,
  budget: PersistentGpuBudgetOwner,
): GpuVirtualTexture => {
  if (manifest.mipCount > MAX_SHADER_MIPS) {
    throw new RangeError(`Royal VT currently supports at most ${MAX_SHADER_MIPS} mip levels`);
  }
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (
    !Number.isSafeInteger(maxTextureSize)
    || maxTextureSize < 1
    || manifest.tableWidth > maxTextureSize
    || manifest.tableHeight > maxTextureSize
  ) throw new RangeError("Royal VT page table exceeds this WebGL2 context's texture limit");
  const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
  const maximumAxisSlots = Math.min(256, Math.floor(maxTextureSize / storedPageSize));
  const byteBudget = Math.min(manifest.physicalByteBudget ?? Infinity, DEFAULT_PHYSICAL_BYTES);
  const compressed = manifest.pageEncoding === "ktx2-etc2";
  const bytesPerPage = storedPageSize * storedPageSize * (compressed ? 1 : 4);
  const byteSlots = Math.floor(byteBudget / bytesPerPage);
  const requestedSlots = Math.min(
    manifest.physicalSlots ?? DEFAULT_VIRTUAL_TEXTURE_PHYSICAL_SLOTS,
    byteSlots,
  );
  const slotCount = Math.min(requestedSlots, maximumAxisSlots * maximumAxisSlots);
  if (slotCount < 1) throw new RangeError("Royal VT budget cannot hold one physical page");
  const atlasColumns = Math.min(maximumAxisSlots, Math.ceil(Math.sqrt(slotCount)));
  const atlasRows = Math.ceil(slotCount / atlasColumns);
  const allocationBytes = atlasColumns * atlasRows * bytesPerPage
    + virtualTexturePageTableByteLength(manifest);
  const budgetIdentity = {};
  let budgetClaimed = false;
  let atlasTexture: WebGLTexture | null = null;
  let pageTableTexture: WebGLTexture | null = null;
  let atlasSampler: WebGLSampler | null = null;
  let pageTableSampler: WebGLSampler | null = null;
  try {
    atlasTexture = allocateTexture(gl, "atlas texture");
    pageTableTexture = allocateTexture(gl, "page-table texture");
    atlasSampler = allocateSampler(gl, "atlas sampler");
    pageTableSampler = allocateSampler(gl, "page-table sampler");
    if (!budget.tryClaim(budgetIdentity, allocationBytes)) {
      throw new Error("Royal persistent GPU budget denied virtual texture storage");
    }
    budgetClaimed = true;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      1,
      compressed
        ? (asset.colorSpace ?? manifest.colorSpace) === "srgb"
          ? ETC2_SRGB8_ALPHA8_WEBGL_FORMAT
          : ETC2_RGBA8_WEBGL_FORMAT
        : (asset.colorSpace ?? manifest.colorSpace) === "srgb" ? gl.SRGB8_ALPHA8 : gl.RGBA8,
      atlasColumns * storedPageSize,
      atlasRows * storedPageSize,
    );
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
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, pageTableTexture);
    gl.texStorage2D(
      gl.TEXTURE_2D,
      1,
      gl.RGBA8,
      manifest.tableWidth,
      manifest.tableHeight,
    );
    gl.samplerParameteri(pageTableSampler, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.samplerParameteri(pageTableSampler, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.samplerParameteri(pageTableSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(pageTableSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const mipOffsets = new Float32Array(MAX_SHADER_MIPS);
    for (let mip = 0; mip < manifest.mipCount; mip += 1) {
      mipOffsets[mip] = manifest.mipLayouts[mip]!.tableY;
    }
    return {
      atlasColumns,
      atlasRows,
      atlasSampler,
      atlasTexture,
      budgetIdentity,
      binding: {
        atlas: { sampler: atlasSampler, target: "2d", texture: atlasTexture },
        mipOffsets,
        pageTable: { sampler: pageTableSampler, target: "2d", texture: pageTableTexture },
        settings0: new Float32Array([
          manifest.width,
          manifest.height,
          manifest.pageSize,
          manifest.borderTexels,
        ]),
        settings1: new Float32Array([
          atlasColumns * storedPageSize,
          atlasRows * storedPageSize,
          manifest.tableWidth,
          manifest.tableHeight,
        ]),
        settings2: new Float32Array([
          manifest.mipCount,
          wrapCode(asset.sampler?.wrapS),
          wrapCode(asset.sampler?.wrapT),
          storedPageSize,
        ]),
      },
      compressed,
      lastUsedFrames: new Uint32Array(slotCount),
      pageTableBytes,
      pageTableSampler,
      pageTableTexture,
      residentSlots: new Map(),
      slotKeys: Array<VirtualTexturePageKey | undefined>(slotCount),
    };
  } catch (error) {
    if (atlasSampler !== null) gl.deleteSampler(atlasSampler);
    if (pageTableSampler !== null) gl.deleteSampler(pageTableSampler);
    if (atlasTexture !== null) gl.deleteTexture(atlasTexture);
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
  gl.deleteTexture(gpu.atlasTexture);
  gl.deleteTexture(gpu.pageTableTexture);
  budget.release(gpu.budgetIdentity);
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
  #uploadedPages = 0;
  readonly #gl: WebGL2RenderingContext;
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #automatic: AutomaticVirtualTextureRuntimeOptions | undefined;
  readonly #onChanged: (asset: VirtualTextureAssetRef) => void;
  readonly #schedule: AsyncPreparationScheduler;
  readonly #uploadBudget: FrameUploadBudgetOwner;
  readonly #resources = new Map<string, RuntimeResource>();
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
  ) {
    this.#gl = gl;
    this.#onChanged = onChanged;
    this.#budget = budget;
    this.#schedule = schedule;
    this.#automatic = automatic;
    this.#uploadBudget = uploadBudget;
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
    this.#scene = null;
  }

  invalidate(): void {
    for (const resource of this.#resources.values()) {
      if (resource.gpu !== undefined) {
        this.#budget.release(resource.gpu.budgetIdentity);
        resource.gpu = undefined;
        this.#bindingRevision += 1;
      }
      for (const ready of resource.readyPages) ready.decoded.close();
      resource.readyPages.length = 0;
    }
  }

  runtimeSnapshot(): VirtualTextureRuntimeSnapshot {
    const uploads = this.#uploadBudget.snapshot();
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
      automaticCandidates: this.#automaticCandidates,
      automaticDecodedBytes,
      automaticEnabled: this.#automatic === undefined ? 0 : 1,
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
        state: resource.manifestFailureState ?? "error",
      };
    } else {
      next = {
        failedPages: resource.failedPages.size,
        pendingPages: resource.loadingPages.size + resource.readyPages.length,
        residentPages: resource.gpu?.residentSlots.size ?? 0,
        state: resource.manifestPending ? "loading" : "ready",
      };
    }
    const previous = resource.snapshot;
    if (
      previous !== undefined
      && previous.state === next.state
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
    for (const resource of this.#resources.values()) resource.viewCount = -1;
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
        failedPages: new Set(),
        gpu: undefined,
        key,
        loadingPages: new Set(),
        manifestPending: true,
        readyPages: [],
        sampler: canonicalTextureSampler(asset),
        snapshot: undefined,
        surfaces: [],
        viewCount: -1,
        viewState: new Float64Array(0),
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
          failedPages: new Set(),
          gpu: undefined,
          key,
          ...(lease === undefined ? {} : { lease }),
          loadingPages: new Set(),
          manifest: source.manifest,
          manifestPending: false,
          readyPages: [],
          sampler,
          snapshot: undefined,
          source,
          surfaces: [],
          viewCount: -1,
          viewState: new Float64Array(0),
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
  }

  update(views: readonly SurfaceFrameView[]): VirtualTextureFrameUpdate {
    if (this.#disposed) return FRAME_RESULTS[0]!;
    this.#uploadBudget.beginFrame();
    this.#frame += 1;
    let pending = false;
    let webGlStateChanged = false;
    let uploadsRemaining = MAX_UPLOADS_PER_FRAME;
    for (const resource of this.#resources.values()) {
      const manifest = resource.manifest;
      if (manifest === undefined || resource.manifestFailure !== undefined) continue;
      const demandChanged = this.#demandViewsChanged(resource, views);
      if (demandChanged) {
        resetVirtualTextureDemand(resource.workspace);
        collectVirtualTextureDemand(
          resource.workspace,
          manifest,
          resource.surfaces,
          views,
          resource.sampler,
        );
      }
      // Do not reserve one atlas per declared asset before it contributes to a view.
      if (resource.workspace.count === 0) {
        if (demandChanged) {
          for (const ready of resource.readyPages) ready.decoded.close();
          resource.readyPages.length = 0;
        }
        continue;
      }
      if (resource.gpu === undefined) {
        try {
          resource.gpu = createGpuVirtualTexture(
            this.#gl,
            resource.asset,
            manifest,
            this.#budget,
          );
          webGlStateChanged = true;
        } catch (error) {
          resource.manifestFailure = error instanceof Error ? error.message : String(error);
          resource.manifestFailureState = "unsupported";
          this.#changed(resource);
          continue;
        }
      }
      const gpu = resource.gpu;
      if (demandChanged) {
        truncateVirtualTextureDemand(resource.workspace, gpu.slotKeys.length);
        let retainedReadyPages = 0;
        for (let index = 0; index < resource.readyPages.length; index += 1) {
          const ready = resource.readyPages[index]!;
          if (!resource.workspace.keys.has(ready.pageKey)) {
            ready.decoded.close();
            continue;
          }
          resource.readyPages[retainedReadyPages] = ready;
          retainedReadyPages += 1;
        }
        resource.readyPages.length = retainedReadyPages;
      }
      for (let index = 0; index < resource.workspace.count; index += 1) {
        const mip = resource.workspace.mips[index]!;
        const x = resource.workspace.xs[index]!;
        const y = resource.workspace.ys[index]!;
        const key = virtualTexturePageKeyParts(mip, x, y);
        const slot = gpu.residentSlots.get(key);
        if (slot !== undefined) gpu.lastUsedFrames[slot] = this.#frame;
      }
      let uploadedPages = 0;
      let settledPages = 0;
      while (uploadsRemaining > 0 && resource.readyPages.length > 0) {
        const ready = resource.readyPages[0]!;
        if (gpu.residentSlots.has(ready.pageKey)) {
          resource.readyPages.shift();
          ready.decoded.close();
          settledPages += 1;
          continue;
        }
        const plan = planVirtualTextureAdmission(
          ready.page,
          gpu.slotKeys,
          gpu.lastUsedFrames,
          resource.workspace.keys,
        );
        if (plan === undefined) break;
        const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;
        const pageByteLength = ready.decoded.kind === "etc2-rgba"
          ? ready.decoded.blocks.byteLength
          : storedPageSize * storedPageSize * 4;
        const uploadByteLength = pageByteLength
          + (uploadedPages === 0 ? gpu.pageTableBytes.byteLength : 0);
        if (!this.#uploadBudget.tryAdmit(uploadByteLength)) {
          uploadsRemaining = 0;
          pending = true;
          break;
        }
        try {
          this.#uploadReadyPage(resource, ready, plan);
        } catch (error) {
          resource.readyPages.shift();
          ready.decoded.close();
          throw error;
        }
        resource.readyPages.shift();
        ready.decoded.close();
        uploadsRemaining -= 1;
        uploadedPages += 1;
        settledPages += 1;
        webGlStateChanged = true;
      }
      if (uploadedPages > 0) this.#publishPageTable(resource);
      if (settledPages > 0) this.#changed(resource);
      for (
        let index = 0;
        index < resource.workspace.count && this.#activeJobs < MAX_DECODE_JOBS;
        index += 1
      ) {
        const mip = resource.workspace.mips[index]!;
        const x = resource.workspace.xs[index]!;
        const y = resource.workspace.ys[index]!;
        const key = virtualTexturePageKeyParts(mip, x, y);
        if (
          gpu.residentSlots.has(key)
          || resource.loadingPages.has(key)
          || resource.failedPages.has(key)
          || !this.#publicationAncestorReady(resource, mip, x, y)
        ) continue;
        this.#startPageRead(resource, { mip, x, y }, key);
      }
      if (resource.readyPages.length > 0 && uploadsRemaining === 0) pending = true;
    }
    return FRAME_RESULTS[(pending ? 1 : 0) | (webGlStateChanged ? 2 : 0)]!;
  }

  #destroyResource(resource: RuntimeResource, deleteGpu: boolean): void {
    resource.abort.abort();
    for (const ready of resource.readyPages) ready.decoded.close();
    resource.readyPages.length = 0;
    if (deleteGpu && resource.gpu !== undefined) {
      destroyGpuVirtualTexture(this.#gl, resource.gpu, this.#budget);
    }
    resource.source?.close?.();
    resource.lease?.release();
  }

  #changed(resource: RuntimeResource): void {
    if (resource.authored) this.#onChanged(resource.asset as VirtualTextureAssetRef);
    else this.#automatic?.onChanged();
  }

  #demandViewsChanged(
    resource: RuntimeResource,
    views: readonly SurfaceFrameView[],
  ): boolean {
    const stride = 20;
    const length = views.length * stride;
    if (resource.viewState.length !== length) resource.viewState = new Float64Array(length);
    let changed = resource.viewCount !== views.length;
    for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
      const view = views[viewIndex]!;
      const offset = viewIndex * stride;
      for (let component = 0; component < 16; component += 1) {
        const value = view.viewProjection[component]!;
        if (resource.viewState[offset + component] !== value) changed = true;
        resource.viewState[offset + component] = value;
      }
      const viewport = view.viewport;
      if (resource.viewState[offset + 16] !== viewport.x) changed = true;
      if (resource.viewState[offset + 17] !== viewport.y) changed = true;
      if (resource.viewState[offset + 18] !== viewport.width) changed = true;
      if (resource.viewState[offset + 19] !== viewport.height) changed = true;
      resource.viewState[offset + 16] = viewport.x;
      resource.viewState[offset + 17] = viewport.y;
      resource.viewState[offset + 18] = viewport.width;
      resource.viewState[offset + 19] = viewport.height;
    }
    resource.viewCount = views.length;
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
    resource.loadingPages.add(pageKey);
    this.#activeJobs += 1;
    this.#pageRequests += 1;
    this.#changed(resource);
    void this.#schedule(
      resource.abort.signal,
      () => source.read(page, resource.abort.signal),
    ).then((decoded) => {
      if (decoded === undefined) resource.failedPages.add(pageKey);
      else if (
        resource.abort.signal.aborted
        || this.#disposed
        || !resource.workspace.keys.has(pageKey)
      ) decoded.close();
      else resource.readyPages.push({ decoded, page, pageKey });
    }).catch(() => {
      if (!resource.abort.signal.aborted) resource.failedPages.add(pageKey);
    }).finally(() => {
      resource.loadingPages.delete(pageKey);
      this.#activeJobs -= 1;
      if (!resource.abort.signal.aborted && !this.#disposed) this.#changed(resource);
    });
  }

  #uploadReadyPage(
    resource: RuntimeResource,
    ready: ReadyPage,
    plan: VirtualTextureAdmissionPlan,
  ): void {
    const gpu = resource.gpu!;
    const storedPageSize = resource.manifest!.pageSize + resource.manifest!.borderTexels * 2;
    const slotX = plan.slot % gpu.atlasColumns;
    const slotY = Math.floor(plan.slot / gpu.atlasColumns);
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, gpu.atlasTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    if (ready.decoded.kind === "etc2-rgba") {
      const expectedColorSpace = resource.asset.colorSpace ?? resource.manifest!.colorSpace;
      if (!gpu.compressed || ready.decoded.colorSpace !== expectedColorSpace) {
        throw new TypeError("Royal VT KTX2 page storage does not match its manifest color space");
      }
      gl.compressedTexSubImage2D(
        gl.TEXTURE_2D,
        0,
        slotX * storedPageSize,
        slotY * storedPageSize,
        storedPageSize,
        storedPageSize,
        expectedColorSpace === "srgb"
          ? ETC2_SRGB8_ALPHA8_WEBGL_FORMAT
          : ETC2_RGBA8_WEBGL_FORMAT,
        ready.decoded.blocks,
      );
    } else {
      if (gpu.compressed) throw new TypeError("Royal VT compressed atlas received an image page");
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
    if (plan.evictedKey !== undefined) gpu.residentSlots.delete(plan.evictedKey);
    gpu.slotKeys[plan.slot] = plan.pageKey;
    gpu.lastUsedFrames[plan.slot] = this.#frame;
    const firstResident = gpu.residentSlots.size === 0;
    gpu.residentSlots.set(plan.pageKey, plan.slot);
    this.#uploadedPages += 1;
    if (firstResident) this.#bindingRevision += 1;
  }

  #publishPageTable(resource: RuntimeResource): void {
    const gpu = resource.gpu!;
    const manifest = resource.manifest!;
    writeVirtualTexturePageTable(
      manifest,
      gpu.residentSlots,
      gpu.atlasColumns,
      gpu.pageTableBytes,
    );
    const gl = this.#gl;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, gpu.pageTableTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      manifest.tableWidth,
      manifest.tableHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      gpu.pageTableBytes,
    );
  }
}

export const createBrowserVirtualTextureRuntime = (
  gl: WebGL2RenderingContext,
  onChanged: (asset: VirtualTextureAssetRef) => void,
  budget = new PersistentGpuBudgetOwner(),
  schedule: AsyncPreparationScheduler = prepareDirectly,
  automatic?: AutomaticVirtualTextureRuntimeOptions,
  uploadBudget = new FrameUploadBudgetOwner(),
): VirtualTextureRuntime => new BrowserVirtualTextureRuntime(
  gl,
  onChanged,
  budget,
  schedule,
  automatic,
  uploadBudget,
);
