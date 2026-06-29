import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const host = '127.0.0.1';
const previewPort = Number(process.env.VT_SMOOTHNESS_PORT ?? 4583);
const debugPort = Number(process.env.VT_SMOOTHNESS_DEBUG_PORT ?? 4584);
const chromiumBin = process.env.CHROMIUM_BIN ?? 'chromium';
const baseUrl = `http://${host}:${previewPort}`;
const routeUrl = `${baseUrl}/virtual-texturing-terrain`;

const parseArgs = (argv) => {
  const args = {
    gate: process.env.VT_SMOOTHNESS_GATE,
    help: false,
  };

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--smoke') {
      args.gate = 'smoke';
    } else if (arg === '--perf' || arg === '--default-on') {
      args.gate = 'default-on';
    } else if (arg.startsWith('--gate=')) {
      args.gate = arg.slice('--gate='.length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
};

const normalizeGate = (rawGate) => {
  const envSmoke = process.env.VT_SMOOTHNESS_SMOKE;
  if ((rawGate === undefined || rawGate === '') && envSmoke === '1') return 'smoke';
  if ((rawGate === undefined || rawGate === '') && envSmoke === '0') return 'default-on';

  switch (rawGate ?? 'smoke') {
    case 'ci':
    case 'loose':
    case 'permissive':
    case 'smoke':
      return 'smoke';
    case 'default':
    case 'default-on':
    case 'perf':
    case 'performance':
    case 'strict':
      return 'default-on';
    default:
      throw new Error(`VT_SMOOTHNESS_GATE must be smoke or default-on, received ${JSON.stringify(rawGate)}`);
  }
};

const args = parseArgs(process.argv.slice(2));
const gate = normalizeGate(args.gate);
const smokeMode = gate === 'smoke';
const defaultOnMode = gate === 'default-on';
const allowMissingProbe = smokeMode || process.env.VT_SMOOTHNESS_ALLOW_MISSING_PROBE === '1';
const envNumber = (name, fallback) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (Number.isFinite(value)) return value;
  throw new Error(`${name} must be a finite number, received ${JSON.stringify(raw)}`);
};

const benchmarkConfig = {
  durationMs: envNumber('VT_SMOOTHNESS_DURATION_MS', smokeMode ? 3500 : 7000),
  gate,
  inputCorrelationWindowMs: envNumber('VT_SMOOTHNESS_INPUT_CORRELATION_WINDOW_MS', 240),
  longFrameMs: envNumber('VT_SMOOTHNESS_LONG_FRAME_MS', smokeMode ? 50 : 50),
  maxAtlasUploadsPerChunk: envNumber('VT_SMOOTHNESS_MAX_ATLAS_UPLOADS_PER_CHUNK', smokeMode ? 64 : 8),
  maxFullTableRebuildExcess: envNumber('VT_SMOOTHNESS_MAX_FULL_TABLE_REBUILD_EXCESS', smokeMode ? 1_000_000 : 0),
  maxFirstUsableProbeReadyMs: envNumber('VT_SMOOTHNESS_MAX_FIRST_USABLE_PROBE_READY_MS', smokeMode ? 12_000 : 6_500),
  maxInputRafDeltaMs: envNumber('VT_SMOOTHNESS_MAX_INPUT_RAF_DELTA_MS', smokeMode ? 900 : 120),
  maxInputRafP95Ms: envNumber('VT_SMOOTHNESS_INPUT_RAF_P95_MS', smokeMode ? 180 : 24),
  maxLongFrameRatio: envNumber('VT_SMOOTHNESS_MAX_LONG_FRAME_RATIO', smokeMode ? 0.45 : 0.02),
  maxNavToCanvasMs: envNumber('VT_SMOOTHNESS_MAX_NAV_TO_CANVAS_MS', smokeMode ? 12_000 : 4_500),
  maxNavToProbeReadyMs: envNumber('VT_SMOOTHNESS_MAX_NAV_TO_PROBE_READY_MS', smokeMode ? 12_000 : 6_000),
  maxOldestQueuedWorkFrames: envNumber('VT_SMOOTHNESS_MAX_OLDEST_QUEUED_WORK_FRAMES', smokeMode ? 1_000 : 45),
  maxPageTableUploadsPerChunk: envNumber('VT_SMOOTHNESS_MAX_PAGE_TABLE_UPLOADS_PER_CHUNK', smokeMode ? 512 : 128),
  maxPhaseSettleMs: envNumber('VT_SMOOTHNESS_MAX_PHASE_SETTLE_MS', smokeMode ? 5_000 : 1_400),
  maxProbeFinalPendingPages: envNumber('VT_SMOOTHNESS_MAX_PROBE_FINAL_PENDING_PAGES', smokeMode ? 96 : 0),
  maxProbeFrameMs: envNumber('VT_SMOOTHNESS_MAX_PROBE_FRAME_MS', smokeMode ? 900 : 66),
  maxProbePageGenerationMs: envNumber('VT_SMOOTHNESS_MAX_PROBE_PAGE_GENERATION_MS', smokeMode ? 1500 : 50),
  maxProbePendingPages: envNumber('VT_SMOOTHNESS_MAX_PROBE_PENDING_PAGES', smokeMode ? 96 : 16),
  maxProbePlanMs: envNumber('VT_SMOOTHNESS_MAX_PROBE_PLAN_MS', smokeMode ? 500 : 8),
  maxProbeReadbacksDuringInput: envNumber('VT_SMOOTHNESS_MAX_PROBE_READBACKS_DURING_INPUT', 0),
  maxProbeSchedulerDelayMs: envNumber('VT_SMOOTHNESS_MAX_PROBE_SCHEDULER_DELAY_MS', smokeMode ? 1500 : 120),
  maxProbeSlowFrames: envNumber('VT_SMOOTHNESS_MAX_PROBE_SLOW_FRAMES', smokeMode ? 160 : 8),
  maxProbeTextureUploadMs: envNumber('VT_SMOOTHNESS_MAX_PROBE_TEXTURE_UPLOAD_MS', smokeMode ? 50 : 2),
  maxProbeWorkChunkMs: envNumber('VT_SMOOTHNESS_MAX_PROBE_WORK_CHUNK_MS', smokeMode ? 500 : 12),
  maxRafDeltaMs: envNumber('VT_SMOOTHNESS_MAX_RAF_DELTA_MS', smokeMode ? 900 : 120),
  maxRecentEvictionReRequestRatio: envNumber('VT_SMOOTHNESS_MAX_RECENT_EVICTION_RE_REQUEST_RATIO', smokeMode ? 1_000_000 : 0.03),
  maxRepeatedReloadRatio: envNumber('VT_SMOOTHNESS_MAX_REPEATED_RELOAD_RATIO', smokeMode ? 1_000_000 : 0.02),
  maxUnsettledPhases: envNumber('VT_SMOOTHNESS_MAX_UNSETTLED_PHASES', smokeMode ? 99 : 0),
  maxWorkerInFlightBytes: envNumber('VT_SMOOTHNESS_MAX_WORKER_IN_FLIGHT_BYTES', smokeMode ? 64 * 1024 * 1024 : 4 * 1024 * 1024),
  maxWorkerLatencyMs: envNumber('VT_SMOOTHNESS_MAX_WORKER_LATENCY_MS', smokeMode ? 1500 : 250),
  maxWorkerQueueDepth: envNumber('VT_SMOOTHNESS_MAX_WORKER_QUEUE_DEPTH', smokeMode ? 96 : 16),
  minExactHitRatio: envNumber('VT_SMOOTHNESS_MIN_EXACT_HIT_RATIO', smokeMode ? 0 : 0.95),
  minRafSamples: envNumber('VT_SMOOTHNESS_MIN_RAF_SAMPLES', smokeMode ? 60 : 180),
  probeP95Ms: envNumber('VT_SMOOTHNESS_PROBE_P95_MS', smokeMode ? 220 : 20),
  rafP95Ms: envNumber('VT_SMOOTHNESS_RAF_P95_MS', smokeMode ? 160 : 20),
  rafP99Ms: envNumber('VT_SMOOTHNESS_RAF_P99_MS', smokeMode ? 320 : 33),
  readyTimeoutMs: envNumber('VT_SMOOTHNESS_READY_TIMEOUT_MS', 12000),
  requireDefaultOnMetrics: defaultOnMode,
  requireProbe: !allowMissingProbe,
  requireProbePerformance: !allowMissingProbe,
  smokeMode,
  pointerStepDelayMs: envNumber('VT_SMOOTHNESS_POINTER_STEP_DELAY_MS', smokeMode ? 55 : 45),
  settlePendingPagesThreshold: envNumber('VT_SMOOTHNESS_SETTLE_PENDING_PAGES_THRESHOLD', smokeMode ? 96 : 0),
  settleStableSamples: envNumber('VT_SMOOTHNESS_SETTLE_STABLE_SAMPLES', smokeMode ? 2 : 4),
  settleStableWindowMs: envNumber('VT_SMOOTHNESS_SETTLE_STABLE_WINDOW_MS', smokeMode ? 180 : 350),
  warmupMs: envNumber('VT_SMOOTHNESS_WARMUP_MS', smokeMode ? 750 : 1500),
  wheelBurstDelayMs: envNumber('VT_SMOOTHNESS_WHEEL_BURST_DELAY_MS', smokeMode ? 120 : 90),
};

