import {
  cameraWorldPositionFromViewInto,
  identityMat4,
  multiplyMat4Into,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";
import type { ResolvedCanvasSize } from "../frame/canvas-size";
import type { WebGlStateOwner } from "../webgl/state-owner";
import type { OpaqueDrawStateIntent } from "../webgl/draw-state-transition";
import { TextureGpuOwner, type GpuTextureBinding } from "../texture/gpu-owner";
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
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_EMISSIVE_TEXTURE,
  SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE,
  SURFACE_FEATURE_NORMAL_TEXTURE,
  SURFACE_FEATURE_OCCLUSION_TEXTURE,
  SURFACE_FEATURE_PUNCTUAL_LIGHTS,
  SURFACE_FEATURE_STUDIO_ENVIRONMENT,
  SURFACE_FEATURE_TANGENT,
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
  projectedBoundsScreenCoverage,
} from "./lod-selection";

type GpuSurface = Readonly<{
  bindings: readonly GpuTextureBinding[];
  geometry: GpuGeometry;
  instanceCount: number;
  program: StandardProgram | UnlitProgram;
  sceneIndex: number;
  surface: CanonicalDrawSurface;
  textureUnits: number;
  vertexArray: WebGLVertexArrayObject;
}>;

type MutableOpaqueDrawIntent = {
  cullBackFaces: boolean;
  framebuffer: WebGLFramebuffer | null;
  frontFace: number;
  program: WebGLProgram;
  textureBindings: readonly GpuTextureBinding[];
  textureUnits: number;
  vertexArray: WebGLVertexArrayObject;
  viewport: { height: number; width: number; x: number; y: number };
};

const MATERIAL_TEXTURE_UNITS = 5;
const SURFACE_UPLOADS_PER_FRAME = 16;

const applyTextureCoordinates = (
  gl: WebGL2RenderingContext,
  program: TextureCoordinatesProgram | null,
  coordinates: CanonicalTextureCoordinates | undefined,
): void => {
  if (program === null) return;
  const resolved = coordinates ?? IDENTITY_TEXTURE_COORDINATES;
  gl.uniform4fv(program.row0, resolved.row0);
  gl.uniform4fv(program.row1, resolved.row1);
};

const materialTextureFeatures = (
  surface: CanonicalDrawSurface,
  geometry: GpuGeometry,
  hasStudioEnvironment: boolean,
  hasPunctualLights: boolean,
): number => {
  let features = surface.material.baseColorTexture === undefined
    ? 0
    : SURFACE_FEATURE_BASE_COLOR_TEXTURE;
  if (surface.material.kind !== "standard") return features;
  if (surface.material.metallicRoughnessTexture !== undefined) {
    features |= SURFACE_FEATURE_METALLIC_ROUGHNESS_TEXTURE;
  }
  if (surface.material.normalTexture !== undefined) features |= SURFACE_FEATURE_NORMAL_TEXTURE;
  if (
    (features & SURFACE_FEATURE_NORMAL_TEXTURE) !== 0
    && geometry.tangentBuffer !== null
  ) features |= SURFACE_FEATURE_TANGENT;
  if (surface.material.emissiveTexture !== undefined) features |= SURFACE_FEATURE_EMISSIVE_TEXTURE;
  if (hasStudioEnvironment) {
    features |= SURFACE_FEATURE_STUDIO_ENVIRONMENT;
    if (surface.material.occlusionTexture !== undefined) {
      features |= SURFACE_FEATURE_OCCLUSION_TEXTURE;
    }
  }
  if (hasPunctualLights) features |= SURFACE_FEATURE_PUNCTUAL_LIGHTS;
  return features;
};

const textureUnitMask = (features: number): number => (
  features & 0b1111
) | (features & SURFACE_FEATURE_OCCLUSION_TEXTURE ? 0b1_0000 : 0);

const groupSurfacesByProgram = (surfaces: readonly GpuSurface[]): readonly GpuSurface[] => {
  const groups = new Map<WebGLProgram, Map<CanonicalSurfaceMaterial, GpuSurface[]>>();
  let materialGroupCount = 0;
  for (const resource of surfaces) {
    const program = resource.program.program;
    let materialGroups = groups.get(program);
    if (materialGroups === undefined) {
      materialGroups = new Map<CanonicalSurfaceMaterial, GpuSurface[]>();
      groups.set(program, materialGroups);
    }
    const material = resource.surface.materialSource;
    const group = materialGroups.get(material);
    if (group === undefined) {
      materialGroups.set(material, [resource]);
      materialGroupCount += 1;
    } else group.push(resource);
  }
  if (materialGroupCount < 2) return surfaces;
  const grouped = Array<GpuSurface>(surfaces.length);
  let index = 0;
  for (const materialGroups of groups.values()) {
    for (const group of materialGroups.values()) {
      for (const resource of group) {
        grouped[index] = resource;
        index += 1;
      }
    }
  }
  return grouped;
};

