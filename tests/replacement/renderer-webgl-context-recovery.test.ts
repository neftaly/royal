import { expect, it } from "vitest";
import { WebGlStateOwner } from "../../packages/renderer-webgl/src/webgl/state-owner";
import { canvasRootHarness as harness, fakeGl } from "./support/canvas-root-harness";

it("recovers an allocation failure before the browser dispatches context loss", () => {
  const { callbacks, canvas, root, scheduledFailures } = harness();
  canvas.gl.clear.mockImplementationOnce(() => {
    canvas.gl.isContextLost.mockReturnValue(true);
    throw new Error("Royal could not allocate an ordinary texture");
  });
  root.setSize({ cssHeight: 20, cssWidth: 30, pixelRatio: 1 });
  callbacks.shift()!();
  expect(scheduledFailures).toHaveLength(0);
  expect(root.getSnapshot()).toMatchObject({ context: { phase: "lost", interruptions: 1 }, presentation: "preparing" });
  expect(root.getSnapshot().lastFrameFailure).toBeUndefined();
  const event = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(root.getSnapshot().context.interruptions).toBe(1);
  canvas.gl.isContextLost.mockReturnValue(false);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  callbacks.shift()!();
  expect(root.getSnapshot()).toMatchObject({ context: { phase: "active", recoveries: 1 }, frame: 1 });
  root.dispose();
});

it("restores blend and draw state after an invalidation followed by a clear", () => {
  const gl = fakeGl(), state = new WebGlStateOwner(gl);
  const frame = { framebuffer: null, viewport: { x: 0, y: 0, width: 20, height: 20 } };
  const packet = { alphaBlend: true, colorWrite: true, cullBackFaces: true, depthTest: true,
    depthWrite: false, frontFace: gl.CCW, program: {} as WebGLProgram,
    vertexArray: {} as WebGLVertexArrayObject, textureBindings: [], textureUnits: 0 };
  state.applySurfaceDraw(frame, packet);
  state.invalidate();
  state.clear({ ...frame, clearColor: [0, 0, 0, 0], clearDepth: 1, scissor: null, size: { width: 20, height: 20 } });
  state.applySurfaceDraw(frame, packet);
  expect(gl.blendFuncSeparate).toHaveBeenCalledTimes(2);
  expect(gl.cullFace).toHaveBeenCalledTimes(2);
  expect(gl.depthFunc).toHaveBeenCalledTimes(2);
  expect(gl.useProgram).toHaveBeenCalledTimes(2);
});
