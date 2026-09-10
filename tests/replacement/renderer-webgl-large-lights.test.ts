import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { PersistentGpuBudgetOwner } from '../../packages/renderer-webgl/src/resource/persistent-gpu-budget';
import type { CanonicalDirectionalLight, CanonicalPunctualLight } from '../../packages/renderer-webgl/src/surface/scene-lowering';
import { LargeLightRuntime, largeLightShader } from '../../packages/renderer-webgl/src/surface/large-light-runtime';
import { LargeLightActivation } from '../../packages/renderer-webgl/src/surface/large-light-activation';
import { FrameUploadBudgetOwner } from '../../packages/renderer-webgl/src/resource/frame-upload-budget';
import { boxGeometry, directionalLight, mesh, perspectiveCamera, scene as authorScene, standardMaterial } from '@royal/renderer-core';
import { captureImage } from '../../packages/renderer-webgl/src/capture';
import { canvasRootHarness } from './support/canvas-root-harness';
import { surfaceLightCountFeatureBits, surfaceDirectionalLightCount, surfacePunctualLightCount, SURFACE_FEATURE_LARGE_LIGHTS } from '../../packages/renderer-webgl/src/surface/surface-program-features';

const directional = (count: number): CanonicalDirectionalLight[] => Array.from({ length: count }, (_, index) => ({
  color: [index + 1, 0.5, 0.25, 1], direction: [0, 0, -1],
}));
const punctual = (count: number): CanonicalPunctualLight[] => Array.from({ length: count }, (_, index) => ({
  color: [0.5, index + 1, 0.25, 1], direction: [0, 0, -1], position: [index, 1, 2],
  range: index % 2 === 0 ? 0 : 3, kind: index % 2 === 0 ? 'point' : 'spot',
  innerConeCosine: 0.9, outerConeCosine: 0.8,
}));
const scene = (d = 0, p = 0) => ({ directionalLights: directional(d), punctualLights: punctual(p) });
const harness = (bytes = 1024 * 1024) => {
  let id = 0;
  const uploads: Float32Array[] = [];
  const gl = {
    TEXTURE13: 33997, activeTexture: vi.fn(), MAX_TEXTURE_SIZE: 3379, TEXTURE_2D: 3553, RGBA32F: 34836, RGBA: 6408, FLOAT: 5126,
    TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
    NEAREST: 9728, CLAMP_TO_EDGE: 33071, NO_ERROR: 0,
    getParameter: vi.fn(() => 8192), getError: vi.fn(() => 0),
    createTexture: vi.fn(() => ({ id: ++id })), deleteTexture: vi.fn(), bindTexture: vi.fn(),
    texStorage2D: vi.fn(), texParameteri: vi.fn(),
    texSubImage2D: vi.fn((...args: unknown[]) => { uploads.push(new Float32Array(args[8] as Float32Array)); }),
  };
  const budget = new PersistentGpuBudgetOwner(bytes);
  return { gl, context: gl as unknown as WebGL2RenderingContext, budget, uploads };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
};
const module = { LargeLightRuntime, largeLightShader };

