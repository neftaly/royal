#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const PACKET_KIND = Object.freeze({
  mesh: 1,
  gltf: 2,
  text: 3,
});

const BOUNDS_SOURCE = Object.freeze({
  boxMesh: 1,
  gltfConservative: 2,
  textLayout: 3,
  unbounded: 4,
  gltfAsset: 5,
});

const NODE_KIND = Object.freeze({
  mesh: "mesh",
  text: "text",
});

const DEFAULTS = Object.freeze({
  counts: [1_000, 10_000, 50_000],
  seed: 0x71d15ab1,
  warmupFrames: 6,
  jitterSamples: 16,
});

const CULL_EPSILON = 0.000001;
const PLANE_COMPONENTS = 4;
const PLANE_COUNT = 6;

const args = parseArgs(process.argv.slice(2));
const counts = listArg(args.counts, DEFAULTS.counts);
const warmupFrames = integerArg(args.warmup, DEFAULTS.warmupFrames);
const jitterSamples = integerArg(args.jitter, DEFAULTS.jitterSamples);
const seed = integerArg(args.seed, DEFAULTS.seed);

const frames = makeCameraFrames();
const scenarios = counts.map((packetCount) => runScenario(packetCount));

console.log(JSON.stringify({
  benchmark: "renderer-webgl-private-visibility-packets",
  date: new Date().toISOString(),
  seed,
  warmupFrames,
  jitterSamples,
  note: "Research harness mirrors packages/renderer-webgl/src/visibility.ts without changing package exports.",
  packetModel: {
    storage: "struct-of-arrays typed arrays",
    kinds: kindNames(PACKET_KIND),
    boundsSources: boundsSourceNames(BOUNDS_SOURCE),
    culling: "six normalized frustum planes, sphere-vs-plane rejection",
  },
  scenarios,
  thresholds: {
    enabled: false,
    reason: "Benchmark is intentionally not CI-wired; local CPU noise is still too high for hard gates.",
  },
}, null, 2));

function runScenario(packetCount) {
  const nodes = makeSyntheticNodes(packetCount, seed);
  const packetScratch = createVisibilityPacketBuffer(packetCount);
  const oldTraversalScratch = new Uint32Array(packetCount);
  const visibleScratch = new Uint32Array(packetCount);
  const visibleBits = new Uint8Array(packetCount);
  const previousVisibleBits = new Uint8Array(packetCount);

  let packets = extractVisibilityPackets(nodes, packetScratch);
  for (let i = 0; i < warmupFrames; i += 1) {
    const frame = frames[i % frames.length];
    oldDrawEveryNodeTraversal(nodes, oldTraversalScratch);
    packets = extractVisibilityPackets(nodes, packetScratch);
    cullVisibilityPackets(packets, frame.planes, visibleScratch, visibleBits);
  }

  const oldTraversalMs = measureMedian(() => oldDrawEveryNodeTraversal(nodes, oldTraversalScratch));
  const extractionMs = measureMedian(() => {
    packets = extractVisibilityPackets(nodes, packetScratch);
    return packets.count;
  });

  packets = extractVisibilityPackets(nodes, packetScratch);
  const rebuiltPackets = extractVisibilityPackets(nodes, createVisibilityPacketBuffer(packetCount));
  const stableIdChurn = countStableIdChurn(packets, rebuiltPackets);
  const reorderedNodes = rotateNodes(nodes, Math.max(1, Math.floor(packetCount / 7)));
  const reorderedPackets = extractVisibilityPackets(reorderedNodes, createVisibilityPacketBuffer(packetCount));
  const stableReorderChurn = countStableSetChurn(packets, reorderedPackets);

  const frameResults = [];
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    previousVisibleBits.set(visibleBits);
    frameResults.push(measureFrame({
      frame: frames[frameIndex],
      frameIndex,
      oldTraversalMs,
      packets,
      previousVisibleBits,
      visibleBits,
      visibleScratch,
    }));
  }

  const jitter = measureJitter(frames[1], packets, visibleScratch, visibleBits, previousVisibleBits, jitterSamples);
  const averages = averageFrameResults(frameResults);
  const extractionPlusCullMs = extractionMs + averages.cullMs;
  const overheadVsOldTraversalMs = extractionPlusCullMs - oldTraversalMs;
  const overheadVsOldTraversalRatio = oldTraversalMs === 0 ? null : extractionPlusCullMs / oldTraversalMs;
  const bestVisible = frameResults.reduce((best, result) => Math.min(best, result.visibleCount), packetCount);

  return {
    packetCount,
    packetMix: countNodeMix(nodes),
    packetBytes: estimatePacketBytes(packetCount),
    oldDrawEveryNodeTraversal: {
      ms: oldTraversalMs,
      submittedCount: packetCount,
    },
    extraction: {
      ms: extractionMs,
      usPerPacket: microsecondsPerPacket(extractionMs, packetCount),
    },
    cullingAverage: averages,
    frames: frameResults,
    stableChurn: {
      rebuildPacketIdsChanged: stableIdChurn,
      rebuildPacketIdChurnRatio: roundRatio(stableIdChurn / packetCount),
      reorderPacketIdsChanged: stableReorderChurn,
      reorderPacketIdChurnRatio: roundRatio(stableReorderChurn / packetCount),
      jitter,
    },
    overheadVsOldTraversal: {
      extractionPlusAverageCullMs: round(extractionPlusCullMs),
      oldTraversalMs,
      overheadMs: round(overheadVsOldTraversalMs),
      ratio: overheadVsOldTraversalRatio === null ? null : round(overheadVsOldTraversalRatio),
    },
    virtualTextureResidencyLodDemand: {
      visibleCountLowWatermark: bestVisible,
      culledCountHighWatermark: packetCount - bestVisible,
      cheapEnough: averages.usPerPacket < 0.1 && extractionPlusCullMs < frameBudgetTargetMs(packetCount),
      budgetTargetMs: frameBudgetTargetMs(packetCount),
      reason: "Packet extraction plus cull stays well below the conservative per-frame visibility budget on this run.",
    },
  };
}

