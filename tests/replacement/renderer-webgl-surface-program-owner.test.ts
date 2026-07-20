import { describe, expect, it } from "vitest";
import {
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES,
  SURFACE_FEATURE_NORMAL_TEXTURE,
  SURFACE_FEATURE_PUNCTUAL_LIGHTS,
  SURFACE_FEATURE_ROTATED_ENVIRONMENT,
  SURFACE_FEATURE_STUDIO_ENVIRONMENT,
  SURFACE_FEATURE_TANGENT,
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

  it("only includes environment rotation work for an authored rotation", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);
    owner.get(
      "standard",
      SURFACE_FEATURE_STUDIO_ENVIRONMENT,
      false,
      false,
      false,
    );

    const fragment = gl.shaderSource.mock.calls.map(([, source]) => String(source))
      .find((source) => source.includes("ggxDistribution"));
    expect(fragment).not.toContain("#define ROTATED_ENVIRONMENT");
    expect(gl.getUniformLocation).not.toHaveBeenCalledWith(
      expect.anything(),
      "environmentRotation",
    );

    owner.get(
      "standard",
      SURFACE_FEATURE_STUDIO_ENVIRONMENT | SURFACE_FEATURE_ROTATED_ENVIRONMENT,
      false,
      false,
      false,
    );
    expect(gl.getUniformLocation).toHaveBeenCalledWith(
      expect.anything(),
      "environmentRotation",
    );
  });

  it("builds authored tangent bases per vertex and only normalizes mapped normals per fragment", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);
    owner.get(
      "standard",
      SURFACE_FEATURE_NORMAL_TEXTURE | SURFACE_FEATURE_TANGENT,
      false,
      false,
      false,
    );

    const sources = gl.shaderSource.mock.calls.map(([, source]) => String(source));
    const vertex = sources.find((source) => source.includes("layout(location = 10) in vec4 tangent"));
    const fragment = sources.find((source) => source.includes("uniform sampler2D normalTexture"));
    expect(vertex).toContain("out vec3 worldBitangent");
    expect(vertex).toContain("transformedTangent - unitNormal * dot(unitNormal, transformedTangent)");
    expect(fragment).toContain("worldBitangent * mappedNormal.y");
    expect(fragment).not.toContain("normalize(worldTangent.xyz");
  });

  it("uses one varying and no coordinate uniforms for the canonical identity lane", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);
    owner.get(
      "standard",
      SURFACE_FEATURE_BASE_COLOR_TEXTURE
        | SURFACE_FEATURE_NORMAL_TEXTURE
        | SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES,
      false,
      false,
      false,
    );

    const sources = gl.shaderSource.mock.calls.map(([, source]) => String(source));
    const vertex = sources.find((source) => source.includes("layout(location = 1) in vec3 normal"));
    expect(vertex).toContain("#define IDENTITY_TEXTURE_COORDINATES");
    expect(vertex).toContain("surfaceTextureCoordinate = textureCoordinate0");
    expect(gl.getUniformLocation).not.toHaveBeenCalledWith(
      expect.anything(),
      "baseColorTextureCoordinates0",
    );
    expect(gl.getUniformLocation).not.toHaveBeenCalledWith(
      expect.anything(),
      "normalTextureCoordinates0",
    );
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
