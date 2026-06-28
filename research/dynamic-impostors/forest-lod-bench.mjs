#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MANIFEST = resolve(__dirname, "fixtures/sample-forest-impostor-manifest.json");
const DEFAULTS = Object.freeze({
  manifest: DEFAULT_MANIFEST,
  trees: null,
  frames: null,
  seed: 0x1f0eed5,
  viewportHeightPx: 1080,
  verticalFovDegrees: 60,
  viewRadiusMeters: 980,
  viewHalfAngleDegrees: 58,
  warmupFrames: 3
});

const args = parseArgs(process.argv.slice(2));
const manifestPath = stringArg(args.manifest, DEFAULTS.manifest);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const frames = integerArg(args.frames, manifest.world.cameraPath.defaultFrames ?? DEFAULTS.frames);
const totalTreesArg = args.trees === undefined ? DEFAULTS.trees : integerArg(args.trees, DEFAULTS.trees);
const seed = integerArg(args.seed, DEFAULTS.seed);
const viewportHeightPx = integerArg(args.viewportHeight, DEFAULTS.viewportHeightPx);
const verticalFovDegrees = numberArg(args.fov, DEFAULTS.verticalFovDegrees);
const viewRadiusMeters = numberArg(args.viewRadius, DEFAULTS.viewRadiusMeters);
const viewHalfAngleDegrees = numberArg(args.viewHalfAngle, DEFAULTS.viewHalfAngleDegrees);

const trees = buildForest(manifest, totalTreesArg, seed);
const speciesByName = new Map(manifest.sourceMeshes.map((mesh) => [mesh.species, mesh]));
const pageGroups = makePageGroups(manifest);
const pageCache = createPageCache(manifest.virtualTextureHooks.physicalSlots);
const previousRepresentations = new Map();
const frameRows = [];

for (let frame = 0; frame < frames; frame += 1) {
  frameRows.push(runFrame(frame));
}

const measuredRows = frameRows.slice(Math.min(DEFAULTS.warmupFrames, Math.max(0, frameRows.length - 1)));
const totals = sumFrames(measuredRows);
const averages = averageFrames(measuredRows);

console.log(JSON.stringify({
  benchmark: "royal-research-dynamic-impostors-forest-lod",
  date: new Date().toISOString(),
  manifest: {
    path: manifestPath,
    schema: manifest.schema,
    sourceMeshes: manifest.sourceMeshes.length,
    impostorAtlases: manifest.impostorAtlases.length,
    forestCells: manifest.forestCells.length
  },
  config: {
    seed,
    treeCount: trees.length,
    frames,
    measuredFrames: measuredRows.length,
    viewportHeightPx,
    verticalFovDegrees,
    viewRadiusMeters,
    viewHalfAngleDegrees,
    physicalPageSlots: manifest.virtualTextureHooks.physicalSlots,
    maxUploadsPerFrame: manifest.virtualTextureHooks.maxUploadsPerFrame,
    maxUploadBytesPerFrame: manifest.virtualTextureHooks.maxUploadBytesPerFrame
  },
  totals,
  averages,
  finalResidency: {
    residentPages: pageCache.size,
    residentBytes: pageCache.size * bytesPerPage(manifest),
    pages: [...pageCache.pages.keys()].sort()
  },
  frames: frameRows,
  caveat: "CPU-only static fixture. Counts are pressure estimates for future Royal texture resources, VT hooks, and visibility/culling APIs; no renderer API is required."
}, null, 2));

