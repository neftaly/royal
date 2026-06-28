import {
  type BoxGeometry,
} from "@royal/renderer-core";
import { boxGeometryData } from "./geometry-data/box";
import { createFloatBuffer, createIndexBuffer, type RendererWebGlContext } from "./gl";

export interface BoxGeometryBuffers {
  readonly index: WebGLBuffer;
  readonly indexCount: number;
  readonly normal: WebGLBuffer;
  readonly position: WebGLBuffer;
}

export interface WireframeBoxGeometryBuffers {
  readonly barycentric: WebGLBuffer;
  readonly position: WebGLBuffer;
  readonly vertexCount: number;
}

export class GeometryCache {
  readonly #box = new WeakMap<BoxGeometry, BoxGeometryBuffers>();
  readonly #boxWireframe = new WeakMap<BoxGeometry, WireframeBoxGeometryBuffers>();
  readonly #buffers = new Set<WebGLBuffer>();
  readonly #gl: RendererWebGlContext;

  constructor(gl: RendererWebGlContext) {
    this.#gl = gl;
  }

  box(geometry: BoxGeometry): BoxGeometryBuffers {
    const cached = this.#box.get(geometry);
    if (cached !== undefined) return cached;

    const data = boxGeometryData(geometry);
    const buffers = {
      index: this.#track(createIndexBuffer(this.#gl, data.indices)),
      indexCount: data.indices.length,
      normal: this.#track(createFloatBuffer(this.#gl, data.normals)),
      position: this.#track(createFloatBuffer(this.#gl, data.positions)),
    };

    this.#box.set(geometry, buffers);
    return buffers;
  }

  boxWireframe(geometry: BoxGeometry): WireframeBoxGeometryBuffers {
    const cached = this.#boxWireframe.get(geometry);
    if (cached !== undefined) return cached;

    const data = boxGeometryData(geometry);
    const positions = new Float32Array(data.indices.length * 3);
    const barycentric = new Float32Array(data.indices.length * 3);

    for (let indexOffset = 0; indexOffset < data.indices.length; indexOffset += 1) {
      const vertexIndex = data.indices[indexOffset];
      if (vertexIndex === undefined) {
        throw new Error(`Wireframe index out of range: ${indexOffset}`);
      }

      const sourceOffset = vertexIndex * 3;
      const targetOffset = indexOffset * 3;
      positions[targetOffset] = data.positions[sourceOffset] ?? 0;
      positions[targetOffset + 1] = data.positions[sourceOffset + 1] ?? 0;
      positions[targetOffset + 2] = data.positions[sourceOffset + 2] ?? 0;
      barycentric[targetOffset + (indexOffset % 3)] = 1;
    }

    const buffers = {
      barycentric: this.#track(createFloatBuffer(this.#gl, barycentric)),
      position: this.#track(createFloatBuffer(this.#gl, positions)),
      vertexCount: data.indices.length,
    };

    this.#boxWireframe.set(geometry, buffers);
    return buffers;
  }

  dispose(): void {
    for (const buffer of this.#buffers) {
      this.#gl.deleteBuffer(buffer);
    }
    this.#buffers.clear();
  }

  #track(buffer: WebGLBuffer): WebGLBuffer {
    this.#buffers.add(buffer);
    return buffer;
  }
}