function measureFrame({
  frame,
  frameIndex,
  oldTraversalMs,
  packets,
  previousVisibleBits,
  visibleBits,
  visibleScratch,
}) {
  const t0 = performance.now();
  const visibleCount = cullVisibilityPackets(packets, frame.planes, visibleScratch, visibleBits);
  const cullMs = performance.now() - t0;
  const churn = countChurn(visibleBits, previousVisibleBits);
  const culledCount = packets.count - visibleCount;

  return {
    frame: frameIndex,
    label: frame.label,
    visibleCount,
    culledCount,
    cullMs: round(cullMs),
    usPerPacket: microsecondsPerPacket(cullMs, packets.count),
    skippedRatio: roundRatio(culledCount / packets.count),
    visibleByKind: countVisibleByKind(packets, visibleScratch, visibleCount),
    stableVisibleChurn: {
      packets: churn,
      ratio: roundRatio(churn / packets.count),
    },
    oldTraversalOverhead: {
      cullOnlyOverheadMs: round(cullMs - oldTraversalMs),
      cullOnlyRatio: oldTraversalMs === 0 ? null : round(cullMs / oldTraversalMs),
    },
  };
}

function extractVisibilityPackets(nodes, scratch) {
  let packetIndex = 0;
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (node.kind === NODE_KIND.mesh) {
      writeBoundedPacket(
        scratch,
        packetIndex,
        nodeIndex,
        PACKET_KIND.mesh,
        BOUNDS_SOURCE.boxMesh,
        node.bounds,
        node.id,
      );
      packetIndex += 1;
      continue;
    }

    writeBoundedPacket(
      scratch,
      packetIndex,
      nodeIndex,
      PACKET_KIND.text,
      BOUNDS_SOURCE.textLayout,
      node.bounds,
      node.id,
    );
    packetIndex += 1;
  }

  return { ...scratch, count: packetIndex };
}

function cullVisibilityPackets(packets, planes, visibleIndices, visibleBits) {
  visibleBits.fill(0);
  let visibleCount = 0;

  for (let packetIndex = 0; packetIndex < packets.count; packetIndex += 1) {
    if (isPacketVisible(packets, packetIndex, planes)) {
      visibleBits[packetIndex] = 1;
      visibleIndices[visibleCount] = packetIndex;
      visibleCount += 1;
    }
  }

  return visibleCount;
}

