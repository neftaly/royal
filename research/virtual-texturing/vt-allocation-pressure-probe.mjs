#!/usr/bin/env node

import { PerformanceObserver, constants, performance } from "node:perf_hooks";

const PROBE = "vt-allocation-pressure-probe";
const DEFAULTS = Object.freeze({
  seed: 0x76745a30,
  frames: 180,
  warmupFrames: 30,
  usableTileSize: 128,
  borderTexels: 4,
  bytesPerTexel: 4,
  pagesPerFrame: 5,
  zoomBurstPages: 18,
  zoomBurstEveryFrames: 45,
  zoomBurstWidthFrames: 5,
  uploadPagesPerFrame: 8,
  staleAfterFrames: 12,
  transferPoolSize: 48,
  transferMaxBuffers: 48,
  sabArenaSlots: 48,
  touchStrideBytes: 256,
  gcIntervalFrames: 30,
  forceGc: typeof globalThis.gc === "function",
  mode: "all",
});

const GC_KIND_NAMES = new Map([
  [constants.NODE_PERFORMANCE_GC_MAJOR, "major"],
  [constants.NODE_PERFORMANCE_GC_MINOR, "minor"],
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL, "incremental"],
  [constants.NODE_PERFORMANCE_GC_WEAKCB, "weakcb"],
]);

const ALL_MODES = ["fresh-uint8array", "pooled-transfer-buffer", "sab-arena"];

main().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = readConfig(args);
  const gcMonitor = createGcMonitor();
  const modes = config.mode === "all" ? ALL_MODES : [config.mode];
  const workload = createWorkload(config);
  const scenarios = [];

  for (const mode of modes) {
    scenarios.push(await runScenario(mode, config, workload, gcMonitor));
  }

  gcMonitor.disconnect();

  const comparison = compareScenarios(scenarios);
  const recommendations = buildRecommendations(scenarios, comparison, config);
  const checks = args.check ? evaluateChecks(scenarios, comparison, config) : {
    enabled: false,
    passed: null,
    thresholds: checkThresholds(config),
    failures: [],
  };

  const report = {
    probe: PROBE,
    date: new Date().toISOString(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      sharedArrayBufferAvailable: typeof SharedArrayBuffer === "function",
      gcObserver: "node:perf_hooks PerformanceObserver entryType=gc",
      explicitGcAvailable: typeof globalThis.gc === "function",
      explicitGcRequested: config.forceGc,
    },
    model: {
      pagePayload:
        "One generated VT page payload is a padded RGBA tile buffer that would feed texSubImage2D or an equivalent upload path.",
      freshUint8Array:
        "Allocates a new Uint8Array for every generated page. Uploaded pages are released after the simulated upload queue drains.",
      pooledTransferBuffer:
        "Preallocates ArrayBuffers and models a transferable-buffer return path: generation acquires a buffer, upload returns it to the pool.",
      sabArena:
        "Preallocates one SharedArrayBuffer arena and reuses fixed page slots. This bounds payload allocation but maps to browser deployments only when cross-origin isolation permits SAB.",
      latency:
        "frameLatencyMs is wall-clock CPU time for demand, page generation, upload drain, optional explicit GC, and queue bookkeeping. pageLatencyFrames measures demand-to-upload queue delay.",
    },
    config: publicConfig(config),
    scenarios,
    comparison,
    recommendations,
    checks,
  };

  console.log(JSON.stringify(report, null, 2));
  if (checks.enabled && !checks.passed) process.exitCode = 1;
}