if (args.help) {
  console.log(`Usage: node scripts/virtual-texturing-smoothness.mjs [--gate=smoke|default-on] [--smoke] [--perf]

Gates:
  smoke       Permissive CI/browser portability gate. This is the default so bench:vt keeps working.
  default-on  Strict VT rollout gate. Alias: --perf.

Key overrides:
  VT_SMOOTHNESS_GATE=smoke|default-on
  VT_SMOOTHNESS_MIN_EXACT_HIT_RATIO=0.95
  VT_SMOOTHNESS_MAX_REPEATED_RELOAD_RATIO=0.02
  VT_SMOOTHNESS_MAX_RECENT_EVICTION_RE_REQUEST_RATIO=0.03
  VT_SMOOTHNESS_RAF_P95_MS=20
  VT_SMOOTHNESS_RAF_P99_MS=33
  VT_SMOOTHNESS_INPUT_RAF_P95_MS=24
  VT_SMOOTHNESS_MAX_INPUT_RAF_DELTA_MS=120
  VT_SMOOTHNESS_MAX_NAV_TO_CANVAS_MS=4500
  VT_SMOOTHNESS_MAX_NAV_TO_PROBE_READY_MS=6000
  VT_SMOOTHNESS_MAX_FIRST_USABLE_PROBE_READY_MS=6500
  VT_SMOOTHNESS_MAX_PHASE_SETTLE_MS=1400
  VT_SMOOTHNESS_SETTLE_PENDING_PAGES_THRESHOLD=0
  VT_SMOOTHNESS_SETTLE_STABLE_WINDOW_MS=350
  VT_SMOOTHNESS_MAX_ATLAS_UPLOADS_PER_CHUNK=8
  VT_SMOOTHNESS_MAX_PAGE_TABLE_UPLOADS_PER_CHUNK=128
  VT_SMOOTHNESS_MAX_PROBE_PLAN_MS=8
  VT_SMOOTHNESS_MAX_PROBE_PAGE_GENERATION_MS=50
  VT_SMOOTHNESS_MAX_PROBE_WORK_CHUNK_MS=12
  VT_SMOOTHNESS_MAX_PROBE_SCHEDULER_DELAY_MS=120
  VT_SMOOTHNESS_MAX_WORKER_QUEUE_DEPTH=16
  VT_SMOOTHNESS_MAX_WORKER_IN_FLIGHT_BYTES=4194304
  VT_SMOOTHNESS_MAX_WORKER_LATENCY_MS=250
`);
  process.exit(0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const percentile = (values, ratio) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index] ?? 0;
};

const round = (value) => Number(value.toFixed(2));

const firstFiniteNumber = (source, names) => {
  if (source === undefined || source === null) return undefined;
  for (const name of names) {
    const value = source[name];
    if (Number.isFinite(value)) return value;
  }
  return undefined;
};

const countArray = (value) => Array.isArray(value) ? value.length : undefined;
const numberOrNull = (value) => Number.isFinite(value) ? round(value) : null;
const finiteOrNull = (value) => Number.isFinite(value) ? value : null;
const maxNullable = (...values) => {
  const finite = values.filter((value) => Number.isFinite(value));
  return finite.length === 0 ? null : Math.max(...finite);
};

const finiteSampleValues = (samples, read) => samples
  .map(read)
  .filter((value) => Number.isFinite(value));

const maxSampleValue = (samples, read) => {
  const values = finiteSampleValues(samples, read);
  return values.length === 0 ? undefined : round(Math.max(...values));
};

const summarizeProbePerformance = (finalPerformance, probeSamples) => {
  const samples = probeSamples ?? [];
  if (finalPerformance === undefined) {
    return {
      available: false,
      frameTimeP95Ms: null,
      maxAllocationMs: null,
      maxInFlightBytes: null,
      maxAdvanceMs: null,
      maxAtlasUploadCount: null,
      maxFillMs: null,
      maxFrameMs: null,
      maxOldestQueuedWorkFrames: null,
      maxPageGenerationMs: null,
      maxPageTableUploadMs: null,
      maxPageTableUploadCount: null,
      maxPlanMs: null,
      maxReadbackMs: null,
      maxResolvedBasePages: null,
      maxQueueDepth: null,
      maxSchedulerDelayMs: null,
      maxSampledPendingPages: null,
      maxTextureUploadMs: null,
      maxWorkChunkMs: null,
      maxWorkerGenerationLatencyMs: null,
      pendingPages: null,
      pendingReadbacks: null,
      queueDepth: null,
      slowFrameBudgetMs: null,
      slowFrameCount: null,
      staleDrops: null,
      staleAtlasUploadDrops: null,
      stalePageTableUploadDrops: null,
      staleQueuedDrops: null,
      workerAvailable: false,
      workerCount: null,
      workerFallbackPages: null,
      workerGeneratedPages: null,
      workerLastError: '',
    };
  }

  const maxSampledPendingPages = maxSampleValue(
    samples,
    (sample) => sample.performance?.pendingPages,
  );
  const maxSampledInFlightBytes = maxSampleValue(
    samples,
    (sample) => sample.performance?.inFlightBytes,
  );
  const maxSampledOldestQueuedWorkFrames = maxSampleValue(
    samples,
    (sample) => sample.performance?.oldestQueuedWorkFrames,
  );
  const maxSampledQueueDepth = maxSampleValue(
    samples,
    (sample) => sample.performance?.queueDepth,
  );
  const maxSampledWorkerLatencyMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.maxWorkerGenerationLatencyMs,
  );
  const maxSampledAllocationMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastAllocationMs,
  );
  const maxSampledAtlasUploadCount = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastAtlasUploadCount,
  );
  const maxSampledFillMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastFillMs,
  );
  const maxSampledPageGenerationMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastPageGenerationMs,
  );
  const maxSampledPageTableUploadCount = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastPageTableUploadCount,
  );
  const maxSampledPageTableUploadMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastPageTableUploadMs,
  );
  const maxSampledPlanMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastPlanMs,
  );
  const maxSampledReadbackMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastReadbackMs,
  );
  const maxSampledResolvedBasePages = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastResolvedBasePages,
  );
  const maxSampledSchedulerDelayMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastSchedulerDelayMs,
  );
  const maxSampledTextureUploadMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastTextureUploadMs,
  );
  const maxSampledWorkChunkMs = maxSampleValue(
    samples,
    (sample) => sample.performance?.lastWorkChunkMs,
  );

  return {
    available: true,
    frameTimeP95Ms: numberOrNull(finalPerformance.frameTimeP95Ms),
    maxAllocationMs: maxNullable(finalPerformance.maxAllocationMs, maxSampledAllocationMs),
    maxInFlightBytes: maxNullable(finalPerformance.inFlightBytes, maxSampledInFlightBytes),
    maxAdvanceMs: numberOrNull(finalPerformance.maxAdvanceMs),
    maxAtlasUploadCount: maxNullable(finalPerformance.lastAtlasUploadCount, maxSampledAtlasUploadCount),
    maxFillMs: maxNullable(finalPerformance.maxFillMs, maxSampledFillMs),
    maxFrameMs: numberOrNull(finalPerformance.maxFrameMs),
    maxOldestQueuedWorkFrames: maxNullable(
      finalPerformance.oldestQueuedWorkFrames,
      maxSampledOldestQueuedWorkFrames,
    ),
    maxPageGenerationMs: maxNullable(finalPerformance.maxPageGenerationMs, maxSampledPageGenerationMs),
    maxPageTableUploadMs: maxNullable(finalPerformance.maxPageTableUploadMs, maxSampledPageTableUploadMs),
    maxPageTableUploadCount: maxNullable(
      finalPerformance.lastPageTableUploadCount,
      maxSampledPageTableUploadCount,
    ),
    maxPlanMs: maxNullable(finalPerformance.maxPlanMs, maxSampledPlanMs),
    maxReadbackMs: maxNullable(finalPerformance.maxReadbackMs, maxSampledReadbackMs),
    maxResolvedBasePages: maxNullable(finalPerformance.lastResolvedBasePages, maxSampledResolvedBasePages),
    maxQueueDepth: maxNullable(finalPerformance.queueDepth, maxSampledQueueDepth),
    maxSchedulerDelayMs: maxNullable(finalPerformance.maxSchedulerDelayMs, maxSampledSchedulerDelayMs),
    maxSampledPendingPages: maxSampledPendingPages ?? null,
    maxTextureUploadMs: maxNullable(finalPerformance.maxTextureUploadMs, maxSampledTextureUploadMs),
    maxWorkChunkMs: maxNullable(finalPerformance.maxWorkChunkMs, maxSampledWorkChunkMs),
    maxWorkerGenerationLatencyMs: maxNullable(
      finalPerformance.maxWorkerGenerationLatencyMs,
      maxSampledWorkerLatencyMs,
    ),
    pendingPages: numberOrNull(finalPerformance.pendingPages),
    pendingReadbacks: numberOrNull(finalPerformance.pendingReadbacks),
    queueDepth: numberOrNull(finalPerformance.queueDepth),
    slowFrameBudgetMs: numberOrNull(finalPerformance.slowFrameBudgetMs),
    slowFrameCount: numberOrNull(finalPerformance.slowFrameCount),
    staleDrops: numberOrNull(finalPerformance.staleDrops),
    staleAtlasUploadDrops: numberOrNull(finalPerformance.staleAtlasUploadDrops),
    stalePageTableUploadDrops: numberOrNull(finalPerformance.stalePageTableUploadDrops),
    staleQueuedDrops: numberOrNull(finalPerformance.staleQueuedDrops),
    workerAvailable: finalPerformance.workerAvailable === true,
    workerCount: numberOrNull(finalPerformance.workerCount),
    workerFallbackPages: numberOrNull(finalPerformance.workerFallbackPages),
    workerGeneratedPages: numberOrNull(finalPerformance.workerGeneratedPages),
    workerLastError: finalPerformance.workerLastError ?? '',
  };
};

