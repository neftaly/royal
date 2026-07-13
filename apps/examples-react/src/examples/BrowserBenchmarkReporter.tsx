/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { Example } from '../examples';
import {
  exampleContract,
  readRendererBenchmarkSnapshot,
  type RendererBenchmarkSnapshot,
} from '../example-contract';

type BrowserBenchmarkCounters = {
  readonly bindBuffer: number;
  readonly bindTexture: number;
  readonly bindVertexArray: number;
  readonly bufferDataBytes: number;
  readonly bufferDataCalls: number;
  readonly bufferSubDataBytes: number;
  readonly bufferSubDataCalls: number;
  readonly copyTexImage2D: number;
  readonly copyTexSubImage2D: number;
  readonly drawArrays: number;
  readonly drawArraysInstanced: number;
  readonly drawElements: number;
  readonly drawElementsInstanced: number;
  readonly texImage2D: number;
  readonly texSubImage2D: number;
  readonly uniformCalls: number;
  readonly uniformMatrixCalls: number;
  readonly useProgram: number;
};

type BrowserBenchmarkSnapshot = BrowserBenchmarkCounters & {
  readonly drawCalls: number;
  readonly instancedDrawCalls: number;
  readonly nonInstancedDrawCalls: number;
  readonly stateChanges: number;
};

type BrowserBenchmarkApi = {
  readonly reset: () => void;
  readonly snapshot: () => BrowserBenchmarkSnapshot;
};

type BrowserBenchmarkGlobal = typeof globalThis & {
  __royalBrowserBenchmarkError?: string;
  __royalBrowserBenchmarkReport?: BrowserBenchmarkReport;
  __royalBrowserBench?: BrowserBenchmarkApi;
};

type BrowserBenchmarkOptions = {
  readonly autorun: boolean;
  readonly frames: number;
  readonly timeoutMs: number;
  readonly warmupFrames: number;
};

type RendererBenchmarkDeltaSnapshot = Pick<
  RendererBenchmarkSnapshot,
  'frame' | 'gltfInstancing' | 'virtualTexturing'
> & { readonly resourceGovernor: null };

type BrowserBenchmarkReport = {
  readonly device: Record<string, unknown>;
  readonly example: Pick<Example, 'id' | 'path' | 'sourceFile' | 'title'>;
  readonly frameStats: ReturnType<typeof frameStats>;
  readonly generatedAt: string;
  readonly gl: {
    readonly frames: BrowserBenchmarkSnapshot;
    readonly setup: BrowserBenchmarkSnapshot;
  };
  readonly options: BrowserBenchmarkOptions;
  readonly performance: {
    readonly navigation: Record<string, number | string | null>;
    readonly resources: {
      readonly count: number;
      readonly totalDecodedBodySize: number;
      readonly totalEncodedBodySize: number;
      readonly totalTransferSize: number;
    };
  };
  readonly ready: boolean;
  readonly renderer: {
    readonly after: RendererBenchmarkSnapshot | null;
    readonly beforeFrames: RendererBenchmarkSnapshot | null;
    readonly delta: RendererBenchmarkDeltaSnapshot | null;
    readonly setup: RendererBenchmarkSnapshot | null;
  };
  readonly url: string;
  readonly warmupComplete: boolean;
  readonly warnings: readonly string[];
  readonly wallMs: number;
};

const counterKeys = exampleContract.benchmark.browserGlCounterFields as readonly (
  keyof BrowserBenchmarkCounters
)[];

const uniformCallNames = [
  'uniform1f',
  'uniform1fv',
  'uniform1i',
  'uniform1iv',
  'uniform1ui',
  'uniform1uiv',
  'uniform2f',
  'uniform2fv',
  'uniform2i',
  'uniform2iv',
  'uniform2ui',
  'uniform2uiv',
  'uniform3f',
  'uniform3fv',
  'uniform3i',
  'uniform3iv',
  'uniform3ui',
  'uniform3uiv',
  'uniform4f',
  'uniform4fv',
  'uniform4i',
  'uniform4iv',
  'uniform4ui',
  'uniform4uiv',
  'uniformMatrix2fv',
  'uniformMatrix2x3fv',
  'uniformMatrix2x4fv',
  'uniformMatrix3fv',
  'uniformMatrix3x2fv',
  'uniformMatrix3x4fv',
  'uniformMatrix4fv',
  'uniformMatrix4x2fv',
  'uniformMatrix4x3fv',
] as const;

