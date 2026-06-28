#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const config = {
  worldId: "royal-terrain-spike",
  seed: "infinigen-style-seed:royal:001",
  recipe: "terrain-v1-flat-fbm-materials@0.1.0",
  rootSize: 1024,
  maxLevel: 6,
  maxNodes: 256,
  innerSegments: 16,
  distanceFactor: 1.7,
  cameraHysteresis: 24,
};

const cameraPath = [
  { x: 0, y: 140, z: 0 },
  { x: 12, y: 140, z: 10 },
  { x: 96, y: 150, z: 40 },
  { x: 220, y: 155, z: 120 },
  { x: 260, y: 155, z: 135 },
];

function main() {
  let previous = new Set();
  let lastCamera = null;
  const frames = [];

  for (const camera of cameraPath) {
    const moved = lastCamera === null || distance2(camera, lastCamera) >= config.cameraHysteresis ** 2;
    const lodStarted = performance.now();
    const leaves = moved ? selectTerrainLeaves(config, camera) : frames.at(-1).leaves;
    const lodFinished = performance.now();
    const rowsStarted = performance.now();
    const rows = terrainRows(config, camera, leaves);
    const rowsFinished = performance.now();
    const ids = new Set(rows.terrainChunks.map((chunk) => chunk.chunkId));
    const churn = diffSets(previous, ids);

    frames.push({
      camera,
      moved,
      leaves,
      lodMs: lodFinished - lodStarted,
      rowsMs: rowsFinished - rowsStarted,
      rows,
      churn,
      vertexEstimate: leaves.length * (config.innerSegments + 3) ** 2,
      indexEstimate: leaves.length * (config.innerSegments + 2) ** 2 * 6,
    });

    if (moved) {
      previous = ids;
      lastCamera = camera;
    }
  }

  const summary = {
    config,
    averages: {
      lodMs: average(frames.map((frame) => frame.lodMs)),
      rowsMs: average(frames.map((frame) => frame.rowsMs)),
      leaves: average(frames.map((frame) => frame.leaves.length)),
      vertices: average(frames.map((frame) => frame.vertexEstimate)),
      indices: average(frames.map((frame) => frame.indexEstimate)),
    },
    frames: frames.map((frame) => ({
      camera: frame.camera,
      reusedPreviousFrame: !frame.moved,
      lodMs: round(frame.lodMs),
      rowsMs: round(frame.rowsMs),
      leaves: frame.leaves.length,
      vertices: frame.vertexEstimate,
      indices: frame.indexEstimate,
      addedChunks: frame.churn.added,
      removedChunks: frame.churn.removed,
      firstChunk: frame.rows.terrainChunks[0],
    })),
    sampleRows: {
      terrainChunk: frames[0].rows.terrainChunks[0],
      terrainAsset: frames[0].rows.terrainAssets[0],
      terrainMaterial: frames[0].rows.terrainMaterials[0],
      terrainGenerationJob: frames[0].rows.terrainGenerationJobs[0],
    },
  };

  console.log(JSON.stringify(summary, null, 2));
}

function selectTerrainLeaves(input, camera) {
  const leaves = [];
  const stack = [{ level: 0, x: 0, y: 0 }];

  while (stack.length > 0 && leaves.length < input.maxNodes) {
    const tile = stack.pop();
    const bounds = tileBounds(input, tile);
    const shouldSplit =
      tile.level < input.maxLevel &&
      distance2(camera, bounds.center) < (bounds.radius * input.distanceFactor) ** 2 &&
      leaves.length + stack.length + 4 <= input.maxNodes;

    if (!shouldSplit) {
      leaves.push(tile);
      continue;
    }

    const nextLevel = tile.level + 1;
    const x = tile.x * 2;
    const y = tile.y * 2;
    stack.push(
      { level: nextLevel, x, y },
      { level: nextLevel, x: x + 1, y },
      { level: nextLevel, x, y: y + 1 },
      { level: nextLevel, x: x + 1, y: y + 1 },
    );
  }

  return leaves.sort((a, b) => a.level - b.level || a.y - b.y || a.x - b.x);
}