const summarizeThrash = (finalProbe) => {
  const performance = finalProbe?.performance;
  const cacheEventCount = firstFiniteNumber(finalProbe, [
    'cacheThrashCount',
    'cacheChurnCount',
    'cacheEvictionCount',
    'evictionCount',
  ]) ?? firstFiniteNumber(performance, [
    'cacheThrashCount',
    'cacheChurnCount',
    'cacheEvictionCount',
    'evictionCount',
  ]);
  const cacheRatio = firstFiniteNumber(finalProbe, [
    'cacheThrashRatio',
    'cacheChurnRatio',
    'evictionRatio',
  ]) ?? firstFiniteNumber(performance, [
    'cacheThrashRatio',
    'cacheChurnRatio',
    'evictionRatio',
  ]);
  const uploadEventCount = firstFiniteNumber(finalProbe, [
    'uploadThrashCount',
    'uploadChurnCount',
    'redundantUploadCount',
  ]) ?? firstFiniteNumber(performance, [
    'uploadThrashCount',
    'uploadChurnCount',
    'redundantUploadCount',
  ]);
  const uploadRatio = firstFiniteNumber(finalProbe, [
    'uploadThrashRatio',
    'uploadChurnRatio',
    'redundantUploadRatio',
  ]) ?? firstFiniteNumber(performance, [
    'uploadThrashRatio',
    'uploadChurnRatio',
    'redundantUploadRatio',
  ]);
  const evictedPages = countArray(finalProbe?.evictedPageIds);

  return {
    cache: {
      available: cacheEventCount !== undefined || cacheRatio !== undefined,
      eventCount: cacheEventCount ?? null,
      evictedPages: evictedPages ?? null,
      ratio: cacheRatio ?? null,
    },
    upload: {
      available: uploadEventCount !== undefined || uploadRatio !== undefined,
      bytesUploaded: firstFiniteNumber(finalProbe, ['bytesUploaded']) ?? null,
      eventCount: uploadEventCount ?? null,
      maxPageGenerationMs: numberOrNull(performance?.maxPageGenerationMs),
      maxPageTableUploadMs: numberOrNull(performance?.maxPageTableUploadMs),
      maxTextureUploadMs: numberOrNull(performance?.maxTextureUploadMs),
      pageTableTexelUploads: firstFiniteNumber(finalProbe, ['pageTableTexelUploads']) ?? null,
      physicalAtlasUploads: firstFiniteNumber(finalProbe, ['physicalAtlasUploads']) ?? null,
      ratio: uploadRatio ?? null,
    },
  };
};

const summarizeQualityGates = (finalProbe) => {
  const performance = finalProbe?.performance;
  const exactHitRatio = firstFiniteNumber(finalProbe, [
    'exactHitRatio',
    'exactPageHitRatio',
    'pageHitExactRatio',
    'pageHitsExactRatio',
    'vtExactHitRatio',
  ]) ?? firstFiniteNumber(performance, [
    'exactHitRatio',
    'exactPageHitRatio',
    'pageHitExactRatio',
    'pageHitsExactRatio',
    'vtExactHitRatio',
  ]);
  const repeatedReloadRatio = firstFiniteNumber(finalProbe, [
    'repeatedPageReloadRatio',
    'repeatedReloadRatio',
    'reloadRatio',
    'cacheRepeatedReloadRatio',
  ]) ?? firstFiniteNumber(performance, [
    'repeatedPageReloadRatio',
    'repeatedReloadRatio',
    'reloadRatio',
    'cacheRepeatedReloadRatio',
  ]);
  const recentEvictionReRequestRatio = firstFiniteNumber(finalProbe, [
    'recentEvictionReRequestRatio',
    'recentEvictionRerequestRatio',
    'visibleRecentEvictionReRequestRatio',
    'evictedPageReRequestRatio',
    'cacheThrashRatio',
    'cacheChurnRatio',
  ]) ?? firstFiniteNumber(performance, [
    'recentEvictionReRequestRatio',
    'recentEvictionRerequestRatio',
    'visibleRecentEvictionReRequestRatio',
    'evictedPageReRequestRatio',
    'cacheThrashRatio',
    'cacheChurnRatio',
  ]);
  const fullRebuildsAfterInit = firstFiniteNumber(finalProbe, [
    'pageTableFullRebuildsAfterInit',
    'fullPageTableRebuildsAfterInit',
    'pageTableRebuildsAfterInit',
  ]) ?? firstFiniteNumber(performance, [
    'pageTableFullRebuildsAfterInit',
    'fullPageTableRebuildsAfterInit',
    'pageTableRebuildsAfterInit',
  ]);
  const totalFullRebuilds = firstFiniteNumber(finalProbe, [
    'pageTableFullRebuilds',
    'fullPageTableRebuilds',
    'pageTableRebuilds',
  ]) ?? firstFiniteNumber(performance, [
    'pageTableFullRebuilds',
    'fullPageTableRebuilds',
    'pageTableRebuilds',
  ]);
  const contextRestores = firstFiniteNumber(finalProbe, [
    'contextRestoreCount',
    'webglContextRestoreCount',
  ]) ?? firstFiniteNumber(performance, [
    'contextRestoreCount',
    'webglContextRestoreCount',
  ]) ?? 0;
  const pageTableExactRatio = Number.isFinite(finalProbe?.exactPageCount) &&
    Number.isFinite(finalProbe?.fallbackPageCount) &&
    finalProbe.exactPageCount + finalProbe.fallbackPageCount > 0
    ? round(finalProbe.exactPageCount / (finalProbe.exactPageCount + finalProbe.fallbackPageCount))
    : null;
  const fullTableRebuildExcess = Number.isFinite(fullRebuildsAfterInit)
    ? fullRebuildsAfterInit
    : Number.isFinite(totalFullRebuilds)
      ? Math.max(0, totalFullRebuilds - 1 - contextRestores)
      : null;

  return {
    exactHitRatio: finiteOrNull(exactHitRatio),
    fullTableRebuildExcess: finiteOrNull(fullTableRebuildExcess),
    pageTableExactRatio,
    recentEvictionReRequestRatio: finiteOrNull(recentEvictionReRequestRatio),
    repeatedReloadRatio: finiteOrNull(repeatedReloadRatio),
  };
};

const sampleNearInput = (timeMs, inputTimes) =>
  Number.isFinite(timeMs) &&
  inputTimes.some((inputTime) => timeMs >= inputTime && timeMs - inputTime <= benchmarkConfig.inputCorrelationWindowMs);

const maxInteractionSampleValue = (samples, read) => {
  const values = finiteSampleValues(samples, read);
  return values.length === 0 ? null : round(Math.max(...values));
};

const summarizeColdLoad = (result) => {
  const coldLoad = result.coldLoad ?? {};

  return {
    firstUsableProbeReadyMs: numberOrNull(coldLoad.firstUsableProbeReadyMs),
    loadEventEndMs: numberOrNull(coldLoad.loadEventEndMs),
    navigationToCanvasMs: numberOrNull(coldLoad.canvasFoundMs),
    navigationToProbePresentMs: numberOrNull(coldLoad.probePresentMs),
    navigationToProbeReadyMs: numberOrNull(coldLoad.probeReadyMs),
    source: coldLoad.source ?? 'unknown',
  };
};

const phaseSampleRequestKey = (sample) => {
  const detail = sample?.detail ?? {};
  const signature = typeof detail.requestSignature === 'string' ? detail.requestSignature : '';
  if (signature === '') return '';
  const mip = Number.isFinite(detail.requestedMip) ? detail.requestedMip : 'unknown';
  return `${mip}:${signature}`;
};

const derivedPhaseSummary = (phase, sample, stableSamples, stableWindowMs, settled) => ({
  available: sample !== undefined,
  endMs: phase.endMs,
  label: phase.label,
  observedAtMs: sample?.timeMs,
  pendingPages: sample?.performance?.pendingPages,
  requestKey: sample === undefined ? null : phaseSampleRequestKey(sample),
  requestedMip: sample?.detail?.requestedMip,
  sampleCount: phase.sampleCount,
  settled,
  settleTimeMs: settled && Number.isFinite(sample?.timeMs) && Number.isFinite(phase.endMs)
    ? sample.timeMs - phase.endMs
    : undefined,
  stableSamples,
  stableWindowMs,
  startMs: phase.startMs,
});

const derivePhaseSettles = (result) => {
  const phaseRuns = result.phaseRuns ?? [];
  const probeSamples = result.probeSamples ?? [];

  return phaseRuns.map((phase, index) => {
    const nextStartMs = phaseRuns[index + 1]?.startMs ?? Infinity;
    const samples = probeSamples.filter((sample) =>
      Number.isFinite(sample.timeMs) &&
      sample.timeMs >= phase.endMs &&
      sample.timeMs < nextStartMs
    );
    const summarizedPhase = { ...phase, sampleCount: samples.length };
    let stableWindowStartMs;
    let stableSamples = 0;
    let stableWindowMs = 0;
    let lastKey = '';

    for (const sample of samples) {
      const pendingPages = sample.performance?.pendingPages;
      const requestKey = phaseSampleRequestKey(sample);
      const ready = Number.isFinite(pendingPages) &&
        pendingPages <= benchmarkConfig.settlePendingPagesThreshold &&
        requestKey !== '' &&
        sample.camera?.interactionActive !== true;

      if (!ready) {
        stableWindowStartMs = undefined;
        stableSamples = 0;
        stableWindowMs = 0;
        lastKey = requestKey;
        continue;
      }

      if (requestKey !== lastKey || stableWindowStartMs === undefined) {
        stableWindowStartMs = sample.timeMs;
        stableSamples = 0;
        stableWindowMs = 0;
        lastKey = requestKey;
      }

      stableSamples += 1;
      stableWindowMs = sample.timeMs - stableWindowStartMs;
      if (
        stableSamples >= benchmarkConfig.settleStableSamples &&
        stableWindowMs >= benchmarkConfig.settleStableWindowMs
      ) {
        return derivedPhaseSummary(summarizedPhase, sample, stableSamples, stableWindowMs, true);
      }
    }

    const lastSample = samples[samples.length - 1];
    return derivedPhaseSummary(summarizedPhase, lastSample, stableSamples, stableWindowMs, false);
  });
};

