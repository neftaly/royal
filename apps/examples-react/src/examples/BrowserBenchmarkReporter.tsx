/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Example } from '../examples';

type BrowserBenchmarkStatus = 'idle' | 'running' | 'done' | 'error';

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
  readonly stateChanges: number;
};

type BrowserBenchmarkApi = {
  readonly reset: () => void;
  readonly snapshot: () => BrowserBenchmarkSnapshot;
};

type RendererBenchmarkSnapshot = {
  readonly frame: number;
  readonly gltfInstancing: Record<string, number> | null;
  readonly virtualTexturing: Record<string, number> | null;
};

type BrowserBenchmarkGlobal = typeof globalThis & {
  __royalBrowserBench?: BrowserBenchmarkApi;
  __royalExamplesRendererBenchmarkSnapshot?: () => RendererBenchmarkSnapshot | null;
};

type BrowserBenchmarkOptions = {
  readonly autorun: boolean;
  readonly frames: number;
  readonly postUrl: string | undefined;
  readonly timeoutMs: number;
  readonly warmupFrames: number;
};

type BrowserBenchmarkReport = {
  readonly device: Record<string, unknown>;
  readonly example: Pick<Example, 'id' | 'path' | 'sourceFile' | 'title'>;
  readonly frameStats: ReturnType<typeof frameStats>;
  readonly generatedAt: string;
  readonly gl: {
    readonly frames: BrowserBenchmarkSnapshot;
    readonly setup: BrowserBenchmarkSnapshot;
  };
  readonly options: Omit<BrowserBenchmarkOptions, 'postUrl'> & { readonly postUrlConfigured: boolean };
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
    readonly delta: RendererBenchmarkSnapshot | null;
    readonly setup: RendererBenchmarkSnapshot | null;
  };
  readonly url: string;
  readonly wallMs: number;
};

const counterKeys = [
  'bindBuffer',
  'bindTexture',
  'bindVertexArray',
  'bufferDataBytes',
  'bufferDataCalls',
  'bufferSubDataBytes',
  'bufferSubDataCalls',
  'copyTexImage2D',
  'copyTexSubImage2D',
  'drawArrays',
  'drawArraysInstanced',
  'drawElements',
  'drawElementsInstanced',
  'texImage2D',
  'texSubImage2D',
  'uniformCalls',
  'uniformMatrixCalls',
  'useProgram',
] as const satisfies readonly (keyof BrowserBenchmarkCounters)[];

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
    postUrl: params.get('post') ?? undefined,
    timeoutMs: numberParam(params, 'timeoutMs', 15_000, 100),
    warmupFrames: numberParam(params, 'warmup', 20, 0),
  };
};