async function runScenario(mode, config, workload, gcMonitor) {
  if (mode === "sab-arena" && typeof SharedArrayBuffer !== "function") {
    return {
      mode,
      skipped: true,
      reason: "SharedArrayBuffer is not available in this Node runtime.",
    };
  }

  const allocator = createAllocator(mode, config);
  const uploadQueue = [];
  const deferredDemand = [];
  const frameTimes = [];
  const measuredFrameTimes = [];
  const pageLatencyFrames = [];
  const pageLatencyMs = [];
  const allocationsByFrame = [];
  const bytesByFrame = [];
  await flushPerformanceObserver();
  const gcBefore = gcMonitor.snapshot();
  const memoryStart = process.memoryUsage();
  let memoryPeak = memoryStart;
  let generatedPages = 0;
  let uploadedPages = 0;
  let staleDrops = 0;
  let backpressureEvents = 0;
  let maxUploadQueueDepth = 0;
  let maxDeferredDemand = 0;
  let checksum = 0;

  const startedAt = performance.now();
  for (let frame = 0; frame < config.frames; frame += 1) {
    const frameStartedAt = performance.now();
    const beforeAllocations = allocator.payloadAllocations;
    const beforeBytes = allocator.payloadAllocatedBytes;
    const demand = [...deferredDemand.splice(0), ...workload[frame]];

    for (const page of demand) {
      if (frame - page.requestFrame > config.staleAfterFrames) {
        staleDrops += 1;
        continue;
      }

      const payload = allocator.acquire();
      if (!payload) {
        deferredDemand.push(page);
        backpressureEvents += 1;
        continue;
      }

      writePagePayload(payload.bytes, page, config);
      uploadQueue.push({
        ...page,
        generatedFrame: frame,
        generatedAt: performance.now(),
        payload,
      });
      generatedPages += 1;
    }

    maxDeferredDemand = Math.max(maxDeferredDemand, deferredDemand.length);
    maxUploadQueueDepth = Math.max(maxUploadQueueDepth, uploadQueue.length);

    let uploadsThisFrame = 0;
    while (uploadsThisFrame < config.uploadPagesPerFrame && uploadQueue.length > 0) {
      const upload = uploadQueue.shift();
      if (frame - upload.requestFrame > config.staleAfterFrames) {
        staleDrops += 1;
        allocator.release(upload.payload);
        continue;
      }

      checksum = consumeUploadPayload(upload.payload.bytes, checksum);
      uploadedPages += 1;
      uploadsThisFrame += 1;
      if (frame >= config.warmupFrames) {
        pageLatencyFrames.push(frame - upload.requestFrame);
        pageLatencyMs.push(performance.now() - upload.generatedAt);
      }
      allocator.release(upload.payload);
    }

    if (config.forceGc && frame > 0 && frame % config.gcIntervalFrames === 0) {
      globalThis.gc();
    }

    const frameLatencyMs = performance.now() - frameStartedAt;
    frameTimes.push(frameLatencyMs);
    allocationsByFrame.push(allocator.payloadAllocations - beforeAllocations);
    bytesByFrame.push(allocator.payloadAllocatedBytes - beforeBytes);
    if (frame >= config.warmupFrames) measuredFrameTimes.push(frameLatencyMs);
    memoryPeak = maxMemory(memoryPeak, process.memoryUsage());
  }

  for (const upload of uploadQueue.splice(0)) {
    allocator.release(upload.payload);
  }
  await flushPerformanceObserver();

  const durationMs = performance.now() - startedAt;
  const memoryEnd = process.memoryUsage();
  const gcAfter = gcMonitor.snapshot();
  const measuredAllocations = sum(allocationsByFrame.slice(config.warmupFrames));
  const measuredBytes = sum(bytesByFrame.slice(config.warmupFrames));
  const measuredFrames = Math.max(1, config.frames - config.warmupFrames);
  const totalDemandPages = workload.reduce((total, pages) => total + pages.length, 0);

  return {
    mode,
    skipped: false,
    durationMs: round(durationMs),
    totalDemandPages,
    generatedPages,
    uploadedPages,
    staleDrops,
    deferredPagesAtEnd: deferredDemand.length,
    backpressureEvents,
    checksum: checksum >>> 0,
    pagePayloadBytes: config.pagePayloadBytes,
    setupAllocation: allocator.setupAllocation,
    allocations: {
      payloadBufferAllocations: allocator.payloadAllocations,
      measuredPayloadBufferAllocations: measuredAllocations,
      allocationsPerMeasuredFrame: round(measuredAllocations / measuredFrames),
      payloadAllocatedBytes: allocator.payloadAllocatedBytes,
      measuredPayloadAllocatedBytes: measuredBytes,
      allocatedBytesPerMeasuredFrame: round(measuredBytes / measuredFrames),
    },
    queues: {
      maxUploadQueueDepth,
      maxDeferredDemand,
      allocatorHighWatermark: allocator.highWatermark,
      availableAtEnd: allocator.availableCount(),
    },
    frameLatencyMs: summarize(measuredFrameTimes),
    pageLatencyFrames: summarize(pageLatencyFrames),
    pageLatencyMs: summarize(pageLatencyMs),
    gc: summarizeGcRange(gcMonitor, gcBefore, gcAfter),
    memory: summarizeMemory(memoryStart, memoryEnd, memoryPeak),
  };
}

