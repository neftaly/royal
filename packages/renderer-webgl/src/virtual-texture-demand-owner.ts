import type { Material } from "@royal/renderer-core";
import type { CpuGeometry } from "./geometry-recipes";
import type { Mat4 } from "./math/mat4";
import { captureFailure, type CapturedFailure } from "./captured-failure";
import type { VertexInputGeometry } from "./vertex-input-arena";
import {
  cachedVirtualTextureCoverageProvider,
  clearVirtualTextureCoverageProviderCache,
  createVirtualTextureCoverageProviderCache,
  releaseVirtualTextureCoverageProviders,
} from "./virtual-texture-coverage-cache";
import {
  createVirtualTextureDemandPlanningWorkspace,
  planVirtualTextureDrawDemand,
  selectVirtualTextureFrameWorkingSet,
  selectVirtualTextureWorkingSet,
  stabilizeVirtualTextureDesiredPagesInto,
  virtualTextureDemandMipCount,
  virtualTextureDemandModelCount,
} from "./virtual-texture-demand";
import {
  type BaseColorTextureResidency,
  type VirtualTextureDrawDemand,
  type VirtualTextureDrawDemandContext,
  type VirtualTextureDrawDemandModelSource,
  type VirtualTextureRef,
  type VirtualTextureRuntimeState,
  type ViewportSize,
} from "./virtual-texture-runtime";
import { VirtualTextureRuntimeShell } from "./virtual-texture-runtime-shell";
import {
  generatedVirtualTexturePageCount,
  virtualTexturePageKey,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
} from "./virtual-texturing";
import type { SurfaceMaterial, TextureAssetUploadRef } from "./webgl/materials";
import {
  setVirtualTextureGpuDesiredPageKeys,
  touchVirtualTextureGpuResidency,
  virtualTextureGpuCachedResidency,
  virtualTextureGpuDrawable,
  virtualTextureGpuExactResidency,
  virtualTextureGpuResource,
  virtualTextureGpuResourceSnapshot,
  type VirtualTextureGpuArena,
} from "./webgl/virtual-texture-gpu-arena";

/** Stops transaction mutation after its first failure while retaining that value. */
const captureUnlessFailed = (
  failure: CapturedFailure | undefined,
  action: () => void,
): CapturedFailure | undefined => failure ?? captureFailure(action);

type VirtualTextureDemandOwnerOptions = {
  readonly consumeGpuOutcomes: () => void;
  readonly ensureGpuResource: (
    state: VirtualTextureRuntimeState,
    manifest: VirtualTextureManifestModel,
    demandedStates: ReadonlySet<VirtualTextureRuntimeState>,
  ) => boolean;
  readonly frame: () => number;
  readonly gpu: VirtualTextureGpuArena;
  readonly recordUnsupported: (texture: VirtualTextureRef, reason: string) => void;
  readonly runtime: VirtualTextureRuntimeShell;
};

/**
 * Owns virtual-texture draw coverage, working-set planning, and atomic frame
 * publication. GPU allocation remains an injected root policy decision.
 */
export class VirtualTextureDemandOwner {
  readonly #advanceablePublicationStates: VirtualTextureRuntimeState[] = [];
  readonly #coverageProviders = createVirtualTextureCoverageProviderCache();
  readonly #options: VirtualTextureDemandOwnerOptions;
  readonly #planning = createVirtualTextureDemandPlanningWorkspace();
  readonly #publicationStates: VirtualTextureRuntimeState[] = [];

  constructor(options: VirtualTextureDemandOwnerOptions) {
    this.#options = options;
  }