const createCounters = (): Record<keyof BrowserBenchmarkCounters, number> => ({
  bindBuffer: 0,
  bindTexture: 0,
  bindVertexArray: 0,
  bufferDataBytes: 0,
  bufferDataCalls: 0,
  bufferSubDataBytes: 0,
  bufferSubDataCalls: 0,
  copyTexImage2D: 0,
  copyTexSubImage2D: 0,
  drawArrays: 0,
  drawArraysInstanced: 0,
  drawElements: 0,
  drawElementsInstanced: 0,
  texImage2D: 0,
  texSubImage2D: 0,
  uniformCalls: 0,
  uniformMatrixCalls: 0,
  useProgram: 0,
});

const numberParam = (
  params: URLSearchParams,
  name: string,
  fallback: number,
  minimum: number,
): number => {
  const value = Number.parseInt(params.get(name) ?? '', 10);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
};

const benchmarkOptions = (): BrowserBenchmarkOptions => {
  const params = new URL(globalThis.location.href).searchParams;
  return {
    autorun: params.get('autorun') === '1' || params.get('bench') === 'auto',
    frames: numberParam(params, 'frames', 120, 1),
    timeoutMs: numberParam(params, 'timeoutMs', 30_000, 100),
    warmupFrames: numberParam(params, 'warmup', 20, 0),
  };
};

export const isBrowserBenchmarkEnabled = (): boolean => {
  if (typeof globalThis.location?.href !== 'string') return false;
  const value = new URL(globalThis.location.href).searchParams.get('bench');
  return value === 'auto';
};

const byteLengthOf = (value: unknown): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null && 'byteLength' in value) {
    const byteLength = value.byteLength;
    return typeof byteLength === 'number' && Number.isFinite(byteLength) ? byteLength : 0;
  }
  if (typeof value === 'object' && value !== null && 'length' in value) {
    const length = value.length;
    return typeof length === 'number' && Number.isFinite(length) ? length : 0;
  }
  return 0;
};

const elementByteLengthOf = (value: unknown): number => {
  if (typeof value === 'object' && value !== null && 'BYTES_PER_ELEMENT' in value) {
    const bytesPerElement = value.BYTES_PER_ELEMENT;
    return typeof bytesPerElement === 'number' && Number.isFinite(bytesPerElement) ? bytesPerElement : 1;
  }
  return 1;
};

const bufferSubDataByteLength = (args: readonly unknown[]): number => {
  const source = args[2];
  const sourceByteLength = byteLengthOf(source);
  const bytesPerElement = elementByteLengthOf(source);
  const sourceOffset = typeof args[3] === 'number' && Number.isFinite(args[3]) ? Math.max(0, args[3]) : 0;
  const sourceLength = args[4];
  if (typeof sourceLength === 'number' && Number.isFinite(sourceLength)) {
    return Math.max(0, sourceLength) * bytesPerElement;
  }
  return Math.max(0, sourceByteLength - sourceOffset * bytesPerElement);
};

const browserBenchSnapshot = (
  counters: Record<keyof BrowserBenchmarkCounters, number>,
): BrowserBenchmarkSnapshot => ({
  bindBuffer: counters.bindBuffer,
  bindTexture: counters.bindTexture,
  bindVertexArray: counters.bindVertexArray,
  bufferDataBytes: counters.bufferDataBytes,
  bufferDataCalls: counters.bufferDataCalls,
  bufferSubDataBytes: counters.bufferSubDataBytes,
  bufferSubDataCalls: counters.bufferSubDataCalls,
  copyTexImage2D: counters.copyTexImage2D,
  copyTexSubImage2D: counters.copyTexSubImage2D,
  drawArrays: counters.drawArrays,
  drawArraysInstanced: counters.drawArraysInstanced,
  drawCalls: counters.drawArrays + counters.drawElements + counters.drawArraysInstanced + counters.drawElementsInstanced,
  drawElements: counters.drawElements,
  drawElementsInstanced: counters.drawElementsInstanced,
  instancedDrawCalls: counters.drawArraysInstanced + counters.drawElementsInstanced,
  nonInstancedDrawCalls: counters.drawArrays + counters.drawElements,
  stateChanges: counters.bindBuffer + counters.bindTexture + counters.bindVertexArray + counters.useProgram,
  texImage2D: counters.texImage2D,
  texSubImage2D: counters.texSubImage2D,
  uniformCalls: counters.uniformCalls,
  uniformMatrixCalls: counters.uniformMatrixCalls,
  useProgram: counters.useProgram,
});

