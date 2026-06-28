#!/usr/bin/env node

import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

const config = {
  seed: 0x726f7961,
  virtualSize: 16_384,
  usableTileSize: 128,
  borderTexels: 4,
  bytesPerTexel: 4,
  cacheSlots: 96,
  maxUploadsPerFrame: 8,
  maxUploadBytesPerFrame: 768 * 1024,
  uploadOverheadMs: 0.035,
  uploadBandwidthBytesPerMs: 650 * 1024,
  sampleGrid: { x: 30, y: 18 },
  prefetchRadius: 1,
  frames: 64,
  warmupFrames: 12
};

const expectedCheckSha256 = "cb9821041e65472407ca42f8a0112e52c45fab603a0d75148d5c589a5d1c79ee";
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
  const uploadBatch = scheduler.drain({
    maxUploads: config.maxUploadsPerFrame,
    maxBytes: config.maxUploadBytesPerFrame,
    frame: index,
    cache,
    pageTable
  });
  const dirtyEntries = pageTable.drainDirty(index);
  const uploadScheduleMs = performance.now() - t1;

  const seamCandidates = countSeamCandidates(demand.sampleCells, resolved);
  const estimatedUploadMs = estimateUploadMs(uploadBatch.uploaded.length);
  const pageTableUpdates = dirtyEntries.length;
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
    uploadedPages: uploadBatch.uploaded.length,
    uploadBytes: uploadBatch.uploaded.length * bytesPerPage,
    estimatedUploadMs: round(estimatedUploadMs),
    evictedPages: uploadBatch.evicted.length,
    pageTableUpdates,
    residentPages: cache.size,
    queuedPagesAfterBudget: scheduler.size,
    seamCandidates,
    demandMs: round(demandMs),
    uploadScheduleMs: round(uploadScheduleMs),
    mipRequests: demand.mipCounts,
    resolvedMipDeltas: resolvedMipDeltas(demand.pages.values(), resolved),
    uploads: uploadBatch.uploaded.map(uploadEventSummary),
    evictions: uploadBatch.evicted.map(evictionEventSummary),
    dirtyEntryQueue: dirtyEntries.map(dirtyEntrySummary),
    residency: cache.debugSummary(),
    pageTable: pageTable.debugSummary()
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
    const uploaded = [];
    const evicted = [];
    let bytes = 0;

    for (const page of candidates) {
      if (uploaded.length >= maxUploads) break;
      if (bytes + bytesPerPage > maxBytes) break;
      if (cache.has(page.key)) {
        this.requests.delete(page.key);
        continue;
      }
      const result = cache.insert(page, frame);
      const entry = pageTable.setResident(page, {
        slot: result.slot,
        frame,
        uploadSerial: result.uploadSerial
      });
      if (result.evicted) {
        evicted.push({
          frame,
          key: result.evicted.key,
          slot: result.evicted.slot,
          mip: result.evicted.mip,
          x: result.evicted.x,
          y: result.evicted.y,
          lastUsedFrame: result.evicted.lastUsedFrame
        });
        pageTable.invalidate(result.evicted, { frame, reason: "slot-reused" });
      }
      this.requests.delete(page.key);
      uploaded.push({
        frame,
        key: page.key,
        mip: page.mip,
        x: page.x,
        y: page.y,
        slot: result.slot,
        bytes: bytesPerPage,
        pageTableEntry: entry
      });
      bytes += bytesPerPage;
    }

    return { uploaded, evicted };
  }
}

class PhysicalPageCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.pages = new Map();
    this.slotColumns = Math.ceil(Math.sqrt(capacity));
    this.slots = Array.from({ length: capacity }, (_, slot) => ({
      slot,
      slotX: slot % this.slotColumns,
      slotY: Math.floor(slot / this.slotColumns),
      pageKey: null,
      status: "free",
      loadedFrame: null,
      lastUsedFrame: null
    }));
    this.freeSlots = this.slots.map((slot) => slot.slot);
    this.uploadSerial = 0;
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
    if (page) {
      page.lastUsedFrame = frame;
      this.slots[page.slot] = slotFromPage(page, this.slotColumns, "resident");
    }
  }

  insert(page, frame) {
    const existing = this.pages.get(page.key);
    if (existing) {
      existing.lastUsedFrame = frame;
      this.slots[existing.slot] = slotFromPage(existing, this.slotColumns, "resident");
      return { slot: existing.slot, evicted: null, uploadSerial: existing.uploadSerial };
    }

    let slot = this.freeSlots.shift();
    let evicted = null;
    if (slot === undefined) {
      evicted = this.findEvictionCandidate();
      this.pages.delete(evicted.key);
      slot = evicted.slot;
    }

    const uploadSerial = this.uploadSerial;
    this.uploadSerial += 1;
    this.pages.set(page.key, {
      key: page.key,
      mip: page.mip,
      x: page.x,
      y: page.y,
      slot,
      loadedFrame: frame,
      lastUsedFrame: frame,
      uploadSerial
    });
    this.slots[slot] = slotFromPage(this.pages.get(page.key), this.slotColumns, "resident");
    return { slot, evicted, uploadSerial };
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

  debugSlots() {
    return this.slots.map((slot) => ({ ...slot }));
  }

  debugSummary() {
    const byMip = {};
    for (const page of this.pages.values()) {
      byMip[`mip${page.mip}`] = (byMip[`mip${page.mip}`] ?? 0) + 1;
    }
    return {
      residentPages: this.pages.size,
      freeSlots: this.freeSlots.length,
      capacity: this.capacity,
      slotColumns: this.slotColumns,
      byMip
    };
  }
}

function evictionScore(page) {
  return page.lastUsedFrame * 10 + page.mip;
}

class PageTable {
  constructor({ slotColumns }) {
    this.slotColumns = slotColumns;
    this.entries = new Map();
    this.dirtyQueue = new DirtyEntryQueue();
    this.version = 0;
  }

  setResident(page, { slot, frame, uploadSerial }) {
    const entry = {
      key: page.key,
      virtualPage: {
        mip: page.mip,
        x: page.x,
        y: page.y
      },
      physicalSlot: physicalSlotAddress(slot, this.slotColumns),
      residentMip: page.mip,
      mipDelta: 0,
      flags: ["resident", "exact"],
      version: this.version,
      updatedFrame: frame,
      uploadSerial,
      seamDebug: {
        borderTexels: config.borderTexels,
        paddedTileSize,
        localUvRemap: [
          config.borderTexels / paddedTileSize,
          config.usableTileSize / paddedTileSize
        ],
        risk: "exact-resident"
      }
    };
    entry.encodedRgba8 = encodePageTableEntry(entry);
    this.version += 1;
    this.entries.set(page.key, entry);
    this.dirtyQueue.enqueue({
      op: "upload",
      frame,
      key: page.key,
      tableCoord: tableCoord(page),
      entry
    });
    return entry;
  }

  invalidate(page, { frame, reason }) {
    const existing = this.entries.get(page.key);
    this.entries.delete(page.key);
    const staleEntry = existing ?? {
      key: page.key,
      virtualPage: {
        mip: page.mip,
        x: page.x,
        y: page.y
      },
      physicalSlot: null,
      residentMip: null,
      mipDelta: null,
      flags: ["unmapped"],
      version: this.version,
      updatedFrame: frame,
      uploadSerial: null,
      seamDebug: {
        borderTexels: config.borderTexels,
        paddedTileSize,
        localUvRemap: null,
        risk: "missing"
      },
      encodedRgba8: [0, 0, 0, 0]
    };
    const entry = {
      ...staleEntry,
      physicalSlot: null,
      residentMip: null,
      mipDelta: null,
      flags: ["unmapped"],
      version: this.version,
      updatedFrame: frame,
      encodedRgba8: [0, 0, 0, 0],
      seamDebug: {
        borderTexels: config.borderTexels,
        paddedTileSize,
        localUvRemap: null,
        risk: "missing"
      }
    };
    this.version += 1;
    this.dirtyQueue.enqueue({
      op: "evict",
      frame,
      key: page.key,
      reason,
      tableCoord: tableCoord(page),
      entry
    });
  }

