#!/usr/bin/env node

import { isMainThread, parentPort, workerData, Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

// This runner is Node-based so it can live as a self-contained research script.
// The transfer path mirrors browser Worker.postMessage(message, [arrayBuffer]):
// the page payload buffer changes ownership, then the renderer returns that
// empty buffer token to the worker pool after upload. The SAB path mirrors a
// browser SharedArrayBuffer arena guarded by Atomics; browsers must additionally
// satisfy cross-origin isolation before enabling that transport.

const PROTOTYPE = "vt-worker-transport-prototype";
const PROTOCOL_VERSION = 1;

const SLOT_EMPTY = 0;
const SLOT_WRITING = 1;
const SLOT_READY = 2;

const HEADER_INTS = 8;
const SLOT_INTS = 8;

const HEADER_PROTOCOL_VERSION = 0;
const HEADER_OCCUPIED_SLOTS = 1;
const HEADER_WRITE_CURSOR = 2;

const SLOT_STATE = 0;
const SLOT_SEQUENCE = 1;
const SLOT_PAGE_ID = 2;
const SLOT_REQUEST_FRAME = 3;
const SLOT_BYTE_LENGTH = 4;
const SLOT_CHECKSUM = 5;

const DEFAULTS = Object.freeze({
  mode: "both",
  seed: 0x7654_2026,
  frames: 72,
  warmupFrames: 12,
  pagesPerFrame: 8,
  pageSize: 16 * 1024,
  uploadPagesPerFrame: 6,
  frameIntervalMs: 1,
  staleAfterFrames: 8,
  workingSetPages: 192,
  workerQueueLimit: 128,
  transferPoolSize: 32,
  transferMaxBuffers: 32,
  sabRingSlots: 32,
  drainFrames: 48,
});

if (isMainThread) {
  main().catch((error) => {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  });
} else {
  runWorker(workerData).catch((error) => {
    parentPort.postMessage({ type: "error", message: error.stack || String(error) });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const config = readConfig(args);
  const modes = config.mode === "both" ? ["transfer", "sab"] : [config.mode];
  const scenarios = [];

  for (const mode of modes) {
    scenarios.push(await runScenario(mode, config));
  }

  const checks = args.check ? evaluateChecks(scenarios, config) : {
    enabled: false,
    passed: null,
    thresholds: checkThresholds(config),
    failures: [],
  };

  const report = {
    prototype: PROTOTYPE,
    date: new Date().toISOString(),
    runtime: {
      node: process.version,
      worker: "node:worker_threads",
      sharedArrayBufferAvailable: typeof SharedArrayBuffer === "function",
    },
    browserMapping: {
      transfer:
        "Models browser Worker.postMessage(message, [arrayBuffer]) page payload delivery. Ownership moves to the renderer, then an empty buffer token is transferred back to the worker pool after upload.",
      sab:
        "Models an opt-in SharedArrayBuffer page arena plus Atomics-owned command slots. In browsers this requires cross-origin isolation before constructing the SAB transport.",
      renderer:
        "The main thread drains payloads and simulates texSubImage2D upload ownership; worker WebGL/OffscreenCanvas is intentionally out of scope.",
    },
    config: publicConfig(config),
    scenarios,
    comparison: compareScenarios(scenarios),
    checks,
  };

  console.log(JSON.stringify(report, null, 2));
  if (checks.enabled && !checks.passed) process.exitCode = 1;
}

async function runScenario(mode, config) {
  if (mode === "sab" && typeof SharedArrayBuffer !== "function") {
    return {
      mode,
      skipped: true,
      reason: "SharedArrayBuffer is not available in this runtime.",
    };
  }

  const sab = mode === "sab" ? createSabTransport(config) : null;
  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: {
      role: "vt-page-worker",
      mode,
      config: workerConfig(config),
      sab,
    },
  });

  const state = createMainState(mode, config, worker, sab);
  let workerReadyPromiseResolve;
  let workerStatsPromiseResolve;
  let workerError = null;
  const workerReadyPromise = new Promise((resolve) => {
    workerReadyPromiseResolve = resolve;
  });
  const workerStatsPromise = new Promise((resolve) => {
    workerStatsPromiseResolve = resolve;
  });

  worker.on("message", (message) => {
    if (message.type === "ready") {
      workerReadyPromiseResolve();
    } else if (message.type === "page") {
      receiveTransferPage(state, message);
    } else if (message.type === "stats") {
      workerStatsPromiseResolve(message.stats);
    } else if (message.type === "error") {
      workerError = message.message;
    }
  });

  await workerReadyPromise;
  const startedAt = performance.now();
  for (let frame = 0; frame < config.frames; frame += 1) {
    state.currentFrame = frame;
    worker.postMessage({ type: "frame", frame });
    sendDemandBatch(state, frame);
    drainUploads(state);
    await sleep(config.frameIntervalMs);
  }

  for (let extraFrame = 0; extraFrame < config.drainFrames; extraFrame += 1) {
    const frame = config.frames + extraFrame;
    state.currentFrame = frame;
    worker.postMessage({ type: "frame", frame });
    drainUploads(state);
    await sleep(config.frameIntervalMs);
  }

  worker.postMessage({ type: "stop", frame: state.currentFrame });
  const workerStats = await workerStatsPromise;
  drainUploads(state, Number.POSITIVE_INFINITY);
  await worker.terminate();

  const durationMs = performance.now() - startedAt;
  const latency = summarizeLatency(state.latencies);
  const transportBytes = summarizeTransportBytes(mode, state, workerStats);
  const droppedPages = state.mainStaleDrops + workerStats.staleDrops + workerStats.queueDrops;
  const completedPages = state.uploadedPages + droppedPages;

  return {
    mode,
    skipped: false,
    durationMs: round(durationMs),
    demandPages: state.demandPages,
    completedPages,
    uploadedPages: state.uploadedPages,
    uploadRatio: ratio(state.uploadedPages, state.demandPages),
    droppedPages,
    dropRatio: ratio(droppedPages, state.demandPages),
    staleDrops: {
      worker: workerStats.staleDrops,
      main: state.mainStaleDrops,
    },
    backpressure: {
      workerQueueDrops: workerStats.queueDrops,
      workerQueueHighWatermark: workerStats.peakQueueDepth,
      uploadBacklogFrames: state.uploadBacklogFrames,
      transferBufferWaits: workerStats.transferBufferWaits,
      sabRingSlotWaits: workerStats.sabRingSlotWaits,
      sabReadyHighWatermark: state.peakSabReadySlots,
    },
    buffers: {
      pageSizeBytes: config.pageSize,
      transferPoolSize: mode === "transfer" ? config.transferPoolSize : 0,
      transferMaxBuffers: mode === "transfer" ? config.transferMaxBuffers : 0,
      sabRingSlots: mode === "sab" ? config.sabRingSlots : 0,
      arrayBufferAllocations: workerStats.arrayBufferAllocations,
      allocatedBytes: workerStats.allocatedBytes,
      peakMainReadyPages: state.peakReadyQueue,
    },
    bytes: transportBytes,
    latencyMs: latency,
    checksum: state.checksum >>> 0,
    worker: {
      pagesGenerated: workerStats.pagesGenerated,
      pagesPublished: workerStats.pagesPublished,
      generatedBytes: workerStats.generatedBytes,
    },
    error: workerError,
  };
}

function createMainState(mode, config, worker, sab) {
  return {
    mode,
    config,
    worker,
    sab,
    currentFrame: 0,
    sequence: 0,
    demandPages: 0,
    uploadedPages: 0,
    mainStaleDrops: 0,
    bytesTransferred: 0,
    bytesShared: 0,
    bytesCopied: 0,
    checksum: 0,
    uploadBacklogFrames: 0,
    readyQueue: [],
    peakReadyQueue: 0,
    peakSabReadySlots: 0,
    latencies: [],
    sentAtBySequence: new Map(),
    latestSequenceByPage: new Map(),
  };
}

function sendDemandBatch(state, frame) {
  const demands = new Array(state.config.pagesPerFrame);
  for (let i = 0; i < state.config.pagesPerFrame; i += 1) {
    const pageId = demandPageId(state.config, frame, i);
    const sequence = state.sequence + 1;
    state.sequence = sequence;
    state.demandPages += 1;
    state.sentAtBySequence.set(sequence, performance.now());
    state.latestSequenceByPage.set(pageId, sequence);
    demands[i] = { sequence, pageId, frame };
  }
  state.worker.postMessage({ type: "demandBatch", frame, demands });
}

function receiveTransferPage(state, message) {
  state.readyQueue.push({
    sequence: message.sequence,
    pageId: message.pageId,
    requestFrame: message.requestFrame,
    byteLength: message.byteLength,
    buffer: message.buffer,
  });
  state.peakReadyQueue = Math.max(state.peakReadyQueue, state.readyQueue.length);
}

function drainUploads(state, budgetOverride = state.config.uploadPagesPerFrame) {
  if (state.mode === "transfer") {
    drainTransferUploads(state, budgetOverride);
  } else {
    drainSabUploads(state, budgetOverride);
  }
}

function drainTransferUploads(state, budget) {
  let uploaded = 0;
  while (state.readyQueue.length > 0 && uploaded < budget) {
    const page = state.readyQueue.shift();
    if (isStale(state, page)) {
      state.mainStaleDrops += 1;
      state.sentAtBySequence.delete(page.sequence);
      state.worker.postMessage({ type: "release", buffer: page.buffer }, [page.buffer]);
      continue;
    }

    uploaded += 1;
    state.uploadedPages += 1;
    state.bytesTransferred += page.byteLength;
    state.checksum = mixChecksum(state.checksum, samplePayload(new Uint8Array(page.buffer), page.byteLength));
    recordLatency(state, page.sequence);
    state.worker.postMessage({ type: "release", buffer: page.buffer }, [page.buffer]);
  }

  if (state.readyQueue.length > 0) state.uploadBacklogFrames += 1;
  state.peakReadyQueue = Math.max(state.peakReadyQueue, state.readyQueue.length);
}

function drainSabUploads(state, budget) {
  const control = state.sab.control;
  const data = state.sab.data;
  let uploaded = 0;
  let readySlots = 0;

  for (let slot = 0; slot < state.config.sabRingSlots; slot += 1) {
    const offset = slotOffset(slot);
    if (Atomics.load(control, offset + SLOT_STATE) !== SLOT_READY) continue;
    readySlots += 1;
    if (uploaded >= budget) continue;

    const page = {
      sequence: Atomics.load(control, offset + SLOT_SEQUENCE),
      pageId: Atomics.load(control, offset + SLOT_PAGE_ID),
      requestFrame: Atomics.load(control, offset + SLOT_REQUEST_FRAME),
      byteLength: Atomics.load(control, offset + SLOT_BYTE_LENGTH),
      slot,
    };

    if (isStale(state, page)) {
      state.mainStaleDrops += 1;
      state.sentAtBySequence.delete(page.sequence);
      releaseSabSlot(control, offset);
      continue;
    }

    const view = new Uint8Array(data, slot * state.config.pageSize, page.byteLength);
    uploaded += 1;
    state.uploadedPages += 1;
    state.bytesShared += page.byteLength;
    state.checksum = mixChecksum(state.checksum, samplePayload(view, page.byteLength));
    recordLatency(state, page.sequence);
    releaseSabSlot(control, offset);
  }

  state.peakSabReadySlots = Math.max(state.peakSabReadySlots, readySlots);
  if (readySlots > uploaded) state.uploadBacklogFrames += 1;
}

function releaseSabSlot(control, offset) {
  Atomics.store(control, offset + SLOT_STATE, SLOT_EMPTY);
  Atomics.sub(control, HEADER_OCCUPIED_SLOTS, 1);
  Atomics.notify(control, offset + SLOT_STATE, 1);
}

function isStale(state, page) {
  return (
    state.latestSequenceByPage.get(page.pageId) !== page.sequence ||
    state.currentFrame - page.requestFrame > state.config.staleAfterFrames
  );
}

function recordLatency(state, sequence) {
  const sentAt = state.sentAtBySequence.get(sequence);
  if (sentAt !== undefined) {
    state.latencies.push(performance.now() - sentAt);
    state.sentAtBySequence.delete(sequence);
  }
}

async function runWorker(data) {
  if (data.role !== "vt-page-worker") throw new Error(`Unexpected worker role: ${data.role}`);

  const config = data.config;
  const state = {
    mode: data.mode,
    config,
    currentFrame: 0,
    queue: [],
    processing: false,
    stopping: false,
    latestSequenceByPage: new Map(),
    buffers: [],
    allocatedBuffers: 0,
    stats: {
      requestsReceived: 0,
      staleDrops: 0,
      queueDrops: 0,
      peakQueueDepth: 0,
      pagesGenerated: 0,
      pagesPublished: 0,
      generatedBytes: 0,
      arrayBufferAllocations: 0,
      allocatedBytes: 0,
      transferBufferWaits: 0,
      sabRingSlotWaits: 0,
    },
    sab: data.sab,
  };

  if (state.mode === "transfer") {
    for (let i = 0; i < config.transferPoolSize; i += 1) {
      state.buffers.push(allocatePageBuffer(state));
    }
  } else {
    Atomics.store(state.sab.control, HEADER_PROTOCOL_VERSION, PROTOCOL_VERSION);
  }

  parentPort.postMessage({ type: "ready" });

  parentPort.on("message", (message) => {
    if (message.type === "frame") {
      state.currentFrame = message.frame;
    } else if (message.type === "demandBatch") {
      receiveDemandBatch(state, message.demands);
    } else if (message.type === "release") {
      state.buffers.push(message.buffer);
      pumpWorkerQueue(state);
    } else if (message.type === "stop") {
      state.stopping = true;
      state.currentFrame = Math.max(state.currentFrame, message.frame);
      pumpWorkerQueue(state);
    }
  });
}

function receiveDemandBatch(state, demands) {
  for (const demand of demands) {
    state.stats.requestsReceived += 1;
    state.latestSequenceByPage.set(demand.pageId, demand.sequence);
    state.queue.push(demand);
  }

  while (state.queue.length > state.config.workerQueueLimit) {
    state.queue.shift();
    state.stats.queueDrops += 1;
  }

  state.stats.peakQueueDepth = Math.max(state.stats.peakQueueDepth, state.queue.length);
  pumpWorkerQueue(state);
}

function pumpWorkerQueue(state) {
  if (state.processing) return;
  state.processing = true;
  processWorkerQueue(state).catch((error) => {
    parentPort.postMessage({ type: "error", message: error.stack || String(error) });
  });
}

async function processWorkerQueue(state) {
  while (state.queue.length > 0) {
    const demand = state.queue.shift();
    if (isWorkerStale(state, demand)) {
      state.stats.staleDrops += 1;
      continue;
    }

    if (state.mode === "transfer") {
      const buffer = await acquireTransferBuffer(state, demand);
      if (!buffer) continue;
      publishTransferPage(state, demand, buffer);
    } else {
      const slot = await acquireSabSlot(state, demand);
      if (slot === -1) continue;
      publishSabPage(state, demand, slot);
    }
  }

  state.processing = false;
  if (state.stopping) {
    parentPort.postMessage({ type: "stats", stats: state.stats });
  }
}

async function acquireTransferBuffer(state, demand) {
  while (state.buffers.length === 0) {
    if (state.allocatedBuffers < state.config.transferMaxBuffers) {
      return allocatePageBuffer(state);
    }

    if (isWorkerStale(state, demand)) {
      state.stats.staleDrops += 1;
      return null;
    }

    state.stats.transferBufferWaits += 1;
    await sleep(0);
  }

  return state.buffers.pop();
}

function allocatePageBuffer(state) {
  state.allocatedBuffers += 1;
  state.stats.arrayBufferAllocations += 1;
  state.stats.allocatedBytes += state.config.pageSize;
  return new ArrayBuffer(state.config.pageSize);
}

function publishTransferPage(state, demand, buffer) {
  const view = new Uint8Array(buffer, 0, state.config.pageSize);
  const checksum = writePagePayload(view, demand.sequence, demand.pageId, state.config.seed);
  state.stats.pagesGenerated += 1;
  state.stats.pagesPublished += 1;
  state.stats.generatedBytes += state.config.pageSize;
  parentPort.postMessage({
    type: "page",
    sequence: demand.sequence,
    pageId: demand.pageId,
    requestFrame: demand.frame,
    byteLength: state.config.pageSize,
    checksum,
    buffer,
  }, [buffer]);
}

async function acquireSabSlot(state, demand) {
  const control = state.sab.control;

  while (true) {
    const start = Atomics.add(control, HEADER_WRITE_CURSOR, 1);
    for (let probe = 0; probe < state.config.sabRingSlots; probe += 1) {
      const slot = (start + probe) % state.config.sabRingSlots;
      const offset = slotOffset(slot);
      if (
        Atomics.compareExchange(control, offset + SLOT_STATE, SLOT_EMPTY, SLOT_WRITING) ===
        SLOT_EMPTY
      ) {
        return slot;
      }
    }

    if (isWorkerStale(state, demand)) {
      state.stats.staleDrops += 1;
      return -1;
    }

    state.stats.sabRingSlotWaits += 1;
    await sleep(0);
  }
}

function publishSabPage(state, demand, slot) {
  const control = state.sab.control;
  const offset = slotOffset(slot);
  const view = new Uint8Array(state.sab.data, slot * state.config.pageSize, state.config.pageSize);
  const checksum = writePagePayload(view, demand.sequence, demand.pageId, state.config.seed);

  Atomics.store(control, offset + SLOT_SEQUENCE, demand.sequence);
  Atomics.store(control, offset + SLOT_PAGE_ID, demand.pageId);
  Atomics.store(control, offset + SLOT_REQUEST_FRAME, demand.frame);
  Atomics.store(control, offset + SLOT_BYTE_LENGTH, state.config.pageSize);
  Atomics.store(control, offset + SLOT_CHECKSUM, checksum);
  Atomics.add(control, HEADER_OCCUPIED_SLOTS, 1);
  Atomics.store(control, offset + SLOT_STATE, SLOT_READY);
  Atomics.notify(control, offset + SLOT_STATE, 1);

  state.stats.pagesGenerated += 1;
  state.stats.pagesPublished += 1;
  state.stats.generatedBytes += state.config.pageSize;
}

function isWorkerStale(state, demand) {
  return (
    state.latestSequenceByPage.get(demand.pageId) !== demand.sequence ||
    state.currentFrame - demand.frame > state.config.staleAfterFrames
  );
}

function createSabTransport(config) {
  const control = new Int32Array(new SharedArrayBuffer(
    (HEADER_INTS + config.sabRingSlots * SLOT_INTS) * Int32Array.BYTES_PER_ELEMENT,
  ));
  const data = new SharedArrayBuffer(config.sabRingSlots * config.pageSize);
  Atomics.store(control, HEADER_PROTOCOL_VERSION, PROTOCOL_VERSION);
  return { control, data };
}

function summarizeTransportBytes(mode, state, workerStats) {
  return {
    copied: state.bytesCopied,
    transferred: mode === "transfer" ? state.bytesTransferred : 0,
    shared: mode === "sab" ? state.bytesShared : 0,
    generated: workerStats.generatedBytes,
  };
}

function compareScenarios(scenarios) {
  const transfer = scenarios.find((scenario) => scenario.mode === "transfer" && !scenario.skipped);
  const sab = scenarios.find((scenario) => scenario.mode === "sab" && !scenario.skipped);
  if (!transfer || !sab) return null;

  return {
    sabMinusTransfer: {
      uploadedPages: sab.uploadedPages - transfer.uploadedPages,
      dropRatio: round(sab.dropRatio - transfer.dropRatio, 4),
      p95LatencyMs: nullableDelta(sab.latencyMs.p95, transfer.latencyMs.p95),
      arrayBufferAllocations: sab.buffers.arrayBufferAllocations - transfer.buffers.arrayBufferAllocations,
      allocatedBytes: sab.buffers.allocatedBytes - transfer.buffers.allocatedBytes,
      payloadBytes: {
        transferred: sab.bytes.transferred - transfer.bytes.transferred,
        shared: sab.bytes.shared - transfer.bytes.shared,
      },
    },
  };
}

function nullableDelta(a, b) {
  return a === null || b === null ? null : round(a - b);
}

function summarizeLatency(samples) {
  if (samples.length === 0) {
    return { samples: 0, p50: null, p95: null, p99: null, max: null };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  return {
    samples: sorted.length,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    p99: round(percentile(sorted, 0.99)),
    max: round(sorted[sorted.length - 1]),
  };
}

function percentile(sorted, p) {
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

function evaluateChecks(scenarios, config) {
  const thresholds = checkThresholds(config);
  const failures = [];

  for (const scenario of scenarios) {
    if (scenario.skipped) {
      failures.push(`${scenario.mode}: scenario skipped (${scenario.reason})`);
      continue;
    }
    if (scenario.error) failures.push(`${scenario.mode}: worker error ${scenario.error}`);
    if (scenario.uploadedPages < thresholds.minUploadedPages) {
      failures.push(`${scenario.mode}: uploaded ${scenario.uploadedPages}, expected >= ${thresholds.minUploadedPages}`);
    }
    if (scenario.dropRatio > thresholds.maxDropRatio) {
      failures.push(`${scenario.mode}: drop ratio ${scenario.dropRatio}, expected <= ${thresholds.maxDropRatio}`);
    }
    if (scenario.latencyMs.p95 === null || scenario.latencyMs.p95 > thresholds.maxP95LatencyMs) {
      failures.push(`${scenario.mode}: p95 latency ${scenario.latencyMs.p95}, expected <= ${thresholds.maxP95LatencyMs}ms`);
    }
    if (scenario.mode === "transfer") {
      if (scenario.bytes.transferred <= 0) failures.push("transfer: no transferred payload bytes recorded");
      if (scenario.buffers.arrayBufferAllocations > config.transferMaxBuffers) {
        failures.push(
          `transfer: allocations ${scenario.buffers.arrayBufferAllocations}, expected <= ${config.transferMaxBuffers}`,
        );
      }
    }
    if (scenario.mode === "sab") {
      if (scenario.bytes.shared <= 0) failures.push("sab: no shared payload bytes recorded");
      if (scenario.buffers.arrayBufferAllocations !== 0) {
        failures.push(`sab: ArrayBuffer allocations ${scenario.buffers.arrayBufferAllocations}, expected 0`);
      }
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
    minUploadedPages: Math.floor(config.frames * config.pagesPerFrame * 0.18),
    maxDropRatio: 0.9,
    maxP95LatencyMs: 75,
  };
}

function demandPageId(config, frame, index) {
  const wave = Math.floor((Math.sin((frame + index * 3) * 0.19) + 1) * 13);
  const sweep = (frame * 17 + index * 31 + wave) % config.workingSetPages;
  const hotspot = (frame + index) % 5 === 0 ? (frame * 7 + index) % 32 : sweep;
  return hotspot;
}

function writePagePayload(view, sequence, pageId, seed) {
  let value = (seed ^ Math.imul(sequence, 0x45d9f3b) ^ Math.imul(pageId + 1, 0x119de1f3)) >>> 0;
  const words = new Uint32Array(view.buffer, view.byteOffset, Math.floor(view.byteLength / 4));
  for (let i = 0; i < words.length; i += 1) {
    value = (Math.imul(value ^ (value >>> 15), 0x2c1b3c6d) + i + pageId) >>> 0;
    words[i] = value;
  }

  let checksum = 0;
  for (let i = 0; i < words.length; i += Math.max(1, Math.floor(words.length / 16))) {
    checksum = mixChecksum(checksum, words[i]);
  }
  return checksum >>> 0;
}

function samplePayload(view, byteLength) {
  let checksum = byteLength >>> 0;
  const step = Math.max(1, Math.floor(byteLength / 16));
  for (let i = 0; i < byteLength; i += step) {
    checksum = mixChecksum(checksum, view[i]);
  }
  return checksum >>> 0;
}

function mixChecksum(a, b) {
  return (Math.imul(a ^ b, 0x9e3779b1) + 0x85ebca6b) >>> 0;
}

function slotOffset(slot) {
  return HEADER_INTS + slot * SLOT_INTS;
}

function publicConfig(config) {
  return {
    mode: config.mode,
    seed: config.seed,
    frames: config.frames,
    warmupFrames: config.warmupFrames,
    pagesPerFrame: config.pagesPerFrame,
    pageSize: config.pageSize,
    uploadPagesPerFrame: config.uploadPagesPerFrame,
    frameIntervalMs: config.frameIntervalMs,
    staleAfterFrames: config.staleAfterFrames,
    workingSetPages: config.workingSetPages,
    workerQueueLimit: config.workerQueueLimit,
    transferPoolSize: config.transferPoolSize,
    transferMaxBuffers: config.transferMaxBuffers,
    sabRingSlots: config.sabRingSlots,
    drainFrames: config.drainFrames,
  };
}

function workerConfig(config) {
  return publicConfig(config);
}

function readConfig(args) {
  const config = {
    mode: stringArg(args.mode, DEFAULTS.mode),
    seed: integerArg(args.seed, DEFAULTS.seed),
    frames: integerArg(args.frames, DEFAULTS.frames),
    warmupFrames: integerArg(args.warmup, DEFAULTS.warmupFrames),
    pagesPerFrame: integerArg(args.pagesFrame, DEFAULTS.pagesPerFrame),
    pageSize: integerArg(args.pageSize, DEFAULTS.pageSize),
    uploadPagesPerFrame: integerArg(args.uploadPages, DEFAULTS.uploadPagesPerFrame),
    frameIntervalMs: numberArg(args.frameIntervalMs, DEFAULTS.frameIntervalMs),
    staleAfterFrames: integerArg(args.staleAfterFrames, DEFAULTS.staleAfterFrames),
    workingSetPages: integerArg(args.workingSet, DEFAULTS.workingSetPages),
    workerQueueLimit: integerArg(args.workerQueue, DEFAULTS.workerQueueLimit),
    transferPoolSize: integerArg(args.poolSize, DEFAULTS.transferPoolSize),
    transferMaxBuffers: integerArg(args.maxBuffers, DEFAULTS.transferMaxBuffers),
    sabRingSlots: integerArg(args.ringSlots, DEFAULTS.sabRingSlots),
    drainFrames: integerArg(args.drainFrames, DEFAULTS.drainFrames),
  };

  if (!["transfer", "sab", "both"].includes(config.mode)) {
    throw new Error(`Unsupported --mode ${config.mode}; expected transfer, sab, or both.`);
  }
  if (config.pageSize < 4096) throw new Error("--page-size must be at least 4096 bytes.");
  if (config.transferMaxBuffers < config.transferPoolSize) {
    throw new Error("--max-buffers must be >= --pool-size.");
  }
  if (config.sabRingSlots < 2) throw new Error("--ring-slots must be at least 2.");
  return config;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === "--help" || raw === "-h") {
      args.help = true;
      continue;
    }
    if (raw === "--check") {
      args.check = true;
      continue;
    }
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument: ${raw}`);
    const eq = raw.indexOf("=");
    const key = camelCase(raw.slice(2, eq === -1 ? undefined : eq));
    if (eq !== -1) {
      args[key] = raw.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    }
  }
  return args;
}

function stringArg(value, fallback) {
  return value === undefined || value === true ? fallback : String(value);
}

function integerArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) throw new Error(`Expected integer, received ${value}`);
  return parsed;
}

function numberArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) throw new Error(`Expected number, received ${value}`);
  return parsed;
}

function camelCase(flag) {
  return flag.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 0 : round(numerator / denominator, 4);
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node research/virtual-texturing/vt-worker-transport-prototype.mjs [options]

Options:
  --mode transfer|sab|both       Transport to run (default: both)
  --check                        Enable conservative pass/fail thresholds
  --frames N                     Demand frames (default: ${DEFAULTS.frames})
  --pages-frame N                Page requests per frame (default: ${DEFAULTS.pagesPerFrame})
  --page-size N                  Bytes per VT page payload (default: ${DEFAULTS.pageSize})
  --upload-pages N               Main-thread upload drain budget per frame (default: ${DEFAULTS.uploadPagesPerFrame})
  --pool-size N                  Transfer ArrayBuffer pool size (default: ${DEFAULTS.transferPoolSize})
  --max-buffers N                Transfer pool allocation ceiling (default: ${DEFAULTS.transferMaxBuffers})
  --ring-slots N                 SAB ring slots (default: ${DEFAULTS.sabRingSlots})
  --stale-after-frames N         Drop superseded/late pages after this age (default: ${DEFAULTS.staleAfterFrames})

The Node worker_threads transport mirrors browser Worker postMessage transfer
lists and SharedArrayBuffer/Atomics where practical; WebGL upload is simulated
by the main thread consuming page bytes under a per-frame budget.`);
}