  drawDemandContext(
    geometryId: number,
    geometry: CpuGeometry,
    material: Material,
    modelSource: VirtualTextureDrawDemandModelSource,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
  ): VirtualTextureDrawDemandContext | undefined {
    const texture = material.baseColor;
    if (
      material.kind === "wireframe"
      || texture.kind === "solid"
      || (texture.kind === "asset" && this.#options.runtime.autoSource(texture) === undefined)
      || geometry.texCoords0 === undefined
      || geometry.mode !== "triangles"
      || virtualTextureDemandModelCount(modelSource) === 0
    ) {
      return undefined;
    }
    const baseColorCoordinates = (material as SurfaceMaterial).textureCoordinates?.baseColorTexture;
    const requestedSet = baseColorCoordinates?.set === 1 && geometry.texCoords1 !== undefined ? 1 : 0;
    const provider = cachedVirtualTextureCoverageProvider(
      this.#coverageProviders,
      geometryId,
      geometry,
      requestedSet,
    );
    if (provider === undefined) return undefined;
    return {
      modelSource,
      projection,
      provider,
      ...(baseColorCoordinates === undefined ? {} : { textureCoordinates: baseColorCoordinates }),
      view,
      viewportSize,
      ...(texture.sampler?.wrapS === undefined ? {} : { wrapS: texture.sampler.wrapS }),
      ...(texture.sampler?.wrapT === undefined ? {} : { wrapT: texture.sampler.wrapT }),
    };
  }

  resolveBaseColorResidency(
    geometry: VertexInputGeometry,
    material: Material,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency {
    const texture = material.baseColor;
    switch (texture.kind) {
      case "solid":
        return { kind: "none" };
      case "asset":
        return this.#resolveAutoResidency(geometry, material, texture, demandContext);
      case "virtual-asset":
        return this.#resolvePreparedResidency(geometry, material, texture, demandContext);
    }
  }

  finishFrame(commit: boolean): void {
    const publication = this.#options.runtime.finishFrame(commit);
    if (publication === undefined) return;
    let commitFailure: CapturedFailure | undefined;
    for (const state of publication.admissions) {
      if (commitFailure !== undefined) break;
      commitFailure = captureUnlessFailed(commitFailure, () => {
        this.#options.ensureGpuResource(state, state.manifest!, publication.demanded);
      });
    }
    this.#publicationStates.length = 0;
    this.#advanceablePublicationStates.length = 0;
    if (commitFailure === undefined) {
      for (const state of this.#options.runtime.resources.values()) {
        const entry = publication.commits.get(state);
        const submissions = entry?.submissions ?? [];
        const pages = selectVirtualTextureFrameWorkingSet(
          submissions,
          this.#demandCapacity(state),
          entry?.startSubmission ?? 0,
        );
        const prepared = this.#prepareDemand(state, pages);
        if (prepared === undefined) continue;
        this.#publicationStates.push(state);
        const requiresConvergence = submissions.some((submission) => submission.viewportDominant === true);
        if (prepared || !requiresConvergence) this.#advanceablePublicationStates.push(state);
      }
    }
    for (const state of this.#publicationStates) {
      commitFailure = captureUnlessFailed(
        commitFailure,
        () => this.#commitPreparedDemand(state, true),
      );
    }
    for (const state of this.#publicationStates) {
      commitFailure = captureUnlessFailed(
        commitFailure,
        () => this.#touchPublishedDemand(state),
      );
    }
    if (commitFailure === undefined) {
      this.#options.runtime.commitPublication(
        this.#advanceablePublicationStates,
        this.#options.frame(),
      );
    }
    const closeFailure = captureFailure(this.#options.consumeGpuOutcomes);
    this.#options.runtime.requests.schedule();
    this.#publicationStates.length = 0;
    this.#advanceablePublicationStates.length = 0;
    this.#options.runtime.clearFinishedFrame();
    if (commitFailure !== undefined) throw commitFailure.value;
    if (closeFailure !== undefined) throw closeFailure.value;
  }

  releaseGeometry(geometryId: number): void {
    releaseVirtualTextureCoverageProviders(this.#coverageProviders, geometryId);
  }

  clear(): void {
    this.#advanceablePublicationStates.length = 0;
    this.#publicationStates.length = 0;
    clearVirtualTextureCoverageProviderCache(this.#coverageProviders);
  }

  #resolveAutoResidency(
    geometry: VertexInputGeometry,
    material: Material,
    texture: TextureAssetUploadRef,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency {
    const ordinary: BaseColorTextureResidency = { kind: "ordinary", texture };
    if (material.kind === "wireframe" || geometry.mode !== "triangles" || geometry.texCoord0Buffer === undefined) {
      return ordinary;
    }

    const state = this.#options.runtime.acquireAuto(texture);
    if (state === undefined) return ordinary;
    state.stats.preparedResidencyResolutions += 1;
    const drawDemand = state.status === "ready"
      ? this.#drawDemand(state, demandContext)
      : undefined;
    if (drawDemand !== undefined) {
      this.#demandPageCandidates(
        state,
        drawDemand.demandCandidates,
        true,
        drawDemand.preferredCandidates,
        drawDemand.viewportDominant,
      );
    }

    return this.#isAutoCoverageReady(state, drawDemand)
      ? { kind: "prepared-virtual", ordinaryFallback: texture, state }
      : ordinary;
  }

  #resolvePreparedResidency(
    geometry: VertexInputGeometry,
    material: Material,
    texture: VirtualTextureRef,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency {
    if (material.kind === "wireframe") {
      this.#options.recordUnsupported(texture, "virtual textures require surface materials");
      return { kind: "none" };
    }
    if (geometry.mode !== "triangles" || geometry.texCoord0Buffer === undefined) {
      this.#options.recordUnsupported(texture, "virtual textures require triangle geometry with UVs");
      return { kind: "none" };
    }

    const state = this.#options.runtime.acquire(texture);
    state.stats.preparedResidencyResolutions += 1;
    if (state.status === "ready") this.#demandPages(state, demandContext);
    return { kind: "prepared-virtual", state };
  }

  #demandPages(
    state: VirtualTextureRuntimeState,
    context?: VirtualTextureDrawDemandContext,
  ): void {
    const drawDemand = this.#drawDemand(state, context);
    this.#demandPageCandidates(
      state,
      drawDemand.demandCandidates,
      context !== undefined || state.manifest?.pageAddressing === "complete",
      drawDemand.preferredCandidates,
      drawDemand.viewportDominant,
    );
  }

  #demandPageCandidates(
    state: VirtualTextureRuntimeState,
    candidates: readonly VirtualTexturePageId[],
    preferTargetMip = false,
    preferredCandidates?: readonly VirtualTexturePageId[],
    viewportDominant?: true,
  ): void {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") return;
    const demandedPageKeys = state.demandedPageKeysScratch;
    if (!this.#options.runtime.activeFrame) {
      demandedPageKeys.clear();
      for (const page of candidates) demandedPageKeys.add(virtualTexturePageKey(page));
      if (preferredCandidates !== undefined) {
        for (const page of preferredCandidates) demandedPageKeys.add(virtualTexturePageKey(page));
      }
    }
    const convergentCandidates = this.#convergentCandidates(state, candidates);
    const convergentPreferredCandidates = preferredCandidates === undefined
      ? undefined
      : this.#convergentCandidates(state, preferredCandidates);
    if (this.#options.runtime.activeFrame) {
      const nonconvergentCandidates = convergentCandidates.length === candidates.length
        && (preferredCandidates === undefined
          || convergentPreferredCandidates?.length === preferredCandidates.length)
        ? []
        : [...candidates, ...(preferredCandidates ?? [])].filter((page) => (
            !this.#options.runtime.requests.canBecomeResident(state, virtualTexturePageKey(page))
          ));
      this.#options.runtime.submit(
        state,
        this.#frameDemandCapacity(state),
        {
          candidates: convergentCandidates,
          preferTargetMip,
          ...(convergentPreferredCandidates === undefined
            ? {}
            : { preferredCandidates: convergentPreferredCandidates }),
          ...(viewportDominant === undefined ? {} : { viewportDominant }),
        },
        nonconvergentCandidates,
      );
      return;
    }
    this.#applyDemand(
      state,
      convergentPreferredCandidates === undefined
        ? selectVirtualTextureWorkingSet(
            convergentCandidates,
            this.#demandCapacity(state),
            preferTargetMip,
          )
        : selectVirtualTextureFrameWorkingSet(
            [{
              candidates: convergentCandidates,
              preferTargetMip,
              preferredCandidates: convergentPreferredCandidates,
            }],
            this.#demandCapacity(state),
          ),
      true,
    );
  }

  #convergentCandidates(
    state: VirtualTextureRuntimeState,
    candidates: readonly VirtualTexturePageId[],
  ): readonly VirtualTexturePageId[] {
    let includesTerminalPage = false;
    for (const page of candidates) {
      if (!this.#options.runtime.requests.canBecomeResident(state, virtualTexturePageKey(page))) {
        includesTerminalPage = true;
        break;
      }
    }
    if (!includesTerminalPage) return candidates;
    return candidates.filter((page) => this.#options.runtime.requests.canBecomeResident(
      state,
      virtualTexturePageKey(page),
    ));
  }

  #demandCapacity(state: VirtualTextureRuntimeState): number {
    if (state.manifest === undefined) return 0;
    const resource = virtualTextureGpuResource(this.#options.gpu, state.key);
    const gpu = resource === undefined ? undefined : virtualTextureGpuResourceSnapshot(resource);
    return gpu?.allocated === true ? gpu.effectiveSlots : 0;
  }

  #frameDemandCapacity(state: VirtualTextureRuntimeState): number {
    const manifest = state.manifest;
    if (manifest === undefined) return 1;
    const allocated = this.#demandCapacity(state);
    if (allocated > 0) return allocated;
    return Math.min(
      manifest.physicalSlots ?? 4,
      generatedVirtualTexturePageCount(manifest.width, manifest.height, manifest.pageSize),
    );
  }

  #prepareDemand(
    state: VirtualTextureRuntimeState,
    workingCandidates: readonly VirtualTexturePageId[],
  ): boolean | undefined {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") return undefined;
    const resource = virtualTextureGpuResource(this.#options.gpu, state.key);
    const gpu = resource === undefined ? undefined : virtualTextureGpuResourceSnapshot(resource);
    const stabilized = stabilizeVirtualTextureDesiredPagesInto(
      workingCandidates,
      state.desiredPages,
      state.desiredPageKeys,
      gpu?.occupiedSlots ?? 0,
      (page) => virtualTextureGpuCachedResidency(this.#options.gpu, state.key, page) !== undefined,
      this.#demandCapacity(state),
      state.desiredPagesScratch,
      state.desiredPageKeysScratch,
      (page) => this.#options.runtime.requests.canBecomeResident(state, virtualTexturePageKey(page)),
    );
    state.stats.demandAdmissions += stabilized.admissions;
    state.stats.demandRetentions += stabilized.retentions;
    return !stabilized.deferred;
  }

  #commitPreparedDemand(
    state: VirtualTextureRuntimeState,
    commitDemandedPageKeys = false,
  ): void {
    const previousPageKeys = state.desiredPageKeys;
    const previousPages = state.desiredPages;
    state.desiredPageKeys = state.desiredPageKeysScratch;
    state.desiredPages = state.desiredPagesScratch;
    state.desiredPageKeysScratch = previousPageKeys;
    state.desiredPagesScratch = previousPages;
    if (commitDemandedPageKeys) {
      const previousDemandedPageKeys = state.demandedPageKeys;
      state.demandedPageKeys = state.demandedPageKeysScratch;
      state.demandedPageKeysScratch = previousDemandedPageKeys;
    }
    state.demandPublished = true;
    const resource = virtualTextureGpuResource(this.#options.gpu, state.key);
    if (resource !== undefined) {
      setVirtualTextureGpuDesiredPageKeys(this.#options.gpu, resource, state.desiredPageKeys);
    }
    this.#options.runtime.requests.reconcileDemand(state, previousPageKeys);
    // Convergence is woken by decode/upload settlement. Invalidating here
    // would reconsider the same nonresident admissions before they can draw.
  }

  #touchPublishedDemand(state: VirtualTextureRuntimeState): void {
    const manifest = state.manifest;
    if (manifest === undefined || state.status !== "ready") return;
    for (const page of state.desiredPages) {
      touchVirtualTextureGpuResidency(
        this.#options.gpu,
        state.key,
        page,
        virtualTextureDemandMipCount(manifest) - 1,
      );
    }
  }

  #applyDemand(
    state: VirtualTextureRuntimeState,
    workingCandidates: readonly VirtualTexturePageId[],
    commitDemandedPageKeys = false,
  ): void {
    if (this.#prepareDemand(state, workingCandidates) === undefined) return;
    this.#commitPreparedDemand(state, commitDemandedPageKeys);
    this.#touchPublishedDemand(state);
    const closeFailure = captureFailure(this.#options.consumeGpuOutcomes);
    this.#options.runtime.requests.schedule();
    if (closeFailure !== undefined) throw closeFailure.value;
  }

  #drawDemand(
    state: VirtualTextureRuntimeState,
    context: VirtualTextureDrawDemandContext | undefined,
  ): VirtualTextureDrawDemand {
    const manifest = state.manifest;
    if (manifest === undefined) {
      return context === undefined
        ? { demandCandidates: [] }
        : { coverageCandidates: [], demandCandidates: [] };
    }

    const demand = planVirtualTextureDrawDemand({
      ...(state.availablePageKeys === undefined ? {} : { availablePageKeys: state.availablePageKeys }),
      ...(context === undefined ? {} : { context }),
      manifest,
      workspace: this.#planning,
    });
    if (demand.retentionOverflowed === true) {
      state.stats.demandRetentionOverflows += 1;
      if (state.stats.demandRetentionOverflows === 1) {
        this.#options.runtime.diagnose(
          state,
          `Virtual texture ${state.activeSource.manifestUri} exceeded the retained-polygon demand workspace; using bounded conservative refinement`,
          `virtual-texture-demand-retention-overflow:${state.activeSource.manifestUri}`,
        );
      }
    }
    return demand;
  }

  #isAutoCoverageReady(
    state: VirtualTextureRuntimeState,
    drawDemand: VirtualTextureDrawDemand | undefined,
  ): boolean {
    if (state.status !== "ready" || !virtualTextureGpuDrawable(this.#options.gpu, state.key)) return false;
    const candidates = drawDemand?.coverageCandidates;
    if (candidates === undefined) return true;

    return candidates.length > 0
      && candidates.every((page) => (
        virtualTextureGpuExactResidency(this.#options.gpu, state.key, page) !== undefined
      ));
  }
}
