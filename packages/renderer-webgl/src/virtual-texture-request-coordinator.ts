import { DecodedTextureSourceLifetime } from "./decoded-texture-source-lifetime";
import {
  reserveResourceGovernor,
  type ResourceGovernor,
} from "./resource-governor";
import {
  VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS,
  VIRTUAL_TEXTURE_MAX_PAGE_LOAD_RETRIES,
  VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME,
  VIRTUAL_TEXTURE_PAGE_RETRY_BASE_DELAY_MS,
  type VirtualTextureRuntimeState,
  type VirtualTexturePageLoad,
  type VirtualTexturePagePayload,
} from "./virtual-texture-runtime";
import {
  createVirtualTextureRequestPlanningWorkspace,
  createVirtualTextureRequestScheduler,
  planVirtualTexturePageRequestsInto,
  resetVirtualTextureRequestScheduler,
  virtualTextureRequestBudgetAvailable,
  type VirtualTextureRequestPageSnapshot,
  type VirtualTextureRequestResourceSnapshot,
  type VirtualTextureRequestSchedulerState,
} from "./virtual-texture-orchestration";
import { validateVirtualTexturePageImage } from "./virtual-texture-page-image";
import {
  reduceVirtualTexturePageLifecycle,
  virtualTexturePageLifecycleCanBecomeResident,
  virtualTexturePageLifecycleCapacityBlocked,
  virtualTexturePageLifecycleClaimed,
  virtualTexturePageLifecycleLoading,
  virtualTexturePageLifecycleRetryBlocked,
  type VirtualTexturePageLifecycle,
  type VirtualTexturePageLifecycleEvent,
  type VirtualTexturePageLifecycleTransition,
} from "./virtual-texture-page-lifecycle";
import {
  virtualTextureStoredPageBytes,
  virtualTextureStoredPageSize,
  virtualTexturePageKey,
  type VirtualTexturePageId,
} from "./virtual-texturing";
import {
  consumeVirtualTextureGpuWake,
  queueVirtualTextureGpuUpload,
  virtualTextureGpuCachedResidency,
  virtualTextureGpuResource,
  virtualTextureGpuResourceSnapshot,
  type VirtualTextureGpuArena,
} from "./webgl/virtual-texture-gpu-arena";

type MutablePageSnapshot = {
  -readonly [Key in keyof VirtualTextureRequestPageSnapshot]: VirtualTextureRequestPageSnapshot[Key];
};

type MutableResourceSnapshot = Omit<{
  -readonly [Key in keyof VirtualTextureRequestResourceSnapshot]: VirtualTextureRequestResourceSnapshot[Key];
}, "pages"> & { pages: MutablePageSnapshot[] };

type ResourceRequestState = {
  readonly abortControllers: Map<string, AbortController>;
  readonly lifecycles: Map<string, VirtualTexturePageLifecycle>;
  readonly retryTimers: Map<string, ReturnType<typeof setTimeout>>;
};

export type VirtualTextureRequestStateSnapshot = {
  readonly lifecycleEntries: number;
  readonly loadingPages: number;
  readonly queuedPages: number;
};

export type VirtualTexturePageJobAdmission = { readonly release: () => void };

export type VirtualTextureRequestCoordinatorOptions = {
  readonly active: () => boolean;
  readonly admitJob: () => VirtualTexturePageJobAdmission | undefined;
  readonly decodedSources: DecodedTextureSourceLifetime;
  readonly diagnostic: (message: string, key: string) => void;
  readonly frame: () => number;
  readonly gpu: VirtualTextureGpuArena;
  readonly invalidate: () => void;
  readonly loadPage: (
    state: VirtualTextureRuntimeState,
    page: VirtualTexturePageId,
    signal: AbortSignal,
  ) => VirtualTexturePageLoad;
  readonly maximumDecodedCpuBytes: number;
  readonly resourceGovernor: ResourceGovernor;
  readonly resources: ReadonlyMap<string, VirtualTextureRuntimeState>;
};