function runFrame(frame) {
  const camera = cameraAtFrame(manifest.world.cameraPath, frame, frames);
  const t0 = performance.now();
  const demand = selectLodDemand(camera);
  const selectionMs = performance.now() - t0;

  const t1 = performance.now();
  const residency = scheduleResidency(demand.pageRequests, frame);
  const residencyMs = performance.now() - t1;
  applyResidencyCounters(demand.debugCounters, residency);

  const estimate = estimateFrameCost(demand, residency);
  return {
    frame,
    camera,
    counts: demand.counts,
    estimatedDrawCalls: estimate.drawCalls,
    estimatedTriangles: estimate.triangles,
    atlasDemand: demand.atlasDemand,
    pageResidency: residency,
    lodSwitches: demand.lodSwitches,
    debugCounters: demand.debugCounters,
    updateCost: {
      lodSelectionMs: round(selectionMs),
      residencySchedulingMs: round(residencyMs),
      estimatedTextureUploadMs: round(estimate.textureUploadMs),
      estimatedCpuTotalMs: round(selectionMs + residencyMs + estimate.debugCounterMs),
      estimatedDebugCounterMs: round(estimate.debugCounterMs)
    }
  };
}

function selectLodDemand(camera) {
  const counts = {
    meshHigh: 0,
    meshMid: 0,
    meshTotal: 0,
    octahedral: 0,
    billboard: 0,
    culled: 0,
    visible: 0
  };
  const trianglesByMesh = new Map();
  const atlasDemand = new Map();
  const pageRequests = new Map();
  const lodSwitches = {
    meshToOct: 0,
    octToBillboard: 0,
    billboardToCulled: 0,
    any: 0
  };
  const debugCounters = {
    "forest.instances_total": trees.length,
    "forest.instances_visible": 0,
    "forest.mesh_instances": 0,
    "forest.octahedral_impostors": 0,
    "forest.billboard_impostors": 0,
    "forest.culled_instances": 0,
    "lod.mesh_to_oct_switches": 0,
    "lod.oct_to_billboard_switches": 0,
    "lod.billboard_to_culled_switches": 0,
    "vt.page_requests": 0,
    "vt.page_hits": 0,
    "vt.page_misses": 0,
    "vt.page_uploads": 0,
    "vt.page_evictions": 0,
    "vt.page_table_dirty_entries": 0,
    "vt.impostor_fallback_samples": 0
  };

  for (const tree of trees) {
    const mesh = speciesByName.get(tree.species);
    const dx = tree.x - camera.x;
    const dz = tree.z - camera.z;
    const distance = Math.hypot(dx, dz);
    const inRange = distance <= viewRadiusMeters;
    const inCone = isInsideViewCone(dx, dz, camera.forwardX, camera.forwardZ);
    const projectedHeight = projectedHeightPixels(mesh.bounds.halfExtents[1] * 2 * tree.scale, distance);
    const representation = inRange && inCone
      ? chooseRepresentation(distance, projectedHeight)
      : "culled";

    const previous = previousRepresentations.get(tree.id);
    if (previous && previous !== representation) {
      lodSwitches.any += 1;
      countSwitch(previous, representation, lodSwitches, debugCounters);
    }
    previousRepresentations.set(tree.id, representation);

    if (representation === "meshHigh") {
      counts.meshHigh += 1;
      counts.meshTotal += 1;
      counts.visible += 1;
      addTriangles(trianglesByMesh, mesh.id, Math.round(mesh.meshLod.nearTriangles * tree.scale));
      continue;
    }

    if (representation === "meshMid") {
      counts.meshMid += 1;
      counts.meshTotal += 1;
      counts.visible += 1;
      addTriangles(trianglesByMesh, mesh.id, Math.round(mesh.meshLod.midTriangles * tree.scale));
      continue;
    }

    if (representation === "octahedral") {
      counts.octahedral += 1;
      counts.visible += 1;
      addAtlasDemand(atlasDemand, "forest_oct_2048_albedo_depth_normal_v1", tree.species, 1);
      requestPages(pageRequests, pageGroups, "oct", tree, camera, distance, 3);
      continue;
    }

    if (representation === "billboard") {
      counts.billboard += 1;
      counts.visible += 1;
      addAtlasDemand(atlasDemand, "forest_billboard_1024_far_v1", tree.species, 1);
      requestPages(pageRequests, pageGroups, "billboard", tree, camera, distance, 1);
      continue;
    }

    counts.culled += 1;
  }

  debugCounters["forest.instances_visible"] = counts.visible;
  debugCounters["forest.mesh_instances"] = counts.meshTotal;
  debugCounters["forest.octahedral_impostors"] = counts.octahedral;
  debugCounters["forest.billboard_impostors"] = counts.billboard;
  debugCounters["forest.culled_instances"] = counts.culled;
  debugCounters["vt.page_requests"] = [...pageRequests.values()].reduce((sum, page) => sum + page.samples, 0);

  return {
    counts,
    trianglesByMesh: Object.fromEntries([...trianglesByMesh.entries()].sort()),
    atlasDemand: Object.fromEntries([...atlasDemand.entries()].sort()),
    pageRequests,
    lodSwitches,
    debugCounters
  };
}

