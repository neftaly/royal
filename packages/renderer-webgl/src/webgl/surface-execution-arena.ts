import type { Material, TextureSampler } from "@royal/renderer-core";
import type { FrameTextureResidencyIntent } from "../frame/texture-residency-intent";
import {
  toneMappingShaderMode,
  type SurfaceToneMappingState,
} from "../surface-presentation-policy";
import type { GltfFrameBatchArena, GltfFrameBatchCounters, GltfFrameDrawBatch } from "../gltf/frame-batch-arena";
import { IDENTITY_GLTF_TEXTURE_COORDINATES } from "../gltf/texture-coordinates";
import {
  affineSurfaceNormalTransformInto,
  cameraWorldPositionFromViewInto,
  identityMat4,
  type Mat4,
  type MutableVec3,
} from "../math/mat4";
import type { OrdinaryTextureResidencyController } from "../texture/ordinary-residency-controller";
import {
  copyTransmissionScreenColorTexture,
  type ScreenColorTextureResource,
  type SurfaceRenderTargetArena,
} from "../surface-render-target-arena";
import type { BaseColorTextureResidency, ViewportSize, VirtualTextureRuntimeState } from "../virtual-texture/runtime";
import type { VertexInputGeometry } from "../vertex-input/arena";
import type { VirtualTextureGpuBinding } from "../virtual-texture/gpu-arena";
import type { ClusteredLightingFeature } from "../clustered-lighting-feature";
import {
  drawGeometry,
  prepareGeometryInstancedDraw,
  submitGeometryInstancedDraw,
  type GeometryDrawArena,
} from "./geometry-draw-arena";
import {
  EMPTY_SURFACE_LIGHT_SET,
  MAX_SURFACE_LIGHTS,
  type SurfaceLightSet,
} from "./lights";
import {
  isBlendedSurfaceMaterial,
  surfaceMaterialAlphaCutoff,
  surfaceMaterialAlphaMode,
  surfaceMaterialExtensionFactors,
  surfaceMaterialMetallicFactor,
  surfaceMaterialOcclusionStrength,
  surfaceMaterialRoughnessFactor,
  surfaceMaterialUsesPbrExtensions,
  surfaceMaterialUsesTransmission,
  textureCacheKey,
  type SurfaceMaterial,
  type SurfaceMaterialPublication,
  type SurfaceMaterialTextureCoordinates,
  type TextureAssetUploadRef,
} from "./materials";
import type { OrdinaryTextureGpuResource } from "../texture/ordinary-gpu-arena";
import {
  consumeProgramArenaWake,
  requestProgram,
  uniform1f,
  uniform1i,
  uniform2f,
  uniformColor,
  uniform4f,
  uniformMatrix,
  uniformMatrixUncached,
  useProgram,
  type ProgramArena,
} from "./program-arena";
import type { ProgramKind, SurfaceShaderTextureFeature } from "./shaders";
import {
  createSurfaceTextureBindingWorkspace,
  SURFACE_MATERIAL_TEXTURE_BINDINGS,
  planSurfaceTextureBindings,
  resolveAdmittedSurfaceTextureBindings,
  type AdmittedSurfaceTextureReadiness,
  type SurfaceBaseColorPlanInput,
  type SurfaceIndependentTextureFeature,
  type SurfaceTextureBindingPlanInput,
  type SurfaceTextureBindingPlan as PureSurfaceTextureBindingPlan,
  type SurfaceTextureCandidate,
  type SurfaceTextureBindingWorkspace,
} from "./surface-texture-binding-plan";
import { WebGlTextureBindingShell } from "./texture-binding-shell";

const TEXTURE_COLOR = [1, 1, 1, 1] as const;
const EMPTY_SURFACE_TEXTURE_FEATURES: ReadonlySet<SurfaceShaderTextureFeature> = new Set();
// Perceptual 50% sRGB gray represented in scene-linear space. Loading is a
// neutral publication state, not an unsupported-texture diagnostic.
const LOADING_SURFACE_COLOR = [0.21404114, 0.21404114, 0.21404114, 1] as const;
const UNSUPPORTED_VIRTUAL_TEXTURE_COLOR = [1, 0, 1, 1] as const;
const EMPTY_SURFACE_DIAGNOSTICS: readonly SurfaceExecutionDiagnostic[] = [];
const VT_WRAP_CLAMP_TO_EDGE = 0;
const VT_WRAP_REPEAT = 1;
const VT_WRAP_MIRRORED_REPEAT = 2;
const IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT = 15;
const DIRECTIONAL_LIGHT_UNIFORMS = Array.from({ length: MAX_SURFACE_LIGHTS }, (_, index) => [
  `u_surfaceLightColor[${index}]`,
  `u_surfaceLightDirection[${index}]`,
] as const);
const BASE_COLOR_INPUT_NONE: SurfaceBaseColorPlanInput = { kind: "none" };
const BASE_COLOR_INPUT_ORDINARY_READY: SurfaceBaseColorPlanInput = {
  kind: "ordinary",
  ordinary: "ready",
};
const BASE_COLOR_INPUT_ORDINARY_UNAVAILABLE: SurfaceBaseColorPlanInput = {
  kind: "ordinary",
  ordinary: "unavailable",
};
const BASE_COLOR_INPUT_VIRTUAL_READY: SurfaceBaseColorPlanInput = {
  kind: "virtual",
  virtual: "ready",
};
const BASE_COLOR_INPUT_VIRTUAL_READY_FALLBACK: SurfaceBaseColorPlanInput = {
  fallback: "ready",
  kind: "virtual",
  virtual: "ready",
};
const BASE_COLOR_INPUT_VIRTUAL_READY_FALLBACK_UNAVAILABLE: SurfaceBaseColorPlanInput = {
  fallback: "unavailable",
  kind: "virtual",
  virtual: "ready",
};
const BASE_COLOR_INPUT_VIRTUAL_UNAVAILABLE: SurfaceBaseColorPlanInput = {
  kind: "virtual",
  virtual: "unavailable",
};
const BASE_COLOR_INPUT_VIRTUAL_UNAVAILABLE_FALLBACK_READY: SurfaceBaseColorPlanInput = {
  fallback: "ready",
  kind: "virtual",
  virtual: "unavailable",
};
const BASE_COLOR_INPUT_VIRTUAL_UNAVAILABLE_FALLBACK_UNAVAILABLE: SurfaceBaseColorPlanInput = {
  fallback: "unavailable",
  kind: "virtual",
  virtual: "unavailable",
};

type MutableTextureBindingPlanInput = {
  -readonly [Key in keyof SurfaceTextureBindingPlanInput]: SurfaceTextureBindingPlanInput[Key];
};
type MutableTextureReadiness = {
  -readonly [Key in keyof AdmittedSurfaceTextureReadiness]: AdmittedSurfaceTextureReadiness[Key];
};
type TextureCoordinateUniformNames = Readonly<{
  row0: string;
  row1: string;
  set: string;
}>;
type SurfaceMaterialTextureCandidateEntry = Readonly<{
  descriptor: (typeof SURFACE_MATERIAL_TEXTURE_BINDINGS)[number];
  texture: TextureAssetUploadRef;
  uniforms: TextureCoordinateUniformNames;
}>;
type SurfaceTextureAdmissionCacheEntry = Readonly<{
  readonly baseColor: SurfaceBaseColorPlanInput;
  readonly brdfLutPreferredUnit: number;
  readonly clusterGridUnit: number;
  readonly clusterIndicesUnit: number;
  readonly clusterLightsUnit: number;
  readonly ibl: boolean;
  readonly maxTextureUnits: number;
  readonly plan: PureSurfaceTextureBindingPlan;
  readonly punctual: boolean;
  readonly transmission: boolean;
}>;
type SurfaceMaterialTextureCatalog = Readonly<{
  admissions: SurfaceTextureAdmissionCacheEntry[];
  candidates: Partial<Record<SurfaceIndependentTextureFeature, SurfaceTextureCandidate>>;
  entries: readonly SurfaceMaterialTextureCandidateEntry[];
  extendedMaterial: boolean;
  runtime: SurfaceMaterialTextureRuntime;
  transmission: boolean;
}>;
const textureCoordinateUniformNames = (stem: string): TextureCoordinateUniformNames => ({
  row0: `${stem}Row0`,
  row1: `${stem}Row1`,
  set: `${stem}Set`,
});
const BASE_COLOR_TEXTURE_COORDINATE_UNIFORMS = textureCoordinateUniformNames("u_baseColorUv");
const SURFACE_MATERIAL_TEXTURE_COORDINATE_UNIFORMS = SURFACE_MATERIAL_TEXTURE_BINDINGS.map(
  (descriptor) => textureCoordinateUniformNames(descriptor.uvUniformStem),
);