const summarizeZoomSettle = (result) => {
  const rawPhases = Array.isArray(result.phaseSettles) && result.phaseSettles.length > 0
    ? result.phaseSettles
    : derivePhaseSettles(result);
  const phases = rawPhases.map((phase) => ({
    available: phase.available === true,
    inputDurationMs: numberOrNull(
      Number.isFinite(phase.endMs) && Number.isFinite(phase.startMs)
        ? phase.endMs - phase.startMs
        : undefined,
    ),
    label: phase.label,
    observedAtMs: numberOrNull(phase.observedAtMs),
    pendingPages: numberOrNull(phase.pendingPages),
    requestKey: phase.requestKey ?? null,
    requestedMip: Number.isFinite(phase.requestedMip) ? phase.requestedMip : null,
    sampleCount: phase.sampleCount ?? 0,
    settled: phase.settled === true,
    settleTimeMs: numberOrNull(phase.settleTimeMs),
    stableSamples: phase.stableSamples ?? 0,
    stableWindowMs: numberOrNull(phase.stableWindowMs),
  }));
  const availablePhases = phases.filter((phase) => phase.available);
  const settledPhases = phases.filter((phase) => phase.settled);
  const settleTimes = settledPhases
    .map((phase) => phase.settleTimeMs)
    .filter((value) => Number.isFinite(value));

  return {
    availablePhases: availablePhases.length,
    maxSettleTimeMs: settleTimes.length === 0 ? null : round(Math.max(...settleTimes)),
    pendingPagesThreshold: benchmarkConfig.settlePendingPagesThreshold,
    phases,
    p95SettleTimeMs: settleTimes.length === 0 ? null : round(percentile(settleTimes, 0.95)),
    settledPhases: settledPhases.length,
    stableSamplesRequired: benchmarkConfig.settleStableSamples,
    stableWindowMsRequired: benchmarkConfig.settleStableWindowMs,
    totalPhases: phases.length,
    unsettledPhases: phases.filter((phase) => phase.available && !phase.settled).length,
  };
};

const summarizePhaseHitches = (result) => {
  const phaseRuns = result.phaseRuns ?? [];
  const rafSamples = result.rafSamples ?? [];
  const phases = phaseRuns.map((phase) => {
    const windowEndMs = phase.endMs + benchmarkConfig.inputCorrelationWindowMs;
    const samples = rafSamples.filter((sample) =>
      Number.isFinite(sample.timeMs) &&
      sample.timeMs >= phase.startMs &&
      sample.timeMs <= windowEndMs
    );
    const deltas = samples.map((sample) => sample.deltaMs).filter((value) => Number.isFinite(value));
    const slowFrames = deltas.filter((delta) => delta > benchmarkConfig.longFrameMs);

    return {
      inputDurationMs: numberOrNull(phase.endMs - phase.startMs),
      label: phase.label,
      longFrameRatio: deltas.length === 0 ? 0 : round(slowFrames.length / deltas.length),
      maxMs: deltas.length === 0 ? null : round(Math.max(...deltas)),
      p95Ms: deltas.length === 0 ? null : round(percentile(deltas, 0.95)),
      samples: deltas.length,
      slowFrames: slowFrames.length,
      windowEndMs: numberOrNull(windowEndMs),
    };
  });
  const maxValues = phases.map((phase) => phase.maxMs).filter((value) => Number.isFinite(value));
  const p95Values = phases.map((phase) => phase.p95Ms).filter((value) => Number.isFinite(value));
  const slowFrames = phases.reduce((total, phase) => total + phase.slowFrames, 0);
  const sampleCount = phases.reduce((total, phase) => total + phase.samples, 0);

  return {
    availablePhases: phases.filter((phase) => phase.samples > 0).length,
    inputCorrelationWindowMs: benchmarkConfig.inputCorrelationWindowMs,
    longFrameRatio: sampleCount === 0 ? 0 : round(slowFrames / sampleCount),
    phases,
    slowFrames,
    totalPhases: phases.length,
    worstMaxMs: maxValues.length === 0 ? null : round(Math.max(...maxValues)),
    worstP95Ms: p95Values.length === 0 ? null : round(Math.max(...p95Values)),
  };
};

const summarizeInteraction = (result) => {
  const pointerEvents = result.pointerEvents ?? [];
  const wheelEvents = result.wheelEvents ?? [];
  const inputTimes = [...pointerEvents, ...wheelEvents]
    .map((event) => event.timeMs)
    .filter((timeMs) => Number.isFinite(timeMs))
    .sort((a, b) => a - b);
  const rafSamples = result.rafSamples ?? [];
  const inputRafSamples = rafSamples.filter((sample) => sampleNearInput(sample.timeMs, inputTimes));
  const inputRafLongFrames = inputRafSamples.filter((sample) => sample.deltaMs > benchmarkConfig.longFrameMs);
  const probeSamples = result.probeSamples ?? [];
  const interactionProbeSamples = probeSamples.filter((sample) =>
    sample.camera?.interactionActive === true || sampleNearInput(sample.timeMs, inputTimes)
  );
  let readbackCountDuringInput = 0;
  let previousReadbackCount = probeSamples[0]?.performance?.readbackCount ?? 0;
  for (const sample of probeSamples) {
    const readbackCount = sample.performance?.readbackCount;
    if (
      Number.isFinite(readbackCount) &&
      readbackCount > previousReadbackCount &&
      (sample.camera?.interactionActive === true || sampleNearInput(sample.timeMs, inputTimes))
    ) {
      readbackCountDuringInput += readbackCount - previousReadbackCount;
    }
    if (Number.isFinite(readbackCount)) previousReadbackCount = readbackCount;
  }

  const initialCamera = result.initialProbe?.camera;
  const finalCamera = result.finalProbe?.camera;
  const distanceDelta = Number.isFinite(finalCamera?.distance) && Number.isFinite(initialCamera?.distance)
    ? round(finalCamera.distance - initialCamera.distance)
    : null;
  const yawDelta = Number.isFinite(finalCamera?.yaw) && Number.isFinite(initialCamera?.yaw)
    ? round(finalCamera.yaw - initialCamera.yaw)
    : null;
  const revisionDelta = Number.isFinite(finalCamera?.revision) && Number.isFinite(initialCamera?.revision)
    ? finalCamera.revision - initialCamera.revision
    : null;

  return {
    camera: {
      distanceDelta,
      final: finalCamera ?? null,
      initial: initialCamera ?? null,
      revisionDelta,
      yawDelta,
    },
    inputEvents: inputTimes.length,
    inputRaf: {
      longFrameRatio: inputRafSamples.length === 0 ? 0 : round(inputRafLongFrames.length / inputRafSamples.length),
      maxMs: round(Math.max(0, ...inputRafSamples.map((sample) => sample.deltaMs))),
      p95Ms: round(percentile(inputRafSamples.map((sample) => sample.deltaMs), 0.95)),
      samples: inputRafSamples.length,
      slowFrames: inputRafLongFrames.length,
    },
    probe: {
      interactionSamples: interactionProbeSamples.length,
      maxAdvanceMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastAdvanceMs),
      maxAtlasUploadCount: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastAtlasUploadCount),
      maxInFlightBytes: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.inFlightBytes),
      maxObservedAdvanceMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.maxAdvanceMs),
      maxOldestQueuedWorkFrames: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.oldestQueuedWorkFrames),
      maxPageGenerationMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastPageGenerationMs),
      maxPageTableUploadCount: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastPageTableUploadCount),
      maxPageTableUploadMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastPageTableUploadMs),
      maxPendingPages: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.pendingPages),
      maxPlanMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastPlanMs),
      maxQueueDepth: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.queueDepth),
      maxReadbackMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastReadbackMs),
      maxSchedulerDelayMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastSchedulerDelayMs),
      maxTextureUploadMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastTextureUploadMs),
      maxWorkChunkMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastWorkChunkMs),
      maxObservedWorkChunkMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.maxWorkChunkMs),
      maxWorkerGenerationLatencyMs: maxInteractionSampleValue(interactionProbeSamples, (sample) => sample.performance?.lastWorkerGenerationLatencyMs),
      readbacksDuringInput: readbackCountDuringInput,
    },
  };
};

const summarizeUploadBursts = (result, probePerformance) => ({
  available: probePerformance.available,
  cumulativeBytesUploaded: firstFiniteNumber(result.finalProbe, ['bytesUploaded']) ?? null,
  maxAllocationMs: numberOrNull(probePerformance.maxAllocationMs),
  maxAtlasUploadCount: numberOrNull(probePerformance.maxAtlasUploadCount),
  maxFillMs: numberOrNull(probePerformance.maxFillMs),
  maxPageGenerationMs: numberOrNull(probePerformance.maxPageGenerationMs),
  maxPageTableUploadCount: numberOrNull(probePerformance.maxPageTableUploadCount),
  maxPageTableUploadMs: numberOrNull(probePerformance.maxPageTableUploadMs),
  maxTextureUploadMs: numberOrNull(probePerformance.maxTextureUploadMs),
});

