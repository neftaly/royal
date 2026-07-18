import {
  affineSurfaceNormalTransformInto,
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

type GpuGeometry = Readonly<{
  indexBuffer: WebGLBuffer;
  indexCount: number;
  indexType: number;
  key: string;
  normalBuffer: WebGLBuffer | null;
  tangentBuffer: WebGLBuffer | null;
  textureCoordinateBuffer: WebGLBuffer | null;
  vertexArray: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
}>;

type GpuSurface = Readonly<{
  bindings: readonly GpuTextureBinding[];
  geometry: GpuGeometry;
  instanceCount: number;
  surface: CanonicalDrawSurface;
  vertexArray: WebGLVertexArrayObject;
}>;

type GpuInstanceData = Readonly<{
  buffer: WebGLBuffer;
  count: number;
  key: string;
}>;

type GpuInstanceVertexArray = Readonly<{
  key: string;
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

const indexType = (
  gl: WebGL2RenderingContext,
  indices: Uint8Array | Uint16Array | Uint32Array,
): number => indices instanceof Uint32Array
  ? gl.UNSIGNED_INT
  : indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE;

const MATERIAL_TEXTURE_UNITS = 5;

const materialTextureFeatures = (surface: GpuSurface): number => {
  let features = surface.bindings[0]!.texture === null ? 0 : 1;
  if (surface.surface.material.kind !== "standard") return features;
  if (surface.bindings[1]!.texture !== null) features |= 2;
  if (surface.bindings[2]!.texture !== null) features |= 4;
  if ((features & 4) !== 0 && surface.geometry.tangentBuffer !== null) features |= 16;
  if (surface.bindings[4]!.texture !== null) features |= 8;
  return features;
};

/** Owns surface programs and geometry allocations for one context generation. */
export class SurfaceGpuOwner {
  readonly #cameraPosition = new Float32Array(4);
  readonly #directionalLightColors = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  readonly #directionalLightDirections = new Float32Array(MAX_CANONICAL_DIRECTIONAL_LIGHTS * 4);
  #directionalLightCount = 0;
  #dirty = false;
  #drawIntent: MutableOpaqueDrawIntent | null = null;
  readonly #gl: WebGL2RenderingContext;
  #geometryResources: readonly GpuGeometry[] = [];
  #gpuSurfaces: readonly GpuSurface[] = [];
  #instanceResources: readonly GpuInstanceData[] = [];
  #instanceVertexArrays: readonly GpuInstanceVertexArray[] = [];
  readonly #materialFactors = new Float32Array(4);
  readonly #emissiveFactor = new Float32Array(4);
  readonly #normalTransform: MutableMat4 = identityMat4();
  readonly #programs: SurfaceProgramOwner;
  #scene: CanonicalSurfaceScene | null = null;
  readonly #textureGpu: TextureGpuOwner;
  readonly #viewProjectionModel: MutableMat4 = identityMat4();

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
    this.#programs = new SurfaceProgramOwner(gl);
    this.#textureGpu = new TextureGpuOwner(gl);
  }

  dispose(): void {
    this.#deleteResources();
    this.#textureGpu.dispose();
    this.#programs.dispose();
    this.#drawIntent = null;
    this.#scene = null;
  }

  invalidate(): void {
    this.#geometryResources = [];
    this.#gpuSurfaces = [];
    this.#instanceResources = [];
    this.#instanceVertexArrays = [];
    this.#textureGpu.invalidate();
    this.#programs.invalidate();
    this.#drawIntent = null;
    this.#dirty = this.#scene !== null;
  }

  setScene(scene: CanonicalSurfaceScene | null): void {
    if (this.#scene === scene) return;
    this.#scene = scene;
    this.#dirty = true;
  }

  draw(
    viewProjection: Mat4,
    view: Mat4,
    size: ResolvedCanvasSize,
    state: WebGlStateOwner,
  ): void {
    if (this.#dirty) {
      try {
        this.#reconcile();
      } finally {
        state.invalidateVertexArray();
        state.invalidateTextureBindings();
      }
    }
    const scene = this.#scene;
    if (scene === null || this.#gpuSurfaces.length === 0) return;
    let drawIntent = this.#drawIntent;
    if (drawIntent === null) {
      const firstSurface = this.#gpuSurfaces[0]!;
      const first = this.#programFor(
        firstSurface.surface.material.kind,
        materialTextureFeatures(firstSurface),
        firstSurface.instanceCount > 0,
        firstSurface.surface.material.alphaCutoff !== undefined,
        firstSurface.surface.material.doubleSided === true,
      );
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
      const program = this.#programFor(
        surface.material.kind,
        materialTextureFeatures(resource),
        resource.instanceCount > 0,
        surface.material.alphaCutoff !== undefined,
        surface.material.doubleSided === true,
      );
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
      if (program.kind === "unlit") {
        multiplyMat4Into(this.#viewProjectionModel, viewProjection, surface.model);
        gl.uniformMatrix4fv(program.viewProjectionModel, false, this.#viewProjectionModel);
        gl.uniform4fv(program.color, surface.material.baseColor);
        if (program.alphaCutoff !== null) {
          gl.uniform1f(program.alphaCutoff, surface.material.alphaCutoff ?? 0.5);
        }
        if (program.texture !== null) gl.uniform1i(program.texture, 0);
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
        affineSurfaceNormalTransformInto(this.#normalTransform, surface.model);
        gl.uniformMatrix4fv(program.normalTransform, false, this.#normalTransform);
        gl.uniform4fv(program.baseColor, material.baseColor);
        if (program.texture !== null) gl.uniform1i(program.texture, 0);
        if (program.metallicRoughness !== null) gl.uniform1i(program.metallicRoughness, 1);
        if (program.normalTexture !== null) gl.uniform1i(program.normalTexture, 2);
        if (program.emissive !== null) gl.uniform1i(program.emissive, 4);
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
  }

  #deleteGeometry(resource: GpuGeometry): void {
    this.#gl.deleteBuffer(resource.indexBuffer);
    if (resource.normalBuffer !== null) this.#gl.deleteBuffer(resource.normalBuffer);
    if (resource.tangentBuffer !== null) this.#gl.deleteBuffer(resource.tangentBuffer);
    if (resource.textureCoordinateBuffer !== null) {
      this.#gl.deleteBuffer(resource.textureCoordinateBuffer);
    }
    this.#gl.deleteBuffer(resource.vertexBuffer);
    this.#gl.deleteVertexArray(resource.vertexArray);
  }

  #deleteResources(): void {
    for (const resource of this.#instanceVertexArrays) {
      this.#gl.deleteVertexArray(resource.vertexArray);
    }
    for (const resource of this.#instanceResources) this.#gl.deleteBuffer(resource.buffer);
    for (const resource of this.#geometryResources) this.#deleteGeometry(resource);
    this.#geometryResources = [];
    this.#gpuSurfaces = [];
    this.#instanceResources = [];
    this.#instanceVertexArrays = [];
  }

  #createGeometry(surface: CanonicalDrawSurface, key: string): GpuGeometry {
    const gl = this.#gl;
    const normals = surface.material.kind === "standard" ? surface.geometry.normals : undefined;
    const tangents = surface.material.kind === "standard"
      && surface.material.normalAsset !== undefined
      ? surface.geometry.tangents
      : undefined;
    const textureCoordinates = surface.material.requiresTextureCoordinates
      ? surface.geometry.textureCoordinates0
      : undefined;
    if (surface.material.requiresTextureCoordinates && textureCoordinates === undefined) {
      throw new Error("Royal textured surface requires TEXCOORD_0 geometry");
    }
    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const normalBuffer = normals === undefined ? null : gl.createBuffer();
    const tangentBuffer = tangents === undefined ? null : gl.createBuffer();
    const textureCoordinateBuffer = textureCoordinates === undefined ? null : gl.createBuffer();
    if (
      vertexArray === null
      || vertexBuffer === null
      || indexBuffer === null
      || (normals !== undefined && normalBuffer === null)
      || (tangents !== undefined && tangentBuffer === null)
      || (textureCoordinates !== undefined && textureCoordinateBuffer === null)
    ) {
      if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
      if (vertexBuffer !== null) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer !== null) gl.deleteBuffer(indexBuffer);
      if (normalBuffer !== null) gl.deleteBuffer(normalBuffer);
      if (tangentBuffer !== null) gl.deleteBuffer(tangentBuffer);
      if (textureCoordinateBuffer !== null) gl.deleteBuffer(textureCoordinateBuffer);
      throw new Error("Royal could not allocate surface geometry");
    }
    try {
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, surface.geometry.positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (normals === undefined) {
        gl.disableVertexAttribArray(1);
        gl.vertexAttrib3f(1, 0, 0, 0);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      }
      if (textureCoordinates === undefined) {
        gl.disableVertexAttribArray(2);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordinateBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, textureCoordinates, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      }
      if (tangents === undefined) {
        gl.disableVertexAttribArray(10);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, tangentBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, tangents, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(10);
        gl.vertexAttribPointer(10, 4, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, surface.geometry.indices, gl.STATIC_DRAW);
      return {
        indexBuffer,
        indexCount: surface.geometry.indices.length,
        indexType: indexType(gl, surface.geometry.indices),
        key,
        normalBuffer,
        tangentBuffer,
        textureCoordinateBuffer,
        vertexArray,
        vertexBuffer,
      };
    } catch (error) {
      gl.deleteBuffer(indexBuffer);
      if (normalBuffer !== null) gl.deleteBuffer(normalBuffer);
      if (tangentBuffer !== null) gl.deleteBuffer(tangentBuffer);
      if (textureCoordinateBuffer !== null) gl.deleteBuffer(textureCoordinateBuffer);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteVertexArray(vertexArray);
      throw error;
    }
  }

  #createInstanceData(surface: CanonicalDrawSurface): GpuInstanceData {
    const instances = surface.instances;
    if (
      instances === undefined
      || !Number.isSafeInteger(instances.count)
      || instances.count < 1
      || instances.localModels.length !== instances.count * 16
    ) throw new Error("Royal instanced surface has invalid matrix storage");
    const values = new Float32Array(instances.count * 28);
    const model = identityMat4();
    const normal = identityMat4();
    for (let instance = 0; instance < instances.count; instance += 1) {
      const sourceOffset = instance * 16;
      const targetOffset = instance * 28;
      for (let component = 0; component < 16; component += 1) {
        const value = instances.localModels[sourceOffset + component];
        if (value === undefined || !Number.isFinite(value)) {
          throw new Error(`Royal instance ${instance} matrix is not finite`);
        }
        model[component] = value;
        values[targetOffset + component] = value;
      }
      affineSurfaceNormalTransformInto(normal, model);
      for (let column = 0; column < 3; column += 1) {
        const normalSource = column * 4;
        const normalTarget = targetOffset + 16 + column * 4;
        values[normalTarget] = normal[normalSource]!;
        values[normalTarget + 1] = normal[normalSource + 1]!;
        values[normalTarget + 2] = normal[normalSource + 2]!;
        values[normalTarget + 3] = column === 2 ? normal[15] : 0;
      }
    }
    const buffer = this.#gl.createBuffer();
    if (buffer === null) throw new Error("Royal could not allocate instance transforms");
    try {
      this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, buffer);
      this.#gl.bufferData(this.#gl.ARRAY_BUFFER, values, this.#gl.STATIC_DRAW);
      return { buffer, count: instances.count, key: instances.key };
    } catch (error) {
      this.#gl.deleteBuffer(buffer);
      throw error;
    }
  }

  #createInstanceVertexArray(
    geometry: GpuGeometry,
    instances: GpuInstanceData,
    key: string,
  ): GpuInstanceVertexArray {
    const gl = this.#gl;
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) throw new Error("Royal could not allocate an instanced vertex array");
    try {
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.vertexBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (geometry.normalBuffer === null) {
        gl.disableVertexAttribArray(1);
        gl.vertexAttrib3f(1, 0, 0, 0);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normalBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      }
      if (geometry.textureCoordinateBuffer === null) {
        gl.disableVertexAttribArray(2);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.textureCoordinateBuffer);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      }
      if (geometry.tangentBuffer === null) {
        gl.disableVertexAttribArray(10);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.tangentBuffer);
        gl.enableVertexAttribArray(10);
        gl.vertexAttribPointer(10, 4, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, instances.buffer);
      const stride = 28 * 4;
      for (let column = 0; column < 4; column += 1) {
        const location = 3 + column;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, column * 16);
        gl.vertexAttribDivisor(location, 1);
      }
      for (let column = 0; column < 3; column += 1) {
        const location = 7 + column;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(
          location,
          column === 2 ? 4 : 3,
          gl.FLOAT,
          false,
          stride,
          64 + column * 16,
        );
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
      return { key, vertexArray };
    } catch (error) {
      gl.deleteVertexArray(vertexArray);
      throw error;
    }
  }

  #programFor(
    kind: "standard" | "unlit",
    features: number,
    instanced: boolean,
    alphaMasked: boolean,
    doubleSided: boolean,
  ): StandardProgram | UnlitProgram {
    return this.#programs.get(kind, features, instanced, alphaMasked, doubleSided);
  }

  #reconcile(): void {
    this.#dirty = false;
    const scene = this.#scene;
    if (scene === null || scene.surfaces.length === 0) {
      this.#deleteResources();
      this.#textureGpu.reconcile([]);
      this.#drawIntent = null;
      return;
    }
    this.#directionalLightColors.fill(0);
    this.#directionalLightDirections.fill(0);
    this.#directionalLightCount = scene.directionalLights.length;
    for (let index = 0; index < scene.directionalLights.length; index += 1) {
      const light = scene.directionalLights[index]!;
      const offset = index * 4;
      this.#directionalLightColors.set(light.color, offset);
      this.#directionalLightDirections.set(light.direction, offset);
    }
    const previousByKey = new Map(
      this.#geometryResources.map((resource) => [resource.key, resource] as const),
    );
    const previousInstancesByKey = new Map(
      this.#instanceResources.map((resource) => [resource.key, resource] as const),
    );
    const previousInstanceVaosByKey = new Map(
      this.#instanceVertexArrays.map((resource) => [resource.key, resource] as const),
    );
    const nextByKey = new Map<string, GpuGeometry>();
    const nextInstancesByKey = new Map<string, GpuInstanceData>();
    const nextInstanceVaosByKey = new Map<string, GpuInstanceVertexArray>();
    const nextGeometryResources: GpuGeometry[] = [];
    const nextInstanceResources: GpuInstanceData[] = [];
    const nextInstanceVertexArrays: GpuInstanceVertexArray[] = [];
    const pendingSurfaces: Array<Readonly<{
      geometry: GpuGeometry;
      instanceCount: number;
      surface: CanonicalDrawSurface;
      textureOffset: number;
      vertexArray: WebGLVertexArrayObject;
    }>> = [];
    const textureInputs: Array<CanonicalTextureBinding | undefined> = [];
    const nextSurfaces: GpuSurface[] = [];
    const createdGeometry: GpuGeometry[] = [];
    const createdInstances: GpuInstanceData[] = [];
    const createdInstanceVaos: GpuInstanceVertexArray[] = [];
    let textureBindings: readonly GpuTextureBinding[];
    try {
      for (const surface of scene.surfaces) {
        const geometryBaseKey = surface.material.kind === "standard"
          && surface.geometry.normals !== undefined
          ? `${surface.geometry.key}:normal`
          : `${surface.geometry.key}:position`;
        const tangentKey = surface.material.kind === "standard"
          && surface.material.normalAsset !== undefined
          && surface.geometry.tangents !== undefined
          ? "tangent"
          : "no-tangent";
        const key = `${geometryBaseKey}:${surface.material.requiresTextureCoordinates ? "uv0" : "no-uv"}:${tangentKey}`;
        let geometry = nextByKey.get(key) ?? previousByKey.get(key);
        if (geometry === undefined) {
          geometry = this.#createGeometry(surface, key);
          createdGeometry.push(geometry);
        }
        if (!nextByKey.has(key)) {
          nextByKey.set(key, geometry);
          nextGeometryResources.push(geometry);
        }
        let instanceCount = 0;
        let vertexArray = geometry.vertexArray;
        const instances = surface.instances;
        if (instances !== undefined) {
          let instanceData = nextInstancesByKey.get(instances.key)
            ?? previousInstancesByKey.get(instances.key);
          if (instanceData === undefined) {
            instanceData = this.#createInstanceData(surface);
            createdInstances.push(instanceData);
          }
          if (!nextInstancesByKey.has(instances.key)) {
            nextInstancesByKey.set(instances.key, instanceData);
            nextInstanceResources.push(instanceData);
          }
          const vaoKey = JSON.stringify([key, instances.key]);
          let instanceVao = nextInstanceVaosByKey.get(vaoKey)
            ?? previousInstanceVaosByKey.get(vaoKey);
          if (instanceVao === undefined) {
            instanceVao = this.#createInstanceVertexArray(geometry, instanceData, vaoKey);
            createdInstanceVaos.push(instanceVao);
          }
          if (!nextInstanceVaosByKey.has(vaoKey)) {
            nextInstanceVaosByKey.set(vaoKey, instanceVao);
            nextInstanceVertexArrays.push(instanceVao);
          }
          instanceCount = instanceData.count;
          vertexArray = instanceVao.vertexArray;
        }
        const material = surface.material;
        const textureOffset = textureInputs.length;
        textureInputs.push(
          material.baseColorTexture,
          material.kind === "standard" ? material.metallicRoughnessTexture : undefined,
          material.kind === "standard" ? material.normalTexture : undefined,
          material.kind === "standard" ? material.occlusionTexture : undefined,
          material.kind === "standard" ? material.emissiveTexture : undefined,
        );
        pendingSurfaces.push({
          geometry,
          instanceCount,
          surface,
          textureOffset,
          vertexArray,
        });
      }
      textureBindings = this.#textureGpu.reconcile(textureInputs);
    } catch (error) {
      for (const resource of createdInstanceVaos) this.#gl.deleteVertexArray(resource.vertexArray);
      for (const resource of createdInstances) this.#gl.deleteBuffer(resource.buffer);
      for (const resource of createdGeometry) this.#deleteGeometry(resource);
      throw error;
    }
    for (let index = 0; index < pendingSurfaces.length; index += 1) {
      const pending = pendingSurfaces[index]!;
      const offset = pending.textureOffset;
      nextSurfaces.push({
        bindings: [
          textureBindings[offset]!,
          textureBindings[offset + 1]!,
          textureBindings[offset + 2]!,
          textureBindings[offset + 3]!,
          textureBindings[offset + 4]!,
        ],
        geometry: pending.geometry,
        instanceCount: pending.instanceCount,
        surface: pending.surface,
        vertexArray: pending.vertexArray,
      });
    }
    for (const resource of this.#instanceVertexArrays) {
      if (nextInstanceVaosByKey.get(resource.key) !== resource) {
        this.#gl.deleteVertexArray(resource.vertexArray);
      }
    }
    for (const resource of this.#instanceResources) {
      if (nextInstancesByKey.get(resource.key) !== resource) this.#gl.deleteBuffer(resource.buffer);
    }
    for (const resource of this.#geometryResources) {
      if (nextByKey.get(resource.key) !== resource) this.#deleteGeometry(resource);
    }
    this.#geometryResources = nextGeometryResources;
    this.#gpuSurfaces = nextSurfaces;
    this.#instanceResources = nextInstanceResources;
    this.#instanceVertexArrays = nextInstanceVertexArrays;
    this.#drawIntent = null;
  }
}
