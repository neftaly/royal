import { describe, expect, it } from "vitest";
import {
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_NORMAL_TEXTURE,
  SURFACE_FEATURE_PUNCTUAL_LIGHTS,
  SURFACE_FEATURE_STUDIO_ENVIRONMENT,
  SURFACE_FEATURE_TRANSMISSION_MATERIAL,
  SURFACE_FEATURE_VERTEX_COLOR,
  SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE,
} from "../../packages/renderer-webgl/src/surface/surface-program-features";
import {
  SurfaceProgramOwner,
  surfaceVertexFeatures,
} from "../../packages/renderer-webgl/src/surface/surface-program-owner";
import { fakeGl } from "./support/canvas-root-harness";

describe("surface program ownership", () => {
  it("projects only stage-relevant material features into vertex variants", () => {
    expect(surfaceVertexFeatures("standard", (
      SURFACE_FEATURE_BASE_COLOR_TEXTURE
      | SURFACE_FEATURE_NORMAL_TEXTURE
      | SURFACE_FEATURE_PUNCTUAL_LIGHTS
      | SURFACE_FEATURE_STUDIO_ENVIRONMENT
      | SURFACE_FEATURE_VERTEX_COLOR
    ))).toBe(
      SURFACE_FEATURE_BASE_COLOR_TEXTURE
      | SURFACE_FEATURE_NORMAL_TEXTURE
      | SURFACE_FEATURE_VERTEX_COLOR,
    );
    expect(surfaceVertexFeatures("unlit", (
      SURFACE_FEATURE_BASE_COLOR_TEXTURE
      | SURFACE_FEATURE_NORMAL_TEXTURE
      | SURFACE_FEATURE_VERTEX_COLOR
    ))).toBe(SURFACE_FEATURE_BASE_COLOR_TEXTURE | SURFACE_FEATURE_VERTEX_COLOR);
  });

  it("reuses a compiled vertex stage across fragment-only variants", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);

    owner.get("standard", SURFACE_FEATURE_STUDIO_ENVIRONMENT, false, false, false);
    owner.get("standard", (
      SURFACE_FEATURE_STUDIO_ENVIRONMENT | SURFACE_FEATURE_PUNCTUAL_LIGHTS
    ), false, false, false);

    expect(gl.createProgram).toHaveBeenCalledTimes(2);
    expect(gl.compileShader).toHaveBeenCalledTimes(3);
    const vertexSources = gl.shaderSource.mock.calls.filter(([, source]) =>
      String(source).includes("layout(location = 0) in vec3 position"));
    expect(vertexSources).toHaveLength(1);
  });

  it("invalidates only programs that depend on lazy transmission source", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);
    const opaque = owner.get(
      "standard",
      SURFACE_FEATURE_STUDIO_ENVIRONMENT,
      false,
      false,
      false,
    );
    const transmission = owner.get(
      "standard",
      SURFACE_FEATURE_STUDIO_ENVIRONMENT | SURFACE_FEATURE_TRANSMISSION_MATERIAL,
      false,
      false,
      false,
    );

    owner.setTransmissionShaderSource({
      fragmentBody: "",
      fragmentDeclarations: "",
      vertexBody: "",
      vertexDeclarations: "",
    });

    expect(owner.get(
      "standard",
      SURFACE_FEATURE_STUDIO_ENVIRONMENT,
      false,
      false,
      false,
    )).toBe(opaque);
    expect(owner.get(
      "standard",
      SURFACE_FEATURE_STUDIO_ENVIRONMENT | SURFACE_FEATURE_TRANSMISSION_MATERIAL,
      false,
      false,
      false,
    )).not.toBe(transmission);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.compileShader).toHaveBeenCalledTimes(6);
  });

  it("keeps ordinary programs and vertex stages across lazy VT source changes", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);
    const ordinary = owner.get("unlit", 0, false, false, false);
    const virtualFeatures = SURFACE_FEATURE_BASE_COLOR_TEXTURE
      | SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE;
    const virtual = owner.get("unlit", virtualFeatures, false, false, false);

    owner.setVirtualTextureDeclarations("uniform sampler2D virtualPageTable;");

    expect(owner.get("unlit", 0, false, false, false)).toBe(ordinary);
    expect(owner.get("unlit", virtualFeatures, false, false, false)).not.toBe(virtual);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.compileShader).toHaveBeenCalledTimes(5);
  });
});
