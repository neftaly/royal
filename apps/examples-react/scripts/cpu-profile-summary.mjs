const finiteNonNegative = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const frameIdentity = (frame) => [
  frame.functionName || '(anonymous)',
  frame.url || '',
  frame.lineNumber ?? -1,
  frame.columnNumber ?? -1,
].join('\u0000');

const sortedRows = (rows, totalTimeUs, limit) => [...rows.values()]
  .sort((left, right) => right.selfTimeUs - left.selfTimeUs || right.sampleCount - left.sampleCount)
  .slice(0, limit)
  .map(({ columnNumber, functionName, lineNumber, sampleCount, selfTimeUs, url }) => ({
    columnNumber: columnNumber < 0 ? null : columnNumber + 1,
    functionName,
    lineNumber: lineNumber < 0 ? null : lineNumber + 1,
    sampleCount,
    selfPercent: totalTimeUs === 0 ? 0 : selfTimeUs / totalTimeUs * 100,
    selfTimeMs: selfTimeUs / 1_000,
    url,
  }));

/** Pure aggregation of V8 sampled self-time. CDP lifecycle and file I/O stay outside this module. */
export const summarizeCpuProfile = (profile, { limit = 24 } = {}) => {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('CPU profile summary limit must be positive');
  if (!Array.isArray(profile?.nodes)) throw new Error('CPU profile nodes are missing');
  if (!Array.isArray(profile?.samples)) throw new Error('CPU profile samples are missing');
  if (!Array.isArray(profile?.timeDeltas)) throw new Error('CPU profile time deltas are missing');

  const nodeById = new Map(profile.nodes.map((node) => [node.id, node]));
  const rows = new Map();
  let sampledTimeUs = 0;
  let unresolvedSampleCount = 0;

  for (let index = 0; index < profile.samples.length; index += 1) {
    const deltaUs = profile.timeDeltas[index];
    if (!finiteNonNegative(deltaUs)) continue;
    sampledTimeUs += deltaUs;
    const node = nodeById.get(profile.samples[index]);
    const frame = node?.callFrame;
    if (frame === undefined) {
      unresolvedSampleCount += 1;
      continue;
    }
    const key = frameIdentity(frame);
    const row = rows.get(key) ?? {
      columnNumber: frame.columnNumber ?? -1,
      functionName: frame.functionName || '(anonymous)',
      lineNumber: frame.lineNumber ?? -1,
      sampleCount: 0,
      selfTimeUs: 0,
      url: frame.url || '',
    };
    row.sampleCount += 1;
    row.selfTimeUs += deltaUs;
    rows.set(key, row);
  }

  const durationUs = finiteNonNegative(profile.startTime) && finiteNonNegative(profile.endTime)
    ? Math.max(0, profile.endTime - profile.startTime)
    : null;
  const scriptRows = new Map([...rows].filter(([, row]) => row.url !== ''));
  const scriptSampledTimeUs = [...scriptRows.values()]
    .reduce((total, row) => total + row.selfTimeUs, 0);
  return {
    durationMs: durationUs === null ? null : durationUs / 1_000,
    sampleCount: profile.samples.length,
    sampledTimeMs: sampledTimeUs / 1_000,
    scriptSampledTimeMs: scriptSampledTimeUs / 1_000,
    topScriptSelfTime: sortedRows(scriptRows, scriptSampledTimeUs, limit),
    topSelfTime: sortedRows(rows, sampledTimeUs, limit),
    unresolvedSampleCount,
  };
};
