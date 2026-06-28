#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const seed = 0x5eedcafe;
const objectCount = 10_000;
const lightCount = 128;
const frames = [
  { position: [0, 18, 58], yaw: 0 },
  { position: [24, 20, 52], yaw: -0.18 },
  { position: [48, 24, 44], yaw: -0.36 },
  { position: [72, 26, 32], yaw: -0.52 },
  { position: [96, 30, 18], yaw: -0.7 },
];

const clusterGrid = { x: 16, y: 9, z: 24 };

const rng = mulberry32(seed);
const objects = makeObjects(objectCount, rng);
const lights = makeLights(lightCount, rng);

const preparedFrames = frames.map(prepareFrame);
for (const frame of preparedFrames) runFrame(-1, frame, objects, lights);

const started = performance.now();
const results = preparedFrames.map((frame, index) => runFrame(index, frame, objects, lights));
const totalMs = performance.now() - started;

console.log(JSON.stringify({
  seed,
  objectCount,
  lightCount,
  clusterGrid,
  totalMs: round(totalMs),
  averages: averageResults(results),
  frames: results,
  targetHints: {
    cpuFrustumMs: "< 1.0 ms for 10k packets",
    cpuClusterBuildMs: "< 1.0 ms for 128 lights / 16x9x24 clusters",
    visiblePacketBudget: "<= 2,000 submitted packets for this synthetic view",
    texturePageUploads: "<= 8 new pages per frame after warm cache",
    lodChurnRatio: "< 0.05 for small camera steps"
  }
}, null, 2));

function runFrame(index, frame, sceneObjects, sceneLights) {
  const t0 = performance.now();
  const visible = [];
  for (const object of sceneObjects) {
    if (sphereInCameraCone(object.center, object.radius, frame)) visible.push(object);
  }
  const cullMs = performance.now() - t0;

  const t1 = performance.now();
  const clusters = assignLightsToClusters(sceneLights, frame);
  const clusterMs = performance.now() - t1;

  const t2 = performance.now();
  const pages = requestedTexturePages(visible, frame);
  const lod = selectLods(visible, frame);
  const selectionMs = performance.now() - t2;

  return {
    frame: index,
    position: frame.position,
    yaw: frame.yaw,
    cullMs: round(cullMs),
    clusterMs: round(clusterMs),
    selectionMs: round(selectionMs),
    visiblePackets: visible.length,
    culledPackets: sceneObjects.length - visible.length,
    clusterOverflowCount: clusters.overflow,
    averageLightsPerTouchedCluster: round(clusters.averageLightsPerTouchedCluster),
    maxLightsPerCluster: clusters.maxLightsPerCluster,
    requestedTexturePages: pages.total,
    highestMipRequests: pages.highestMipRequests,
    lodCounts: lod.counts,
    estimatedMeshlets: lod.estimatedMeshlets,
    estimatedTriangles: lod.estimatedTriangles
  };
}

function prepareFrame(frame) {
  return {
    ...frame,
    forward: [Math.sin(frame.yaw), -0.08, -Math.cos(frame.yaw)],
    inverseYawSin: Math.sin(-frame.yaw),
    inverseYawCos: Math.cos(-frame.yaw)
  };
}

function makeObjects(count, random) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const x = randomRange(random, -220, 220);
    const z = randomRange(random, -180, 180);
    const y = randomRange(random, -6, 24);
    const radius = randomRange(random, 0.5, 5.5);
    out.push({
      id: `packet:${i}`,
      center: [x, y, z],
      radius,
      textureTiles: 1 + Math.floor(random() * 10),
      meshletBase: 2 + Math.floor(random() * 24)
    });
  }
  return out;
}

function makeLights(count, random) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      id: `light:${i}`,
      position: [
        randomRange(random, -180, 180),
        randomRange(random, 0, 48),
        randomRange(random, -150, 150)
      ],
      radius: randomRange(random, 10, 54)
    });
  }
  return out;
}

function sphereInCameraCone(center, radius, frame) {
  const dx = center[0] - frame.position[0];
  const dy = center[1] - frame.position[1];
  const dz = center[2] - frame.position[2];
  const distanceSq = dx * dx + dy * dy + dz * dz;
  const far = 170 + radius;
  if (distanceSq > far * far) return false;

  const distance = Math.sqrt(distanceSq);
  const dot = (dx * frame.forward[0] + dy * frame.forward[1] + dz * frame.forward[2]) / Math.max(distance, 0.0001);
  const halfFovCos = Math.cos(Math.PI / 4);
  return dot > halfFovCos - radius / Math.max(distance, 1);
}