  drainDirty(frame) {
    return this.dirtyQueue.drain(frame);
  }

  debugEntries(limit = 24) {
    return [...this.entries.values()]
      .sort((a, b) => a.virtualPage.mip - b.virtualPage.mip || a.virtualPage.y - b.virtualPage.y || a.virtualPage.x - b.virtualPage.x)
      .slice(0, limit)
      .map(pageTableEntrySummary);
  }

  debugSummary() {
    const byMip = {};
    for (const entry of this.entries.values()) {
      const key = `mip${entry.virtualPage.mip}`;
      byMip[key] = (byMip[key] ?? 0) + 1;
    }
    return {
      mappedEntries: this.entries.size,
      dirtyEntriesPending: this.dirtyQueue.size,
      version: this.version,
      byMip
    };
  }
}

class DirtyEntryQueue {
  constructor() {
    this.rows = [];
  }

  get size() {
    return this.rows.length;
  }

  enqueue(row) {
    this.rows.push({
      sequence: this.rows.length,
      ...row
    });
  }

  drain(frame) {
    const rows = this.rows.map((row, index) => ({
      ...row,
      batchIndex: index,
      drainedFrame: frame
    }));
    this.rows = [];
    return rows;
  }
}

function slotFromPage(page, slotColumns, status) {
  return {
    slot: page.slot,
    slotX: page.slot % slotColumns,
    slotY: Math.floor(page.slot / slotColumns),
    pageKey: page.key,
    mip: page.mip,
    x: page.x,
    y: page.y,
    status,
    loadedFrame: page.loadedFrame,
    lastUsedFrame: page.lastUsedFrame,
    uploadSerial: page.uploadSerial
  };
}

function physicalSlotAddress(slot, slotColumns) {
  return {
    slot,
    x: slot % slotColumns,
    y: Math.floor(slot / slotColumns)
  };
}

function tableCoord(page) {
  return {
    mip: page.mip,
    x: page.x,
    y: page.y
  };
}

function encodePageTableEntry(entry) {
  const slot = entry.physicalSlot;
  if (!slot) return [0, 0, 0, 0];
  const flags = entry.flags.includes("resident") ? 1 : 0;
  const version = (entry.version % 128) << 1;
  return [
    clamp(slot.x, 0, 255),
    clamp(slot.y, 0, 255),
    clamp(entry.mipDelta ?? 0, 0, 255),
    clamp(version | flags, 0, 255)
  ];
}

function pageTableEntrySummary(entry) {
  return {
    key: entry.key,
    virtualPage: entry.virtualPage,
    physicalSlot: entry.physicalSlot,
    residentMip: entry.residentMip,
    mipDelta: entry.mipDelta,
    flags: entry.flags,
    version: entry.version,
    updatedFrame: entry.updatedFrame,
    encodedRgba8: entry.encodedRgba8,
    seamDebug: entry.seamDebug
  };
}

function uploadEventSummary(event) {
  return {
    key: event.key,
    slot: event.slot,
    mip: event.mip,
    x: event.x,
    y: event.y,
    bytes: event.bytes,
    pageTableEntry: pageTableEntrySummary(event.pageTableEntry)
  };
}

function evictionEventSummary(event) {
  return {
    key: event.key,
    slot: event.slot,
    mip: event.mip,
    x: event.x,
    y: event.y,
    lastUsedFrame: event.lastUsedFrame
  };
}

