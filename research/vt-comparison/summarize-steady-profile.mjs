import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { TraceMap, originalPositionFor } = createRequire(import.meta.resolve('vite'))('@jridgewell/trace-mapping');
const directory = process.env.VT_PROFILE_BUILD ?? 'node_modules/.cache/royal-vt-build-after';
const summaries = [];
for (const file of process.argv.slice(2)) {
  const report = JSON.parse(await readFile(file, 'utf8'));
  const profile = JSON.parse(await readFile(report.profile.heapPath, 'utf8'));
  const urls = new Set();
  const collect = node => { if (/^https?:/.test(node.callFrame.url)) urls.add(node.callFrame.url); node.children.forEach(collect); }; collect(profile.head);
  const maps = new Map(await Promise.all([...urls].map(async url => {
    try { return [url, new TraceMap(JSON.parse(await readFile(directory + new URL(url).pathname + '.map', 'utf8')), url + '.map')]; }
    catch { return [url, undefined]; }
  })));
  const totals = new Map();
  let totalBytes = 0;
  const visit = (node, parent = '(unattributed)') => {
    const frame = node.callFrame, map = maps.get(frame.url);
    const original = map && frame.lineNumber >= 0 && frame.columnNumber >= 0
      ? originalPositionFor(map, { line: frame.lineNumber + 1, column: frame.columnNumber }) : undefined;
    const key = original?.source ? `${original.source.replace(/^.*\/(packages|research)\//, '$1/')}:${original.line}` : parent;
    totals.set(key, (totals.get(key) ?? 0) + node.selfSize); totalBytes += node.selfSize;
    node.children.forEach(child => visit(child, key));
  };
  visit(profile.head);
  summaries.push({ file, sampledBytes: totalBytes, frames: report.results[0].frames,
    allocations: [...totals].filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1]).map(([source, bytes]) => ({ source, bytes })) });
}
await writeFile(process.env.VT_PROFILE_SUMMARY ?? 'research/vt-comparison/steady-allocation-summary.json', JSON.stringify({ summaries,
  note: 'Sampling estimates, not exact allocation counts. Native allocation frames inherit the nearest source-mapped JavaScript ancestor. Source maps must match the captured build.' }, null, 2) + '\n');
