import { describe, expect, it } from "vitest";
import { semanticFakeGl } from "./support/canvas-root-harness";

describe("semantic WebGL VAO oracle", () => {
  it("records the element buffer consumed by each indexed draw", () => {
    const gl = semanticFakeGl();
    const firstVao = gl.createVertexArray()!;
    const secondVao = gl.createVertexArray()!;
    const firstIndex = gl.createBuffer()!;
    const secondIndex = gl.createBuffer()!;
    gl.bindVertexArray(firstVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, firstIndex);
    gl.bindVertexArray(secondVao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, secondIndex);

    gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_BYTE, 0);
    gl.bindVertexArray(firstVao);
    gl.drawElementsInstanced(gl.TRIANGLES, 3, gl.UNSIGNED_BYTE, 0, 4);

    expect(gl.vaoSemantics.indexedDraws).toEqual([
      { elementArrayBuffer: secondIndex, instanceCount: 1, vertexArray: secondVao },
      { elementArrayBuffer: firstIndex, instanceCount: 4, vertexArray: firstVao },
    ]);
  });

  it("models sticky WebGL buffer targets instead of accepting an invalid fix", () => {
    const gl = semanticFakeGl();
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    expect(() => gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer))
      .toThrow("buffer cannot change binding target");
  });

  it("rejects an inherited VAO mutation but permits an explicitly rebound owner", () => {
    const gl = semanticFakeGl();
    const vertexArray = gl.createVertexArray()!;
    const firstIndex = gl.createBuffer()!;
    const implicitIndex = gl.createBuffer()!;
    const ownedUpdate = gl.createBuffer()!;
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, firstIndex);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, implicitIndex);
    expect(gl.vaoSemantics.implicitElementArrayMutations).toEqual([{
      after: implicitIndex,
      before: firstIndex,
      vertexArray,
    }]);

    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ownedUpdate);
    expect(gl.vaoSemantics.implicitElementArrayMutations).toHaveLength(1);
  });

  it("clears deleted and context-invalid vertex-array state", () => {
    const gl = semanticFakeGl();
    const vertexArray = gl.createVertexArray()!;
    const indexBuffer = gl.createBuffer()!;
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.deleteBuffer(indexBuffer);
    expect(gl.vaoSemantics.elementArrayBuffer(vertexArray)).toBeNull();
    gl.deleteVertexArray(vertexArray);
    expect(gl.vaoSemantics.currentVertexArray()).toBeNull();

    gl.vaoSemantics.resetContext();
    expect(gl.vaoSemantics.indexedDraws).toEqual([]);
    expect(gl.vaoSemantics.implicitElementArrayMutations).toEqual([]);
  });
});
