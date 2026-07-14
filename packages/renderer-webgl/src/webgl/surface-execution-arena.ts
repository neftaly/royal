import type { Material, RenderToneMapping, TextureSampler } from "@royal/renderer-core";
import type { FrameTextureResidencyIntent } from "../frame-texture-residency-intent";
import type { GltfFrameBatchArena, GltfFrameBatchCounters, GltfFrameDrawBatch } from "../gltf/frame-batch-arena";
import { IDENTITY_GLTF_TEXTURE_COORDINATES } from "../gltf/texture-coordinates";
import { multiplyMat4, type Mat4 } from "../math/mat4";
import type { OrdinaryTextureResidencyController } from "../ordinary-texture-residency-controller";
import {
  copyTransmissionScreenColorTexture,
  type ScreenColorTextureResource,
  type SurfaceRenderTargetArena,
} from "../surface-render-target-arena";
import type { BaseColorTextureResidency, ViewportSize, VirtualTextureRuntimeState } from "../virtual-texture-runtime";
import type { VertexInputGeometry } from "../vertex-input-arena";
import {
  bindVirtualTextureGpuResource,
  virtualTextureGpuDrawable,
  type VirtualTextureGpuArena,
} from "./virtual-texture-gpu-arena";
import {
  bindClusteredLights,
  clusteredLightTextureUnits,
  type ClusteredLightArena,
} from "./clustered-light-arena";
import {
  drawGeometry,
  prepareGeometryInstancedDraw,
  submitGeometryInstancedDraw,
  type GeometryDrawArena,
} from "./geometry-draw-arena";
import {
  bindSurfaceIbl,
  consumeIblTextureDiagnostics,
  consumeIblTextureFrameWake,
  IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT,
  prepareSurfaceIblBrdfLut,
  type IblTextureArena,
} from "./ibl-texture-arena";
import {
  EMPTY_SURFACE_LIGHT_SET,
  MAX_SURFACE_LIGHTS,
  type SurfaceLightSet,
} from "./lights";
import {
  isBlendedSurfaceMaterial,
  materialColor,
  materialEmissiveColor,
  surfaceMaterialAlphaCutoff,
  surfaceMaterialAlphaMode,
  surfaceMaterialExtensionFactors,
  surfaceMaterialMetallicFactor,
  surfaceMaterialOcclusionStrength,
  surfaceMaterialRoughnessFactor,
  textureCacheKey,
  type SurfaceMaterial,
  type SurfaceMaterialTextureCoordinates,
  type TextureAssetUploadRef,
} from "./materials";
import type { OrdinaryTextureGpuResource } from "./ordinary-texture-gpu-arena";
import {
  consumeProgramArenaWake,
  requestProgram,
  uniform1f,
  uniform1i,
  uniform2f,
  uniform2fv,
  uniformColor,
  uniformMatrix,
  useProgram,
  type ProgramArena,
} from "./program-arena";
import type { SurfaceShaderTextureFeature } from "./shaders";
import {
  SURFACE_MATERIAL_TEXTURE_BINDINGS,
  planSurfaceTextureBindings,
  resolveAdmittedSurfaceTextureBindings,
  type SurfaceIndependentTextureFeature,
  type SurfaceTextureBindingPlan as PureSurfaceTextureBindingPlan,
  type SurfaceTextureCandidate,
} from "./surface-texture-binding-plan";

const TEXTURE_COLOR = [1, 1, 1, 1] as const;
const VT_WRAP_CLAMP_TO_EDGE = 0;
const VT_WRAP_REPEAT = 1;
const VT_WRAP_MIRRORED_REPEAT = 2;

export interface SurfaceExecutionCounters extends GltfFrameBatchCounters {
  drawCalls: number;
  instancesDrawn: number;
}

export interface SurfaceToneMappingState {
  readonly exposure: number;
  readonly hdrOutput: boolean;
  readonly toneMapping: RenderToneMapping;
}

export interface SurfaceExecutionDiagnostic {
  readonly key: string;
  readonly message: string;
}

export interface SurfaceExecutionSignals {
  readonly diagnostics: readonly SurfaceExecutionDiagnostic[];
  readonly wakeRequested: boolean;
}