const patchPrototype = (prototype: unknown, counters: Record<keyof BrowserBenchmarkCounters, number>): void => {
  if (typeof prototype !== 'object' || prototype === null) return;
  const target = prototype as Record<string, unknown>;
  const patch = (name: string, handler: (args: readonly unknown[]) => void): void => {
    const original = target[name];
    if (typeof original !== 'function' || (original as { __royalBrowserBenchPatched?: boolean }).__royalBrowserBenchPatched === true) {
      return;
    }
    const wrapped = function browserBenchmarkWrapped(this: unknown, ...args: unknown[]) {
      handler(args);
      return Reflect.apply(original, this, args);
    };
    Object.defineProperty(wrapped, '__royalBrowserBenchPatched', { value: true });
    target[name] = wrapped;
  };

  patch('bindBuffer', () => { counters.bindBuffer += 1; });
  patch('bindTexture', () => { counters.bindTexture += 1; });
  patch('bindVertexArray', () => { counters.bindVertexArray += 1; });
  patch('drawArrays', () => { counters.drawArrays += 1; });
  patch('drawElements', () => { counters.drawElements += 1; });
  patch('drawArraysInstanced', () => { counters.drawArraysInstanced += 1; });
  patch('drawElementsInstanced', () => { counters.drawElementsInstanced += 1; });
  patch('bufferData', (args) => {
    counters.bufferDataCalls += 1;
    counters.bufferDataBytes += byteLengthOf(args[1]);
  });
  patch('bufferSubData', (args) => {
    counters.bufferSubDataCalls += 1;
    counters.bufferSubDataBytes += bufferSubDataByteLength(args);
  });
  patch('copyTexImage2D', () => { counters.copyTexImage2D += 1; });
  patch('copyTexSubImage2D', () => { counters.copyTexSubImage2D += 1; });
  patch('texImage2D', () => { counters.texImage2D += 1; });
  patch('texSubImage2D', () => { counters.texSubImage2D += 1; });
  patch('useProgram', () => { counters.useProgram += 1; });
  for (const name of uniformCallNames) {
    patch(name, () => {
      counters.uniformCalls += 1;
      if (name.startsWith('uniformMatrix')) counters.uniformMatrixCalls += 1;
    });
  }
};

export const installBrowserBenchmarkHooks = (): void => {
  const bridge = globalThis as BrowserBenchmarkGlobal;
  if (bridge.__royalBrowserBench !== undefined) return;

  const counters = createCounters();
  patchPrototype(globalThis.WebGLRenderingContext?.prototype, counters);
  patchPrototype(globalThis.WebGL2RenderingContext?.prototype, counters);
  bridge.__royalBrowserBench = {
    reset: () => {
      for (const key of counterKeys) counters[key] = 0;
    },
    snapshot: () => browserBenchSnapshot(counters),
  };
};

const rendererSnapshot = (): RendererBenchmarkSnapshot | null =>
  readRendererBenchmarkSnapshot();

const deltaNumberRecord = (
  after: Record<string, number> | null,
  before: Record<string, number> | null,
): Record<string, number> | null => {
  if (after === null || before === null) return null;
  const delta: Record<string, number> = {};
  for (const [key, value] of Object.entries(after)) {
    delta[key] = value - (before[key] ?? 0);
  }
  return delta;
};