function scheduleResidency(pageRequests, frame) {
  const requested = [...pageRequests.values()].sort(comparePageRequest);
  let hits = 0;
  let misses = 0;
  let fallbackSamples = 0;
  const uploadQueue = [];

  for (const request of requested) {
    const resident = pageCache.pages.get(request.key);
    if (resident) {
      hits += request.samples;
      resident.lastUsed = frame;
      resident.hits += request.samples;
    } else {
      misses += request.samples;
      fallbackSamples += request.fallbackSamples;
      uploadQueue.push(request);
    }
  }

  const maxUploads = manifest.virtualTextureHooks.maxUploadsPerFrame;
  const maxBytes = manifest.virtualTextureHooks.maxUploadBytesPerFrame;
  const pageBytes = bytesPerPage(manifest);
  let uploadedPages = 0;
  let uploadedBytes = 0;
  let evictedPages = 0;

  for (const request of uploadQueue) {
    if (uploadedPages >= maxUploads || uploadedBytes + pageBytes > maxBytes) break;
    const evicted = pageCache.insert(request, frame);
    if (evicted) evictedPages += 1;
    uploadedPages += 1;
    uploadedBytes += pageBytes;
  }

  return {
    uniquePageRequests: requested.length,
    pageSamples: hits + misses,
    hits,
    misses,
    hitRatio: ratio(hits, hits + misses),
    uploadedPages,
    uploadBytes: uploadedBytes,
    evictedPages,
    residentPages: pageCache.size,
    queuedPagesAfterBudget: Math.max(0, uploadQueue.length - uploadedPages),
    pageTableDirtyEntries: uploadedPages + evictedPages,
    fallbackSamples,
    requestedPages: requested.slice(0, 12).map((page) => page.key)
  };
}

function buildForest(sourceManifest, totalTrees, globalSeed) {
  const cells = sourceManifest.forestCells;
  const requestedTotal = totalTrees ?? cells.reduce((sum, cell) => sum + cell.instanceCount, 0);
  const baseTotal = cells.reduce((sum, cell) => sum + cell.instanceCount, 0);
  const result = [];

  for (const cell of cells) {
    const cellShare = cell.instanceCount / baseTotal;
    const cellCount = Math.max(1, Math.round(requestedTotal * cellShare));
    const rng = mulberry32((cell.seed ^ globalSeed) >>> 0);
    const columns = Math.ceil(Math.sqrt(cellCount * boundsWidth(cell.bounds) / boundsDepth(cell.bounds)));
    const rows = Math.ceil(cellCount / columns);

    for (let index = 0; index < cellCount; index += 1) {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const jx = (rng() - 0.5) * 0.72;
      const jz = (rng() - 0.5) * 0.72;
      const x = lerp(cell.bounds.min[0], cell.bounds.max[0], (col + 0.5 + jx) / columns);
      const z = lerp(cell.bounds.min[2], cell.bounds.max[2], (row + 0.5 + jz) / rows);
      result.push({
        id: `${cell.id}/${index}`,
        cellId: cell.id,
        species: chooseSpecies(cell.speciesMix, rng()),
        x,
        z,
        scale: 0.78 + rng() * 0.48,
        yaw: rng() * Math.PI * 2
      });
    }
  }

  return result.slice(0, requestedTotal);
}