type SurfaceBaseColorTextureBinding =
  | { readonly kind: "none" }
  | {
      readonly kind: "ordinary";
      readonly resource: Extract<OrdinaryTextureGpuResource, { readonly uploaded: true }>;
    }
  | {
      readonly kind: "prepared-virtual";
      readonly ordinaryFallback?: TextureAssetUploadRef;
      readonly state: VirtualTextureRuntimeState;
    };

type SurfaceTextureBindingPlan = Omit<PureSurfaceTextureBindingPlan, "baseColor"> & {
  readonly baseColor: SurfaceBaseColorTextureBinding;
  readonly readyTextures: ReadonlyMap<SurfaceShaderTextureFeature, Extract<
    OrdinaryTextureGpuResource,
    { readonly uploaded: true }
  >>;
};

export interface SurfaceSingleExecution {
  readonly baseColorResidency: BaseColorTextureResidency;
  readonly contextGeneration: number;
  readonly frame: number;
  readonly geometry: VertexInputGeometry;
  readonly geometryId: number;
  readonly lights: SurfaceLightSet | undefined;
  readonly material: Material;
  readonly model: Mat4;
  readonly projection: Mat4;
  readonly toneMapping: SurfaceToneMappingState;
  readonly transmissionScreenColorTexture: ScreenColorTextureResource | undefined;
  readonly view: Mat4;
  readonly viewportSize: ViewportSize;
}

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
  readonly clusteredLights: ClusteredLightArena;
  readonly geometry: GeometryDrawArena;
  readonly gl: WebGL2RenderingContext;
  readonly gltfFrames: GltfFrameBatchArena;
  readonly iblTextures: IblTextureArena;
  readonly ordinaryTextures: OrdinaryTextureResidencyController;
  readonly programs: ProgramArena;
  readonly renderTargets: SurfaceRenderTargetArena;
  readonly textureResidencyIntent: FrameTextureResidencyIntent;
  readonly virtualTextures: VirtualTextureGpuArena;
}

/** Owns concrete WebGL surface planning, binding, state, and submission. */
export class SurfaceExecutionArena {
  readonly #clusteredLights: ClusteredLightArena;
  readonly #diagnostics: SurfaceExecutionDiagnostic[] = [];
  readonly #geometry: GeometryDrawArena;
  readonly #gl: WebGL2RenderingContext;
  readonly #gltfFrames: GltfFrameBatchArena;
  readonly #iblTextures: IblTextureArena;
  #maxTextureImageUnits = 0;
  readonly #ordinaryTextures: OrdinaryTextureResidencyController;
  readonly #programs: ProgramArena;
  readonly #renderTargets: SurfaceRenderTargetArena;
  readonly #textureResidencyIntent: FrameTextureResidencyIntent;
  readonly #virtualTextures: VirtualTextureGpuArena;
  #wakeRequested = false;

  constructor(options: SurfaceExecutionArenaOptions) {
    this.#clusteredLights = options.clusteredLights;
    this.#geometry = options.geometry;
    this.#gl = options.gl;
    this.#gltfFrames = options.gltfFrames;
    this.#iblTextures = options.iblTextures;
    this.#ordinaryTextures = options.ordinaryTextures;
    this.#programs = options.programs;
    this.#renderTargets = options.renderTargets;
    this.#textureResidencyIntent = options.textureResidencyIntent;
    this.#virtualTextures = options.virtualTextures;
  }

  configureTextureUnits(maxTextureImageUnits: number): void {
    this.#maxTextureImageUnits = Number.isFinite(maxTextureImageUnits) ? maxTextureImageUnits : 0;
  }

  copyTransmissionScreenColor(
    width: number,
    height: number,
    sourceX: number,
    sourceY: number,
    hdr: boolean,
  ): ScreenColorTextureResource {
    return copyTransmissionScreenColorTexture(
      this.#renderTargets,
      this.#gl,
      width,
      height,
      sourceX,
      sourceY,
      hdr,
    );
  }

  executeSingle(input: SurfaceSingleExecution): void {
    this.#executeSingle(input, true);
  }