const emptyResourceSnapshot = (): MutableResourceSnapshot => ({
  allocated: false,
  effectiveSlots: 0,
  enabled: false,
  key: "",
  loadingPages: 0,
  pages: [],
  pendingUploads: 0,
});

const virtualTexturePayloadSource = (payload: VirtualTexturePagePayload): object =>
  payload.kind === "image" ? payload.image : payload.data;

const validVirtualTexturePayload = (
  manifest: NonNullable<VirtualTextureRuntimeState["manifest"]>,
  payload: VirtualTexturePagePayload,
): { readonly actual: string; readonly valid: boolean } => {
  if (payload.kind === "image") {
    const validation = validateVirtualTexturePageImage(manifest, payload.image);
    return {
      actual: `${String(validation.width)}x${String(validation.height)} pixels`,
      valid: manifest.pageEncoding === "image" && validation.kind === "valid",
    };
  }
  const storedPageSize = virtualTextureStoredPageSize(manifest);
  return {
    actual: `${payload.width}x${payload.height} compressed texels and ${payload.data.byteLength} bytes`,
    valid: manifest.pageEncoding === "ktx2-basis"
      && payload.format === 0x9278
      && payload.srgbFormat === 0x9279
      && payload.width === storedPageSize
      && payload.height === storedPageSize
      && payload.data.byteLength === virtualTextureStoredPageBytes(manifest),
  };
};

/** Owns VT page eligibility, request fairness, retries, and asynchronous load identity. */
export class VirtualTextureRequestCoordinator {
  readonly #options: VirtualTextureRequestCoordinatorOptions;
  readonly #planning = createVirtualTextureRequestPlanningWorkspace();
  readonly #resourcePool: MutableResourceSnapshot[] = [];
  readonly #resources: MutableResourceSnapshot[] = [];
  readonly #states = new WeakMap<VirtualTextureRuntimeState, ResourceRequestState>();
  #draining = false;
  #generation = 0;
  #scheduled = false;
  #scheduler: VirtualTextureRequestSchedulerState = createVirtualTextureRequestScheduler();

  constructor(options: VirtualTextureRequestCoordinatorOptions) {
    this.#options = options;
  }