const summarizeDecomplection = ({
  coldLoad,
  finalDetail,
  interaction,
  phaseHitches,
  probePerformance,
  raf,
  uploadBursts,
  zoomSettle,
}) => {
  const missingProbeTodos = [
    'TODO probe cameraInput.handlerDurationMs: direct wheel/pointer handler self-time; current benchmark uses input-correlated rAF as the hitch-catching proxy.',
    'TODO probe uploadQueue.waitMsByPageOrPriority: queue age is exposed only as oldestQueuedWorkFrames, not per-page wait timing.',
    'TODO probe textureUpload.bytesPerChunk: cumulative bytesUploaded exists, but burst bytes are not exposed per upload chunk.',
    'TODO probe renderFrame.gpuMs: WebGL timer-query/GPU frame timing is not exposed; current render timing is rAF/probe CPU frame timing.',
  ];

  if (probePerformance.maxPlanMs === null) {
    missingProbeTodos.push('TODO probe pageRequestPlanning.lastPlanMs/maxPlanMs: required for separate request-planning timing.');
  }

  return {
    cameraInput: {
      directTimingAvailable: false,
      inputEvents: interaction.inputEvents,
      inputRafMaxMs: interaction.inputRaf.maxMs,
      inputRafP95Ms: interaction.inputRaf.p95Ms,
      phaseWorstMaxMs: phaseHitches.worstMaxMs,
      phaseWorstP95Ms: phaseHitches.worstP95Ms,
      proxy: 'input-correlated requestAnimationFrame deltas',
    },
    initialLoad: coldLoad,
    missingProbeTodos,
    pageRequestPlanning: {
      available: probePerformance.maxPlanMs !== null,
      interactionMaxPlanMs: interaction.probe.maxPlanMs,
      maxPlanMs: numberOrNull(probePerformance.maxPlanMs),
      requestedPages: Number.isFinite(finalDetail?.requestedPages) ? finalDetail.requestedPages : null,
    },
    renderFrame: {
      browserRafMaxMs: raf.maxMs,
      browserRafP95Ms: raf.p95Ms,
      browserRafP99Ms: raf.p99Ms,
      probeFrameMaxMs: probePerformance.maxFrameMs,
      probeFrameP95Ms: probePerformance.frameTimeP95Ms,
      probeSlowFrames: probePerformance.slowFrameCount,
    },
    uploadQueue: {
      maxAtlasUploadCount: uploadBursts.maxAtlasUploadCount,
      maxOldestQueuedWorkFrames: probePerformance.maxOldestQueuedWorkFrames,
      maxPageTableUploadCount: uploadBursts.maxPageTableUploadCount,
      maxPendingPages: maxNullable(probePerformance.pendingPages, probePerformance.maxSampledPendingPages),
      maxTextureUploadMs: uploadBursts.maxTextureUploadMs,
      pendingReadbacks: probePerformance.pendingReadbacks,
      staleAtlasUploadDrops: probePerformance.staleAtlasUploadDrops,
      stalePageTableUploadDrops: probePerformance.stalePageTableUploadDrops,
      staleQueuedDrops: probePerformance.staleQueuedDrops,
    },
    workerPageGeneration: {
      available: probePerformance.workerAvailable,
      maxInFlightBytes: probePerformance.maxInFlightBytes,
      maxPageGenerationMs: uploadBursts.maxPageGenerationMs,
      maxQueueDepth: probePerformance.maxQueueDepth,
      maxWorkerGenerationLatencyMs: probePerformance.maxWorkerGenerationLatencyMs,
      staleDrops: probePerformance.staleDrops,
      workerCount: probePerformance.workerCount,
      workerFallbackPages: probePerformance.workerFallbackPages,
      workerGeneratedPages: probePerformance.workerGeneratedPages,
      workerLastError: probePerformance.workerLastError,
    },
    zoomRotationSettle: zoomSettle,
  };
};

const recommendationsFor = (summary) => {
  const recommendations = [];
  const probe = summary.probePerformance;

  if (
    (summary.coldLoad.navigationToCanvasMs ?? 0) > benchmarkConfig.maxNavToCanvasMs ||
    (summary.coldLoad.navigationToProbeReadyMs ?? 0) > benchmarkConfig.maxNavToProbeReadyMs ||
    (summary.coldLoad.firstUsableProbeReadyMs ?? 0) > benchmarkConfig.maxFirstUsableProbeReadyMs
  ) {
    recommendations.push(
      'Cold load exceeded the navigation-to-canvas or probe-ready budget; inspect initial VT page generation, uploads, and preview readbacks.',
    );
  }

  if (
    (summary.zoomSettle.maxSettleTimeMs ?? 0) > benchmarkConfig.maxPhaseSettleMs ||
    summary.zoomSettle.unsettledPhases > benchmarkConfig.maxUnsettledPhases
  ) {
    recommendations.push(
      'Zoom/drag phases did not settle quickly; verify pending page drain and whether requested mip/page signatures churn after input ends.',
    );
  }

  if (
    summary.interaction.inputRaf.p95Ms > benchmarkConfig.maxInputRafP95Ms ||
    summary.interaction.inputRaf.maxMs > benchmarkConfig.maxInputRafDeltaMs
  ) {
    recommendations.push(
      'Input-correlated rAF hitches exceeded budget; inspect zoom/rotate handlers and VT scheduling around wheel and pointer events.',
    );
  }

  if (
    (summary.phaseHitches.worstP95Ms ?? 0) > benchmarkConfig.maxInputRafP95Ms ||
    (summary.phaseHitches.worstMaxMs ?? 0) > benchmarkConfig.maxInputRafDeltaMs
  ) {
    recommendations.push(
      'A specific zoom/rotate phase hitched; inspect phaseHitches for the label and compare it with planning, worker, and upload burst rows.',
    );
  }

  if (
    probe.available &&
    (
      (probe.maxPlanMs ?? 0) > benchmarkConfig.maxProbePlanMs ||
      (probe.maxSchedulerDelayMs ?? 0) > benchmarkConfig.maxProbeSchedulerDelayMs ||
      (probe.maxWorkChunkMs ?? 0) > benchmarkConfig.maxProbeWorkChunkMs
    )
  ) {
    recommendations.push(
      'VT planning or scheduler chunks exceeded budget; inspect maxPlanMs, maxSchedulerDelayMs, and maxWorkChunkMs before attributing the hitch to rendering.',
    );
  }

  if (
    probe.available &&
    (
      (probe.maxQueueDepth ?? 0) > benchmarkConfig.maxWorkerQueueDepth ||
      (probe.maxInFlightBytes ?? 0) > benchmarkConfig.maxWorkerInFlightBytes ||
      (probe.maxWorkerGenerationLatencyMs ?? 0) > benchmarkConfig.maxWorkerLatencyMs ||
      (probe.maxOldestQueuedWorkFrames ?? 0) > benchmarkConfig.maxOldestQueuedWorkFrames
    )
  ) {
    recommendations.push(
      'Worker-backed page generation showed queue saturation or stale work; inspect queueDepth, worker latency, and oldestQueuedWorkFrames.',
    );
  }

  if (
    summary.uploadBursts.available &&
    (
      (summary.uploadBursts.maxAtlasUploadCount ?? 0) > benchmarkConfig.maxAtlasUploadsPerChunk ||
      (summary.uploadBursts.maxPageTableUploadCount ?? 0) > benchmarkConfig.maxPageTableUploadsPerChunk ||
      (summary.uploadBursts.maxPageGenerationMs ?? 0) > benchmarkConfig.maxProbePageGenerationMs ||
      (summary.uploadBursts.maxTextureUploadMs ?? 0) > benchmarkConfig.maxProbeTextureUploadMs
    )
  ) {
    recommendations.push(
      'Texture upload or page-generation bursts exceeded budget; inspect uploadBursts and whether queue draining coincides with input phases.',
    );
  }

  if (
    summary.raf.p95Ms > benchmarkConfig.rafP95Ms ||
    summary.raf.p99Ms > benchmarkConfig.rafP99Ms ||
    summary.raf.maxMs > benchmarkConfig.maxRafDeltaMs
  ) {
    recommendations.push(
      'Profile zoom bursts for main-thread stalls; reduce per-frame page generation or upload batch size before relaxing rAF thresholds.',
    );
  }

  if (summary.raf.longFrameRatio > benchmarkConfig.maxLongFrameRatio) {
    recommendations.push(
      `Long frames exceed the ${benchmarkConfig.longFrameMs}ms budget too often; inspect sustained work rather than only single-frame spikes.`,
    );
  }

  if (summary.interaction.probe.readbacksDuringInput > 0) {
    recommendations.push(
      'Probe readbacks overlapped pointer or wheel input; defer readPixels until the camera interaction quiet window has elapsed.',
    );
  }

  if (
    probe.available &&
    (
      (probe.frameTimeP95Ms ?? 0) > benchmarkConfig.probeP95Ms ||
      (probe.maxFrameMs ?? 0) > benchmarkConfig.maxProbeFrameMs ||
      (probe.slowFrameCount ?? 0) > benchmarkConfig.maxProbeSlowFrames
    )
  ) {
    recommendations.push(
      'The VT probe reports slow render work; inspect performance.maxAdvanceMs, upload timings, and frameTimeP95Ms together.',
    );
  }

  if (probe.available && (maxNullable(probe.pendingPages, probe.maxSampledPendingPages) ?? 0) > benchmarkConfig.maxProbePendingPages) {
    recommendations.push(
      'Pending virtual texture pages stayed high; check request prioritization and whether page uploads drain after camera movement.',
    );
  }

  if (summary.thrash.cache.available || summary.thrash.upload.available) {
    recommendations.push(
      'Thrash counters are present; compare cache.eventCount/cache.ratio and upload.eventCount/upload.ratio across changes.',
    );
  }

  if (benchmarkConfig.requireDefaultOnMetrics && (
    summary.quality.exactHitRatio === null ||
    summary.quality.repeatedReloadRatio === null ||
    summary.quality.recentEvictionReRequestRatio === null ||
    summary.quality.fullTableRebuildExcess === null
  )) {
    recommendations.push(
      'Default-on gate requires exact-hit, repeated-reload, recent-eviction re-request, and full page-table rebuild counters on the probe.',
    );
  }

  if (!benchmarkConfig.smokeMode) {
    recommendations.push(
      'For smoke-only CI hosts, use VT_SMOOTHNESS_SMOKE=1 or override the specific VT_SMOOTHNESS_* budget that is host-bound.',
    );
  }

  if (benchmarkConfig.requireProbe) {
    recommendations.push(
      'This run requires window.__royalVirtualTextureProbe to exist, become ready, and expose performance; use VT_SMOOTHNESS_ALLOW_MISSING_PROBE=1 only for intentional loose compatibility runs.',
    );
  }

  return recommendations;
};

