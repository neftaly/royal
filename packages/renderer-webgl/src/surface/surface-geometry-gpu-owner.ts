import {
  affineSurfaceNormalTransformInto,
  identityMat4,
} from "../math/mat4";
import type { CanonicalDrawSurface } from "./scene-lowering";
import { surfaceGeometryResourceKey } from "./gpu-admission";

export type GpuGeometry = Readonly<{
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

export type GpuGeometrySurface = Readonly<{
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

export type SurfaceGeometryPlan = Readonly<{
  commit: () => void;
  rollback: () => void;
  surfaces: readonly GpuGeometrySurface[];
}>;

const indexType = (
  gl: WebGL2RenderingContext,
  indices: Uint8Array | Uint16Array | Uint32Array,
): number => indices instanceof Uint32Array
  ? gl.UNSIGNED_INT
  : indices instanceof Uint16Array ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE;

/** Owns geometry buffers and vertex arrays for one context generation. */
export class SurfaceGeometryGpuOwner {
  readonly #gl: WebGL2RenderingContext;
  #geometryResources: readonly GpuGeometry[] = [];
  #instanceResources: readonly GpuInstanceData[] = [];
  #instanceVertexArrays: readonly GpuInstanceVertexArray[] = [];

  constructor(gl: WebGL2RenderingContext) {
    this.#gl = gl;
  }

  dispose(): void {
    this.#deleteResources();
  }

  invalidate(): void {
    this.#geometryResources = [];
    this.#instanceResources = [];
    this.#instanceVertexArrays = [];
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

  prepare(
    surfaces: readonly CanonicalDrawSurface[],
    admittedCount = surfaces.length,
  ): SurfaceGeometryPlan {
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
    const nextSurfaces: GpuGeometrySurface[] = [];
    const createdGeometry: GpuGeometry[] = [];
    const createdInstances: GpuInstanceData[] = [];
    const createdInstanceVaos: GpuInstanceVertexArray[] = [];
    try {
      for (let surfaceIndex = 0; surfaceIndex < admittedCount; surfaceIndex += 1) {
        const surface = surfaces[surfaceIndex]!;
        const key = surfaceGeometryResourceKey(surface);
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
        nextSurfaces.push({ geometry, instanceCount, surface, vertexArray });
      }
    } catch (error) {
      for (const resource of createdInstanceVaos) this.#gl.deleteVertexArray(resource.vertexArray);
      for (const resource of createdInstances) this.#gl.deleteBuffer(resource.buffer);
      for (const resource of createdGeometry) this.#deleteGeometry(resource);
      throw error;
    }

    let settled = false;
    return {
      commit: () => {
        if (settled) return;
        settled = true;
        for (const resource of this.#instanceVertexArrays) {
          if (nextInstanceVaosByKey.get(resource.key) !== resource) {
            this.#gl.deleteVertexArray(resource.vertexArray);
          }
        }
        for (const resource of this.#instanceResources) {
          if (nextInstancesByKey.get(resource.key) !== resource) {
            this.#gl.deleteBuffer(resource.buffer);
          }
        }
        for (const resource of this.#geometryResources) {
          if (nextByKey.get(resource.key) !== resource) this.#deleteGeometry(resource);
        }
        this.#geometryResources = nextGeometryResources;
        this.#instanceResources = nextInstanceResources;
        this.#instanceVertexArrays = nextInstanceVertexArrays;
      },
      rollback: () => {
        if (settled) return;
        settled = true;
        for (const resource of createdInstanceVaos) {
          this.#gl.deleteVertexArray(resource.vertexArray);
        }
        for (const resource of createdInstances) this.#gl.deleteBuffer(resource.buffer);
        for (const resource of createdGeometry) this.#deleteGeometry(resource);
      },
      surfaces: nextSurfaces,
    };
  }

}
