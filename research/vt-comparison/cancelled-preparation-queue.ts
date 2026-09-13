import { AsyncPreparationOwner } from '../../packages/renderer-webgl/src/resource/async-preparation-owner';
const owner = new AsyncPreparationOwner(1);
const stalled = new URLSearchParams(location.search).has('stalled');
const interior = new URLSearchParams(location.search).has('interior');
const heads: Promise<void>[] = [];
let finish: () => void, active: Promise<void>, windows = 0, starts = 0;
export function prepare() {
  active = owner.runForeground(new AbortController().signal, () => new Promise<void>(resolve => { finish = resolve; }));
  if (interior) {
    heads.push(owner.run(new AbortController().signal, async () => {}));
    heads.push(owner.runForeground(new AbortController().signal, async () => {}));
  }
}
export async function run() {
  if (interior && !stalled && windows === 3) {
    finish(); await active; await Promise.all(heads); heads.length = 0;
    active = owner.runForeground(new AbortController().signal, () => new Promise<void>(resolve => { finish = resolve; }));
  }
  const start = performance.now();
  for (let index = 0; index < 1000; index++) {
    const controller = new AbortController();
    const job = (index % 2 ? owner.run : owner.runForeground)(controller.signal, async () => { starts++; });
    controller.abort();
    try { await job; throw new Error('Cancelled preparation unexpectedly resolved'); }
    catch (error) { if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error; }
  }
  windows++;
  const snapshot = owner.snapshot();
  if (starts !== 0 || snapshot.activeJobs !== 1 || snapshot.queuedJobs !== (interior && (stalled || windows <= 3) ? 2 : 0)) throw new Error('Queue contract failed');
  return { windows, interior, stalled, cancelledJobs: windows * 1000, elapsedMs: performance.now() - start, snapshot,
    note: 'One held active job; 1000 alternating foreground/detail cancellations per window. Interior mode queues one live head per lane, then lets both complete before window four and holds a new active job. Forced-GC heaps retain the owner. No texture decode, upload or frame-time measurement.' };
}
export async function cleanup() { owner.dispose(); finish(); await active; }