const waitForJson = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
};

const waitForHttp = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }

  throw lastError ?? new Error(`Timed out waiting for ${url}`);
};

class CdpSession {
  #nextId = 1;
  #pending = new Map();
  #handlers = new Map();

  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if (message.error === undefined) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error.message));
        }
        return;
      }

      for (const handler of this.#handlers.get(message.method) ?? []) {
        handler(message.params);
      }
    });
  }

  on(method, handler) {
    this.#handlers.set(method, [...(this.#handlers.get(method) ?? []), handler]);
  }

  once(method) {
    return new Promise((resolve) => {
      const handler = (params) => {
        this.#handlers.set(
          method,
          (this.#handlers.get(method) ?? []).filter((entry) => entry !== handler),
        );
        resolve(params);
      };
      this.on(method, handler);
    });
  }

  call(method, params = {}) {
    const id = this.#nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
  }

  close() {
    this.socket.close();
  }
}

const connectPage = async () => {
  await waitForJson(`http://${host}:${debugPort}/json/version`, 10_000);
  const pages = await waitForJson(`http://${host}:${debugPort}/json/list`, 10_000);
  const page = pages.find((entry) => entry.type === 'page');
  if (page?.webSocketDebuggerUrl === undefined) {
    throw new Error('Chromium did not expose a debuggable page target');
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  return new CdpSession(socket);
};

const evaluate = async (session, expression) => {
  const result = await session.call('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });

  if (result.exceptionDetails !== undefined) {
    throw new Error(result.exceptionDetails.text);
  }

  return result.result.value;
};

const spawnLogged = (command, args, options) => {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  return child;
};

const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), sleep(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await once(child, 'exit');
  }
};

const benchmarkExpression = `
(async () => {
  const config = ${JSON.stringify(benchmarkConfig)};
  const waitFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const readProbe = () => {
    const probe = window.__royalVirtualTextureProbe;
    if (probe === undefined) return undefined;
    return {
      bytesUploaded: probe.bytesUploaded,
      camera: probe.camera,
      cacheChurnCount: probe.cacheChurnCount,
      cacheChurnRatio: probe.cacheChurnRatio,
      cacheEvictionCount: probe.cacheEvictionCount,
      cacheThrashCount: probe.cacheThrashCount,
      cacheThrashRatio: probe.cacheThrashRatio,
      contextRestoreCount: probe.contextRestoreCount,
      detail: probe.detail,
      error: probe.error,
      evictionCount: probe.evictionCount,
      evictionRatio: probe.evictionRatio,
      evictedPageReRequestRatio: probe.evictedPageReRequestRatio,
      evictedPageIds: probe.evictedPageIds,
      exactHitRatio: probe.exactHitRatio,
      exactPageHitRatio: probe.exactPageHitRatio,
      frameCount: probe.frameCount,
      fullPageTableRebuilds: probe.fullPageTableRebuilds,
      fullPageTableRebuildsAfterInit: probe.fullPageTableRebuildsAfterInit,
      pageHitExactRatio: probe.pageHitExactRatio,
      pageTableTexelUploads: probe.pageTableTexelUploads,
      pageTableFullRebuilds: probe.pageTableFullRebuilds,
      pageTableFullRebuildsAfterInit: probe.pageTableFullRebuildsAfterInit,
      pageTableRebuilds: probe.pageTableRebuilds,
      pageTableRebuildsAfterInit: probe.pageTableRebuildsAfterInit,
      performance: probe.performance,
      physicalAtlasUploads: probe.physicalAtlasUploads,
      ready: probe.ready,
      recentEvictionRerequestRatio: probe.recentEvictionRerequestRatio,
      recentEvictionReRequestRatio: probe.recentEvictionReRequestRatio,
      reloadRatio: probe.reloadRatio,
      repeatedPageReloadRatio: probe.repeatedPageReloadRatio,
      repeatedReloadRatio: probe.repeatedReloadRatio,
      redundantUploadCount: probe.redundantUploadCount,
      redundantUploadRatio: probe.redundantUploadRatio,
      supported: probe.supported,
      uploadChurnCount: probe.uploadChurnCount,
      uploadChurnRatio: probe.uploadChurnRatio,
      uploadThrashCount: probe.uploadThrashCount,
      uploadThrashRatio: probe.uploadThrashRatio,
    };
  };
  const navigationEntry = performance.getEntriesByType('navigation')[0];
  const navigationStartMs = Number.isFinite(navigationEntry?.startTime) ? navigationEntry.startTime : 0;
  const finiteTiming = (value) => Number.isFinite(value) ? Number(value.toFixed(2)) : undefined;
  const coldLoad = {
    loadEventEndMs: finiteTiming(navigationEntry?.loadEventEnd),
    source: navigationEntry === undefined ? 'performance-now' : 'navigation-entry',
  };
  const markColdLoad = (key) => {
    if (coldLoad[key] === undefined) coldLoad[key] = finiteTiming(performance.now() - navigationStartMs);
  };
  const readyDeadline = performance.now() + config.readyTimeoutMs;
  let canvas = document.querySelector('canvas[aria-label="Virtual texturing terrain"]');
  let probe = readProbe();

  while (performance.now() < readyDeadline) {
    canvas = document.querySelector('canvas[aria-label="Virtual texturing terrain"]');
    probe = readProbe();
    if (canvas !== null) markColdLoad('canvasFoundMs');
    if (probe !== undefined) markColdLoad('probePresentMs');
    const looseReady = probe === undefined || probe.ready === true || probe.error !== '';
    const strictError = typeof probe?.error === 'string' && probe.error !== '';
    const strictReady = probe !== undefined && (probe.ready === true || strictError);
    if (strictReady || probe?.ready === true) markColdLoad('probeReadyMs');
    if (
      probe?.ready === true &&
      Number.isFinite(probe.performance?.pendingPages) &&
      probe.performance.pendingPages <= config.settlePendingPagesThreshold
    ) {
      markColdLoad('firstUsableProbeReadyMs');
    }
    if (canvas !== null && (config.requireProbe ? strictReady : looseReady)) break;
    await waitFrame();
  }

  if (canvas === null) {
    return {
      ok: false,
      coldLoad,
      setupError: 'Virtual texturing terrain canvas was not found',
      url: location.href,
    };
  }

  if (config.requireProbe && probe === undefined) {
    return {
      ok: false,
      canvas: {
        height: canvas.height,
        width: canvas.width,
      },
      coldLoad,
      finalProbe: probe,
      setupError: 'window.__royalVirtualTextureProbe was not found before the ready timeout',
      url: location.href,
    };
  }

  if (config.requireProbe && probe.ready !== true) {
    return {
      ok: false,
      canvas: {
        height: canvas.height,
        width: canvas.width,
      },
      coldLoad,
      finalProbe: probe,
      setupError: probe.error
        ? 'window.__royalVirtualTextureProbe reported an error before becoming ready'
        : 'window.__royalVirtualTextureProbe did not become ready before the ready timeout',
      url: location.href,
    };
  }

  canvas.focus();
  await wait(config.warmupMs);

  const initialProbe = readProbe();
  if (
    initialProbe?.ready === true &&
    Number.isFinite(initialProbe.performance?.pendingPages) &&
    initialProbe.performance.pendingPages <= config.settlePendingPagesThreshold
  ) {
    markColdLoad('firstUsableProbeReadyMs');
  }
  const rafDeltas = [];
  const rafSamples = [];
  const phaseRuns = [];
  const pointerEvents = [];
  const probeSamples = [];
  const wheelEvents = [];
  let lastFrame = 0;
  let running = true;

  const frameLoop = (now) => {
    if (lastFrame !== 0) {
      const deltaMs = Number((now - lastFrame).toFixed(2));
      rafDeltas.push(deltaMs);
      rafSamples.push({
        deltaMs,
        timeMs: Number(now.toFixed(2)),
      });
    }
    lastFrame = now;
    const nextProbe = readProbe();
    if (nextProbe?.performance !== undefined) {
      probeSamples.push({
        camera: nextProbe.camera,
        detail: nextProbe.detail,
        frameCount: nextProbe.frameCount,
        performance: nextProbe.performance,
        timeMs: Number(now.toFixed(2)),
      });
    }
    if (running) requestAnimationFrame(frameLoop);
  };

  const dispatchWheel = (deltaY) => {
    const rect = canvas.getBoundingClientRect();
    const event = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width * 0.5,
      clientY: rect.top + rect.height * 0.5,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL,
      deltaY,
    });
    canvas.dispatchEvent(event);
    wheelEvents.push({
      deltaY,
      prevented: event.defaultPrevented,
      timeMs: Number(performance.now().toFixed(2)),
    });
  };

  const dispatchPointer = (type, x, y, buttons) => {
    const event = new PointerEvent(type, {
      bubbles: true,
      button: 0,
      buttons,
      cancelable: true,
      clientX: x,
      clientY: y,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
    });
    canvas.dispatchEvent(event);
    pointerEvents.push({
      prevented: event.defaultPrevented,
      timeMs: Number(performance.now().toFixed(2)),
      type,
      x: Number(x.toFixed(1)),
      y: Number(y.toFixed(1)),
    });
  };

  const performDragZoomPhase = async (phase) => {
    const rect = canvas.getBoundingClientRect();
    const startX = rect.left + rect.width * phase.startX;
    const startY = rect.top + rect.height * phase.startY;
    const phaseStartMs = performance.now();
    dispatchPointer('pointerdown', startX, startY, 1);
    for (let step = 1; step <= phase.steps; step += 1) {
      if (performance.now() >= start + config.durationMs) break;
      const ratio = step / phase.steps;
      dispatchPointer('pointermove', startX + phase.dx * ratio, startY + phase.dy * ratio, 1);
      if (step % phase.wheelEvery === 0) dispatchWheel(phase.deltaY);
      await wait(config.pointerStepDelayMs);
    }
    dispatchPointer('pointerup', startX + phase.dx, startY + phase.dy, 0);
    return {
      endMs: Number(performance.now().toFixed(2)),
      label: phase.label,
      startMs: Number(phaseStartMs.toFixed(2)),
    };
  };

  requestAnimationFrame(frameLoop);

  const start = performance.now();
  const interactionPhases = [
    { at: 220, deltaY: -220, dx: 148, dy: -24, label: 'zoom-in rotate-right', startX: 0.42, startY: 0.55, steps: 10, wheelEvery: 2 },
    { at: 1320, deltaY: 220, dx: -132, dy: 28, label: 'zoom-out rotate-left', startX: 0.58, startY: 0.48, steps: 10, wheelEvery: 2 },
    { at: 2440, deltaY: -180, dx: 104, dy: 34, label: 'zoom-in rotate-right reprise', startX: 0.46, startY: 0.52, steps: 8, wheelEvery: 2 },
    { at: 4300, deltaY: 180, dx: -116, dy: -32, label: 'zoom-out rotate-left reprise', startX: 0.55, startY: 0.5, steps: 8, wheelEvery: 2 },
    { at: 5550, deltaY: -160, dx: 92, dy: 22, label: 'final zoom-in rotate', startX: 0.48, startY: 0.57, steps: 7, wheelEvery: 2 },
  ];

  for (const phase of interactionPhases) {
    if (performance.now() >= start + config.durationMs) break;
    const waitMs = start + phase.at - performance.now();
    if (waitMs > 0) await wait(waitMs);
    phaseRuns.push(await performDragZoomPhase(phase));
  }

  const remainingMs = start + config.durationMs - performance.now();
  if (remainingMs > 0) await wait(remainingMs);
  running = false;
  await waitFrame();

  const finalProbe = readProbe();
  return {
    ok: true,
    canvas: {
      height: canvas.height,
      width: canvas.width,
    },
    coldLoad,
    finalProbe,
    initialProbe,
    phaseRuns,
    pointerEvents,
    probeSamples,
    rafDeltas,
    rafSamples,
    url: location.href,
    wheelEvents,
  };
})()
`;

