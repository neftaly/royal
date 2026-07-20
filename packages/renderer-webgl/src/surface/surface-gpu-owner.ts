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
  MutableSurfaceDrawStateIntent,
  SurfaceDrawStateIntent,
} from "../webgl/draw-state-transition";
import {
  TextureGpuOwner,
  type GpuTextureBinding,
  type OrdinaryTextureGpuSnapshot,
} from "../texture/gpu-owner";
import {
  MAX_CANONICAL_DIRECTIONAL_LIGHTS,
  MAX_CANONICAL_PUNCTUAL_LIGHTS,
  type CanonicalDrawSurface,
  type CanonicalSurfaceScene,
} from "./scene-lowering";
import type {
  CanonicalSurfaceMaterial,
  CanonicalTextureBinding,
} from "./canonical-material";
import {
  canonicalMaterialHasTransmission,
  dielectricF0FromIndexOfRefraction,
} from "./canonical-material";
import {
  SURFACE_FEATURE_PREFILTERED_ENVIRONMENT,
  SURFACE_FEATURE_STUDIO_ENVIRONMENT,
} from "./surface-program-features";
import {
  SurfaceProgramOwner,
  type StandardProgram,
  type TextureCoordinatesProgram,
  type UnlitProgram,
} from "./surface-program-owner";
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
  closestDrawableLodLevel,
  createProjectedBoundsWorkspace,
  hystereticLodLevel,
  lodMembershipsSelected,
  maximumProjectedBoundsScreenCoverage,
} from "./lod-selection";
import type { LinearRgba } from "@royal/renderer-core";
import type {
  VirtualTextureGpuBinding,
  VirtualTextureRuntime,
} from "../virtual-texture/runtime-contract";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import {
  FrameUploadBudgetOwner,
  type FrameUploadBudgetSnapshot,
} from "../resource/frame-upload-budget";
import { planContiguousRunEnds } from "./contiguous-run-plan";
import { surfacesShareMultiDrawState } from "./surface-multi-draw";
import {
  composeSurfaceTextureBindings,
  MATERIAL_TEXTURE_UNITS,
  materialTextureBindingAt,
  presentableOrdinaryTextureMask,
  surfaceTextureFeatureBits,
  surfaceTextureUnitMask,
} from "./surface-texture-plan";
import {
  canonicalSurfaceIsDoubleSided,
  canonicalTransmissionNeedsMipmaps,
  planGroupedSurfacePasses,
} from "./surface-pass-plan";
import {
  terminalPresentationRequested,
  type LinearCompositeCapabilities,
} from "./terminal-presentation-plan";
import type { SurfaceCompositeOwner } from "./surface-composite-owner";
import type {
  PrefilteredEnvironmentGpuOwner,
  PrefilteredEnvironmentGpuBinding,
} from "../environment/gpu-owner";
import type { PreparedRoyalEnvironment } from "../environment/royal-environment-ktx1";

export type SurfaceFrameView = Readonly<{
  view: Mat4;
  viewProjection: Mat4;
  viewport: FrameViewport;
}>;

type GpuSurface = {
  bindings: readonly GpuTextureBinding[];
  readonly geometry: GpuGeometry;
  readonly instanceCount: number;
  readonly mode: number;
  program: StandardProgram | UnlitProgram;
  surface: CanonicalDrawSurface;
  textureUnits: number;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly virtualTexture?: VirtualTextureGpuBinding;
};

type WebGlMultiDraw = Readonly<{
  multiDrawElementsWEBGL: (
    mode: number,
    counts: Int32Array,
    countsOffset: number,
    type: number,
    offsets: Int32Array,
    offsetsOffset: number,
    drawCount: number,
  ) => void;
}>;

const SURFACE_UPLOADS_PER_FRAME = 16;
const NEUTRAL_PERCEPTUAL_GREY = new Float32Array([0.214_041, 0.214_041, 0.214_041, 1]);
const DEFAULT_ATTENUATION_COLOR = new Float32Array([1, 1, 1]);
const EMPTY_RUN_ENDS: Uint32Array<ArrayBufferLike> = new Uint32Array(0);

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
  return environment.source === "royal-prefiltered-v1" && prefiltered !== undefined
    ? SURFACE_FEATURE_PREFILTERED_ENVIRONMENT
    : SURFACE_FEATURE_STUDIO_ENVIRONMENT;
};


const groupSurfacesForDrawing = (surfaces: readonly GpuSurface[]) =>
  planGroupedSurfacePasses(
    surfaces,
    (resource) => resource.surface.material,
    (resource) => resource.surface.materialSource,
    (resource) => resource.program.program,
  );

