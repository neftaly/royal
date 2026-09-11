/** Sustained repeated-context probe. Each cycle rechecks CPU and transport parity. */
export const runSoak = async (run, { durationMs = 90 * 60 * 1000 } = {}) => {
  const started = performance.now();
  const cycles = [];
  const options = { size: 512, samples: 3, batch: 16, counts: [256, 512], kinds: ['directional', 'sparse', 'dense'] };
  globalThis.manyLightsSoakProgress = { cycles: 0, elapsedMs: 0 };
  while (performance.now() - started < durationMs) {
    const result = await run({ ...options, orderSeed: cycles.length });
    for (const entry of result.results) {
      for (const key of ['gpuMs', 'completionMs', 'submissionMs']) if (entry[key]) delete entry[key].samples;
    }
    cycles.push({ elapsedMs: performance.now() - started, result });
    globalThis.manyLightsSoakProgress = { cycles: cycles.length, elapsedMs: performance.now() - started, last: result.results.at(-1)?.completionMs };
    document.querySelector('#status').textContent = `Soak cycle ${cycles.length}`;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { date: new Date().toISOString(), durationMs: performance.now() - started, options, cycles,
    capabilities: cycles[0]?.result.capabilities, results: cycles.map(cycle => ({ elapsedMs: cycle.elapsedMs, cases: cycle.result.results.length })) };
};
