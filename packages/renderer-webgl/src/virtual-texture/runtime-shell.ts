import {
  advanceVirtualTextureFrameDemand,
  beginVirtualTextureFrameDemand,
  createVirtualTextureFrameDemandWorkspace,
  finalizeVirtualTextureFrameDemand,
  releaseVirtualTextureFrameDemandResource,
  resetVirtualTextureFrameDemand,
  submitVirtualTextureFrameDemand,
  type VirtualTextureFrameDemandCommit,
} from "./frame-demand";
import {
  VirtualTextureRequestCoordinator,
  type VirtualTextureRequestCoordinatorOptions,
} from "./request-coordinator";
import type { VirtualTextureDemandSubmission } from "./demand";
import {
  GENERATED_RASTER_VIRTUAL_TEXTURE_MIN_DIMENSION,
  automaticRasterVirtualTextureSource,
  automaticVirtualTextureSource,
  type AutomaticVirtualTextureSource,
} from "./automatic-source";
import {
  type VirtualTexturePagePayload,
  type VirtualTexturePageLoad,
  type VirtualTexturePageSource,
  type VirtualTextureRef,
  type VirtualTextureRuntimeState,
} from "./runtime";
import {
  isDecodedCompressedTexture,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "../texture/sources";
import { decodedTextureSourceBytes } from "../texture/decoded-source-lifetime";
import {
  generatedVirtualTexturePageCount,
  parseVirtualTextureManifest,
  virtualTextureExplicitPageUrisByKey,
  virtualTexturePageKey,
  virtualTexturePageUri,
  type VirtualTexturePageId,
} from "./model";
import { resolveResourceUri, throwIfAborted } from "../resource-io";
import {
  automaticSvgVirtualTextureManifest,
  svgVirtualTextureSourceForImage,
} from "./svg-source";
import { textureCacheKey, type TextureAssetUploadRef } from "../webgl/materials";
import type { ResourceGovernorLease, ResourceGovernorReservation } from "../resource-governor";
import { captureFailure, type CapturedFailure } from "../captured-failure";

export type VirtualTextureRuntimeShellOptions = Omit<
  VirtualTextureRequestCoordinatorOptions,
  "loadPage" | "resources"
> & {
  readonly disposed: () => boolean;
  readonly automaticVirtualTextures: boolean;
  readonly loadImageSource: (uri: string, signal: AbortSignal) => Promise<TexImageSource>;
};

export type AcquireVirtualTextureOptions = {
  readonly automaticSource?: AutomaticVirtualTextureSource;
  readonly cacheNamespace?: string;
  readonly diagnosticsEnabled?: boolean;
};

export type VirtualTextureFramePublication = {
  readonly admissions: readonly VirtualTextureRuntimeState[];
  readonly commits: ReadonlyMap<
    VirtualTextureRuntimeState,
    VirtualTextureFrameDemandCommit<VirtualTextureRuntimeState>
  >;
  readonly demanded: ReadonlySet<VirtualTextureRuntimeState>;
};

export type VirtualTextureAssetSnapshot =
  | Readonly<{ error?: never; pendingPages: number; state: "loading" | "ready" }>
  | Readonly<{ error: string; pendingPages: number; state: "error" | "unsupported" }>;

/**
 * Owns the mutable browser-shell state shared by VT demand publication and
 * asynchronous page requests. Pure demand planning and GPU allocation remain
 * separate authorities.
 */
export class VirtualTextureRuntimeShell {
  readonly #admissions: VirtualTextureRuntimeState[] = [];
  readonly #commits = new Map<
    VirtualTextureRuntimeState,
    VirtualTextureFrameDemandCommit<VirtualTextureRuntimeState>
  >();
  readonly #demanded = new Set<VirtualTextureRuntimeState>();
  readonly #demandCursors = new WeakMap<VirtualTextureRuntimeState, number>();
  readonly #demandCursorFor = (state: VirtualTextureRuntimeState): number =>
    this.#demandCursors.get(state) ?? 0;
  readonly #frameDemand = createVirtualTextureFrameDemandWorkspace<VirtualTextureRuntimeState>();
  readonly #autoRefs = new Map<string, VirtualTextureRef>();
  readonly #autoSources = new Map<string, AutomaticVirtualTextureSource>();
  readonly #options: VirtualTextureRuntimeShellOptions;
  readonly #resources = new Map<string, VirtualTextureRuntimeState>();
  readonly #gpuLeases = new Map<string, ResourceGovernorLease>();
  readonly #quarantinedGpuLeases = new Set<ResourceGovernorLease>();
  readonly #publication: VirtualTextureFramePublication = {
    admissions: this.#admissions,
    commits: this.#commits,
    demanded: this.#demanded,
  };
  readonly requests: VirtualTextureRequestCoordinator;
  #basisuCodec: Promise<typeof import("../gltf/codecs/basisu")> | undefined;
  #nextAdmissionTicket = 1;
  #retryTicket = 1;
  #viewIndex = 0;
  #governedAdmissionRetryScheduled = false;

  constructor(options: VirtualTextureRuntimeShellOptions) {
    this.#options = options;
    this.requests = new VirtualTextureRequestCoordinator({
      ...options,
      loadPage: (state, page, signal) => this.#pageImage(state, page, signal),
      resources: this.#resources,
    });
  }

  get activeFrame(): boolean {
    return this.#frameDemand.active;
  }

  get resources(): ReadonlyMap<string, VirtualTextureRuntimeState> {
    return this.#resources;
  }

  get(key: string): VirtualTextureRuntimeState | undefined {
    return this.#resources.get(key);
  }

  assetSnapshot(texture: VirtualTextureRef): VirtualTextureAssetSnapshot | undefined {
    const state = this.#resources.get(textureCacheKey(texture));
    if (state === undefined) return undefined;
    const requests = this.requests.snapshot(state);
    const pendingPages = requests.loadingPages + requests.queuedPages;
    if (state.status === "error" || state.status === "unsupported") {
      return {
        error: state.error ?? `Virtual texture ${state.status}`,
        pendingPages,
        state: state.status,
      };
    }
    return { pendingPages, state: state.status };
  }

  hasGpuLease(key: string): boolean {
    return this.#gpuLeases.has(key);
  }

  commitGpuLease(key: string, reservation: ResourceGovernorReservation): void {
    if (this.#gpuLeases.has(key)) throw new Error(`Virtual texture ${key} already owns a GPU lease`);
    this.#gpuLeases.set(key, reservation.commit());
  }

  commitQuarantinedGpuLease(reservation: ResourceGovernorReservation): void {
    this.#quarantinedGpuLeases.add(reservation.commit());
  }

  quarantineGpuLease(key: string): boolean {
    const lease = this.#gpuLeases.get(key);
    if (lease === undefined) return false;
    this.#gpuLeases.delete(key);
    this.#quarantinedGpuLeases.add(lease);
    return true;
  }

  releaseGpuLease(key: string): boolean {
    const lease = this.#gpuLeases.get(key);
    if (lease === undefined) return false;
    this.#gpuLeases.delete(key);
    try {
      lease.release();
    } catch (error) {
      this.#quarantinedGpuLeases.add(lease);
      throw error;
    }
    return true;
  }

  releaseAllGpuLeases(): void {
    const leases = [
      ...this.#gpuLeases.values(),
      ...this.#quarantinedGpuLeases,
    ];
    this.#gpuLeases.clear();
    this.#quarantinedGpuLeases.clear();
    let failure: CapturedFailure | undefined;
    for (const lease of leases) {
      const releaseFailure = captureFailure(() => {
        lease.release();
      });
      if (releaseFailure !== undefined) this.#quarantinedGpuLeases.add(lease);
      failure ??= releaseFailure;
    }
    if (failure !== undefined) throw failure.value;
  }

  scheduleGovernedAdmissionRetry(): void {
    if (
      this.#governedAdmissionRetryScheduled
      || !this.#options.active()
      || !this.#hasGovernedAdmissionDemand()
    ) return;
    this.#governedAdmissionRetryScheduled = true;
    queueMicrotask(() => {
      this.#governedAdmissionRetryScheduled = false;
      if (this.#options.active() && this.#hasGovernedAdmissionDemand()) this.#options.invalidate();
    });
  }

  register(state: VirtualTextureRuntimeState): void {
    if (this.#resources.has(state.key)) {
      throw new Error(`Virtual texture runtime ${state.key} is already registered`);
    }
    this.#resources.set(state.key, state);
  }

  nextAdmissionTicket(): number {
    const ticket = this.#nextAdmissionTicket;
    this.#nextAdmissionTicket += 1;
    return ticket;
  }

  acquire(
    texture: VirtualTextureRef,
    options: AcquireVirtualTextureOptions = {},
  ): VirtualTextureRuntimeState {
    const diagnosticsEnabled = options.diagnosticsEnabled ?? true;
    const textureKey = textureCacheKey(texture);
    const key = options.cacheNamespace === undefined
      ? textureKey
      : `${options.cacheNamespace}:${textureKey}`;
    const cached = this.#resources.get(key);
    if (cached !== undefined) {
      if (diagnosticsEnabled) cached.diagnosticsEnabled = true;
      return cached;
    }
    const activeSource = options.automaticSource ?? this.#sidecarSource(texture.manifestUri);
    const automaticManifest = options.automaticSource?.manifest.manifest;
    const state: VirtualTextureRuntimeState = {
      activeSource,
      admissionTicket: this.nextAdmissionTicket(),
      demandPublished: false,
      demandedPageKeys: new Set(),
      demandedPageKeysScratch: new Set(),
      diagnosticsEnabled,
      desiredPageKeys: new Set(),
      desiredPageKeysScratch: new Set(),
      desiredPages: [],
      desiredPagesScratch: [],
      key,
      lastDemandFrame: Number.NEGATIVE_INFINITY,
      sourceGeneration: 1,
      stats: {
        demandAdmissions: 0,
        demandRetentionOverflows: 0,
        demandRetentions: 0,
        automaticManifestUses: automaticManifest === undefined ? 0 : 1,
        automaticPagesTarget: automaticManifest === undefined
          ? 0
          : generatedVirtualTexturePageCount(
              automaticManifest.width,
              automaticManifest.height,
              automaticManifest.pageSize,
            ),
        automaticSourceBytes: options.automaticSource?.retainedSourceBytes ?? 0,
        gpuAdmissionFailures: 0,
        manifestFailures: 0,
        manifestRequests: activeSource.manifest === undefined ? 1 : 0,
        preparedResidencyResolutions: 0,
        pageLoadFailures: 0,
        pageLoadDurationMaxMs: 0,
        pageLoadDurationMs: 0,
        pageLoadDurationSamples: 0,
        pageLoadRequests: 0,
        shaderBinds: 0,
        unreadyDraws: 0,
        unsupportedDraws: 0,
      },
      status: "loading",
      texture,
    };
    this.register(state);
    this.#startSource(state);
    return state;
  }

  autoSource(texture: TextureAssetUploadRef): AutomaticVirtualTextureSource | undefined {
    return this.#autoSources.get(textureCacheKey(texture));
  }

  acquireAuto(texture: TextureAssetUploadRef): VirtualTextureRuntimeState | undefined {
    const textureKey = textureCacheKey(texture);
    const source = this.#autoSources.get(textureKey);
    if (source === undefined) return undefined;
    const refKey = `auto-base-color:${textureKey}`;
    let ref = this.#autoRefs.get(refKey);
    if (ref === undefined) {
      ref = {
        kind: "virtual-asset",
        ...(texture.colorSpace === undefined ? {} : { colorSpace: texture.colorSpace }),
        ...(texture.contentKey === undefined ? {} : { contentKey: texture.contentKey }),
        manifestUri: source.manifestUri,
        ...(texture.sampler === undefined ? {} : { sampler: texture.sampler }),
        ...(texture.version === undefined ? {} : { version: texture.version }),
      };
      this.#autoRefs.set(refKey, ref);
    }
    return this.acquire(ref, {
      cacheNamespace: `auto-base-color:${textureKey}`,
      diagnosticsEnabled: false,
      automaticSource: source,
    });
  }

  registerAutoDecodedSource(texture: TextureAssetUploadRef, source: LoadedTextureSource): void {
    if (!this.#options.automaticVirtualTextures) return;
    if (isDecodedCompressedTexture(source)) return;
    const textureKey = textureCacheKey(texture);
    const retainedSourceBytes = (() => {
      try {
        return decodedTextureSourceBytes(source);
      } catch {
        return undefined;
      }
    })();
    if (retainedSourceBytes === undefined) return;
    const svgSource = svgVirtualTextureSourceForImage(source);
    if (svgSource !== undefined) {
      this.#autoSources.set(textureKey, automaticVirtualTextureSource(textureKey, {
        loadPage: (manifest, page, signal) => {
          throwIfAborted(signal);
          return {
            kind: "page",
            promise: import("../texture/svg").then(({ loadAutomaticSvgVirtualTexturePageImage }) => (
              loadAutomaticSvgVirtualTexturePageImage(svgSource, manifest, page, signal)
            ))
              .then((image) => ({ image, kind: "image" })),
          };
        },
        manifest: automaticSvgVirtualTextureManifest(svgSource),
        retainedSourceBytes,
      }));
      return;
    }
    const [width, height] = loadedTextureSourceSize(source);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    if (Math.max(width, height) < GENERATED_RASTER_VIRTUAL_TEXTURE_MIN_DIMENSION) return;
    const pageSource = {
      ...(texture.colorSpace === undefined ? {} : { colorSpace: texture.colorSpace }),
      decodedBytes: retainedSourceBytes,
      height: Math.ceil(height),
      label: texture.uri,
      source,
      width: Math.ceil(width),
    };
    this.#autoSources.set(textureKey, automaticRasterVirtualTextureSource(textureKey, pageSource));
  }

  releaseAutoMetadata(textureKey: string): void {
    this.#autoRefs.delete(`auto-base-color:${textureKey}`);
    this.#autoSources.delete(textureKey);
  }

  clearAutoMetadata(): void {
    this.#autoRefs.clear();
    this.#autoSources.clear();
  }

  /** Forgets all CPU/request demand identity after the caller ends source ownership. */
  forget(state: VirtualTextureRuntimeState): void {
    state.sourceGeneration += 1;
    state.manifestAbortController?.abort();
    delete state.manifestAbortController;
    if (this.#resources.get(state.key) === state) this.#resources.delete(state.key);
    this.requests.release(state);
    state.desiredPageKeys.clear();
    state.desiredPageKeysScratch.clear();
    state.demandedPageKeys.clear();
    state.demandedPageKeysScratch.clear();
    state.desiredPages.length = 0;
    state.desiredPagesScratch.length = 0;
    releaseVirtualTextureFrameDemandResource(this.#frameDemand, state);
    this.#demandCursors.delete(state);
  }

  beginFrame(): void {
    beginVirtualTextureFrameDemand(this.#frameDemand);
    for (const state of this.#resources.values()) state.demandedPageKeysScratch.clear();
  }

  beginView(viewIndex: number): void {
    this.#viewIndex = viewIndex;
  }

  submit(
    state: VirtualTextureRuntimeState,
    capacity: number,
    submission: VirtualTextureDemandSubmission,
    nonconvergentCandidates: readonly VirtualTexturePageId[],
  ): void {
    submitVirtualTextureFrameDemand(
      this.#frameDemand,
      state,
      state.admissionTicket,
      this.#viewIndex,
      capacity,
      submission,
      nonconvergentCandidates,
    );
  }

  finishFrame(commit: boolean): VirtualTextureFramePublication | undefined {
    const commits = finalizeVirtualTextureFrameDemand(
      this.#frameDemand,
      commit,
      this.#demandCursorFor,
    );
    if (!commit) return undefined;

    this.#commits.clear();
    this.#demanded.clear();
    this.#admissions.length = 0;
    if (this.#resources.size === 0) return undefined;
    for (const entry of commits) {
      this.#commits.set(entry.resource, entry);
      const demandedPageKeys = entry.resource.demandedPageKeysScratch;
      for (const page of entry.nonconvergentCandidates) {
        demandedPageKeys.add(virtualTexturePageKey(page));
      }
      for (const submission of entry.submissions) {
        for (const page of submission.candidates) demandedPageKeys.add(virtualTexturePageKey(page));
        for (const page of submission.preferredCandidates ?? []) {
          demandedPageKeys.add(virtualTexturePageKey(page));
        }
      }
      if (demandedPageKeys.size > 0) this.#demanded.add(entry.resource);
    }
    for (const state of this.#demanded) {
      if (state.status === "ready" && state.manifest !== undefined) this.#admissions.push(state);
    }
    this.#admissions.sort((left, right) => left.admissionTicket - right.admissionTicket);
    let admissionStart = -1;
    for (let index = 0; index < this.#admissions.length; index += 1) {
      if (this.#admissions[index]!.admissionTicket < this.#retryTicket) continue;
      admissionStart = index;
      break;
    }
    if (admissionStart < 0) admissionStart = 0;
    for (let index = 0; index < admissionStart; index += 1) {
      this.#admissions.push(this.#admissions.shift()!);
    }
    if (this.#admissions.length > 0) {
      this.#retryTicket = this.#admissions[1 % this.#admissions.length]!.admissionTicket;
    }
    return this.#publication;
  }

  /** Advances fairness for windows whose publication policy is satisfied. */
  commitPublication(
    advanceable: readonly VirtualTextureRuntimeState[],
    frame: number,
  ): void {
    for (const state of this.#demanded) state.lastDemandFrame = frame;
    for (const state of advanceable) {
      const entry = this.#commits.get(state);
      if (entry === undefined) continue;
      if (entry.submissions.length > 1) {
        this.#demandCursors.set(state, entry.nextStartSubmission);
      }
      advanceVirtualTextureFrameDemand(this.#frameDemand, entry);
    }
  }

  clearFinishedFrame(): void {
    this.#commits.clear();
    this.#demanded.clear();
    this.#admissions.length = 0;
  }

  loseContext(): void {
    this.requests.loseContext();
    resetVirtualTextureFrameDemand(this.#frameDemand);
  }

  markUnsupported(state: VirtualTextureRuntimeState, reason: string): void {
    state.error = reason;
    state.status = "unsupported";
    const message = `Virtual texture ${state.activeSource.manifestUri} unsupported: ${reason}. Rendering with material color only.`;
    if (state.diagnosticsEnabled) {
      this.#options.diagnostic(message, `virtual-texture-unsupported:${state.activeSource.manifestUri}`);
    }
    this.#options.invalidate();
  }

  diagnose(state: VirtualTextureRuntimeState, message: string, key: string): void {
    if (state.diagnosticsEnabled) this.#options.diagnostic(message, key);
  }

  #startSource(state: VirtualTextureRuntimeState): void {
    if (state.activeSource.manifest !== undefined) {
      this.#useManifest(state, state.activeSource.manifest);
      return;
    }
    state.manifestAbortController = new AbortController();
    void this.#loadManifest(state, state.manifestAbortController.signal);
  }

  #current(state: VirtualTextureRuntimeState, sourceGeneration: number): boolean {
    return !this.#options.disposed()
      && this.#resources.get(state.key) === state
      && state.sourceGeneration === sourceGeneration;
  }

  async #loadManifest(state: VirtualTextureRuntimeState, signal: AbortSignal): Promise<void> {
    const source = state.activeSource;
    if (source.loadManifest === undefined) return;
    const sourceGeneration = state.sourceGeneration;
    let parsed;
    try {
      parsed = await source.loadManifest(signal);
    } catch (error) {
      if (state.manifestAbortController?.signal === signal) delete state.manifestAbortController;
      if (!this.#current(state, sourceGeneration)) return;
      this.#fail(state, error instanceof Error ? error.message : String(error));
      return;
    }
    if (!this.#current(state, sourceGeneration)) return;
    if (state.manifestAbortController?.signal === signal) delete state.manifestAbortController;
    this.#useManifest(state, parsed);
  }

  #useManifest(
    state: VirtualTextureRuntimeState,
    parsed: ReturnType<typeof parseVirtualTextureManifest>,
  ): void {
    const source = state.activeSource;
    for (const diagnostic of parsed.diagnostics) {
      if (!state.diagnosticsEnabled) continue;
      this.#options.diagnostic(
        `Virtual texture ${source.manifestUri}: ${diagnostic.message}`,
        `virtual-texture-manifest:${source.manifestUri}:${diagnostic.severity}:${diagnostic.message}`,
      );
    }
    if (parsed.manifest === undefined) {
      this.#fail(state, "manifest parse failed");
      return;
    }
    const unsupported = parsed.diagnostics.find((diagnostic) => diagnostic.severity === "unsupported");
    if (unsupported !== undefined) {
      this.markUnsupported(state, unsupported.message);
      return;
    }
    const manifest = parsed.manifest;
    state.availablePageKeys = new Set(manifest.pages.map(virtualTexturePageKey));
    state.manifest = manifest;
    delete state.error;
    state.status = "ready";
    this.#options.invalidate();
  }

  #pageImage(
    state: VirtualTextureRuntimeState,
    page: VirtualTexturePageId,
    signal: AbortSignal,
  ): VirtualTexturePageLoad {
    const manifest = state.manifest;
    if (manifest === undefined) return { kind: "absent" };
    return state.activeSource.loadPage(manifest, page, signal);
  }

  #sidecarSource(manifestUri: string): VirtualTexturePageSource {
    let pageUrisByKey: ReadonlyMap<string, string> = new Map();
    return {
      loadManifest: async (signal) => {
        let response: Response;
        try {
          response = await fetch(manifestUri, { signal });
          if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        } catch (error) {
          throw new Error(
            `manifest transport failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        let payload: unknown;
        try {
          payload = await response.json() as unknown;
        } catch (error) {
          throw new Error(
            `manifest JSON decode failed: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        }
        const parsed = parseVirtualTextureManifest(payload);
        if (parsed.manifest !== undefined) {
          pageUrisByKey = virtualTextureExplicitPageUrisByKey(parsed.manifest);
        }
        return parsed;
      },
      loadPage: (manifest, page, signal) => {
        const uri = virtualTexturePageUri(manifest, page, pageUrisByKey);
        if (uri === undefined) return { kind: "absent" };
        const resolvedUri = resolveResourceUri(manifestUri, uri);
        return manifest.pageEncoding === "ktx2-basis"
          ? { kind: "page", promise: this.#compressedPage(resolvedUri, signal) }
          : {
              kind: "page",
              promise: this.#options.loadImageSource(resolvedUri, signal)
                .then((image) => ({ image, kind: "image" })),
            };
      },
      manifestUri,
    };
  }

  async #compressedPage(
    uri: string,
    signal: AbortSignal,
  ): Promise<Extract<VirtualTexturePagePayload, { readonly kind: "compressed" }>> {
    this.#basisuCodec ??= import("../gltf/codecs/basisu");
    const [response, codec] = await Promise.all([fetch(uri, { signal }), this.#basisuCodec]);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const bytes = await response.arrayBuffer();
    throwIfAborted(signal);
    const decoded = await codec.decodeGltfBasisuEtc2Texture(bytes, uri);
    throwIfAborted(signal);
    return {
      data: decoded.data,
      format: decoded.format,
      height: decoded.height,
      kind: "compressed",
      srgbFormat: decoded.srgbFormat,
      width: decoded.width,
    };
  }

  #fail(state: VirtualTextureRuntimeState, reason: string): void {
    state.error = reason;
    state.status = "error";
    state.stats.manifestFailures += 1;
    if (state.diagnosticsEnabled) {
      this.#options.diagnostic(
        `Virtual texture ${state.activeSource.manifestUri} failed: ${reason}`,
        `virtual-texture-failed:${state.activeSource.manifestUri}`,
      );
    }
    this.#options.invalidate();
  }

  #hasGovernedAdmissionDemand(): boolean {
    for (const state of this.#resources.values()) {
      if (
        state.status === "ready"
        && state.manifest !== undefined
        && state.lastDemandFrame !== Number.NEGATIVE_INFINITY
        && !this.#gpuLeases.has(state.key)
      ) return true;
    }
    return false;
  }
}