function chooseRepresentation(distance, projectedHeight) {
  const policy = manifest.lodPolicy;
  if (
    distance <= policy.distanceMeters.meshHighMax ||
    projectedHeight >= policy.projectedHeightPixels.meshHighMin
  ) {
    return "meshHigh";
  }
  if (
    distance <= policy.distanceMeters.meshMidMax ||
    projectedHeight >= policy.projectedHeightPixels.meshMidMin
  ) {
    return "meshMid";
  }
  if (
    distance <= policy.distanceMeters.octahedralMax ||
    projectedHeight >= policy.projectedHeightPixels.octahedralMin
  ) {
    return "octahedral";
  }
  if (
    distance <= policy.distanceMeters.billboardMax ||
    projectedHeight >= policy.projectedHeightPixels.billboardMin
  ) {
    return "billboard";
  }
  return "culled";
}

function requestPages(pageRequests, groups, kind, tree, camera, distance, directionSamples) {
  const group = groups.get(`${kind}/${speciesSlug(tree.species)}`);
  if (!group) return;
  const cameraAngle = Math.atan2(camera.forwardZ, camera.forwardX);
  const relativeAngle = normalizeAngle(cameraAngle - tree.yaw);
  const directionBucket = Math.floor(((relativeAngle + Math.PI) / (Math.PI * 2)) * 8) % 8;
  const distanceMip = distance < 220 ? 0 : distance < 520 ? 1 : 2;
  const basePriority = group.priorityBase + Math.max(0, 32 - distance * 0.05);

  for (let sample = 0; sample < directionSamples; sample += 1) {
    const bucket = (directionBucket + sample) % 8;
    const key = `${group.id}/mip${distanceMip}/dir${bucket}`;
    const existing = pageRequests.get(key);
    if (existing) {
      existing.samples += 1;
      existing.priority = Math.max(existing.priority, basePriority - sample * 2);
      continue;
    }
    pageRequests.set(key, {
      key,
      groupId: group.id,
      atlasId: group.atlasId,
      mip: distanceMip,
      directionBucket: bucket,
      priority: basePriority - sample * 2,
      samples: 1,
      fallbackSamples: kind === "oct" ? 1 : 0
    });
  }
}

function makePageGroups(sourceManifest) {
  const priorityByGroup = new Map(
    sourceManifest.virtualTextureHooks.pageGroups.map((group) => [group.id, group])
  );
  const groups = new Map();
  for (const atlas of sourceManifest.impostorAtlases) {
    for (const layer of atlas.atlas.layers) {
      const priority = priorityByGroup.get(layer.pageGroup);
      groups.set(layer.pageGroup, {
        id: layer.pageGroup,
        atlasId: atlas.id,
        species: layer.species,
        priorityBase: priority?.priorityBase ?? 1
      });
    }
  }
  return groups;
}

function createPageCache(capacity) {
  return {
    capacity,
    pages: new Map(),
    get size() {
      return this.pages.size;
    },
    insert(request, frame) {
      let evicted = null;
      if (this.pages.size >= this.capacity && !this.pages.has(request.key)) {
        evicted = [...this.pages.entries()].reduce((oldest, entry) => {
          if (!oldest) return entry;
          return entry[1].lastUsed < oldest[1].lastUsed ? entry : oldest;
        }, null);
        this.pages.delete(evicted[0]);
      }
      this.pages.set(request.key, {
        key: request.key,
        atlasId: request.atlasId,
        groupId: request.groupId,
        mip: request.mip,
        lastUsed: frame,
        hits: 0
      });
      return evicted;
    }
  };
}

function estimateFrameCost(demand, residency) {
  const meshDrawCalls = Object.keys(demand.trianglesByMesh).length;
  const octDrawCalls = demand.counts.octahedral > 0 ? 1 : 0;
  const billboardDrawCalls = demand.counts.billboard > 0 ? 1 : 0;
  const impostorTriangles = (demand.counts.octahedral + demand.counts.billboard) * 2;
  const meshTriangles = Object.values(demand.trianglesByMesh).reduce((sum, count) => sum + count, 0);
  const hooks = manifest.virtualTextureHooks;
  const textureUploadMs = residency.uploadedPages === 0
    ? 0
    : residency.uploadedPages * hooks.uploadOverheadMs + residency.uploadBytes / hooks.uploadBandwidthBytesPerMs;

  return {
    drawCalls: meshDrawCalls + octDrawCalls + billboardDrawCalls,
    triangles: meshTriangles + impostorTriangles,
    textureUploadMs,
    debugCounterMs: Object.keys(demand.debugCounters).length * 0.002
  };
}

