import {
  cameraWorldPositionFromViewInto,
  identityMat4,
  multiplyMat4Into,
  type Mat4,
  type MutableMat4,
} from "../math/mat4";
import type { FrameViewport } from "../frame/clear-frame";
import type { WebGlStateOwner } from "../webgl/state-owner";
import type { SurfaceDrawStateIntent } from "../webgl/draw-state-transition";
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
  SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE,
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
  maximumProjectedBoundsScreenCoverage,
} from "./lod-selection";
import type {
  VirtualTextureGpuBinding,
  VirtualTextureRuntime,
} from "../virtual-texture/runtime-contract";

export type SurfaceFrameView = Readonly<{
  view: Mat4;
  viewProjection: Mat4;
  viewport: FrameViewport;
}>;

type GpuSurface = {
  bindings: readonly GpuTextureBinding[];
  readonly geometry: GpuGeometry;
  readonly instanceCount: number;
  program: StandardProgram | UnlitProgram;
  surface: CanonicalDrawSurface;
  textureUnits: number;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly virtualTexture?: VirtualTextureGpuBinding;
};

type MutableSurfaceDrawIntent = {
  alphaBlend: boolean;
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
const NEUTRAL_PERCEPTUAL_GREY = new Float32Array([0.214_041, 0.214_041, 0.214_041, 1]);
const EMPTY_TEXTURE_BINDING: GpuTextureBinding = { sampler: null, texture: null };

const composeSurfaceTextureBindings = (
  ordinary: readonly GpuTextureBinding[],
  offset: number,
  virtualTexture: VirtualTextureGpuBinding | undefined,
): GpuTextureBinding[] => {
  const bindings = [
    ordinary[offset]!,
    ordinary[offset + 1]!,
    ordinary[offset + 2]!,
    ordinary[offset + 3]!,
    ordinary[offset + 4]!,
    EMPTY_TEXTURE_BINDING,
  ];
  if (virtualTexture !== undefined) {
    bindings[0] = virtualTexture.atlas;
    bindings[5] = virtualTexture.pageTable;
  }
  return bindings;
};

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

const materialTextureFeatures = (
  surface: CanonicalDrawSurface,
  geometry: GpuGeometry,
  hasStudioEnvironment: boolean,
  hasPunctualLights: boolean,
  hasVirtualBaseColor: boolean,
): number => {
  let features = surface.material.baseColorTexture === undefined
    ? 0
    : SURFACE_FEATURE_BASE_COLOR_TEXTURE;
  if (hasVirtualBaseColor) features |= SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE;
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
) | (features & SURFACE_FEATURE_OCCLUSION_TEXTURE ? 0b1_0000 : 0)
  | (features & SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE ? 0b10_0001 : 0);

type GroupedSurfaces = Readonly<{
  blended: GpuSurface[];
  opaque: readonly GpuSurface[];
}>;

const groupSurfacesForDrawing = (surfaces: readonly GpuSurface[]): GroupedSurfaces => {
  const groups = new Map<WebGLProgram, Map<CanonicalSurfaceMaterial, GpuSurface[]>>();
  const blended: GpuSurface[] = [];
  let materialGroupCount = 0;
  for (const resource of surfaces) {
    if (resource.surface.material.alphaBlend === true) {
      blended.push(resource);
      continue;
    }
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
  const opaqueCount = surfaces.length - blended.length;
  if (materialGroupCount < 2) {
    if (blended.length === 0) return { blended, opaque: surfaces };
    const opaque = Array<GpuSurface>(opaqueCount);
    let opaqueIndex = 0;
    for (const resource of surfaces) {
      if (resource.surface.material.alphaBlend !== true) {
        opaque[opaqueIndex] = resource;
        opaqueIndex += 1;
      }
    }
    return { blended, opaque };
  }
  const grouped = Array<GpuSurface>(opaqueCount);
  let index = 0;
  for (const materialGroups of groups.values()) {
    for (const group of materialGroups.values()) {
      for (const resource of group) {
        grouped[index] = resource;
        index += 1;
      }
    }
  }
  return { blended, opaque: grouped };
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

/** Coordinates one context generation's program, geometry, texture, and draw-state owners. */
export class SurfaceGpuOwner {
  #admittedSurfaceCount = 0;
  readonly #cameraPosition = new Float32Array(4);
  readonly #directionalLightColors = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  readonly #directionalLightDirections = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  #directionalLightCount = 0;
  #dirty = false;
  #drawIntent: MutableSurfaceDrawIntent | null = null;
  readonly #geometryGpu: SurfaceGeometryGpuOwner;
  readonly #frustumPlanes = new Float32Array(24);
  readonly #gl: WebGL2RenderingContext;
  #opaqueSurfaces: readonly GpuSurface[] = [];
  #blendedSurfaces: GpuSurface[] = [];
  #blendedDepths = new Float64Array(0);
  #gpuSurfacesBySceneIndex: readonly GpuSurface[] = [];
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
  #virtualTexture: VirtualTextureRuntime | null = null;
  #virtualTextureBindingRevision = -1;

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
    this.#virtualTexture?.dispose();
    this.#drawIntent = null;
    this.#admittedSurfaceCount = 0;
    this.#scene = null;
    this.#texturePublicationKeys.clear();
    this.#lodGroups.clear();
    this.#lodSelections.clear();
  }

  invalidate(): void {
    this.#geometryGpu.invalidate();
    this.#opaqueSurfaces = [];
    this.#blendedSurfaces = [];
    this.#blendedDepths = new Float64Array(0);
    this.#gpuSurfacesBySceneIndex = [];
    this.#textureGpu.invalidate();
    this.#programs.invalidate();
    this.#virtualTexture?.invalidate();
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
    this.#virtualTexture?.setScene(scene);
  }

  setVirtualTextureRuntime(runtime: VirtualTextureRuntime | null): void {
    if (this.#virtualTexture === runtime) return;
    this.#virtualTexture?.dispose();
    this.#virtualTexture = runtime;
    this.#virtualTextureBindingRevision = runtime?.bindingRevision ?? -1;
    this.#programs.setVirtualTextureDeclarations(runtime?.shaderSource.declarations ?? "");
    runtime?.setScene(this.#scene);
    this.#dirty = true;
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

  drawViews(
    views: readonly SurfaceFrameView[],
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
  ): boolean {
    let virtualTexturePending = false;
    if (this.#virtualTexture !== null) {
      const update = this.#virtualTexture.update(views);
      virtualTexturePending = update.pending;
      if (update.webGlStateChanged) state.invalidateTextureBindings();
      if (this.#virtualTextureBindingRevision !== this.#virtualTexture.bindingRevision) {
        this.#virtualTextureBindingRevision = this.#virtualTexture.bindingRevision;
        this.#dirty = true;
      }
    }
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
    if (
      scene === null
      || this.#opaqueSurfaces.length + this.#blendedSurfaces.length === 0
    ) return this.#dirty;
    this.#selectLods(views, scene);
    for (const view of views) this.#drawView(view, framebuffer, state, scene);
    return this.#dirty || virtualTexturePending;
  }

  #drawView(
    frameView: SurfaceFrameView,
    framebuffer: WebGLFramebuffer | null,
    state: WebGlStateOwner,
    scene: CanonicalSurfaceScene,
  ): void {
    let drawIntent = this.#drawIntent;
    if (drawIntent === null) {
      const firstSurface = this.#opaqueSurfaces[0] ?? this.#blendedSurfaces[0]!;
      const first = firstSurface.program;
      drawIntent = {
        alphaBlend: firstSurface.surface.material.alphaBlend === true,
        cullBackFaces: firstSurface.surface.material.doubleSided !== true,
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
    let standardGlobalsProgram: WebGLProgram | null = null;
    const gl = this.#gl;
    frustumPlanesInto(this.#frustumPlanes, viewProjection);
    this.#sortBlendedSurfaces(view);
    const opaqueCount = this.#opaqueSurfaces.length;
    const surfaceCount = opaqueCount + this.#blendedSurfaces.length;
    for (let index = 0; index < surfaceCount; index += 1) {
      const resource = index < opaqueCount
        ? this.#opaqueSurfaces[index]!
        : this.#blendedSurfaces[index - opaqueCount]!;
      const surface = resource.surface;
      if (!surfaceMatchesLodSelections(surface, this.#lodSelections)) continue;
      if (!worldBoundsVisible(surface.worldBounds, this.#frustumPlanes)) continue;
      const program = resource.program;
      drawIntent.alphaBlend = surface.material.alphaBlend === true;
      drawIntent.cullBackFaces = surface.material.doubleSided !== true;
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
      const materialChanged = programChanged
        || materialSource !== surface.materialSource;
      if (programChanged) {
        baseColorCoordinates = undefined;
        emissiveCoordinates = undefined;
        metallicRoughnessCoordinates = undefined;
        normalCoordinates = undefined;
        occlusionCoordinates = undefined;
      }
      if (program.kind === "unlit") {
        multiplyMat4Into(this.#viewProjectionModel, viewProjection, surface.model);
        gl.uniformMatrix4fv(program.viewProjectionModel, false, this.#viewProjectionModel);
        if (materialChanged) {
          gl.uniform4fv(
            program.color,
            surface.material.baseColorVirtualAsset !== undefined
              && resource.virtualTexture === undefined
              ? NEUTRAL_PERCEPTUAL_GREY
              : surface.material.baseColor,
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
          gl.uniform4fv(
            program.baseColor,
            material.baseColorVirtualAsset !== undefined && resource.virtualTexture === undefined
              ? NEUTRAL_PERCEPTUAL_GREY
              : material.baseColor,
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
          this.#applyVirtualTexture(program, resource.virtualTexture);
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
  }

  #sortBlendedSurfaces(view: Mat4): void {
    const surfaces = this.#blendedSurfaces;
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
        if (surfaceMatchesLodSelections(candidate.surface, this.#lodSelections)) {
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
        const virtualTexture = material.baseColorVirtualAsset === undefined
          ? undefined
          : this.#virtualTexture?.binding(material.baseColorVirtualAsset);
        const features = materialTextureFeatures(
          geometrySurface.surface,
          geometrySurface.geometry,
          scene?.environment !== undefined,
          (scene?.punctualLights.length ?? 0) > 0,
          virtualTexture !== undefined,
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
        const virtualTexture = geometrySurface.surface.material.baseColorVirtualAsset === undefined
          ? undefined
          : this.#virtualTexture?.binding(geometrySurface.surface.material.baseColorVirtualAsset);
        nextSurfaces[index] = {
          bindings: composeSurfaceTextureBindings(textureBindings, offset, virtualTexture),
          geometry: geometrySurface.geometry,
          instanceCount: geometrySurface.instanceCount,
          program: programs[index]!,
          surface: geometrySurface.surface,
          textureUnits: textureUnitMasks[index]!,
          vertexArray: geometrySurface.vertexArray,
          ...(virtualTexture === undefined ? {} : { virtualTexture }),
        };
      }
      geometryPlan.commit();
      this.#admittedSurfaceCount = admittedSurfaceCount;
      this.#gpuSurfacesBySceneIndex = nextSurfaces;
      const grouped = groupSurfacesForDrawing(nextSurfaces);
      this.#opaqueSurfaces = grouped.opaque;
      this.#blendedSurfaces = grouped.blended;
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
    const scene = this.#scene!;
    const surfaces = this.#gpuSurfacesBySceneIndex;
    let regroup = false;
    for (const key of this.#texturePublicationKeys) {
      const indices = scene.textureSurfaceIndices.get(key);
      if (indices === undefined) continue;
      for (const index of indices) {
        if (index >= surfaces.length) continue;
        const resource = surfaces[index]!;
        const surface = scene.surfaces[index]!;
        const material = surface.material;
        const ordinaryBindings = [
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
          resource.geometry,
          scene.environment !== undefined,
          scene.punctualLights.length > 0,
          resource.virtualTexture !== undefined,
        );
        const program = this.#programs.get(
          material.kind,
          features,
          resource.instanceCount > 0,
          material.alphaCutoff !== undefined,
          material.doubleSided === true,
        );
        regroup ||= program.program !== resource.program.program;
        resource.bindings = composeSurfaceTextureBindings(
          ordinaryBindings,
          0,
          resource.virtualTexture,
        );
        resource.program = program;
        resource.surface = surface;
        resource.textureUnits = textureUnitMask(features);
      }
    }
    if (regroup) {
      const grouped = groupSurfacesForDrawing(surfaces);
      this.#opaqueSurfaces = grouped.opaque;
      this.#blendedSurfaces = grouped.blended;
    }
    this.#texturePublicationKeys.clear();
    this.#dirty = false;
    this.#drawIntent = null;
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
}