function dirtyEntrySummary(row) {
  return {
    sequence: row.sequence,
    batchIndex: row.batchIndex,
    op: row.op,
    key: row.key,
    reason: row.reason ?? null,
    tableCoord: row.tableCoord,
    encodedRgba8: row.entry.encodedRgba8,
    flags: row.entry.flags,
    physicalSlot: row.entry.physicalSlot,
    version: row.entry.version
  };
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

function buildLiveDataStructures({ results }) {
  const lastFrame = results.at(-1);
  const dirtyOperationCounts = results.reduce((acc, frame) => {
    for (const row of frame.dirtyEntryQueue) {
      acc[row.op] = (acc[row.op] ?? 0) + 1;
    }
    return acc;
  }, {});
  const evictionSamples = results
    .flatMap((frame) => frame.evictions.map((event) => ({ frame: frame.frame, ...event })))
    .slice(-12);
  const uploadSamples = results
    .flatMap((frame) => frame.uploads.map((event) => ({ frame: frame.frame, ...event })))
    .slice(-12);

  return {
    pageTableEntries: pageTable.debugEntries(),
    physicalCacheSlots: cache.debugSlots(),
    dirtyEntryQueue: {
      pending: pageTable.dirtyQueue.size,
      operationCounts: dirtyOperationCounts,
      lastFrameBatch: lastFrame.dirtyEntryQueue
    },
    uploadAndEvictionEvents: {
      recentUploads: uploadSamples,
      recentEvictions: evictionSamples
    },
    residencySummary: cache.debugSummary(),
    pageTableSummary: pageTable.debugSummary(),
    seamDebugSummary: {
      lastFrameSeamCandidates: lastFrame.seamCandidates,
      maxSeamCandidates: Math.max(...results.map((frame) => frame.seamCandidates)),
      resolvedMipDeltasLastFrame: lastFrame.resolvedMipDeltas,
      borderTexels: config.borderTexels,
      paddedTileSize
    }
  };
}

function stableReportSha256(report) {
  return createHash("sha256").update(JSON.stringify(stableReport(report))).digest("hex");
}

function stableReport(report) {
  return {
    config: report.config,
    summary: report.summary,
    gates: report.gates,
    frameSamples: report.frameSamples.map((frame) => ({
      ...frame,
      demandMs: 0,
      uploadScheduleMs: 0
    })),
    liveDataStructures: report.liveDataStructures
  };
}

function runChecks(report) {
  const failures = [];
  for (const [name, gate] of Object.entries(report.gates)) {
    if (!gate.pass) failures.push(`${name} failed: ${gate.actual} vs ${gate.target}`);
  }
  if (report.summary.totalEvictions <= 0) failures.push("expected the stress cache to exercise at least one eviction");
  if (report.liveDataStructures.dirtyEntryQueue.operationCounts.upload <= 0) failures.push("expected upload dirty entries");
  if (report.liveDataStructures.dirtyEntryQueue.operationCounts.evict <= 0) failures.push("expected eviction dirty entries");
  if (report.liveDataStructures.pageTableEntries.length === 0) failures.push("expected resident page-table entries");
  if (report.liveDataStructures.physicalCacheSlots.length !== config.cacheSlots) failures.push("physical slot count mismatch");

  const sha256 = stableReportSha256(report);
  if (expectedCheckSha256 && sha256 !== expectedCheckSha256) {
    failures.push(`deterministic report sha256 mismatch: expected ${expectedCheckSha256}, got ${sha256}`);
  }

  return { failures, sha256 };
}

function main() {
  const includeFrames = process.argv.includes("--frames");
  const check = process.argv.includes("--check");
  const rng = mulberry32(config.seed);
  cache = new PhysicalPageCache(config.cacheSlots);
  scheduler = new UploadScheduler();
  pageTable = new PageTable({ slotColumns: cache.slotColumns });

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
    ],
    liveDataStructures: buildLiveDataStructures({ results })
  };

  if (includeFrames) report.frames = results;
  if (check) {
    const { failures, sha256 } = runChecks(report);
    if (failures.length > 0) {
      throw new Error(`virtual texturing cache sim check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    }
    console.log(`virtual texturing cache sim checked: ${config.frames} frames, ${summary.totalEvictions} evictions, sha256 ${sha256}`);
    return;
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
