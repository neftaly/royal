import { describe, expect, it, vi } from "vitest";
import {
  imageTexture,
  standardMaterial,
  unlitMaterial,
} from "@royal/renderer-core";
import type { SurfaceMaterial } from "../packages/renderer-webgl/src/webgl/materials";
import {
  ControlledImage,
  createWebGlRoot,
  fakeCanvas,
  fakeGl,
  flushMicrotasks,
  installCanvas2d,
  namedUniform1iValues,
  renderScene,
  renderVirtualTextureMaterials,
  type FakeCanvas,
} from "./renderer-webgl-virtual-texturing-fixtures";

const ordinaryConsumer = (
  texture: ReturnType<typeof imageTexture>,
): SurfaceMaterial => Object.freeze({
  ...standardMaterial({ color: [1, 1, 1, 1] }),
  emissiveTexture: texture,
});

const prepareGeneratedVirtualTexture = async (
  root: ReturnType<typeof createWebGlRoot>,
  material: ReturnType<typeof unlitMaterial>,
): Promise<void> => {
  root.render(renderScene(material));
  const source = ControlledImage.instances[0]!;
  source.height = 512;
  source.naturalHeight = 512;
  source.naturalWidth = 512;
  source.width = 512;
  source.settleLoad();
  await flushMicrotasks();

  for (let frame = 0; frame < 12; frame += 1) {
    root.render(renderScene(material));
    await flushMicrotasks();
    if (
      root.snapshot().virtualTexturing.shaderBinds > 0
      && root.snapshot().textureResidency.resources === 0
    ) return;
  }
  throw new Error("Generated virtual texture did not reach suppressed ordinary residency");
};

describe("WebGL frame texture residency arbitration", () => {
  it.each([
    ["ordinary-first", ["ordinary", "virtual"]],
    ["virtual-first", ["virtual", "ordinary"]],
  ] as const)("keeps shared ordinary residency in %s traversal", async (_label, traversal) => {
    vi.stubGlobal("Image", ControlledImage);
    installCanvas2d();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { automaticVirtualTextures: true });
    const texture = imageTexture("/textures/shared-order.png");
    const virtual = unlitMaterial({ texture });
    const ordinary = ordinaryConsumer(texture);
    await prepareGeneratedVirtualTexture(root, virtual);
    const sourceCount = ControlledImage.instances.length;
    const materials = traversal.map((use) => use === "virtual" ? virtual : ordinary);

    root.render(renderVirtualTextureMaterials(materials));
    await flushMicrotasks();
    root.render(renderVirtualTextureMaterials(materials));

    expect(root.snapshot().textureResidency).toMatchObject({
      preparedSources: 1,
      resources: 1,
    });
    expect(ControlledImage.instances).toHaveLength(sourceCount);
    expect(namedUniform1iValues(calls).u_useEmissiveTexture).toContain(1);
  });

  it("rolls back VT suppression intent when a later frame operation fails", async () => {
    vi.stubGlobal("Image", ControlledImage);
    installCanvas2d();
    const marker = new Error("post-bind frame failure");
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { automaticVirtualTextures: true });
    const texture = imageTexture("/textures/frame-rollback.png");
    const virtual = unlitMaterial({ texture });
    const ordinary = ordinaryConsumer(texture);
    await prepareGeneratedVirtualTexture(root, virtual);

    root.render(renderScene(ordinary));
    await flushMicrotasks();
    root.render(renderScene(ordinary));
    expect(root.snapshot().textureResidency.resources).toBe(1);

    vi.spyOn(gl, "drawElements").mockImplementation(() => { throw marker; });
    expect(() => root.render(renderScene(standardMaterial({ texture })))).toThrow(marker);
    expect(root.snapshot().textureResidency).toMatchObject({ preparedSources: 1, resources: 1 });
  });

  it("requests ordinary fallback when sampler capacity cannot bind VT", async () => {
    vi.stubGlobal("Image", ControlledImage);
    installCanvas2d();
    const { calls, gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl), { automaticVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/constrained.png") });

    root.render(renderScene(material));
    const source = ControlledImage.instances[0]!;
    source.height = 512;
    source.naturalHeight = 512;
    source.naturalWidth = 512;
    source.width = 512;
    source.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 4; frame += 1) {
      root.render(renderScene(material));
      await flushMicrotasks();
    }

    expect(root.snapshot().textureResidency.resources).toBe(1);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBe(0);
    expect(namedUniform1iValues(calls).u_useTexture).toContain(1);
  });

  it("avoids stale fallback handles and re-promotes retained source after context recovery", async () => {
    vi.stubGlobal("Image", ControlledImage);
    installCanvas2d();
    let invalidateAfterPlan = false;
    let canvas: FakeCanvas;
    const { calls, gl } = fakeGl({
      beforeUniform1i: (name) => {
        if (!invalidateAfterPlan || name !== "u_unlit") return;
        invalidateAfterPlan = false;
        canvas.dispatchContextEvent("webglcontextlost");
      },
    });
    canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, { automaticVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/re-promote.png") });
    await prepareGeneratedVirtualTexture(root, material);
    const sourceCount = ControlledImage.instances.length;

    const invalidatedDrawStart = calls.length;
    invalidateAfterPlan = true;
    expect(() => root.render(renderScene(standardMaterial({ texture: material.baseColor }))))
      .toThrow(/Vertex-input context was dropped/);
    const invalidatedUniforms = namedUniform1iValues(calls.slice(invalidatedDrawStart));

    expect(invalidateAfterPlan).toBe(false);
    expect(invalidatedUniforms.u_useTexture).not.toContain(1);
    expect(invalidatedUniforms.u_useVirtualTexture).not.toContain(1);
    expect(invalidatedUniforms.u_vtAtlas).toBeUndefined();

    const recoveredDrawStart = calls.length;
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(renderScene(standardMaterial({ texture: material.baseColor })));

    expect(root.snapshot().textureResidency).toMatchObject({ preparedSources: 1, resources: 1 });
    expect(ControlledImage.instances).toHaveLength(sourceCount);
    for (let frame = 0; frame < 8; frame += 1) {
      root.render(renderScene(standardMaterial({ texture: material.baseColor })));
      await flushMicrotasks();
      if (namedUniform1iValues(calls.slice(recoveredDrawStart)).u_useTexture?.includes(1)) break;
    }
    expect(namedUniform1iValues(calls.slice(recoveredDrawStart)).u_useTexture).toContain(1);
  });
});
