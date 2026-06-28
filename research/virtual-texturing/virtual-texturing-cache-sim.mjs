#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const config = {
  seed: 0x726f7961,
  virtualSize: 16_384,
  usableTileSize: 128,
  borderTexels: 4,
  bytesPerTexel: 4,
  cacheSlots: 256,
  maxUploadsPerFrame: 8,
  maxUploadBytesPerFrame: 768 * 1024,
  uploadOverheadMs: 0.035,
  uploadBandwidthBytesPerMs: 650 * 1024,
  sampleGrid: { x: 30, y: 18 },
  prefetchRadius: 1,
  frames: 64,
  warmupFrames: 12
};

const paddedTileSize = config.usableTileSize + config.borderTexels * 2;
const bytesPerPage = paddedTileSize * paddedTileSize * config.bytesPerTexel;
const mipCount = Math.log2(config.virtualSize / config.usableTileSize) + 1;
let cache;
let scheduler;
let pageTable;

function runFrame(index, camera) {
  const t0 = performance.now();
  const demand = collectDemand(camera);
  const demandMs = performance.now() - t0;

  let exactHits = 0;
  let misses = 0;
  let fallbackSamples = 0;
  const resolved = new Map();
  const requestedPages = [...demand.pages.values()].sort(compareDemand);

  for (const request of requestedPages) {
    const resident = resolveResident(request);
    resolved.set(request.key, resident);
    if (resident.exact) {
      exactHits += request.samples;
      cache.touch(request.key, index);
    } else {
      misses += request.samples;
      if (resident.page) {
        fallbackSamples += request.samples;
        cache.touch(resident.page.key, index);
      }
      scheduler.enqueue(request);
    }
  }

  for (const parent of demand.parentPages.values()) {
    if (!cache.has(parent.key)) scheduler.enqueue(parent);
  }

  for (const prefetch of demand.prefetchPages.values()) {
    if (!cache.has(prefetch.key)) scheduler.enqueue(prefetch);
  }

  const t1 = performance.now();
  const uploads = scheduler.drain({
    maxUploads: config.maxUploadsPerFrame,
    maxBytes: config.maxUploadBytesPerFrame,
    frame: index,
    cache,
    pageTable
  });
  const uploadScheduleMs = performance.now() - t1;

  const seamCandidates = countSeamCandidates(demand.sampleCells, resolved);
  const estimatedUploadMs = estimateUploadMs(uploads.uploaded);
  const pageTableUpdates = uploads.uploaded + uploads.evicted;
  const totalSamples = exactHits + misses;

  return {
    frame: index,
    camera: {
      x: round(camera.x),
      y: round(camera.y),
      velocityX: round(camera.velocityX),
      velocityY: round(camera.velocityY),
      footprint: round(camera.footprint)
    },
    uniquePageRequests: demand.pages.size,
    parentFallbackPagesRequested: demand.parentPages.size,
    prefetchPagesQueued: demand.prefetchPages.size,
    exactHits,
    misses,
    fallbackSamples,
    exactHitRatio: ratio(exactHits, totalSamples),
    fallbackRatio: ratio(fallbackSamples, totalSamples),
    uploadedPages: uploads.uploaded,
    uploadBytes: uploads.uploaded * bytesPerPage,
    estimatedUploadMs: round(estimatedUploadMs),
    evictedPages: uploads.evicted,
    pageTableUpdates,
    residentPages: cache.size,
    queuedPagesAfterBudget: scheduler.size,
    seamCandidates,
    demandMs: round(demandMs),
    uploadScheduleMs: round(uploadScheduleMs),
    mipRequests: demand.mipCounts,
    resolvedMipDeltas: resolvedMipDeltas(demand.pages.values(), resolved)
  };
}