const summarize = (result) => {
  const rafDeltas = result.rafDeltas ?? [];
  const longFrames = rafDeltas.filter((delta) => delta > benchmarkConfig.longFrameMs);
  const probeSamples = result.probeSamples ?? [];
  const finalPerformance = result.finalProbe?.performance;
  const coldLoad = summarizeColdLoad(result);
  const interaction = summarizeInteraction(result);
  const phaseHitches = summarizePhaseHitches(result);
  const probePerformance = summarizeProbePerformance(finalPerformance, probeSamples);
  const thrash = summarizeThrash(result.finalProbe);
  const quality = summarizeQualityGates(result.finalProbe);
  const uploadBursts = summarizeUploadBursts(result, probePerformance);
  const zoomSettle = summarizeZoomSettle(result);
  const summarizedPerformance = finalPerformance === undefined
    ? undefined
    : {
        ...finalPerformance,
        frameTimeSampleCount: finalPerformance.frameTimeSamples?.length ?? 0,
        frameTimeSamples: undefined,
      };
  const raf = {
    longFrameRatio: rafDeltas.length === 0 ? 1 : round(longFrames.length / rafDeltas.length),
    maxMs: round(Math.max(0, ...rafDeltas)),
    minMs: rafDeltas.length === 0 ? 0 : round(Math.min(...rafDeltas)),
    p50Ms: round(percentile(rafDeltas, 0.5)),
    p95Ms: round(percentile(rafDeltas, 0.95)),
    p99Ms: round(percentile(rafDeltas, 0.99)),
    samples: rafDeltas.length,
    slowFrames: longFrames.length,
  };
  const decomplection = summarizeDecomplection({
    coldLoad,
    finalDetail: result.finalProbe?.detail,
    interaction,
    phaseHitches,
    probePerformance,
    raf,
    uploadBursts,
    zoomSettle,
  });

  const summary = {
    canvas: result.canvas,
    coldLoad,
    config: benchmarkConfig,
    decomplection,
    finalProbe: result.finalProbe === undefined
      ? undefined
      : {
          camera: result.finalProbe.camera,
          detail: result.finalProbe.detail,
          error: result.finalProbe.error,
          frameCount: result.finalProbe.frameCount,
          performance: summarizedPerformance,
          ready: result.finalProbe.ready,
          supported: result.finalProbe.supported,
    },
    interaction,
    phaseHitches,
    pointerEvents: result.pointerEvents?.length ?? 0,
    probePerformance,
    probeSamples: probeSamples.length,
    quality,
    raf,
    setup: {
      error: result.setupError ?? null,
      ok: result.ok === true,
      probePerformancePresent: result.finalProbe?.performance !== undefined,
      probePresent: result.finalProbe !== undefined,
      probeReady: result.finalProbe?.ready === true,
    },
    thrash,
    uploadBursts,
    url: result.url,
    wheelEvents: result.wheelEvents?.length ?? 0,
    zoomSettle,
  };

  summary.recommendations = recommendationsFor(summary);
  return summary;
};

