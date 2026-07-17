import type { Material } from "@royal/renderer-core";
import type { CpuGeometry } from "../geometry-recipes";
import type { Mat4 } from "../math/mat4";
import { captureFailure, retainFirstFailure, type CapturedFailure } from "../captured-failure";
import type { VertexInputGeometry } from "../vertex-input/arena";
import {
  cachedVirtualTextureCoverageProvider,
  clearVirtualTextureCoverageProviderCache,
  createVirtualTextureCoverageProviderCache,
  releaseVirtualTextureCoverageProviders,
} from "./coverage-cache";
import {
  createVirtualTextureDemandPlanningWorkspace,
  createVirtualTextureFrameWorkingSetWorkspace,
  planVirtualTextureDrawDemand,
  selectVirtualTextureFrameWorkingSet,
  selectVirtualTextureWorkingSet,
  stabilizeVirtualTextureDesiredPagesInto,
  virtualTextureDemandMipCount,
  virtualTextureDemandModelCount,
} from "./demand";
import {
  type BaseColorTextureResidency,
  type VirtualTextureDrawDemand,
  type VirtualTextureDrawDemandContext,
  type VirtualTextureDrawDemandModelSource,
  type VirtualTextureRef,
  type VirtualTextureRuntimeState,
  type ViewportSize,
} from "./runtime";
import { VirtualTextureRuntimeShell } from "./runtime-shell";
import {
  generatedVirtualTexturePageCount,
  virtualTexturePageKey,
  type VirtualTextureManifestModel,
  type VirtualTexturePageId,
} from "./model";
import type { SurfaceMaterial, TextureAssetUploadRef } from "../webgl/materials";
import {
  setVirtualTextureGpuDesiredPageKeys,
  touchVirtualTextureGpuResidency,
  virtualTextureGpuCachedResidency,
  virtualTextureGpuDrawable,
  virtualTextureGpuExactResidency,
  virtualTextureGpuResource,
  virtualTextureGpuResourceEffectiveSlots,
  virtualTextureGpuResourceOccupiedSlots,
  type VirtualTextureGpuArena,
} from "./gpu-arena";

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

type MutableVirtualTextureDrawDemandContext = {
  -readonly [Key in keyof VirtualTextureDrawDemandContext]: VirtualTextureDrawDemandContext[Key];
};

/** Pure monotonic policy: automatic VT may activate once, but never source-flap afterward. */
export const resolveAutomaticVirtualTextureActivation = (
  activated: boolean,
  drawable: boolean,
  coverageReady: boolean,
): boolean => activated || (drawable && coverageReady);

const NO_BASE_COLOR_RESIDENCY: BaseColorTextureResidency = { kind: "none" };

/**
 * Owns virtual-texture draw coverage, working-set planning, and atomic frame
 * publication. GPU allocation remains an injected root policy decision.
 */