function createAllocator(mode, config) {
  if (mode === "fresh-uint8array") return createFreshAllocator(config);
  if (mode === "pooled-transfer-buffer") return createPooledAllocator(config);
  if (mode === "sab-arena") return createSabAllocator(config);
  throw new Error(`Unknown mode: ${mode}`);
}

function createFreshAllocator(config) {
  return {
    setupAllocation: { payloadBufferAllocations: 0, payloadAllocatedBytes: 0 },
    payloadAllocations: 0,
    payloadAllocatedBytes: 0,
    highWatermark: 0,
    live: 0,
    acquire() {
      this.payloadAllocations += 1;
      this.payloadAllocatedBytes += config.pagePayloadBytes;
      this.live += 1;
      this.highWatermark = Math.max(this.highWatermark, this.live);
      return { kind: "fresh", bytes: new Uint8Array(config.pagePayloadBytes) };
    },
    release() {
      this.live -= 1;
    },
    availableCount() {
      return "unbounded";
    },
  };
}

function createPooledAllocator(config) {
  const free = [];
  for (let index = 0; index < config.transferPoolSize; index += 1) {
    free.push(new Uint8Array(new ArrayBuffer(config.pagePayloadBytes)));
  }
  let totalBuffers = config.transferPoolSize;
  return {
    setupAllocation: {
      payloadBufferAllocations: config.transferPoolSize,
      payloadAllocatedBytes: config.transferPoolSize * config.pagePayloadBytes,
    },
    payloadAllocations: 0,
    payloadAllocatedBytes: 0,
    highWatermark: 0,
    live: 0,
    acquire() {
      let bytes = free.pop();
      if (!bytes && totalBuffers < config.transferMaxBuffers) {
        bytes = new Uint8Array(new ArrayBuffer(config.pagePayloadBytes));
        totalBuffers += 1;
        this.payloadAllocations += 1;
        this.payloadAllocatedBytes += config.pagePayloadBytes;
      }
      if (!bytes) return null;
      this.live += 1;
      this.highWatermark = Math.max(this.highWatermark, this.live);
      return { kind: "pooled", bytes };
    },
    release(payload) {
      this.live -= 1;
      free.push(payload.bytes);
    },
    availableCount() {
      return free.length;
    },
  };
}

function createSabAllocator(config) {
  const arena = new SharedArrayBuffer(config.pagePayloadBytes * config.sabArenaSlots);
  const free = [];
  for (let slot = 0; slot < config.sabArenaSlots; slot += 1) {
    free.push(slot);
  }
  return {
    setupAllocation: {
      payloadBufferAllocations: 1,
      payloadAllocatedBytes: arena.byteLength,
    },
    payloadAllocations: 0,
    payloadAllocatedBytes: 0,
    highWatermark: 0,
    live: 0,
    acquire() {
      const slot = free.pop();
      if (slot === undefined) return null;
      this.live += 1;
      this.highWatermark = Math.max(this.highWatermark, this.live);
      return {
        kind: "sab",
        slot,
        bytes: new Uint8Array(arena, slot * config.pagePayloadBytes, config.pagePayloadBytes),
      };
    },
    release(payload) {
      this.live -= 1;
      free.push(payload.slot);
    },
    availableCount() {
      return free.length;
    },
  };
}

