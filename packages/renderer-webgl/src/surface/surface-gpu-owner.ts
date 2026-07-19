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
  type CanonicalDrawSurface,
  type CanonicalSurfaceScene,
} from "./scene-lowering";
import type { CanonicalTextureBinding } from "./canonical-material";
import {
  SurfaceProgramOwner,
  type StandardProgram,
  type UnlitProgram,
} from "./surface-program-owner";
import {
  SurfaceGeometryGpuOwner,
  type GpuGeometry,
} from "./surface-geometry-gpu-owner";
import {
  nextSurfaceAdmissionCount,
  retainedSurfaceAdmissionCount,
} from "./gpu-admission";

type GpuSurface = Readonly<{
  bindings: readonly GpuTextureBinding[];
  geometry: GpuGeometry;
  instanceCount: number;
  program: StandardProgram | UnlitProgram;
  surface: CanonicalDrawSurface;
  vertexArray: WebGLVertexArrayObject;
}>;

type MutableOpaqueDrawIntent = {
  cullBackFaces: boolean;
  framebuffer: WebGLFramebuffer | null;
  frontFace: number;
  program: WebGLProgram;
  samplers: (WebGLSampler | null)[];
  textures: (WebGLTexture | null)[];
  vertexArray: WebGLVertexArrayObject;
  viewport: { height: number; width: number; x: number; y: number };
};

const MATERIAL_TEXTURE_UNITS = 5;
const SURFACE_UPLOADS_PER_FRAME = 16;

const materialTextureFeatures = (
  surface: CanonicalDrawSurface,
  geometry: GpuGeometry,
): number => {
  let features = surface.material.baseColorTexture === undefined ? 0 : 1;
  if (surface.material.kind !== "standard") return features;
  if (surface.material.metallicRoughnessTexture !== undefined) features |= 2;
  if (surface.material.normalTexture !== undefined) features |= 4;
  if ((features & 4) !== 0 && geometry.tangentBuffer !== null) features |= 16;
  if (surface.material.emissiveTexture !== undefined) features |= 8;
  return features;
};

const groupSurfacesByProgram = (surfaces: readonly GpuSurface[]): readonly GpuSurface[] => {
  const groups = new Map<WebGLProgram, GpuSurface[]>();
  for (const resource of surfaces) {
    const key = resource.program.program;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [resource]);
    else group.push(resource);
  }
  if (groups.size < 2) return surfaces;
  const grouped = Array<GpuSurface>(surfaces.length);
  let index = 0;
  for (const group of groups.values()) {
    for (const resource of group) {
      grouped[index] = resource;
      index += 1;
    }
  }
  return grouped;
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
  readonly #gl: WebGL2RenderingContext;
  #gpuSurfaces: readonly GpuSurface[] = [];
  readonly #materialFactors = new Float32Array(4);
  readonly #emissiveFactor = new Float32Array(4);
  readonly #programs: SurfaceProgramOwner;
  #scene: CanonicalSurfaceScene | null = null;
  readonly #textureGpu: TextureGpuOwner;
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
  }

  invalidate(): void {
    this.#geometryGpu.invalidate();
    this.#gpuSurfaces = [];
    this.#textureGpu.invalidate();
    this.#programs.invalidate();
    this.#drawIntent = null;
    this.#admittedSurfaceCount = 0;
    this.#dirty = this.#scene !== null;
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
  }

  draw(
    viewProjection: Mat4,
    view: Mat4,
    size: ResolvedCanvasSize,
    state: WebGlStateOwner,
  ): boolean {
    if (this.#dirty) {
      try {
        this.#reconcile();
      } finally {
        state.invalidateVertexArray();
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
        samplers: [null, null, null, null, null],
        textures: [null, null, null, null, null],
        vertexArray: firstSurface.vertexArray,
        viewport: { height: 0, width: 0, x: 0, y: 0 },
      };
      this.#drawIntent = drawIntent;
    }
    drawIntent.viewport.height = size.backingHeight;
    drawIntent.viewport.width = size.backingWidth;
    cameraWorldPositionFromViewInto(this.#cameraPosition, view);
    this.#cameraPosition[3] = 1;
    let standardGlobalsProgram: WebGLProgram | null = null;
    const gl = this.#gl;
    for (const resource of this.#gpuSurfaces) {
      const surface = resource.surface;
      const program = resource.program;
      drawIntent.cullBackFaces = surface.material.doubleSided !== true;
      drawIntent.frontFace = surface.modelHandedness < 0 ? gl.CW : gl.CCW;
      drawIntent.program = program.program;
      for (let unit = 0; unit < MATERIAL_TEXTURE_UNITS; unit += 1) {
        const binding = resource.bindings[unit]!;
        drawIntent.samplers[unit] = binding.sampler;
        drawIntent.textures[unit] = binding.texture;
      }
      drawIntent.vertexArray = resource.vertexArray;
      state.applyOpaqueDraw(drawIntent as OpaqueDrawStateIntent);
      this.#programs.initializeSamplers(program);
      if (program.kind === "unlit") {
        multiplyMat4Into(this.#viewProjectionModel, viewProjection, surface.model);
        gl.uniformMatrix4fv(program.viewProjectionModel, false, this.#viewProjectionModel);
        gl.uniform4fv(program.color, surface.material.baseColor);
        if (program.alphaCutoff !== null) {
          gl.uniform1f(program.alphaCutoff, surface.material.alphaCutoff ?? 0.5);
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
          this.#materialFactors[2] = scene.exposure;
          this.#materialFactors[3] = scene.toneMapping === "pbr-neutral" ? 1 : 0;
          gl.uniform4fv(program.presentation, this.#materialFactors);
          standardGlobalsProgram = program.program;
        }
        gl.uniformMatrix4fv(program.model, false, surface.model);
        gl.uniformMatrix4fv(program.normalTransform, false, surface.normalTransform);
        gl.uniform4fv(program.baseColor, material.baseColor);
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
      if (resource.instanceCount > 0) {
        gl.drawElementsInstanced(
          gl.TRIANGLES,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          0,
          resource.instanceCount,
        );
      } else {
        gl.drawElements(
          gl.TRIANGLES,
          resource.geometry.indexCount,
          resource.geometry.indexType,
          0,
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
      const textureInputs = Array<CanonicalTextureBinding | undefined>(
        geometryPlan.surfaces.length * MATERIAL_TEXTURE_UNITS,
      );
      for (let index = 0; index < geometryPlan.surfaces.length; index += 1) {
        const geometrySurface = geometryPlan.surfaces[index]!;
        const material = geometrySurface.surface.material;
        programs[index] = this.#programs.get(
          material.kind,
          materialTextureFeatures(geometrySurface.surface, geometrySurface.geometry),
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
          ? material.occlusionTexture
          : undefined;
        textureInputs[offset + 4] = material.kind === "standard"
          ? material.emissiveTexture
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
          surface: geometrySurface.surface,
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
    } else {
      this.#directionalLightCount = 0;
    }
    this.#dirty = this.#admittedSurfaceCount < surfaces.length;
    this.#drawIntent = null;
  }
}