const deltaRendererSnapshot = (
  after: RendererBenchmarkSnapshot | null,
  before: RendererBenchmarkSnapshot | null,
): RendererBenchmarkDeltaSnapshot | null => {
  if (after === null || before === null) return null;
  return {
    frame: after.frame - before.frame,
    gltfInstancing: deltaNumberRecord(after.gltfInstancing, before.gltfInstancing),
    // Governor snapshots mix cumulative counters with current/high-water gauges.
    // Keep the complete before/after snapshots instead of publishing a
    // misleading recursively-subtracted object as the frame delta.
    resourceGovernor: null,
    virtualTexturing: deltaNumberRecord(after.virtualTexturing, before.virtualTexturing),
  };
};

const frameStats = (deltas: readonly number[], requestedSampleCount: number, timeoutMs: number) => {
  const sorted = [...deltas].sort((left, right) => left - right);
  const sum = sorted.reduce((total, value) => total + value, 0);
  const percentile = (ratio: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
  return {
    averageMs: sorted.length === 0 ? 0 : sum / sorted.length,
    complete: sorted.length === requestedSampleCount,
    failed: sorted.length === 0,
    jitterP95MinusP50Ms: percentile(0.95) - percentile(0.5),
    maxMs: sorted[sorted.length - 1] ?? 0,
    minMs: sorted[0] ?? 0,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    requestedSampleCount,
    sampleCount: sorted.length,
    samplesMissing: Math.max(0, requestedSampleCount - sorted.length),
    timedOut: sorted.length < requestedSampleCount,
    timeoutMs,
  };
};

const nextRaf = (deadline: number): Promise<number | null> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), Math.max(1, deadline - performance.now()));
    requestAnimationFrame((time) => finish(time));
  });