const assertSmooth = (result, exceptions) => {
  const summary = summarize(result);
  const failures = [];
  const coldLoad = summary.coldLoad;
  const phaseHitches = summary.phaseHitches;
  const performance = summary.probePerformance;
  const quality = summary.quality;
  const uploadBursts = summary.uploadBursts;
  const zoomSettle = summary.zoomSettle;
  const failIfExceeds = (label, value, maxValue) => {
    if (Number.isFinite(value) && value > maxValue) failures.push(`${label} ${value} > ${maxValue}`);
  };

  if (result.ok !== true) {
    failures.push(result.setupError ?? 'Virtual texturing smoothness probe failed to start');
  }
  if (exceptions.length > 0) failures.push(`browser runtime exceptions: ${exceptions.join('; ')}`);
  if (benchmarkConfig.requireProbe && !summary.setup.probePresent) {
    failures.push('window.__royalVirtualTextureProbe was not found');
  }
  if (benchmarkConfig.requireProbe && summary.setup.probePresent && !summary.setup.probeReady) {
    failures.push('window.__royalVirtualTextureProbe did not become ready');
  }
  if (benchmarkConfig.requireProbePerformance && !summary.setup.probePerformancePresent) {
    failures.push('window.__royalVirtualTextureProbe.performance was not found');
  }
  if (summary.finalProbe?.error) failures.push(`virtual texture probe error: ${summary.finalProbe.error}`);
  if (summary.finalProbe?.supported === false) failures.push('virtual texturing reported unsupported WebGL2');
  if (summary.pointerEvents === 0) failures.push('benchmark did not dispatch pointer drag events');
  if (summary.wheelEvents === 0) failures.push('benchmark did not dispatch zoom wheel events');
  if ((Math.abs(summary.interaction.camera.yawDelta ?? 0) < 0.05)) {
    failures.push('benchmark did not rotate the camera enough to exercise drag interaction');
  }
  if ((Math.abs(summary.interaction.camera.distanceDelta ?? 0) < 0.05)) {
    failures.push('benchmark did not zoom the camera enough to exercise wheel interaction');
  }
  failIfExceeds('cold load navigation-to-canvas ms', coldLoad.navigationToCanvasMs, benchmarkConfig.maxNavToCanvasMs);
  failIfExceeds(
    'cold load navigation-to-probe-ready ms',
    coldLoad.navigationToProbeReadyMs,
    benchmarkConfig.maxNavToProbeReadyMs,
  );
  failIfExceeds(
    'cold load first usable probe-ready ms',
    coldLoad.firstUsableProbeReadyMs,
    benchmarkConfig.maxFirstUsableProbeReadyMs,
  );
  failIfExceeds('input-correlated rAF p95 ms', summary.interaction.inputRaf.p95Ms, benchmarkConfig.maxInputRafP95Ms);
  failIfExceeds(
    'input-correlated rAF max delta ms',
    summary.interaction.inputRaf.maxMs,
    benchmarkConfig.maxInputRafDeltaMs,
  );
  failIfExceeds('zoom/rotate phase rAF p95 ms', phaseHitches.worstP95Ms, benchmarkConfig.maxInputRafP95Ms);
  failIfExceeds('zoom/rotate phase rAF max delta ms', phaseHitches.worstMaxMs, benchmarkConfig.maxInputRafDeltaMs);
  failIfExceeds('zoom/rotate phase settle ms', zoomSettle.maxSettleTimeMs, benchmarkConfig.maxPhaseSettleMs);
  if (zoomSettle.unsettledPhases > benchmarkConfig.maxUnsettledPhases) {
    failures.push(`unsettled zoom/rotate phases ${zoomSettle.unsettledPhases} > ${benchmarkConfig.maxUnsettledPhases}`);
  }
  if (summary.interaction.probe.readbacksDuringInput > benchmarkConfig.maxProbeReadbacksDuringInput) {
    failures.push(
      `probe readbacks during input ${summary.interaction.probe.readbacksDuringInput} > ${benchmarkConfig.maxProbeReadbacksDuringInput}`,
    );
  }
  if (summary.raf.samples < benchmarkConfig.minRafSamples) {
    failures.push(`too few rAF samples: ${summary.raf.samples} < ${benchmarkConfig.minRafSamples}`);
  }
  if (summary.raf.maxMs > benchmarkConfig.maxRafDeltaMs) {
    failures.push(`rAF max delta ${summary.raf.maxMs}ms > ${benchmarkConfig.maxRafDeltaMs}ms`);
  }
  if (summary.raf.p95Ms > benchmarkConfig.rafP95Ms) {
    failures.push(`rAF p95 ${summary.raf.p95Ms}ms > ${benchmarkConfig.rafP95Ms}ms`);
  }
  if (summary.raf.p99Ms > benchmarkConfig.rafP99Ms) {
    failures.push(`rAF p99 ${summary.raf.p99Ms}ms > ${benchmarkConfig.rafP99Ms}ms`);
  }
  if (summary.raf.longFrameRatio > benchmarkConfig.maxLongFrameRatio) {
    failures.push(
      `rAF long-frame ratio ${summary.raf.longFrameRatio} > ${benchmarkConfig.maxLongFrameRatio}`,
    );
  }
  if (performance.available && (performance.frameTimeP95Ms ?? 0) > benchmarkConfig.probeP95Ms) {
    failures.push(`probe frame p95 ${performance.frameTimeP95Ms}ms > ${benchmarkConfig.probeP95Ms}ms`);
  }
  if (performance.available && (performance.maxFrameMs ?? 0) > benchmarkConfig.maxProbeFrameMs) {
    failures.push(`probe max frame ${performance.maxFrameMs}ms > ${benchmarkConfig.maxProbeFrameMs}ms`);
  }
  if (performance.available && (performance.slowFrameCount ?? 0) > benchmarkConfig.maxProbeSlowFrames) {
    failures.push(
      `probe slow frames ${performance.slowFrameCount} > ${benchmarkConfig.maxProbeSlowFrames}`,
    );
  }
  if (performance.available && (performance.maxTextureUploadMs ?? 0) > benchmarkConfig.maxProbeTextureUploadMs) {
    failures.push(
      `probe texture upload max ${performance.maxTextureUploadMs}ms > ${benchmarkConfig.maxProbeTextureUploadMs}ms`,
    );
  }
  if (performance.available && (performance.maxPageGenerationMs ?? 0) > benchmarkConfig.maxProbePageGenerationMs) {
    failures.push(
      `probe page generation max ${performance.maxPageGenerationMs}ms > ${benchmarkConfig.maxProbePageGenerationMs}ms`,
    );
  }
  if (performance.available && (performance.maxPlanMs ?? 0) > benchmarkConfig.maxProbePlanMs) {
    failures.push(`probe request planning max ${performance.maxPlanMs}ms > ${benchmarkConfig.maxProbePlanMs}ms`);
  }
  if (performance.available && (performance.maxSchedulerDelayMs ?? 0) > benchmarkConfig.maxProbeSchedulerDelayMs) {
    failures.push(
      `probe scheduler delay max ${performance.maxSchedulerDelayMs}ms > ${benchmarkConfig.maxProbeSchedulerDelayMs}ms`,
    );
  }
  if (performance.available && (performance.maxWorkChunkMs ?? 0) > benchmarkConfig.maxProbeWorkChunkMs) {
    failures.push(`probe work chunk max ${performance.maxWorkChunkMs}ms > ${benchmarkConfig.maxProbeWorkChunkMs}ms`);
  }
  if (performance.available && (performance.pendingPages ?? 0) > benchmarkConfig.maxProbeFinalPendingPages) {
    failures.push(
      `probe final pending pages ${performance.pendingPages} > ${benchmarkConfig.maxProbeFinalPendingPages}`,
    );
  }
  if (performance.available && (performance.maxQueueDepth ?? 0) > benchmarkConfig.maxWorkerQueueDepth) {
    failures.push(`worker queue depth ${performance.maxQueueDepth} > ${benchmarkConfig.maxWorkerQueueDepth}`);
  }
  if (performance.available && (performance.maxInFlightBytes ?? 0) > benchmarkConfig.maxWorkerInFlightBytes) {
    failures.push(`worker in-flight bytes ${performance.maxInFlightBytes} > ${benchmarkConfig.maxWorkerInFlightBytes}`);
  }
  if (
    performance.available &&
    (performance.maxWorkerGenerationLatencyMs ?? 0) > benchmarkConfig.maxWorkerLatencyMs
  ) {
    failures.push(
      `worker generation latency ${performance.maxWorkerGenerationLatencyMs}ms > ${
        benchmarkConfig.maxWorkerLatencyMs
      }ms`,
    );
  }
  if (
    performance.available &&
    (performance.maxOldestQueuedWorkFrames ?? 0) > benchmarkConfig.maxOldestQueuedWorkFrames
  ) {
    failures.push(
      `oldest queued VT work ${performance.maxOldestQueuedWorkFrames} frames > ${
        benchmarkConfig.maxOldestQueuedWorkFrames
      }`,
    );
  }
  if (performance.available && performance.workerLastError !== '') {
    failures.push(`worker page generator error: ${performance.workerLastError}`);
  }
  if (uploadBursts.available && (uploadBursts.maxAtlasUploadCount ?? 0) > benchmarkConfig.maxAtlasUploadsPerChunk) {
    failures.push(
      `physical atlas upload burst ${uploadBursts.maxAtlasUploadCount} > ${benchmarkConfig.maxAtlasUploadsPerChunk}`,
    );
  }
  if (
    uploadBursts.available &&
    (uploadBursts.maxPageTableUploadCount ?? 0) > benchmarkConfig.maxPageTableUploadsPerChunk
  ) {
    failures.push(
      `page-table upload burst ${uploadBursts.maxPageTableUploadCount} > ${benchmarkConfig.maxPageTableUploadsPerChunk}`,
    );
  }
  const sampledPendingPages = performance.maxSampledPendingPages;
  if (performance.available && (sampledPendingPages ?? 0) > benchmarkConfig.maxProbePendingPages) {
    failures.push(`probe sampled pending pages ${sampledPendingPages} > ${benchmarkConfig.maxProbePendingPages}`);
  }

  if (benchmarkConfig.requireDefaultOnMetrics) {
    if (quality.exactHitRatio === null) {
      failures.push('exact hit ratio metric was not exposed by the virtual texture probe');
    } else if (quality.exactHitRatio < benchmarkConfig.minExactHitRatio) {
      failures.push(`exact hit ratio ${quality.exactHitRatio} < ${benchmarkConfig.minExactHitRatio}`);
    }

    if (quality.repeatedReloadRatio === null) {
      failures.push('repeated reload ratio metric was not exposed by the virtual texture probe');
    } else if (quality.repeatedReloadRatio > benchmarkConfig.maxRepeatedReloadRatio) {
      failures.push(
        `repeated reload ratio ${quality.repeatedReloadRatio} > ${benchmarkConfig.maxRepeatedReloadRatio}`,
      );
    }

    if (quality.recentEvictionReRequestRatio === null) {
      failures.push('recent eviction re-request ratio metric was not exposed by the virtual texture probe');
    } else if (quality.recentEvictionReRequestRatio > benchmarkConfig.maxRecentEvictionReRequestRatio) {
      failures.push(
        `recent eviction re-request ratio ${quality.recentEvictionReRequestRatio} > ${benchmarkConfig.maxRecentEvictionReRequestRatio}`,
      );
    }

    if (quality.fullTableRebuildExcess === null) {
      failures.push('full page-table rebuild metric was not exposed by the virtual texture probe');
    } else if (quality.fullTableRebuildExcess > benchmarkConfig.maxFullTableRebuildExcess) {
      failures.push(
        `full page-table rebuild excess ${quality.fullTableRebuildExcess} > ${benchmarkConfig.maxFullTableRebuildExcess}`,
      );
    }
  }

  return { failures, summary };
};

const main = async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'royal-vt-smoothness-'));
  const preview = spawnLogged('pnpm', [
    'exec',
    'vite',
    'preview',
    '--config',
    'vite.config.ts',
    '--host',
    host,
    '--port',
    String(previewPort),
    '--strictPort',
  ], { cwd: appRoot });
  const browser = spawnLogged(chromiumBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { cwd: appRoot });

  let session;
  const exceptions = [];

  try {
    await waitForHttp(baseUrl, 15_000);
    session = await connectPage();
    session.on('Runtime.exceptionThrown', (event) => {
      exceptions.push(event.exceptionDetails?.text ?? 'Runtime exception');
    });
    await session.call('Page.enable');
    await session.call('Runtime.enable');

    const loaded = session.once('Page.loadEventFired');
    await session.call('Page.navigate', { url: routeUrl });
    await loaded;

    const result = await evaluate(session, benchmarkExpression);
    const { failures, summary } = assertSmooth(result, exceptions);
    console.log(JSON.stringify(summary, null, 2));

    if (failures.length > 0) {
      throw new Error(`Virtual texturing smoothness failed: ${failures.join('; ')}`);
    }
  } finally {
    session?.close();
    await stop(browser);
    await stop(preview);
    await rm(profileDir, {
      force: true,
      maxRetries: 3,
      recursive: true,
      retryDelay: 100,
    });
  }
};

await main();