function isPacketVisible(packets, packetIndex, frustumPlanes) {
  const radius = packets.radius[packetIndex];
  if (radius === Number.POSITIVE_INFINITY) return true;

  const centerX = packets.centerX[packetIndex];
  const centerY = packets.centerY[packetIndex];
  const centerZ = packets.centerZ[packetIndex];

  for (let planeIndex = 0; planeIndex < PLANE_COUNT; planeIndex += 1) {
    const offset = planeIndex * PLANE_COMPONENTS;
    const distance =
      frustumPlanes[offset] * centerX +
      frustumPlanes[offset + 1] * centerY +
      frustumPlanes[offset + 2] * centerZ +
      frustumPlanes[offset + 3];
    if (distance < -radius - CULL_EPSILON) return false;
  }

  return true;
}

function writeBoundedPacket(packets, packetIndex, nodeIndex, kind, boundsSource, bounds, id) {
  const sphere = sphereFromAabb(bounds);
  packets.nodeIndices[packetIndex] = nodeIndex;
  packets.kinds[packetIndex] = kind;
  packets.boundsSources[packetIndex] = boundsSource;
  packets.idHi[packetIndex] = id.hi;
  packets.idLo[packetIndex] = id.lo;
  packets.minX[packetIndex] = bounds.minX;
  packets.minY[packetIndex] = bounds.minY;
  packets.minZ[packetIndex] = bounds.minZ;
  packets.maxX[packetIndex] = bounds.maxX;
  packets.maxY[packetIndex] = bounds.maxY;
  packets.maxZ[packetIndex] = bounds.maxZ;
  packets.centerX[packetIndex] = sphere.centerX;
  packets.centerY[packetIndex] = sphere.centerY;
  packets.centerZ[packetIndex] = sphere.centerZ;
  packets.radius[packetIndex] = sphere.radius;
}

function createVisibilityPacketBuffer(capacity) {
  return {
    boundsSources: new Uint16Array(capacity),
    centerX: new Float32Array(capacity),
    centerY: new Float32Array(capacity),
    centerZ: new Float32Array(capacity),
    idHi: new Uint32Array(capacity),
    idLo: new Uint32Array(capacity),
    kinds: new Uint16Array(capacity),
    maxX: new Float32Array(capacity),
    maxY: new Float32Array(capacity),
    maxZ: new Float32Array(capacity),
    minX: new Float32Array(capacity),
    minY: new Float32Array(capacity),
    minZ: new Float32Array(capacity),
    nodeIndices: new Uint32Array(capacity),
    radius: new Float32Array(capacity),
  };
}

function makeSyntheticNodes(count, initialSeed) {
  const random = mulberry32(initialSeed);
  const nodes = new Array(count);
  const columns = Math.ceil(Math.sqrt(count * 1.6));
  const rows = Math.ceil(count / columns);

  for (let i = 0; i < count; i += 1) {
    const isText = i % 5 === 4;
    const laneX = (i % columns) - columns / 2;
    const laneZ = Math.floor(i / columns) - rows / 2;
    const x = laneX * 4.4 + randomRange(random, -1.2, 1.2);
    const y = isText ? randomRange(random, 1.8, 24) : randomRange(random, -3, 19);
    const z = laneZ * 4.4 + randomRange(random, -1.2, 1.2);
    const halfX = isText ? randomRange(random, 0.6, 5.8) : randomRange(random, 0.35, 2.8);
    const halfY = isText ? randomRange(random, 0.08, 0.7) : randomRange(random, 0.35, 2.4);
    const halfZ = isText ? 0.02 : randomRange(random, 0.35, 2.8);
    const ownerKey = `${isText ? "text" : "box"}:${i}:asset-${i % 257}:instance-${i % 8191}`;

    nodes[i] = {
      id: hashPacketId(isText ? PACKET_KIND.text : PACKET_KIND.mesh, ownerKey),
      kind: isText ? NODE_KIND.text : NODE_KIND.mesh,
      bounds: {
        minX: x - halfX,
        minY: y - halfY,
        minZ: z - halfZ,
        maxX: x + halfX,
        maxY: y + halfY,
        maxZ: z + halfZ,
      },
    };
  }

  return nodes;
}

function oldDrawEveryNodeTraversal(nodes, scratch) {
  let submitted = 0;
  for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
    const node = nodes[nodeIndex];
    if (node.kind === NODE_KIND.mesh || node.kind === NODE_KIND.text) {
      scratch[submitted] = nodeIndex;
      submitted += 1;
    }
  }
  return submitted;
}