const waitForReady = async (timeoutMs: number): Promise<boolean> => {
  const deadline = performance.now() + timeoutMs;
  let stableResourceCount = -1;
  let stableSince = performance.now();
  while (performance.now() < deadline) {
    const canvas = document.querySelector('canvas');
    const resourceCount = performance.getEntriesByType('resource').length;
    if (resourceCount !== stableResourceCount) {
      stableResourceCount = resourceCount;
      stableSince = performance.now();
    }
    if (document.readyState === 'complete' && canvas !== null && performance.now() - stableSince > 350) {
      return await nextRaf(deadline) !== null && await nextRaf(deadline) !== null;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

const waitFrames = async (
  frames: number,
  timeoutMs: number,
): Promise<boolean> => {
  const deadline = performance.now() + timeoutMs;
  for (let index = 0; index < frames; index += 1) {
    if (await nextRaf(deadline) === null) return false;
  }
  return true;
};

const sampleFrames = async (
  frames: number,
  timeoutMs: number,
): Promise<ReturnType<typeof frameStats>> => {
  const deadline = performance.now() + timeoutMs;
  const deltas: number[] = [];
  let previous = performance.now();
  for (let index = 0; index < frames; index += 1) {
    const current = await nextRaf(deadline);
    if (current === null) break;
    deltas.push(current - previous);
    previous = current;
  }
  return frameStats(deltas, frames, timeoutMs);
};

const performanceSummary = (): BrowserBenchmarkReport['performance'] => {
  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  return {
    navigation: {
      domComplete: navigation?.domComplete ?? null,
      duration: navigation?.duration ?? null,
      loadEventEnd: navigation?.loadEventEnd ?? null,
      startTime: navigation?.startTime ?? null,
      type: navigation?.type ?? null,
    },
    resources: {
      count: resources.length,
      totalDecodedBodySize: resources.reduce((sum, resource) => sum + resource.decodedBodySize, 0),
      totalEncodedBodySize: resources.reduce((sum, resource) => sum + resource.encodedBodySize, 0),
      totalTransferSize: resources.reduce((sum, resource) => sum + resource.transferSize, 0),
    },
  };
};

const deviceSummary = (): BrowserBenchmarkReport['device'] => {
  const extendedNavigator = navigator as Navigator & { readonly deviceMemory?: number };
  const canvas = document.querySelector('canvas');
  const canvasRect = canvas?.getBoundingClientRect();
  const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
  const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info');
  return {
    canvas: {
      cssHeight: canvasRect?.height ?? null,
      cssWidth: canvasRect?.width ?? null,
      height: canvas?.height ?? null,
      width: canvas?.width ?? null,
    },
    deviceMemory: extendedNavigator.deviceMemory ?? null,
    dpr: globalThis.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    language: navigator.language,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    viewport: {
      height: globalThis.innerHeight,
      width: globalThis.innerWidth,
    },
    webgl: gl === null || gl === undefined
      ? null
      : {
          renderer: gl.getParameter(gl.RENDERER) as string,
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string,
          unmaskedRenderer: debugInfo == null ? null : gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string,
          unmaskedVendor: debugInfo == null ? null : gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string,
          vendor: gl.getParameter(gl.VENDOR) as string,
          version: gl.getParameter(gl.VERSION) as string,
        },
  };
};

const benchmarkWarnings = ({
  ready,
  stats,
  warmupComplete,
}: {
  readonly ready: boolean;
  readonly stats: ReturnType<typeof frameStats>;
  readonly warmupComplete: boolean;
}): readonly string[] => {
  const warnings: string[] = [];
  if (!ready) warnings.push('Document/canvas readiness timed out before sampling');
  if (!warmupComplete) warnings.push('Warmup timed out before sampling');
  if (stats.timedOut) warnings.push(`Captured ${stats.sampleCount}/${stats.requestedSampleCount} requested frames`);
  return warnings;
};

const runBrowserBenchmark = async (
  example: Example,
  options: BrowserBenchmarkOptions,
): Promise<BrowserBenchmarkReport> => {
  installBrowserBenchmarkHooks();
  const startedAt = performance.now();
  const bench = (globalThis as BrowserBenchmarkGlobal).__royalBrowserBench;
  if (bench === undefined) throw new Error('Browser benchmark hooks did not install');

  const ready = await waitForReady(options.timeoutMs);
  const setupGl = bench.snapshot();
  const setupRenderer = rendererSnapshot();
  const warmupComplete = await waitFrames(options.warmupFrames, options.timeoutMs);
  bench.reset();
  const beforeFrames = rendererSnapshot();
  const stats = warmupComplete
    ? await sampleFrames(options.frames, options.timeoutMs)
    : frameStats([], options.frames, options.timeoutMs);
  const framesGl = bench.snapshot();
  const afterFrames = rendererSnapshot();
  const warnings = benchmarkWarnings({ ready, stats, warmupComplete });

  return {
    device: deviceSummary(),
    example: {
      id: example.id,
      path: example.path,
      sourceFile: example.sourceFile,
      title: example.title,
    },
    frameStats: stats,
    generatedAt: new Date().toISOString(),
    gl: {
      frames: framesGl,
      setup: setupGl,
    },
    options: {
      autorun: options.autorun,
      frames: options.frames,
      timeoutMs: options.timeoutMs,
      warmupFrames: options.warmupFrames,
    },
    performance: performanceSummary(),
    ready,
    renderer: {
      after: afterFrames,
      beforeFrames,
      delta: deltaRendererSnapshot(afterFrames, beforeFrames),
      setup: setupRenderer,
    },
    url: globalThis.location.href,
    warmupComplete,
    warnings,
    wallMs: performance.now() - startedAt,
  };
};

export const BrowserBenchmarkReporter = ({ example }: { readonly example: Example }): null => {
  const options = useMemo(() => benchmarkOptions(), []);
  const autorunStarted = useRef(false);

  const run = useCallback(async () => {
    const bridge = globalThis as BrowserBenchmarkGlobal;
    delete bridge.__royalBrowserBenchmarkError;
    delete bridge.__royalBrowserBenchmarkReport;
    try {
      const nextReport = await runBrowserBenchmark(example, options);
      bridge.__royalBrowserBenchmarkReport = nextReport;
    } catch (error) {
      bridge.__royalBrowserBenchmarkError = error instanceof Error ? error.message : String(error);
    }
  }, [example, options]);

  useEffect(() => {
    if (!options.autorun || autorunStarted.current) return;
    autorunStarted.current = true;
    void run();
  }, [options.autorun, run]);

  return null;
};