const surfaceMatchesLodSelections = (
  surface: CanonicalDrawSurface,
  selections: ReadonlyMap<string, number>,
): boolean => {
  const lods = surface.lods;
  if (lods === undefined) return true;
  for (const lod of lods) {
    if (selections.get(lod.group) !== lod.level) return false;
  }
  return true;
};

const surfaceHasLodGroup = (surface: CanonicalDrawSurface, group: string): boolean => {
  const lods = surface.lods;
  if (lods === undefined) return false;
  for (const lod of lods) {
    if (lod.group === group) return true;
  }
  return false;
};

/** Coordinates one context generation's program, geometry, texture, and draw-state owners. */
export class SurfaceGpuOwner {
  #admittedSurfaceCount = 0;
  readonly #cameraPosition = new Float32Array(4);
  readonly #directionalLightColors = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  readonly #directionalLightDirections = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  #directionalLightCount = 0;
  #dirty = false;
  #drawIntent: MutableOpaqueDrawIntent | null = null;
  readonly #geometryGpu: SurfaceGeometryGpuOwner;
  readonly #frustumPlanes = new Float32Array(24);
  readonly #gl: WebGL2RenderingContext;
  #gpuSurfaces: readonly GpuSurface[] = [];
  readonly #materialFactors = new Float32Array(4);
  readonly #lodGroups = new Set<string>();
  #lodDrawableLevels = new Uint8Array(1);
  readonly #lodProjection = createProjectedBoundsWorkspace();
  readonly #lodSelections = new Map<string, number>();
  readonly #emissiveFactor = new Float32Array(4);
  readonly #environmentSettings = new Float32Array(4);
  readonly #presentation = new Float32Array(4);
  readonly #punctualLightColors = new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4);
  readonly #punctualLightDirections = new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4);
  readonly #punctualLightPositions = new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4);
  readonly #punctualLightSpotCones = new Float32Array(MAX_CANONICAL_PUNCTUAL_LIGHTS * 4);
  readonly #programs: SurfaceProgramOwner;
  #scene: CanonicalSurfaceScene | null = null;
  readonly #textureGpu: TextureGpuOwner;
  readonly #texturePublicationKeys = new Set<string>();
  readonly #viewProjectionModel: MutableMat4 = identityMat4();

  constructor(gl: WebGL2RenderingContext) {
    this.#geometryGpu = new SurfaceGeometryGpuOwner(gl);
    this.#gl = gl;
    this.#programs = new SurfaceProgramOwner(gl);
    this.#textureGpu = new TextureGpuOwner(gl);
  }

  dispose(): void {
    this.#geometryGpu.dispose();
    this.#textureGpu.dispose();
    this.#programs.dispose();
    this.#drawIntent = null;
    this.#admittedSurfaceCount = 0;
    this.#scene = null;
    this.#texturePublicationKeys.clear();
    this.#lodGroups.clear();
    this.#lodSelections.clear();
  }

  invalidate(): void {
    this.#geometryGpu.invalidate();
    this.#gpuSurfaces = [];
    this.#textureGpu.invalidate();
    this.#programs.invalidate();
    this.#drawIntent = null;
    this.#admittedSurfaceCount = 0;
    this.#dirty = this.#scene !== null;
    this.#texturePublicationKeys.clear();
  }

  /** Current canonical LOD choices shared by visual submission and exact picking. */
  lodSelections(): ReadonlyMap<string, number> {
    return this.#lodSelections;
  }

  setScene(scene: CanonicalSurfaceScene | null): void {
    if (this.#scene === scene) return;
    this.#admittedSurfaceCount = retainedSurfaceAdmissionCount(
      this.#scene?.surfaces ?? [],
      scene?.surfaces ?? [],
      this.#admittedSurfaceCount,
    );
    this.#scene = scene;
    this.#dirty = true;
    this.#texturePublicationKeys.clear();
  }