export const isBrowserBenchmarkEnabled = (): boolean => {
  if (typeof globalThis.location?.href !== 'string') return false;
  const value = new URL(globalThis.location.href).searchParams.get('bench');
  return value === '1' || value === 'true' || value === 'auto';
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
  drawCalls: counters.drawArrays + counters.drawElements,
  drawElements: counters.drawElements,
  drawElementsInstanced: counters.drawElementsInstanced,
  instancedDrawCalls: counters.drawArraysInstanced + counters.drawElementsInstanced,
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
    counters.bufferSubDataBytes += byteLengthOf(args[2]);
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
  (globalThis as BrowserBenchmarkGlobal).__royalExamplesRendererBenchmarkSnapshot?.() ?? null;

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
): RendererBenchmarkSnapshot | null => {
  if (after === null || before === null) return null;
  return {
    frame: after.frame - before.frame,
    gltfInstancing: deltaNumberRecord(after.gltfInstancing, before.gltfInstancing),
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
    failed: sorted.length === 0,
    jitterP95MinusP50Ms: percentile(0.95) - percentile(0.5),
    maxMs: sorted[sorted.length - 1] ?? 0,
    minMs: sorted[0] ?? 0,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    requestedSampleCount,
    sampleCount: sorted.length,
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

const sampleFrames = async (
  frames: number,
  warmupFrames: number,
  timeoutMs: number,
): Promise<ReturnType<typeof frameStats>> => {
  const deadline = performance.now() + timeoutMs;
  for (let index = 0; index < warmupFrames; index += 1) {
    if (await nextRaf(deadline) === null) return frameStats([], frames, timeoutMs);
  }

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
  return {
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
  };
};

const postReport = async (postUrl: string, report: BrowserBenchmarkReport): Promise<void> => {
  const response = await fetch(postUrl, {
    body: JSON.stringify(report),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) throw new Error(`POST failed: HTTP ${response.status}`);
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
  const beforeFrames = rendererSnapshot();
  bench.reset();
  const stats = await sampleFrames(options.frames, options.warmupFrames, options.timeoutMs);
  const framesGl = bench.snapshot();
  const afterFrames = rendererSnapshot();

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
      postUrlConfigured: options.postUrl !== undefined,
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
    wallMs: performance.now() - startedAt,
  };
};

const downloadReport = (example: Example, reportText: string): void => {
  const blob = new Blob([reportText, '\n'], { type: 'application/json' });
  const link = document.createElement('a');
  link.download = `${example.id}-browser-benchmark.json`;
  link.href = URL.createObjectURL(blob);
  link.click();
  URL.revokeObjectURL(link.href);
};

export const BrowserBenchmarkReporter = ({ example }: { readonly example: Example }): ReactNode => {
  const options = useMemo(() => benchmarkOptions(), []);
  const autorunStarted = useRef(false);
  const [status, setStatus] = useState<BrowserBenchmarkStatus>('idle');
  const [message, setMessage] = useState<string>('Ready');
  const [report, setReport] = useState<BrowserBenchmarkReport | null>(null);
  const reportText = useMemo(() => report === null ? '' : JSON.stringify(report, null, 2), [report]);

  const run = useCallback(async () => {
    setStatus('running');
    setMessage('Running');
    try {
      const nextReport = await runBrowserBenchmark(example, options);
      setReport(nextReport);
      if (options.autorun && options.postUrl !== undefined) {
        await postReport(options.postUrl, nextReport);
        setMessage('Posted');
      } else {
        setMessage('Done');
      }
      setStatus('done');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  }, [example, options]);

  const copy = useCallback(async () => {
    if (reportText === '') return;
    await navigator.clipboard?.writeText(reportText);
    setMessage('Copied');
  }, [reportText]);

  const post = useCallback(async () => {
    if (report === null || options.postUrl === undefined) return;
    setStatus('running');
    try {
      await postReport(options.postUrl, report);
      setMessage('Posted');
      setStatus('done');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setStatus('error');
    }
  }, [options.postUrl, report]);

  useEffect(() => {
    if (!options.autorun || status !== 'idle' || autorunStarted.current) return;
    autorunStarted.current = true;
    void run();
  }, [options.autorun, run, status]);

  return (
    <aside className="browser-benchmark-panel" aria-live="polite">
      <div className="browser-benchmark-header">
        <h2>Browser benchmark</h2>
        <span data-status={status}>{message}</span>
      </div>
      <dl className="browser-benchmark-metrics">
        <div>
          <dt>Frames</dt>
          <dd>{options.frames}</dd>
        </div>
        <div>
          <dt>p95</dt>
          <dd>{report === null ? '--' : `${report.frameStats.p95Ms.toFixed(1)}ms`}</dd>
        </div>
        <div>
          <dt>State/frame</dt>
          <dd>{report === null ? '--' : (report.gl.frames.stateChanges / Math.max(1, report.frameStats.sampleCount)).toFixed(1)}</dd>
        </div>
      </dl>
      <div className="browser-benchmark-actions">
        <button type="button" onClick={() => void run()} disabled={status === 'running'}>Run</button>
        <button type="button" onClick={() => void copy()} disabled={report === null || status === 'running'}>Copy</button>
        <button
          type="button"
          onClick={() => downloadReport(example, reportText)}
          disabled={report === null || status === 'running'}
        >
          Download
        </button>
        {options.postUrl === undefined ? null : (
          <button type="button" onClick={() => void post()} disabled={report === null || status === 'running'}>
            Post
          </button>
        )}
      </div>
      {reportText === '' ? null : (
        <textarea className="browser-benchmark-output" readOnly value={reportText} />
      )}
    </aside>
  );
};
