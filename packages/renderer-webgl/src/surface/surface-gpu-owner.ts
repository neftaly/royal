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
  SURFACE_FEATURE_ROTATED_ENVIRONMENT,
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
  planSurfacePasses,
  surfaceDrawPassNeedsDepthOrder,
  type SurfaceDrawPass,
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
import { sortSurfacesBackToFront } from "./surface-depth-order";

export type SurfaceFrameView = Readonly<{
  view: Mat4;
  viewProjection: Mat4;
  viewport: FrameViewport;
}>;

export type SurfaceGeometryUploadSnapshot = FrameUploadBudgetSnapshot & Readonly<{
  pendingSurfaces: number;
}>;

type GpuSurface = {
  depthOrder: number;
  drawPacket: SurfaceDrawPacket;
  readonly geometry: GpuGeometry;
  readonly instanceCount: number;
  readonly mode: number;
  program: StandardProgram | UnlitProgram;
  readonly sceneIndex: number;
  surface: CanonicalDrawSurface;
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
  readonly #frustumPlanes = new Float32Array(24);
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
  readonly #transmissionCandidateIndices: number[] = [];
  #transmissionVisibility = new Uint8Array(0);
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
    this.#lodGroups.clear();
    this.#lodSelections.clear();
    this.#compositeActive = false;
    this.#compositeBindingRevision = 0;
    this.#transmissionSurfaces = [];
    this.#transmissionCandidateIndices.length = 0;
    this.#transmissionVisibility = new Uint8Array(0);
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
  lodSelections(): ReadonlyMap<string, number> {
    return this.#lodSelections;
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

  geometryUploadSnapshot(): SurfaceGeometryUploadSnapshot {
    return {
      ...this.#geometryGpu.snapshot(),
      pendingSurfaces: Math.max(0, (this.#scene?.surfaces.length ?? 0) - this.#admittedSurfaceCount),
    };
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
    this.#dirty = true;
    if (
      this.#gpuScene !== this.#scene
      || this.#admittedSurfaceCount < this.#scene.surfaces.length
    ) this.#fullReconcileRequired = true;
    else this.#instanceTransformsPending = true;
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
    const visibilityStride = scene?.surfaces.length ?? 0;
    const visibilityLength = visibilityStride * views.length;
    if (this.#transmissionVisibility.length < visibilityLength) {
      this.#transmissionVisibility = new Uint8Array(visibilityLength);
    }
    if (scene !== null && this.#transmissionCandidateIndices.length > 0) {
      for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
        const view = views[viewIndex]!;
        frustumPlanesInto(this.#frustumPlanes, view.viewProjection);
        const visibilityOffset = viewIndex * visibilityStride;
        for (const sceneIndex of this.#transmissionCandidateIndices) {
          const surface = scene.surfaces[sceneIndex]!;
          const visible = worldBoundsVisible(surface.worldBounds, this.#frustumPlanes);
          this.#transmissionVisibility[visibilityOffset + sceneIndex] = visible ? 1 : 0;
          if (!visible) continue;
          const material = surface.material;
          if (material.kind === "standard") {
            transmissionRequested = true;
            roughSceneColorRequired ||= canonicalTransmissionNeedsMipmaps(material);
          }
        }
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
      if (this.#instanceTransformsPending && !this.#fullReconcileRequired) {
        if (this.#geometryGpu.updateInstanceTransforms(scene?.surfaces ?? [])) {
          this.#instanceTransformsPending = false;
          this.#dirty = this.#texturePublicationKeys.size > 0;
        } else {
          this.#fullReconcileRequired = true;
        }
      }
      if (this.#dirty && !this.flushTexturePublications(state)) {
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
    frustumPlanesInto(this.#frustumPlanes, frameView.viewProjection);
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
      this.#sortBackToFrontSurfaces(this.#transmissionSurfaces, view);
      this.#sortBackToFrontSurfaces(this.#blendedSurfaces, view);
    }
    const opaqueCount = this.#opaqueSurfaces.length;
    const transmissionCount = this.#transmissionSurfaces.length;
    const transmissionEnd = opaqueCount + transmissionCount;
    const surfaceCount = opaqueCount + transmissionCount + this.#blendedSurfaces.length;
    const firstIndex = pass === "remaining" ? opaqueCount : 0;
    const endIndex = pass === "opaque" ? opaqueCount : surfaceCount;
    for (let index = firstIndex; index < endIndex; index += 1) {
      const resource = index < opaqueCount
        ? this.#opaqueSurfaces[index]!
        : index < transmissionEnd
          ? this.#transmissionSurfaces[index - opaqueCount]!
          : this.#blendedSurfaces[index - transmissionEnd]!;
      const surface = resource.surface;
      if (!lodMembershipsSelected(surface.lods, this.#lodSelections)) continue;
      if (index >= opaqueCount && index < transmissionEnd) {
        if (
          this.#transmissionVisibility[viewIndex * visibilityStride + resource.sceneIndex] !== 1
        ) continue;
      } else if (!worldBoundsVisible(surface.worldBounds, this.#frustumPlanes)) continue;
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
            if (
              program.directionalLightCount !== null
              && program.directionalLightColors !== null
              && program.directionalLightDirections !== null
            ) {
              gl.uniform1i(program.directionalLightCount, this.#directionalLightCount);
              gl.uniform4fv(program.directionalLightColors, this.#directionalLightColors);
              gl.uniform4fv(program.directionalLightDirections, this.#directionalLightDirections);
            }
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
            if (program.environmentSettings !== null) {
              const environment = scene.environment;
              if (environment === undefined) {
                throw new Error("Royal studio environment state is missing");
              }
              if (program.environmentRotation !== null) {
                gl.uniformMatrix4fv(program.environmentRotation, false, environment.rotation);
              }
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
          if (material.emissiveAsset !== undefined && (resource.drawPacket.textureUnits & 8) === 0) {
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
    if (
      material.baseColorTexture === undefined
      || resource.drawPacket.textureBindings[0]!.texture !== null
    ) {
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
    sortSurfacesBackToFront(surfaces, view);
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
    sceneIndex: number,
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
      (scene?.directionalLights.length ?? 0) > 0,
      (scene?.punctualLights.length ?? 0) > 0,
      virtualTexture !== undefined,
      presentableOrdinaryTextureMask(material, ordinaryBindings, bindingOffset),
      this.#compositeActive,
    );
    const bindings = composeSurfaceTextureBindings(
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
    return {
      depthOrder: 0,
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
      sceneIndex,
      surface: geometrySurface.surface,
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
        const features = surfaceTextureFeatureBits(
          material,
          resource.geometry.colorBuffer !== null,
          resource.geometry.tangentBuffer !== null,
          sceneEnvironmentFeatures(scene, this.#environmentGpu?.binding),
          scene.directionalLights.length > 0,
          scene.punctualLights.length > 0,
          resource.virtualTexture !== undefined,
          presentableOrdinaryTextureMask(material, ordinaryBindings, 0),
          this.#compositeActive,
        );
        const textureUnits = surfaceTextureUnitMask(features);
        resource.surface = surface;
        if (textureUnits === resource.drawPacket.textureUnits) continue;
        const program = this.#programs.get(
          material.kind,
          features,
          resource.instanceCount > 0,
          material.alphaCutoff !== undefined,
          canonicalSurfaceIsDoubleSided(material),
        );
        regroup ||= program.program !== resource.program.program;
        const bindings = composeSurfaceTextureBindings(
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
        resource.drawPacket = surfaceDrawPacket(
          this.#gl,
          surface,
          program.program,
          bindings,
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
    this.#opaqueMultiDrawRunEnds = this.#multiDraw === null
      ? EMPTY_RUN_ENDS
      : planContiguousRunEnds(this.#opaqueSurfaces, surfacesShareMultiDrawState);
  }

}