  publishTextureScene(scene: CanonicalSurfaceScene, textureKey: string): void {
    if (this.#scene === null || this.#scene.surfaces.length !== scene.surfaces.length) {
      this.setScene(scene);
      return;
    }
    this.#scene = scene;
    if (this.#dirty && this.#texturePublicationKeys.size === 0) return;
    this.#texturePublicationKeys.add(textureKey);
    this.#dirty = true;
  }

  draw(
    viewProjection: Mat4,
    view: Mat4,
    size: ResolvedCanvasSize,
    state: WebGlStateOwner,
  ): boolean {
    if (this.#dirty) {
      const texturePublication = this.#texturePublicationKeys.size > 0;
      try {
        if (texturePublication) this.#reconcileTexturePublications();
        else this.#reconcile();
      } finally {
        if (!texturePublication) state.invalidateVertexArray();
        state.invalidateTextureBindings();
      }
    }
    const scene = this.#scene;
    if (scene === null || this.#gpuSurfaces.length === 0) return this.#dirty;
    let drawIntent = this.#drawIntent;
    if (drawIntent === null) {
      const firstSurface = this.#gpuSurfaces[0]!;
      const first = firstSurface.program;
      drawIntent = {
        cullBackFaces: firstSurface.surface.material.doubleSided !== true,
        framebuffer: null,
        frontFace: this.#gl.CCW,
        program: first.program,
        textureBindings: firstSurface.bindings,
        textureUnits: firstSurface.textureUnits,
        vertexArray: firstSurface.vertexArray,
        viewport: { height: 0, width: 0, x: 0, y: 0 },
      };
      this.#drawIntent = drawIntent;
    }
    drawIntent.viewport.height = size.backingHeight;
    drawIntent.viewport.width = size.backingWidth;
    cameraWorldPositionFromViewInto(this.#cameraPosition, view);
    this.#cameraPosition[3] = 1;
    let initializedProgram: WebGLProgram | null = null;
    let materialProgram: WebGLProgram | null = null;
    let materialSource: CanonicalSurfaceMaterial | null = null;
    let standardGlobalsProgram: WebGLProgram | null = null;
    const gl = this.#gl;
    frustumPlanesInto(this.#frustumPlanes, viewProjection);
    this.#lodGroups.clear();
    for (const resource of this.#gpuSurfaces) {
      const lods = resource.surface.lods;
      if (lods === undefined) continue;
      for (const lod of lods) {
        if (this.#lodGroups.has(lod.group)) continue;
        this.#lodGroups.add(lod.group);
        const coverage = projectedBoundsScreenCoverage(
          lod.selectionBounds,
          viewProjection,
          this.#lodProjection,
        );
        if (this.#lodDrawableLevels.length < lod.thresholds.length) {
          this.#lodDrawableLevels = new Uint8Array(lod.thresholds.length);
        } else this.#lodDrawableLevels.fill(0, 0, lod.thresholds.length);
        for (const candidate of this.#gpuSurfaces) {
          const candidateLods = candidate.surface.lods;
          if (candidateLods === undefined) continue;
          for (const candidateLod of candidateLods) {
            if (candidateLod.group === lod.group) {
              this.#lodDrawableLevels[candidateLod.level] = 1;
            }
          }
        }
        const previous = this.#lodSelections.get(lod.group);
        const target = hystereticLodLevel(
          coverage,
          lod.thresholds,
          previous,
        );
        this.#lodSelections.set(lod.group, closestDrawableLodLevel(
          target,
          previous,
          this.#lodDrawableLevels,
          lod.thresholds.length,
        ));
      }
    }
    // Admission is prefix-bounded. Independent selectors may temporarily pick
    // a node/material combination whose complete packet is not uploaded yet;
    // retain one admitted combination for every affected set instead of a hole.
    for (const group of this.#lodGroups) {
      let matched = false;
      let fallback: CanonicalDrawSurface | undefined;
      for (const candidate of this.#gpuSurfaces) {
        if (!surfaceHasLodGroup(candidate.surface, group)) continue;
        fallback ??= candidate.surface;
        if (surfaceMatchesLodSelections(candidate.surface, this.#lodSelections)) {
          matched = true;
          break;
        }
      }
      if (matched || fallback?.lods === undefined) continue;
      for (const lod of fallback.lods) this.#lodSelections.set(lod.group, lod.level);
    }
    for (let index = 0; index < this.#gpuSurfaces.length; index += 1) {
      const resource = this.#gpuSurfaces[index]!;
      const surface = resource.surface;
      if (!surfaceMatchesLodSelections(surface, this.#lodSelections)) continue;
      if (!worldBoundsVisible(surface.worldBounds, this.#frustumPlanes)) continue;
      const program = resource.program;
      drawIntent.cullBackFaces = surface.material.doubleSided !== true;
      drawIntent.frontFace = surface.modelHandedness < 0 ? gl.CW : gl.CCW;
      drawIntent.program = program.program;
      drawIntent.textureBindings = resource.bindings;
      drawIntent.textureUnits = resource.textureUnits;
      drawIntent.vertexArray = resource.vertexArray;
      state.applyOpaqueDraw(drawIntent as OpaqueDrawStateIntent);
      if (initializedProgram !== program.program) {
        this.#programs.initializeSamplers(program);
        initializedProgram = program.program;
      }
      const materialChanged = materialProgram !== program.program
        || materialSource !== surface.materialSource;
      if (program.kind === "unlit") {
        multiplyMat4Into(this.#viewProjectionModel, viewProjection, surface.model);
        gl.uniformMatrix4fv(program.viewProjectionModel, false, this.#viewProjectionModel);
        if (materialChanged) {
          gl.uniform4fv(program.color, surface.material.baseColor);
          applyTextureCoordinates(
            gl,
            program.textureCoordinates,
            surface.material.baseColorTextureCoordinates,
          );
          if (program.alphaCutoff !== null) {
            gl.uniform1f(program.alphaCutoff, surface.material.alphaCutoff ?? 0.5);
          }
        }
      } else {
        const material = surface.material;
        if (material.kind !== "standard") {
          throw new Error("Royal standard surface program received a non-standard material");
        }
        if (standardGlobalsProgram !== program.program) {
          gl.uniformMatrix4fv(program.viewProjection, false, viewProjection);
          gl.uniform4fv(program.cameraWorldPosition, this.#cameraPosition);
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
              throw new Error("Royal studio-environment program is missing canonical state");
            }
            gl.uniformMatrix4fv(program.environmentRotation, false, environment.rotation);
            this.#environmentSettings[0] = environment.radianceScaleNits;
            gl.uniform4fv(program.environmentSettings, this.#environmentSettings);
          }
          this.#presentation[0] = scene.exposure;
          this.#presentation[1] = scene.toneMapping === "pbr-neutral" ? 1 : 0;
          gl.uniform4fv(program.presentation, this.#presentation);
          standardGlobalsProgram = program.program;
        }
        gl.uniformMatrix4fv(program.model, false, surface.model);
        gl.uniformMatrix4fv(program.normalTransform, false, surface.normalTransform);
        if (materialChanged) {
          gl.uniform4fv(program.baseColor, material.baseColor);
          applyTextureCoordinates(
            gl,
            program.textureCoordinates,
            material.baseColorTextureCoordinates,
          );
          applyTextureCoordinates(
            gl,
            program.metallicRoughnessCoordinates,
            material.metallicRoughnessTextureCoordinates,
          );
          applyTextureCoordinates(
            gl,
            program.normalTextureCoordinates,
            material.normalTextureCoordinates,
          );
          applyTextureCoordinates(
            gl,
            program.emissiveCoordinates,
            material.emissiveTextureCoordinates,
          );
          applyTextureCoordinates(
            gl,
            program.occlusionCoordinates,
            material.occlusionTextureCoordinates,
          );
          if (program.occlusionStrength !== null) {
            gl.uniform1f(program.occlusionStrength, material.occlusionStrength);
          }
          this.#emissiveFactor[0] = material.emissiveFactor[0];
          this.#emissiveFactor[1] = material.emissiveFactor[1];
          this.#emissiveFactor[2] = material.emissiveFactor[2];
          this.#emissiveFactor[3] = 0;
          gl.uniform4fv(program.emissiveFactor, this.#emissiveFactor);
          this.#materialFactors[0] = material.metallicFactor;
          this.#materialFactors[1] = material.roughnessFactor;
          this.#materialFactors[2] = program.alphaMasked ? material.alphaCutoff ?? 0.5 : 0;
          this.#materialFactors[3] = material.normalScale;
          gl.uniform4fv(program.materialFactors, this.#materialFactors);
        }
      }
      materialProgram = program.program;
      materialSource = surface.materialSource;
      if (resource.instanceCount > 0) {
        gl.drawElementsInstanced(
          gl.TRIANGLES,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          resource.geometry.indexOffset,
          resource.instanceCount,
        );
      } else {
        gl.drawElements(
          gl.TRIANGLES,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          resource.geometry.indexOffset,
        );
      }
    }
    return this.#dirty;
  }

  #reconcile(): void {
    this.#dirty = false;
    const scene = this.#scene;
    const surfaces = scene?.surfaces ?? [];
    const admittedSurfaceCount = nextSurfaceAdmissionCount(
      this.#admittedSurfaceCount,
      surfaces.length,
      SURFACE_UPLOADS_PER_FRAME,
    );
    const geometryPlan = this.#geometryGpu.prepare(surfaces, admittedSurfaceCount);
    try {
      const programs = Array<StandardProgram | UnlitProgram>(geometryPlan.surfaces.length);
      const textureUnitMasks = Array<number>(geometryPlan.surfaces.length);
      const textureInputs = Array<CanonicalTextureBinding | undefined>(
        geometryPlan.surfaces.length * MATERIAL_TEXTURE_UNITS,
      );
      for (let index = 0; index < geometryPlan.surfaces.length; index += 1) {
        const geometrySurface = geometryPlan.surfaces[index]!;
        const material = geometrySurface.surface.material;
        const features = materialTextureFeatures(
          geometrySurface.surface,
          geometrySurface.geometry,
          scene?.environment !== undefined,
          (scene?.punctualLights.length ?? 0) > 0,
        );
        textureUnitMasks[index] = textureUnitMask(features);
        programs[index] = this.#programs.get(
          material.kind,
          features,
          geometrySurface.instanceCount > 0,
          material.alphaCutoff !== undefined,
          material.doubleSided === true,
        );
        const offset = index * MATERIAL_TEXTURE_UNITS;
        textureInputs[offset] = material.baseColorTexture;
        textureInputs[offset + 1] = material.kind === "standard"
          ? material.metallicRoughnessTexture
          : undefined;
        textureInputs[offset + 2] = material.kind === "standard"
          ? material.normalTexture
          : undefined;
        textureInputs[offset + 3] = material.kind === "standard"
          ? material.emissiveTexture
          : undefined;
        textureInputs[offset + 4] = material.kind === "standard"
          ? material.occlusionTexture
          : undefined;
      }
      const textureBindings = this.#textureGpu.reconcile(textureInputs);
      const nextSurfaces = Array<GpuSurface>(geometryPlan.surfaces.length);
      for (let index = 0; index < geometryPlan.surfaces.length; index += 1) {
        const geometrySurface = geometryPlan.surfaces[index]!;
        const offset = index * MATERIAL_TEXTURE_UNITS;
        const bindings = [
          textureBindings[offset]!,
          textureBindings[offset + 1]!,
          textureBindings[offset + 2]!,
          textureBindings[offset + 3]!,
          textureBindings[offset + 4]!,
        ];
        nextSurfaces[index] = {
          bindings,
          geometry: geometrySurface.geometry,
          instanceCount: geometrySurface.instanceCount,
          program: programs[index]!,
          sceneIndex: index,
          surface: geometrySurface.surface,
          textureUnits: textureUnitMasks[index]!,
          vertexArray: geometrySurface.vertexArray,
        };
      }
      geometryPlan.commit();
      this.#admittedSurfaceCount = admittedSurfaceCount;
      this.#gpuSurfaces = groupSurfacesByProgram(nextSurfaces);
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
    this.#dirty = this.#admittedSurfaceCount < surfaces.length;
    this.#drawIntent = null;
  }

  #reconcileTexturePublications(): void {
    const scene = this.#scene;
    if (scene === null) return;
    const nextSurfaces = this.#gpuSurfaces.slice();
    for (let index = 0; index < nextSurfaces.length; index += 1) {
      const previous = nextSurfaces[index]!;
      const surface = scene.surfaces[previous.sceneIndex]!;
      let affected = false;
      for (const key of surface.textureKeys) {
        if (this.#texturePublicationKeys.has(key)) {
          affected = true;
          break;
        }
      }
      if (!affected) continue;
      const material = surface.material;
      const bindings = [
        this.#textureGpu.retain(material.baseColorTexture),
        this.#textureGpu.retain(material.kind === "standard"
          ? material.metallicRoughnessTexture
          : undefined),
        this.#textureGpu.retain(material.kind === "standard"
          ? material.normalTexture
          : undefined),
        this.#textureGpu.retain(material.kind === "standard"
          ? material.emissiveTexture
          : undefined),
        this.#textureGpu.retain(material.kind === "standard"
          ? material.occlusionTexture
          : undefined),
      ];
      const features = materialTextureFeatures(
        surface,
        previous.geometry,
        scene.environment !== undefined,
        scene.punctualLights.length > 0,
      );
      nextSurfaces[index] = {
        ...previous,
        bindings,
        program: this.#programs.get(
          material.kind,
          features,
          previous.instanceCount > 0,
          material.alphaCutoff !== undefined,
          material.doubleSided === true,
        ),
        surface,
        textureUnits: textureUnitMask(features),
      };
    }
    this.#gpuSurfaces = groupSurfacesByProgram(nextSurfaces);
    this.#texturePublicationKeys.clear();
    this.#dirty = false;
    this.#drawIntent = null;
  }
}