function collectDemand(camera) {
  const pages = new Map();
  const parentPages = new Map();
  const prefetchPages = new Map();
  const sampleCells = [];
  const mipCounts = Object.fromEntries(Array.from({ length: mipCount }, (_, mip) => [`mip${mip}`, 0]));

  for (let sy = 0; sy < config.sampleGrid.y; sy += 1) {
    const row = [];
    for (let sx = 0; sx < config.sampleGrid.x; sx += 1) {
      const u = sx / (config.sampleGrid.x - 1) - 0.5;
      const v = sy / (config.sampleGrid.y - 1) - 0.5;
      const distanceFromCenter = Math.hypot(u, v) * 2;
      const worldX = camera.x + u * camera.footprint * 1.65;
      const worldY = camera.y + v * camera.footprint;
      const mip = chooseMip(distanceFromCenter, camera);
      const page = makePage(mip, worldX, worldY, 100 - distanceFromCenter * 20);
      addDemand(pages, page, 1, 100 - distanceFromCenter * 20);
      mipCounts[`mip${mip}`] += 1;
      row.push(page.key);

      const parent = parentPage(page);
      if (parent) addDemand(parentPages, parent, 0, 12);
    }
    sampleCells.push(row);
  }

  const leadX = camera.x + camera.velocityX * 8;
  const leadY = camera.y + camera.velocityY * 8;
  for (const page of pages.values()) {
    for (let oy = -config.prefetchRadius; oy <= config.prefetchRadius; oy += 1) {
      for (let ox = -config.prefetchRadius; ox <= config.prefetchRadius; ox += 1) {
        if (ox === 0 && oy === 0) continue;
        const neighbor = neighborPageToward(page, ox, oy, leadX, leadY);
        if (neighbor) addDemand(prefetchPages, neighbor, 0, 2);
      }
    }
  }

  return { pages, parentPages, prefetchPages, sampleCells, mipCounts };
}

function addDemand(map, page, samples, priority) {
  const existing = map.get(page.key);
  if (existing) {
    existing.samples += samples;
    existing.priority = Math.max(existing.priority, priority);
    return existing;
  }
  const row = { ...page, samples, priority };
  map.set(page.key, row);
  return row;
}

function makePage(mip, worldX, worldY, priority = 1) {
  const pagesPerAxis = pagesPerAxisAtMip(mip);
  const pageWorldSize = config.usableTileSize * (1 << mip);
  const px = clamp(Math.floor(worldX / pageWorldSize), 0, pagesPerAxis - 1);
  const py = clamp(Math.floor(worldY / pageWorldSize), 0, pagesPerAxis - 1);
  return {
    key: pageKey(mip, px, py),
    mip,
    x: px,
    y: py,
    priority,
    uri: `generated://terrain-material/mip-${mip}/${px}/${py}`
  };
}

function parentPage(page) {
  if (page.mip >= mipCount - 1) return null;
  const mip = page.mip + 1;
  const x = Math.floor(page.x / 2);
  const y = Math.floor(page.y / 2);
  return {
    key: pageKey(mip, x, y),
    mip,
    x,
    y,
    priority: 12,
    uri: `generated://terrain-material/mip-${mip}/${x}/${y}`
  };
}

function neighborPageToward(page, offsetX, offsetY, leadX, leadY) {
  const pagesPerAxis = pagesPerAxisAtMip(page.mip);
  const pageWorldSize = config.usableTileSize * (1 << page.mip);
  const leadPageX = clamp(Math.floor(leadX / pageWorldSize), 0, pagesPerAxis - 1);
  const leadPageY = clamp(Math.floor(leadY / pageWorldSize), 0, pagesPerAxis - 1);
  const nx = clamp(page.x + offsetX + Math.sign(leadPageX - page.x), 0, pagesPerAxis - 1);
  const ny = clamp(page.y + offsetY + Math.sign(leadPageY - page.y), 0, pagesPerAxis - 1);
  return {
    key: pageKey(page.mip, nx, ny),
    mip: page.mip,
    x: nx,
    y: ny,
    priority: 2,
    uri: `generated://terrain-material/mip-${page.mip}/${nx}/${ny}`
  };
}

