import {
  cameraWorldPositionFromViewInto,
  identityMat4,
  mat4ValuesEqual,
  multiplyMat4Into,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";
import type { FrameViewport } from "../frame/clear-frame";
import type { WebGlStateOwner } from "../webgl/state-owner";
import type {
  MutableSurfaceDrawFrame,
  SurfaceDrawPacket,
} from "../webgl/draw-state-transition";
import {
  TextureGpuOwner,
  type GpuTextureBinding,
  type OrdinaryTextureGpuSnapshot,
} from "../texture/gpu-owner";
import {
  type CanonicalDrawSurface,
  type CanonicalSurfaceScene,
} from "./scene-lowering";
import {
  createCanonicalLightUniformStorage,
  packCanonicalLightUniformsInto,
} from "./light-uniform-packing";
import type {
  CanonicalSurfaceMaterial,
  CanonicalTextureBinding,
} from "./canonical-material";
import { canonicalMaterialHasTransmission } from "./canonical-material";
import {
  createCanonicalMaterialUniformStorage,
  packCanonicalAttenuationUniformsInto,
  packCanonicalBaseMaterialUniformsInto,
  packCanonicalSpecularUniformsInto,
  packCanonicalTransmissionUniformsInto,
} from "./material-uniform-packing";
import {
  createCanonicalSceneUniformStorage,
  packCanonicalEnvironmentUniformsInto,
  packCanonicalPresentationUniformsInto,
} from "./scene-uniform-packing";
import {
  SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
  SURFACE_FEATURE_ROTATED_ENVIRONMENT,
  SURFACE_FEATURE_STUDIO_ENVIRONMENT,
} from "./surface-program-features";
import {
  SurfaceProgramOwner,
  type StandardProgram,
  type TextureCoordinatesProgram,
  type UnlitProgram,
} from "./surface-program-owner";
import type {
  SurfaceDepthPrepassOwner,
  SurfaceDepthProgram,
} from "./surface-depth-prepass-owner";
import {
  opaqueDepthPrepassRequested,
  planOpaqueDepthPrepass,
  surfaceCanUseOpaqueDepthPrepass,
} from "./surface-depth-prepass";
import {
  IDENTITY_TEXTURE_COORDINATES,
  type CanonicalTextureCoordinates,
} from "../gltf/texture-coordinates";
import {
  SurfaceGeometryGpuOwner,
  type GpuGeometry,
  type GpuGeometrySurface,
} from "./surface-geometry-gpu-owner";
import {
  nextSurfaceAdmissionCount,
  retainedSurfaceAdmissionCount,
} from "./gpu-admission";
import { frustumPlanesInto, worldBoundsVisible } from "./surface-visibility";
import {
  createCompositeFramePlanWorkspace,
  planCompositeFrameInto,
} from "./composite-frame-plan";
import {
  createDrawableLodSelectionWorkspace,
  lodMembershipsSelected,
  selectDrawableLodsInto,
  type LodGroupId,
} from "./lod-selection";
import type { LinearRgba } from "@royal/renderer-core";
import type {
  VirtualTextureGpuBinding,
  VirtualTextureRuntime,
} from "../virtual-texture/runtime-contract";
import {
  ordinaryTextureStorageBudget,
  PersistentGpuBudgetOwner,
} from "../resource/persistent-gpu-budget";
import {
  FrameUploadBudgetOwner,
  type FrameUploadBudgetSnapshot,
} from "../resource/frame-upload-budget";
import { planContiguousRunEnds } from "./contiguous-run-plan";
import {
  surfacesShareMultiDrawState,
  surfacesShareDepthPrepassState,
  type WebGlMultiDraw,
} from "./surface-multi-draw";
import {
  composeSurfaceTextureBindingsInto,
  MATERIAL_TEXTURE_UNITS,
  materialTextureBindingAt,
  presentableBaseColorInto,
  presentableOrdinaryTextureMask,
  residentOrdinaryTextureMask,
  surfaceProgramFeatureBits,
  surfaceTextureUnitMask,
} from "./surface-texture-plan";
import {
  canonicalSurfaceIsDoubleSided,
  planGroupedSurfacePasses,
  planSurfacePasses,
  surfaceDrawPassNeedsDepthOrder,
  type SurfaceDrawPass,
} from "./surface-pass-plan";
import {
  compositeTargetByteLength,
} from "./surface-composite-plan";
import {
  linearCompositeColorBytesPerPixel,
  terminalPresentationRequested,
  type LinearCompositeCapabilities,
} from "./terminal-presentation-plan";
import type { SurfaceCompositeOwner } from "./surface-composite-owner";
import type {
  PrefilteredEnvironmentGpuOwner,
  PrefilteredEnvironmentGpuBinding,
} from "../environment/gpu-owner";
import type { PreparedRoyalEnvironment } from "../environment/royal-environment-ktx1";
import {
  sortSurfaceRunsFrontToBack,
  sortSurfacesBackToFront,
  sortTransmissionSurfaces,
} from "./surface-depth-order";

export type SurfaceFrameView = Readonly<{
  view: Mat4;
  viewProjection: Mat4;
  viewport: FrameViewport;
}>;

export type SurfaceGeometryUploadSnapshot = FrameUploadBudgetSnapshot & Readonly<{
  /** Scene surfaces still waiting for bounded geometry/instance admission. */
  pendingSurfaces: number;
}>;

type GpuSurface = {
  depthOrder: number;
  depthPacket: SurfaceDrawPacket | null;
  depthProgram: SurfaceDepthProgram | null;
  drawPacket: SurfaceDrawPacket;
  readonly geometry: GpuGeometry;
  readonly instanceCount: number;
  readonly mode: number;
  program: StandardProgram | UnlitProgram;
  surface: CanonicalDrawSurface;
  /** Dense transmission visibility slot, or -1 for another pass. */
  readonly slot: number;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly virtualTexture?: VirtualTextureGpuBinding;
};

const SURFACE_UPLOADS_PER_FRAME = 16;
const EMPTY_RUN_ENDS: Uint32Array<ArrayBufferLike> = new Uint32Array(0);
const EMPTY_TEXTURE_BINDINGS: readonly GpuTextureBinding[] = [];

/** @internal Applies one semantic coordinate change into caller-retained state. */
export const applyTextureCoordinates = (
  gl: WebGL2RenderingContext,
  program: TextureCoordinatesProgram | null,
  coordinates: CanonicalTextureCoordinates | undefined,
  previous: CanonicalTextureCoordinates | undefined,
): CanonicalTextureCoordinates | undefined => {
  if (program === null) return previous;
  const resolved = coordinates ?? IDENTITY_TEXTURE_COORDINATES;
  if (resolved === previous) return previous;
  gl.uniform4fv(program.row0, resolved.row0);
  gl.uniform4fv(program.row1, resolved.row1);
  return resolved;
};


const sceneEnvironmentFeatures = (
  scene: CanonicalSurfaceScene | null,
  prefiltered: PrefilteredEnvironmentGpuBinding | undefined,
): number => {
  const environment = scene?.environment;
  if (environment === undefined) return 0;
  const source = environment.source === "royal-prefiltered-v1" && prefiltered !== undefined
    ? SURFACE_FEATURE_PREFILTERED_ENVIRONMENT
    : SURFACE_FEATURE_STUDIO_ENVIRONMENT;
  return environment.rotated ? source | SURFACE_FEATURE_ROTATED_ENVIRONMENT : source;
};


const groupSurfacesForDrawing = (surfaces: readonly GpuSurface[]) =>
  planGroupedSurfacePasses(
    surfaces,
    (resource) => resource.surface.material,
    (resource) => resource.surface.materialSource,
    (resource) => resource.program.program,
  );

/** Pure retained pipeline packet; frame target and viewport stay separate. */
const surfaceDrawPacket = (
  gl: WebGL2RenderingContext,
  surface: CanonicalDrawSurface,
  program: WebGLProgram,
  textureBindings: readonly GpuTextureBinding[],
  textureUnits: number,
  vertexArray: WebGLVertexArrayObject,
): SurfaceDrawPacket => ({
  alphaBlend: surface.material.alphaBlend === true,
  colorWrite: true,
  cullBackFaces: !canonicalSurfaceIsDoubleSided(surface.material),
  depthTest: true,
  depthWrite: surface.material.alphaBlend !== true,
  frontFace: surface.modelHandedness < 0 ? gl.CW : gl.CCW,
  program,
  textureBindings,
  textureUnits,
  vertexArray,
});

/** Coordinates one context generation's program, geometry, texture, and draw-state owners. */
export class SurfaceGpuOwner {
  #admittedSurfaceCount = 0;
  readonly #cameraPosition = new Float32Array(4);
  #compositeActive = false;
  #compositeBindingRevision = 0;
  #compositeGpu: SurfaceCompositeOwner | null = null;
  #compositeLoadGeneration = 0;
  #compositeLoadRequested = false;
  readonly #compositeViewport = { height: 1, width: 1, x: 0, y: 0 };
  readonly #compositeView: {
    view: Mat4;
    viewProjection: Mat4;
    viewport: FrameViewport;
  } = {
    view: identityMat4(),
    viewProjection: identityMat4(),
    viewport: this.#compositeViewport,
  };
  #depthPrepassActive = false;
  #depthPrepassPlan = planOpaqueDepthPrepass([]);
  #depthProgramLoadGeneration = 0;
  #depthProgramLoadRequested = false;
  #depthPrepassOwner: SurfaceDepthPrepassOwner | null = null;
  #depthPrepassRunEnds: Uint32Array<ArrayBufferLike> = EMPTY_RUN_ENDS;
  #directionalLightCount = 0;
  #dirty = false;
  readonly #drawFrame: MutableSurfaceDrawFrame = {
    framebuffer: null,
    viewport: { height: 1, width: 1, x: 0, y: 0 },
  };
  #fullReconcileRequired = true;
  readonly #geometryGpu: SurfaceGeometryGpuOwner;
  #environmentGpu: PrefilteredEnvironmentGpuOwner | null = null;
  #environmentGpuLoadGeneration = 0;
  #environmentGpuLoadRequested = false;
  #environmentGpuPrepared: PreparedRoyalEnvironment | undefined;
  readonly #compositeFramePlan = createCompositeFramePlanWorkspace();
  readonly #gl: WebGL2RenderingContext;
  readonly #onChanged: () => void;
  readonly #onFailure: (error: unknown) => void;
  #opaqueSurfaces: GpuSurface[] = [];
  #opaqueMultiDrawRunEnds: Uint32Array<ArrayBufferLike> = EMPTY_RUN_ENDS;
  #blendedSurfaces: GpuSurface[] = [];
  #transmissionSurfaces: GpuSurface[] = [];
  #gpuScene: CanonicalSurfaceScene | null = null;
  #gpuSurfacesBySceneIndex: GpuSurface[] = [];
  #instanceTransformsPending = false;
  readonly #materialUniforms = createCanonicalMaterialUniformStorage();
  #multiDraw: WebGlMultiDraw | null;
  #multiDrawCounts = new Int32Array(0);
  #multiDrawOffsets = new Int32Array(0);
  readonly #ordinaryBindingScratch = Array<GpuTextureBinding>(MATERIAL_TEXTURE_UNITS);
  readonly #lodSelection = createDrawableLodSelectionWorkspace();
  readonly #lightUniforms = createCanonicalLightUniformStorage();
  readonly #sceneUniforms = createCanonicalSceneUniformStorage();
  readonly #fallbackBaseColor = new Float32Array(4);
  readonly #programs: SurfaceProgramOwner;
  readonly #resourceBudget: PersistentGpuBudgetOwner;
  #scene: CanonicalSurfaceScene | null = null;
  #sceneGlobalsRevision = 0;
  #programMaterialSources = new WeakMap<WebGLProgram, CanonicalSurfaceMaterial>();
  #standardProgramSceneGlobals = new WeakMap<WebGLProgram, number>();
  readonly #textureGpu: TextureGpuOwner;
  readonly #texturePublicationKeys = new Set<string>();
  #terminalPresentationEligible = false;
  #terminalPresentationHasAlphaBlend = false;
  readonly #linearCompositeCapabilities: LinearCompositeCapabilities;
  readonly #uploadBudget: FrameUploadBudgetOwner;
  readonly #transmissionCandidateIndices: number[] = [];
  readonly #viewProjectionModel: MutableMat4 = identityMat4();
  #virtualTexture: VirtualTextureRuntime | null = null;
  #virtualTextureBindingRevision = -1;

  constructor(
    gl: WebGL2RenderingContext,
    budget = new PersistentGpuBudgetOwner(),
    onChanged: () => void = () => undefined,
    onFailure: (error: unknown) => void = () => undefined,
    uploadBudget = new FrameUploadBudgetOwner(),
    etc2Available = true,
  ) {
    this.#geometryGpu = new SurfaceGeometryGpuOwner(gl, budget);
    this.#gl = gl;
    this.#onChanged = onChanged;
    this.#onFailure = onFailure;
    this.#multiDraw = this.#readMultiDraw();
    this.#linearCompositeCapabilities = {
      hasFloatBlendTarget: this.#readExtension("EXT_float_blend"),
      hasFloatColorTarget: this.#readExtension("EXT_color_buffer_float"),
    };
    this.#programs = new SurfaceProgramOwner(gl);
    this.#resourceBudget = budget;
    this.#textureGpu = new TextureGpuOwner(gl, budget, uploadBudget, etc2Available);
    this.#uploadBudget = uploadBudget;
  }

  beginFrame(): void {
    this.#geometryGpu.beginFrame();
    this.#uploadBudget.beginFrame();
    this.#textureGpu.beginFrame();
  }

  dispose(): void {
    this.#environmentGpuLoadGeneration += 1;
    this.#environmentGpuLoadRequested = false;
    this.#environmentGpuPrepared = undefined;
    this.#environmentGpu?.dispose();
    this.#environmentGpu = null;
    this.#geometryGpu.dispose();
    this.#depthProgramLoadGeneration += 1;
    this.#depthProgramLoadRequested = false;
    this.#depthPrepassOwner?.dispose();
    this.#depthPrepassOwner = null;
    this.#textureGpu.dispose();
    this.#programs.dispose();
    this.#compositeLoadGeneration += 1;
    this.#compositeGpu?.dispose();
    this.#compositeGpu = null;
    this.#virtualTexture?.dispose();
    this.#fullReconcileRequired = true;
    this.#admittedSurfaceCount = 0;
    this.#opaqueSurfaces = [];
    this.#opaqueMultiDrawRunEnds = EMPTY_RUN_ENDS;
    this.#blendedSurfaces = [];
    this.#gpuSurfacesBySceneIndex = [];
    this.#gpuScene = null;
    this.#instanceTransformsPending = false;
    this.#scene = null;
    this.#texturePublicationKeys.clear();
    this.#lodSelection.activeGroups.clear();
    this.#lodSelection.selections.clear();
    this.#compositeActive = false;
    this.#compositeBindingRevision = 0;
    this.#transmissionSurfaces = [];
    this.#transmissionCandidateIndices.length = 0;
    this.#compositeFramePlan.visibility = new Uint8Array(0);
    this.#terminalPresentationEligible = false;
    this.#terminalPresentationHasAlphaBlend = false;
    this.#depthPrepassActive = false;
    this.#depthPrepassRunEnds = EMPTY_RUN_ENDS;
  }

  invalidate(): void {
    if (this.#environmentGpuLoadRequested) {
      this.#environmentGpuLoadGeneration += 1;
      this.#environmentGpuLoadRequested = false;
    }
    this.#environmentGpu?.invalidate();
    this.#geometryGpu.invalidate();
    this.#depthPrepassOwner?.invalidate();
    this.#opaqueSurfaces = [];
    this.#depthPrepassRunEnds = EMPTY_RUN_ENDS;
    this.#opaqueMultiDrawRunEnds = EMPTY_RUN_ENDS;
    this.#blendedSurfaces = [];
    this.#transmissionSurfaces = [];
    this.#gpuSurfacesBySceneIndex = [];
    this.#gpuScene = null;
    this.#instanceTransformsPending = false;
    this.#textureGpu.invalidate();
    this.#programs.invalidate();
    this.#programMaterialSources = new WeakMap<WebGLProgram, CanonicalSurfaceMaterial>();
    this.#standardProgramSceneGlobals = new WeakMap<WebGLProgram, number>();
    this.#compositeGpu?.invalidate();
    this.#virtualTexture?.invalidate();
    this.#multiDraw = this.#readMultiDraw();
    this.#setDepthPrepassActive(this.#scene?.camera.position ?? this.#cameraPosition);
    this.#fullReconcileRequired = true;
    this.#admittedSurfaceCount = 0;
    this.#dirty = this.#scene !== null;
    this.#compositeActive = false;
    this.#compositeBindingRevision = this.#compositeGpu?.bindingRevision ?? 0;
    this.#texturePublicationKeys.clear();
  }

  #readMultiDraw(): WebGlMultiDraw | null {
    return typeof this.#gl.getExtension === "function"
      ? this.#gl.getExtension("WEBGL_multi_draw") as WebGlMultiDraw | null
      : null;
  }

  #readExtension(name: string): boolean {
    return typeof this.#gl.getExtension === "function"
      && this.#gl.getExtension(name) !== null;
  }

  /** Current canonical LOD choices shared by visual submission and exact picking. */
  lodSelections(): ReadonlyMap<LodGroupId, number> {
    return this.#lodSelection.selections;
  }

  takeUploadedTextureStorageKeys(): readonly string[] {
    return this.#textureGpu.takeUploadedStorageKeys();
  }

  takeDeniedTextureStorageKeys(): readonly string[] {
    const denied = this.#textureGpu.takeDeniedStorageKeys();
    if (denied.length !== 0) {
      this.#dirty = true;
      this.#fullReconcileRequired = true;
    }
    return denied;
  }

  ordinaryTextureSnapshot(): OrdinaryTextureGpuSnapshot {
    return this.#textureGpu.snapshot();
  }

  /**
   * Cold admission plan for ordinary texture fitting. Geometry and the
   * size-dependent composite target keep their exact capacity before decode.
   */
  ordinaryTextureStorageBudget(
    persistentBudgetBytes: number,
    width: number,
    height: number,
  ): number {
    const scene = this.#scene;
    if (scene === null) return ordinaryTextureStorageBudget(persistentBudgetBytes, 0);
    let plannedNonTextureBytes = this.#geometryGpu.plannedRetainedBytes(scene.surfaces);
    const transmissionRequested = this.#transmissionCandidateIndices.length !== 0;
    const terminalPresentation = terminalPresentationRequested(
      this.#terminalPresentationEligible,
      this.#terminalPresentationHasAlphaBlend,
      this.#linearCompositeCapabilities,
      scene.surfaces.length,
    );
    if (transmissionRequested || terminalPresentation) {
      const colorBytesPerPixel = linearCompositeColorBytesPerPixel(
        this.#linearCompositeCapabilities,
        this.#terminalPresentationHasAlphaBlend,
      );
      plannedNonTextureBytes += compositeTargetByteLength(
        width,
        height,
        colorBytesPerPixel,
        transmissionRequested ? {} : { sceneColor: false },
      );
    }
    return ordinaryTextureStorageBudget(persistentBudgetBytes, plannedNonTextureBytes);
  }

  geometryUploadSnapshot(): SurfaceGeometryUploadSnapshot {
    return {
      ...this.#geometryGpu.snapshot(),
      pendingSurfaces: Math.max(0, (this.#scene?.surfaces.length ?? 0) - this.#admittedSurfaceCount),
    };
  }

  texturePublicationsPending(): boolean {
    return this.#texturePublicationKeys.size > 0;
  }

  surfacePublicationsPending(): boolean {
    return this.#admittedSurfaceCount < (this.#scene?.surfaces.length ?? 0);
  }

  setScene(scene: CanonicalSurfaceScene | null): void {
    if (this.#scene === scene) return;
    this.#sceneGlobalsRevision += 1;
    this.#programMaterialSources = new WeakMap<WebGLProgram, CanonicalSurfaceMaterial>();
    this.#admittedSurfaceCount = retainedSurfaceAdmissionCount(
      this.#scene?.surfaces ?? [],
      scene?.surfaces ?? [],
      this.#admittedSurfaceCount,
    );
    this.#scene = scene;
    this.#depthPrepassPlan = planOpaqueDepthPrepass(scene?.surfaces ?? []);
    this.#setDepthPrepassActive(scene?.camera.position ?? this.#cameraPosition);
    this.#instanceTransformsPending = false;
    this.#compositeGpu?.resetAdmission();
    this.#terminalPresentationEligible = scene !== null
      && scene.surfaces.every((surface) => surface.material.kind === "standard");
    this.#terminalPresentationHasAlphaBlend = scene?.surfaces.some(
      (surface) => surface.material.alphaBlend === true,
    ) ?? false;
    this.#transmissionCandidateIndices.length = 0;
    for (let index = 0; index < (scene?.surfaces.length ?? 0); index += 1) {
      if (canonicalMaterialHasTransmission(scene!.surfaces[index]!.material)) {
        this.#transmissionCandidateIndices.push(index);
      }
    }
    this.#dirty = true;
    this.#fullReconcileRequired = true;
    this.#texturePublicationKeys.clear();
    this.#virtualTexture?.setScene(scene);
  }

  setPrefilteredEnvironment(prepared: PreparedRoyalEnvironment | undefined): boolean {
    this.#environmentGpuPrepared = prepared;
    if (prepared === undefined && this.#environmentGpuLoadRequested) {
      this.#environmentGpuLoadGeneration += 1;
      this.#environmentGpuLoadRequested = false;
    }
    const owner = this.#environmentGpu;
    if (owner === null) {
      if (prepared !== undefined) this.#requestEnvironmentGpuOwner();
      return false;
    }
    if (!owner.set(prepared)) return false;
    this.#sceneGlobalsRevision += 1;
    this.#dirty = true;
    this.#fullReconcileRequired = true;
    return true;
  }

  setVirtualTextureRuntime(runtime: VirtualTextureRuntime | null): void {
    if (this.#virtualTexture === runtime) return;
    this.#virtualTexture?.dispose();
    this.#virtualTexture = runtime;
    this.#virtualTextureBindingRevision = runtime?.bindingRevision ?? -1;
    this.#programs.setVirtualTextureDeclarations(runtime?.shaderSource.declarations ?? "");
    runtime?.setScene(this.#scene);
    this.#dirty = true;
    this.#fullReconcileRequired = true;
  }

  publishTextureScene(scene: CanonicalSurfaceScene, textureKey: string): void {
    if (this.#scene === null || this.#scene.surfaces.length !== scene.surfaces.length) {
      this.setScene(scene);
      return;
    }
    this.#scene = scene;
    this.#terminalPresentationEligible = scene.surfaces.every(
      (surface) => surface.material.kind === "standard",
    );
    this.#terminalPresentationHasAlphaBlend = scene.surfaces.some(
      (surface) => surface.material.alphaBlend === true,
    );
    this.#texturePublicationKeys.add(textureKey);
    this.#dirty = true;
  }

  /** Publishes retained instance matrices without replacing static scene identity. */
  publishInstanceTransforms(): void {
    if (this.#scene === null) return;
    this.#depthPrepassPlan = planOpaqueDepthPrepass(this.#scene.surfaces);
    this.#dirty = true;
    if (
      this.#gpuScene !== this.#scene
      || this.#admittedSurfaceCount < this.#scene.surfaces.length
    ) this.#fullReconcileRequired = true;
    else this.#instanceTransformsPending = true;
  }

  /** Commits a bounded progressive resource batch without drawing an unchanged frame. */
  flushResourcePublications(state: WebGlStateOwner): boolean {
    if (!this.#dirty || this.#admittedSurfaceCount === 0) return false;
    this.#reconcilePendingResources(state);
    return true;
  }

  drawViews(
    views: readonly SurfaceFrameView[],
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    clearColor: LinearRgba,
  ): boolean {
    const scene = this.#scene;
    if (scene !== null && views.length !== 0) {
      cameraWorldPositionFromViewInto(this.#cameraPosition, views[0]!.view);
      this.#setDepthPrepassActive(this.#cameraPosition);
    }
    planCompositeFrameInto(
      scene?.surfaces ?? [],
      views,
      this.#transmissionCandidateIndices,
      this.#terminalPresentationEligible,
      this.#terminalPresentationHasAlphaBlend,
      this.#linearCompositeCapabilities,
      this.#compositeFramePlan,
    );
    const {
      compositeRequested,
      height,
      sceneColorMaxRoughness,
      terminalPresentation,
      transmissionRequested,
      visibilityStride,
      width,
    } = this.#compositeFramePlan;
    let compositeActive = false;
    if (compositeRequested) {
      const composite = this.#compositeGpu;
      if (composite === null) this.#requestCompositeOwner();
      else {
        composite.setSceneColorRequired(transmissionRequested);
        composite.setSceneColorMaxRoughness(sceneColorMaxRoughness);
        compositeActive = composite.ensure(
          width,
          height,
          state,
          terminalPresentation,
          this.#terminalPresentationHasAlphaBlend,
        );
        if (this.#compositeBindingRevision !== composite.bindingRevision) {
          this.#compositeBindingRevision = composite.bindingRevision;
          this.#dirty = true;
          this.#fullReconcileRequired = true;
        }
      }
    } else {
      if (this.#compositeLoadRequested) {
        this.#compositeLoadGeneration += 1;
        this.#compositeLoadRequested = false;
      }
      if (this.#compositeGpu?.retainedTarget === true) {
        this.#compositeGpu?.deactivate();
        state.invalidate();
      }
    }
    if (this.#compositeActive !== compositeActive) {
      this.#compositeActive = compositeActive;
      this.#dirty = true;
      this.#fullReconcileRequired = true;
    }
    let virtualTexturePending = false;
    if (this.#virtualTexture !== null) {
      const update = this.#virtualTexture.update(views);
      virtualTexturePending = update.pending;
      if (update.webGlStateChanged) {
        state.invalidateTextureUnit(0);
        state.invalidateTextureUnit(5);
      }
      if (this.#virtualTextureBindingRevision !== this.#virtualTexture.bindingRevision) {
        this.#virtualTextureBindingRevision = this.#virtualTexture.bindingRevision;
        this.#dirty = true;
        this.#fullReconcileRequired = true;
      }
    }
    this.#reconcilePendingResources(state);
    if (scene === null) return virtualTexturePending;
    const presentationWorkPending = virtualTexturePending
      || this.#admittedSurfaceCount < scene.surfaces.length;
    if (
      this.#opaqueSurfaces.length
        + this.#transmissionSurfaces.length
        + this.#blendedSurfaces.length === 0
    ) return presentationWorkPending;
    selectDrawableLodsInto(
      scene.lodGroups,
      views,
      this.#gpuSurfacesBySceneIndex,
      this.#lodSelection,
    );
    if (!this.#compositeActive) {
      for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
        const view = views[viewIndex]!;
        this.#prepareView(view);
        this.#drawView(view, viewIndex, visibilityStride, framebuffer, state, scene, "all");
      }
    } else {
      const composite = this.#compositeGpu;
      if (composite === null) throw new Error("Royal transmission composite owner is missing");
      for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
        const view = views[viewIndex]!;
        this.#prepareView(view);
        this.#compositeViewport.width = view.viewport.width;
        this.#compositeViewport.height = view.viewport.height;
        this.#compositeView.view = view.view;
        this.#compositeView.viewProjection = view.viewProjection;
        composite.clear(clearColor, state);
        this.#drawView(
          this.#compositeView,
          viewIndex,
          visibilityStride,
          composite.framebuffer(),
          state,
          scene,
          "opaque",
        );
        if (transmissionRequested) composite.snapshot(state);
        this.#drawView(
          this.#compositeView,
          viewIndex,
          visibilityStride,
          composite.framebuffer(),
          state,
          scene,
          "remaining",
        );
        composite.present(
          framebuffer,
          view.viewport,
          scene.exposure,
          scene.toneMapping,
          state,
        );
      }
    }
    return presentationWorkPending;
  }

  #prepareView(frameView: SurfaceFrameView): void {
    cameraWorldPositionFromViewInto(this.#cameraPosition, frameView.view);
    this.#cameraPosition[3] = 1;
    frustumPlanesInto(this.#compositeFramePlan.frustumPlanes, frameView.viewProjection);
  }

  #reconcilePendingResources(state: WebGlStateOwner): void {
    if (!this.#dirty) return;
    if (this.#instanceTransformsPending && !this.#fullReconcileRequired) {
      if (this.#geometryGpu.updateInstanceTransforms(this.#scene?.surfaces ?? [])) {
        this.#instanceTransformsPending = false;
        this.#dirty = this.#texturePublicationKeys.size > 0;
      } else {
        this.#fullReconcileRequired = true;
      }
    }
    if (this.#dirty && !this.#flushTexturePublications(state)) {
      try {
        this.#reconcile();
      } finally {
        state.invalidateVertexArray();
        state.invalidateTextureUnit(0);
      }
    }
  }

  #flushTexturePublications(state: WebGlStateOwner): boolean {
    if (
      !this.#dirty
      || this.#fullReconcileRequired
      || this.#texturePublicationKeys.size === 0
    ) return false;
    try {
      this.#reconcileTexturePublications();
    } finally {
      state.invalidateTextureUnit(0);
    }
    return true;
  }

  #requestCompositeOwner(): void {
    if (this.#compositeLoadRequested) return;
    this.#compositeLoadRequested = true;
    const generation = ++this.#compositeLoadGeneration;
    void import("./surface-composite-owner").then(({
      SurfaceCompositeOwner,
      transmissionShaderSource,
    }) => {
      if (generation !== this.#compositeLoadGeneration) return;
      this.#compositeLoadRequested = false;
      if (
        this.#scene === null
        || (
          this.#transmissionCandidateIndices.length === 0
          && !terminalPresentationRequested(
            this.#terminalPresentationEligible,
            this.#terminalPresentationHasAlphaBlend,
            this.#linearCompositeCapabilities,
            this.#scene.surfaces.length,
          )
        )
      ) return;
      this.#programs.setTransmissionShaderSource(transmissionShaderSource);
      this.#compositeGpu = new SurfaceCompositeOwner(
        this.#gl,
        this.#resourceBudget,
        this.#linearCompositeCapabilities,
      );
      this.#dirty = true;
      this.#fullReconcileRequired = true;
      this.#onChanged();
    }).catch((error: unknown) => {
      if (generation !== this.#compositeLoadGeneration) return;
      this.#compositeLoadRequested = false;
      this.#onFailure(error);
    });
  }

  #setDepthPrepassActive(cameraPosition: ArrayLike<number>): void {
    const active = this.#multiDraw !== null
      && opaqueDepthPrepassRequested(
        this.#depthPrepassPlan,
        cameraPosition,
        this.#depthPrepassActive,
      );
    if (active === this.#depthPrepassActive) {
      if (active && this.#depthPrepassOwner === null) this.#requestDepthPrepassOwner();
      return;
    }
    this.#depthPrepassActive = active;
    if (active) {
      if (this.#depthPrepassOwner === null) this.#requestDepthPrepassOwner();
      else {
        this.#dirty = true;
        this.#fullReconcileRequired = true;
      }
      return;
    }
    if (this.#multiDraw !== null && this.#depthPrepassPlan.candidateCount >= 32) return;
    if (this.#depthProgramLoadRequested) {
      this.#depthProgramLoadGeneration += 1;
      this.#depthProgramLoadRequested = false;
    }
    this.#depthPrepassOwner?.dispose();
    this.#depthPrepassOwner = null;
  }

  #requestDepthPrepassOwner(): void {
    if (this.#depthProgramLoadRequested || this.#depthPrepassOwner !== null) return;
    this.#depthProgramLoadRequested = true;
    const generation = ++this.#depthProgramLoadGeneration;
    void import("./surface-depth-prepass-owner").then(({ SurfaceDepthPrepassOwner }) => {
      if (generation !== this.#depthProgramLoadGeneration) return;
      this.#depthProgramLoadRequested = false;
      if (!this.#depthPrepassActive) return;
      const multiDraw = this.#multiDraw;
      if (multiDraw === null) return;
      this.#depthPrepassOwner = new SurfaceDepthPrepassOwner(this.#gl, multiDraw);
      this.#dirty = true;
      this.#fullReconcileRequired = true;
      this.#onChanged();
    }).catch((error: unknown) => {
      if (generation !== this.#depthProgramLoadGeneration) return;
      this.#depthProgramLoadRequested = false;
      this.#onFailure(error);
    });
  }

  #requestEnvironmentGpuOwner(): void {
    if (this.#environmentGpuLoadRequested || this.#environmentGpuPrepared === undefined) return;
    this.#environmentGpuLoadRequested = true;
    const generation = ++this.#environmentGpuLoadGeneration;
    void import("../environment/gpu-owner").then(({ PrefilteredEnvironmentGpuOwner }) => {
      if (generation !== this.#environmentGpuLoadGeneration) return;
      this.#environmentGpuLoadRequested = false;
      const prepared = this.#environmentGpuPrepared;
      if (prepared === undefined) return;
      const owner = new PrefilteredEnvironmentGpuOwner(this.#gl, this.#resourceBudget);
      try {
        owner.set(prepared);
      } catch (error) {
        owner.dispose();
        this.#onFailure(error);
        return;
      }
      this.#environmentGpu = owner;
      this.#sceneGlobalsRevision += 1;
      this.#dirty = true;
      this.#fullReconcileRequired = true;
      this.#onChanged();
    }).catch((error: unknown) => {
      if (generation !== this.#environmentGpuLoadGeneration) return;
      this.#environmentGpuLoadRequested = false;
      this.#onFailure(error);
    });
  }

  #drawView(
    frameView: SurfaceFrameView,
    viewIndex: number,
    visibilityStride: number,
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    scene: CanonicalSurfaceScene,
    pass: SurfaceDrawPass,
  ): void {
    this.#drawFrame.framebuffer = framebuffer;
    this.#drawFrame.viewport = frameView.viewport;
    const view = frameView.view;
    const viewProjection = frameView.viewProjection;
    let initializedProgram: WebGLProgram | null = null;
    let baseColorCoordinates: CanonicalTextureCoordinates | undefined;
    let emissiveCoordinates: CanonicalTextureCoordinates | undefined;
    let materialProgram: WebGLProgram | null = null;
    let materialSource: CanonicalSurfaceMaterial | null = null;
    let metallicRoughnessCoordinates: CanonicalTextureCoordinates | undefined;
    let normalCoordinates: CanonicalTextureCoordinates | undefined;
    let occlusionCoordinates: CanonicalTextureCoordinates | undefined;
    let specularColorCoordinates: CanonicalTextureCoordinates | undefined;
    let specularCoordinates: CanonicalTextureCoordinates | undefined;
    let thicknessCoordinates: CanonicalTextureCoordinates | undefined;
    let transmissionCoordinates: CanonicalTextureCoordinates | undefined;
    let standardGlobalsProgram: WebGLProgram | null = null;
    let transformModel: Mat4 | null = null;
    let transformProgram: WebGLProgram | null = null;
    const gl = this.#gl;
    if (surfaceDrawPassNeedsDepthOrder(pass)) {
      sortTransmissionSurfaces(this.#transmissionSurfaces, view);
      sortSurfacesBackToFront(this.#blendedSurfaces, view);
    }
    if (pass !== "remaining") {
      sortSurfaceRunsFrontToBack(
        this.#opaqueSurfaces,
        this.#opaqueMultiDrawRunEnds,
        view,
      );
      if (this.#depthPrepassActive) {
        this.#depthPrepassOwner?.draw(
          this.#drawFrame,
          frameView.viewProjection,
          this.#opaqueSurfaces,
          this.#depthPrepassRunEnds,
          this.#lodSelection.selections,
          this.#compositeFramePlan.frustumPlanes,
          state,
        );
      }
    }
    const opaqueCount = this.#opaqueSurfaces.length;
    const transmissionEnd = opaqueCount + this.#transmissionSurfaces.length;
    const surfaceCount = transmissionEnd + this.#blendedSurfaces.length;
    const firstIndex = pass === "remaining" ? opaqueCount : 0;
    const endIndex = pass === "opaque" ? opaqueCount : surfaceCount;
    for (let index = firstIndex; index < endIndex; index += 1) {
      const opaqueBucket = index < opaqueCount;
      const transmissionBucket = !opaqueBucket && index < transmissionEnd;
      const bucket = opaqueBucket
        ? this.#opaqueSurfaces
        : transmissionBucket ? this.#transmissionSurfaces : this.#blendedSurfaces;
      const bucketOffset = opaqueBucket
        ? 0
        : transmissionBucket ? opaqueCount : transmissionEnd;
      const bucketIndex = index - bucketOffset;
      const resource = bucket[bucketIndex]!;
      const surface = resource.surface;
      if (!lodMembershipsSelected(surface.lods, this.#lodSelection.selections)) continue;
      if (transmissionBucket) {
        if (
          this.#compositeFramePlan.visibility[
            viewIndex * visibilityStride + resource.slot
          ] !== 1
        ) continue;
      } else if (!worldBoundsVisible(
        surface.worldBounds,
        this.#compositeFramePlan.frustumPlanes,
      )) continue;
      const program = resource.program;
      state.applySurfaceDraw(this.#drawFrame, resource.drawPacket);
      if (initializedProgram !== program.program) {
        this.#programs.initializeSamplers(program);
        initializedProgram = program.program;
      }
      const programChanged = materialProgram !== program.program;
      const transformChanged = transformProgram !== program.program
        || transformModel === null
        || (
          transformModel !== surface.model
          && !mat4ValuesEqual(transformModel, surface.model)
        );
      const materialChanged = programChanged
        ? this.#programMaterialSources.get(program.program) !== surface.materialSource
        : materialSource !== surface.materialSource;
      if (programChanged) {
        baseColorCoordinates = undefined;
        emissiveCoordinates = undefined;
        metallicRoughnessCoordinates = undefined;
        normalCoordinates = undefined;
        occlusionCoordinates = undefined;
        specularColorCoordinates = undefined;
        specularCoordinates = undefined;
        thicknessCoordinates = undefined;
        transmissionCoordinates = undefined;
      }
      if (program.kind === "unlit") {
        if (transformChanged) {
          multiplyMat4Into(this.#viewProjectionModel, viewProjection, surface.model);
          gl.uniformMatrix4fv(program.viewProjectionModel, false, this.#viewProjectionModel);
        }
        if (materialChanged) {
          gl.uniform4fv(
            program.color,
            presentableBaseColorInto(
              this.#fallbackBaseColor,
              surface.material,
              resource.drawPacket.textureBindings[0]!.texture !== null,
            ),
          );
          baseColorCoordinates = applyTextureCoordinates(
            gl,
            program.textureCoordinates,
            surface.material.baseColorTextureCoordinates,
            baseColorCoordinates,
          );
          if (program.alphaCutoff !== null) {
            gl.uniform1f(program.alphaCutoff, surface.material.alphaCutoff ?? 0.5);
          }
          this.#applyVirtualTexture(program, resource.virtualTexture);
        }
      } else {
        const material = surface.material;
        if (material.kind !== "standard") {
          throw new Error("Royal standard program got a non-standard material");
        }
        if (standardGlobalsProgram !== program.program) {
          gl.uniformMatrix4fv(program.viewProjection, false, viewProjection);
          gl.uniform4fv(program.cameraWorldPosition, this.#cameraPosition);
          if (
            this.#standardProgramSceneGlobals.get(program.program)
              !== this.#sceneGlobalsRevision
          ) {
            if (
              program.directionalLightCount !== null
              && program.directionalLightColors !== null
              && program.directionalLightDirections !== null
            ) {
              gl.uniform1i(program.directionalLightCount, this.#directionalLightCount);
              gl.uniform4fv(program.directionalLightColors, this.#lightUniforms.directionalColors);
              gl.uniform4fv(
                program.directionalLightDirections,
                this.#lightUniforms.directionalDirections,
              );
            }
            if (
              program.punctualLightCount !== null
              && program.punctualLightColors !== null
              && program.punctualLightDirections !== null
              && program.punctualLightPositions !== null
              && program.punctualLightSpotCones !== null
            ) {
              gl.uniform1i(program.punctualLightCount, scene.punctualLights.length);
              gl.uniform4fv(program.punctualLightColors, this.#lightUniforms.punctualColors);
              gl.uniform4fv(
                program.punctualLightDirections,
                this.#lightUniforms.punctualDirections,
              );
              gl.uniform4fv(program.punctualLightPositions, this.#lightUniforms.punctualPositions);
              gl.uniform4fv(program.punctualLightSpotCones, this.#lightUniforms.punctualSpotCones);
            }
            if (program.environmentSettings !== null) {
              const environment = scene.environment;
              if (environment === undefined) {
                throw new Error("Royal studio environment state is missing");
              }
              if (program.environmentRotation !== null) {
                gl.uniformMatrix4fv(program.environmentRotation, false, environment.rotation);
              }
              const prefiltered = program.environmentCoefficients === null
                ? undefined
                : this.#environmentGpu?.binding;
              packCanonicalEnvironmentUniformsInto(
                environment,
                prefiltered?.mipCount,
                this.#sceneUniforms,
              );
              gl.uniform4fv(
                program.environmentSettings,
                this.#sceneUniforms.environmentSettings,
              );
              if (program.environmentCoefficients !== null) {
                if (prefiltered === undefined) {
                  throw new Error("Royal prefiltered environment GPU state is missing");
                }
                gl.uniform4fv(program.environmentCoefficients, prefiltered.coefficients);
              }
            }
            if (program.presentation !== null) {
              packCanonicalPresentationUniformsInto(scene, this.#sceneUniforms);
              gl.uniform4fv(program.presentation, this.#sceneUniforms.presentation);
            }
            this.#standardProgramSceneGlobals.set(
              program.program,
              this.#sceneGlobalsRevision,
            );
          }
          standardGlobalsProgram = program.program;
        }
        if (transformChanged) {
          gl.uniformMatrix4fv(program.model, false, surface.model);
          gl.uniformMatrix4fv(program.normalTransform, false, surface.normalTransform);
        }
        if (materialChanged) {
          gl.uniform4fv(
            program.baseColor,
            presentableBaseColorInto(
              this.#fallbackBaseColor,
              material,
              resource.drawPacket.textureBindings[0]!.texture !== null,
            ),
          );
          baseColorCoordinates = applyTextureCoordinates(
            gl,
            program.textureCoordinates,
            material.baseColorTextureCoordinates,
            baseColorCoordinates,
          );
          metallicRoughnessCoordinates = applyTextureCoordinates(
            gl,
            program.metallicRoughnessCoordinates,
            material.metallicRoughnessTextureCoordinates,
            metallicRoughnessCoordinates,
          );
          normalCoordinates = applyTextureCoordinates(
            gl,
            program.normalTextureCoordinates,
            material.normalTextureCoordinates,
            normalCoordinates,
          );
          emissiveCoordinates = applyTextureCoordinates(
            gl,
            program.emissiveCoordinates,
            material.emissiveTextureCoordinates,
            emissiveCoordinates,
          );
          occlusionCoordinates = applyTextureCoordinates(
            gl,
            program.occlusionCoordinates,
            material.occlusionTextureCoordinates,
            occlusionCoordinates,
          );
          specularCoordinates = applyTextureCoordinates(
            gl,
            program.specularCoordinates,
            material.specularTextureCoordinates,
            specularCoordinates,
          );
          specularColorCoordinates = applyTextureCoordinates(
            gl,
            program.specularColorCoordinates,
            material.specularColorTextureCoordinates,
            specularColorCoordinates,
          );
          transmissionCoordinates = applyTextureCoordinates(
            gl,
            program.transmissionCoordinates,
            material.transmissionTextureCoordinates,
            transmissionCoordinates,
          );
          thicknessCoordinates = applyTextureCoordinates(
            gl,
            program.thicknessCoordinates,
            material.thicknessTextureCoordinates,
            thicknessCoordinates,
          );
          if (program.occlusionStrength !== null) {
            gl.uniform1f(program.occlusionStrength, material.occlusionStrength);
          }
          packCanonicalBaseMaterialUniformsInto(
            material,
            program.alphaMasked,
            (resource.drawPacket.textureUnits & 8) !== 0,
            this.#materialUniforms,
          );
          gl.uniform4fv(program.emissiveFactor, this.#materialUniforms.emissiveAndF0);
          gl.uniform4fv(program.materialFactors, this.#materialUniforms.materialFactors);
          if (program.specularFactors !== null) {
            packCanonicalSpecularUniformsInto(material, this.#materialUniforms);
            gl.uniform4fv(program.specularFactors, this.#materialUniforms.specularFactors);
          }
          if (program.transmissionFactors !== null) {
            packCanonicalTransmissionUniformsInto(
              material,
              this.#compositeGpu?.sceneColorMaxLod ?? 0,
              this.#materialUniforms,
            );
            gl.uniform4fv(
              program.transmissionFactors,
              this.#materialUniforms.transmissionFactors,
            );
            if (program.attenuationColor !== null) {
              packCanonicalAttenuationUniformsInto(material, this.#materialUniforms);
              gl.uniform4fv(program.attenuationColor, this.#materialUniforms.attenuation);
            }
          }
          this.#applyVirtualTexture(program, resource.virtualTexture);
        }
      }
      if (materialChanged) {
        this.#programMaterialSources.set(program.program, surface.materialSource);
      }
      materialProgram = program.program;
      materialSource = surface.materialSource;
      transformModel = surface.model;
      transformProgram = program.program;
      if (
        this.#multiDraw !== null
        && resource.instanceCount === 0
        && resource.geometry.indexOffset <= 0x7fff_ffff
      ) {
        this.#multiDrawCounts[0] = resource.geometry.indexCount;
        this.#multiDrawOffsets[0] = resource.geometry.indexOffset;
        let drawCount = 1;
        let runEnd = this.#opaqueMultiDrawRunEnds[index] ?? index + 1;
        if (index >= opaqueCount) {
          while (
            runEnd - bucketOffset < bucket.length
            && surfacesShareMultiDrawState(
              bucket[runEnd - bucketOffset - 1]!,
              bucket[runEnd - bucketOffset]!,
            )
          ) runEnd += 1;
        }
        let nextIndex = index + 1;
        for (; nextIndex < runEnd; nextIndex += 1) {
          const next = bucket[nextIndex - bucketOffset]!;
          if (next.geometry.indexOffset > 0x7fff_ffff) break;
          if (
            lodMembershipsSelected(next.surface.lods, this.#lodSelection.selections)
            && (transmissionBucket
              ? this.#compositeFramePlan.visibility[
                  viewIndex * visibilityStride + next.slot
                ] === 1
              : worldBoundsVisible(
                next.surface.worldBounds,
                this.#compositeFramePlan.frustumPlanes,
              ))
          ) {
            this.#multiDrawCounts[drawCount] = next.geometry.indexCount;
            this.#multiDrawOffsets[drawCount] = next.geometry.indexOffset;
            drawCount += 1;
          }
        }
        if (drawCount > 1) {
          this.#multiDraw.multiDrawElementsWEBGL(
            resource.mode,
            this.#multiDrawCounts,
            0,
            resource.geometry.indexType,
            this.#multiDrawOffsets,
            0,
            drawCount,
          );
          index = nextIndex - 1;
        } else {
          gl.drawElements(
            resource.mode,
            resource.geometry.indexCount,
            resource.geometry.indexType,
            resource.geometry.indexOffset,
          );
        }
      } else if (resource.instanceCount > 0) {
        gl.drawElementsInstanced(
          resource.mode,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          resource.geometry.indexOffset,
          resource.instanceCount,
        );
      } else {
        gl.drawElements(
          resource.mode,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          resource.geometry.indexOffset,
        );
      }
    }
  }

  #retainOrdinaryTextureBindings(
    material: CanonicalSurfaceMaterial,
  ): readonly GpuTextureBinding[] {
    for (let unit = 0; unit < MATERIAL_TEXTURE_UNITS; unit += 1) {
      this.#ordinaryBindingScratch[unit] = this.#textureGpu.retain(
        materialTextureBindingAt(material, unit),
      );
    }
    return this.#ordinaryBindingScratch;
  }

  #prepareGpuSurface(
    geometrySurface: GpuGeometrySurface,
    ordinaryBindings: readonly GpuTextureBinding[],
    bindingOffset: number,
    scene: CanonicalSurfaceScene | null,
    sceneIndex: number,
  ): GpuSurface {
    const material = geometrySurface.surface.material;
    const virtualTexture = material.baseColorVirtualAsset !== undefined
      ? this.#virtualTexture?.binding(material.baseColorVirtualAsset)
      : material.baseColorAsset === undefined
        ? undefined
        : this.#virtualTexture?.automaticBinding(material.baseColorAsset);
    const features = surfaceProgramFeatureBits({
      environmentFeatures: sceneEnvironmentFeatures(scene, this.#environmentGpu?.binding),
      hasDirectionalLights: (scene?.directionalLights.length ?? 0) > 0,
      hasPunctualLights: (scene?.punctualLights.length ?? 0) > 0,
      hasTangent: geometrySurface.geometry.tangentBuffer !== null,
      hasVertexColor: geometrySurface.geometry.colorBuffer !== null,
      hasVertexNormal: geometrySurface.geometry.normalBuffer !== null,
      hasVirtualBaseColor: virtualTexture !== undefined,
      linearOutput: this.#compositeActive,
      material,
      ordinaryTextureMask: presentableOrdinaryTextureMask(
        material,
        residentOrdinaryTextureMask(ordinaryBindings, bindingOffset),
      ),
    });
    const bindings = Array<GpuTextureBinding>(12);
    composeSurfaceTextureBindingsInto(
      bindings,
      ordinaryBindings,
      bindingOffset,
      virtualTexture,
      this.#compositeActive
        && material.kind === "standard"
        && canonicalMaterialHasTransmission(material)
        ? this.#compositeGpu?.sceneColorBinding()
        : undefined,
      this.#environmentGpu?.binding,
    );
    const program = this.#programs.get(
      material.kind,
      features,
      geometrySurface.instanceCount > 0,
      material.alphaCutoff !== undefined,
      canonicalSurfaceIsDoubleSided(material),
    );
    const depthProgram = this.#depthPrepassActive
      && surfaceCanUseOpaqueDepthPrepass(geometrySurface.surface)
      ? this.#depthPrepassOwner?.get(geometrySurface.instanceCount > 0) ?? null
      : null;
    return {
      depthOrder: 0,
      depthPacket: depthProgram === null ? null : {
        alphaBlend: false,
        colorWrite: false,
        cullBackFaces: !canonicalSurfaceIsDoubleSided(material),
        depthTest: true,
        depthWrite: true,
        frontFace: geometrySurface.surface.modelHandedness < 0 ? this.#gl.CW : this.#gl.CCW,
        program: depthProgram.program,
        textureBindings: EMPTY_TEXTURE_BINDINGS,
        textureUnits: 0,
        vertexArray: geometrySurface.vertexArray,
      },
      depthProgram,
      drawPacket: surfaceDrawPacket(
        this.#gl,
        geometrySurface.surface,
        program.program,
        bindings,
        surfaceTextureUnitMask(features),
        geometrySurface.vertexArray,
      ),
      geometry: geometrySurface.geometry,
      instanceCount: geometrySurface.instanceCount,
      mode: geometrySurface.surface.topology === "lines" ? this.#gl.LINES : this.#gl.TRIANGLES,
      program,
      surface: geometrySurface.surface,
      slot: canonicalMaterialHasTransmission(material)
        ? this.#transmissionCandidateSlot(sceneIndex)
        : -1,
      vertexArray: geometrySurface.vertexArray,
      ...(virtualTexture === undefined ? {} : { virtualTexture }),
    };
  }

  #reconcile(): void {
    this.#dirty = false;
    const scene = this.#scene;
    const surfaces = scene?.surfaces ?? [];
    const requestedSurfaceCount = nextSurfaceAdmissionCount(
      this.#admittedSurfaceCount,
      surfaces.length,
      SURFACE_UPLOADS_PER_FRAME,
    );
    const retainedSurfaceCount = !this.#fullReconcileRequired
      && this.#gpuScene === scene
      ? this.#admittedSurfaceCount
      : 0;
    const geometryPlan = this.#geometryGpu.prepare(
      surfaces,
      requestedSurfaceCount,
      retainedSurfaceCount,
    );
    const admittedSurfaceCount = geometryPlan.offset + geometryPlan.surfaces.length;
    const previousSurfaceCount = this.#gpuSurfacesBySceneIndex.length;
    const appendOnly = retainedSurfaceCount > 0
      && previousSurfaceCount === geometryPlan.offset;
    let appendedSurfaces: GpuSurface[] | null = null;
    try {
      let nextSurfaces: GpuSurface[];
      if (appendOnly) {
        const appended = Array<GpuSurface>(admittedSurfaceCount - previousSurfaceCount);
        for (let index = previousSurfaceCount; index < admittedSurfaceCount; index += 1) {
          const geometrySurface = geometryPlan.surfaces[index - previousSurfaceCount]!;
          const ordinaryBindings = this.#retainOrdinaryTextureBindings(
            geometrySurface.surface.material,
          );
          appended[index - previousSurfaceCount] = this.#prepareGpuSurface(
            geometrySurface,
            ordinaryBindings,
            0,
            scene,
            index,
          );
        }
        geometryPlan.commit();
        for (const resource of appended) this.#gpuSurfacesBySceneIndex.push(resource);
        appendedSurfaces = appended;
        nextSurfaces = this.#gpuSurfacesBySceneIndex;
      } else {
        const textureInputs = Array<CanonicalTextureBinding | undefined>(
          geometryPlan.surfaces.length * MATERIAL_TEXTURE_UNITS,
        );
        for (let index = 0; index < geometryPlan.surfaces.length; index += 1) {
          const material = geometryPlan.surfaces[index]!.surface.material;
          const offset = index * MATERIAL_TEXTURE_UNITS;
          for (let unit = 0; unit < MATERIAL_TEXTURE_UNITS; unit += 1) {
            textureInputs[offset + unit] = materialTextureBindingAt(material, unit);
          }
        }
        const textureBindings = this.#textureGpu.reconcile(textureInputs);
        nextSurfaces = Array<GpuSurface>(geometryPlan.surfaces.length);
        for (let index = 0; index < geometryPlan.surfaces.length; index += 1) {
          nextSurfaces[index] = this.#prepareGpuSurface(
            geometryPlan.surfaces[index]!,
            textureBindings,
            index * MATERIAL_TEXTURE_UNITS,
            scene,
            index,
          );
        }
        geometryPlan.commit();
        this.#gpuSurfacesBySceneIndex = nextSurfaces;
      }
      if (this.#multiDrawCounts.length < admittedSurfaceCount) {
        this.#multiDrawCounts = new Int32Array(admittedSurfaceCount);
        this.#multiDrawOffsets = new Int32Array(admittedSurfaceCount);
      }
      this.#admittedSurfaceCount = admittedSurfaceCount;
      this.#gpuScene = scene;
      if (appendedSurfaces !== null && admittedSurfaceCount < surfaces.length) {
        const appended = planSurfacePasses(
          appendedSurfaces,
          (resource) => resource.surface.material,
        );
        this.#opaqueSurfaces.push(...appended.opaque);
        this.#blendedSurfaces.push(...appended.transparent);
        this.#transmissionSurfaces.push(...appended.transmission);
      } else {
        const grouped = groupSurfacesForDrawing(nextSurfaces);
        this.#opaqueSurfaces = grouped.opaque;
        this.#blendedSurfaces = grouped.transparent;
        this.#transmissionSurfaces = grouped.transmission;
      }
      this.#planOpaqueMultiDrawRuns();
    } catch (error) {
      geometryPlan.rollback();
      throw error;
    }
    if (scene !== null) {
      this.#directionalLightCount = scene.directionalLights.length;
      packCanonicalLightUniformsInto(
        scene.directionalLights,
        scene.punctualLights,
        this.#lightUniforms,
      );
    } else {
      this.#directionalLightCount = 0;
    }
    this.#fullReconcileRequired = false;
    this.#instanceTransformsPending = false;
    if (!appendOnly) this.#texturePublicationKeys.clear();
    if (scene !== null) this.#collectDeferredTexturePublications(
      scene,
      appendOnly ? previousSurfaceCount : 0,
      admittedSurfaceCount,
    );
    this.#dirty = this.#admittedSurfaceCount < surfaces.length
      || this.#texturePublicationKeys.size > 0;
  }

  #reconcileTexturePublications(): void {
    const scene = this.#scene!;
    const surfaces = this.#gpuSurfacesBySceneIndex;
    let regroup = false;
    for (const key of this.#texturePublicationKeys) {
      const indices = scene.textureSurfaceIndices.get(key);
      if (indices === undefined) {
        this.#texturePublicationKeys.delete(key);
        continue;
      }
      let deferred = false;
      for (const index of indices) {
        if (index >= surfaces.length) continue;
        const resource = surfaces[index]!;
        const surface = scene.surfaces[index]!;
        const material = surface.material;
        const ordinaryBindings = this.#retainOrdinaryTextureBindings(material);
        deferred ||= this.#materialUploadDeferred(material);
        const features = surfaceProgramFeatureBits({
          environmentFeatures: sceneEnvironmentFeatures(scene, this.#environmentGpu?.binding),
          hasDirectionalLights: scene.directionalLights.length > 0,
          hasPunctualLights: scene.punctualLights.length > 0,
          hasTangent: resource.geometry.tangentBuffer !== null,
          hasVertexColor: resource.geometry.colorBuffer !== null,
          hasVertexNormal: resource.geometry.normalBuffer !== null,
          hasVirtualBaseColor: resource.virtualTexture !== undefined,
          linearOutput: this.#compositeActive,
          material,
          ordinaryTextureMask: presentableOrdinaryTextureMask(
            material,
            residentOrdinaryTextureMask(ordinaryBindings, 0),
          ),
        });
        const textureUnits = surfaceTextureUnitMask(features);
        resource.surface = surface;
        const retainedBindings = resource.drawPacket.textureBindings as GpuTextureBinding[];
        const textureUnitsChanged = textureUnits !== resource.drawPacket.textureUnits;
        const program = textureUnitsChanged
          ? this.#programs.get(
            material.kind,
            features,
            resource.instanceCount > 0,
            material.alphaCutoff !== undefined,
            canonicalSurfaceIsDoubleSided(material),
          )
          : resource.program;
        composeSurfaceTextureBindingsInto(
          retainedBindings,
          ordinaryBindings,
          0,
          resource.virtualTexture,
          this.#compositeActive
            && material.kind === "standard"
            && canonicalMaterialHasTransmission(material)
            ? this.#compositeGpu?.sceneColorBinding()
            : undefined,
          this.#environmentGpu?.binding,
        );
        if (!textureUnitsChanged) continue;
        regroup ||= program.program !== resource.program.program;
        resource.drawPacket = surfaceDrawPacket(
          this.#gl,
          surface,
          program.program,
          retainedBindings,
          textureUnits,
          resource.vertexArray,
        );
        resource.program = program;
      }
      if (!deferred) this.#texturePublicationKeys.delete(key);
    }
    if (regroup) {
      const grouped = groupSurfacesForDrawing(surfaces);
      this.#opaqueSurfaces = grouped.opaque;
      this.#blendedSurfaces = grouped.transparent;
      this.#transmissionSurfaces = grouped.transmission;
    }
    this.#planOpaqueMultiDrawRuns();
    this.#gpuScene = scene;
    this.#dirty = this.#admittedSurfaceCount < scene.surfaces.length
      || this.#texturePublicationKeys.size > 0;
  }

  #materialUploadDeferred(material: CanonicalSurfaceMaterial): boolean {
    for (let unit = 0; unit < MATERIAL_TEXTURE_UNITS; unit += 1) {
      const binding = materialTextureBindingAt(material, unit);
      if (binding !== undefined && this.#textureGpu.isUploadDeferred(binding.storageKey)) {
        return true;
      }
    }
    return false;
  }

  #collectDeferredTexturePublications(
    scene: CanonicalSurfaceScene,
    start: number,
    end: number,
  ): void {
    for (let index = start; index < end; index += 1) {
      const surface = scene.surfaces[index]!;
      if (!this.#materialUploadDeferred(surface.material)) continue;
      for (const key of surface.textureKeys) this.#texturePublicationKeys.add(key);
    }
  }

  #applyVirtualTexture(
    program: StandardProgram | UnlitProgram,
    binding: VirtualTextureGpuBinding | undefined,
  ): void {
    if (
      binding === undefined
      || program.virtualSettings0 === null
      || program.virtualSettings1 === null
      || program.virtualSettings2 === null
    ) return;
    this.#gl.uniform4fv(program.virtualSettings0, binding.settings0);
    this.#gl.uniform4fv(program.virtualSettings1, binding.settings1);
    this.#gl.uniform4fv(program.virtualSettings2, binding.settings2);
  }

  #planOpaqueMultiDrawRuns(): void {
    this.#opaqueMultiDrawRunEnds = planContiguousRunEnds(
      this.#opaqueSurfaces,
      surfacesShareMultiDrawState,
    );
    this.#depthPrepassRunEnds = planContiguousRunEnds(
      this.#opaqueSurfaces,
      surfacesShareDepthPrepassState,
    );
  }

  /** Candidate indices retain scene order, so cold preparation needs no lookup table. */
  #transmissionCandidateSlot(sceneIndex: number): number {
    let start = 0;
    let end = this.#transmissionCandidateIndices.length;
    while (start < end) {
      const middle = (start + end) >>> 1;
      if (this.#transmissionCandidateIndices[middle]! < sceneIndex) start = middle + 1;
      else end = middle;
    }
    return start;
  }

}