function createWorkload(config) {
  const rng = createRng(config.seed);
  const frames = [];
  for (let frame = 0; frame < config.frames; frame += 1) {
    const burstPhase = frame % config.zoomBurstEveryFrames;
    const inZoomBurst = burstPhase < config.zoomBurstWidthFrames;
    const panPressure = Math.floor((Math.sin(frame / 9) + 1) * 1.5);
    const pagesThisFrame = config.pagesPerFrame + panPressure + (inZoomBurst ? config.zoomBurstPages : 0);
    const pages = [];
    for (let index = 0; index < pagesThisFrame; index += 1) {
      pages.push({
        requestFrame: frame,
        pageId: ((frame * 131 + index * 17 + Math.floor(rng() * 0xffff)) >>> 0),
        mip: inZoomBurst ? index % 3 : 2 + (index % 4),
        x: (frame * 3 + index * 5) & 127,
        y: (frame * 7 + index * 11) & 127,
      });
    }
    frames.push(pages);
  }
  return frames;
}

function writePagePayload(bytes, page, config) {
  let value = mix32(page.pageId ^ (page.requestFrame * 0x9e3779b1) ^ config.seed);
  for (let offset = 0; offset < bytes.length; offset += config.touchStrideBytes) {
    value = mix32(value + offset + page.x * 31 + page.y * 17 + page.mip);
    bytes[offset] = value & 0xff;
    bytes[Math.min(offset + 1, bytes.length - 1)] = (value >>> 8) & 0xff;
    bytes[Math.min(offset + 2, bytes.length - 1)] = (value >>> 16) & 0xff;
    bytes[Math.min(offset + 3, bytes.length - 1)] = (value >>> 24) & 0xff;
  }
  bytes[bytes.length - 1] = (value ^ page.pageId) & 0xff;
}

function consumeUploadPayload(bytes, checksum) {
  const middle = bytes.length >>> 1;
  return mix32(
    checksum ^
      bytes[0] ^
      (bytes[middle] << 8) ^
      (bytes[bytes.length - 1] << 16) ^
      bytes.length,
  );
}

function createGcMonitor() {
  const entries = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const detail = entry.detail || {};
      entries.push({
        startTime: entry.startTime,
        duration: entry.duration,
        kind: detail.kind ?? entry.kind ?? 0,
      });
    }
  });
  observer.observe({ entryTypes: ["gc"] });
  return {
    snapshot() {
      return entries.length;
    },
    slice(from, to) {
      return entries.slice(from, to);
    },
    disconnect() {
      observer.disconnect();
    },
  };
}

function summarizeGcEntries(entries) {
  const byKind = {};
  let totalDurationMs = 0;
  for (const entry of entries) {
    const kind = GC_KIND_NAMES.get(entry.kind) || `kind-${entry.kind}`;
    byKind[kind] = (byKind[kind] || 0) + 1;
    totalDurationMs += entry.duration;
  }
  return {
    events: entries.length,
    totalDurationMs: round(totalDurationMs),
    maxDurationMs: round(max(entries.map((entry) => entry.duration))),
    byKind,
  };
}

function compareScenarios(scenarios) {
  const fresh = findScenario(scenarios, "fresh-uint8array");
  const pooled = findScenario(scenarios, "pooled-transfer-buffer");
  const sab = findScenario(scenarios, "sab-arena");
  return {
    allocationReductionVsFresh: {
      pooledTransferBuffer: reduction(fresh, pooled, "allocatedBytesPerMeasuredFrame"),
      sabArena: reduction(fresh, sab, "allocatedBytesPerMeasuredFrame"),
    },
    p99FrameLatencyDeltaMsVsFresh: {
      pooledTransferBuffer: latencyDelta(fresh, pooled),
      sabArena: latencyDelta(fresh, sab),
    },
    recommendedMinimumPoolPages: Math.max(
      pooled && !pooled.skipped ? pooled.queues.allocatorHighWatermark : 0,
      sab && !sab.skipped ? sab.queues.allocatorHighWatermark : 0,
    ),
  };
}