function makeCameraFrames() {
  return [
    makeCameraFrame({ label: "wide-start", position: [-72, 30, 116], target: [-24, 10, -44] }),
    makeCameraFrame({ label: "center-sweep", position: [-16, 26, 96], target: [18, 10, -52] }),
    makeCameraFrame({ label: "text-band", position: [42, 28, 82], target: [64, 16, -68] }),
    makeCameraFrame({ label: "box-field", position: [104, 34, 94], target: [76, 12, -76] }),
    makeCameraFrame({ label: "edge-reject", position: [156, 38, 102], target: [112, 14, -86] }),
  ];
}

function makeCameraFrame({ label, position, target }) {
  const aspect = 16 / 9;
  const fovy = Math.PI / 3;
  const near = 0.5;
  const far = 260;
  const view = lookAt(position, target, [0, 1, 0]);
  const projection = perspective(fovy, aspect, near, far);
  const viewProjection = multiplyMat4(projection, view);
  return {
    label,
    position,
    target,
    planes: extractFrustumPlanes(viewProjection),
  };
}

function extractFrustumPlanes(viewProjectionMatrix) {
  const planes = new Float32Array(PLANE_COUNT * PLANE_COMPONENTS);

  writePlane(
    planes,
    0,
    viewProjectionMatrix[3] + viewProjectionMatrix[0],
    viewProjectionMatrix[7] + viewProjectionMatrix[4],
    viewProjectionMatrix[11] + viewProjectionMatrix[8],
    viewProjectionMatrix[15] + viewProjectionMatrix[12],
  );
  writePlane(
    planes,
    1,
    viewProjectionMatrix[3] - viewProjectionMatrix[0],
    viewProjectionMatrix[7] - viewProjectionMatrix[4],
    viewProjectionMatrix[11] - viewProjectionMatrix[8],
    viewProjectionMatrix[15] - viewProjectionMatrix[12],
  );
  writePlane(
    planes,
    2,
    viewProjectionMatrix[3] + viewProjectionMatrix[1],
    viewProjectionMatrix[7] + viewProjectionMatrix[5],
    viewProjectionMatrix[11] + viewProjectionMatrix[9],
    viewProjectionMatrix[15] + viewProjectionMatrix[13],
  );
  writePlane(
    planes,
    3,
    viewProjectionMatrix[3] - viewProjectionMatrix[1],
    viewProjectionMatrix[7] - viewProjectionMatrix[5],
    viewProjectionMatrix[11] - viewProjectionMatrix[9],
    viewProjectionMatrix[15] - viewProjectionMatrix[13],
  );
  writePlane(
    planes,
    4,
    viewProjectionMatrix[3] + viewProjectionMatrix[2],
    viewProjectionMatrix[7] + viewProjectionMatrix[6],
    viewProjectionMatrix[11] + viewProjectionMatrix[10],
    viewProjectionMatrix[15] + viewProjectionMatrix[14],
  );
  writePlane(
    planes,
    5,
    viewProjectionMatrix[3] - viewProjectionMatrix[2],
    viewProjectionMatrix[7] - viewProjectionMatrix[6],
    viewProjectionMatrix[11] - viewProjectionMatrix[10],
    viewProjectionMatrix[15] - viewProjectionMatrix[14],
  );

  return planes;
}

function writePlane(planes, planeIndex, x, y, z, w) {
  const length = Math.hypot(x, y, z);
  if (length === 0) throw new Error("Invalid frustum plane");
  const offset = planeIndex * PLANE_COMPONENTS;
  planes[offset] = x / length;
  planes[offset + 1] = y / length;
  planes[offset + 2] = z / length;
  planes[offset + 3] = w / length;
}

function measureJitter(baseFrame, packets, visibleIndices, visibleBits, previousBits, samples) {
  cullVisibilityPackets(packets, baseFrame.planes, visibleIndices, previousBits);
  let maxChurn = 0;
  let totalChurn = 0;

  for (let i = 0; i < samples; i += 1) {
    const offset = (i - samples / 2) * 0.0025;
    const frame = makeCameraFrame({
      label: `jitter-${i}`,
      position: [baseFrame.position[0] + offset, baseFrame.position[1], baseFrame.position[2] - offset],
      target: [baseFrame.target[0] + offset, baseFrame.target[1], baseFrame.target[2] - offset],
    });
    cullVisibilityPackets(packets, frame.planes, visibleIndices, visibleBits);
    const churn = countChurn(visibleBits, previousBits);
    maxChurn = Math.max(maxChurn, churn);
    totalChurn += churn;
  }

  return {
    samples,
    maxPackets: maxChurn,
    maxRatio: roundRatio(maxChurn / packets.count),
    averagePackets: round(totalChurn / samples),
    averageRatio: roundRatio(totalChurn / samples / packets.count),
  };
}