  canBecomeResident(state: VirtualTextureRuntimeState, pageKey: string): boolean {
    return virtualTexturePageLifecycleCanBecomeResident(this.#states.get(state)?.lifecycles.get(pageKey));
  }

  reconcileDemand(state: VirtualTextureRuntimeState, previousPageKeys: ReadonlySet<string>): void {
    const requestState = this.#states.get(state);
    if (requestState === undefined) return;
    for (const pageKey of previousPageKeys) {
      if (state.desiredPageKeys.has(pageKey)) continue;
      const controller = requestState.abortControllers.get(pageKey);
      if (controller !== undefined) {
        requestState.abortControllers.delete(pageKey);
        this.#transition(requestState, pageKey, { kind: "release" });
        controller.abort();
      }
      const timer = requestState.retryTimers.get(pageKey);
      if (timer !== undefined) {
        clearTimeout(timer);
        requestState.retryTimers.delete(pageKey);
        this.#transition(requestState, pageKey, { kind: "release" });
      }
    }
    this.#purgeObsolete(state, requestState);
  }

  release(state: VirtualTextureRuntimeState): void {
    const requestState = this.#states.get(state);
    if (requestState === undefined) return;
    for (const controller of requestState.abortControllers.values()) controller.abort();
    requestState.abortControllers.clear();
    for (const timer of requestState.retryTimers.values()) clearTimeout(timer);
    requestState.retryTimers.clear();
    requestState.lifecycles.clear();
    this.#states.delete(state);
  }

  loseContext(): void {
    this.#generation += 1;
    this.#scheduled = false;
    this.#scheduler = resetVirtualTextureRequestScheduler();
    this.#resources.length = 0;
    this.#resourcePool.length = 0;
    for (const state of this.#options.resources.values()) {
      const requestState = this.#states.get(state);
      if (requestState === undefined) continue;
      for (const controller of requestState.abortControllers.values()) controller.abort();
      requestState.abortControllers.clear();
      for (const timer of requestState.retryTimers.values()) clearTimeout(timer);
      requestState.retryTimers.clear();
      for (const pageKey of requestState.lifecycles.keys()) {
        this.#transition(requestState, pageKey, { kind: "context-lost" });
      }
    }
  }

  settleGpuPage(state: VirtualTextureRuntimeState, pageKey: string): void {
    const requestState = this.#states.get(state);
    if (requestState !== undefined) this.#transition(requestState, pageKey, { kind: "gpu-settled" });
  }

  snapshot(state: VirtualTextureRuntimeState): VirtualTextureRequestStateSnapshot {
    const requestState = this.#states.get(state);
    if (requestState === undefined) return { lifecycleEntries: 0, loadingPages: 0, queuedPages: 0 };
    let loadingPages = 0;
    let queuedPages = 0;
    for (const lifecycle of requestState.lifecycles.values()) {
      if (virtualTexturePageLifecycleLoading(lifecycle)) loadingPages += 1;
      else if (lifecycle.kind === "queued") queuedPages += 1;
    }
    return { lifecycleEntries: requestState.lifecycles.size, loadingPages, queuedPages };
  }

  wakeDecodedCapacity(): boolean {
    let woke = false;
    for (const state of this.#options.resources.values()) {
      if (state.status !== "ready") continue;
      const requestState = this.#states.get(state);
      if (requestState === undefined) continue;
      for (const [pageKey, lifecycle] of requestState.lifecycles) {
        if (!virtualTexturePageLifecycleCapacityBlocked(lifecycle)) continue;
        this.#transition(requestState, pageKey, { kind: "capacity-released" });
        woke ||= state.desiredPageKeys.has(pageKey);
      }
    }
    if (woke) this.schedule();
    return woke;
  }

  schedule(): void {
    if (this.#scheduled || !this.#options.active()) return;
    this.#scheduled = true;
    const generation = this.#generation;
    queueMicrotask(() => {
      if (generation !== this.#generation) return;
      this.#scheduled = false;
      if (this.#options.active()) this.drain();
    });
  }

  drain(): void {
    if (this.#draining || !this.#options.active()) return;
    this.#draining = true;
    const resources = this.#resources;
    try {
      while (virtualTextureRequestBudgetAvailable(
        this.#scheduler,
        this.#options.frame(),
        VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME,
      )) {
        this.#materializeResources();
        const frame = this.#options.frame();
        const plan = planVirtualTexturePageRequestsInto(
          this.#planning,
          this.#scheduler,
          frame,
          resources,
          {
            maxGrantsPerFrame: Math.min(
              VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME,
              (this.#scheduler.frame === frame ? this.#scheduler.grantsThisFrame : 0) + 1,
            ),
            maxInFlightPerResource: VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS,
          },
        );
        const grant = plan.grants[0];
        if (grant === undefined) break;
        const job = this.#options.admitJob();
        if (job === undefined) break;
        this.#scheduler = plan.scheduler;
        const state = this.#options.resources.get(grant.key);
        if (state === undefined) job.release();
        else this.#request(state, grant.page, job);
      }
    } finally {
      resources.length = 0;
      this.#draining = false;
    }
    if (this.#resourcePool.length > 64) this.#resourcePool.length = 64;
  }

  #requestState(state: VirtualTextureRuntimeState): ResourceRequestState {
    let requestState = this.#states.get(state);
    if (requestState === undefined) {
      requestState = { abortControllers: new Map(), lifecycles: new Map(), retryTimers: new Map() };
      this.#states.set(state, requestState);
    }
    return requestState;
  }

  #transition(
    state: ResourceRequestState,
    pageKey: string,
    event: VirtualTexturePageLifecycleEvent,
  ): VirtualTexturePageLifecycleTransition {
    const previous = state.lifecycles.get(pageKey);
    const transition = reduceVirtualTexturePageLifecycle(previous, event, {
      retryBaseDelayMs: VIRTUAL_TEXTURE_PAGE_RETRY_BASE_DELAY_MS,
      retryLimit: VIRTUAL_TEXTURE_MAX_PAGE_LOAD_RETRIES,
    });
    if (transition.state === undefined) state.lifecycles.delete(pageKey);
    else state.lifecycles.set(pageKey, transition.state);
    return transition;
  }

  #diagnostic(message: string, key: string): void {
    try {
      this.#options.diagnostic(message, key);
    } catch {
      // Diagnostics must never interrupt resource ownership settlement.
    }
  }

  #purgeObsolete(state: VirtualTextureRuntimeState, requestState: ResourceRequestState): void {
    for (const pageKey of requestState.lifecycles.keys()) {
      if (
        state.demandedPageKeys.has(pageKey)
        || requestState.abortControllers.has(pageKey)
        || requestState.retryTimers.has(pageKey)
      ) continue;
      const lifecycle = requestState.lifecycles.get(pageKey);
      if (lifecycle !== undefined && lifecycle.kind !== "queued") {
        this.#transition(requestState, pageKey, { kind: "release" });
      }
    }
  }

  #materializeResources(): void {
    const resources = this.#resources;
    resources.length = 0;
    let resourceIndex = 0;
    for (const state of this.#options.resources.values()) {
      const requestState = this.#requestState(state);
      this.#purgeObsolete(state, requestState);
      const resource = virtualTextureGpuResource(this.#options.gpu, state.key);
      const gpu = resource === undefined ? undefined : virtualTextureGpuResourceSnapshot(resource);
      let snapshot = this.#resourcePool[resourceIndex];
      if (snapshot === undefined) {
        snapshot = emptyResourceSnapshot();
        this.#resourcePool.push(snapshot);
      }
      snapshot.allocated = gpu?.allocated ?? false;
      snapshot.effectiveSlots = gpu?.effectiveSlots ?? 0;
      snapshot.enabled = state.status === "ready" && state.desiredPages.length > 0;
      snapshot.key = state.key;
      snapshot.loadingPages = this.snapshot(state).loadingPages;
      snapshot.pendingUploads = gpu?.pendingUploads ?? 0;
      for (let pageIndex = 0; pageIndex < state.desiredPages.length; pageIndex += 1) {
        const page = state.desiredPages[pageIndex]!;
        const pageKey = virtualTexturePageKey(page);
        let pageSnapshot = snapshot.pages[pageIndex];
        if (pageSnapshot === undefined) {
          pageSnapshot = { claimed: false, page, resident: false, retryBlocked: false };
          snapshot.pages.push(pageSnapshot);
        }
        const lifecycle = requestState.lifecycles.get(pageKey);
        pageSnapshot.claimed = virtualTexturePageLifecycleClaimed(lifecycle);
        pageSnapshot.page = page;
        pageSnapshot.resident = virtualTextureGpuCachedResidency(this.#options.gpu, state.key, page) !== undefined;
        pageSnapshot.retryBlocked = virtualTexturePageLifecycleRetryBlocked(lifecycle);
      }
      snapshot.pages.length = state.desiredPages.length;
      resources.push(snapshot);
      resourceIndex += 1;
    }
  }

  #request(
    state: VirtualTextureRuntimeState,
    page: VirtualTexturePageId,
    job: VirtualTexturePageJobAdmission,
  ): boolean {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") {
      job.release();
      return false;
    }
    const requestState = this.#requestState(state);
    const pageKey = virtualTexturePageKey(page);
    const lifecycle = requestState.lifecycles.get(pageKey);
    if (
      (lifecycle !== undefined && lifecycle.kind !== "eligible")
      || virtualTextureGpuCachedResidency(this.#options.gpu, state.key, page) !== undefined
    ) {
      job.release();
      return false;
    }

    let retainedBytes: number;
    try {
      retainedBytes = virtualTextureStoredPageBytes(manifest);
    } catch {
      this.#transition(requestState, pageKey, { kind: "capacity-denied", permanent: true });
      job.release();
      this.#options.invalidate();
      return false;
    }
    const decodedReservation = reserveResourceGovernor(this.#options.resourceGovernor, "virtual-texture", {
      cpuDecodedBytes: retainedBytes,
    });
    if (typeof decodedReservation === "string") {
      const permanent = retainedBytes > this.#options.maximumDecodedCpuBytes;
      this.#transition(requestState, pageKey, { kind: "capacity-denied", permanent });
      if (permanent && state.diagnosticsEnabled) {
        this.#diagnostic(
          `Virtual texture page ${state.activeSource.manifestUri} ${pageKey} requires ${retainedBytes} retained CPU bytes, exceeding the virtual-texture maximum ${this.#options.maximumDecodedCpuBytes}`,
          `virtual-texture-page-cpu-limit:${state.activeSource.manifestUri}:${pageKey}`,
        );
      }
      job.release();
      if (permanent) this.#options.invalidate();
      return false;
    }

    const controller = new AbortController();
    requestState.abortControllers.set(pageKey, controller);
    const sourceGeneration = state.sourceGeneration;
    let pageLoad: VirtualTexturePageLoad;
    try {
      pageLoad = this.#options.loadPage(state, page, controller.signal);
    } catch (error) {
      requestState.abortControllers.delete(pageKey);
      controller.abort();
      decodedReservation.cancel();
      job.release();
      throw error;
    }
    if (pageLoad.kind === "absent") {
      decodedReservation.cancel();
      job.release();
      requestState.abortControllers.delete(pageKey);
      this.#transition(requestState, pageKey, { kind: "unrequestable" });
      this.#options.invalidate();
      return false;
    }
    const pageImage = pageLoad.promise;

    if (
      !this.#options.active()
      || this.#options.resources.get(state.key) !== state
      || state.sourceGeneration !== sourceGeneration
      || state.status !== "ready"
      || requestState.abortControllers.get(pageKey) !== controller
    ) {
      if (requestState.abortControllers.get(pageKey) === controller) {
        requestState.abortControllers.delete(pageKey);
      }
      controller.abort();
      decodedReservation.cancel();
      job.release();
      void pageImage.then((result) => {
        try {
          this.#options.decodedSources.closeVirtualTextureAsync(
            virtualTexturePayloadSource(result),
            result.kind === "image" ? result.close : undefined,
          );
        } catch {
          // The lifetime retains failed closes and wakes its ordinary retry path.
        }
      }, () => undefined);
      return false;
    }

    this.#transition(requestState, pageKey, { kind: "grant" });
    void pageImage.then((result) => {
      const ownedSource = virtualTexturePayloadSource(result);
      const close = result.kind === "image" ? result.close : undefined;
      let queued = false;
      try {
        const decodedLease = decodedReservation.commit();
        try {
          this.#options.decodedSources.retainVirtualTexture(ownedSource, decodedLease, close);
        } catch (error) {
          decodedLease.release();
          throw error;
        }
        const ownsPageLoad = requestState.abortControllers.get(pageKey) === controller;
        const current = this.#options.resources.get(state.key) === state
          && state.sourceGeneration === sourceGeneration;
        if (!this.#options.active() || !current || state.status !== "ready" || !ownsPageLoad) {
          if (current && ownsPageLoad) {
            this.#transition(requestState, pageKey, { disposition: "discarded", kind: "decoded" });
          }
          this.#options.decodedSources.closeVirtualTextureAsync(ownedSource);
          return;
        }
        if (!state.desiredPageKeys.has(pageKey)) {
          this.#transition(requestState, pageKey, { disposition: "discarded", kind: "decoded" });
          this.#options.decodedSources.closeVirtualTextureAsync(ownedSource);
          this.schedule();
          return;
        }
        const validation = validVirtualTexturePayload(manifest, result);
        if (!validation.valid) {
          this.#transition(requestState, pageKey, { disposition: "invalid", kind: "decoded" });
          state.stats.pageLoadFailures += 1;
          if (state.diagnosticsEnabled) {
            this.#diagnostic(
              `Virtual texture page ${state.activeSource.manifestUri} ${pageKey} has ${validation.actual}; expected ${virtualTextureStoredPageSize(manifest)}x${virtualTextureStoredPageSize(manifest)} ${manifest.pageEncoding}`,
              `virtual-texture-page-size:${state.activeSource.manifestUri}:${pageKey}`,
            );
          }
          this.schedule();
          this.#options.decodedSources.closeVirtualTextureAsync(ownedSource);
          return;
        }
        const resource = virtualTextureGpuResource(this.#options.gpu, state.key);
        if (resource === undefined || !queueVirtualTextureGpuUpload(this.#options.gpu, resource, {
          payload: result,
          page,
          pageKey,
          sourceGeneration,
        })) {
          this.#transition(requestState, pageKey, { disposition: "discarded", kind: "decoded" });
          this.schedule();
          this.#options.decodedSources.closeVirtualTextureAsync(ownedSource);
          return;
        }
        queued = true;
        this.#transition(requestState, pageKey, { disposition: "queued", kind: "decoded" });
        if (consumeVirtualTextureGpuWake(this.#options.gpu)) this.#options.invalidate();
      } catch (error) {
        decodedReservation.cancel();
        const ownsPageLoad = requestState.abortControllers.get(pageKey) === controller;
        const current = this.#options.resources.get(state.key) === state
          && state.sourceGeneration === sourceGeneration;
        const lifecycle = requestState.lifecycles.get(pageKey);
        if (!queued && current && ownsPageLoad && lifecycle?.kind === "loading") {
          this.#transition(requestState, pageKey, { disposition: "invalid", kind: "decoded" });
          state.stats.pageLoadFailures += 1;
          if (state.diagnosticsEnabled) {
            this.#diagnostic(
              `Virtual texture page fulfillment failed for ${state.activeSource.manifestUri} ${pageKey}: ${error instanceof Error ? error.message : String(error)}`,
              `virtual-texture-page-fulfillment:${state.activeSource.manifestUri}:${pageKey}`,
            );
          }
        }
        if (!queued) {
          try {
            this.#options.decodedSources.closeVirtualTextureAsync(ownedSource);
          } catch {
            // The lifetime retains failed closes and wakes its ordinary retry path.
          }
        }
      }
    }, (error: unknown) => {
      decodedReservation.cancel();
      if (
        this.#options.resources.get(state.key) !== state
        || state.sourceGeneration !== sourceGeneration
        || requestState.abortControllers.get(pageKey) !== controller
      ) return;
      if (controller.signal.aborted) {
        this.#transition(requestState, pageKey, { kind: "context-lost" });
        return;
      }
      const retry = this.#transition(requestState, pageKey, { kind: "load-rejected" });
      state.stats.pageLoadFailures += 1;
      if (state.diagnosticsEnabled) {
        this.#diagnostic(
          `Virtual texture page load failed for ${state.activeSource.manifestUri} ${pageKey}: ${error instanceof Error ? error.message : String(error)}`,
          `virtual-texture-page:${state.activeSource.manifestUri}`,
        );
      }
      if (!this.#options.active()) {
        this.#transition(requestState, pageKey, { kind: "context-lost" });
        return;
      }
      this.schedule();
      if (retry.retryDelayMs === undefined) return;
      const timer = setTimeout(() => {
        requestState.retryTimers.delete(pageKey);
        this.#transition(requestState, pageKey, { kind: "retry-elapsed" });
        if (
          !this.#options.active()
          || this.#options.resources.get(state.key) !== state
          || state.sourceGeneration !== sourceGeneration
          || state.status !== "ready"
          || !state.desiredPageKeys.has(pageKey)
        ) {
          this.#purgeObsolete(state, requestState);
          return;
        }
        this.#options.invalidate();
        this.schedule();
      }, retry.retryDelayMs);
      requestState.retryTimers.set(pageKey, timer);
    }).finally(() => {
      if (requestState.abortControllers.get(pageKey) === controller) {
        requestState.abortControllers.delete(pageKey);
      }
      job.release();
      this.schedule();
      this.#options.invalidate();
    });
    return true;
  }
}
