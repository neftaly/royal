#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const PACKET_KIND = Object.freeze({
  mesh: 1,
  gltf: 2,
  text: 3,
  terrain: 4,
  light: 5,
});

const BOUNDS_SOURCE = Object.freeze({
  localBox: 1,
  assetManifest: 2,
  textLayout: 3,
  terrainTile: 4,
  procedural: 5,
});

const DEFAULTS = Object.freeze({
  seed: 0x71d15ab1,
  packetCount: 10_000,
  warmupFrames: 8,
  jitterSamples: 16,
});

const args = parseArgs(process.argv.slice(2));
const packetCount = integerArg(args.count, DEFAULTS.packetCount);
const warmupFrames = integerArg(args.warmup, DEFAULTS.warmupFrames);
const jitterSamples = integerArg(args.jitter, DEFAULTS.jitterSamples);
const seed = integerArg(args.seed, DEFAULTS.seed);

const packets = makeVisibilityPackets(packetCount, seed);
const frames = makeCameraFrames();
const visibleIndices = new Uint32Array(packetCount);
const visibleBits = new Uint8Array(packetCount);
const previousBits = new Uint8Array(packetCount);

for (let i = 0; i < warmupFrames; i += 1) {
  const frame = frames[i % frames.length];
  cullPackets(packets, frame, visibleIndices, visibleBits);
}

const results = [];
const started = performance.now();
for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
  const frame = frames[frameIndex];
  previousBits.set(visibleBits);
  const result = measureCull(frameIndex, packets, frame, visibleIndices, visibleBits, previousBits);
  results.push(result);
}
const totalMs = performance.now() - started;

const offscreenFrame = makeCameraFrame({
  label: "offscreen",
  position: [0, 46, 620],
  target: [0, 24, 760],
});
const offscreen = measureCull(-1, packets, offscreenFrame, visibleIndices, visibleBits, previousBits);
const jitter = measureJitter(frames[1], packets, visibleIndices, visibleBits, previousBits, jitterSamples);

const averages = averageResults(results);
const summary = {
  prototype: "visibility-packets-cpu-frustum",
  seed,
  packetCount,
  warmupFrames,
  packetBytes: estimatePacketBytes(packetCount),
  dataModel: {
    storage: "struct-of-arrays typed arrays",
    id: "stable 64-bit hash split into idHi/idLo",
    bounds: "world AABB plus bounding sphere",
    culling: "six normalized frustum planes, sphere fast path",
  },
  packetMix: countPacketMix(packets),
  totalMeasuredMs: round(totalMs),
  averages,
  frames: results,
  offscreen: {
    visiblePackets: offscreen.visiblePackets,
    skippedRatio: roundRatio(offscreen.culledPackets / packetCount),
    cullMs: offscreen.cullMs,
  },
  jitter,
  targets: {
    desktop10kCullMs: "< 1.0 ms after warmup",
    desktop50kCullMs: "< 5.0 ms after warmup",
    perPacketCullUs: "< 0.1 us per packet",
    offscreenSkippedRatio: ">= 0.90",
    jitterChurnRatio: "<= 0.002 for sub-pixel-style jitter",
  },
  nextCorePatch: [
    "private WebGL pass packet builder after renderer-webgl extraction",
    "bounds adapters for box mesh, vector text layout, glTF manifest, terrain tile rows",
    "CPU frustum cull before draw dispatch",
    "diagnostic rows for packet count, visible count, culled count, cull ms",
    "reuse visible packet stream for Forward+/clustered, texture residency, HZB, and terrain LOD",
  ],
};

console.log(JSON.stringify(summary, null, 2));

