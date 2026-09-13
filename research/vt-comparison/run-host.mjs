import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const retentionWindows = Number(process.env.VT_RETENTION_WINDOWS ?? 0);
if (!Number.isInteger(retentionWindows) || retentionWindows < 0 || retentionWindows > 12
  || (retentionWindows && process.env.VT_PROFILE)) throw new Error('VT_RETENTION_WINDOWS must be 1..12 and cannot be combined with VT_PROFILE');
const snapshotPrefix = process.env.VT_HEAP_SNAPSHOTS;
if (snapshotPrefix && !retentionWindows) throw new Error('VT_HEAP_SNAPSHOTS requires retention mode');
const profile = await mkdtemp(join(tmpdir(), 'royal-vt-host-'));
const angle = process.env.VT_ANGLE ?? 'vulkan';
const browser = spawn(process.env.CHROMIUM_BIN ?? '/usr/bin/chromium', [
  '--headless=new', '--enable-gpu', `--use-angle=${angle}`, '--ignore-gpu-blocklist',
  ...(angle === 'vulkan' ? ['--enable-features=Vulkan', '--disable-vulkan-surface'] : []),
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  '--enable-precise-memory-info',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let diagnostics = ''; browser.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-8000); });
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await delay(100); }
  }
  if (!port) throw new Error(`Browser startup failed: ${diagnostics}`);
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(process.env.VT_BENCH_URL ?? 'http://127.0.0.1:5184/research/vt-comparison/index.html')}`, { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0; const pending = new Map();
  const gcEvents = []; let traceDone, heapChunks;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'HeapProfiler.addHeapSnapshotChunk') heapChunks?.push(message.params.chunk);
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args.map(a => a.value ?? '').join(' ');
      if (text.startsWith('VT scene complete:')) console.log(text);
    }
    if (message.method === 'Tracing.dataCollected') for (const event of message.params.value) {
      if (event.ph === 'X' && (event.name === 'MinorGC' || event.name === 'MajorGC')) gcEvents.push(event);
    }
    if (message.method === 'Tracing.tracingComplete') traceDone?.();
    const entry = pending.get(message.id); if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result); }
  };
  const call = (method, params) => new Promise((resolve, reject) => {
    const request = ++id;
  const timer = setTimeout(() => { pending.delete(request); reject(new Error(`CDP timeout: ${method}`)); }, 300000);
    pending.set(request, { resolve, reject, timer }); socket.send(JSON.stringify({ id: request, method, params }));
  });
  const snapshotPaths = {};
  const takeHeapSnapshot = async label => {
    if (!snapshotPrefix) return;
    heapChunks = [];
    await call('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    const path = `${snapshotPrefix}-${label}.heapsnapshot`;
    await writeFile(path, heapChunks.join(''));
    heapChunks = undefined;
    snapshotPaths[label] = path;
  };
  for (let i = 0; i < 100; i++) {
    const status = await call('Runtime.evaluate', { expression: "typeof window.runVTComparison === 'function'", returnByValue: true });
    if (status.result.value) break;
    if (i === 99) throw new Error('Benchmark module did not load');
    await delay(100);
  }
  const probe = await call('Runtime.evaluate', { expression: "(() => {const g=document.createElement('canvas').getContext('webgl2'); if(!g) return 'unavailable'; const e=g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';})()", returnByValue: true });
  console.log('Renderer:', probe.result.value);
  if (/swiftshader|llvmpipe|software|unavailable|unknown/i.test(probe.result.value)) throw new Error(`Hardware renderer not available: ${diagnostics}`);
  await call('Runtime.enable', {});
  const prepared = await call('Runtime.evaluate', { expression: '(async () => { if (!window.prepareVTComparison) return false; await window.prepareVTComparison(); return true; })()', awaitPromise: true, returnByValue: true });
  if (prepared.exceptionDetails) throw new Error(JSON.stringify(prepared.exceptionDetails));
  if (retentionWindows && !prepared.result.value) throw new Error('Retention measurement requires a prepareVTComparison hook');
  await call('HeapProfiler.collectGarbage', {});
  const heapBefore = await call('Runtime.getHeapUsage', {});
  await takeHeapSnapshot('before');
  if (!retentionWindows) await call('Tracing.start', { categories: 'v8,devtools.timeline', transferMode: 'ReportEvents' });
  if (process.env.VT_PROFILE) {
    await call('Profiler.enable', {}); await call('Profiler.start', {});
    await call('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  }
  let result;
  const heaps = [heapBefore];
  for (let window = 0; window < (retentionWindows || 1); window++) {
    result = await call('Runtime.evaluate', { expression: 'window.runVTComparison()', awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    if (retentionWindows) {
      await call('HeapProfiler.collectGarbage', {});
      heaps.push(await call('Runtime.getHeapUsage', {}));
      console.log(`Retention window ${window + 1}: ${heaps.at(-1).usedSize} live JS bytes`);
    }
  }
  let cpuProfile, heapProfile;
  if (process.env.VT_PROFILE) {
    cpuProfile = (await call('Profiler.stop', {})).profile;
    heapProfile = (await call('HeapProfiler.stopSampling', {})).profile;
  }
  if (!retentionWindows) {
    const traceComplete = new Promise(resolve => { traceDone = resolve; });
    await call('Tracing.end', {}); await traceComplete;
    await call('HeapProfiler.collectGarbage', {});
  }
  const heapAfter = retentionWindows ? heaps.at(-1) : await call('Runtime.getHeapUsage', {});
  await takeHeapSnapshot('after');
  const finished = await call('Runtime.evaluate', { expression: 'window.finishVTComparison?.()', awaitPromise: true, returnByValue: true });
  if (finished.exceptionDetails) throw new Error(JSON.stringify(finished.exceptionDetails));
  if (finished.result.value) Object.assign(result.result.value, finished.result.value);
  if (retentionWindows) result.result.value.retention = { windows: retentionWindows, heaps,
    note: 'One preparation across all windows; per-window behavior belongs to the fixture. Forced GC between windows, without tracing or sampling. Finish-hook diagnostics run after the last heap sample.' };
  else result.result.value.gc = { events: gcEvents.length, totalMs: gcEvents.reduce((sum, e) => sum + e.dur / 1000, 0),
    maxMs: Math.max(0, ...gcEvents.map(e => e.dur / 1000)), heapBefore, heapAfter,
    note: prepared.result.value ? 'Warm-up and final diagnostics are excluded from the trace. Forced-GC heaps retain the live scene before/after measurement.'
      : 'Aggregate renderer-process trace includes benchmark setup and diagnostic allocations; heaps measured after forced GC before/after the complete run.' };
  const cleanup = await call('Runtime.evaluate', { expression: 'window.cleanupVTComparison?.()', awaitPromise: true, returnByValue: true });
  if (cleanup.exceptionDetails) throw new Error(JSON.stringify(cleanup.exceptionDetails));
  await takeHeapSnapshot('disposed');
  if (snapshotPrefix) result.result.value.heapSnapshots = { paths: snapshotPaths,
    note: 'Snapshots perturb the benchmark and may trigger additional GC. Before/after captures bracket replacement windows; disposed capture follows cleanup. Use separate runs without snapshots for uninstrumented heap trends.' };
  if (cpuProfile) {
    const { TraceMap, originalPositionFor } = createRequire(import.meta.resolve('vite'))('@jridgewell/trace-mapping');
    const maps = new Map();
    const locate = async frame => {
      if (!/^https?:/.test(frame.url) || frame.lineNumber < 0 || frame.columnNumber < 0) return {};
      if (!maps.has(frame.url)) maps.set(frame.url, (async () => {
        try { const response = await fetch(frame.url + '.map'); return response.ok ? new TraceMap(await response.json(), frame.url + '.map') : undefined; } catch { return undefined; }
      })());
      const map = await maps.get(frame.url);
      return map ? originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber }) : {};
    };
    const rows = [];
    const visit = node => { if (node.selfSize) rows.push(node); node.children.forEach(visit); }; visit(heapProfile.head);
    const output = process.env.VT_BENCH_OUTPUT ?? 'research/vt-comparison/host-results.json';
    const cpuPath = output.replace(/\.json$/, '.cpuprofile'), heapPath = output.replace(/\.json$/, '.heapprofile');
    await writeFile(cpuPath, JSON.stringify(cpuProfile)); await writeFile(heapPath, JSON.stringify(heapProfile));
    result.result.value.profile = {
      cpu: await Promise.all(cpuProfile.nodes.filter(n => n.hitCount).sort((a, b) => b.hitCount - a.hitCount).slice(0, 30).map(async n => ({ name: n.callFrame.functionName, url: n.callFrame.url, hits: n.hitCount, original: await locate(n.callFrame) }))),
      allocations: await Promise.all(rows.sort((a, b) => b.selfSize - a.selfSize).slice(0, 30).map(async n => ({ name: n.callFrame.functionName, url: n.callFrame.url, bytes: n.selfSize, original: await locate(n.callFrame) }))),
      cpuPath, heapPath, note: 'Sampling adds overhead; use profiles for attribution, not frame-rate comparisons. Source locations require VT_SOURCEMAP=1 during the client build.' };
  }
  result.result.value.renderer = probe.result.value;
  const imageDirectory = (process.env.VT_BENCH_OUTPUT ?? 'research/vt-comparison/host-results.json').replace(/\.json$/, '-images');
  for (const row of result.result.value.results ?? []) if (row.screenshot) {
    await mkdir(imageDirectory, { recursive: true });
    const file = `${row.name}-${row.minFilter}.png`;
    await writeFile(join(imageDirectory, file), Buffer.from(row.screenshot.split(',')[1], 'base64'));
    row.screenshot = join(imageDirectory, file);
  }
  await writeFile(process.env.VT_BENCH_OUTPUT ?? 'research/vt-comparison/host-results.json', JSON.stringify(result.result.value, null, 2) + '\n');
  console.log(JSON.stringify(result.result.value, null, 2));
} finally {
  socket?.close();
  browser.kill();
  await new Promise(resolve => { if (browser.exitCode !== null || browser.signalCode !== null) resolve(); else browser.once('exit', resolve); });
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