function buildRecommendations(scenarios, comparison, config) {
  const recommendations = [];
  const fresh = findScenario(scenarios, "fresh-uint8array");
  const pooled = findScenario(scenarios, "pooled-transfer-buffer");
  const sab = findScenario(scenarios, "sab-arena");

  if (fresh && !fresh.skipped && fresh.allocations.allocatedBytesPerMeasuredFrame > config.pagePayloadBytes) {
    recommendations.push(
      "Do not generate VT pages into fresh per-page Uint8Array payloads on the render path; the measured allocation rate is large enough to create avoidable GC candidates during zoom bursts.",
    );
  }

  if (pooled && !pooled.skipped) {
    recommendations.push(
      `Use a returned transfer-buffer pool sized to at least ${Math.max(
        comparison.recommendedMinimumPoolPages,
        config.uploadPagesPerFrame + config.zoomBurstPages,
      )} page payloads for this workload, then tune against real camera traces.`,
    );
    if (pooled.backpressureEvents > 0 || pooled.queues.maxDeferredDemand > 0) {
      recommendations.push(
        "Pool exhaustion should apply backpressure or defer stale page work; avoid spill allocations because they reintroduce the same GC pressure as the fresh path.",
      );
    }
  }

  if (sab && !sab.skipped) {
    recommendations.push(
      "A SAB arena gives the tightest allocation bound, but treat it as an opt-in transport because browser SAB requires cross-origin isolation and explicit slot ownership discipline.",
    );
  }

  recommendations.push(
    "Track allocatedBytesPerMeasuredFrame, allocator high-watermark, p95/p99 frame latency, and GC event duration next to upload budget stats when validating VT zoom hitches.",
  );
  return recommendations;
}

function evaluateChecks(scenarios, comparison, config) {
  const thresholds = checkThresholds(config);
  const failures = [];
  const fresh = findScenario(scenarios, "fresh-uint8array");
  const pooled = findScenario(scenarios, "pooled-transfer-buffer");
  const sab = findScenario(scenarios, "sab-arena");

  if (fresh && !fresh.skipped) {
    if (fresh.allocations.allocatedBytesPerMeasuredFrame < thresholds.minFreshAllocatedBytesPerFrame) {
      failures.push(
        `fresh-uint8array allocated ${fresh.allocations.allocatedBytesPerMeasuredFrame} bytes/frame; expected at least ${thresholds.minFreshAllocatedBytesPerFrame}`,
      );
    }
    if (fresh.frameLatencyMs.p99 > thresholds.maxFrameLatencyP99Ms) {
      failures.push(
        `fresh-uint8array p99 frame latency ${fresh.frameLatencyMs.p99}ms exceeded ${thresholds.maxFrameLatencyP99Ms}ms`,
      );
    }
  }

  if (pooled && !pooled.skipped) {
    if (pooled.allocations.allocatedBytesPerMeasuredFrame > thresholds.maxPooledAllocatedBytesPerFrame) {
      failures.push(
        `pooled-transfer-buffer allocated ${pooled.allocations.allocatedBytesPerMeasuredFrame} bytes/frame; expected <= ${thresholds.maxPooledAllocatedBytesPerFrame}`,
      );
    }
    if (comparison.allocationReductionVsFresh.pooledTransferBuffer < thresholds.minPooledAllocationReductionVsFresh) {
      failures.push(
        `pooled-transfer-buffer allocation reduction ${comparison.allocationReductionVsFresh.pooledTransferBuffer} was below ${thresholds.minPooledAllocationReductionVsFresh}`,
      );
    }
    if (pooled.frameLatencyMs.p99 > thresholds.maxFrameLatencyP99Ms) {
      failures.push(
        `pooled-transfer-buffer p99 frame latency ${pooled.frameLatencyMs.p99}ms exceeded ${thresholds.maxFrameLatencyP99Ms}ms`,
      );
    }
  }

  if (sab && !sab.skipped) {
    if (sab.allocations.allocatedBytesPerMeasuredFrame > thresholds.maxSabAllocatedBytesPerFrame) {
      failures.push(
        `sab-arena allocated ${sab.allocations.allocatedBytesPerMeasuredFrame} bytes/frame; expected <= ${thresholds.maxSabAllocatedBytesPerFrame}`,
      );
    }
    if (comparison.allocationReductionVsFresh.sabArena < thresholds.minSabAllocationReductionVsFresh) {
      failures.push(
        `sab-arena allocation reduction ${comparison.allocationReductionVsFresh.sabArena} was below ${thresholds.minSabAllocationReductionVsFresh}`,
      );
    }
    if (sab.frameLatencyMs.p99 > thresholds.maxFrameLatencyP99Ms) {
      failures.push(`sab-arena p99 frame latency ${sab.frameLatencyMs.p99}ms exceeded ${thresholds.maxFrameLatencyP99Ms}ms`);
    }
  }

  return {
    enabled: true,
    passed: failures.length === 0,
    thresholds,
    failures,
  };
}

