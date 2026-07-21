import { describe, expect, it, vi } from "vitest";
import {
  SURFACE_FEATURE_ALPHA_BLEND,
  SURFACE_FEATURE_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_DIRECTIONAL_LIGHTS,
  SURFACE_FEATURE_IDENTITY_TEXTURE_COORDINATES,
  SURFACE_FEATURE_NORMAL_TEXTURE,
  SURFACE_FEATURE_PUNCTUAL_LIGHTS,
  SURFACE_FEATURE_ROTATED_ENVIRONMENT,
  SURFACE_FEATURE_STUDIO_ENVIRONMENT,
  SURFACE_FEATURE_TANGENT,
  SURFACE_FEATURE_TRANSMISSION_MATERIAL,
  SURFACE_FEATURE_VERTEX_COLOR,
  SURFACE_FEATURE_VERTEX_NORMAL,
  SURFACE_FEATURE_VIRTUAL_BASE_COLOR_TEXTURE,
  SURFACE_FEATURE_VOLUME_MATERIAL,
} from "../../packages/renderer-webgl/src/surface/surface-program-features";
import {
  SurfaceProgramOwner,
  surfaceVertexFeatures,
} from "../../packages/renderer-webgl/src/surface/surface-program-owner";
import { fakeGl } from "./support/canvas-root-harness";
import { VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS } from "../../packages/renderer-webgl/src/virtual-texture/shader-source";
import { transmissionShaderSource } from "../../packages/renderer-webgl/src/surface/surface-composite-owner";

describe("surface program ownership", () => {
  it("preserves framebuffer alpha only for blended material variants", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);
    owner.get("standard", 0, false, false, false);
    owner.get("standard", SURFACE_FEATURE_ALPHA_BLEND, false, false, false);
    owner.get("unlit", 0, false, false, false);
    owner.get("unlit", SURFACE_FEATURE_ALPHA_BLEND, false, false, false);

    const fragments = gl.shaderSource.mock.calls.map(([, source]) => String(source))
      .filter((source) => source.includes("out vec4 outputColor"));
    const standard = fragments.filter((source) => source.includes("ggxDistribution"));
    const unlit = fragments.filter((source) => !source.includes("ggxDistribution"));
    expect(standard).toHaveLength(2);
    expect(unlit).toHaveLength(2);
    expect(standard[0]).not.toContain("#define ALPHA_BLEND");
    expect(standard[1]).toContain("#define ALPHA_BLEND");
    expect(unlit[0]).not.toContain("#define ALPHA_BLEND");
    expect(unlit[1]).toContain("#define ALPHA_BLEND");
    for (const source of fragments) {
      expect(source).toContain("float surfaceAlpha = 1.0");
    }
  });

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
    expect(gl.getShaderParameter).not.toHaveBeenCalled();
    const vertexSources = gl.shaderSource.mock.calls.filter(([, source]) =>
      String(source).includes("layout(location = 0) in vec3 position"));
    expect(vertexSources).toHaveLength(1);
  });

  it("specializes authored normals without a scale-sensitive runtime fallback", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);
    owner.get("standard", 0, false, false, false);
    owner.get("standard", SURFACE_FEATURE_VERTEX_NORMAL, false, false, false);

    const fragments = gl.shaderSource.mock.calls.map(([, source]) => String(source))
      .filter((source) => source.includes("ggxDistribution"));
    expect(fragments[0]).not.toContain("#define VERTEX_NORMAL");
    expect(fragments[1]).toContain("#define VERTEX_NORMAL");
    expect(fragments[1]).not.toContain("dot(normal, normal) <=");
  });

  it("synchronizes once at link and reports stage logs only on failure", () => {
    const gl = fakeGl();
    vi.mocked(gl.getProgramParameter).mockReturnValue(false);
    vi.mocked(gl.getProgramInfoLog).mockReturnValue("linker rejected the program");
    vi.mocked(gl.getShaderInfoLog)
      .mockReturnValueOnce("vertex failed")
      .mockReturnValueOnce("fragment failed");
    const owner = new SurfaceProgramOwner(gl);

    expect(() => owner.get("standard", 0, false, false, false)).toThrow(
      "Royal surface program link failed: linker rejected the program; "
      + "vertex: vertex failed; fragment: fragment failed",
    );
    expect(gl.getShaderParameter).not.toHaveBeenCalled();
    expect(gl.getProgramParameter).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
    expect(gl.deleteShader).toHaveBeenCalledTimes(1);
  });

  it("removes directional-light work from environment-only fragments", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);
    owner.get("standard", SURFACE_FEATURE_STUDIO_ENVIRONMENT, false, false, false);

    const environmentOnly = gl.shaderSource.mock.calls.map(([, source]) => String(source))
      .find((source) => source.includes("ggxDistribution"));
    expect(environmentOnly).not.toContain("#define DIRECTIONAL_LIGHTS");
    expect(gl.getUniformLocation).not.toHaveBeenCalledWith(
      expect.anything(),
      "directionalLightCount",
    );

    owner.get(
      "standard",
      SURFACE_FEATURE_STUDIO_ENVIRONMENT | SURFACE_FEATURE_DIRECTIONAL_LIGHTS,
      false,
      false,
      false,
    );
    expect(gl.getUniformLocation).toHaveBeenCalledWith(
      expect.anything(),
      "directionalLightCount",
    );
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

  it("keeps volume-only uniforms and shader work out of thin transmission", () => {
    const gl = fakeGl();
    const owner = new SurfaceProgramOwner(gl);
    owner.setTransmissionShaderSource(transmissionShaderSource);
    const thin = owner.get(
      "standard",
      SURFACE_FEATURE_TRANSMISSION_MATERIAL,
      false,
      false,
      false,
    );
    const thinFragment = gl.shaderSource.mock.calls.map(([, source]) => String(source))
      .filter((source) => source.includes("#define TRANSMISSION_MATERIAL"))
      .at(-1);

    expect(thin.kind).toBe("standard");
    if (thin.kind !== "standard") throw new Error("expected a standard thin program");
    expect(thin.attenuationColor).toBeNull();
    expect(thinFragment).not.toContain("#define VOLUME_MATERIAL");
    expect(gl.getUniformLocation).not.toHaveBeenCalledWith(
      expect.anything(),
      "attenuationColor",
    );

    const volume = owner.get(
      "standard",
      SURFACE_FEATURE_TRANSMISSION_MATERIAL | SURFACE_FEATURE_VOLUME_MATERIAL,
      false,
      false,
      false,
    );
    const volumeFragment = gl.shaderSource.mock.calls.map(([, source]) => String(source))
      .filter((source) => source.includes("#define TRANSMISSION_MATERIAL"))
      .at(-1);
    expect(volume.kind).toBe("standard");
    if (volume.kind !== "standard") throw new Error("expected a standard volume program");
    expect(volume.attenuationColor).not.toBeNull();
    expect(volumeFragment).toContain("#define VOLUME_MATERIAL");
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

  it("addresses the virtual page table through native texture mip levels", () => {
    expect(VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS).toContain(
      "texelFetch(virtualPageTable, ivec2(desiredPage), desiredMip)",
    );
    expect(VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS).toContain("footprintSquared");
    expect(VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS).not.toContain("virtualMipOffsets");
    expect(VIRTUAL_TEXTURE_FRAGMENT_DECLARATIONS).not.toContain("length(texelDx)");
  });
});