function resolveResident(request) {
  const exact = cache.get(request.key);
  if (exact) return { exact: true, page: exact, mipDelta: 0 };

  let parent = request;
  for (let delta = 1; delta < mipCount; delta += 1) {
    parent = parentPage(parent);
    if (!parent) break;
    const resident = cache.get(parent.key);
    if (resident) return { exact: false, page: resident, mipDelta: delta };
  }

  return { exact: false, page: null, mipDelta: null };
}

function countSeamCandidates(sampleCells, resolved) {
  let seams = 0;
  for (let y = 0; y < sampleCells.length; y += 1) {
    for (let x = 0; x < sampleCells[y].length; x += 1) {
      const current = resolved.get(sampleCells[y][x]);
      if (x + 1 < sampleCells[y].length) {
        const right = resolved.get(sampleCells[y][x + 1]);
        if (isSeamCandidate(current, right)) seams += 1;
      }
      if (y + 1 < sampleCells.length) {
        const down = resolved.get(sampleCells[y + 1][x]);
        if (isSeamCandidate(current, down)) seams += 1;
      }
    }
  }
  return seams;
}

function isSeamCandidate(a, b) {
  if (!a || !b) return true;
  if (!a.page || !b.page) return true;
  return a.mipDelta !== b.mipDelta;
}

function resolvedMipDeltas(requests, resolved) {
  const counts = {};
  for (const request of requests) {
    const row = resolved.get(request.key);
    const key = row?.mipDelta === null ? "missing" : `delta${row?.mipDelta ?? "missing"}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function compareDemand(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (a.mip !== b.mip) return a.mip - b.mip;
  return a.key.localeCompare(b.key);
}

function chooseMip(distanceFromCenter, camera) {
  const footprintPressure = Math.log2(camera.footprint / 520);
  const mip = Math.floor(distanceFromCenter * 3.2 + footprintPressure);
  return clamp(mip, 0, mipCount - 1);
}

function cameraPath(count) {
  const out = [];
  let previous = null;
  for (let frame = 0; frame < count; frame += 1) {
    const active = Math.max(0, frame - config.warmupFrames);
    const t = active / Math.max(1, count - config.warmupFrames - 1);
    const x = 1_600 + t * 1_450 + Math.sin(t * Math.PI * 2.4) * 48;
    const y = 2_100 + t * 920 + Math.sin(t * Math.PI * 1.8) * 42;
    const footprint = 620 + Math.sin(t * Math.PI * 2) * 60;
    const velocityX = previous ? x - previous.x : 0;
    const velocityY = previous ? y - previous.y : 0;
    const row = { x, y, footprint, velocityX, velocityY };
    out.push(row);
    previous = row;
  }
  return out;
}

function estimateUploadMs(uploadedPages) {
  if (uploadedPages === 0) return 0;
  const bytes = uploadedPages * bytesPerPage;
  return uploadedPages * config.uploadOverheadMs + bytes / config.uploadBandwidthBytesPerMs;
}

function buildManifestSample(random) {
  const pages = [];
  for (let index = 0; index < 8; index += 1) {
    const mip = index < 4 ? 0 : 2;
    const axis = pagesPerAxisAtMip(mip);
    const x = Math.floor(random() * axis);
    const y = Math.floor(random() * axis);
    const key = pageKey(mip, x, y);
    pages.push({
      key,
      mip,
      x,
      y,
      uri: `generated://terrain-material/mip-${mip}/${x}/${y}`,
      hash: stableHash(`${key}:${config.seed}`).toString(16).padStart(8, "0")
    });
  }
  return pages;
}