/** Coordinates one context generation's program, geometry, texture, and draw-state owners. */
export class SurfaceGpuOwner {
  #admittedSurfaceCount = 0;
  readonly #cameraPosition = new Float32Array(4);
  readonly #attenuation = new Float32Array(4);
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
  readonly #directionalLightColors = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  readonly #directionalLightDirections = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  #directionalLightCount = 0;
  #dirty = false;
  #drawIntent: MutableSurfaceDrawStateIntent | null = null;
  #fullReconcileRequired = true;
  readonly #geometryGpu: SurfaceGeometryGpuOwner;
  #environmentGpu: PrefilteredEnvironmentGpuOwner | null = null;
  #environmentGpuLoadGeneration = 0;
  #environmentGpuLoadRequested = false;
  #environmentGpuPrepared: PreparedRoyalEnvironment | undefined;
  readonly #frustumPlanes = new Float32Array(24);
  readonly #gl: WebGL2RenderingContext;
  readonly #onChanged: () => void;
  readonly #onFailure: (error: unknown) => void;
  #opaqueSurfaces: readonly GpuSurface[] = [];
  #opaqueMultiDrawRunEnds: Uint32Array<ArrayBufferLike> = EMPTY_RUN_ENDS;
  #blendedSurfaces: GpuSurface[] = [];
  #blendedDepths = new Float64Array(0);
  #transmissionSurfaces: GpuSurface[] = [];
  #gpuScene: CanonicalSurfaceScene | null = null;
  #gpuSurfacesBySceneIndex: GpuSurface[] = [];
  readonly #materialFactors = new Float32Array(4);
  #multiDraw: WebGlMultiDraw | null;
  #multiDrawCounts = new Int32Array(0);
  #multiDrawOffsets = new Int32Array(0);
  readonly #ordinaryBindingScratch = Array<GpuTextureBinding>(MATERIAL_TEXTURE_UNITS);
  readonly #lodGroups = new Set<string>();
  #lodDrawableLevels = new Uint8Array(1);
  readonly #lodProjection = createProjectedBoundsWorkspace();
  readonly #lodSelections = new Map<string, number>();
  readonly #emissiveFactor = new Float32Array(4);
  readonly #environmentSettings = new Float32Array(4);
  readonly #fallbackBaseColor = new Float32Array(4);
  readonly #presentation = new Float32Array(4);
  readonly #specularFactors = new Float32Array(4);
  readonly #punctualLightColors = new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4);
  readonly #punctualLightDirections = new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4);
  readonly #punctualLightPositions = new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4);
  readonly #punctualLightSpotCones = new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4);
  readonly #programs: SurfaceProgramOwner;
  readonly #resourceBudget: PersistentGpuBudgetOwner;
  #requiresSceneColor = false;
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
  readonly #transmissionFactors = new Float32Array(4);
  #transmissionCandidates: readonly CanonicalDrawSurface[] = [];
  readonly #viewProjectionModel: MutableMat4 = identityMat4();
  #virtualTexture: VirtualTextureRuntime | null = null;
  #virtualTextureBindingRevision = -1;

  constructor(
    gl: WebGL2RenderingContext,
    budget = new PersistentGpuBudgetOwner(),
    onChanged: () => void = () => undefined,
    onFailure: (error: unknown) => void = () => undefined,
    uploadBudget = new FrameUploadBudgetOwner(),
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
    this.#textureGpu = new TextureGpuOwner(gl, budget, uploadBudget);
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
    this.#textureGpu.dispose();
    this.#programs.dispose();
    this.#compositeLoadGeneration += 1;
    this.#compositeGpu?.dispose();
    this.#compositeGpu = null;
    this.#virtualTexture?.dispose();
    this.#drawIntent = null;
    this.#fullReconcileRequired = true;
    this.#admittedSurfaceCount = 0;
    this.#opaqueSurfaces = [];
    this.#opaqueMultiDrawRunEnds = EMPTY_RUN_ENDS;
    this.#blendedSurfaces = [];
    this.#blendedDepths = new Float64Array(0);
    this.#gpuSurfacesBySceneIndex = [];
    this.#gpuScene = null;
    this.#scene = null;
    this.#texturePublicationKeys.clear();
    this.#lodGroups.clear();
    this.#lodSelections.clear();
    this.#requiresSceneColor = false;
    this.#compositeActive = false;
    this.#compositeBindingRevision = 0;
    this.#transmissionSurfaces = [];
    this.#transmissionCandidates = [];
    this.#terminalPresentationEligible = false;
    this.#terminalPresentationHasAlphaBlend = false;
  }