function cameraAtFrame(path, frame, frameCount) {
  const t = frameCount <= 1 ? 0 : frame / (frameCount - 1);
  const wobble = Math.sin(t * Math.PI * 2) * 26;
  const x = lerp(path.start[0], path.end[0], t);
  const y = lerp(path.start[1], path.end[1], t);
  const z = lerp(path.start[2], path.end[2], t) + wobble;
  const frameStep = 1 / Math.max(1, frameCount - 1);
  const sampleT = frame >= frameCount - 1 ? Math.max(0, t - frameStep) : Math.min(1, t + frameStep);
  const sampleX = lerp(path.start[0], path.end[0], sampleT);
  const sampleZ = lerp(path.start[2], path.end[2], sampleT) + Math.sin(sampleT * Math.PI * 2) * 26;
  const directionSign = frame >= frameCount - 1 ? -1 : 1;
  const forwardX = (sampleX - x) * directionSign;
  const forwardZ = (sampleZ - z) * directionSign;
  const length = Math.hypot(forwardX, forwardZ) || 1;
  return {
    x: round(x),
    y: round(y),
    z: round(z),
    forwardX: round(forwardX / length),
    forwardZ: round(forwardZ / length)
  };
}

function isInsideViewCone(dx, dz, forwardX, forwardZ) {
  const distance = Math.hypot(dx, dz);
  if (distance === 0) return true;
  const dot = (dx / distance) * forwardX + (dz / distance) * forwardZ;
  return dot >= Math.cos(degreesToRadians(viewHalfAngleDegrees));
}

function projectedHeightPixels(heightMeters, distanceMeters) {
  const safeDistance = Math.max(1, distanceMeters);
  const fovRadians = degreesToRadians(verticalFovDegrees);
  return (heightMeters / safeDistance) * (viewportHeightPx / (2 * Math.tan(fovRadians / 2)));
}

function countSwitch(previous, next, switches, counters) {
  const previousMesh = previous === "meshHigh" || previous === "meshMid";
  const nextMesh = next === "meshHigh" || next === "meshMid";
  if (previousMesh && next === "octahedral") {
    switches.meshToOct += 1;
    counters["lod.mesh_to_oct_switches"] += 1;
  } else if (previous === "octahedral" && next === "billboard") {
    switches.octToBillboard += 1;
    counters["lod.oct_to_billboard_switches"] += 1;
  } else if (previous === "billboard" && next === "culled") {
    switches.billboardToCulled += 1;
    counters["lod.billboard_to_culled_switches"] += 1;
  } else if (!nextMesh && previousMesh && next === "billboard") {
    switches.meshToOct += 1;
    switches.octToBillboard += 1;
  }
}

function applyResidencyCounters(counters, residency) {
  counters["vt.page_hits"] = residency.hits;
  counters["vt.page_misses"] = residency.misses;
  counters["vt.page_uploads"] = residency.uploadedPages;
  counters["vt.page_evictions"] = residency.evictedPages;
  counters["vt.page_table_dirty_entries"] = residency.pageTableDirtyEntries;
  counters["vt.impostor_fallback_samples"] = residency.fallbackSamples;
}

