import { vectorTextMesh, type TextMesh, type VectorTextNode } from "@royal/renderer-core";
import { createFloatBuffer, createIndexBuffer } from "./gl";

export interface TextRenderAsset {
  readonly glyphCoord: WebGLBuffer;
  readonly index: WebGLBuffer;
  readonly indexCount: number;
  readonly position: WebGLBuffer;
}

export interface TextBufferData {
  readonly glyphCoord: Float32Array;
  readonly index: Uint16Array;
  readonly position: Float32Array;
}

export const textBufferDataFromMesh = (mesh: TextMesh): TextBufferData => {
  const glyphCoords: number[] = [];
  const positions: number[] = [];

  for (const vertex of mesh.vertices) {
    positions.push(...vertex.position);
    glyphCoords.push(...vertex.glyphCoord);
  }

  for (const index of mesh.indices) {
    if (!Number.isInteger(index) || index < 0 || index > 65535) {
      throw new Error("VectorText geometry exceeds uint16 index capacity");
    }
  }

  return {
    glyphCoord: new Float32Array(glyphCoords),
    index: new Uint16Array(mesh.indices),
    position: new Float32Array(positions),
  };
};

const createGeometry = (
  gl: WebGLRenderingContext,
  node: VectorTextNode,
): TextRenderAsset => {
  const data = textBufferDataFromMesh(vectorTextMesh(node));

  return {
    glyphCoord: createFloatBuffer(gl, data.glyphCoord),
    index: createIndexBuffer(gl, data.index),
    indexCount: data.index.length,
    position: createFloatBuffer(gl, data.position),
  };
};

export class TextCache {
  readonly #assets = new Map<VectorTextNode, TextRenderAsset>();
  readonly #buffers = new Set<WebGLBuffer>();
  readonly #gl: WebGLRenderingContext;
  readonly #liveNodes = new Set<VectorTextNode>();
  #frameActive = false;

  constructor(gl: WebGLRenderingContext) {
    this.#gl = gl;
  }

  beginFrame(): void {
    this.#liveNodes.clear();
    this.#frameActive = true;
  }

  get(node: VectorTextNode): TextRenderAsset {
    if (this.#frameActive) this.#liveNodes.add(node);

    const cached = this.#assets.get(node);
    if (cached !== undefined) return cached;

    const asset = createGeometry(this.#gl, node);
    this.#track(asset.glyphCoord);
    this.#track(asset.index);
    this.#track(asset.position);
    this.#assets.set(node, asset);
    return asset;
  }

  endFrame(): void {
    if (!this.#frameActive) return;

    for (const [node, asset] of this.#assets) {
      if (this.#liveNodes.has(node)) continue;
      this.#deleteAsset(asset);
      this.#assets.delete(node);
    }

    this.abortFrame();
  }

  abortFrame(): void {
    this.#liveNodes.clear();
    this.#frameActive = false;
  }

  dispose(): void {
    for (const buffer of this.#buffers) {
      this.#gl.deleteBuffer(buffer);
    }
    this.#buffers.clear();
    this.#assets.clear();
    this.abortFrame();
  }

  #track(buffer: WebGLBuffer): void {
    this.#buffers.add(buffer);
  }

  #deleteAsset(asset: TextRenderAsset): void {
    this.#deleteBuffer(asset.glyphCoord);
    this.#deleteBuffer(asset.index);
    this.#deleteBuffer(asset.position);
  }

  #deleteBuffer(buffer: WebGLBuffer): void {
    if (!this.#buffers.delete(buffer)) return;
    this.#gl.deleteBuffer(buffer);
  }
}
