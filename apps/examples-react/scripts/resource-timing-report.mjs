const finite = (value) => Number.isFinite(value) ? value : 0;

const resourceKind = (name) => {
  let pathname;
  try {
    pathname = new URL(name).pathname;
  } catch {
    pathname = name;
  }
  const filename = pathname.slice(pathname.lastIndexOf('/') + 1);
  const extensionIndex = filename.lastIndexOf('.');
  return extensionIndex < 0 ? 'other' : filename.slice(extensionIndex + 1).toLowerCase() || 'other';
};

const addToGroup = (groups, key, row) => {
  const current = groups[key] ?? {
    count: 0,
    decodedBodySize: 0,
    duration: 0,
    encodedBodySize: 0,
    transferSize: 0,
  };
  groups[key] = {
    count: current.count + 1,
    decodedBodySize: current.decodedBodySize + finite(row.decodedBodySize),
    duration: current.duration + finite(row.duration),
    encodedBodySize: current.encodedBodySize + finite(row.encodedBodySize),
    transferSize: current.transferSize + finite(row.transferSize),
  };
};

export const resourceTimingBootstrapSource = (capacity) => `
(() => {
  const capacity = ${JSON.stringify(capacity)};
  performance.setResourceTimingBufferSize(capacity);
  const state = { bufferFullCount: 0, capacity };
  globalThis.__royalIpadBenchmarkResourceTiming = state;
  performance.addEventListener('resourcetimingbufferfull', () => {
    state.bufferFullCount += 1;
  });
})();
`;

export const summarizeResourceTimings = (
  rows,
  { bufferFullCount = 0, capacity, slowestCount = 16 } = {},
) => {
  const byInitiator = {};
  const byKind = {};
  let totalDecodedBodySize = 0;
  let totalDuration = 0;
  let totalEncodedBodySize = 0;
  let totalTransferSize = 0;
  for (const row of rows) {
    addToGroup(byInitiator, row.initiatorType || 'unknown', row);
    addToGroup(byKind, resourceKind(row.name), row);
    totalDecodedBodySize += finite(row.decodedBodySize);
    totalDuration += finite(row.duration);
    totalEncodedBodySize += finite(row.encodedBodySize);
    totalTransferSize += finite(row.transferSize);
  }
  return {
    bufferFullCount,
    byInitiator,
    byKind,
    capacity,
    count: rows.length,
    entries: rows,
    overflowed:
      bufferFullCount > 0
      || (Number.isFinite(capacity) && rows.length >= capacity),
    slowest: [...rows]
      .sort((left, right) => finite(right.duration) - finite(left.duration))
      .slice(0, slowestCount),
    totalDecodedBodySize,
    totalDuration,
    totalEncodedBodySize,
    totalTransferSize,
  };
};