function measureCull(frameIndex, packets, frame, visibleIndices, visibleBits, previousBits) {
  const t0 = performance.now();
  const visiblePackets = cullPackets(packets, frame, visibleIndices, visibleBits);
  const cullMs = performance.now() - t0;
  const churn = countChurn(visibleBits, previousBits);
  const visibleByKind = countVisibleByKind(packets, visibleIndices, visiblePackets);
  const boundsBySource = countVisibleBoundsSources(packets, visibleIndices, visiblePackets);

  return {
    frame: frameIndex,
    label: frame.label,
    position: frame.position,
    visiblePackets,
    culledPackets: packets.count - visiblePackets,
    cullMs: round(cullMs),
    perPacketUs: round((cullMs * 1000) / packets.count),
    churnPackets: churn,
    churnRatio: roundRatio(churn / packets.count),
    visibleByKind,
    boundsBySource,
    estimatedDrawCallsSkipped: packets.count - visiblePackets,
  };
}

function cullPackets(packets, frame, visibleIndices, visibleBits) {
  const planes = frame.planes;
  const centerX = packets.centerX;
  const centerY = packets.centerY;
  const centerZ = packets.centerZ;
  const radius = packets.radius;
  const count = packets.count;
  const epsilon = frame.epsilon;
  let visibleCount = 0;

  visibleBits.fill(0);

  for (let i = 0; i < count; i += 1) {
    const x = centerX[i];
    const y = centerY[i];
    const z = centerZ[i];
    const r = radius[i] + epsilon;
    let inside = true;

    for (let p = 0; p < 24; p += 4) {
      if (planes[p] * x + planes[p + 1] * y + planes[p + 2] * z + planes[p + 3] < -r) {
        inside = false;
        break;
      }
    }

    if (inside) {
      visibleBits[i] = 1;
      visibleIndices[visibleCount] = i;
      visibleCount += 1;
    }
  }

  return visibleCount;
}

function makeVisibilityPackets(count, seed) {
  const random = mulberry32(seed);
  const packets = {
    count,
    idHi: new Uint32Array(count),
    idLo: new Uint32Array(count),
    kind: new Uint8Array(count),
    flags: new Uint16Array(count),
    assetIndex: new Uint32Array(count),
    instanceIndex: new Uint32Array(count),
    materialIndex: new Uint32Array(count),
    boundsSource: new Uint8Array(count),
    centerX: new Float32Array(count),
    centerY: new Float32Array(count),
    centerZ: new Float32Array(count),
    radius: new Float32Array(count),
    minX: new Float32Array(count),
    minY: new Float32Array(count),
    minZ: new Float32Array(count),
    maxX: new Float32Array(count),
    maxY: new Float32Array(count),
    maxZ: new Float32Array(count),
    transformVersion: new Uint32Array(count),
    boundsVersion: new Uint32Array(count),
    visibilityVersion: new Uint32Array(count),
    sortKey: new Uint32Array(count),
  };

  for (let i = 0; i < count; i += 1) {
    const lane = i % 20;
    const kind =
      lane < 9 ? PACKET_KIND.mesh :
      lane < 14 ? PACKET_KIND.gltf :
      lane < 17 ? PACKET_KIND.text :
      lane < 19 ? PACKET_KIND.terrain :
      PACKET_KIND.light;
    const boundsSource =
      kind === PACKET_KIND.mesh ? BOUNDS_SOURCE.localBox :
      kind === PACKET_KIND.gltf ? BOUNDS_SOURCE.assetManifest :
      kind === PACKET_KIND.text ? BOUNDS_SOURCE.textLayout :
      kind === PACKET_KIND.terrain ? BOUNDS_SOURCE.terrainTile :
      BOUNDS_SOURCE.procedural;

    const gridX = (i % 125) - 62;
    const gridZ = Math.floor(i / 125) - 40;
    const scatterX = randomRange(random, -3.8, 3.8);
    const scatterZ = randomRange(random, -3.8, 3.8);
    const x = gridX * 6 + scatterX;
    const z = gridZ * 6 + scatterZ;
    const y =
      kind === PACKET_KIND.terrain ? randomRange(random, -4, 2) :
      kind === PACKET_KIND.text ? randomRange(random, 4, 28) :
      randomRange(random, -2, 34);
    const rx = kind === PACKET_KIND.terrain ? randomRange(random, 7, 15) : randomRange(random, 0.4, 5.2);
    const ry = kind === PACKET_KIND.text ? randomRange(random, 0.15, 1.2) : randomRange(random, 0.4, 4.6);
    const rz = kind === PACKET_KIND.terrain ? randomRange(random, 7, 15) : randomRange(random, 0.4, 5.2);
    const radius = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const id = stableHash64(`royal|visibility|pass:main|kind:${kind}|asset:${i % 1024}|instance:${i}`);

    packets.idHi[i] = id.hi;
    packets.idLo[i] = id.lo;
    packets.kind[i] = kind;
    packets.flags[i] = flagsForKind(kind, i);
    packets.assetIndex[i] = i % 1024;
    packets.instanceIndex[i] = i;
    packets.materialIndex[i] = i % 128;
    packets.boundsSource[i] = boundsSource;
    packets.centerX[i] = x;
    packets.centerY[i] = y;
    packets.centerZ[i] = z;
    packets.radius[i] = radius;
    packets.minX[i] = x - rx;
    packets.minY[i] = y - ry;
    packets.minZ[i] = z - rz;
    packets.maxX[i] = x + rx;
    packets.maxY[i] = y + ry;
    packets.maxZ[i] = z + rz;
    packets.transformVersion[i] = 1 + (i % 7);
    packets.boundsVersion[i] = 1 + (i % 5);
    packets.visibilityVersion[i] = 0;
    packets.sortKey[i] = ((kind & 0xff) << 24) | ((i % 128) << 12) | (i % 4096);
  }

  return packets;
}