describe('large-light ownership', () => {
  it('packs every directional, point and spot record including the final light', () => {
    const h = harness(), runtime = new LargeLightRuntime(h.context, h.budget);
    runtime.set(directional(128), punctual(384));
    expect(runtime.counts).toEqual([128, 384]);
    expect(h.uploads[0]).toHaveLength(512 * 16);
    expect(Array.from(h.uploads[0]!.slice(127 * 16, 127 * 16 + 7))).toEqual([128, 0.5, 0.25, 1, 0, 0, -1]);
    expect(Array.from(h.uploads[0]!.slice(511 * 16, 511 * 16 + 12))).toEqual([0.5, 384, 0.25, 1, 0, 0, -1, 1, 383, 1, 2, 3]);
    expect(h.budget.snapshot().retainedBytes).toBe(32768);
    runtime.dispose(); expect(h.budget.snapshot().retainedBytes).toBe(0);
  });

  it('reuses capacity for moving lights and ignores stale rows after shrinking the scene', () => {
    const h = harness(), runtime = new LargeLightRuntime(h.context, h.budget);
    runtime.set(directional(512), []); const texture = runtime.texture;
    runtime.set([], punctual(9));
    expect(runtime.texture).toBe(texture);
    expect(runtime.counts).toEqual([0, 9]);
    expect(h.uploads[1]).toHaveLength(9 * 16);
    expect(h.gl.createTexture).toHaveBeenCalledOnce();
    runtime.clear(); expect(runtime.texture).toBeUndefined();
    expect(runtime.counts).toEqual([0, 0]);
    expect(h.budget.snapshot().retainedBytes).toBe(0);
  });

  it('rejects capacity overflow before altering the last published light set', () => {
    const h = harness(), runtime = new LargeLightRuntime(h.context, h.budget);
    runtime.set(directional(5), []); const texture = runtime.texture;
    expect(() => runtime.set(directional(8193), [])).toThrow(/device texture limit/);
    expect(runtime.texture).toBe(texture); expect(runtime.counts).toEqual([5, 0]);
    expect(h.uploads).toHaveLength(1); runtime.dispose();
  });

  it('reserves peak old-plus-new bytes and preserves the old allocation on budget denial', () => {
    const h = harness(32768), runtime = new LargeLightRuntime(h.context, h.budget);
    runtime.set(directional(256), []); const texture = runtime.texture;
    expect(() => runtime.set(directional(257), [])).toThrow(/budget exhausted/);
    expect(runtime.texture).toBe(texture); expect(runtime.counts).toEqual([256, 0]);
    expect(h.budget.snapshot().retainedBytes).toBe(16384);
    expect(h.gl.createTexture).toHaveBeenCalledOnce(); runtime.dispose();
  });

  it.each(['null', 'storage', 'driver', 'upload'])('releases a failed replacement (%s) without losing its predecessor', failure => {
    const h = harness(), runtime = new LargeLightRuntime(h.context, h.budget);
    runtime.set(directional(256), []); const texture = runtime.texture;
    if (failure === 'null') h.gl.createTexture.mockReturnValueOnce(null as never);
    if (failure === 'storage') h.gl.texStorage2D.mockImplementationOnce(() => { throw new Error('storage failure'); });
    if (failure === 'driver') h.gl.getError.mockReturnValueOnce(1285);
    if (failure === 'upload') h.gl.texSubImage2D.mockImplementationOnce(() => { throw new Error('upload failure'); });
    expect(() => runtime.set(directional(257), [])).toThrow();
    expect(runtime.texture).toBe(texture); expect(runtime.counts).toEqual([256, 0]);
    expect(h.budget.snapshot().retainedBytes).toBe(16384); runtime.dispose();
  });

  it('rebuilds from current canonical lights after context loss and rejects disposed use', () => {
    const h = harness(), runtime = new LargeLightRuntime(h.context, h.budget);
    runtime.set([], punctual(300)); const texture = runtime.texture;
    runtime.invalidate(); expect(h.budget.snapshot().retainedBytes).toBe(0);
    runtime.set([], punctual(12)); expect(runtime.texture).not.toBe(texture);
    runtime.dispose(); expect(() => runtime.set([], punctual(9))).toThrow(/disposed/);
  });
});