  #executeSingle(input: SurfaceSingleExecution, manageState: boolean): void {
    if (manageState) this.#beginDirectDraw(input.material);
    try {
      const programKind = input.material.kind === "wireframe" ? "wireframe" : "surface";
      const surfaceMaterial = input.material.kind !== "wireframe" ? input.material : undefined;
      const surfaceLights = surfaceMaterial?.kind === "standard"
        ? input.lights ?? EMPTY_SURFACE_LIGHT_SET
        : surfaceMaterial === undefined ? undefined : EMPTY_SURFACE_LIGHT_SET;
      const plan = surfaceMaterial === undefined || surfaceLights === undefined
        ? undefined
        : this.#textureBindingPlan(
            surfaceMaterial,
            input.transmissionScreenColorTexture,
            surfaceLights,
            input.baseColorResidency,
          );
      const program = this.#program(
        input.frame,
        programKind,
        plan?.features,
        (surfaceLights?.punctuals.length ?? 0) > 0,
      );
      if (program === undefined) return;
      useProgram(this.#programs, program);
      uniformMatrix(this.#programs, program, "u_projection", input.projection);
      uniformMatrix(this.#programs, program, "u_view", input.view);
      uniformMatrix(this.#programs, program, "u_model", input.model);
      uniformColor(
        this.#programs,
        program,
        "u_color",
        plan?.baseColor.kind === "prepared-virtual"
          ? ("baseColorFactor" in input.material ? materialColor(input.material) : TEXTURE_COLOR)
          : materialColor(input.material),
      );
      uniform1i(this.#programs, program, "u_unlit", input.material.kind === "standard" ? 0 : 1);
      if (plan !== undefined && surfaceLights !== undefined && surfaceMaterial !== undefined) {
        uniformColor(this.#programs, program, "u_emissiveColor", materialEmissiveColor(surfaceMaterial));
        this.#bindMaterialFactors(program, surfaceMaterial, input.transmissionScreenColorTexture, plan);
        this.#bindToneMapping(program, input.toneMapping);
        this.#bindLights(program, surfaceLights, plan, input.projection, input.view, input.viewportSize, input.frame);
      }
      const baseColorBinding = this.#bindBaseColorTexture(program, plan);
      uniform1i(this.#programs, program, "u_useTexture", baseColorBinding.kind === "ordinary" ? 1 : 0);
      uniform1i(
        this.#programs,
        program,
        "u_useVirtualTexture",
        baseColorBinding.kind === "prepared-virtual" ? 1 : 0,
      );
      drawGeometry(
        this.#geometry,
        input.contextGeneration,
        input.geometryId,
        input.geometry,
        input.material.kind === "wireframe" ? input.material.width : undefined,
      );
    } finally {
      if (manageState) this.#endDirectDraw();
    }
  }

  executeGltfBatch(input: SurfaceGltfBatchExecution): void {
    const { batch } = input;
    this.#beginGltfDraw(batch.material, batch.sidedness);
    try {
      if (batch.localModels.length === 1) {
        this.#executeSingle({
          baseColorResidency: input.baseColorResidency,
          contextGeneration: input.contextGeneration,
          frame: input.frame,
          geometry: batch.geometry,
          geometryId: batch.geometryId,
          lights: batch.lights,
          material: batch.material,
          model: multiplyMat4(batch.rootModels[0]!, batch.localModels[0]!),
          projection: input.projection,
          toneMapping: input.toneMapping,
          transmissionScreenColorTexture: input.transmissionScreenColorTexture,
          view: input.view,
          viewportSize: input.viewportSize,
        }, false);
        return;
      }
      const surfaceLights = batch.material.kind === "standard" ? batch.lights : EMPTY_SURFACE_LIGHT_SET;
      const plan = this.#textureBindingPlan(
        batch.material,
        input.transmissionScreenColorTexture,
        surfaceLights,
        input.baseColorResidency,
      );
      const program = this.#program(
        input.frame,
        "surface-instanced-split",
        plan.features,
        surfaceLights.punctuals.length > 0,
      );
      if (program === undefined) return;
      useProgram(this.#programs, program);
      uniformMatrix(this.#programs, program, "u_projection", input.projection);
      uniformMatrix(this.#programs, program, "u_view", input.view);
      uniformColor(
        this.#programs,
        program,
        "u_color",
        plan.baseColor.kind === "prepared-virtual"
          ? ("baseColorFactor" in batch.material ? materialColor(batch.material) : TEXTURE_COLOR)
          : materialColor(batch.material),
      );
      uniformColor(this.#programs, program, "u_emissiveColor", materialEmissiveColor(batch.material));
      uniform1i(this.#programs, program, "u_unlit", batch.material.kind === "standard" ? 0 : 1);
      this.#bindMaterialFactors(program, batch.material, input.transmissionScreenColorTexture, plan);
      this.#bindToneMapping(program, input.toneMapping);
      this.#bindLights(program, surfaceLights, plan, input.projection, input.view, input.viewportSize, input.frame);
      const baseColorBinding = this.#bindBaseColorTexture(program, plan);
      uniform1i(this.#programs, program, "u_useTexture", baseColorBinding.kind === "ordinary" ? 1 : 0);
      uniform1i(
        this.#programs,
        program,
        "u_useVirtualTexture",
        baseColorBinding.kind === "prepared-virtual" ? 1 : 0,
      );
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
    } finally {
      this.#endGltfDraw();
    }
  }

  drainSignals(): SurfaceExecutionSignals {
    this.#captureIblSignals();
    const diagnostics = this.#diagnostics.slice();
    this.#diagnostics.length = 0;
    const wakeRequested = this.#wakeRequested || consumeProgramArenaWake(this.#programs);
    this.#wakeRequested = false;
    return { diagnostics, wakeRequested };
  }

  #program(
    frame: number,
    kind: "surface" | "surface-instanced-split" | "wireframe",
    features: PureSurfaceTextureBindingPlan["features"] | undefined,
    clusteredLights: boolean,
  ): WebGLProgram | undefined {
    const resource = requestProgram(this.#programs, frame, kind, features, clusteredLights);
    return resource?.program;
  }

  #textureBindingPlan(
    material: SurfaceMaterial,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    lightSet: SurfaceLightSet,
    baseColorResidency: BaseColorTextureResidency,
  ): SurfaceTextureBindingPlan {
    type ReadyOrdinaryTexture = Extract<OrdinaryTextureGpuResource, { readonly uploaded: true }>;
    const declaredCandidates: Partial<Record<SurfaceIndependentTextureFeature, SurfaceTextureCandidate>> = {};
    const declaredTextures = new Map<SurfaceShaderTextureFeature, TextureAssetUploadRef>();
    for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) {
      const texture = descriptor.key === "emissiveTexture"
        ? material.emissiveTexture
        : material.kind === "standard" ? material[descriptor.key] : undefined;
      if (texture === undefined) continue;
      declaredCandidates[descriptor.feature] = "ready";
      declaredTextures.set(descriptor.feature, texture);
    }
    if (transmissionScreenColorTexture !== undefined) declaredCandidates.transmissionScreenTexture = "ready";
    if (lightSet.specular !== undefined) {
      declaredCandidates.iblSpecularCube = "ready";
      declaredCandidates.iblBrdfLut = "ready";
    }
    const declaredBaseColor = (() => {
      switch (baseColorResidency.kind) {
        case "none": return { kind: "none" } as const;
        case "ordinary": return { kind: "ordinary", ordinary: "ready" } as const;
        case "prepared-virtual": return {
          ...(baseColorResidency.ordinaryFallback === undefined ? {} : { fallback: "ready" as const }),
          kind: "virtual" as const,
          virtual: "ready" as const,
        };
      }
    })();
    const clusterUnits = clusteredLightTextureUnits(this.#clusteredLights);
    const reserveClusterUnits = lightSet.punctuals.length > 0;
    const reservedTextureUnits = reserveClusterUnits
      ? new Set([clusterUnits.grid, clusterUnits.indices, clusterUnits.lights].filter((unit) => unit >= 0))
      : new Set<number>();
    const admission = planSurfaceTextureBindings({
      baseColor: declaredBaseColor,
      brdfLutPreferredUnit: reserveClusterUnits && clusterUnits.grid > 0
        ? clusterUnits.grid - 1
        : IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT,
      candidates: declaredCandidates,
      maxTextureUnits: this.#maxTextureImageUnits,
      reservedTextureUnits,
    });
    const candidates: Partial<Record<SurfaceIndependentTextureFeature, SurfaceTextureCandidate>> = {};
    const readyTextures = new Map<SurfaceShaderTextureFeature, ReadyOrdinaryTexture>();
    for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) {
      if (!admission.features.has(descriptor.feature)) continue;
      const texture = declaredTextures.get(descriptor.feature);
      if (texture === undefined) continue;
      const resource = this.#requestOrdinaryTexture(texture);
      const ready = resource.uploaded ? resource : undefined;
      candidates[descriptor.feature] = ready === undefined ? "unavailable" : "ready";
      if (ready !== undefined) readyTextures.set(descriptor.feature, ready);
    }
    let ordinaryBaseColor: ReadyOrdinaryTexture | undefined;
    let virtualFallbackTexture: TextureAssetUploadRef | undefined;
    let virtualFallbackReady: ReadyOrdinaryTexture | undefined;
    const baseColor = (() => {
      switch (baseColorResidency.kind) {
        case "none": return { kind: "none" } as const;
        case "ordinary": {
          if (admission.baseColor.kind === "ordinary") {
            const resource = this.#requestOrdinaryTexture(baseColorResidency.texture);
            ordinaryBaseColor = resource.uploaded ? resource : undefined;
          }
          return {
            kind: "ordinary" as const,
            ordinary: ordinaryBaseColor === undefined ? "unavailable" as const : "ready" as const,
          };
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
          virtualFallbackReady = fallbackResource?.uploaded === true ? fallbackResource : undefined;
          return {
            ...(virtualFallbackTexture === undefined || admission.baseColor.kind === "none"
              ? {}
              : { fallback: virtualFallbackReady === undefined ? "unavailable" as const : "ready" as const }),
            kind: "virtual" as const,
            virtual: admission.baseColor.kind === "virtual" && drawable ? "ready" as const : "unavailable" as const,
          };
        }
      }
    })();
    if (transmissionScreenColorTexture !== undefined) {
      candidates.transmissionScreenTexture = transmissionScreenColorTexture.uploaded ? "ready" : "unavailable";
    }
    if (lightSet.specular !== undefined) {
      candidates.iblSpecularCube = "ready";
      if (admission.features.has("iblBrdfLut")) {
        let ready = false;
        try {
          ready = prepareSurfaceIblBrdfLut(this.#iblTextures);
        } finally {
          this.#captureIblSignals();
        }
        candidates.iblBrdfLut = ready ? "ready" : "unavailable";
      }
    }
    const pure = resolveAdmittedSurfaceTextureBindings(admission, { baseColor, candidates });
    this.#recordTextureBindingOmissions(pure);
    const selectedBaseColor: SurfaceBaseColorTextureBinding = pure.baseColor.kind === "ordinary"
      ? ordinaryBaseColor === undefined && virtualFallbackReady !== undefined
        ? { kind: "ordinary", resource: virtualFallbackReady }
        : ordinaryBaseColor === undefined ? { kind: "none" } : { kind: "ordinary", resource: ordinaryBaseColor }
      : pure.baseColor.kind === "virtual" && baseColorResidency.kind === "prepared-virtual"
        ? {
            kind: "prepared-virtual",
            ...(virtualFallbackTexture === undefined ? {} : { ordinaryFallback: virtualFallbackTexture }),
            state: baseColorResidency.state,
          }
        : { kind: "none" };
    return { ...pure, baseColor: selectedBaseColor, readyTextures };
  }

  #bindMaterialFactors(
    program: WebGLProgram,
    material: SurfaceMaterial,
    transmissionScreenColorTexture: ScreenColorTextureResource | undefined,
    plan: SurfaceTextureBindingPlan,
  ): void {
    const factors = surfaceMaterialExtensionFactors(material);
    const alphaMode = surfaceMaterialAlphaMode(material);
    const hasFiniteAttenuationDistance = Number.isFinite(factors.attenuationDistance);
    uniformColor(this.#programs, program, "u_alphaSettings", [
      alphaMode === "MASK" ? 1 : alphaMode === "BLEND" ? 2 : 0,
      surfaceMaterialAlphaCutoff(material), 0, 0,
    ]);
    uniformColor(this.#programs, program, "u_materialPbrFactors", [
      surfaceMaterialMetallicFactor(material), surfaceMaterialRoughnessFactor(material), 0, 0,
    ]);
    uniformColor(this.#programs, program, "u_specularColorFactor", [
      factors.specularColorFactor[0], factors.specularColorFactor[1], factors.specularColorFactor[2], 1,
    ]);
    uniformColor(this.#programs, program, "u_materialExtensionFactors", [
      factors.specularFactor, factors.ior, factors.clearcoatFactor, factors.clearcoatRoughnessFactor,
    ]);
    uniformColor(this.#programs, program, "u_anisotropyFactors", [
      factors.anisotropyStrength, factors.anisotropyRotation, 0, 0,
    ]);
    uniformColor(this.#programs, program, "u_diffuseTransmissionFactors", [
      factors.diffuseTransmissionColorFactor[0], factors.diffuseTransmissionColorFactor[1],
      factors.diffuseTransmissionColorFactor[2], factors.diffuseTransmissionFactor,
    ]);
    uniformColor(this.#programs, program, "u_sheenColorFactor", [
      factors.sheenColorFactor[0], factors.sheenColorFactor[1], factors.sheenColorFactor[2],
      factors.sheenRoughnessFactor,
    ]);
    uniformColor(this.#programs, program, "u_iridescenceFactors", [
      factors.iridescenceFactor, factors.iridescenceIor,
      factors.iridescenceThicknessMinimum, factors.iridescenceThicknessMaximum,
    ]);
    uniformColor(this.#programs, program, "u_dispersionFactors", [factors.dispersionFactor, 0, 0, 0]);
    uniformColor(this.#programs, program, "u_attenuationColorFactor", [
      factors.attenuationColor[0], factors.attenuationColor[1], factors.attenuationColor[2], 1,
    ]);
    uniformColor(this.#programs, program, "u_transmissionVolumeFactors", [
      factors.transmissionFactor, factors.thicknessFactor,
      hasFiniteAttenuationDistance ? factors.attenuationDistance : 0,
      hasFiniteAttenuationDistance ? 1 : 0,
    ]);
    this.#bindTransmissionScreenColorTexture(program, transmissionScreenColorTexture, plan);
    this.#bindTextureCoordinates(program, material, plan);
    uniformColor(this.#programs, program, "u_normalTextureSettings", [
      material.kind === "standard" ? material.normalScale ?? 1 : 1, 0, 0, 0,
    ]);
    uniformColor(this.#programs, program, "u_occlusionSettings", [
      surfaceMaterialOcclusionStrength(material), 0, 0, 0,
    ]);
    for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) this.#bindCachedTexture2d(program, descriptor, plan);
  }

  #bindTextureCoordinates(program: WebGLProgram, material: SurfaceMaterial, plan: SurfaceTextureBindingPlan): void {
    const bind = (
      feature: SurfaceShaderTextureFeature,
      key: keyof SurfaceMaterialTextureCoordinates,
      uniformStem: string,
      virtualBaseColor = false,
    ): void => {
      const preparedCoordinates = material.textureCoordinates?.[key];
      const active = preparedCoordinates !== undefined
        || plan.features.has(feature)
        || (virtualBaseColor && (
          plan.features.has("baseColorVirtualTextureAtlas")
          || plan.features.has("baseColorVirtualTexturePageTable")
        ));
      if (!active) return;
      const coordinates = preparedCoordinates ?? IDENTITY_GLTF_TEXTURE_COORDINATES;
      uniform1i(this.#programs, program, `${uniformStem}Set`, coordinates.set);
      uniformColor(this.#programs, program, `${uniformStem}Row0`, coordinates.row0);
      uniformColor(this.#programs, program, `${uniformStem}Row1`, coordinates.row1);
    };
    bind("baseColorTexture", "baseColorTexture", "u_baseColorUv", true);
    for (const descriptor of SURFACE_MATERIAL_TEXTURE_BINDINGS) {
      bind(descriptor.feature, descriptor.key, descriptor.uvUniformStem);
    }
  }

  #bindCachedTexture2d(
    program: WebGLProgram,
    descriptor: (typeof SURFACE_MATERIAL_TEXTURE_BINDINGS)[number],
    plan: SurfaceTextureBindingPlan,
  ): void {
    const resource = plan.readyTextures.get(descriptor.feature);
    const allocatedUnit = plan.textureUnits.get(descriptor.feature);
    if (resource === undefined || allocatedUnit === undefined) {
      uniform1i(this.#programs, program, descriptor.useUniform, 0);
      return;
    }
    this.#gl.activeTexture(this.#gl.TEXTURE0 + allocatedUnit);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, resource.texture);
    uniform1i(this.#programs, program, descriptor.samplerUniform, allocatedUnit);
    uniform1i(this.#programs, program, descriptor.useUniform, 1);
  }

  #bindTransmissionScreenColorTexture(
    program: WebGLProgram,
    resource: ScreenColorTextureResource | undefined,
    plan: SurfaceTextureBindingPlan,
  ): void {
    const textureUnit = plan.textureUnits.get("transmissionScreenTexture");
    if (resource === undefined || !resource.uploaded || textureUnit === undefined) {
      uniform1i(this.#programs, program, "u_useTransmissionTexture", 0);
      return;
    }
    uniform1i(this.#programs, program, "u_useTransmissionTexture", 1);
    this.#gl.activeTexture(this.#gl.TEXTURE0 + textureUnit);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, resource.texture);
    uniform1i(this.#programs, program, "u_transmissionScreenTexture", textureUnit);
    uniform2fv(this.#programs, program, "u_viewportOrigin", [resource.originX, resource.originY]);
    uniform2fv(this.#programs, program, "u_viewportSize", [resource.width, resource.height]);
  }

  #bindToneMapping(program: WebGLProgram, toneMapping: SurfaceToneMappingState): void {
    uniformColor(this.#programs, program, "u_toneMappingSettings", [
      toneMapping.toneMapping === "aces-fitted" ? 1 : toneMapping.toneMapping === "pbr-neutral" ? 2 : 0,
      toneMapping.exposure, toneMapping.hdrOutput ? 1 : 0, 0,
    ]);
  }

  #bindLights(
    program: WebGLProgram,
    lightSet: SurfaceLightSet,
    plan: SurfaceTextureBindingPlan,
    projection: Mat4,
    view: Mat4,
    viewportSize: ViewportSize,
    frame: number,
  ): void {
    try {
      bindSurfaceIbl(
        this.#iblTextures,
        this.#programs,
        program,
        lightSet,
        plan.textureUnits.get("iblSpecularCube"),
        plan.textureUnits.get("iblBrdfLut"),
      );
    } finally {
      this.#captureIblSignals();
    }
    const lights = lightSet.directionals;
    if (lights.length > MAX_SURFACE_LIGHTS) {
      throw new Error(`Royal supports at most ${MAX_SURFACE_LIGHTS} directional lights per pass`);
    }
    uniform1i(this.#programs, program, "u_surfaceLightCount", lights.length);
    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      if (light === undefined) continue;
      uniform1i(this.#programs, program, `u_surfaceLightKind[${index}]`, 0);
      uniformColor(this.#programs, program, `u_surfaceLightColor[${index}]`, light.color);
      uniformColor(this.#programs, program, `u_surfaceLightDirection[${index}]`, [
        light.direction[0], light.direction[1], light.direction[2], 0,
      ]);
      uniformColor(this.#programs, program, `u_surfaceLightPosition[${index}]`, [0, 0, 0, 0]);
      uniformColor(this.#programs, program, `u_surfaceLightCone[${index}]`, [1, 0, 0, 0]);
    }
    bindClusteredLights(
      this.#clusteredLights,
      this.#programs,
      program,
      lightSet.punctuals,
      projection,
      view,
      viewportSize[0],
      viewportSize[1],
      frame,
    );
  }

  #bindBaseColorTexture(
    program: WebGLProgram,
    plan: SurfaceTextureBindingPlan | undefined,
  ): SurfaceBaseColorTextureBinding {
    if (plan === undefined) return { kind: "none" };
    const binding = plan.baseColor;
    switch (binding.kind) {
      case "ordinary":
        return this.#bindOrdinaryBaseColorTexture(program, binding, plan) ? binding : { kind: "none" };
      case "prepared-virtual": {
        if (this.#bindVirtualTexture(program, binding.state, plan)) {
          if (binding.ordinaryFallback !== undefined) {
            this.#textureResidencyIntent.recordVirtualBind(textureCacheKey(binding.ordinaryFallback));
          }
          return binding;
        }
        if (binding.ordinaryFallback === undefined) return { kind: "none" };
        const resource = this.#requestOrdinaryTexture(binding.ordinaryFallback);
        if (!resource.uploaded) return { kind: "none" };
        const fallback = { kind: "ordinary" as const, resource };
        return this.#bindOrdinaryBaseColorTexture(program, fallback, plan) ? fallback : { kind: "none" };
      }
      case "none": return { kind: "none" };
    }
  }

  #requestOrdinaryTexture(texture: TextureAssetUploadRef): OrdinaryTextureGpuResource {
    this.#textureResidencyIntent.requireOrdinary(textureCacheKey(texture));
    return this.#ordinaryTextures.request(texture);
  }

  #bindOrdinaryBaseColorTexture(
    program: WebGLProgram,
    binding: Extract<SurfaceBaseColorTextureBinding, { readonly kind: "ordinary" }>,
    plan: SurfaceTextureBindingPlan,
  ): boolean {
    const textureUnit = plan.textureUnits.get("baseColorTexture");
    if (textureUnit === undefined) return false;
    this.#gl.activeTexture(this.#gl.TEXTURE0 + textureUnit);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, binding.resource.texture);
    uniform1i(this.#programs, program, "u_texture", textureUnit);
    return true;
  }

  #isVirtualTextureDrawable(state: VirtualTextureRuntimeState): boolean {
    return state.status === "ready" && virtualTextureGpuDrawable(this.#virtualTextures, state.key);
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
    const binding = bindVirtualTextureGpuResource(
      this.#virtualTextures,
      state.key,
      atlasTextureUnit,
      pageTableTextureUnit,
    );
    if (binding === undefined) return false;
    uniform1i(this.#programs, program, "u_vtAtlas", atlasTextureUnit);
    uniform1i(this.#programs, program, "u_vtPageTable", pageTableTextureUnit);
    uniform2f(this.#programs, program, "u_vtPageTableSize", binding.pageTableWidth, binding.pageTableHeight);
    uniform2f(this.#programs, program, "u_vtAtlasGrid", binding.atlasGridColumns, binding.atlasGridRows);
    uniform2f(
      this.#programs,
      program,
      "u_vtAtlasTexelSize",
      1 / (binding.atlasGridColumns * binding.atlasCellSize),
      1 / (binding.atlasGridRows * binding.atlasCellSize),
    );
    uniform1f(this.#programs, program, "u_vtBorderTexels", binding.borderTexels);
    uniform1f(this.#programs, program, "u_vtPageSize", manifest.pageSize);
    uniform2f(this.#programs, program, "u_vtVirtualSize", manifest.width, manifest.height);
    uniform1i(this.#programs, program, "u_vtFlipY", (state.texture.flipY ?? true) ? 1 : 0);
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

  #recordTextureBindingOmissions(plan: PureSurfaceTextureBindingPlan): void {
    for (const omission of plan.omissions) {
      if (omission.reason !== "unit-exhausted") continue;
      this.#diagnostics.push({
        key: `surface-texture-unit-exhausted:${omission.feature}:${this.#maxTextureImageUnits}`,
        message: `Surface texture ${omission.feature} omitted because no fragment sampler unit was available`,
      });
    }
  }

  #captureIblSignals(): void {
    for (const message of consumeIblTextureDiagnostics(this.#iblTextures)) {
      this.#diagnostics.push({ key: `ibl-governor:${message}`, message });
    }
    const wakeRequested = consumeIblTextureFrameWake(this.#iblTextures);
    this.#wakeRequested ||= wakeRequested;
  }

  #beginDirectDraw(material: Material): void {
    this.#beginAlpha(material);
  }

  #endDirectDraw(): void {
    this.#endAlpha();
  }

  #beginGltfDraw(material: Material, sidedness: GltfFrameDrawBatch["sidedness"]): void {
    if (sidedness.doubleSided) this.#gl.disable(this.#gl.CULL_FACE);
    else {
      this.#gl.enable(this.#gl.CULL_FACE);
      this.#gl.cullFace(this.#gl.BACK);
      this.#gl.frontFace(sidedness.frontFaceCcw ? this.#gl.CCW : this.#gl.CW);
    }
    this.#beginAlpha(material);
  }

  #endGltfDraw(): void {
    this.#endAlpha();
    this.#gl.disable(this.#gl.CULL_FACE);
    this.#gl.frontFace(this.#gl.CCW);
  }

  #beginAlpha(material: Material): void {
    if (material.kind !== "wireframe" && isBlendedSurfaceMaterial(material)) {
      this.#gl.enable(this.#gl.BLEND);
      this.#gl.blendFuncSeparate(
        this.#gl.SRC_ALPHA,
        this.#gl.ONE_MINUS_SRC_ALPHA,
        this.#gl.ONE,
        this.#gl.ONE_MINUS_SRC_ALPHA,
      );
      this.#gl.depthMask(false);
    } else {
      this.#gl.disable(this.#gl.BLEND);
      this.#gl.depthMask(true);
    }
  }

  #endAlpha(): void {
    this.#gl.disable(this.#gl.BLEND);
    this.#gl.depthMask(true);
  }

}