function assignLightsToClusters(sceneLights, frame) {
  const counts = new Uint16Array(clusterGrid.x * clusterGrid.y * clusterGrid.z);
  let touched = 0;
  let totalAssignments = 0;
  let overflow = 0;
  let maxLightsPerCluster = 0;

  for (const light of sceneLights) {
    const local = toCameraLocal(light.position, frame);
    const depth = -local[2];
    if (depth + light.radius < 0 || depth - light.radius > 170) continue;

    const sx = clamp(Math.floor(((local[0] / Math.max(depth, 1)) * 0.5 + 0.5) * clusterGrid.x), 0, clusterGrid.x - 1);
    const sy = clamp(Math.floor(((-local[1] / Math.max(depth, 1)) * 0.5 + 0.5) * clusterGrid.y), 0, clusterGrid.y - 1);
    const sz = clamp(Math.floor((depth / 170) * clusterGrid.z), 0, clusterGrid.z - 1);
    const spread = clamp(Math.ceil(light.radius / 24), 1, 4);

    for (let z = Math.max(0, sz - spread); z <= Math.min(clusterGrid.z - 1, sz + spread); z += 1) {
      for (let y = Math.max(0, sy - spread); y <= Math.min(clusterGrid.y - 1, sy + spread); y += 1) {
        for (let x = Math.max(0, sx - spread); x <= Math.min(clusterGrid.x - 1, sx + spread); x += 1) {
          const index = x + y * clusterGrid.x + z * clusterGrid.x * clusterGrid.y;
          if (counts[index] === 0) touched += 1;
          counts[index] += 1;
          totalAssignments += 1;
          if (counts[index] > 32) overflow += 1;
          maxLightsPerCluster = Math.max(maxLightsPerCluster, counts[index]);
        }
      }
    }
  }

  return {
    averageLightsPerTouchedCluster: touched === 0 ? 0 : totalAssignments / touched,
    maxLightsPerCluster,
    overflow
  };
}

function requestedTexturePages(visible, frame) {
  let total = 0;
  let highestMipRequests = 0;

  for (const object of visible) {
    const distance = distance3(object.center, frame.position);
    const mip = distance < 28 ? 0 : distance < 64 ? 1 : distance < 120 ? 2 : 3;
    const pages = Math.max(1, Math.ceil(object.textureTiles / (mip + 1)));
    total += pages;
    if (mip === 0) highestMipRequests += pages;
  }

  return { total, highestMipRequests };
}

function selectLods(visible, frame) {
  const counts = { lod0: 0, lod1: 0, lod2: 0, lod3: 0 };
  let estimatedMeshlets = 0;
  let estimatedTriangles = 0;

  for (const object of visible) {
    const distance = distance3(object.center, frame.position);
    const lod = distance < 36 ? 0 : distance < 78 ? 1 : distance < 135 ? 2 : 3;
    counts[`lod${lod}`] += 1;
    const meshlets = Math.max(1, Math.ceil(object.meshletBase / (1 << lod)));
    estimatedMeshlets += meshlets;
    estimatedTriangles += meshlets * 64;
  }

  return { counts, estimatedMeshlets, estimatedTriangles };
}

function toCameraLocal(position, frame) {
  const dx = position[0] - frame.position[0];
  const dy = position[1] - frame.position[1];
  const dz = position[2] - frame.position[2];
  return [
    dx * frame.inverseYawCos - dz * frame.inverseYawSin,
    dy,
    dx * frame.inverseYawSin + dz * frame.inverseYawCos
  ];
}

function averageResults(results) {
  const sums = {
    cullMs: 0,
    clusterMs: 0,
    selectionMs: 0,
    visiblePackets: 0,
    requestedTexturePages: 0,
    estimatedMeshlets: 0,
    estimatedTriangles: 0
  };
  for (const result of results) {
    for (const key of Object.keys(sums)) sums[key] += result[key];
  }
  return Object.fromEntries(
    Object.entries(sums).map(([key, value]) => [key, round(value / results.length)])
  );
}

function distance3(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function randomRange(random, min, max) {
  return min + (max - min) * random();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function mulberry32(initial) {
  let state = initial >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