const createSurfaceMaterialTextureCatalog = (
  material: SurfaceMaterial,
): SurfaceMaterialTextureCatalog => {
  const candidates: Partial<Record<SurfaceIndependentTextureFeature, SurfaceTextureCandidate>> = {};
  const entries: SurfaceMaterialTextureCandidateEntry[] = [];
  const extendedMaterial = surfaceMaterialUsesPbrExtensions(material);
  const transmission = surfaceMaterialUsesTransmission(material);
  for (let index = 0; index < SURFACE_MATERIAL_TEXTURE_BINDINGS.length; index += 1) {
    const descriptor = SURFACE_MATERIAL_TEXTURE_BINDINGS[index]!;
    if (!extendedMaterial && index >= 4) continue;
    const texture = descriptor.key === "emissiveTexture"
      ? material.emissiveTexture
      : material.kind === "standard" ? material[descriptor.key] : undefined;
    if (texture === undefined) continue;
    candidates[descriptor.feature] = "ready";
    entries.push({
      descriptor,
      texture,
      uniforms: SURFACE_MATERIAL_TEXTURE_COORDINATE_UNIFORMS[index]!,
    });
  }
  return {
    admissions: [],
    candidates,
    entries,
    extendedMaterial,
    runtime: createSurfaceMaterialTextureRuntime(),
    transmission,
  };
};

export interface SurfaceExecutionCounters extends GltfFrameBatchCounters {
  drawCalls: number;
  instancesDrawn: number;
}

export interface SurfaceExecutionDiagnostic {
  readonly key: string;
  readonly message: string;
}

export interface SurfaceExecutionSignals {
  readonly diagnostics: readonly SurfaceExecutionDiagnostic[];
  readonly wakeRequested: boolean;
}

type ReadyOrdinaryTexture = Extract<OrdinaryTextureGpuResource, { readonly uploaded: true }>;
type SurfaceBaseColorTextureBinding =
  | typeof NO_BASE_COLOR_TEXTURE_BINDING
  | {
      readonly kind: "ordinary";
      readonly resource: ReadyOrdinaryTexture;
    }
  | {
      readonly kind: "prepared-virtual";
      readonly ordinaryFallback?: TextureAssetUploadRef;
      readonly state: VirtualTextureRuntimeState;
    };
type MutableOrdinaryBaseColorTextureBinding = {
  kind: "ordinary";
  resource: ReadyOrdinaryTexture;
};
type MutableVirtualBaseColorTextureBinding = {
  kind: "prepared-virtual";
  ordinaryFallback?: TextureAssetUploadRef;
  state: VirtualTextureRuntimeState;
};
type SurfaceBaseColorBindingKind = SurfaceBaseColorTextureBinding["kind"];
const NO_BASE_COLOR_TEXTURE_BINDING = { kind: "none" } as const;

type SurfaceTextureBindingPlan = Omit<PureSurfaceTextureBindingPlan, "baseColor"> & {
  readonly baseColor: SurfaceBaseColorTextureBinding;
  readonly criticalPending: boolean;
  readonly extendedMaterial: boolean;
  readonly materialTextures: readonly SurfaceMaterialTextureCandidateEntry[];
  readonly readyTextures: ReadonlyMap<SurfaceShaderTextureFeature, Extract<
    OrdinaryTextureGpuResource,
    { readonly uploaded: true }
  >>;
};

type MutableSurfaceTextureBindingPlan = {
  baseColor: SurfaceBaseColorTextureBinding;
  criticalPending: boolean;
  extendedMaterial: boolean;
  featureMask: number;
  features: PureSurfaceTextureBindingPlan["features"];
  materialTextures: readonly SurfaceMaterialTextureCandidateEntry[];
  omissions: PureSurfaceTextureBindingPlan["omissions"];
  readonly readyTextures: Map<SurfaceShaderTextureFeature, ReadyOrdinaryTexture>;
  textureUnits: PureSurfaceTextureBindingPlan["textureUnits"];
};

type SurfaceMaterialTextureRuntime = {
  lastIntentEpoch: number;
  lastIbl: boolean;
  lastOrdinaryTexture: TextureAssetUploadRef | undefined;
  lastPunctual: boolean;
  lastResidencyKind: "none" | "ordinary" | undefined;
  lastTextureUnitRevision: number;
  lastTransmission: ScreenColorTextureResource | undefined;
  lastTransmissionUploaded: boolean;
  ordinaryBaseColorBinding: MutableOrdinaryBaseColorTextureBinding | undefined;
  readonly plan: MutableSurfaceTextureBindingPlan;
  readonly readinessWorkspace: SurfaceTextureBindingWorkspace;
  readonly readyTextures: Map<SurfaceShaderTextureFeature, ReadyOrdinaryTexture>;
  residencyComplete: boolean;
  virtualBaseColorBinding: MutableVirtualBaseColorTextureBinding | undefined;
};

const createSurfaceMaterialTextureRuntime = (): SurfaceMaterialTextureRuntime => {
  const readinessWorkspace = createSurfaceTextureBindingWorkspace();
  const readyTextures = new Map<SurfaceShaderTextureFeature, ReadyOrdinaryTexture>();
  return {
    lastIntentEpoch: -1,
    lastIbl: false,
    lastOrdinaryTexture: undefined,
    lastPunctual: false,
    lastResidencyKind: undefined,
    lastTextureUnitRevision: -1,
    lastTransmission: undefined,
    lastTransmissionUploaded: false,
    ordinaryBaseColorBinding: undefined,
    plan: {
      baseColor: { kind: "none" },
      criticalPending: false,
      extendedMaterial: false,
      featureMask: 0,
      features: readinessWorkspace.plan.features,
      materialTextures: [],
      omissions: readinessWorkspace.plan.omissions,
      readyTextures,
      textureUnits: readinessWorkspace.plan.textureUnits,
    },
    readinessWorkspace,
    readyTextures,
    residencyComplete: false,
    virtualBaseColorBinding: undefined,
  };
};

export interface SurfaceSingleExecution {
  readonly baseColorResidency: BaseColorTextureResidency;
  readonly contextGeneration: number;
  readonly frame: number;
  readonly geometry: VertexInputGeometry;
  readonly lights: SurfaceLightSet | undefined;
  readonly material: Material;
  readonly model: Mat4;
  /** Retained composed glTF model identity; omitted for direct geometry. */
  readonly modelIdentity?: Mat4;
  /** Retained glTF normal transform; direct geometry computes into its draw workspace. */
  readonly normalTransform?: Mat4;
  readonly projection: Mat4;
  readonly stableLightUniformRevision?: number;
  readonly toneMapping: SurfaceToneMappingState;
  readonly transmissionScreenColorTexture: ScreenColorTextureResource | undefined;
  readonly view: Mat4;
  readonly viewportSize: ViewportSize;
}

type MutableSurfaceSingleExecution = {
  -readonly [Key in keyof SurfaceSingleExecution]: SurfaceSingleExecution[Key];
};

type StableLightBinding = {
  brdfLutTextureUnit: number | undefined;
  revision: number;
  specularTextureUnit: number | undefined;
};
type StableMaterialBinding = {
  material: SurfaceMaterial;
  preparedVirtual: boolean;
};

export interface SurfaceGltfBatchExecution {
  readonly baseColorResidency: BaseColorTextureResidency;
  readonly batch: GltfFrameDrawBatch;
  readonly contextGeneration: number;
  readonly counters: SurfaceExecutionCounters;
  readonly frame: number;
  readonly projection: Mat4;
  readonly toneMapping: SurfaceToneMappingState;
  readonly transmissionScreenColorTexture: ScreenColorTextureResource | undefined;
  readonly view: Mat4;
  readonly viewportSize: ViewportSize;
}

export interface SurfaceExecutionArenaOptions {
  readonly bindIbl: (
    bindings: WebGlTextureBindingShell,
    program: WebGLProgram,
    lightSet: SurfaceLightSet,
    specularTextureUnit: number | undefined,
    brdfLutTextureUnit: number | undefined,
    bindUniforms: boolean,
  ) => void;
  readonly bindVirtualTexture: (
    bindings: WebGlTextureBindingShell,
    key: string,
    atlasTextureUnit: number,
    pageTableTextureUnit: number,
  ) => VirtualTextureGpuBinding | undefined;
  readonly clusteredLights: ClusteredLightingFeature;
  readonly geometry: GeometryDrawArena;
  readonly gl: WebGL2RenderingContext;
  readonly gltfFrames: GltfFrameBatchArena;
  readonly consumeIblSignals: () => SurfaceExecutionSignals;
  readonly ordinaryTextures: OrdinaryTextureResidencyController;
  readonly programs: ProgramArena;
  readonly prepareIblBrdfLut: () => boolean;
  readonly renderTargets: SurfaceRenderTargetArena;
  readonly textureResidencyIntent: FrameTextureResidencyIntent;
  readonly virtualTextureDrawable: (key: string) => boolean;
}

