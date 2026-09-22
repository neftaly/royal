import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const engine = process.env.BROWSER_ENGINE ?? 'chromium';
assert(['chromium', 'webkit'].includes(engine));
const browserType = (await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright'))[engine];
const dist = 'packages/renderer-webgl/dist';
const files = await readdir(resolve(root, dist));
const assets = await readdir(resolve(root, dist, 'assets'));
const owner = files.find(name => /^browser-static-preparation-.*\.js$/.test(name));
const inspection = files.find(name => /^inspection-reduction-.*\.js$/.test(name));
const astc = assets.find(name => /^idle-astc-worker-.*\.js$/.test(name));
const gltf = assets.find(name => /^draco-worker-.*\.js$/.test(name));
assert(owner && astc && gltf && inspection, 'Run pnpm build first');
const baselineDist = process.env.WORKERPOOL_BASELINE_DIST;
const baselineOwner = baselineDist === undefined ? undefined : (await readdir(baselineDist)).find(name => /^browser-static-preparation-.*\.js$/.test(name));
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const base = baselineDist !== undefined && pathname.startsWith('/baseline/') ? resolve(baselineDist) : root;
    const path = resolve(base, '.' + (base === root ? pathname : pathname.slice('/baseline'.length)));
    if (!path.startsWith(base + sep) && path !== base) { res.writeHead(403).end(); return; }
    if (path === root) { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>Royal workerpool checks</title>'); return; }
    const body = await readFile(path);
    res.setHeader('content-type', ({ '.js': 'application/javascript', '.mjs': 'application/javascript', '.wasm': 'application/wasm', '.json': 'application/json' })[extname(path)] ?? 'application/octet-stream');
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, deadline;
try {
  browser = await browserType.launch(engine === 'chromium' ? { executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium-browser', headless: true, args: ['--no-sandbox'] } : { headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const cdp = engine === 'chromium' ? await browser.newBrowserCDPSession() : undefined;
  await page.exposeFunction('royalWorkerTargets', async () => {
    if (cdp === undefined) return null;
    const { targetInfos } = await cdp.send('Target.getTargets');
    return targetInfos.filter(target => target.type === 'worker' && target.url.includes(`127.0.0.1:${server.address().port}`)).map(target => ({ id: target.targetId, url: target.url }));
  });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.addScriptTag({ url: '/node_modules/workerpool/dist/workerpool.js' });
  deadline = setTimeout(() => { void page.close(); }, 120000);
  const result = await page.evaluate(async ({ dist, owner, astc, gltf, inspection, baselineOwner }) => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const elapsed = async action => { const start = performance.now(); await action(); return performance.now() - start; };
    const stats = values => { const sorted = [...values].sort((a, b) => a - b); return { medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] }; };
    const workerUrl = name => `/${dist}/assets/${name}?royal-worker-runtime=${encodeURIComponent(location.origin + '/' + dist + '/workerpool-runtime.js')}`;
    const NativeWorker = Worker;
    let created = 0, active = 0, peak = 0;
    globalThis.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); created++; active++; peak = Math.max(peak, active); }
      terminate() { active--; super.terminate(); }
    };
    const { BrowserStaticGltfPreparationOwner } = await import(`/${dist}/${owner}`);
    const makeBytes = () => new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'triangle.bin', byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 }));
    const source = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    let reads = 0, detachedReads = 0;
    const read = async () => { reads++; const data = new Uint8Array(source.buffer.slice(0)); setTimeout(() => { if (data.byteLength === 0) detachedReads++; }, 0); return data; };
    const ownerInstance = new BrowserStaticGltfPreparationOwner({ workerLimit: 2 });
    let prepared;
    const prepare = async () => {
      const bytes = makeBytes();
      prepared = await ownerInstance.prepare(bytes, 'triangle', 'triangle', location.origin + '/triangle.gltf', new AbortController().signal, read);
      check(bytes.byteLength === 0, 'source bytes must transfer');
      check(prepared.primitives.length === 1, 'triangle preparation failed');
    };
    const coldMs = await elapsed(prepare);
    const warm = [];
    for (let i = 0; i < 30; i++) warm.push(await elapsed(prepare));
    check(created === 1, 'sequential preparation should reuse one worker');
    const burstMs = await elapsed(() => Promise.all(Array.from({ length: 20 }, prepare)));
    check(created === 2 && peak === 2, 'burst exceeded two-worker limit');
    // Cancellation during an external read must settle and permit later reuse.
    const controller = new AbortController();
    let reading;
    const started = new Promise(resolve => { reading = resolve; });
    const cancelled = ownerInstance.prepare(makeBytes(), 'cancel', 'cancel', location.origin + '/triangle.gltf', controller.signal, () => { reading(); return new Promise(() => {}); });
    await started; controller.abort();
    try { await cancelled; throw new Error('cancel resolved'); } catch (error) { check(error.name === 'AbortError', 'cancel must use AbortError'); }
    await prepare();
    ownerInstance.dispose();
    check(active === 0, 'glTF pool leaked workers');
    const preparation = { coldMs, warm: stats(warm), burst20Ms: burstMs, workersCreated: created, maxWorkers: peak, reads, detachedReads };

    const astcPool = workerpool.pool(workerUrl(astc), { workerType: 'web', maxWorkers: 1, workerOpts: { type: 'module' } });
    const canvas = new OffscreenCanvas(132, 132);
    const context = canvas.getContext('2d'); context.fillStyle = '#75a640'; context.fillRect(0, 0, 132, 132);
    const pages = [];
    try {
      for (let page = 0; page < 4; page++) {
        const bitmap = await createImageBitmap(canvas);
        const startupMs = await elapsed(() => astcPool.exec('start', [bitmap, 132], { transfer: [bitmap] }));
        const rows = [];
        for (let row = 0; row < 22; row++) {
          let result;
          rows.push(await elapsed(async () => { result = await astcPool.exec('step'); }));
          check(row === 21 ? result instanceof Uint8Array && result.length === 7744 : result === undefined, 'incorrect ASTC row grant');
        }
        pages.push({ startupMs, rows: stats(rows), totalRowsMs: rows.reduce((sum, ms) => sum + ms, 0) });
      }
      check(astcPool.stats().totalWorkers === 1, 'ASTC codec worker was not reused');
    } finally { await astcPool.terminate(true); }

    // Exercise real Draco WASM and transferred results in two workers.
    const base = '/apps/examples-react/public/fixtures/khronos/Duck/glTF-Draco/';
    const doc = await (await fetch(base + 'Duck.gltf')).json();
    const data = new Uint8Array(await (await fetch(base + 'Duck.bin')).arrayBuffer());
    const primitive = doc.meshes[0].primitives[0], extension = primitive.extensions.KHR_draco_mesh_compression;
    const view = doc.bufferViews[extension.bufferView];
    const codecUrls = { draco: location.origin + `/${dist}/draco-codec.js`, meshopt: location.origin + `/${dist}/meshopt-codec.js` };
    const dracoPool = workerpool.pool(workerUrl(gltf), { workerType: 'web', maxWorkers: 2, workerOpts: { type: 'module' } });
    let dracoMs;
    try {
      dracoMs = await elapsed(() => Promise.all(Array.from({ length: 4 }, (_, index) => {
        const bytes = data.slice(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        const task = { bytes, path: `duck-${index}`, label: 'duck', indexAccessor: doc.accessors[primitive.indices], attributes: Object.entries(extension.attributes).map(([semantic, uniqueId]) => ({ semantic, uniqueId, accessor: doc.accessors[primitive.attributes[semantic]], components: semantic.startsWith('TEXCOORD') ? 2 : 3 })) };
        return dracoPool.exec('decodeDraco', [codecUrls, [task]], { transfer: [bytes.buffer] }).then(results => { check(results[0].indices.length > 0 && results[0].attributes.length > 0, 'Draco result missing'); check(bytes.byteLength === 0, 'Draco input was cloned'); });
      })));
      check(dracoPool.stats().totalWorkers === 2, 'Draco concurrency mismatch');
    } finally { await dracoPool.terminate(true); }
    // Compare an already-started preparation lane with cold/warm nested pools.
    const makeTask = index => {
      const bytes = data.slice(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      return { bytes, path: `duck-${index}`, label: 'duck', indexAccessor: doc.accessors[primitive.indices], attributes: Object.entries(extension.attributes).map(([semantic, uniqueId]) => ({ semantic, uniqueId, accessor: doc.accessors[primitive.attributes[semantic]], components: semantic.startsWith('TEXCOORD') ? 2 : 3 })) };
    };
    const thresholds = [];
    for (const count of [2, 4, 8, 16, 32, 64]) {
      const measured = { tasks: count, compressedBytes: count * view.byteLength };
      for (const lanes of [1, 2]) {
        const cold = [], warm = [];
        for (let repeat = 0; repeat < 3; repeat++) {
          const workers = workerpool.pool(workerUrl(gltf), { workerType: 'web', maxWorkers: lanes, workerOpts: { type: 'module' } });
          try {
            // The serial path already has its preparation worker running.
            if (lanes === 1) await workers.exec('methods');
            const execute = () => Promise.all(Array.from({ length: lanes }, (_, lane) => {
              const tasks = Array.from({ length: count / lanes }, (_, index) => makeTask(index + lane * count / lanes));
              return workers.exec('decodeDraco', [codecUrls, tasks], { transfer: tasks.map(task => task.bytes.buffer) }).then(results => check(results.length === count / lanes, 'threshold batch incomplete'));
            }));
            cold.push(await elapsed(execute));
            for (let i = 0; i < 3; i++) warm.push(await elapsed(execute));
          } finally { await workers.terminate(true); }
        }
        measured[lanes === 1 ? 'serial' : 'parallel'] = { cold: stats(cold), warm: stats(warm) };
      }
      thresholds.push(measured);
    }

    // Large repeated preparation must reuse its two nested codec workers.
    const primitiveCount = 2 * Math.ceil(512 * 1024 / (2 * view.byteLength));
    doc.meshes[0].primitives = Array.from({ length: primitiveCount }, () => structuredClone(primitive));
    const duckOwner = new BrowserStaticGltfPreparationOwner({ workerLimit: 1 });
    let nestedDracoMs, nestedWarmMs, nestedWorkers;
    try {
      const prepareDuck = async () => {
        const result = await duckOwner.prepare(new TextEncoder().encode(JSON.stringify(doc)), 'duck', 'duck', location.origin + base + 'Duck.gltf', new AbortController().signal, async uri => new Uint8Array(await (await fetch(uri)).arrayBuffer()));
        check(result.primitives.length === primitiveCount, 'nested Draco preparation failed');
      };
      nestedDracoMs = await elapsed(prepareDuck);
      const first = await globalThis.royalWorkerTargets();
      nestedWorkers = (first ?? []).filter(target => target.url.includes('draco-worker-')).map(target => target.id).sort();
      check(first === null || nestedWorkers.length === 2, 'large preparation must create two codec workers');
      nestedWarmMs = await elapsed(prepareDuck);
      const second = ((await globalThis.royalWorkerTargets()) ?? []).filter(target => target.url.includes('draco-worker-')).map(target => target.id).sort();
      check(JSON.stringify(nestedWorkers) === JSON.stringify(second), 'nested Draco workers were not reused');
      const controller = new AbortController();
      const large = structuredClone(doc);
      large.meshes[0].primitives = Array.from({ length: primitiveCount * 4 }, () => structuredClone(primitive));
      let settled = false;
      const cancelled = duckOwner.prepare(new TextEncoder().encode(JSON.stringify(large)), 'cancel-draco', 'duck', location.origin + base + 'Duck.gltf', controller.signal, async uri => new Uint8Array(await (await fetch(uri)).arrayBuffer())).then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
      await new Promise(resolve => setTimeout(resolve, 20));
      check(!settled, 'nested cancellation workload completed before cancellation');
      controller.abort();
      check((await cancelled)?.name === 'AbortError', 'nested cancellation did not reject');
      await duckOwner.prepare(makeBytes(), 'recovery', 'triangle', location.origin + '/triangle.gltf', new AbortController().signal, read);
      for (let i = 0; i < 100 && ((await globalThis.royalWorkerTargets()) ?? []).some(target => nestedWorkers.includes(target.id)); i++) await new Promise(resolve => setTimeout(resolve, 10));
      const recovered = (await globalThis.royalWorkerTargets()) ?? [];
      check(recovered.every(target => !nestedWorkers.includes(target.id)), 'cancelled parent retained nested codec workers');
    } finally { duckOwner.dispose(); }
    for (let i = 0; i < 100 && ((await globalThis.royalWorkerTargets()) ?? []).length > 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
    check(((await globalThis.royalWorkerTargets()) ?? []).length === 0, 'parent disposal leaked nested workers');

    const retirement = [];
    for (const idleWorkerTimeoutMs of [1000, 5000]) {
      const owner = new BrowserStaticGltfPreparationOwner({ workerLimit: 1, idleWorkerTimeoutMs });
      const before = created, samples = [];
      try {
        for (let i = 0; i < 3; i++) {
          if (i > 0) await new Promise(resolve => setTimeout(resolve, 1200));
          samples.push(await elapsed(() => owner.prepare(makeBytes(), 'triangle', 'triangle', location.origin + '/triangle.gltf', new AbortController().signal, read)));
        }
      } finally { owner.dispose(); }
      retirement.push({ idleWorkerTimeoutMs, gapMs: 1200, workersCreated: created - before, samplesMs: samples });
      check(created - before === (idleWorkerTimeoutMs === 1000 ? 3 : 1), 'idle retirement reuse mismatch');
    }

    const comparison = [];
    if (baselineOwner !== undefined) {
      const { BrowserStaticGltfPreparationOwner: BaselineOwner } = await import(`/baseline/${baselineOwner}`);
      for (const count of [2, primitiveCount]) {
        const document = structuredClone(doc);
        document.meshes[0].primitives = Array.from({ length: count }, () => structuredClone(primitive));
        const measured = { primitives: count };
        for (const [name, Owner] of [['before', BaselineOwner], ['after', BrowserStaticGltfPreparationOwner]]) {
          const cold = [], warm = [];
          for (let repeat = 0; repeat < 3; repeat++) {
            const instance = new Owner({ workerLimit: 1 });
            try {
              const execute = async () => {
                const result = await instance.prepare(new TextEncoder().encode(JSON.stringify(document)), 'duck', 'duck', location.origin + base + 'Duck.gltf', new AbortController().signal, async uri => new Uint8Array(await (await fetch(uri)).arrayBuffer()));
                check(result.primitives.length === count, 'comparison result incomplete');
              };
              cold.push(await elapsed(execute));
              for (let i = 0; i < 3; i++) warm.push(await elapsed(execute));
            } finally { instance.dispose(); }
          }
          measured[name] = { cold: stats(cold), warm: stats(warm) };
        }
        comparison.push(measured);
      }
    }

    // The worker introduced by main shares the same runtime and transfer path.
    const { InspectionReductionWorker } = await import(`/${dist}/${inspection}`);
    const inspectionOwner = new InspectionReductionWorker();
    const inspectionStart = created;
    try {
      for (const [inputWidth, inputHeight] of [[512, 512], [513, 517]]) {
        const rgba = new Uint8Array(inputWidth * inputHeight * 4);
        for (let i = 0; i < rgba.length; i += 4) { rgba[i] = 20; rgba[i + 1] = 40; rgba[i + 2] = 60; rgba[i + 3] = 255; }
        const result = await inspectionOwner.reduce({ rgba, inputWidth, inputHeight, width: 16, height: 16 });
        check(rgba.byteLength === 0 && !result.transparent, 'inspection transfer/transparency mismatch');
        for (let i = 0; i < result.reduced.length; i++) check(Math.abs(result.reduced[i] - [20, 40, 60, 20, 40, 60, 0][i % 7]) < 1e-8, 'inspection pixel mismatch');
      }
      check(created - inspectionStart === 1, 'inspection worker was not reused');
    } finally { inspectionOwner.dispose(); }

    // Compare warm RPC transport with the old raw-worker transport. This is a
    // microbenchmark, not a claim about end-to-end renderer frame performance.
    const rawUrl = URL.createObjectURL(new Blob(['onmessage = ({data}) => postMessage(data, [data]);'], { type: 'text/javascript' }));
    const poolUrl = URL.createObjectURL(new Blob([`importScripts("${location.origin}/node_modules/workerpool/dist/workerpool.js"); workerpool.worker({ roundtrip: buffer => new workerpool.Transfer(buffer, [buffer]) });`], { type: 'text/javascript' }));
    const raw = new Worker(rawUrl);
    const transportPool = workerpool.pool(poolUrl, { workerType: 'web', maxWorkers: 1 });
    const rawCall = buffer => new Promise((resolve, reject) => { raw.onmessage = event => resolve(event.data); raw.onerror = reject; raw.postMessage(buffer, [buffer]); });
    const transport = {};
    try {
      for (const [name, call] of Object.entries({ rawTransfer: rawCall, poolTransfer: buffer => transportPool.exec('roundtrip', [buffer], { transfer: [buffer] }), poolCloneInput: buffer => transportPool.exec('roundtrip', [buffer]) })) {
        await call(new ArrayBuffer(1));
        const times = [];
        for (let i = 0; i < 40; i++) {
          const buffer = new ArrayBuffer(1024 * 1024);
          times.push(await elapsed(async () => { const result = await call(buffer); check(result.byteLength === 1024 * 1024, 'roundtrip size mismatch'); }));
          check(buffer.byteLength === (name === 'poolCloneInput' ? 1024 * 1024 : 0), 'unexpected buffer ownership');
        }
        transport[name] = stats(times);
      }
    } finally { raw.terminate(); await transportPool.terminate(true); URL.revokeObjectURL(rawUrl); URL.revokeObjectURL(poolUrl); }
    check(active === 0, 'worker leak after teardown');
    return { preparation, astc: pages, draco: { fourDecodesMs: dracoMs, workers: 2, nestedPrimitives: primitiveCount, nestedPreparationMs: nestedDracoMs, nestedWarmMs, nestedWorkers: nestedWorkers.length || null, thresholds, comparison }, retirement, transport1MiB: transport, remainingWorkers: active };
  }, { dist, owner, astc, gltf, inspection, baselineOwner });
  clearTimeout(deadline);
  assert.deepEqual(errors, [], 'browser exceptions');
  const report = { engine, browser: await browser.version(), measuredAt: new Date().toISOString(), ...result };
  await writeFile(resolve(root, `research/workerpool/browser-results${engine === 'chromium' ? '' : '-webkit'}.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
