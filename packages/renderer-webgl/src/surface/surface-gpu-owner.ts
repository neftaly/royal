import {
  cameraWorldPositionFromViewInto,
  identityMat4,
  mat4ValuesEqual,
  multiplyMat4Into,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";
import type { FrameViewport } from "../frame/clear-frame";
import type { SurfaceFrameView } from "../frame/surface-frame";
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
import type { CanonicalEdgeSurface } from "./edge-overlay-scene";
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
  updateOpaqueDepthPrepassPlan,
} from "./surface-depth-prepass";
import {
  IDENTITY_TEXTURE_COORDINATES,
  type CanonicalTextureCoordinates,
} from "./texture-coordinates";
import {
  SurfaceGeometryGpuOwner,
  type GpuGeometry,
  type GpuGeometrySurface,
} from "./surface-geometry-gpu-owner";
import {
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
  type LodLevelSelections,
} from "./lod-selection";
import type { GltfAssetRef, LinearRgba } from "@royal/renderer-core";
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
import { planRetainedContiguousRunEnds } from "./contiguous-run-plan";
import {
  surfacesShareMultiDrawState,
  surfacesShareDepthPrepassState,
  type WebGlMultiDraw,
} from "./surface-multi-draw";
import {
  authoredOrdinaryTextureMask,
  collectCompleteSurfaceTextureClaimsInto,
  collectTexturePublicationSurfaceIndicesInto,
  composeSurfaceTextureBindingsInto,
  createTexturePublicationWorkspace,
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
import {
  SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT,
  ScreenSpacePartitionPatternOwner,
} from "./screen-space-partition-pattern";

export type SurfaceGeometryUploadSnapshot = FrameUploadBudgetSnapshot & Readonly<{
  /** Scene surfaces still waiting for bounded geometry/instance admission. */
  pendingSurfaces: number;
}>;

export type BorrowedSurfaceGeometry = Readonly<{
  geometry: Readonly<{
    /** Stable exact geometry allocation identity until the world owner reconciles. */
    identity: object;
    indexBuffer: WebGLBuffer;
    indexCount: number;
    indexOffset: number;
    indexType: number;
    key: string;
    vertexBuffer: WebGLBuffer;
  }>;
  /** Stable only until the world owner next reconciles its retained resources. */
  identity: object;
  instanceCount: number;
  vertexArray: WebGLVertexArrayObject;
}>;

export type BorrowedSurfaceGeometryMatch =
  | Readonly<{ status: "absent" | "inactive" | "pending" }>
  | Readonly<{ resource: BorrowedSurfaceGeometry; status: "ready" }>;

const ABSENT_BORROWED_GEOMETRY: BorrowedSurfaceGeometryMatch = { status: "absent" };
const INACTIVE_BORROWED_GEOMETRY: BorrowedSurfaceGeometryMatch = { status: "inactive" };
const PENDING_BORROWED_GEOMETRY: BorrowedSurfaceGeometryMatch = { status: "pending" };

const sameGltfAssetIdentity = (
  left: GltfAssetRef,
  right: GltfAssetRef,
): boolean => left.src === right.src
  && left.sceneIndex === right.sceneIndex
  && left.version === right.version;

/** @internal */
export type BorrowedSurfaceSourceKind = "automatic-member" | "whole-surface";

/**
 * @internal
 * Identifies a resident-world surface that has the exact geometry provenance and
 * source placement requested by a non-picking edge presentation. Coincident
 * mounted occurrences are deliberately interchangeable here: application and
 * picking identity never enter this renderer-owned equivalence relation.
 */
export const matchingBorrowedSurfaceSourceKind = (
  surface: CanonicalDrawSurface,
  requested: CanonicalEdgeSurface,
): BorrowedSurfaceSourceKind | null => {
  const instances = surface.instances;
  if (
    requested.instances === undefined
    && instances?.automaticSourceOccurrences !== undefined
  ) {
    const sources = instances.automaticSourceOccurrences;
    if (
      sources.length !== instances.count
      || instances.localModels.length !== instances.count * 16
    ) {
      throw new Error("Royal automatic instance sources diverged from their transform cohort");
    }
    for (let instance = 0; instance < sources.length; instance += 1) {
      const source = sources[instance]!;
      if (
        source.geometryKey !== requested.geometry.key
        || !sameGltfAssetIdentity(source.asset, requested.asset)
      ) continue;
      const offset = instance * 16;
      let transformMatches = true;
      for (let component = 0; component < 16; component += 1) {
        if (!Object.is(
          instances.localModels[offset + component],
          Math.fround(requested.sourceModel[component]!),
        )) {
          transformMatches = false;
          break;
        }
      }
      if (transformMatches) return "automatic-member";
    }
  }
  if (
    surface.node.kind !== "gltf"
    || surface.geometry.key !== requested.geometry.key
    || surface.instances?.key !== requested.instances?.key
    || !mat4ValuesEqual(surface.model, requested.sourceModel)
    || !sameGltfAssetIdentity(surface.node.asset, requested.asset)
  ) return null;
  if (surface.gltfOccurrence === undefined) {
    throw new Error("Royal rendered glTF surface is missing mounted occurrence identity");
  }
  return "whole-surface";
};

type GpuSurface = {
  depthOrder: number;
  depthOrderGroup: number;
  depthPacket: SurfaceDrawPacket | null;
  depthProgram: SurfaceDepthProgram | null;
  drawPacket: SurfaceDrawPacket;
  readonly geometry: GpuGeometry;
  readonly instanceCount: number;
  /** Whether an admitted material-LOD level has its base presentation resident. */
  lodDrawable: boolean;
  readonly mode: number;
  program: StandardProgram | UnlitProgram;
  surface: CanonicalDrawSurface;
  /** Dense transmission visibility slot, or -1 for another pass. */
  readonly slot: number;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly virtualTexture?: VirtualTextureGpuBinding;
};

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

const plannedSurfaceProgramFeatures = (
  scene: CanonicalSurfaceScene | null,
  surface: CanonicalDrawSurface,
  environmentFeatures: number,
  hasVirtualBaseColor: boolean,
  linearOutput: boolean,
  ordinaryTextureMask: number,
): number => surfaceProgramFeatureBits({
  directionalLightCount: scene?.directionalLights.length ?? 0,
  environmentFeatures,
  hasTangent: surface.geometry.tangents !== undefined,
  hasVertexColor: surface.geometry.colors !== undefined,
  hasVertexNormal: surface.geometry.normals !== undefined,
  hasVirtualBaseColor,
  linearOutput,
  material: surface.material,
  ordinaryTextureMask,
  punctualLightCount: scene?.punctualLights.length ?? 0,
});


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
  overlay: boolean,
  depthEqual = false,
): SurfaceDrawPacket => ({
  alphaBlend: surface.material.alphaBlend === true,
  colorWrite: true,
  cullBackFaces: !canonicalSurfaceIsDoubleSided(surface.material),
  ...(depthEqual ? { depthEqual: true } : {}),
  depthTest: !overlay,
  depthWrite: !overlay && surface.material.alphaBlend !== true,
  frontFace: surface.modelHandedness < 0 ? gl.CW : gl.CCW,
  program,
  textureBindings,
  textureUnits,
  vertexArray,
});