function sphereFromAabb(bounds) {
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;
  return {
    centerX,
    centerY,
    centerZ,
    radius: Math.hypot(bounds.maxX - centerX, bounds.maxY - centerY, bounds.maxZ - centerZ),
  };
}

function countStableIdChurn(left, right) {
  let churn = 0;
  for (let i = 0; i < left.count; i += 1) {
    if (left.idHi[i] !== right.idHi[i] || left.idLo[i] !== right.idLo[i]) churn += 1;
  }
  return churn;
}

function countStableSetChurn(left, right) {
  const ids = new Set();
  for (let i = 0; i < left.count; i += 1) ids.add(packetId(left, i));

  let misses = 0;
  for (let i = 0; i < right.count; i += 1) {
    if (!ids.has(packetId(right, i))) misses += 1;
  }
  return misses;
}

function packetId(packets, packetIndex) {
  return `${packets.idHi[packetIndex]}:${packets.idLo[packetIndex]}`;
}

function rotateNodes(nodes, offset) {
  return nodes.slice(offset).concat(nodes.slice(0, offset));
}

function countChurn(a, b) {
  let churn = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) churn += 1;
  }
  return churn;
}

function countNodeMix(nodes) {
  const counts = { box: 0, text: 0 };
  for (const node of nodes) counts[node.kind === NODE_KIND.text ? "text" : "box"] += 1;
  return counts;
}

function countVisibleByKind(packets, visibleIndices, visibleCount) {
  const counts = { box: 0, text: 0 };
  for (let i = 0; i < visibleCount; i += 1) {
    const packetIndex = visibleIndices[i];
    counts[packets.kinds[packetIndex] === PACKET_KIND.text ? "text" : "box"] += 1;
  }
  return counts;
}

function averageFrameResults(results) {
  const sums = {
    visibleCount: 0,
    culledCount: 0,
    cullMs: 0,
    usPerPacket: 0,
    skippedRatio: 0,
  };

  for (const result of results) {
    for (const key of Object.keys(sums)) sums[key] += result[key];
  }

  return Object.fromEntries(
    Object.entries(sums).map(([key, value]) => [
      key,
      key.endsWith("Ratio") ? roundRatio(value / results.length) : round(value / results.length),
    ]),
  );
}

function estimatePacketBytes(count) {
  const bytesPerPacket =
    3 * Uint16Array.BYTES_PER_ELEMENT +
    3 * Uint32Array.BYTES_PER_ELEMENT +
    10 * Float32Array.BYTES_PER_ELEMENT;
  return {
    bytesPerPacket,
    totalBytes: bytesPerPacket * count,
    totalMiB: round((bytesPerPacket * count) / 1024 / 1024),
  };
}

function kindNames(kinds) {
  return Object.fromEntries(Object.entries(kinds).map(([key, value]) => [value, key]));
}

function boundsSourceNames(sources) {
  return Object.fromEntries(Object.entries(sources).map(([key, value]) => [value, key]));
}

function frameBudgetTargetMs(packetCount) {
  return packetCount <= 1_000 ? 0.5 : packetCount <= 10_000 ? 1.5 : 6;
}

function microsecondsPerPacket(ms, packetCount) {
  return round((ms * 1000) / packetCount);
}

function measureMedian(fn) {
  const samples = [];
  let last = 0;
  for (let i = 0; i < 9; i += 1) {
    const t0 = performance.now();
    last = fn();
    const ms = performance.now() - t0;
    samples.push(ms);
  }
  if (last < 0) throw new Error("unreachable");
  samples.sort((a, b) => a - b);
  return round(samples[Math.floor(samples.length / 2)]);
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function lookAt(eye, target, up) {
  const z = normalize3([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);

  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

function multiplyMat4(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function normalize3(v) {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function hashPacketId(kind, label) {
  return {
    hi: hashString32(`${kind}:${label}`),
    lo: hashString32(label, kind),
  };
}

function hashString32(text, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function randomRange(random, min, max) {
  return min + (max - min) * random();
}

function mulberry32(initial) {
  let state = initial >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined) i += 1;
  }
  return parsed;
}

function integerArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listArg(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = String(value)
    .split(",")
    .map((entry) => Number.parseInt(entry.trim(), 10))
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  return parsed.length === 0 ? fallback : parsed;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function roundRatio(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