export class VirtualTextureDemandOwner {
  readonly #advanceablePublicationStates: VirtualTextureRuntimeState[] = [];
  readonly #coverageProviders = createVirtualTextureCoverageProviderCache();
  #drawContext: MutableVirtualTextureDrawDemandContext | undefined;
  readonly #options: VirtualTextureDemandOwnerOptions;
  #ordinaryResidency: { kind: "ordinary"; texture: TextureAssetUploadRef } | undefined;
  readonly #planning = createVirtualTextureDemandPlanningWorkspace();
  #preparedResidency: {
    kind: "prepared-virtual";
    ordinaryFallback?: TextureAssetUploadRef;
    state: VirtualTextureRuntimeState;
  } | undefined;
  readonly #publicationStates: VirtualTextureRuntimeState[] = [];
  readonly #workingSet = createVirtualTextureFrameWorkingSetWorkspace();

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
    if (!this.requiresDrawDemand(geometry, material)
      || texture.kind === "solid"
      || virtualTextureDemandModelCount(modelSource) === 0) {
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
    let context = this.#drawContext;
    if (context === undefined) {
      context = { modelSource, projection, provider, view, viewportSize };
      this.#drawContext = context;
    } else {
      context.modelSource = modelSource;
      context.projection = projection;
      context.provider = provider;
      context.view = view;
      context.viewportSize = viewportSize;
    }
    if (baseColorCoordinates === undefined) delete context.textureCoordinates;
    else context.textureCoordinates = baseColorCoordinates;
    if (texture.sampler?.wrapS === undefined) delete context.wrapS;
    else context.wrapS = texture.sampler.wrapS;
    if (texture.sampler?.wrapT === undefined) delete context.wrapT;
    else context.wrapT = texture.sampler.wrapT;
    return context;
  }

  requiresDrawDemand(geometry: CpuGeometry, material: Material): boolean {
    const texture = material.baseColor;
    return material.kind !== "wireframe"
      && texture.kind !== "solid"
      && (texture.kind !== "asset" || this.#options.runtime.autoSource(texture) !== undefined)
      && geometry.texCoords0 !== undefined
      && geometry.mode === "triangles";
  }

  resolveBaseColorResidency(
    geometry: VertexInputGeometry,
    material: Material,
    demandContext: VirtualTextureDrawDemandContext | undefined,
  ): BaseColorTextureResidency {
    const texture = material.baseColor;
    switch (texture.kind) {
      case "solid":
        return NO_BASE_COLOR_RESIDENCY;
      case "asset":
        return this.#resolveAutoResidency(geometry, material, texture, demandContext);
      case "virtual-asset":
        return this.#resolvePreparedResidency(geometry, material, texture, demandContext);
    }
  }

  finishFrame(commit: boolean): void {
    const publication = this.#options.runtime.finishFrame(commit);
    if (publication === undefined) return;
    this.#publicationStates.length = 0;
    this.#advanceablePublicationStates.length = 0;
    let commitFailure: CapturedFailure | undefined;
    try {
      for (const state of publication.admissions) {
        this.#options.ensureGpuResource(state, state.manifest!, publication.demanded);
      }
      for (const state of this.#options.runtime.resources.values()) {
        const entry = publication.commits.get(state);
        const submissions = entry?.submissions ?? [];
        const pages = selectVirtualTextureFrameWorkingSet(
          submissions,
          this.#demandCapacity(state),
          entry?.startSubmission ?? 0,
          this.#workingSet,
        );
        const prepared = this.#prepareDemand(state, pages);
        if (prepared === undefined) continue;
        this.#publicationStates.push(state);
        let requiresConvergence = false;
        for (const submission of submissions) {
          if (submission.viewportDominant === true) {
            requiresConvergence = true;
            break;
          }
        }
        if (prepared || !requiresConvergence) this.#advanceablePublicationStates.push(state);
      }
      for (const state of this.#publicationStates) this.#commitPreparedDemand(state, true);
      for (const state of this.#publicationStates) this.#touchPublishedDemand(state);
      this.#options.runtime.commitPublication(
        this.#advanceablePublicationStates,
        this.#options.frame(),
      );
    } catch (value) {
      commitFailure = { value };
    }

    let closeFailure: CapturedFailure | undefined;
    try {
      this.#options.consumeGpuOutcomes();
    } catch (value) {
      closeFailure = { value };
    }
    try {
      this.#options.runtime.requests.schedule();
    } catch (value) {
      closeFailure = retainFirstFailure(closeFailure, value);
    }
    this.#publicationStates.length = 0;
    this.#advanceablePublicationStates.length = 0;
    try {
      this.#options.runtime.clearFinishedFrame();
    } catch (value) {
      closeFailure = retainFirstFailure(closeFailure, value);
    }
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
    const ordinary = this.#ordinary(texture);
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

    return this.#activateAutoResidencyWhenReady(state, drawDemand)
      ? this.#prepared(state, texture)
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
      return NO_BASE_COLOR_RESIDENCY;
    }
    if (geometry.mode !== "triangles" || geometry.texCoord0Buffer === undefined) {
      this.#options.recordUnsupported(texture, "virtual textures require triangle geometry with UVs");
      return NO_BASE_COLOR_RESIDENCY;
    }

    const state = this.#options.runtime.acquire(texture);
    state.stats.preparedResidencyResolutions += 1;
    if (state.status === "ready") this.#demandPages(state, demandContext);
    return this.#prepared(state);
  }

  #ordinary(texture: TextureAssetUploadRef): BaseColorTextureResidency {
    let residency = this.#ordinaryResidency;
    if (residency === undefined) {
      residency = { kind: "ordinary", texture };
      this.#ordinaryResidency = residency;
    } else residency.texture = texture;
    return residency;
  }

  #prepared(
    state: VirtualTextureRuntimeState,
    ordinaryFallback?: TextureAssetUploadRef,
  ): BaseColorTextureResidency {
    let residency = this.#preparedResidency;
    if (residency === undefined) {
      residency = { kind: "prepared-virtual", state };
      this.#preparedResidency = residency;
    } else residency.state = state;
    if (ordinaryFallback === undefined) delete residency.ordinaryFallback;
    else residency.ordinaryFallback = ordinaryFallback;
    return residency;
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
            0,
            this.#workingSet,
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
    return resource === undefined ? 0 : virtualTextureGpuResourceEffectiveSlots(resource);
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
    const stabilized = stabilizeVirtualTextureDesiredPagesInto(
      workingCandidates,
      state.desiredPages,
      state.desiredPageKeys,
      resource === undefined ? 0 : virtualTextureGpuResourceOccupiedSlots(resource),
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

  #activateAutoResidencyWhenReady(
    state: VirtualTextureRuntimeState,
    drawDemand: VirtualTextureDrawDemand | undefined,
  ): boolean {
    const candidates = drawDemand?.coverageCandidates;
    const coverageReady = candidates === undefined || (candidates.length > 0
      && candidates.every((page) => (
        virtualTextureGpuExactResidency(this.#options.gpu, state.key, page) !== undefined
      )));
    const activated = resolveAutomaticVirtualTextureActivation(
      state.automaticResidencyActivated === true,
      state.status === "ready" && virtualTextureGpuDrawable(this.#options.gpu, state.key),
      coverageReady,
    );
    if (activated) state.automaticResidencyActivated = true;
    return activated;
  }
}