function makeCameraFrames() {
  return [
    makeCameraFrame({ label: "wide-start", position: [-72, 36, 120], target: [-32, 14, -40] }),
    makeCameraFrame({ label: "center-sweep", position: [-18, 30, 104], target: [18, 12, -46] }),
    makeCameraFrame({ label: "terrain-low", position: [42, 22, 82], target: [82, 8, -62] }),
    makeCameraFrame({ label: "text-band", position: [88, 34, 70], target: [50, 18, -92] }),
    makeCameraFrame({ label: "gltf-field", position: [126, 44, 96], target: [82, 16, -78] }),
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
    epsilon: 0.015,
    planes: extractFrustumPlanes(viewProjection),
  };
}

function extractFrustumPlanes(m) {
  const planes = new Float32Array(24);
  setPlane(planes, 0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
  setPlane(planes, 4, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
  setPlane(planes, 8, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
  setPlane(planes, 12, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
  setPlane(planes, 16, m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
  setPlane(planes, 20, m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
  return planes;
}

function setPlane(out, offset, x, y, z, w) {
  const invLen = 1 / Math.hypot(x, y, z);
  out[offset] = x * invLen;
  out[offset + 1] = y * invLen;
  out[offset + 2] = z * invLen;
  out[offset + 3] = w * invLen;
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

function measureJitter(baseFrame, packets, visibleIndices, visibleBits, previousBits, samples) {
  cullPackets(packets, baseFrame, visibleIndices, previousBits);
  let maxChurn = 0;
  let totalChurn = 0;

  for (let i = 0; i < samples; i += 1) {
    const offset = (i - samples / 2) * 0.0025;
    const frame = makeCameraFrame({
      label: `jitter-${i}`,
      position: [baseFrame.position[0] + offset, baseFrame.position[1], baseFrame.position[2] - offset],
      target: [baseFrame.target[0] + offset, baseFrame.target[1], baseFrame.target[2] - offset],
    });
    cullPackets(packets, frame, visibleIndices, visibleBits);
    const churn = countChurn(visibleBits, previousBits);
    maxChurn = Math.max(maxChurn, churn);
    totalChurn += churn;
  }

  return {
    samples,
    maxChurnPackets: maxChurn,
    maxChurnRatio: roundRatio(maxChurn / packets.count),
    averageChurnPackets: round(totalChurn / samples),
    averageChurnRatio: roundRatio(totalChurn / samples / packets.count),
  };
}

function countChurn(a, b) {
  let churn = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) churn += 1;
  }
  return churn;
}

function countPacketMix(packets) {
  const counts = {
    mesh: 0,
    gltf: 0,
    text: 0,
    terrain: 0,
    light: 0,
  };
  for (let i = 0; i < packets.count; i += 1) counts[kindName(packets.kind[i])] += 1;
  return counts;
}

function countVisibleByKind(packets, visibleIndices, visibleCount) {
  const counts = {
    mesh: 0,
    gltf: 0,
    text: 0,
    terrain: 0,
    light: 0,
  };
  for (let i = 0; i < visibleCount; i += 1) counts[kindName(packets.kind[visibleIndices[i]])] += 1;
  return counts;
}

function countVisibleBoundsSources(packets, visibleIndices, visibleCount) {
  const counts = {
    localBox: 0,
    assetManifest: 0,
    textLayout: 0,
    terrainTile: 0,
    procedural: 0,
  };
  for (let i = 0; i < visibleCount; i += 1) counts[boundsSourceName(packets.boundsSource[visibleIndices[i]])] += 1;
  return counts;
}

function kindName(kind) {
  switch (kind) {
    case PACKET_KIND.mesh:
      return "mesh";
    case PACKET_KIND.gltf:
      return "gltf";
    case PACKET_KIND.text:
      return "text";
    case PACKET_KIND.terrain:
      return "terrain";
    case PACKET_KIND.light:
      return "light";
    default:
      throw new Error(`Unknown packet kind ${kind}`);
  }
}

function boundsSourceName(source) {
  switch (source) {
    case BOUNDS_SOURCE.localBox:
      return "localBox";
    case BOUNDS_SOURCE.assetManifest:
      return "assetManifest";
    case BOUNDS_SOURCE.textLayout:
      return "textLayout";
    case BOUNDS_SOURCE.terrainTile:
      return "terrainTile";
    case BOUNDS_SOURCE.procedural:
      return "procedural";
    default:
      throw new Error(`Unknown bounds source ${source}`);
  }
}

function flagsForKind(kind, index) {
  const opaque = 1 << 0;
  const alpha = 1 << 1;
  const castsShadow = 1 << 2;
  const dynamic = 1 << 3;
  const terrain = 1 << 4;
  const text = 1 << 5;

  if (kind === PACKET_KIND.terrain) return opaque | castsShadow | terrain;
  if (kind === PACKET_KIND.text) return alpha | dynamic | text;
  if (kind === PACKET_KIND.light) return dynamic;
  return opaque | (index % 3 === 0 ? castsShadow : 0);
}

function estimatePacketBytes(count) {
  const bytesPerPacket =
    2 * Uint32Array.BYTES_PER_ELEMENT +
    2 * Uint8Array.BYTES_PER_ELEMENT +
    Uint16Array.BYTES_PER_ELEMENT +
    3 * Uint32Array.BYTES_PER_ELEMENT +
    10 * Float32Array.BYTES_PER_ELEMENT +
    4 * Uint32Array.BYTES_PER_ELEMENT;
  return {
    bytesPerPacket,
    totalBytes: bytesPerPacket * count,
    totalMiB: round((bytesPerPacket * count) / 1024 / 1024),
  };
}

function averageResults(results) {
  const sums = {
    visiblePackets: 0,
    culledPackets: 0,
    cullMs: 0,
    perPacketUs: 0,
    churnPackets: 0,
    churnRatio: 0,
  };
  for (const result of results) {
    for (const key of Object.keys(sums)) sums[key] += result[key];
  }
  return Object.fromEntries(
    Object.entries(sums).map(([key, value]) => [
      key,
      key.endsWith("Ratio") ? roundRatio(value / results.length) : round(value / results.length),
    ])
  );
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

function stableHash64(text) {
  let hi = 0x811c9dc5;
  let lo = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    hi = Math.imul(hi ^ code, 0x45d9f3b) >>> 0;
    lo = Math.imul(lo ^ code, 0x27d4eb2d) >>> 0;
  }
  return { hi, lo };
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

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function roundRatio(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