describe('lazy large-light activation', () => {
  it('keeps large counts out of the packed small-count shader fields', () => {
    for (const count of [5, 8, 16, 256, 512]) {
      const features = surfaceLightCountFeatureBits(count, 0);
      expect(features).toBe(SURFACE_FEATURE_LARGE_LIGHTS);
      expect(surfaceDirectionalLightCount(features)).toBe(0);
      expect(surfacePunctualLightCount(features)).toBe(0);
    }
    expect(surfaceLightCountFeatureBits(4, 8) & SURFACE_FEATURE_LARGE_LIGHTS).toBe(0);
  });

  it('reserves retained and replacement light storage before ordinary texture fitting', async () => {
    const h = harness(), changed = vi.fn();
    const activation = new LargeLightActivation(h.context, h.budget, changed, async () => module);
    expect(activation.plannedByteLength).toBe(0);
    activation.set(scene(256)); expect(activation.plannedByteLength).toBe(16384);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce()); activation.prepare();
    expect(activation.plannedByteLength).toBe(16384);
    activation.set(scene(512)); expect(activation.plannedByteLength).toBe(49152);
    activation.prepare(); expect(activation.plannedByteLength).toBe(32768);
    activation.set(scene(0, 9)); expect(activation.plannedByteLength).toBe(32768);
    activation.prepare(); activation.set(scene(4)); expect(activation.plannedByteLength).toBe(0);
    activation.dispose();
  });

  it('waits for upload admission after loading and accounts for light bytes in the frame', async () => {
    const h = harness(), changed = vi.fn();
    const activation = new LargeLightActivation(h.context, h.budget, changed, async () => module);
    const uploads = new FrameUploadBudgetOwner(1024);
    activation.set(scene(256)); await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(h.gl.createTexture).not.toHaveBeenCalled();
    expect(uploads.tryAdmit(1024)).toBe(true);
    expect(activation.prepare(uploads)).toBe(false);
    expect(activation.pending).toBe(true);
    expect(h.gl.createTexture).not.toHaveBeenCalled();
    uploads.beginFrame(); expect(activation.prepare(uploads)).toBe(true);
    expect(uploads.snapshot().admittedBytes).toBe(16384);
    expect(activation.pending).toBe(false); activation.dispose();
  });

  it('captures a valid replacement immediately after a large-light budget failure', async () => {
    const h = canvasRootHarness({}, {}, { persistentGpuByteBudget: 20000 });
    Object.assign(h.canvas.gl, { TEXTURE13: 33997, RGBA32F: 34836, MAX_TEXTURE_SIZE: 3379 });
    const encode = vi.fn((callback: BlobCallback) => callback(new Blob(['png'])));
    Object.assign(h.canvas, { toBlob: encode });
    const input = (count: number) => authorScene({ camera: perspectiveCamera({ position: [0, 0, 4] }), nodes: [
      mesh({ geometry: boxGeometry(1), material: standardMaterial({ color: [1, 1, 1, 1] }) }),
      ...Array.from({ length: count }, () => directionalLight({ direction: [0, 0, -1] })),
    ] });
    try {
      h.root.setSize({ cssWidth: 60, cssHeight: 60, pixelRatio: 1 }); h.root.setScene(input(512));
      const rejected = expect(captureImage(h.root)).rejects.toThrow(/budget exhausted/);
      await vi.waitFor(() => {
        h.callbacks.splice(0).forEach(callback => callback());
        expect(h.scheduledFailures.length).toBeGreaterThan(0);
      });
      await rejected; expect(encode).not.toHaveBeenCalled();
      h.root.setScene(input(1)); await captureImage(h.root);
      expect(encode).toHaveBeenCalledOnce(); expect(h.root.getSnapshot().lastFrameFailure).toBeUndefined();
    } finally { h.root.dispose(); }
  });

  it('does not encode a retained-geometry scene until lazy lights are uploaded and drawn', async () => {
    const { root, canvas, callbacks } = canvasRootHarness();
    const gl = canvas.gl;
    Object.assign(gl, { TEXTURE13: 33997, RGBA32F: 34836, MAX_TEXTURE_SIZE: 3379, uniform2i: vi.fn(), texParameteri: vi.fn() });
    let large = false;
    const encode = vi.fn((callback: BlobCallback) => {
      if (large) expect(gl.texSubImage2D.mock.calls.some(call => call[4] === 4 && call[5] === 256)).toBe(true);
      callback(new Blob(['png']));
    });
    Object.assign(canvas, { toBlob: encode });
    const shape = mesh({ geometry: boxGeometry(1), material: standardMaterial({ color: [1, 1, 1, 1] }) });
    const input = (count: number) => authorScene({ camera: perspectiveCamera({ position: [0, 0, 4] }),
      nodes: [shape, ...Array.from({ length: count }, () => directionalLight({ direction: [0, 0, -1] }))] });
    try {
      root.setSize({ cssWidth: 60, cssHeight: 60, pixelRatio: 1 }); root.setScene(input(1));
      await captureImage(root); encode.mockClear(); large = true;
      root.setScene(input(256));
      const result = captureImage(root); void result.catch(() => undefined);
      expect(encode).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        callbacks.splice(0).forEach(callback => callback());
        expect(encode, JSON.stringify(root.getSnapshot())).toHaveBeenCalledOnce();
      });
      await result;
    } finally { root.dispose(); }
  });
  it('does not load or allocate anything for existing small-light scenes', () => {
    const h = harness(), load = vi.fn(), activation = new LargeLightActivation(h.context, h.budget, vi.fn(), load);
    activation.set(scene(4, 8)); expect(load).not.toHaveBeenCalled();
    expect(activation.pending).toBe(false); expect(h.gl.createTexture).not.toHaveBeenCalled(); activation.dispose();
  });

  it('publishes the latest scene if replacement arrives during module loading', async () => {
    const h = harness(), pending = deferred<typeof module>(), load = vi.fn(() => pending.promise), changed = vi.fn();
    const activation = new LargeLightActivation(h.context, h.budget, changed, load);
    activation.set(scene(256)); activation.set(scene(10, 500));
    expect(load).toHaveBeenCalledOnce(); expect(activation.pending).toBe(true);
    pending.resolve(module); await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(h.gl.createTexture).not.toHaveBeenCalled();
    expect(activation.prepare()).toBe(true);
    expect(activation.runtime?.counts).toEqual([10, 500]); activation.dispose();
  });

  it.each(['small', 'dispose', 'loss'])('ignores late module completion after %s', async change => {
    const h = harness(), pending = deferred<typeof module>(), changed = vi.fn();
    const activation = new LargeLightActivation(h.context, h.budget, changed, () => pending.promise);
    activation.set(scene(256));
    if (change === 'small') activation.set(scene(3));
    if (change === 'dispose') activation.dispose();
    if (change === 'loss') activation.invalidate();
    pending.resolve(module); await pending.promise; await Promise.resolve();
    expect(activation.pending).toBe(false); expect(activation.runtime).toBeUndefined();
    expect(h.gl.createTexture).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  });

  it('ignores the first completion when small/large replacement starts a new generation', async () => {
    const h = harness(), first = deferred<typeof module>(), second = deferred<typeof module>(), changed = vi.fn();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const activation = new LargeLightActivation(h.context, h.budget, changed, load);
    activation.set(scene(256)); activation.set(scene(3)); activation.set(scene(0, 512));
    first.resolve(module); await first.promise; await Promise.resolve();
    expect(activation.pending).toBe(true); expect(changed).not.toHaveBeenCalled();
    second.resolve(module); await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(activation.prepare()).toBe(true); expect(activation.runtime?.counts).toEqual([0, 512]);
    expect(h.gl.createTexture).toHaveBeenCalledOnce(); activation.dispose();
  });

  it('recovers from a failed GPU admission when a small scene replaces it', async () => {
    const h = harness(1), changed = vi.fn();
    const activation = new LargeLightActivation(h.context, h.budget, changed, async () => module);
    activation.set(scene(256)); await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(() => activation.prepare()).toThrow(/budget exhausted/);
    expect(activation.failure).toBeInstanceOf(Error); expect(activation.runtime).toBeUndefined();
    expect(h.budget.snapshot().retainedBytes).toBe(0);
    activation.set(scene(3)); expect(activation.failure).toBeUndefined(); expect(activation.prepare()).toBe(true);
    activation.dispose();
  });

  it('reports module failure and can recover on a subsequent request', async () => {
    const h = harness(), pending = deferred<typeof module>(), changed = vi.fn();
    const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(module);
    const activation = new LargeLightActivation(h.context, h.budget, changed, load);
    activation.set(scene(256)); pending.reject(new Error('offline'));
    await vi.waitFor(() => expect(activation.failure).toBeInstanceOf(Error));
    expect(activation.pending).toBe(false); activation.set(scene(512));
    await vi.waitFor(() => expect(activation.prepare()).toBe(true));
    expect(activation.runtime?.counts).toEqual([512, 0]);
    activation.set(scene(3)); expect(h.budget.snapshot().retainedBytes).toBe(0); activation.dispose();
  });

  it('adapts production GLSL with compact declarations and loop conditions', () => {
    const source = readFileSync('packages/renderer-webgl/src/webgl/shaders/surface.frag', 'utf8')
      .replace(/[ \t]*([<;{}])[ \t]*/g, '$1');
    const result = largeLightShader(source);
    expect(result).toContain('index < largeLightCounts.x');
    expect(result).toContain('index < largeLightCounts.y');
    expect(result).not.toMatch(/(?:directional|punctual)Light(?:Colors|Directions|Positions|SpotCones)\[/);
  });

  it('rejects partial shader rewrites when a declaration or loop changes', () => {
    const source = readFileSync('packages/renderer-webgl/src/webgl/shaders/surface.frag', 'utf8');
    for (const token of [
      'uniform vec4 directionalLightColors[MAX_DIRECTIONAL_LIGHTS];',
      'uniform vec4 punctualLightColors[MAX_PUNCTUAL_LIGHTS];',
      'index < MAX_DIRECTIONAL_LIGHTS',
      'index < MAX_PUNCTUAL_LIGHTS',
    ]) expect(() => largeLightShader(source.replace(token, 'changed'))).toThrow(/replacement failed/);
  });

  it('reuses Royal light loops without changing the BRDF or material composition', () => {
    const source = readFileSync('packages/renderer-webgl/src/webgl/shaders/surface.frag', 'utf8');
    const result = largeLightShader(source);
    expect(result).toContain('index < largeLightCounts.x');
    expect(result).toContain('index < largeLightCounts.y');
    expect(result).not.toContain('directionalLightColors[index]');
    expect(result).not.toContain('punctualLightColors[index]');
    expect(result.slice(result.indexOf('const float PI'), result.indexOf('__PRESENTATION_FUNCTIONS__')))
      .toBe(source.slice(source.indexOf('const float PI'), source.indexOf('__PRESENTATION_FUNCTIONS__')));
    expect(result.slice(result.lastIndexOf('#if defined(STUDIO_ENVIRONMENT)')))
      .toBe(source.slice(source.lastIndexOf('#if defined(STUDIO_ENVIRONMENT)')));
  });
});
