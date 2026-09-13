import { readFile, writeFile } from 'node:fs/promises';
import { PerformanceObserver } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
const path = process.env.VT_BASELINE_FILE ?? '/tmp/royal-vt-before-pool-requests-runtime.ts';
const runtime = await readFile(path, 'utf8');
const block = runtime.match(/poolRequests\.set\(key, \{ key,[\s\S]*?\n        \}\);/)?.[0];
if (!block) throw new Error('Pool request construction not found');
const before = block.replaceAll('this.#atlasMinimumSlots', 'minimumSlots').replaceAll('this.#atlasDemand', 'demand').replaceAll(')!', ')');
const after = `const request = poolRequests.get(key) ?? { key, minimumBytes: 0, wantedBytes: 0 };
request.minimumBytes = Math.max(1, minimumSlots.get(key)) * bytesPerPage;
request.wantedBytes = 2 ** Math.ceil(Math.log2(Math.max(1, demand.get(key)))) * bytesPerPage;
poolRequests.set(key, request);`;
const functions = {};
for (const [name, body] of Object.entries({ before, after })) {
  functions[name] = new Function('input', 'demand', 'demandBytes', 'minimumSlots', `
    demand.clear(); demandBytes.clear(); minimumSlots.clear();
    const poolRequests = new Map();
    for (const {key, count, bytesPerPage} of input) {
      demand.set(key, (demand.get(key) ?? 0) + count);
      demandBytes.set(key, (demandBytes.get(key) ?? 0) + count * bytesPerPage);
      minimumSlots.set(key, (minimumSlots.get(key) ?? 0) + (count > 0 ? 1 : 0));
      ${body}
    }
    return poolRequests;
  `);
}
const maps = () => [new Map(), new Map(), new Map()];
let seed = 1729;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
let comparisons = 0;
for (let trial = 0; trial < 10000; trial++) {
  const pools = 1 + Math.floor(random() * 8);
  const input = Array.from({ length: Math.floor(random() * 257) }, () => {
    const pool = Math.floor(random() * pools);
    return { key: String(pool), count: Math.floor(random() * 129), bytesPerPage: (132 + pool * 4) ** 2 * 4 };
  });
  if (JSON.stringify([...functions.before(input, ...maps())]) !== JSON.stringify([...functions.after(input, ...maps())])) throw new Error(`Mismatch ${trial}`);
  comparisons++;
}
const events = [], results = [];
const observer = new PerformanceObserver(list => events.push(...list.getEntries()));
observer.observe({ entryTypes: ['gc'] });
let checksum = 0;
try {
  for (const [count, pools] of [[1,1],[8,1],[64,1],[256,1],[64,4],[64,8]]) {
    const input = Array.from({ length: count }, (_, i) => ({ key: String(i % pools), count: 1 + i % 32, bytesPerPage: (132 + (i % pools) * 4) ** 2 * 4 }));
    const contexts = { before: maps(), after: maps() };
    const iterations = Math.floor(200000 / Math.sqrt(count));
    for (const name of ['before','after']) for (let i=0;i<10000;i++) functions[name](input,...contexts[name]);
    for (let round=0;round<4;round++) for (const name of round%2 ? ['after','before'] : ['before','after']) {
      global.gc();
      const start=performance.now(), cpuStart=process.cpuUsage();
      for(let i=0;i<iterations;i++) checksum += functions[name](input,...contexts[name]).get('0').wantedBytes;
      const end=performance.now(), cpu=process.cpuUsage(cpuStart);
      await new Promise(resolve=>setTimeout(resolve,0));
      const gc=events.filter(e=>e.startTime>=start&&e.startTime<end);
      results.push({count,pools,round,version:name,iterations,cpuMs:(cpu.user+cpu.system)/1000,elapsedMs:end-start,gcEvents:gc.length});
    }
  }
  await writeFile('research/vt-comparison/pool-request-experiment.json',JSON.stringify({sourceHash:createHash('sha256').update(runtime).digest('hex'),before,after,comparisons,results,checksum,node:process.version,nodeOptions:process.execArgv,note:'Isolated request construction with shared demand maps cleared each call, as in runtime. Native-format branches and other frame work excluded. Synthetic counts represent eligible image resources sharing 1, 4 or 8 pools.'},null,2)+'\n');
} finally { observer.disconnect(); }