function terrainRows(input, camera, leaves) {
  const terrainChunks = [];
  const terrainAssets = [];
  const terrainMaterials = [];
  const terrainGenerationJobs = [];

  for (const tile of leaves) {
    const bounds = tileBounds(input, tile);
    const chunkId = chunkIdFor(input, tile);
    const stats = sampleChunk(input, tile);
    const materialId = materialFor(stats);
    const priority = Math.max(0, input.maxLevel - tile.level) + 1 / (1 + distance2(camera, bounds.center));
    const provenance = {
      generator: "royal-terrain-v1-spike",
      seed: input.seed,
      recipe: input.recipe,
      coordinateSystem: "y-up-right-handed",
      source: "procedural-height-material",
      inputsHash: stableHash(JSON.stringify({ input, tile })),
    };

    terrainChunks.push({
      scopeId: input.worldId,
      chunkId,
      level: tile.level,
      x: tile.x,
      y: tile.y,
      minHeight: round(stats.minHeight),
      maxHeight: round(stats.maxHeight),
      boundsRadius: round(bounds.radius),
      materialId,
      status: "ready",
      provenance,
    });

    terrainAssets.push({
      scopeId: input.worldId,
      assetId: `asset:terrain-mesh:${chunkId}`,
      chunkId,
      kind: "indexed-heightfield",
      uri: `royal://terrain/${input.worldId}/${chunkId}.meshbin`,
      vertices: (input.innerSegments + 3) ** 2,
      indices: (input.innerSegments + 2) ** 2 * 6,
      status: "generated",
      artifactHash: stableHash(`${chunkId}:${stats.minHeight}:${stats.maxHeight}:${materialId}`),
      provenance,
    });

    terrainMaterials.push({
      scopeId: input.worldId,
      chunkId,
      materialId,
      coverage: 1,
      recipe: `${input.recipe}:classify-height-slope`,
    });

    terrainGenerationJobs.push({
      scopeId: input.worldId,
      jobId: `job:terrain:${chunkId}`,
      chunkId,
      priority: round(priority),
      status: "complete",
      diagnostics: [],
    });
  }

  return { terrainChunks, terrainAssets, terrainMaterials, terrainGenerationJobs };
}

function tileBounds(input, tile) {
  const tilesPerEdge = 2 ** tile.level;
  const size = input.rootSize / tilesPerEdge;
  const minX = -input.rootSize / 2 + tile.x * size;
  const minZ = -input.rootSize / 2 + tile.y * size;
  const center = {
    x: minX + size / 2,
    y: 0,
    z: minZ + size / 2,
  };
  const radius = Math.sqrt(2 * (size / 2) ** 2 + 80 ** 2);
  return { center, size, radius };
}

function sampleChunk(input, tile) {
  const bounds = tileBounds(input, tile);
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let slopeTotal = 0;
  const samples = 5;

  for (let y = 0; y < samples; y += 1) {
    for (let x = 0; x < samples; x += 1) {
      const px = bounds.center.x - bounds.size / 2 + (x / (samples - 1)) * bounds.size;
      const pz = bounds.center.z - bounds.size / 2 + (y / (samples - 1)) * bounds.size;
      const h = heightAt(input.seed, px, pz);
      minHeight = Math.min(minHeight, h);
      maxHeight = Math.max(maxHeight, h);
      slopeTotal += Math.abs(heightAt(input.seed, px + 1, pz) - h) + Math.abs(heightAt(input.seed, px, pz + 1) - h);
    }
  }

  return {
    minHeight,
    maxHeight,
    slope: slopeTotal / (samples * samples),
  };
}

function materialFor(stats) {
  if (stats.maxHeight > 45) return "material:snow-rock";
  if (stats.slope > 2.2) return "material:exposed-stone";
  if (stats.minHeight < -18) return "material:wet-sand";
  return "material:grass-soil";
}

function heightAt(seed, x, z) {
  const scale = 0.008;
  const low = valueNoise(seed, x * scale, z * scale) * 54;
  const mid = valueNoise(`${seed}:mid`, x * scale * 2.3, z * scale * 2.3) * 18;
  const ridge = Math.abs(valueNoise(`${seed}:ridge`, x * scale * 0.7, z * scale * 0.7)) * 32;
  return low + mid + ridge - 18;
}

function valueNoise(seed, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = smoothstep(x - x0);
  const yf = smoothstep(y - y0);
  const a = random2(seed, x0, y0);
  const b = random2(seed, x0 + 1, y0);
  const c = random2(seed, x0, y0 + 1);
  const d = random2(seed, x0 + 1, y0 + 1);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf) * 2 - 1;
}

function random2(seed, x, y) {
  return (stableHash(`${seed}:${x}:${y}`) % 1_000_000) / 1_000_000;
}

function chunkIdFor(input, tile) {
  return `chunk:${input.worldId}:s0:l${tile.level}:x${tile.x}:y${tile.y}`;
}

function diffSets(previous, next) {
  let added = 0;
  let removed = 0;
  for (const id of next) if (!previous.has(id)) added += 1;
  for (const id of previous) if (!next.has(id)) removed += 1;
  return { added, removed };
}

function stableHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function distance2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function average(values) {
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

main();