/** Owns concrete WebGL surface planning, binding, state, and submission. */
export class SurfaceExecutionArena {
  readonly #bindIbl: SurfaceExecutionArenaOptions["bindIbl"];
  readonly #clusteredLights: ClusteredLightingFeature;
  readonly #bindVirtualTextureGpu: SurfaceExecutionArenaOptions["bindVirtualTexture"];
  readonly #diagnostics: SurfaceExecutionDiagnostic[] = [];
  readonly #geometry: GeometryDrawArena;
  readonly #gl: WebGL2RenderingContext;
  readonly #gltfFrames: GltfFrameBatchArena;
  readonly #consumeIblSignals: SurfaceExecutionArenaOptions["consumeIblSignals"];
  #blendEnabled = false;
  #cullEnabled = false;
  #depthWriteEnabled = true;
  #frontFaceCcw: boolean | undefined;
  #maxTextureImageUnits = 0;
  readonly #ordinaryTextures: OrdinaryTextureResidencyController;
  readonly #programs: ProgramArena;
  readonly #publicationGroups: SurfaceMaterialPublication[] = [];
  #publicationEpoch = 0;
  readonly #programViewRevisions = new WeakMap<WebGLProgram, number>();
  readonly #stableLightBindings = new WeakMap<WebGLProgram, StableLightBinding>();
  readonly #prepareIblBrdfLut: SurfaceExecutionArenaOptions["prepareIblBrdfLut"];
  readonly #renderTargets: SurfaceRenderTargetArena;
  #singleGltfExecution: MutableSurfaceSingleExecution | undefined;
  readonly #singleNormalTransform = identityMat4();
  readonly #cameraWorldPosition: MutableVec3 = [0, 0, 0];
  readonly #materialTextureCatalogs = new WeakMap<SurfaceMaterial, SurfaceMaterialTextureCatalog>();
  readonly #programGltfModels = new WeakMap<WebGLProgram, { frame: number; model: Mat4 }>();
  readonly #programMaterials = new WeakMap<WebGLProgram, StableMaterialBinding>();
  readonly #reservedTextureUnits = new Set<number>();
  readonly #textureAdmissionInput: MutableTextureBindingPlanInput = {
    baseColor: BASE_COLOR_INPUT_NONE,
    brdfLutPreferredUnit: IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT,
    candidates: {},
    maxTextureUnits: 0,
    reservedTextureUnits: this.#reservedTextureUnits,
  };
  readonly #textureReadinessInput: MutableTextureReadiness = {
    baseColor: BASE_COLOR_INPUT_NONE,
    candidates: {},
  };
  readonly #signals: {
    diagnostics: readonly SurfaceExecutionDiagnostic[];
    wakeRequested: boolean;
  } = { diagnostics: EMPTY_SURFACE_DIAGNOSTICS, wakeRequested: false };
  readonly #textureResidencyIntent: FrameTextureResidencyIntent;
  #textureUnitRevision = 0;
  readonly #textureBindings: WebGlTextureBindingShell;
  readonly #virtualTextureDrawable: SurfaceExecutionArenaOptions["virtualTextureDrawable"];
  #viewRevision = 0;
  #wakeRequested = false;

  constructor(options: SurfaceExecutionArenaOptions) {
    this.#bindIbl = options.bindIbl;
    this.#bindVirtualTextureGpu = options.bindVirtualTexture;
    this.#clusteredLights = options.clusteredLights;
    this.#geometry = options.geometry;
    this.#gl = options.gl;
    this.#gltfFrames = options.gltfFrames;
    this.#consumeIblSignals = options.consumeIblSignals;
    this.#ordinaryTextures = options.ordinaryTextures;
    this.#programs = options.programs;
    this.#prepareIblBrdfLut = options.prepareIblBrdfLut;
    this.#renderTargets = options.renderTargets;
    this.#textureResidencyIntent = options.textureResidencyIntent;
    this.#textureBindings = new WebGlTextureBindingShell(options.gl);
    this.#virtualTextureDrawable = options.virtualTextureDrawable;
  }

  configureTextureUnits(maxTextureImageUnits: number): void {
    this.#maxTextureImageUnits = Number.isFinite(maxTextureImageUnits) ? maxTextureImageUnits : 0;
    // Context restoration re-enters through this boundary even when the
    // numeric capability is unchanged. Invalidate plans that refer to lost
    // ordinary/IBL/cluster texture resources without walking the WeakMap.
    this.#textureUnitRevision += 1;
  }

  /** Synchronizes the state cache with Royal's frame baseline. */
  beginFrame(): void {
    this.#publicationEpoch += 1;
    this.#blendEnabled = false;
    this.#cullEnabled = false;
    this.#depthWriteEnabled = true;
    this.#frontFaceCcw = undefined;
    this.#publicationGroups.length = 0;
    this.#textureBindings.invalidate();
    this.#viewRevision += 1;
  }

  /** Advances camera-invariant state when a frame renders another view. */
  beginView(): void {
    this.#viewRevision += 1;
  }

  /** Invalidates retained bindings after a raw pass owned outside this shell. */
  invalidateTextureBindings(): void {
    this.#textureBindings.invalidate();
  }

  /** Leaves state required by passes that follow surface drawing. */
  finishPass(): void {
    this.#setBlend(false);
    this.#setCull(false);
    this.#setDepthWrite(true);
    if (this.#frontFaceCcw !== undefined) this.#setFrontFace(true);
  }

  copyTransmissionScreenColor(
    width: number,
    height: number,
    sourceX: number,
    sourceY: number,
    hdr: boolean,
  ): ScreenColorTextureResource {
    try {
      return copyTransmissionScreenColorTexture(
        this.#renderTargets,
        this.#gl,
        width,
        height,
        sourceX,
        sourceY,
        hdr,
      );
    } finally {
      this.#textureBindings.invalidate();
    }
  }

  executeSingle(input: SurfaceSingleExecution): void {
    this.#executeSingle(input, true);
  }

  #executeSingle(input: SurfaceSingleExecution, manageState: boolean): void {
    if (manageState) this.#beginDirectDraw(input.material);
    {
      const materialProgramKind: ProgramKind = input.material.kind === "wireframe"
        ? "wireframe"
        : input.material.kind === "standard" ? "surface" : "unlit";
      const surfaceMaterial = input.material.kind !== "wireframe" ? input.material : undefined;
      const surfaceLights = surfaceMaterial?.kind === "standard"
        ? input.lights ?? EMPTY_SURFACE_LIGHT_SET
        : surfaceMaterial === undefined ? undefined : EMPTY_SURFACE_LIGHT_SET;
      if (
        surfaceLights !== undefined
        && !this.#clusteredLights.prepare(surfaceLights.punctuals)
      ) return;
      const plan = surfaceMaterial === undefined || surfaceLights === undefined
        ? undefined
        : this.#textureBindingPlan(
            surfaceMaterial,
            input.transmissionScreenColorTexture,
            surfaceLights,
            input.baseColorResidency,
          );
      const loading =
        surfaceMaterial !== undefined
        && plan !== undefined
        && this.#materialLoading(
          surfaceMaterial,
          plan.criticalPending,
        );
      const program = this.#program(
        input.frame,
        loading ? "unlit" : materialProgramKind,
        loading ? EMPTY_SURFACE_TEXTURE_FEATURES : plan?.features,
        !loading && (surfaceLights?.punctuals.length ?? 0) > 0,
        !loading && (plan?.extendedMaterial ?? false),
        !loading
          && surfaceMaterial !== undefined
          && surfaceMaterialAlphaMode(surfaceMaterial) === "MASK",
        loading ? 0 : plan?.featureMask,
      );
      if (program === undefined) return;
      useProgram(this.#programs, program);
      this.#bindViewUniforms(
        program,
        input.projection,
        input.view,
        input.toneMapping,
        !loading && surfaceMaterial?.kind === "standard",
      );
      const modelBinding = this.#bindModelMatrix(program, input);
      if (!loading && surfaceMaterial?.kind === "standard") {
        if (modelBinding !== undefined) {
          const normalTransform = input.normalTransform
            ?? affineSurfaceNormalTransformInto(this.#singleNormalTransform, input.model);
          if (modelBinding) {
            uniformMatrixUncached(
              this.#programs,
              program,
              "u_modelNormalTransform",
              normalTransform,
            );
          } else {
            uniformMatrix(
              this.#programs,
              program,
              "u_modelNormalTransform",
              normalTransform,
            );
          }
        }
      }
      if (loading) {
        this.#bindLoadingSurface(program);
      } else if (plan !== undefined && surfaceLights !== undefined && surfaceMaterial !== undefined) {
        this.#bindStableMaterialUniforms(
          program,
          surfaceMaterial,
          plan,
          plan.baseColor.kind === "prepared-virtual",
        );
        if (surfaceMaterial.kind === "standard") {
          this.#bindMaterialResources(program, input.transmissionScreenColorTexture, plan);
          this.#bindLights(
            program,
            surfaceLights,
            plan,
            input.projection,
            input.view,
            input.viewportSize,
            input.frame,
            input.stableLightUniformRevision ?? 0,
          );
        }
        this.#bindBaseColorTexture(program, plan);
      } else this.#bindMaterialColor(program, input.material, false);
      drawGeometry(
        this.#geometry,
        input.contextGeneration,
        input.geometry,
      );
    }
  }

  executeGltfBatch(input: SurfaceGltfBatchExecution): void {
    const { batch } = input;
    this.#beginGltfDraw(batch.material, batch.sidedness);
    {
      if (batch.localModels.length === 1) {
        const singleModel = batch.singleModel;
        if (singleModel === undefined) {
          throw new Error("Royal single-instance glTF batch has no retained model");
        }
        let execution = this.#singleGltfExecution;
        if (execution === undefined) {
          execution = {
            baseColorResidency: input.baseColorResidency,
            contextGeneration: input.contextGeneration,
            frame: input.frame,
            geometry: batch.geometry,
            lights: batch.lights,
            material: batch.material,
            model: singleModel.model,
            modelIdentity: singleModel.model,
            normalTransform: singleModel.normalTransform,
            projection: input.projection,
            stableLightUniformRevision: batch.sceneLightPlanRevision,
            toneMapping: input.toneMapping,
            transmissionScreenColorTexture: input.transmissionScreenColorTexture,
            view: input.view,
            viewportSize: input.viewportSize,
          };
          this.#singleGltfExecution = execution;
        } else {
          execution.baseColorResidency = input.baseColorResidency;
          execution.contextGeneration = input.contextGeneration;
          execution.frame = input.frame;
          execution.geometry = batch.geometry;
          execution.lights = batch.lights;
          execution.material = batch.material;
          execution.model = singleModel.model;
          execution.modelIdentity = singleModel.model;
          execution.normalTransform = singleModel.normalTransform;
          execution.projection = input.projection;
          execution.stableLightUniformRevision = batch.sceneLightPlanRevision;
          execution.toneMapping = input.toneMapping;
          execution.transmissionScreenColorTexture = input.transmissionScreenColorTexture;
          execution.view = input.view;
          execution.viewportSize = input.viewportSize;
        }
        this.#executeSingle(execution, false);
        return;
      }
      const surfaceLights = batch.material.kind === "standard" ? batch.lights : EMPTY_SURFACE_LIGHT_SET;
      if (!this.#clusteredLights.prepare(surfaceLights.punctuals)) return;
      const plan = this.#textureBindingPlan(
        batch.material,
        input.transmissionScreenColorTexture,
        surfaceLights,
        input.baseColorResidency,
      );
      const loading = this.#materialLoading(
        batch.material,
        plan.criticalPending,
      );
      const program = this.#program(
        input.frame,
        loading
          ? "unlit-instanced-split"
          : batch.material.kind === "standard" ? "surface-instanced-split" : "unlit-instanced-split",
        loading ? EMPTY_SURFACE_TEXTURE_FEATURES : plan.features,
        !loading && surfaceLights.punctuals.length > 0,
        !loading && plan.extendedMaterial,
        !loading && surfaceMaterialAlphaMode(batch.material) === "MASK",
        loading ? 0 : plan.featureMask,
      );
      if (program === undefined) return;
      useProgram(this.#programs, program);
      this.#bindViewUniforms(
        program,
        input.projection,
        input.view,
        input.toneMapping,
        !loading && batch.material.kind === "standard",
      );
      if (loading) {
        this.#bindLoadingSurface(program);
      } else {
        this.#bindStableMaterialUniforms(
          program,
          batch.material,
          plan,
          plan.baseColor.kind === "prepared-virtual",
        );
        if (batch.material.kind === "standard") {
          this.#bindMaterialResources(program, input.transmissionScreenColorTexture, plan);
          this.#bindLights(
            program,
            surfaceLights,
            plan,
            input.projection,
            input.view,
            input.viewportSize,
            input.frame,
            batch.sceneLightPlanRevision,
          );
        }
        this.#bindBaseColorTexture(program, plan);
      }
      const allocation = this.#gltfFrames.bindInstanceBuffer(
        this.#gl,
        input.contextGeneration,
        batch,
        input.counters,
      );
      prepareGeometryInstancedDraw(
        this.#geometry,
        input.contextGeneration,
        batch.geometryId,
        batch.geometry,
        allocation,
      );
      input.counters.drawCalls += 1;
      input.counters.instancesDrawn += batch.localModels.length;
      submitGeometryInstancedDraw(this.#geometry, batch.geometry, batch.localModels.length);
    }
  }

  drainSignals(): SurfaceExecutionSignals {
    for (let index = 0; index < this.#publicationGroups.length; index += 1) {
      const publication = this.#publicationGroups[index]!;
      if (publication.ready || publication.pendingEpoch === this.#publicationEpoch) continue;
      publication.ready = true;
      this.#wakeRequested = true;
    }
    this.#captureIblSignals();
    this.#signals.diagnostics = this.#diagnostics.length === 0
      ? EMPTY_SURFACE_DIAGNOSTICS
      : this.#diagnostics.slice();
    this.#diagnostics.length = 0;
    this.#signals.wakeRequested = this.#wakeRequested || consumeProgramArenaWake(this.#programs);
    this.#wakeRequested = false;
    return this.#signals;
  }

  #program(
    frame: number,
    kind: ProgramKind,
    features: PureSurfaceTextureBindingPlan["features"] | undefined,
    clusteredLights: boolean,
    extendedMaterial: boolean,
    alphaMask: boolean,
    featureMask?: number,
  ): WebGLProgram | undefined {
    const resource = requestProgram(
      this.#programs,
      frame,
      kind,
      features,
      clusteredLights,
      extendedMaterial,
      alphaMask,
      featureMask,
    );
    return resource?.program;
  }

  #bindViewUniforms(
    program: WebGLProgram,
    projection: Mat4,
    view: Mat4,
    toneMapping: SurfaceToneMappingState,
    bindCameraPosition: boolean,
  ): void {
    if (this.#programViewRevisions.get(program) === this.#viewRevision) return;
    uniformMatrix(this.#programs, program, "u_projection", projection);
    uniformMatrix(this.#programs, program, "u_view", view);
    this.#bindToneMapping(program, toneMapping);
    if (bindCameraPosition) this.#bindCameraWorldPosition(program, view);
    this.#programViewRevisions.set(program, this.#viewRevision);
  }

  /** Returns undefined for reuse, false for compared, and true for proven changed. */
  #bindModelMatrix(program: WebGLProgram, input: SurfaceSingleExecution): boolean | undefined {
    const modelIdentity = input.modelIdentity;
    if (modelIdentity === undefined) {
      // A direct draw can share a shader program with glTF and therefore
      // invalidates any semantic proof retained for that program.
      this.#programGltfModels.delete(program);
      uniformMatrix(this.#programs, program, "u_model", input.model);
      return false;
    }

    const retained = this.#programGltfModels.get(program);
    if (retained?.frame === input.frame && retained.model === modelIdentity) {
      return undefined;
    }

    if (retained?.frame === input.frame) {
      uniformMatrixUncached(this.#programs, program, "u_model", input.model);
      retained.model = modelIdentity;
      return true;
    }

    uniformMatrix(this.#programs, program, "u_model", input.model);
    if (retained === undefined) {
      this.#programGltfModels.set(program, { frame: input.frame, model: modelIdentity });
    } else {
      retained.frame = input.frame;
      retained.model = modelIdentity;
    }
    return false;
  }

  #textureBindingPlan(
    material: SurfaceMaterial,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    lightSet: SurfaceLightSet,
    baseColorResidency: BaseColorTextureResidency,
  ): SurfaceTextureBindingPlan {
    const reusableResidency = baseColorResidency.kind !== "prepared-virtual";
    const ibl = lightSet.specular !== undefined;
    const punctual = lightSet.punctuals.length > 0;
    const transmissionUploaded = transmissionScreenColorTexture?.uploaded === true;
    const textureCatalog = this.#materialTextureCatalog(material);
    const runtime = textureCatalog.runtime;
    if (
      reusableResidency
      && runtime.residencyComplete
      && runtime.lastResidencyKind === baseColorResidency.kind
      && runtime.lastTextureUnitRevision === this.#textureUnitRevision
      && runtime.lastOrdinaryTexture === (
        baseColorResidency.kind === "ordinary" ? baseColorResidency.texture : undefined
      )
      && runtime.lastTransmission === transmissionScreenColorTexture
      && runtime.lastTransmissionUploaded === transmissionUploaded
      && runtime.lastIbl === ibl
      && runtime.lastPunctual === punctual
      && this.#retainCachedOrdinaryResidency(runtime)
    ) {
      this.#recordTextureBindingOmissions(runtime.plan);
      return runtime.plan;
    }
    const candidates = textureCatalog.candidates;
    const entries = textureCatalog.entries;
    const readyTextures = runtime.readyTextures;
    readyTextures.clear();
    for (let index = 0; index < entries.length; index += 1) {
      candidates[entries[index]!.descriptor.feature] = "ready";
    }
    if (
      transmissionScreenColorTexture === undefined
      || !textureCatalog.transmission
    ) delete candidates.transmissionScreenTexture;
    else candidates.transmissionScreenTexture = "ready";
    if (lightSet.specular !== undefined) {
      candidates.iblSpecularCube = "ready";
      candidates.iblBrdfLut = "ready";
    } else {
      delete candidates.iblSpecularCube;
      delete candidates.iblBrdfLut;
    }
    const declaredBaseColor = baseColorResidency.kind === "none"
      ? BASE_COLOR_INPUT_NONE
      : baseColorResidency.kind === "ordinary"
        ? BASE_COLOR_INPUT_ORDINARY_READY
        : baseColorResidency.ordinaryFallback === undefined
          ? BASE_COLOR_INPUT_VIRTUAL_READY
          : BASE_COLOR_INPUT_VIRTUAL_READY_FALLBACK;
    const clusterUnits = this.#clusteredLights.textureUnits();
    const reserveClusterUnits = lightSet.punctuals.length > 0;
    const reservedTextureUnits = this.#reservedTextureUnits;
    reservedTextureUnits.clear();
    if (reserveClusterUnits) {
      if (clusterUnits.grid >= 0) reservedTextureUnits.add(clusterUnits.grid);
      if (clusterUnits.indices >= 0) reservedTextureUnits.add(clusterUnits.indices);
      if (clusterUnits.lights >= 0) reservedTextureUnits.add(clusterUnits.lights);
    }
    const admissionInput = this.#textureAdmissionInput;
    admissionInput.baseColor = declaredBaseColor;
    admissionInput.brdfLutPreferredUnit = reserveClusterUnits && clusterUnits.grid > 0
      ? clusterUnits.grid - 1
      : IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT;
    admissionInput.candidates = candidates;
    admissionInput.maxTextureUnits = this.#maxTextureImageUnits;
    const admission = this.#textureAdmission(
      textureCatalog,
      declaredBaseColor,
      reserveClusterUnits,
      clusterUnits,
    );
    let admittedResourcesReady = true;
    let criticalPending = material.basePending === true;
    // Queue the authored base color before secondary maps. GPU residency uses
    // request order, so this preserves the planner's semantic priority and
    // avoids presenting normal/roughness variants over a factor-only surface.
    let ordinaryBaseColor: ReadyOrdinaryTexture | undefined;
    if (baseColorResidency.kind === "ordinary" && admission.baseColor.kind === "ordinary") {
      const resource = this.#requestOrdinaryTexture(baseColorResidency.texture);
      ordinaryBaseColor = resource.uploaded ? resource : undefined;
      const baseColorPending = this.#ordinaryTextureIsLoading(baseColorResidency.texture, resource);
      criticalPending ||= baseColorPending;
      if (ordinaryBaseColor === undefined) admittedResourcesReady = false;
    }
    for (let index = 0; index < entries.length; index += 1) {
      const { descriptor, texture } = entries[index]!;
      if (!admission.features.has(descriptor.feature)) continue;
      const resource = this.#requestOrdinaryTexture(texture);
      const ready = resource.uploaded ? resource : undefined;
      candidates[descriptor.feature] = ready === undefined ? "unavailable" : "ready";
      if (ready !== undefined) readyTextures.set(descriptor.feature, ready);
      else admittedResourcesReady = false;
    }
    let virtualFallbackTexture: TextureAssetUploadRef | undefined;
    let virtualFallbackReady: ReadyOrdinaryTexture | undefined;
    let baseColor: SurfaceBaseColorPlanInput;
    switch (baseColorResidency.kind) {
      case "none":
        baseColor = BASE_COLOR_INPUT_NONE;
        break;
      case "ordinary": {
        baseColor = ordinaryBaseColor === undefined
          ? BASE_COLOR_INPUT_ORDINARY_UNAVAILABLE
          : BASE_COLOR_INPUT_ORDINARY_READY;
        break;
      }
      case "prepared-virtual": {
        const drawable = this.#isVirtualTextureDrawable(baseColorResidency.state);
        if (!drawable) {
          if (baseColorResidency.state.status === "unsupported") baseColorResidency.state.stats.unsupportedDraws += 1;
          else baseColorResidency.state.stats.unreadyDraws += 1;
        }
        virtualFallbackTexture = baseColorResidency.ordinaryFallback;
        let fallbackResource = virtualFallbackTexture === undefined
          ? undefined
          : this.#ordinaryTextures.peekGpuResource(textureCacheKey(virtualFallbackTexture));
        if (
          virtualFallbackTexture !== undefined
          && admission.baseColor.kind !== "none"
          && (admission.baseColor.kind === "ordinary" || !drawable)
        ) fallbackResource = this.#requestOrdinaryTexture(virtualFallbackTexture);
        if (
          !drawable
          && virtualFallbackTexture !== undefined
          && fallbackResource !== undefined
        ) {
          const fallbackPending = this.#ordinaryTextureIsLoading(
            virtualFallbackTexture,
            fallbackResource,
          );
          criticalPending ||= fallbackPending;
        }
        virtualFallbackReady = fallbackResource?.uploaded === true ? fallbackResource : undefined;
        const virtualReady = admission.baseColor.kind === "virtual" && drawable;
        const fallbackAdmitted = virtualFallbackTexture !== undefined && admission.baseColor.kind !== "none";
        baseColor = virtualReady
          ? fallbackAdmitted && virtualFallbackReady !== undefined
            ? BASE_COLOR_INPUT_VIRTUAL_READY_FALLBACK
            : fallbackAdmitted
              ? BASE_COLOR_INPUT_VIRTUAL_READY_FALLBACK_UNAVAILABLE
              : BASE_COLOR_INPUT_VIRTUAL_READY
          : !fallbackAdmitted
            ? BASE_COLOR_INPUT_VIRTUAL_UNAVAILABLE
            : virtualFallbackReady === undefined
              ? BASE_COLOR_INPUT_VIRTUAL_UNAVAILABLE_FALLBACK_UNAVAILABLE
              : BASE_COLOR_INPUT_VIRTUAL_UNAVAILABLE_FALLBACK_READY;
        break;
      }
    }
    if (transmissionScreenColorTexture !== undefined && textureCatalog.transmission) {
      candidates.transmissionScreenTexture = transmissionScreenColorTexture.uploaded ? "ready" : "unavailable";
      if (!transmissionScreenColorTexture.uploaded) admittedResourcesReady = false;
    }
    if (lightSet.specular !== undefined) {
      candidates.iblSpecularCube = "ready";
      if (admission.features.has("iblBrdfLut")) {
        let ready = false;
        try {
          ready = this.#prepareIblBrdfLut();
        } finally {
          this.#captureIblSignals();
        }
        candidates.iblBrdfLut = ready ? "ready" : "unavailable";
        if (!ready) admittedResourcesReady = false;
      }
    }
    const readinessInput = this.#textureReadinessInput;
    readinessInput.baseColor = baseColor;
    readinessInput.candidates = candidates;
    // Admission already is the exact resolved plan when every admitted source
    // is resident. Avoid rebuilding the same Maps/Sets for every steady draw.
    const pure = admittedResourcesReady && baseColor === declaredBaseColor
      ? admission
      : resolveAdmittedSurfaceTextureBindings(admission, readinessInput, runtime.readinessWorkspace);
    this.#recordTextureBindingOmissions(pure);
    let selectedBaseColor: SurfaceBaseColorTextureBinding = NO_BASE_COLOR_TEXTURE_BINDING;
    if (pure.baseColor.kind === "ordinary") {
      const resource = ordinaryBaseColor ?? virtualFallbackReady;
      if (resource !== undefined) {
        let binding = runtime.ordinaryBaseColorBinding;
        if (binding === undefined) {
          binding = { kind: "ordinary", resource };
          runtime.ordinaryBaseColorBinding = binding;
        } else binding.resource = resource;
        selectedBaseColor = binding;
      }
    } else if (pure.baseColor.kind === "virtual" && baseColorResidency.kind === "prepared-virtual") {
      let binding = runtime.virtualBaseColorBinding;
      if (binding === undefined) {
        binding = { kind: "prepared-virtual", state: baseColorResidency.state };
        runtime.virtualBaseColorBinding = binding;
      } else binding.state = baseColorResidency.state;
      if (virtualFallbackTexture === undefined) delete binding.ordinaryFallback;
      else binding.ordinaryFallback = virtualFallbackTexture;
      selectedBaseColor = binding;
    }
    runtime.plan.baseColor = selectedBaseColor;
    runtime.plan.criticalPending = criticalPending;
    runtime.plan.extendedMaterial = textureCatalog.extendedMaterial;
    runtime.plan.featureMask = pure.featureMask;
    runtime.plan.features = pure.features;
    runtime.plan.materialTextures = entries;
    runtime.plan.omissions = pure.omissions;
    runtime.plan.textureUnits = pure.textureUnits;
    runtime.residencyComplete = reusableResidency && admittedResourcesReady && !criticalPending;
    if (reusableResidency) {
      runtime.lastResidencyKind = baseColorResidency.kind;
      runtime.lastTextureUnitRevision = this.#textureUnitRevision;
      runtime.lastOrdinaryTexture = baseColorResidency.kind === "ordinary"
        ? baseColorResidency.texture
        : undefined;
      runtime.lastTransmission = transmissionScreenColorTexture;
      runtime.lastTransmissionUploaded = transmissionUploaded;
      runtime.lastIbl = ibl;
      runtime.lastPunctual = punctual;
      // Every ordinary request above records this plan's exact current-frame
      // intent. Repeated draws of the same material need neither repeat those
      // Set writes nor re-prove resources that cannot mutate during surface
      // execution.
      runtime.lastIntentEpoch = this.#publicationEpoch;
    }
    return runtime.plan;
  }

  /** Reasserts frame intent while proving a complete retained plan is still live. */
  #retainCachedOrdinaryResidency(runtime: SurfaceMaterialTextureRuntime): boolean {
    if (runtime.lastIntentEpoch === this.#publicationEpoch) return true;
    const plan = runtime.plan;
    if (plan.baseColor.kind === "ordinary") {
      const resource = plan.baseColor.resource;
      if (this.#ordinaryTextures.peekGpuResource(resource.key) !== resource || !resource.uploaded) return false;
      this.#textureResidencyIntent.requireOrdinary(resource.key);
    }
    for (const resource of plan.readyTextures.values()) {
      if (this.#ordinaryTextures.peekGpuResource(resource.key) !== resource || !resource.uploaded) return false;
      this.#textureResidencyIntent.requireOrdinary(resource.key);
    }
    runtime.lastIntentEpoch = this.#publicationEpoch;
    return true;
  }

  #materialLoading(
    material: SurfaceMaterial,
    criticalPending: boolean,
  ): boolean {
    const publication = material.publication;
    if (publication === undefined) return criticalPending;
    // Publication is monotonic. A later critical-texture loss temporarily
    // returns this material to gray, but does not reopen its initial group
    // barrier. Avoid retaining and draining every settled material each frame.
    if (publication.ready) return criticalPending;
    if (criticalPending) publication.pendingEpoch = this.#publicationEpoch;
    if (publication.executionEpoch !== this.#publicationEpoch) {
      publication.executionEpoch = this.#publicationEpoch;
      this.#publicationGroups.push(publication);
    }
    // Secondary maps refine an already useful asset progressively. Loss or a
    // new demand for the base/alpha-critical texture returns only that material
    // to gray until the critical dependency is resident again.
    return !publication.ready || criticalPending;
  }

  #textureAdmission(
    catalog: SurfaceMaterialTextureCatalog,
    baseColor: SurfaceBaseColorPlanInput,
    punctual: boolean,
    clusterUnits: Readonly<{ grid: number; indices: number; lights: number }>,
  ): PureSurfaceTextureBindingPlan {
    const input = this.#textureAdmissionInput;
    const ibl = input.candidates.iblSpecularCube === "ready";
    const transmission = input.candidates.transmissionScreenTexture === "ready";
    const grid = punctual ? clusterUnits.grid : -1;
    const indices = punctual ? clusterUnits.indices : -1;
    const lights = punctual ? clusterUnits.lights : -1;
    for (let index = 0; index < catalog.admissions.length; index += 1) {
      const cached = catalog.admissions[index]!;
      if (
        cached.baseColor === baseColor
        && cached.brdfLutPreferredUnit === input.brdfLutPreferredUnit
        && cached.clusterGridUnit === grid
        && cached.clusterIndicesUnit === indices
        && cached.clusterLightsUnit === lights
        && cached.ibl === ibl
        && cached.maxTextureUnits === input.maxTextureUnits
        && cached.punctual === punctual
        && cached.transmission === transmission
      ) return cached.plan;
    }
    // A dedicated planner workspace makes the result immutable for the
    // material-lifetime cache; draw-time readiness never mutates admission.
    const plan = planSurfaceTextureBindings(input);
    catalog.admissions.push({
      baseColor,
      brdfLutPreferredUnit: input.brdfLutPreferredUnit,
      clusterGridUnit: grid,
      clusterIndicesUnit: indices,
      clusterLightsUnit: lights,
      ibl,
      maxTextureUnits: input.maxTextureUnits,
      plan,
      punctual,
      transmission,
    });
    return plan;
  }

  #bindLoadingSurface(program: WebGLProgram): void {
    // The loading shader can alias an untextured unlit material program while
    // writing a different alpha policy, so it invalidates that program's
    // material identity proof before publication resumes.
    this.#programMaterials.delete(program);
    uniform4f(
      this.#programs,
      program,
      "u_color",
      LOADING_SURFACE_COLOR[0],
      LOADING_SURFACE_COLOR[1],
      LOADING_SURFACE_COLOR[2],
      LOADING_SURFACE_COLOR[3],
    );
    uniform4f(this.#programs, program, "u_alphaSettings", 0, 0.5, 0, 0);
  }

  #materialTextureCatalog(material: SurfaceMaterial): SurfaceMaterialTextureCatalog {
    let catalog = this.#materialTextureCatalogs.get(material);
    if (catalog !== undefined) return catalog;
    catalog = createSurfaceMaterialTextureCatalog(material);
    this.#materialTextureCatalogs.set(material, catalog);
    return catalog;
  }

  #bindStableMaterialUniforms(
    program: WebGLProgram,
    material: SurfaceMaterial,
    plan: SurfaceTextureBindingPlan,
    preparedVirtual: boolean,
  ): void {
    const stable = this.#programMaterials.get(program);
    if (stable?.material === material && stable.preparedVirtual === preparedVirtual) return;
    this.#bindMaterialColor(program, material, preparedVirtual);
    const factors = surfaceMaterialExtensionFactors(material);
    const { extendedMaterial } = plan;
    this.#bindAlphaSettings(program, material);
    if (material.kind === "standard") {
      this.#bindEmissiveColor(program, material);
      uniform4f(this.#programs, program, "u_materialPbrFactors",
        surfaceMaterialMetallicFactor(material), surfaceMaterialRoughnessFactor(material), 0, 0);
      if (extendedMaterial) {
        const hasFiniteAttenuationDistance = Number.isFinite(factors.attenuationDistance);
        uniform4f(this.#programs, program, "u_specularColorFactor",
          factors.specularColorFactor[0], factors.specularColorFactor[1], factors.specularColorFactor[2], 1);
        uniform4f(this.#programs, program, "u_materialExtensionFactors",
          factors.specularFactor, factors.ior, factors.clearcoatFactor, factors.clearcoatRoughnessFactor);
        uniform4f(this.#programs, program, "u_anisotropyFactors",
          factors.anisotropyStrength, factors.anisotropyRotation, 0, 0);
        uniform4f(this.#programs, program, "u_diffuseTransmissionFactors",
          factors.diffuseTransmissionColorFactor[0], factors.diffuseTransmissionColorFactor[1],
          factors.diffuseTransmissionColorFactor[2], factors.diffuseTransmissionFactor);
        uniform4f(this.#programs, program, "u_sheenColorFactor",
          factors.sheenColorFactor[0], factors.sheenColorFactor[1], factors.sheenColorFactor[2],
          factors.sheenRoughnessFactor);
        uniform4f(this.#programs, program, "u_iridescenceFactors",
          factors.iridescenceFactor, factors.iridescenceIor,
          factors.iridescenceThicknessMinimum, factors.iridescenceThicknessMaximum);
        uniform4f(this.#programs, program, "u_dispersionFactors", factors.dispersionFactor, 0, 0, 0);
        uniform4f(this.#programs, program, "u_attenuationColorFactor",
          factors.attenuationColor[0], factors.attenuationColor[1], factors.attenuationColor[2], 1);
        uniform4f(this.#programs, program, "u_transmissionVolumeFactors",
          factors.transmissionFactor, factors.thicknessFactor,
          hasFiniteAttenuationDistance ? factors.attenuationDistance : 0,
          hasFiniteAttenuationDistance ? 1 : 0);
      }
    }
    this.#bindTextureCoordinates(program, material, plan);
    if (material.kind === "standard") {
      uniform4f(this.#programs, program, "u_normalTextureSettings",
        material.normalScale ?? 1, factors.clearcoatNormalScale, 0, 0);
      uniform4f(this.#programs, program, "u_occlusionSettings",
        surfaceMaterialOcclusionStrength(material), 0, 0, 0);
    }
    if (stable === undefined) {
      this.#programMaterials.set(program, { material, preparedVirtual });
    } else {
      stable.material = material;
      stable.preparedVirtual = preparedVirtual;
    }
  }

  #bindMaterialResources(
    program: WebGLProgram,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    plan: SurfaceTextureBindingPlan,
  ): void {
    if (plan.extendedMaterial) {
      this.#bindTransmissionScreenColorTexture(program, transmissionScreenColorTexture, plan);
    }
    for (let index = 0; index < plan.materialTextures.length; index += 1) {
      const entry = plan.materialTextures[index]!;
      this.#bindCachedTexture2d(program, entry.descriptor, plan);
    }
  }

  #bindMaterialColor(
    program: WebGLProgram,
    material: Material,
    preparedVirtual: boolean,
  ): void {
    const factor = "baseColorFactor" in material && Array.isArray(material.baseColorFactor)
      ? material.baseColorFactor
      : undefined;
    if (factor !== undefined) {
      const base = material.baseColor.kind === "solid" ? material.baseColor.color : TEXTURE_COLOR;
      uniform4f(
        this.#programs,
        program,
        "u_color",
        (factor[0] ?? 1) * (base[0] ?? 1),
        (factor[1] ?? 1) * (base[1] ?? 1),
        (factor[2] ?? 1) * (base[2] ?? 1),
        (factor[3] ?? 1) * (base[3] ?? 1),
      );
      return;
    }
    if (material.baseColor.kind === "solid") {
      const color = material.baseColor.color;
      uniform4f(this.#programs, program, "u_color", color[0], color[1], color[2], color[3]);
      return;
    }
    const color = preparedVirtual || material.baseColor.kind === "asset"
      ? TEXTURE_COLOR
      : UNSUPPORTED_VIRTUAL_TEXTURE_COLOR;
    uniform4f(this.#programs, program, "u_color", color[0], color[1], color[2], color[3]);
  }

  #bindEmissiveColor(program: WebGLProgram, material: Material): void {
    const emissive = "emissive" in material && Array.isArray(material.emissive) && material.emissive.length >= 3
      ? material.emissive
      : undefined;
    uniform4f(
      this.#programs,
      program,
      "u_emissiveColor",
      emissive?.[0] ?? 0,
      emissive?.[1] ?? 0,
      emissive?.[2] ?? 0,
      emissive?.[3] ?? 1,
    );
  }

  #bindAlphaSettings(program: WebGLProgram, material: SurfaceMaterial): void {
    const alphaMode = surfaceMaterialAlphaMode(material);
    uniform4f(this.#programs, program, "u_alphaSettings",
      alphaMode === "MASK" ? 1 : alphaMode === "BLEND" ? 2 : 0,
      surfaceMaterialAlphaCutoff(material), 0, 0);
  }

  #bindTextureCoordinates(program: WebGLProgram, material: SurfaceMaterial, plan: SurfaceTextureBindingPlan): void {
    this.#bindTextureCoordinate(
      program,
      material,
      plan,
      "baseColorTexture",
      "baseColorTexture",
      BASE_COLOR_TEXTURE_COORDINATE_UNIFORMS,
      true,
    );
    for (let index = 0; index < plan.materialTextures.length; index += 1) {
      const entry = plan.materialTextures[index]!;
      const descriptor = entry.descriptor;
      this.#bindTextureCoordinate(
        program,
        material,
        plan,
        descriptor.feature,
        descriptor.key,
        entry.uniforms,
        false,
      );
    }
  }

  #bindTextureCoordinate(
    program: WebGLProgram,
    material: SurfaceMaterial,
    plan: SurfaceTextureBindingPlan,
    feature: SurfaceShaderTextureFeature,
    key: keyof SurfaceMaterialTextureCoordinates,
    uniforms: TextureCoordinateUniformNames,
    virtualBaseColor: boolean,
  ): void {
    const active = plan.features.has(feature)
      || (virtualBaseColor && (
        plan.features.has("baseColorVirtualTextureAtlas")
        || plan.features.has("baseColorVirtualTexturePageTable")
      ));
    if (!active) return;
    const preparedCoordinates = material.textureCoordinates?.[key];
    const coordinates = preparedCoordinates ?? IDENTITY_GLTF_TEXTURE_COORDINATES;
    uniform1i(this.#programs, program, uniforms.set, coordinates.set);
    uniformColor(this.#programs, program, uniforms.row0, coordinates.row0);
    uniformColor(this.#programs, program, uniforms.row1, coordinates.row1);
  }

  #bindCachedTexture2d(
    program: WebGLProgram,
    descriptor: (typeof SURFACE_MATERIAL_TEXTURE_BINDINGS)[number],
    plan: SurfaceTextureBindingPlan,
  ): void {
    if (!plan.features.has(descriptor.feature)) return;
    const resource = plan.readyTextures.get(descriptor.feature);
    const allocatedUnit = plan.textureUnits.get(descriptor.feature);
    if (resource === undefined || allocatedUnit === undefined) {
      throw new Error(`Admitted surface texture ${descriptor.feature} has no ready binding`);
    }
    this.#textureBindings.bindTexture2d(allocatedUnit, resource.texture);
    uniform1i(this.#programs, program, descriptor.samplerUniform, allocatedUnit);
  }

  #bindTransmissionScreenColorTexture(
    program: WebGLProgram,
    resource: ScreenColorTextureResource | undefined,
    plan: SurfaceTextureBindingPlan,
  ): void {
    if (!plan.features.has("transmissionScreenTexture")) return;
    const textureUnit = plan.textureUnits.get("transmissionScreenTexture");
    if (resource === undefined || !resource.uploaded || textureUnit === undefined) {
      throw new Error("Admitted transmission screen texture has no ready binding");
    }
    this.#textureBindings.bindTexture2d(textureUnit, resource.texture);
    uniform1i(this.#programs, program, "u_transmissionScreenTexture", textureUnit);
    uniform2f(this.#programs, program, "u_viewportOrigin", resource.originX, resource.originY);
    uniform2f(this.#programs, program, "u_viewportSize", resource.width, resource.height);
  }

  #bindToneMapping(program: WebGLProgram, toneMapping: SurfaceToneMappingState): void {
    uniform4f(this.#programs, program, "u_toneMappingSettings",
      toneMappingShaderMode(toneMapping.toneMapping),
      toneMapping.exposure, toneMapping.hdrOutput ? 1 : 0, 0);
  }

  #bindLights(
    program: WebGLProgram,
    lightSet: SurfaceLightSet,
    plan: SurfaceTextureBindingPlan,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
    frame: number,
    stableUniformRevision: number,
  ): void {
    const specularTextureUnit = plan.textureUnits.get("iblSpecularCube");
    const brdfLutTextureUnit = plan.textureUnits.get("iblBrdfLut");
    const stableBinding = this.#stableLightBindings.get(program);
    const bindStableUniforms = stableUniformRevision === 0
      || stableBinding === undefined
      || stableBinding.revision !== stableUniformRevision
      || stableBinding.specularTextureUnit !== specularTextureUnit
      || stableBinding.brdfLutTextureUnit !== brdfLutTextureUnit;
    try {
      this.#bindIbl(
        this.#textureBindings,
        program,
        lightSet,
        specularTextureUnit,
        brdfLutTextureUnit,
        bindStableUniforms,
      );
    } finally {
      this.#captureIblSignals();
    }
    const lights = lightSet.directionals;
    if (lights.length > MAX_SURFACE_LIGHTS) {
      throw new Error(`Royal supports at most ${MAX_SURFACE_LIGHTS} directional lights per pass`);
    }
    if (bindStableUniforms) {
      uniform1i(this.#programs, program, "u_surfaceLightCount", lights.length);
      for (let index = 0; index < lights.length; index += 1) {
        const light = lights[index]!;
        const uniforms = DIRECTIONAL_LIGHT_UNIFORMS[index]!;
        uniformColor(this.#programs, program, uniforms[0], light.color);
        uniform4f(this.#programs, program, uniforms[1],
          light.direction[0], light.direction[1], light.direction[2], 0);
      }
      if (stableUniformRevision === 0) this.#stableLightBindings.delete(program);
      else if (stableBinding === undefined) {
        this.#stableLightBindings.set(program, {
          brdfLutTextureUnit,
          revision: stableUniformRevision,
          specularTextureUnit,
        });
      } else {
        stableBinding.brdfLutTextureUnit = brdfLutTextureUnit;
        stableBinding.revision = stableUniformRevision;
        stableBinding.specularTextureUnit = specularTextureUnit;
      }
    }
    if (lightSet.punctuals.length > 0) {
      this.#textureBindings.invalidate();
      try {
        this.#clusteredLights.bind(
          this.#programs,
          program,
          lightSet.punctuals,
          projection,
          view,
          viewportSize[0],
          viewportSize[1],
          frame,
        );
      } finally {
        this.#textureBindings.invalidate();
      }
    }
  }

  #bindBaseColorTexture(
    program: WebGLProgram,
    plan: SurfaceTextureBindingPlan | undefined,
  ): SurfaceBaseColorBindingKind {
    if (plan === undefined) return "none";
    const binding = plan.baseColor;
    switch (binding.kind) {
      case "ordinary":
        return this.#bindOrdinaryBaseColorTexture(program, binding.resource, plan) ? "ordinary" : "none";
      case "prepared-virtual": {
        if (this.#bindVirtualTexture(program, binding.state, plan)) {
          if (binding.ordinaryFallback !== undefined) {
            this.#textureResidencyIntent.recordVirtualBind(textureCacheKey(binding.ordinaryFallback));
          }
          return "prepared-virtual";
        }
        if (binding.ordinaryFallback === undefined) return "none";
        const resource = this.#requestOrdinaryTexture(binding.ordinaryFallback);
        if (!resource.uploaded) return "none";
        return this.#bindOrdinaryBaseColorTexture(program, resource, plan) ? "ordinary" : "none";
      }
      case "none": return "none";
    }
  }

  #requestOrdinaryTexture(texture: TextureAssetUploadRef): OrdinaryTextureGpuResource {
    this.#textureResidencyIntent.requireOrdinary(textureCacheKey(texture));
    return this.#ordinaryTextures.request(texture);
  }

  #ordinaryTextureIsLoading(
    texture: TextureAssetUploadRef,
    resource: OrdinaryTextureGpuResource,
  ): boolean {
    if (resource.uploaded) return false;
    return this.#ordinaryTextures.assetSnapshot(texture)?.state !== "error";
  }

  #bindOrdinaryBaseColorTexture(
    program: WebGLProgram,
    resource: ReadyOrdinaryTexture,
    plan: SurfaceTextureBindingPlan,
  ): boolean {
    const textureUnit = plan.textureUnits.get("baseColorTexture");
    if (textureUnit === undefined) return false;
    this.#textureBindings.bindTexture2d(textureUnit, resource.texture);
    uniform1i(this.#programs, program, "u_texture", textureUnit);
    return true;
  }

  #isVirtualTextureDrawable(state: VirtualTextureRuntimeState): boolean {
    return state.status === "ready" && this.#virtualTextureDrawable(state.key);
  }

  #bindVirtualTexture(
    program: WebGLProgram,
    state: VirtualTextureRuntimeState,
    plan: SurfaceTextureBindingPlan,
  ): boolean {
    const manifest = state.manifest;
    if (manifest === undefined || !this.#isVirtualTextureDrawable(state)) return false;
    const atlasTextureUnit = plan.textureUnits.get("baseColorVirtualTextureAtlas");
    const pageTableTextureUnit = plan.textureUnits.get("baseColorVirtualTexturePageTable");
    if (atlasTextureUnit === undefined || pageTableTextureUnit === undefined) return false;
    const binding = this.#bindVirtualTextureGpu(
      this.#textureBindings,
      state.key,
      atlasTextureUnit,
      pageTableTextureUnit,
    );
    if (binding === undefined) return false;
    uniform1i(this.#programs, program, "u_vtAtlas", atlasTextureUnit);
    uniform1i(this.#programs, program, "u_vtPageTable", pageTableTextureUnit);
    uniform2f(this.#programs, program, "u_vtPageTableSize", binding.pageTableWidth, binding.pageTableHeight);
    const atlasWidth = binding.atlasGridColumns * binding.atlasCellSize;
    const atlasHeight = binding.atlasGridRows * binding.atlasCellSize;
    uniform2f(
      this.#programs,
      program,
      "u_vtAtlasPageUvSize",
      manifest.pageSize / atlasWidth,
      manifest.pageSize / atlasHeight,
    );
    uniform1f(this.#programs, program, "u_vtBorderPageRatio", binding.borderTexels / manifest.pageSize);
    uniform2f(
      this.#programs,
      program,
      "u_vtVirtualPageScale",
      manifest.width / manifest.pageSize,
      manifest.height / manifest.pageSize,
    );
    uniform2f(this.#programs, program, "u_vtVirtualSize", manifest.width, manifest.height);
    uniform1i(this.#programs, program, "u_vtWrapS", this.#virtualTextureWrapMode(state.texture.sampler?.wrapS));
    uniform1i(this.#programs, program, "u_vtWrapT", this.#virtualTextureWrapMode(state.texture.sampler?.wrapT));
    state.stats.shaderBinds += 1;
    return true;
  }

  #virtualTextureWrapMode(wrap: TextureSampler["wrapS"] | undefined): number {
    switch (wrap) {
      case "repeat": return VT_WRAP_REPEAT;
      case "mirrored-repeat": return VT_WRAP_MIRRORED_REPEAT;
      case "clamp-to-edge":
      default: return VT_WRAP_CLAMP_TO_EDGE;
    }
  }

  #bindCameraWorldPosition(program: WebGLProgram, view: Mat4): void {
    const position = cameraWorldPositionFromViewInto(this.#cameraWorldPosition, view);
    uniform4f(
      this.#programs,
      program,
      "u_cameraWorldPosition",
      position[0],
      position[1],
      position[2],
      1,
    );
  }

  #recordTextureBindingOmissions(
    plan: Pick<PureSurfaceTextureBindingPlan, "omissions">,
  ): void {
    for (let index = 0; index < plan.omissions.length; index += 1) {
      const omission = plan.omissions[index]!;
      if (omission.reason !== "unit-exhausted") continue;
      this.#diagnostics.push({
        key: `surface-texture-unit-exhausted:${omission.feature}:${this.#maxTextureImageUnits}`,
        message: `Surface texture ${omission.feature} omitted because no fragment sampler unit was available`,
      });
    }
  }

  #captureIblSignals(): void {
    const signals = this.#consumeIblSignals();
    for (let index = 0; index < signals.diagnostics.length; index += 1) {
      this.#diagnostics.push(signals.diagnostics[index]!);
    }
    this.#wakeRequested ||= signals.wakeRequested;
  }

  #beginDirectDraw(material: Material): void {
    this.#beginAlpha(material);
  }

  #beginGltfDraw(material: Material, sidedness: GltfFrameDrawBatch["sidedness"]): void {
    if (sidedness.doubleSided) this.#setCull(false);
    else {
      const wasCullEnabled = this.#cullEnabled;
      this.#setCull(true);
      if (!wasCullEnabled) {
        this.#gl.cullFace(this.#gl.BACK);
        this.#gl.frontFace(sidedness.frontFaceCcw ? this.#gl.CCW : this.#gl.CW);
        this.#frontFaceCcw = sidedness.frontFaceCcw;
      } else this.#setFrontFace(sidedness.frontFaceCcw);
    }
    this.#beginAlpha(material);
  }

  #beginAlpha(material: Material): void {
    if (material.kind !== "wireframe" && isBlendedSurfaceMaterial(material)) {
      if (!this.#blendEnabled) {
        this.#setBlend(true);
        this.#gl.blendFuncSeparate(
          this.#gl.SRC_ALPHA,
          this.#gl.ONE_MINUS_SRC_ALPHA,
          this.#gl.ONE,
          this.#gl.ONE_MINUS_SRC_ALPHA,
        );
      }
      this.#setDepthWrite(false);
    } else {
      this.#setBlend(false);
      this.#setDepthWrite(true);
    }
  }

  #setBlend(enabled: boolean): void {
    if (this.#blendEnabled === enabled) return;
    this.#blendEnabled = enabled;
    if (enabled) this.#gl.enable(this.#gl.BLEND);
    else this.#gl.disable(this.#gl.BLEND);
  }

  #setCull(enabled: boolean): void {
    if (this.#cullEnabled === enabled) return;
    this.#cullEnabled = enabled;
    if (enabled) this.#gl.enable(this.#gl.CULL_FACE);
    else this.#gl.disable(this.#gl.CULL_FACE);
  }

  #setDepthWrite(enabled: boolean): void {
    if (this.#depthWriteEnabled === enabled) return;
    this.#depthWriteEnabled = enabled;
    this.#gl.depthMask(enabled);
  }

  #setFrontFace(ccw: boolean): void {
    if (this.#frontFaceCcw === ccw) return;
    this.#frontFaceCcw = ccw;
    this.#gl.frontFace(ccw ? this.#gl.CCW : this.#gl.CW);
  }

}
