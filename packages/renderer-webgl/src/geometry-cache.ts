import {
  type BoxGeometry,
} from "@royal/renderer-core";
import { boxGeometryData } from "./geometry-data/box";
import { createFloatBuffer, createIndexBuffer } from "./gl";

export interface BoxGeometryBuffers {
  readonly index: WebGLBuffer;
  readonly indexCount: number;
  readonly normal: WebGLBuffer;
  readonly position: WebGLBuffer;
}

export class GeometryCache {
  readonly #box = new WeakMap<BoxGeometry, BoxGeometryBuffers>();
  readonly #buffers = new Set<WebGLBuffer>();
  readonly #gl: WebGLRenderingContext;

  constructor(gl: WebGLRenderingContext) {
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