  invalidate(): void {
    if (this.#environmentGpuLoadRequested) {
      this.#environmentGpuLoadGeneration += 1;
      this.#environmentGpuLoadRequested = false;
    }
    this.#environmentGpu?.invalidate();
    this.#geometryGpu.invalidate();
    this.#opaqueSurfaces = [];
    this.#opaqueMultiDrawRunEnds = EMPTY_RUN_ENDS;
    this.#blendedSurfaces = [];
    this.#blendedDepths = new Float64Array(0);
    this.#transmissionSurfaces = [];
    this.#gpuSurfacesBySceneIndex = [];
    this.#gpuScene = null;
    this.#textureGpu.invalidate();
    this.#programs.invalidate();
    this.#programMaterialSources = new WeakMap<WebGLProgram, CanonicalSurfaceMaterial>();
    this.#standardProgramSceneGlobals = new WeakMap<WebGLProgram, number>();
    this.#compositeGpu?.invalidate();
    this.#virtualTexture?.invalidate();
    this.#multiDraw = this.#readMultiDraw();
    this.#drawIntent = null;
    this.#fullReconcileRequired = true;
    this.#admittedSurfaceCount = 0;
    this.#dirty = this.#scene !== null;
    this.#requiresSceneColor = false;
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
  lodSelections(): ReadonlyMap<string, number> {
    return this.#lodSelections;
  }

  /** Whether admitted material intent activates the private scene-color path. */
  requiresSceneColor(): boolean {
    return this.#requiresSceneColor;
  }

  takeUploadedTextureStorageKeys(): readonly string[] {
    return this.#textureGpu.takeUploadedStorageKeys();
  }

  takeDeniedTextureStorageKeys(): readonly string[] {
    return this.#textureGpu.takeDeniedStorageKeys();
  }

  ordinaryTextureSnapshot(): OrdinaryTextureGpuSnapshot {
    return this.#textureGpu.snapshot();
  }

  geometryUploadSnapshot(): FrameUploadBudgetSnapshot {
    return this.#geometryGpu.snapshot();
  }

  texturePublicationsPending(): boolean {
    return this.#texturePublicationKeys.size > 0;
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
    this.#compositeGpu?.resetAdmission();
    this.#terminalPresentationEligible = scene !== null
      && scene.surfaces.every((surface) => surface.material.kind === "standard");
    this.#terminalPresentationHasAlphaBlend = scene?.surfaces.some(
      (surface) => surface.material.alphaBlend === true,
    ) ?? false;
    this.#transmissionCandidates = scene === null
      ? []
      : scene.surfaces.filter((surface) => canonicalMaterialHasTransmission(surface.material));
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

  /** Commits pending texture representations without requiring a scene presentation. */
  flushTexturePublications(state: WebGlStateOwner): boolean {
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

  drawViews(
    views: readonly SurfaceFrameView[],
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    clearColor: LinearRgba,
  ): boolean {
    const scene = this.#scene;
    let transmissionRequested = false;
    let roughSceneColorRequired = false;
    if (this.#transmissionCandidates.length > 0) {
      for (const view of views) {
        frustumPlanesInto(this.#frustumPlanes, view.viewProjection);
        for (const surface of this.#transmissionCandidates) {
          if (!worldBoundsVisible(surface.worldBounds, this.#frustumPlanes)) continue;
          const material = surface.material;
          if (material.kind === "standard") {
            transmissionRequested = true;
            roughSceneColorRequired ||= canonicalTransmissionNeedsMipmaps(material);
          }
        }
        if (transmissionRequested && roughSceneColorRequired) break;
      }
    }
    const terminalPresentation = scene !== null && terminalPresentationRequested(
      this.#terminalPresentationEligible,
      this.#terminalPresentationHasAlphaBlend,
      this.#linearCompositeCapabilities,
    );
    const compositeRequested = transmissionRequested || terminalPresentation;
    let compositeActive = false;
    if (compositeRequested) {
      const composite = this.#compositeGpu;
      if (composite === null) this.#requestCompositeOwner();
      else {
        composite.setSceneColorRequired(transmissionRequested);
        composite.setMipmapsRequired(roughSceneColorRequired);
        let width = 1;
        let height = 1;
        for (const view of views) {
          width = Math.max(width, view.viewport.width);
          height = Math.max(height, view.viewport.height);
        }
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
    if (this.#dirty) {
      if (!this.flushTexturePublications(state)) {
        try {
          this.#reconcile();
        } finally {
          state.invalidateVertexArray();
          state.invalidateTextureUnit(0);
        }
      }
    }
    if (scene === null) return virtualTexturePending;
    const presentationWorkPending = virtualTexturePending
      || this.#admittedSurfaceCount < scene.surfaces.length;
    if (
      this.#opaqueSurfaces.length
        + this.#transmissionSurfaces.length
        + this.#blendedSurfaces.length === 0
    ) return presentationWorkPending;
    this.#selectLods(views, scene);
    if (!this.#compositeActive) {
      for (const view of views) this.#drawView(view, framebuffer, state, scene, "all");
    } else {
      const composite = this.#compositeGpu;
      if (composite === null) throw new Error("Royal transmission composite owner is missing");
      for (const view of views) {
        this.#compositeViewport.width = view.viewport.width;
        this.#compositeViewport.height = view.viewport.height;
        this.#compositeView.view = view.view;
        this.#compositeView.viewProjection = view.viewProjection;
        composite.clear(clearColor, state);
        this.#drawView(
          this.#compositeView,
          composite.framebuffer(),
          state,
          scene,
          "opaque",
        );
        if (transmissionRequested) composite.snapshot(state);
        this.#drawView(
          this.#compositeView,
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
      this.#gl.flush();
    }
    return presentationWorkPending;
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
          this.#transmissionCandidates.length === 0
          && !terminalPresentationRequested(
            this.#terminalPresentationEligible,
            this.#terminalPresentationHasAlphaBlend,
            this.#linearCompositeCapabilities,
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
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    scene: CanonicalSurfaceScene,
    pass: "all" | "opaque" | "remaining",
  ): void {
    let drawIntent = this.#drawIntent;
    if (drawIntent === null) {
      const firstSurface = this.#opaqueSurfaces[0]
        ?? this.#transmissionSurfaces[0]
        ?? this.#blendedSurfaces[0]!;
      const first = firstSurface.program;
      drawIntent = {
        alphaBlend: firstSurface.surface.material.alphaBlend === true,
        cullBackFaces: !canonicalSurfaceIsDoubleSided(firstSurface.surface.material),
        depthTest: true,
        depthWrite: firstSurface.surface.material.alphaBlend !== true,
        framebuffer,
        frontFace: this.#gl.CCW,
        program: first.program,
        textureBindings: firstSurface.bindings,
        textureUnits: firstSurface.textureUnits,
        vertexArray: firstSurface.vertexArray,
        viewport: { height: 0, width: 0, x: 0, y: 0 },
      };
      this.#drawIntent = drawIntent;
    }
    drawIntent.framebuffer = framebuffer;
    drawIntent.viewport.height = frameView.viewport.height;
    drawIntent.viewport.width = frameView.viewport.width;
    drawIntent.viewport.x = frameView.viewport.x;
    drawIntent.viewport.y = frameView.viewport.y;
    const view = frameView.view;
    const viewProjection = frameView.viewProjection;
    cameraWorldPositionFromViewInto(this.#cameraPosition, view);
    this.#cameraPosition[3] = 1;
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
    frustumPlanesInto(this.#frustumPlanes, viewProjection);
    this.#sortBackToFrontSurfaces(this.#transmissionSurfaces, view);
    this.#sortBackToFrontSurfaces(this.#blendedSurfaces, view);
    const opaqueCount = this.#opaqueSurfaces.length;
    const transmissionCount = this.#transmissionSurfaces.length;
    const surfaceCount = opaqueCount + transmissionCount + this.#blendedSurfaces.length;
    const firstIndex = pass === "remaining" ? opaqueCount : 0;
    const endIndex = pass === "opaque" ? opaqueCount : surfaceCount;
    for (let index = firstIndex; index < endIndex; index += 1) {
      const resource = index < opaqueCount
        ? this.#opaqueSurfaces[index]!
        : index < opaqueCount + transmissionCount
          ? this.#transmissionSurfaces[index - opaqueCount]!
          : this.#blendedSurfaces[index - opaqueCount - transmissionCount]!;
      const surface = resource.surface;
      if (!lodMembershipsSelected(surface.lods, this.#lodSelections)) continue;
      if (!worldBoundsVisible(surface.worldBounds, this.#frustumPlanes)) continue;
      const program = resource.program;
      drawIntent.alphaBlend = surface.material.alphaBlend === true;
      drawIntent.cullBackFaces = !canonicalSurfaceIsDoubleSided(surface.material);
      drawIntent.depthWrite = surface.material.alphaBlend !== true;
      drawIntent.frontFace = surface.modelHandedness < 0 ? gl.CW : gl.CCW;
      drawIntent.program = program.program;
      drawIntent.textureBindings = resource.bindings;
      drawIntent.textureUnits = resource.textureUnits;
      drawIntent.vertexArray = resource.vertexArray;
      state.applySurfaceDraw(drawIntent as SurfaceDrawStateIntent);
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
            this.#resolvedBaseColor(surface.material, resource),
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
            gl.uniform1i(program.directionalLightCount, this.#directionalLightCount);
            gl.uniform4fv(program.directionalLightColors, this.#directionalLightColors);
            gl.uniform4fv(program.directionalLightDirections, this.#directionalLightDirections);
            if (
              program.punctualLightCount !== null
              && program.punctualLightColors !== null
              && program.punctualLightDirections !== null
              && program.punctualLightPositions !== null
              && program.punctualLightSpotCones !== null
            ) {
              gl.uniform1i(program.punctualLightCount, scene.punctualLights.length);
              gl.uniform4fv(program.punctualLightColors, this.#punctualLightColors);
              gl.uniform4fv(program.punctualLightDirections, this.#punctualLightDirections);
              gl.uniform4fv(program.punctualLightPositions, this.#punctualLightPositions);
              gl.uniform4fv(program.punctualLightSpotCones, this.#punctualLightSpotCones);
            }
            if (program.environmentRotation !== null && program.environmentSettings !== null) {
              const environment = scene.environment;
              if (environment === undefined) {
                throw new Error("Royal studio environment state is missing");
              }
              gl.uniformMatrix4fv(program.environmentRotation, false, environment.rotation);
              this.#environmentSettings[0] = environment.radianceScaleNits;
              const prefiltered = program.environmentCoefficients === null
                ? undefined
                : this.#environmentGpu?.binding;
              this.#environmentSettings[1] = (prefiltered?.mipCount ?? 1) - 1;
              gl.uniform4fv(program.environmentSettings, this.#environmentSettings);
              if (program.environmentCoefficients !== null) {
                if (prefiltered === undefined) {
                  throw new Error("Royal prefiltered environment GPU state is missing");
                }
                gl.uniform4fv(program.environmentCoefficients, prefiltered.coefficients);
              }
            }
            this.#presentation[0] = scene.exposure;
            this.#presentation[1] = scene.toneMapping === "pbr-neutral" ? 1 : 0;
            if (program.presentation !== null) {
              gl.uniform4fv(program.presentation, this.#presentation);
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
            this.#resolvedBaseColor(material, resource),
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
          if (material.emissiveAsset !== undefined && (resource.textureUnits & 8) === 0) {
            this.#emissiveFactor.fill(0);
          } else this.#emissiveFactor.set(material.emissiveFactor);
          this.#emissiveFactor[3] = material.indexOfRefraction === undefined
            ? 0.04
            : dielectricF0FromIndexOfRefraction(material.indexOfRefraction);
          gl.uniform4fv(program.emissiveFactor, this.#emissiveFactor);
          this.#materialFactors[0] = material.metallicFactor;
          this.#materialFactors[1] = material.roughnessFactor;
          this.#materialFactors[2] = program.alphaMasked ? material.alphaCutoff ?? 0.5 : 0;
          this.#materialFactors[3] = material.normalScale;
          gl.uniform4fv(program.materialFactors, this.#materialFactors);
          if (program.specularFactors !== null) {
            const color = material.specularColorFactor;
            this.#specularFactors[0] = color?.[0] ?? 1;
            this.#specularFactors[1] = color?.[1] ?? 1;
            this.#specularFactors[2] = color?.[2] ?? 1;
            this.#specularFactors[3] = material.specularFactor ?? 1;
            gl.uniform4fv(program.specularFactors, this.#specularFactors);
          }
          if (program.transmissionFactors !== null && program.attenuationColor !== null) {
            this.#transmissionFactors[0] = material.transmissionFactor ?? 0;
            this.#transmissionFactors[1] = material.thicknessFactor ?? 0;
            this.#transmissionFactors[2] = material.indexOfRefraction ?? 1.5;
            this.#transmissionFactors[3] = this.#compositeGpu?.sceneColorMaxLod ?? 0;
            gl.uniform4fv(program.transmissionFactors, this.#transmissionFactors);
            const attenuation = material.attenuationColor ?? DEFAULT_ATTENUATION_COLOR;
            this.#attenuation[0] = attenuation[0]!;
            this.#attenuation[1] = attenuation[1]!;
            this.#attenuation[2] = attenuation[2]!;
            this.#attenuation[3] = material.attenuationDistance === undefined
              ? 0
              : 1 / material.attenuationDistance;
            gl.uniform4fv(program.attenuationColor, this.#attenuation);
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
        && index < opaqueCount
        && resource.instanceCount === 0
        && resource.geometry.indexOffset <= 0x7fff_ffff
      ) {
        this.#multiDrawCounts[0] = resource.geometry.indexCount;
        this.#multiDrawOffsets[0] = resource.geometry.indexOffset;
        let drawCount = 1;
        const runEnd = this.#opaqueMultiDrawRunEnds[index] ?? index + 1;
        let nextIndex = index + 1;
        for (; nextIndex < runEnd; nextIndex += 1) {
          const next = this.#opaqueSurfaces[nextIndex]!;
          if (next.geometry.indexOffset > 0x7fff_ffff) break;
          if (
            lodMembershipsSelected(next.surface.lods, this.#lodSelections)
            && worldBoundsVisible(next.surface.worldBounds, this.#frustumPlanes)
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

  #resolvedBaseColor(
    material: CanonicalSurfaceMaterial,
    resource: GpuSurface,
  ): Float32List {
    if (material.baseColorVirtualAsset !== undefined && resource.virtualTexture === undefined) {
      return NEUTRAL_PERCEPTUAL_GREY;
    }
    if (material.baseColorTexture === undefined || resource.bindings[0]!.texture !== null) {
      return material.baseColor as unknown as Float32List;
    }
    const fallback = this.#fallbackBaseColor;
    fallback[0] = material.baseColor[0] * NEUTRAL_PERCEPTUAL_GREY[0]!;
    fallback[1] = material.baseColor[1] * NEUTRAL_PERCEPTUAL_GREY[1]!;
    fallback[2] = material.baseColor[2] * NEUTRAL_PERCEPTUAL_GREY[2]!;
    fallback[3] = material.baseColor[3];
    return fallback;
  }

  #sortBackToFrontSurfaces(surfaces: GpuSurface[], view: Mat4): void {
    if (surfaces.length < 2) return;
    if (this.#blendedDepths.length < surfaces.length) {
      this.#blendedDepths = new Float64Array(surfaces.length);
    }
    const depths = this.#blendedDepths;
    for (let index = 0; index < surfaces.length; index += 1) {
      const bounds = surfaces[index]!.surface.worldBounds;
      const x = (bounds.min[0] + bounds.max[0]) * 0.5;
      const y = (bounds.min[1] + bounds.max[1]) * 0.5;
      const z = (bounds.min[2] + bounds.max[2]) * 0.5;
      const depth = view[2] * x + view[6] * y + view[10] * z + view[14];
      depths[index] = Number.isFinite(depth) ? depth : 0;
    }
    for (let index = 1; index < surfaces.length; index += 1) {
      const surface = surfaces[index]!;
      const depth = depths[index]!;
      let insertion = index;
      while (insertion > 0 && depths[insertion - 1]! > depth) {
        surfaces[insertion] = surfaces[insertion - 1]!;
        depths[insertion] = depths[insertion - 1]!;
        insertion -= 1;
      }
      surfaces[insertion] = surface;
      depths[insertion] = depth;
    }
  }

  #selectLods(views: readonly SurfaceFrameView[], scene: CanonicalSurfaceScene): void {
    this.#lodGroups.clear();
    if (scene.lodGroups.length === 0) {
      this.#lodSelections.clear();
      return;
    }
    for (const group of scene.lodGroups) {
      if (this.#lodDrawableLevels.length < group.thresholds.length) {
        this.#lodDrawableLevels = new Uint8Array(group.thresholds.length);
      } else this.#lodDrawableLevels.fill(0, 0, group.thresholds.length);
      let drawable = false;
      for (let index = 0; index < group.surfaceIndices.length; index += 1) {
        if (group.surfaceIndices[index]! >= this.#gpuSurfacesBySceneIndex.length) continue;
        this.#lodDrawableLevels[group.levels[index]!] = 1;
        drawable = true;
      }
      if (!drawable) continue;
      this.#lodGroups.add(group.group);
      const coverage = maximumProjectedBoundsScreenCoverage(
        group.selectionBounds,
        views,
        this.#lodProjection,
      );
      const previous = this.#lodSelections.get(group.group);
      const target = hystereticLodLevel(coverage, group.thresholds, previous);
      this.#lodSelections.set(group.group, closestDrawableLodLevel(
        target,
        previous,
        this.#lodDrawableLevels,
        group.thresholds.length,
      ));
    }
    // Admission is prefix-bounded. Independent selectors may temporarily pick
    // a node/material combination whose complete packet is not uploaded yet;
    // retain one admitted combination for every affected set instead of a hole.
    for (const group of scene.lodGroups) {
      if (!this.#lodGroups.has(group.group)) continue;
      let matched = false;
      let fallback: CanonicalDrawSurface | undefined;
      for (const surfaceIndex of group.surfaceIndices) {
        const candidate = this.#gpuSurfacesBySceneIndex[surfaceIndex];
        if (candidate === undefined) continue;
        fallback ??= candidate.surface;
        if (lodMembershipsSelected(candidate.surface.lods, this.#lodSelections)) {
          matched = true;
          break;
        }
      }
      if (matched || fallback?.lods === undefined) continue;
      for (const lod of fallback.lods) this.#lodSelections.set(lod.group, lod.level);
    }
    for (const group of this.#lodSelections.keys()) {
      if (!this.#lodGroups.has(group)) this.#lodSelections.delete(group);
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
  ): GpuSurface {
    const material = geometrySurface.surface.material;
    const virtualTexture = material.baseColorVirtualAsset !== undefined
      ? this.#virtualTexture?.binding(material.baseColorVirtualAsset)
      : material.baseColorAsset === undefined
        ? undefined
        : this.#virtualTexture?.automaticBinding(material.baseColorAsset);
    const features = surfaceTextureFeatureBits(
      material,
      geometrySurface.geometry.colorBuffer !== null,
      geometrySurface.geometry.tangentBuffer !== null,
      sceneEnvironmentFeatures(scene, this.#environmentGpu?.binding),
      (scene?.punctualLights.length ?? 0) > 0,
      virtualTexture !== undefined,
      presentableOrdinaryTextureMask(material, ordinaryBindings, bindingOffset),
      this.#compositeActive,
    );
    return {
      bindings: composeSurfaceTextureBindings(
        ordinaryBindings,
        bindingOffset,
        virtualTexture,
        this.#compositeActive
          && material.kind === "standard"
          && canonicalMaterialHasTransmission(material)
          ? this.#compositeGpu?.sceneColorBinding()
          : undefined,
        this.#environmentGpu?.binding,
      ),
      geometry: geometrySurface.geometry,
      instanceCount: geometrySurface.instanceCount,
      mode: geometrySurface.surface.topology === "lines" ? this.#gl.LINES : this.#gl.TRIANGLES,
      program: this.#programs.get(
        material.kind,
        features,
        geometrySurface.instanceCount > 0,
        material.alphaCutoff !== undefined,
        canonicalSurfaceIsDoubleSided(material),
      ),
      surface: geometrySurface.surface,
      textureUnits: surfaceTextureUnitMask(features),
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
    const geometryPlan = this.#geometryGpu.prepare(surfaces, requestedSurfaceCount);
    const admittedSurfaceCount = geometryPlan.surfaces.length;
    try {
      const previousSurfaceCount = this.#gpuSurfacesBySceneIndex.length;
      const appendOnly = scene !== null
        && !this.#fullReconcileRequired
        && this.#gpuScene === scene
        && previousSurfaceCount === this.#admittedSurfaceCount
        && admittedSurfaceCount > previousSurfaceCount;
      let nextSurfaces: GpuSurface[];
      if (appendOnly) {
        const appended = Array<GpuSurface>(admittedSurfaceCount - previousSurfaceCount);
        for (let index = previousSurfaceCount; index < admittedSurfaceCount; index += 1) {
          const geometrySurface = geometryPlan.surfaces[index]!;
          const ordinaryBindings = this.#retainOrdinaryTextureBindings(
            geometrySurface.surface.material,
          );
          appended[index - previousSurfaceCount] = this.#prepareGpuSurface(
            geometrySurface,
            ordinaryBindings,
            0,
            scene,
          );
        }
        geometryPlan.commit();
        for (const resource of appended) this.#gpuSurfacesBySceneIndex.push(resource);
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
          );
        }
        geometryPlan.commit();
        this.#gpuSurfacesBySceneIndex = nextSurfaces;
      }
      if (this.#multiDrawCounts.length < geometryPlan.surfaces.length) {
        this.#multiDrawCounts = new Int32Array(geometryPlan.surfaces.length);
        this.#multiDrawOffsets = new Int32Array(geometryPlan.surfaces.length);
      }
      this.#admittedSurfaceCount = admittedSurfaceCount;
      this.#gpuScene = scene;
      const grouped = groupSurfacesForDrawing(nextSurfaces);
      this.#opaqueSurfaces = grouped.opaque;
      this.#blendedSurfaces = grouped.transparent;
      this.#requiresSceneColor = grouped.requiresSceneColor;
      this.#transmissionSurfaces = grouped.transmission;
      this.#planOpaqueMultiDrawRuns();
    } catch (error) {
      geometryPlan.rollback();
      throw error;
    }
    if (scene !== null) {
      this.#directionalLightColors.fill(0);
      this.#directionalLightDirections.fill(0);
      this.#directionalLightCount = scene.directionalLights.length;
      for (let index = 0; index < scene.directionalLights.length; index += 1) {
        const light = scene.directionalLights[index]!;
        const offset = index * 4;
        this.#directionalLightColors.set(light.color, offset);
        this.#directionalLightDirections.set(light.direction, offset);
      }
      this.#punctualLightColors.fill(0);
      this.#punctualLightDirections.fill(0);
      this.#punctualLightPositions.fill(0);
      this.#punctualLightSpotCones.fill(0);
      for (let index = 0; index < scene.punctualLights.length; index += 1) {
        const light = scene.punctualLights[index]!;
        const offset = index * 4;
        this.#punctualLightColors.set(light.color, offset);
        this.#punctualLightDirections.set(light.direction, offset);
        this.#punctualLightDirections[offset + 3] = light.kind === "spot" ? 1 : 0;
        this.#punctualLightPositions.set(light.position, offset);
        this.#punctualLightPositions[offset + 3] = light.range;
        this.#punctualLightSpotCones[offset] = light.innerConeCosine;
        this.#punctualLightSpotCones[offset + 1] = light.outerConeCosine;
      }
    } else {
      this.#directionalLightCount = 0;
    }
    this.#fullReconcileRequired = false;
    this.#texturePublicationKeys.clear();
    if (scene !== null) this.#collectDeferredTexturePublications(scene);
    this.#dirty = this.#admittedSurfaceCount < surfaces.length
      || this.#texturePublicationKeys.size > 0;
    this.#drawIntent = null;
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
        const features = surfaceTextureFeatureBits(
          material,
          resource.geometry.colorBuffer !== null,
          resource.geometry.tangentBuffer !== null,
          sceneEnvironmentFeatures(scene, this.#environmentGpu?.binding),
          scene.punctualLights.length > 0,
          resource.virtualTexture !== undefined,
          presentableOrdinaryTextureMask(material, ordinaryBindings, 0),
          this.#compositeActive,
        );
        const program = this.#programs.get(
          material.kind,
          features,
          resource.instanceCount > 0,
          material.alphaCutoff !== undefined,
          canonicalSurfaceIsDoubleSided(material),
        );
        regroup ||= program.program !== resource.program.program;
        resource.bindings = composeSurfaceTextureBindings(
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
        resource.program = program;
        resource.surface = surface;
        resource.textureUnits = surfaceTextureUnitMask(features);
      }
      if (!deferred) this.#texturePublicationKeys.delete(key);
    }
    if (regroup) {
      const grouped = groupSurfacesForDrawing(surfaces);
      this.#opaqueSurfaces = grouped.opaque;
      this.#blendedSurfaces = grouped.transparent;
      this.#requiresSceneColor = grouped.requiresSceneColor;
      this.#transmissionSurfaces = grouped.transmission;
    }
    this.#planOpaqueMultiDrawRuns();
    this.#gpuScene = scene;
    this.#dirty = this.#admittedSurfaceCount < scene.surfaces.length
      || this.#texturePublicationKeys.size > 0;
    this.#drawIntent = null;
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

  #collectDeferredTexturePublications(scene: CanonicalSurfaceScene): void {
    for (const [key, indices] of scene.textureSurfaceIndices) {
      for (const index of indices) {
        const surface = scene.surfaces[index];
        if (surface !== undefined && this.#materialUploadDeferred(surface.material)) {
          this.#texturePublicationKeys.add(key);
          break;
        }
      }
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
      || program.virtualMipOffsets === null
    ) return;
    this.#gl.uniform4fv(program.virtualSettings0, binding.settings0);
    this.#gl.uniform4fv(program.virtualSettings1, binding.settings1);
    this.#gl.uniform4fv(program.virtualSettings2, binding.settings2);
    this.#gl.uniform1fv(program.virtualMipOffsets, binding.mipOffsets);
  }

  #planOpaqueMultiDrawRuns(): void {
    this.#opaqueMultiDrawRunEnds = this.#multiDraw === null
      ? EMPTY_RUN_ENDS
      : planContiguousRunEnds(this.#opaqueSurfaces, surfacesShareMultiDrawState);
  }
}