function summarize(rows) {
  const totals = rows.reduce((acc, row) => {
    acc.exactHits += row.exactHits;
    acc.misses += row.misses;
    acc.fallbackSamples += row.fallbackSamples;
    acc.uploadedPages += row.uploadedPages;
    acc.uploadBytes += row.uploadBytes;
    acc.estimatedUploadMs += row.estimatedUploadMs;
    acc.evictedPages += row.evictedPages;
    acc.pageTableUpdates += row.pageTableUpdates;
    acc.seamCandidates += row.seamCandidates;
    acc.maxUploads = Math.max(acc.maxUploads, row.uploadedPages);
    acc.maxUploadBytes = Math.max(acc.maxUploadBytes, row.uploadBytes);
    acc.maxQueuedPages = Math.max(acc.maxQueuedPages, row.queuedPagesAfterBudget);
    acc.maxSeamCandidates = Math.max(acc.maxSeamCandidates, row.seamCandidates);
    return acc;
  }, {
    exactHits: 0,
    misses: 0,
    fallbackSamples: 0,
    uploadedPages: 0,
    uploadBytes: 0,
    estimatedUploadMs: 0,
    evictedPages: 0,
    pageTableUpdates: 0,
    seamCandidates: 0,
    maxUploads: 0,
    maxUploadBytes: 0,
    maxQueuedPages: 0,
    maxSeamCandidates: 0
  });

  const totalSamples = totals.exactHits + totals.misses;
  return {
    exactHitRatio: ratio(totals.exactHits, totalSamples),
    fallbackRatio: ratio(totals.fallbackSamples, totalSamples),
    averageUploads: round(totals.uploadedPages / rows.length),
    maxUploads: totals.maxUploads,
    averageUploadBytes: Math.round(totals.uploadBytes / rows.length),
    maxUploadBytes: totals.maxUploadBytes,
    averageUploadMs: round(totals.estimatedUploadMs / rows.length),
    totalEvictions: totals.evictedPages,
    averagePageTableUpdates: round(totals.pageTableUpdates / rows.length),
    averageSeamCandidates: round(totals.seamCandidates / rows.length),
    maxSeamCandidates: totals.maxSeamCandidates,
    maxQueuedPages: totals.maxQueuedPages
  };
}

function pagesPerAxisAtMip(mip) {
  return config.virtualSize / config.usableTileSize / (1 << mip);
}

function pageKey(mip, x, y) {
  return `${mip}:${x}:${y}`;
}

class UploadScheduler {
  constructor() {
    this.requests = new Map();
  }

  get size() {
    return this.requests.size;
  }

  enqueue(page) {
    const existing = this.requests.get(page.key);
    if (existing) {
      existing.priority = Math.max(existing.priority, page.priority);
      existing.samples += page.samples ?? 0;
      return;
    }
    this.requests.set(page.key, { ...page, samples: page.samples ?? 0 });
  }

  drain({ maxUploads, maxBytes, frame, cache, pageTable }) {
    const candidates = [...this.requests.values()].sort(compareDemand);
    let uploaded = 0;
    let bytes = 0;
    let evicted = 0;

    for (const page of candidates) {
      if (uploaded >= maxUploads) break;
      if (bytes + bytesPerPage > maxBytes) break;
      if (cache.has(page.key)) {
        this.requests.delete(page.key);
        continue;
      }
      const result = cache.insert(page, frame);
      pageTable.set(page.key, {
        slot: result.slot,
        mip: page.mip,
        x: page.x,
        y: page.y,
        version: frame
      });
      if (result.evicted) {
        evicted += 1;
        pageTable.delete(result.evicted.key);
      }
      this.requests.delete(page.key);
      uploaded += 1;
      bytes += bytesPerPage;
    }

    return { uploaded, evicted };
  }
}

class PhysicalPageCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.pages = new Map();
    this.freeSlots = Array.from({ length: capacity }, (_, slot) => slot);
  }

  get size() {
    return this.pages.size;
  }

  has(key) {
    return this.pages.has(key);
  }

  get(key) {
    return this.pages.get(key) ?? null;
  }

  touch(key, frame) {
    const page = this.pages.get(key);
    if (page) page.lastUsedFrame = frame;
  }

  insert(page, frame) {
    const existing = this.pages.get(page.key);
    if (existing) {
      existing.lastUsedFrame = frame;
      return { slot: existing.slot, evicted: null };
    }

    let slot = this.freeSlots.shift();
    let evicted = null;
    if (slot === undefined) {
      evicted = this.findEvictionCandidate();
      this.pages.delete(evicted.key);
      slot = evicted.slot;
    }

    this.pages.set(page.key, {
      key: page.key,
      mip: page.mip,
      x: page.x,
      y: page.y,
      slot,
      lastUsedFrame: frame
    });
    return { slot, evicted };
  }

  findEvictionCandidate() {
    let candidate = null;
    for (const page of this.pages.values()) {
      if (!candidate) {
        candidate = page;
        continue;
      }
      const candidateScore = evictionScore(candidate);
      const pageScore = evictionScore(page);
      if (pageScore < candidateScore) candidate = page;
    }
    return candidate;
  }
}

function evictionScore(page) {
  return page.lastUsedFrame * 10 + page.mip;
}

function ratio(value, total) {
  return total === 0 ? 0 : round(value / total);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function stableHash(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function main() {
  const includeFrames = process.argv.includes("--frames");
  const rng = mulberry32(config.seed);
  cache = new PhysicalPageCache(config.cacheSlots);
  scheduler = new UploadScheduler();
  pageTable = new Map();

  const frames = cameraPath(config.frames);
  const sampleManifest = buildManifestSample(rng);
  const results = [];

  const started = performance.now();
  for (let index = 0; index < frames.length; index += 1) {
    results.push(runFrame(index, frames[index]));
  }
  const totalMs = performance.now() - started;
  const summary = summarize(results.slice(config.warmupFrames));

  const report = {
    config: {
      ...config,
      paddedTileSize,
      bytesPerPage,
      cacheMemoryMiB: round(bytesPerPage * config.cacheSlots / 1024 / 1024),
      mipCount
    },
    assetManifestSketch: {
      id: "royal.generated-terrain-material.vt0",
      virtualSize: [config.virtualSize, config.virtualSize],
      pageSize: config.usableTileSize,
      borderTexels: config.borderTexels,
      mipCount,
      colorSpace: "srgb",
      variants: [
        { id: "rgba8-dev", format: "rgba8", bytesPerPage },
        { id: "ktx2-uastc", format: "ktx2-basis-uastc", blockMultiple: 4 },
        { id: "ktx2-etc1s-far", format: "ktx2-basis-etc1s", blockMultiple: 4 }
      ],
      samplePages: sampleManifest
    },
    totals: {
      simulatedFrames: frames.length,
      warmupFrames: config.warmupFrames,
      totalCpuMs: round(totalMs),
      averageCpuMsPerFrame: round(totalMs / frames.length)
    },
    summary,
    gates: {
      maxUploadsPerFrame: {
        target: config.maxUploadsPerFrame,
        actual: summary.maxUploads,
        pass: summary.maxUploads <= config.maxUploadsPerFrame
      },
      maxUploadBytesPerFrame: {
        target: config.maxUploadBytesPerFrame,
        actual: summary.maxUploadBytes,
        pass: summary.maxUploadBytes <= config.maxUploadBytesPerFrame
      },
      averageEstimatedUploadMs: {
        target: 2,
        actual: summary.averageUploadMs,
        pass: summary.averageUploadMs < 2
      },
      exactHitRatioAfterWarmup: {
        target: 0.95,
        actual: summary.exactHitRatio,
        pass: summary.exactHitRatio >= 0.95
      },
      maxSeamCandidates: {
        target: 96,
        actual: summary.maxSeamCandidates,
        pass: summary.maxSeamCandidates <= 96
      }
    },
    frameSamples: [
      results[0],
      results[config.warmupFrames],
      results[Math.floor(results.length / 2)],
      results[results.length - 1]
    ]
  };

  if (includeFrames) report.frames = results;

  console.log(JSON.stringify(report, null, 2));
}

main();