function sumFrames(rows) {
  return rows.reduce((sum, row) => ({
    meshInstances: sum.meshInstances + row.counts.meshTotal,
    octahedralImpostors: sum.octahedralImpostors + row.counts.octahedral,
    billboardImpostors: sum.billboardImpostors + row.counts.billboard,
    culledInstances: sum.culledInstances + row.counts.culled,
    pageRequests: sum.pageRequests + row.pageResidency.pageSamples,
    pageHits: sum.pageHits + row.pageResidency.hits,
    pageMisses: sum.pageMisses + row.pageResidency.misses,
    pageUploads: sum.pageUploads + row.pageResidency.uploadedPages,
    pageEvictions: sum.pageEvictions + row.pageResidency.evictedPages,
    lodSwitches: sum.lodSwitches + row.lodSwitches.any
  }), {
    meshInstances: 0,
    octahedralImpostors: 0,
    billboardImpostors: 0,
    culledInstances: 0,
    pageRequests: 0,
    pageHits: 0,
    pageMisses: 0,
    pageUploads: 0,
    pageEvictions: 0,
    lodSwitches: 0
  });
}

function averageFrames(rows) {
  if (rows.length === 0) return {};
  const totals = rows.reduce((sum, row) => ({
    visible: sum.visible + row.counts.visible,
    mesh: sum.mesh + row.counts.meshTotal,
    octahedral: sum.octahedral + row.counts.octahedral,
    billboard: sum.billboard + row.counts.billboard,
    culled: sum.culled + row.counts.culled,
    drawCalls: sum.drawCalls + row.estimatedDrawCalls,
    triangles: sum.triangles + row.estimatedTriangles,
    residentPages: sum.residentPages + row.pageResidency.residentPages,
    hitRatio: sum.hitRatio + row.pageResidency.hitRatio,
    lodSelectionMs: sum.lodSelectionMs + row.updateCost.lodSelectionMs,
    residencySchedulingMs: sum.residencySchedulingMs + row.updateCost.residencySchedulingMs,
    textureUploadMs: sum.textureUploadMs + row.updateCost.estimatedTextureUploadMs,
    cpuTotalMs: sum.cpuTotalMs + row.updateCost.estimatedCpuTotalMs
  }), {
    visible: 0,
    mesh: 0,
    octahedral: 0,
    billboard: 0,
    culled: 0,
    drawCalls: 0,
    triangles: 0,
    residentPages: 0,
    hitRatio: 0,
    lodSelectionMs: 0,
    residencySchedulingMs: 0,
    textureUploadMs: 0,
    cpuTotalMs: 0
  });

  return Object.fromEntries(
    Object.entries(totals).map(([key, value]) => [key, round(value / rows.length)])
  );
}

function addTriangles(map, meshId, triangles) {
  map.set(meshId, (map.get(meshId) ?? 0) + triangles);
}

function addAtlasDemand(map, atlasId, species, count) {
  const key = `${atlasId}/${species}`;
  map.set(key, (map.get(key) ?? 0) + count);
}

function comparePageRequest(a, b) {
  return b.priority - a.priority || b.samples - a.samples || a.key.localeCompare(b.key);
}

function bytesPerPage(sourceManifest) {
  const size = sourceManifest.virtualTextureHooks.pageSize + sourceManifest.virtualTextureHooks.pagePaddingTexels * 2;
  return size * size * 4;
}

function chooseSpecies(speciesMix, value) {
  let cursor = 0;
  for (const [species, weight] of Object.entries(speciesMix)) {
    cursor += weight;
    if (value <= cursor) return species;
  }
  return Object.keys(speciesMix).at(-1);
}

function speciesSlug(species) {
  if (species === "coastal-fir") return "fir";
  if (species === "silver-beech") return "beech";
  if (species === "dead-pine") return "dead-pine";
  return species;
}

function boundsWidth(bounds) {
  return bounds.max[0] - bounds.min[0];
}

function boundsDepth(bounds) {
  return bounds.max[2] - bounds.min[2];
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    result[key] = inlineValue ?? argv[i + 1];
    if (inlineValue === undefined) i += 1;
  }
  return result;
}

function stringArg(value, fallback) {
  return value === undefined ? fallback : String(value);
}

function integerArg(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Expected integer, received ${value}`);
  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, received ${value}`);
  return parsed;
}

function mulberry32(seed) {
  return function next() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : round(numerator / denominator);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function normalizeAngle(value) {
  let angle = value;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}
