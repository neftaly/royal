import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

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
  const gcEvents = []; let traceDone;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
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
  await call('HeapProfiler.collectGarbage', {});
  const heapBefore = await call('Runtime.getHeapUsage', {});
  await call('Tracing.start', { categories: 'v8,devtools.timeline', transferMode: 'ReportEvents' });
  if (process.env.VT_PROFILE) {
    await call('Profiler.enable', {}); await call('Profiler.start', {});
    await call('HeapProfiler.startSampling', { samplingInterval: 32768, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  }
  const result = await call('Runtime.evaluate', { expression: 'window.runVTComparison()', awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  if (process.env.VT_PROFILE) {
    const { profile } = await call('Profiler.stop', {});
    const allocations = await call('HeapProfiler.stopSampling', {});
    const rows = []; const visit = node => {
      if (node.selfSize) rows.push({ name: node.callFrame.functionName, url: node.callFrame.url, bytes: node.selfSize });
      for (const child of node.children) visit(child);
    }; visit(allocations.profile.head);
    result.result.value.profile = {
      cpu: profile.nodes.filter(n => n.hitCount).sort((a,b) => b.hitCount - a.hitCount).slice(0, 25).map(n => ({ name: n.callFrame.functionName, url: n.callFrame.url, hits: n.hitCount })),
      allocations: rows.sort((a,b) => b.bytes - a.bytes).slice(0, 25),
      note: 'Sampling profiles add overhead; use these for attribution, not frame-rate comparisons.' };
  }
  const traceComplete = new Promise(resolve => { traceDone = resolve; });
  await call('Tracing.end', {}); await traceComplete;
  await call('HeapProfiler.collectGarbage', {});
  const heapAfter = await call('Runtime.getHeapUsage', {});
  result.result.value.gc = { events: gcEvents.length, totalMs: gcEvents.reduce((sum, e) => sum + e.dur / 1000, 0),
    maxMs: Math.max(0, ...gcEvents.map(e => e.dur / 1000)), heapBefore, heapAfter,
    note: 'Aggregate renderer-process trace includes benchmark setup and diagnostic allocations; heaps measured after forced GC before/after the complete run.' };
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