function checkThresholds(config) {
  return {
    minFreshAllocatedBytesPerFrame: config.pagePayloadBytes * Math.max(1, config.pagesPerFrame),
    maxPooledAllocatedBytesPerFrame: 0,
    maxSabAllocatedBytesPerFrame: 0,
    minPooledAllocationReductionVsFresh: 0.95,
    minSabAllocationReductionVsFresh: 0.99,
    maxFrameLatencyP99Ms: 50,
  };
}

function summarizeGcRange(gcMonitor, beforeIndex, afterIndex) {
  return summarizeGcEntries(gcMonitor.slice(beforeIndex, afterIndex));
}

function summarize(values) {
  if (values.length === 0) {
    return { count: 0, min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: round(sorted[0]),
    mean: round(sum(sorted) / sorted.length),
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1]),
  };
}

function summarizeMemory(start, end, peak) {
  return {
    start: memoryFields(start),
    end: memoryFields(end),
    peak: memoryFields(peak),
    delta: {
      heapUsed: end.heapUsed - start.heapUsed,
      external: end.external - start.external,
      arrayBuffers: end.arrayBuffers - start.arrayBuffers,
      rss: end.rss - start.rss,
    },
  };
}

function memoryFields(memory) {
  return {
    rss: memory.rss,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
}

function maxMemory(a, b) {
  return {
    rss: Math.max(a.rss, b.rss),
    heapUsed: Math.max(a.heapUsed, b.heapUsed),
    external: Math.max(a.external, b.external),
    arrayBuffers: Math.max(a.arrayBuffers, b.arrayBuffers),
  };
}

function publicConfig(config) {
  return {
    seed: config.seed,
    frames: config.frames,
    warmupFrames: config.warmupFrames,
    measuredFrames: config.frames - config.warmupFrames,
    usableTileSize: config.usableTileSize,
    borderTexels: config.borderTexels,
    paddedTileSize: config.paddedTileSize,
    bytesPerTexel: config.bytesPerTexel,
    pagePayloadBytes: config.pagePayloadBytes,
    pagesPerFrame: config.pagesPerFrame,
    zoomBurstPages: config.zoomBurstPages,
    zoomBurstEveryFrames: config.zoomBurstEveryFrames,
    zoomBurstWidthFrames: config.zoomBurstWidthFrames,
    uploadPagesPerFrame: config.uploadPagesPerFrame,
    staleAfterFrames: config.staleAfterFrames,
    transferPoolSize: config.transferPoolSize,
    transferMaxBuffers: config.transferMaxBuffers,
    sabArenaSlots: config.sabArenaSlots,
    touchStrideBytes: config.touchStrideBytes,
    forceGc: config.forceGc,
    gcIntervalFrames: config.gcIntervalFrames,
    mode: config.mode,
  };
}

function parseArgs(argv) {
  const args = { check: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") {
      args.check = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--force-gc") {
      args.forceGc = true;
    } else if (arg === "--no-force-gc") {
      args.forceGc = false;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      args[toCamelCase(key)] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function readConfig(args) {
  const usableTileSize = readInt(args.usableTileSize, DEFAULTS.usableTileSize, "usable-tile-size");
  const borderTexels = readInt(args.borderTexels, DEFAULTS.borderTexels, "border-texels");
  const bytesPerTexel = readInt(args.bytesPerTexel, DEFAULTS.bytesPerTexel, "bytes-per-texel");
  const paddedTileSize = usableTileSize + borderTexels * 2;
  const config = {
    seed: readInt(args.seed, DEFAULTS.seed, "seed"),
    frames: readInt(args.frames, DEFAULTS.frames, "frames"),
    warmupFrames: readInt(args.warmupFrames, DEFAULTS.warmupFrames, "warmup-frames"),
    usableTileSize,
    borderTexels,
    bytesPerTexel,
    paddedTileSize,
    pagePayloadBytes: readInt(args.pagePayloadBytes, paddedTileSize * paddedTileSize * bytesPerTexel, "page-payload-bytes"),
    pagesPerFrame: readInt(args.pagesPerFrame, DEFAULTS.pagesPerFrame, "pages-per-frame"),
    zoomBurstPages: readInt(args.zoomBurstPages, DEFAULTS.zoomBurstPages, "zoom-burst-pages"),
    zoomBurstEveryFrames: readInt(args.zoomBurstEveryFrames, DEFAULTS.zoomBurstEveryFrames, "zoom-burst-every-frames"),
    zoomBurstWidthFrames: readInt(args.zoomBurstWidthFrames, DEFAULTS.zoomBurstWidthFrames, "zoom-burst-width-frames"),
    uploadPagesPerFrame: readInt(args.uploadPagesPerFrame, DEFAULTS.uploadPagesPerFrame, "upload-pages-per-frame"),
    staleAfterFrames: readInt(args.staleAfterFrames, DEFAULTS.staleAfterFrames, "stale-after-frames"),
    transferPoolSize: readInt(args.transferPoolSize, DEFAULTS.transferPoolSize, "transfer-pool-size"),
    transferMaxBuffers: readInt(args.transferMaxBuffers, DEFAULTS.transferMaxBuffers, "transfer-max-buffers"),
    sabArenaSlots: readInt(args.sabArenaSlots, DEFAULTS.sabArenaSlots, "sab-arena-slots"),
    touchStrideBytes: readInt(args.touchStrideBytes, DEFAULTS.touchStrideBytes, "touch-stride-bytes"),
    gcIntervalFrames: readInt(args.gcIntervalFrames, DEFAULTS.gcIntervalFrames, "gc-interval-frames"),
    forceGc: args.forceGc ?? DEFAULTS.forceGc,
    mode: args.mode || DEFAULTS.mode,
  };

  if (!["all", ...ALL_MODES].includes(config.mode)) {
    throw new Error(`--mode must be one of all, ${ALL_MODES.join(", ")}`);
  }
  if (config.frames <= config.warmupFrames) {
    throw new Error("--frames must be greater than --warmup-frames");
  }
  if (config.pagePayloadBytes <= 0) throw new Error("--page-payload-bytes must be positive");
  if (config.transferPoolSize <= 0) throw new Error("--transfer-pool-size must be positive");
  if (config.transferMaxBuffers < config.transferPoolSize) {
    throw new Error("--transfer-max-buffers must be greater than or equal to --transfer-pool-size");
  }
  if (config.sabArenaSlots <= 0) throw new Error("--sab-arena-slots must be positive");
  if (config.gcIntervalFrames <= 0) throw new Error("--gc-interval-frames must be positive");
  return config;
}

function readInt(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer`);
  return parsed;
}

function printHelp() {
  console.log(`Usage: node --expose-gc research/virtual-texturing/vt-allocation-pressure-probe.mjs [--check]

Models VT page payload allocation pressure for zoom bursts and upload backlog.

Options:
  --mode <all|fresh-uint8array|pooled-transfer-buffer|sab-arena>
  --frames <n>
  --warmup-frames <n>
  --pages-per-frame <n>
  --zoom-burst-pages <n>
  --upload-pages-per-frame <n>
  --transfer-pool-size <n>
  --sab-arena-slots <n>
  --page-payload-bytes <n>
  --force-gc | --no-force-gc
  --check
`);
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = mix32(state + 0x6d2b79f5);
    return state / 0x1_0000_0000;
  };
}

function mix32(value) {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

function findScenario(scenarios, mode) {
  return scenarios.find((scenario) => scenario.mode === mode);
}

function reduction(fresh, candidate, allocationField) {
  if (!fresh || !candidate || fresh.skipped || candidate.skipped) return null;
  const base = fresh.allocations[allocationField];
  const current = candidate.allocations[allocationField];
  if (base === 0) return current === 0 ? 1 : 0;
  return round((base - current) / base);
}

function latencyDelta(fresh, candidate) {
  if (!fresh || !candidate || fresh.skipped || candidate.skipped) return null;
  return round(candidate.frameLatencyMs.p99 - fresh.frameLatencyMs.p99);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function max(values) {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

function round(value) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value * 1000) / 1000;
}

async function flushPerformanceObserver() {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