export type SurfacePresentationLane = "overlay" | "world";

export type SurfaceGpuOwnerOptions = Readonly<{
  etc2Available?: boolean;
  onChanged?: () => void;
  onFailure?: (error: unknown) => void;
  presentationLane?: SurfacePresentationLane;
  uploadBudget?: FrameUploadBudgetOwner;
}>;

/** Coordinates one context generation's program, geometry, texture, and draw-state owners. */
export class SurfaceGpuOwner {
  #admittedSurfaceCount = 0;
  readonly #cameraPosition = new Float32Array(4);
  readonly #borrowedGeometry = new WeakMap<GpuSurface, Readonly<{
    instanced: BorrowedSurfaceGeometryMatch;
    ordinary: BorrowedSurfaceGeometryMatch;
  }>>();
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
  readonly #defaultFramebufferSamples: number;
  #depthProgramLoadGeneration = 0;
  #depthProgramLoadRequested = false;
  #depthPrepassOwner: SurfaceDepthPrepassOwner | null = null;
  #depthPrepassRunEnds: Uint32Array<ArrayBufferLike> = EMPTY_RUN_ENDS;
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
  #transmissionMultiDrawRunEnds: Uint32Array<ArrayBufferLike> = EMPTY_RUN_ENDS;
  #gpuScene: CanonicalSurfaceScene | null = null;
  #gpuSurfacesBySceneIndex: GpuSurface[] = [];
  #instanceTransformsPending = false;
  readonly #materialUniforms = createCanonicalMaterialUniformStorage();
  #multiDraw: WebGlMultiDraw | null;
  #multiDrawCounts = new Int32Array(0);
  #multiDrawOffsets = new Int32Array(0);
  readonly #ordinaryBindingScratch = Array<GpuTextureBinding>(MATERIAL_TEXTURE_UNITS);
  readonly #partitionPattern: ScreenSpacePartitionPatternOwner;
  readonly #presentationLane: SurfacePresentationLane;
  readonly #lodSelection = createDrawableLodSelectionWorkspace();
  readonly #lightUniforms = createCanonicalLightUniformStorage();
  readonly #sceneUniforms = createCanonicalSceneUniformStorage();
  readonly #fallbackBaseColor = new Float32Array(4);
  readonly #programs: SurfaceProgramOwner;
  readonly #resourceBudget: PersistentGpuBudgetOwner;
  #scene: CanonicalSurfaceScene | null = null;
  #screenSpacePartitionRequested = false;
  #sceneGlobalsRevision = 0;
  #programMaterialSources = new WeakMap<WebGLProgram, CanonicalSurfaceMaterial>();
  #standardProgramSceneGlobals = new WeakMap<WebGLProgram, number>();
  readonly #textureGpu: TextureGpuOwner;
  readonly #textureSamplerClaim = new Set<string>();
  readonly #textureStorageClaim = new Set<string>();
  readonly #texturePublicationKeys = new Set<string>();
  readonly #texturePublicationWorkspace = createTexturePublicationWorkspace();
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
    budget: PersistentGpuBudgetOwner,
    partitionPattern: ScreenSpacePartitionPatternOwner,
    {
      etc2Available = true,
      onChanged = () => undefined,
      onFailure = () => undefined,
      presentationLane = "world",
      uploadBudget = new FrameUploadBudgetOwner(),
    }: SurfaceGpuOwnerOptions = {},
  ) {
    this.#geometryGpu = new SurfaceGeometryGpuOwner(gl, budget);
    this.#gl = gl;
    this.#defaultFramebufferSamples = Number(gl.getParameter(gl.SAMPLES));
    this.#onChanged = onChanged;
    this.#onFailure = onFailure;
    this.#multiDraw = this.#readMultiDraw();
    this.#linearCompositeCapabilities = {
      hasFloatBlendTarget: this.#readExtension("EXT_float_blend"),
      hasFloatColorTarget: this.#readExtension("EXT_color_buffer_float"),
    };
    this.#programs = new SurfaceProgramOwner(gl);
    this.#partitionPattern = partitionPattern;
    this.#presentationLane = presentationLane;
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
    this.#virtualTexture = null;
    this.#fullReconcileRequired = true;
    this.#clearGpuSurfaces();
    this.#scene = null;
    this.#screenSpacePartitionRequested = false;
    this.#textureSamplerClaim.clear();
    this.#textureStorageClaim.clear();
    this.#texturePublicationKeys.clear();
    this.#compositeActive = false;
    this.#compositeBindingRevision = 0;
    this.#transmissionCandidateIndices.length = 0;
    this.#compositeFramePlan.visibility = new Uint8Array(0);
    this.#terminalPresentationEligible = false;
    this.#terminalPresentationHasAlphaBlend = false;
    this.#depthPrepassActive = false;
  }

  invalidate(): void {
    if (this.#environmentGpuLoadRequested) {
      this.#environmentGpuLoadGeneration += 1;
      this.#environmentGpuLoadRequested = false;
    }
    this.#environmentGpu?.invalidate();
    this.#geometryGpu.invalidate();
    this.#depthPrepassOwner?.invalidate();
    this.#clearGpuSurfaces();
    this.#textureGpu.invalidate();
    this.#programs.invalidate();
    this.#programMaterialSources = new WeakMap<WebGLProgram, CanonicalSurfaceMaterial>();
    this.#standardProgramSceneGlobals = new WeakMap<WebGLProgram, number>();
    this.#compositeGpu?.invalidate();
    this.#virtualTexture?.invalidate();
    this.#multiDraw = this.#readMultiDraw();
    this.#setDepthPrepassActive(this.#scene?.camera.position ?? this.#cameraPosition);
    this.#fullReconcileRequired = true;
    this.#dirty = this.#scene !== null;
    this.#compositeActive = false;
    this.#compositeBindingRevision = this.#compositeGpu?.bindingRevision ?? 0;
    this.#texturePublicationKeys.clear();
  }

  #readMultiDraw(): WebGlMultiDraw | null {
    return this.#gl.getExtension("WEBGL_multi_draw") as WebGlMultiDraw | null;
  }

  #clearGpuSurfaces(): void {
    this.#admittedSurfaceCount = 0;
    this.#opaqueSurfaces = [];
    this.#opaqueMultiDrawRunEnds = EMPTY_RUN_ENDS;
    this.#blendedSurfaces = [];
    this.#transmissionSurfaces = [];
    this.#transmissionMultiDrawRunEnds = EMPTY_RUN_ENDS;
    this.#depthPrepassRunEnds = EMPTY_RUN_ENDS;
    this.#gpuSurfacesBySceneIndex = [];
    this.#gpuScene = null;
    this.#instanceTransformsPending = false;
  }

  #readExtension(name: string): boolean {
    return this.#gl.getExtension(name) !== null;
  }

  /** Current canonical LOD choices shared by visual submission and exact picking. */
  lodSelections(): LodLevelSelections {
    return this.#lodSelection.currentLevels;
  }

  /**
   * Borrows the exact currently presented world occurrence without transferring
   * ownership of its geometry, indices, instance buffer, or VAO.
   */
  borrowPresentedGeometry(
    requested: CanonicalEdgeSurface,
  ): BorrowedSurfaceGeometryMatch {
    const scene = this.#scene;
    if (scene === null) return ABSENT_BORROWED_GEOMETRY;
    let found = false;
    let readyIndex = -1;
    let readyAsOrdinary = false;
    let pending = false;
    for (let index = 0; index < scene.surfaces.length; index += 1) {
      const surface = scene.surfaces[index]!;
      const sourceKind = matchingBorrowedSurfaceSourceKind(surface, requested);
      if (sourceKind === null) continue;
      found = true;
      const resource = this.#gpuSurfacesBySceneIndex[index];
      if (resource === undefined) {
        pending = true;
        continue;
      }
      if (!lodMembershipsSelected(surface.lods, this.#lodSelection.currentLevels)) continue;
      if (readyIndex === -1) {
        readyIndex = index;
        readyAsOrdinary = sourceKind === "automatic-member";
      }
    }
    if (!found) return ABSENT_BORROWED_GEOMETRY;
    if (readyIndex !== -1) {
      return this.#borrowedGeometryMatch(
        this.#gpuSurfacesBySceneIndex[readyIndex]!,
        readyAsOrdinary,
      );
    }
    return pending ? PENDING_BORROWED_GEOMETRY : INACTIVE_BORROWED_GEOMETRY;
  }

  #borrowedGeometryMatch(
    resource: GpuSurface,
    ordinary: boolean,
  ): BorrowedSurfaceGeometryMatch {
    let matches = this.#borrowedGeometry.get(resource);
    if (matches === undefined) {
      const geometry = {
        identity: resource.geometry,
        indexBuffer: resource.geometry.indexBuffer,
        indexCount: resource.geometry.indexCount,
        indexOffset: resource.geometry.indexOffset,
        indexType: resource.geometry.indexType,
        key: resource.geometry.key,
        vertexBuffer: resource.geometry.vertexBuffer,
      };
      const match = (instanceCount: number): BorrowedSurfaceGeometryMatch => ({
        resource: {
          geometry,
          identity: resource,
          instanceCount,
          vertexArray: resource.vertexArray,
        },
        status: "ready",
      });
      matches = {
        instanced: match(resource.instanceCount),
        ordinary: match(0),
      };
      this.#borrowedGeometry.set(resource, matches);
    }
    return ordinary ? matches.ordinary : matches.instanced;
  }

  takeUploadedTextureStorageKeys(): readonly string[] {
    return this.#textureGpu.takeUploadedStorageKeys();
  }

  takeReleasedTextureStorageKeys(): readonly string[] {
    return this.#textureGpu.takeReleasedStorageKeys();
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
    collectCompleteSurfaceTextureClaimsInto(
      scene,
      this.#textureStorageClaim,
      this.#textureSamplerClaim,
    );
    this.#textureGpu.releaseUnclaimed(
      this.#textureStorageClaim,
      this.#textureSamplerClaim,
    );
    this.#sceneGlobalsRevision += 1;
    this.#programMaterialSources = new WeakMap<WebGLProgram, CanonicalSurfaceMaterial>();
    const retainedSurfaceCount = retainedSurfaceAdmissionCount(
      this.#scene?.surfaces ?? [],
      scene?.surfaces ?? [],
      this.#admittedSurfaceCount,
    );
    if (this.#geometryGpu.releaseSupersededPlan(scene?.surfaces ?? [])) {
      this.#clearGpuSurfaces();
    } else this.#admittedSurfaceCount = retainedSurfaceCount;
    this.#scene = scene;
    this.#screenSpacePartitionRequested = scene?.surfaces.some(
      (surface) => surface.material.kind === "unlit"
        && surface.material.coverage !== undefined,
    ) ?? false;
    this.#depthPrepassPlan = planOpaqueDepthPrepass(
      this.#presentationLane === "world" ? scene?.surfaces ?? [] : [],
    );
    this.#setDepthPrepassActive(scene?.camera.position ?? this.#cameraPosition);
    this.#instanceTransformsPending = false;
    this.#compositeGpu?.resetAdmission();
    this.#terminalPresentationEligible = this.#presentationLane === "world"
      && scene !== null
      && scene.surfaces.every((surface) => surface.material.kind === "standard");
    this.#terminalPresentationHasAlphaBlend = this.#presentationLane === "world"
      && (scene?.surfaces.some(
      (surface) => surface.material.alphaBlend === true,
      ) ?? false);
    this.#transmissionCandidateIndices.length = 0;
    const environmentFeatures = sceneEnvironmentFeatures(
      scene,
      this.#environmentGpu?.binding,
    );
    for (let index = 0; index < (scene?.surfaces.length ?? 0); index += 1) {
      const surface = scene!.surfaces[index]!;
      const material = surface.material;
      if (
        this.#presentationLane === "world"
        && canonicalMaterialHasTransmission(material)
      ) {
        this.#transmissionCandidateIndices.push(index);
      } else if (material.baseColorVirtualAsset === undefined) {
        const authoredMask = authoredOrdinaryTextureMask(material);
        const variantCount = authoredMask === 0 ? 1 : 2;
        for (let variant = 0; variant < variantCount; variant += 1) {
          const ordinaryTextureMask = variant === 0 ? 0 : authoredMask;
          this.#programs.prewarm(
            material.kind,
            plannedSurfaceProgramFeatures(
              scene,
              surface,
              environmentFeatures,
              false,
              this.#compositeActive,
              ordinaryTextureMask,
            ),
            (surface.instances?.count ?? 0) > 0,
            material.alphaCutoff !== undefined,
            canonicalSurfaceIsDoubleSided(material),
          );
        }
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

  publishTextureBatch(scene: CanonicalSurfaceScene, textureKeys: Iterable<string>): void {
    if (this.#scene === null || this.#scene.surfaces.length !== scene.surfaces.length) {
      this.setScene(scene);
      return;
    }
    this.#scene = scene;
    // Texture resolution cannot change pass membership or presentation policy;
    // retain the cold setScene resource claims and publish only affected packets.
    for (const textureKey of textureKeys) this.#texturePublicationKeys.add(textureKey);
    this.#dirty = true;
  }

  /** Publishes retained instance matrices without replacing static scene identity. */
  publishInstanceTransforms(): void {
    if (this.#scene === null) return;
    if (this.#presentationLane === "world") {
      updateOpaqueDepthPrepassPlan(this.#depthPrepassPlan, this.#scene.surfaces);
    }
    this.#dirty = true;
    if (
      this.#gpuScene !== this.#scene
      || this.#admittedSurfaceCount < this.#scene.surfaces.length
    ) this.#fullReconcileRequired = true;
    else this.#instanceTransformsPending = true;
  }

  /**
   * Publishes lowering-owned object matrices without replacing scene identity
   * or touching geometry/instance storage.
   */
  publishObjectTransforms(
    surfaceIndices: readonly number[],
    sceneGlobalsChanged: boolean,
  ): void {
    const scene = this.#scene;
    if (scene === null) return;
    if (this.#presentationLane === "world") {
      updateOpaqueDepthPrepassPlan(this.#depthPrepassPlan, scene.surfaces);
    }
    if (sceneGlobalsChanged) {
      packCanonicalLightUniformsInto(
        scene.directionalLights,
        scene.punctualLights,
        this.#lightUniforms,
      );
      this.#sceneGlobalsRevision += 1;
    }
    if (this.#fullReconcileRequired || this.#gpuScene !== scene) return;
    for (const surfaceIndex of surfaceIndices) {
      const resource = this.#gpuSurfacesBySceneIndex[surfaceIndex];
      const surface = scene.surfaces[surfaceIndex];
      if (resource === undefined || surface === undefined) continue;
      resource.surface = surface;
      const frontFace = surface.modelHandedness < 0 ? this.#gl.CW : this.#gl.CCW;
      if (resource.drawPacket.frontFace !== frontFace) {
        resource.drawPacket = { ...resource.drawPacket, frontFace };
      }
      if (
        resource.depthPacket !== null
        && resource.depthPacket.frontFace !== frontFace
      ) resource.depthPacket = { ...resource.depthPacket, frontFace };
    }
    if (this.#multiDraw !== null) this.#planOpaqueMultiDrawRuns();
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
    cssScaleX = 1,
    cssScaleY = 1,
  ): boolean {
    const scene = this.#scene;
    if (scene !== null && views.length !== 0) {
      cameraWorldPositionFromViewInto(this.#cameraPosition, views[0]!.view);
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
    if (scene !== null && views.length !== 0) {
      this.#setDepthPrepassActive(
        this.#cameraPosition,
        framebuffer === null
          && !compositeRequested
          && this.#defaultFramebufferSamples > 1,
      );
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
        this.#drawView(
          view,
          viewIndex,
          visibilityStride,
          framebuffer,
          state,
          scene,
          "all",
          cssScaleX,
          cssScaleY,
        );
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
          cssScaleX,
          cssScaleY,
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
          cssScaleX,
          cssScaleY,
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
    if (
      this.#screenSpacePartitionRequested
      && this.#partitionPattern.ensure()
    ) state.invalidate();
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

  #setDepthPrepassActive(
    cameraPosition: ArrayLike<number>,
    multisampledDirect = false,
  ): void {
    const active = this.#presentationLane === "world"
      && this.#multiDraw !== null
      && opaqueDepthPrepassRequested(
        this.#depthPrepassPlan,
        cameraPosition,
        this.#depthPrepassActive,
        multisampledDirect,
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
    if (this.#multiDraw !== null && this.#depthPrepassPlan.candidateCount >= 32) {
      if (this.#depthPrepassOwner !== null) {
        this.#dirty = true;
        this.#fullReconcileRequired = true;
      }
      return;
    }
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
    cssScaleX: number,
    cssScaleY: number,
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
    if (
      this.#presentationLane === "world"
      && surfaceDrawPassNeedsDepthOrder(pass)
    ) {
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
          this.#lodSelection.currentLevels,
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
      if (!lodMembershipsSelected(surface.lods, this.#lodSelection.currentLevels)) continue;
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
        if (program.partition !== null) {
          if (programChanged) {
            gl.uniform2f(
              program.partition.viewportOrigin,
              frameView.viewport.x,
              frameView.viewport.y,
            );
            const coverage = surface.material.kind === "unlit"
              ? surface.material.coverage
              : undefined;
            if (coverage === undefined) {
              throw new Error("Royal partitioned unlit program got solid coverage");
            }
            gl.uniform2f(
              program.partition.cellSize,
              coverage.cellSizeCssPixels * cssScaleX,
              coverage.cellSizeCssPixels * cssScaleY,
            );
          }
        }
        if (transformChanged) {
          multiplyMat4Into(this.#viewProjectionModel, viewProjection, surface.model);
          gl.uniformMatrix4fv(program.viewProjectionModel, false, this.#viewProjectionModel);
        }
        if (materialChanged) {
          if (program.partition !== null) {
            const coverage = surface.material.kind === "unlit"
              ? surface.material.coverage
              : undefined;
            if (coverage === undefined) {
              throw new Error("Royal partitioned unlit program got solid coverage");
            }
            gl.uniform1i(program.partition.count, coverage.count);
            gl.uniform1i(program.partition.index, coverage.index);
          }
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
              program.directionalLightColors !== null
              && program.directionalLightDirections !== null
            ) {
              gl.uniform4fv(
                program.directionalLightColors,
                this.#lightUniforms.directionalColors,
                0,
                scene.directionalLights.length * 4,
              );
              gl.uniform4fv(
                program.directionalLightDirections,
                this.#lightUniforms.directionalDirections,
                0,
                scene.directionalLights.length * 4,
              );
            }
            if (
              program.punctualLightColors !== null
              && program.punctualLightDirections !== null
              && program.punctualLightPositions !== null
              && program.punctualLightSpotCones !== null
            ) {
              gl.uniform4fv(
                program.punctualLightColors,
                this.#lightUniforms.punctualColors,
                0,
                scene.punctualLights.length * 4,
              );
              gl.uniform4fv(
                program.punctualLightDirections,
                this.#lightUniforms.punctualDirections,
                0,
                scene.punctualLights.length * 4,
              );
              gl.uniform4fv(
                program.punctualLightPositions,
                this.#lightUniforms.punctualPositions,
                0,
                scene.punctualLights.length * 4,
              );
              gl.uniform4fv(
                program.punctualLightSpotCones,
                this.#lightUniforms.punctualSpotCones,
                0,
                scene.punctualLights.length * 4,
              );
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
          if (program.normalTransform !== null) {
            gl.uniformMatrix4fv(program.normalTransform, false, surface.normalTransform);
          }
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
        let runEnd = index + 1;
        if (opaqueBucket) {
          runEnd = bucketOffset
            + (this.#opaqueMultiDrawRunEnds[bucketIndex] ?? bucketIndex + 1);
        } else if (transmissionBucket && !resource.drawPacket.alphaBlend) {
          runEnd = bucketOffset
            + (this.#transmissionMultiDrawRunEnds[bucketIndex] ?? bucketIndex + 1);
        } else {
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
            lodMembershipsSelected(next.surface.lods, this.#lodSelection.currentLevels)
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
    const features = plannedSurfaceProgramFeatures(
      scene,
      geometrySurface.surface,
      sceneEnvironmentFeatures(scene, this.#environmentGpu?.binding),
      virtualTexture !== undefined,
      this.#compositeActive,
      presentableOrdinaryTextureMask(
        material,
        residentOrdinaryTextureMask(ordinaryBindings, bindingOffset),
      ),
    );
    const bindings = Array<GpuTextureBinding>(
      SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT + 1,
    );
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
    if (material.kind === "unlit" && material.coverage !== undefined) {
      bindings[SCREEN_SPACE_PARTITION_SURFACE_TEXTURE_UNIT] =
        this.#partitionPattern.binding;
    }
    const program = this.#programs.get(
      material.kind,
      features,
      geometrySurface.instanceCount > 0,
      material.alphaCutoff !== undefined,
      canonicalSurfaceIsDoubleSided(material),
    );
    const depthProgram = this.#presentationLane === "world"
      && this.#depthPrepassActive
      && surfaceCanUseOpaqueDepthPrepass(geometrySurface.surface)
      ? this.#depthPrepassOwner?.get(geometrySurface.instanceCount > 0) ?? null
      : null;
    return {
      depthOrder: 0,
      depthOrderGroup: 0,
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
        this.#presentationLane === "overlay",
        depthProgram !== null,
      ),
      geometry: geometrySurface.geometry,
      instanceCount: geometrySurface.instanceCount,
      lodDrawable: geometrySurface.surface.materialLodLevel !== true
        || material.baseColorAsset === undefined
        || ordinaryBindings[bindingOffset]!.texture !== null,
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
    const scene = this.#scene;
    const surfaces = scene?.surfaces ?? [];
    const retainedSurfaceCount = !this.#fullReconcileRequired
      && this.#gpuScene === scene
      ? this.#admittedSurfaceCount
      : 0;
    const geometryPlan = this.#geometryGpu.prepare(
      surfaces,
      surfaces.length,
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
        const textureBindings = this.#textureGpu.reconcileClaimedBatch(
          textureInputs,
          this.#textureStorageClaim,
          this.#textureSamplerClaim,
        );
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
        if (this.#presentationLane === "overlay") {
          this.#blendedSurfaces.push(...appendedSurfaces);
        } else {
          const appended = planSurfacePasses(
            appendedSurfaces,
            (resource) => resource.surface.material,
          );
          this.#opaqueSurfaces.push(...appended.opaque);
          this.#blendedSurfaces.push(...appended.transparent);
          this.#transmissionSurfaces.push(...appended.transmission);
        }
      } else {
        this.#replaceDrawBuckets(nextSurfaces);
      }
      this.#planOpaqueMultiDrawRuns();
    } catch (error) {
      geometryPlan.rollback();
      throw error;
    }
    if (scene !== null) {
      packCanonicalLightUniformsInto(
        scene.directionalLights,
        scene.punctualLights,
        this.#lightUniforms,
      );
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
    const workspace = this.#texturePublicationWorkspace;
    const affectedIndices = collectTexturePublicationSurfaceIndicesInto(
      workspace,
      this.#texturePublicationKeys,
      scene.textureSurfaceIndices,
      scene.surfaces.length,
    );
    let regroup = false;
    for (const index of affectedIndices) {
      if (index >= surfaces.length) {
        workspace.deferred[index] = 0;
        continue;
      }
      const resource = surfaces[index]!;
      const surface = scene.surfaces[index]!;
      const material = surface.material;
      const ordinaryBindings = this.#retainOrdinaryTextureBindings(material);
      workspace.deferred[index] = this.#materialUploadDeferred(material) ? 1 : 0;
      const features = surfaceProgramFeatureBits({
        directionalLightCount: scene.directionalLights.length,
        environmentFeatures: sceneEnvironmentFeatures(scene, this.#environmentGpu?.binding),
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
        punctualLightCount: scene.punctualLights.length,
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
      resource.lodDrawable = surface.materialLodLevel !== true
        || material.baseColorAsset === undefined
        || ordinaryBindings[0]!.texture !== null;
      if (!textureUnitsChanged) continue;
      regroup ||= program.program !== resource.program.program;
      resource.drawPacket = surfaceDrawPacket(
        this.#gl,
        surface,
        program.program,
        retainedBindings,
        textureUnits,
        resource.vertexArray,
        this.#presentationLane === "overlay",
        resource.depthPacket !== null,
      );
      resource.program = program;
    }
    for (const key of this.#texturePublicationKeys) {
      const indices = scene.textureSurfaceIndices.get(key);
      if (indices === undefined) {
        this.#texturePublicationKeys.delete(key);
        continue;
      }
      let deferred = false;
      for (const index of indices) {
        if (index < surfaces.length && workspace.deferred[index] === 1) {
          deferred = true;
          break;
        }
      }
      if (!deferred) this.#texturePublicationKeys.delete(key);
    }
    if (regroup) {
      this.#replaceDrawBuckets(surfaces);
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
    this.#opaqueMultiDrawRunEnds = planRetainedContiguousRunEnds(
      this.#opaqueMultiDrawRunEnds,
      this.#opaqueSurfaces,
      surfacesShareMultiDrawState,
    );
    this.#depthPrepassRunEnds = planRetainedContiguousRunEnds(
      this.#depthPrepassRunEnds,
      this.#opaqueSurfaces,
      surfacesShareDepthPrepassState,
    );
    this.#transmissionMultiDrawRunEnds = planRetainedContiguousRunEnds(
      this.#transmissionMultiDrawRunEnds,
      this.#transmissionSurfaces,
      surfacesShareMultiDrawState,
    );
    for (let start = 0; start < this.#transmissionSurfaces.length;) {
      const end = this.#transmissionMultiDrawRunEnds[start] ?? start + 1;
      for (let index = start; index < end; index += 1) {
        this.#transmissionSurfaces[index]!.depthOrderGroup = start;
      }
      start = end;
    }
  }

  #replaceDrawBuckets(surfaces: readonly GpuSurface[]): void {
    if (this.#presentationLane === "overlay") {
      this.#opaqueSurfaces = [];
      this.#transmissionSurfaces = [];
      this.#blendedSurfaces = [...surfaces];
      return;
    }
    const grouped = groupSurfacesForDrawing(surfaces);
    this.#opaqueSurfaces = grouped.opaque;
    this.#blendedSurfaces = grouped.transparent;
    this.#transmissionSurfaces = grouped.transmission;
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
