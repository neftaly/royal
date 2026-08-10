import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { vaoOwnershipProbeSource } from './vao-ownership-probe.mjs';

const probeHarness = () => {
  let currentVertexArray = null;
  let nativeElementArrays = new Map([[null, null]]);
  const listeners = new Map();
  const multiDrawExtension = {
    calls: 0,
    multiDrawElementsWEBGL() {
      this.calls += 1;
    },
  };
  const context = {
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    ELEMENT_ARRAY_BUFFER_BINDING: 0x8895,
    bindBuffer(target, buffer) {
      if (target === this.ELEMENT_ARRAY_BUFFER) {
        nativeElementArrays.set(currentVertexArray, buffer);
      }
    },
    bindVertexArray(vertexArray) {
      currentVertexArray = vertexArray;
      if (!nativeElementArrays.has(vertexArray)) nativeElementArrays.set(vertexArray, null);
    },
    deleteBuffer(buffer) {
      for (const [vertexArray, elementArrayBuffer] of nativeElementArrays) {
        if (elementArrayBuffer === buffer) nativeElementArrays.set(vertexArray, null);
      }
    },
    deleteVertexArray(vertexArray) {
      nativeElementArrays.delete(vertexArray);
      if (currentVertexArray === vertexArray) currentVertexArray = null;
    },
    drawArrays() {},
    drawArraysInstanced() {},
    drawElements() {},
    drawElementsInstanced() {},
    drawRangeElements() {},
    forceNativeElementArray(buffer) {
      nativeElementArrays.set(currentVertexArray, buffer);
    },
    getExtension(name) {
      return name === 'WEBGL_multi_draw' ? multiDrawExtension : null;
    },
    getParameter(parameter) {
      return parameter === this.ELEMENT_ARRAY_BUFFER_BINDING
        ? nativeElementArrays.get(currentVertexArray) ?? null
        : null;
    },
    resetNativeContext() {
      currentVertexArray = null;
      nativeElementArrays = new Map([[null, null]]);
    },
  };

  class FakeCanvas {
    addEventListener(name, listener) {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    }

    dispatch(name) {
      for (const listener of listeners.get(name) ?? []) listener();
    }

    getContext(kind) {
      return kind === 'webgl2' ? context : null;
    }
  }

  const browserGlobal = { HTMLCanvasElement: FakeCanvas };
  vm.runInNewContext(vaoOwnershipProbeSource, browserGlobal);
  const canvas = new browserGlobal.HTMLCanvasElement();
  const gl = canvas.getContext('webgl2');
  return {
    canvas,
    gl,
    multiDrawExtension,
    snapshot: () => browserGlobal.__royalVaoOwnershipSnapshot(),
  };
};

describe('real-WebGL VAO ownership probe', () => {
  it('detects inherited element-array mutation and native/model divergence', () => {
    const { gl, snapshot } = probeHarness();
    const vertexArray = {};
    const firstIndex = {};
    const implicitIndex = {};
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, firstIndex);
    gl.drawElements(0, 3, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, implicitIndex);
    gl.forceNativeElementArray(firstIndex);
    gl.drawElements(0, 3, 0, 0);

    expect(snapshot().violations.map(({ kind }) => kind)).toEqual([
      'implicit-element-array-mutation',
      'indexed-draw-without-owned-index-buffer',
    ]);
  });

  it('permits explicit ownership and proves the default preparation path', () => {
    const { gl, snapshot } = probeHarness();
    const vertexArray = {};
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, {});
    gl.drawArrays(0, 0, 3);
    gl.drawArraysInstanced(0, 0, 3, 2);
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, {});
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, {});

    expect(snapshot()).toMatchObject({
      arrayInstancedDraws: 1,
      defaultElementArrayPreparations: 1,
      violations: [],
    });
  });

  it('detects sticky target changes and covers every indexed entrypoint', () => {
    const { gl, multiDrawExtension, snapshot } = probeHarness();
    const vertexArray = {};
    const indexBuffer = {};
    const retargetedBuffer = {};
    gl.bindBuffer(gl.ARRAY_BUFFER, retargetedBuffer);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, retargetedBuffer);
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

    gl.drawElements(0, 3, 0, 0);
    gl.drawElementsInstanced(0, 3, 0, 0, 4);
    gl.drawRangeElements(0, 0, 2, 3, 0, 0);
    gl.getExtension('WEBGL_multi_draw').multiDrawElementsWEBGL(
      0,
      new Int32Array([3, 3, 3]),
      0,
      0,
      new Int32Array([0, 3, 6]),
      0,
      3,
    );

    expect(snapshot()).toMatchObject({
      indexedDraws: 6,
      maximumInstanceCount: 4,
    });
    expect(snapshot().violations.map(({ kind }) => kind))
      .toContain('buffer-target-mutation');
    expect(multiDrawExtension.calls).toBe(1);
  });

  it('resets modeled VAO state for a restored native context', () => {
    const { canvas, gl, snapshot } = probeHarness();
    gl.bindVertexArray({});
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, {});
    gl.drawElements(0, 3, 0, 0);
    gl.resetNativeContext();
    canvas.dispatch('webglcontextlost');
    canvas.dispatch('webglcontextrestored');
    gl.bindVertexArray({});
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, {});
    gl.drawElements(0, 3, 0, 0);

    expect(snapshot()).toMatchObject({ indexedDraws: 2, violations: [] });
  });
});
