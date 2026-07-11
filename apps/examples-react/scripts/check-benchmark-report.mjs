import { readFile } from 'node:fs/promises';
import path from 'node:path';

const reportPathInput = process.argv[2] ?? process.env.EXAMPLES_BENCH_OUTPUT;

if (reportPathInput === undefined || reportPathInput.trim() === '') {
  console.error('Usage: node scripts/check-benchmark-report.mjs <report.json>');
  process.exit(2);
}

const reportBasePath = process.env.INIT_CWD?.trim() || process.cwd();
const reportPath = path.resolve(reportBasePath, reportPathInput.trim());

const requiredGlCounters = [
  'bindBuffer',
  'bindTexture',
  'bindVertexArray',
  'copyTexImage2D',
  'copyTexSubImage2D',
  'stateChanges',
  'uniformCalls',
  'uniformMatrixCalls',
  'useProgram',
];

const requiredGlEvidenceCounters = [
  'bufferSubDataBytes',
  'drawArraysInstanced',
  'drawCalls',
  'drawElementsInstanced',
  'instancedDrawCalls',
];

const requiredFrameStats = [
  'averageMs',
  'jitterP95MinusP50Ms',
  'maxMs',
  'minMs',
  'p50Ms',
  'p95Ms',
  'p99Ms',
  'requestedSampleCount',
  'sampleCount',
  'timeoutMs',
];

const requiredVisibleSummaryCounters = [
  'jitterP95MinusP50Ms',
  'p95Ms',
  'readyMs',
];

const requiredSummaryCounters = [
  'bindBufferPerFrame',
  'bindTexturePerFrame',
  'bindVertexArrayPerFrame',
  'copyTexImage2DPerFrame',
  'copyTexSubImage2DPerFrame',
  'stateChangesPerFrame',
  'uniformCallsPerFrame',
  'uniformMatrixCallsPerFrame',
  'useProgramPerFrame',
];

const requiredGltfInstancingCounters = [
  'batchInstancesTotal',
  'batchPlansBuilt',
  'drawCalls',
  'instancesDrawn',
  'localModelUploadBytes',
  'localModelUploadCalls',
  'rootPoseUploadBytes',
  'rootPoseUploadCalls',
  'rootScaleUploadBytes',
  'rootScaleUploadCalls',
];

const requiredPlanningCounters = ['compileNodeVisits', 'planCompiles', 'planRevision', 'sceneCommits'];
const requiredResourceLifetimeCounters = [
  'assetPlanCompiles',
  'preparedAssetAcquires',
  'preparedAssetEvents',
  'preparedAssetReleases',
  'preparedAssetUpdates',
  'sceneLeaseAcquires',
  'sceneLeaseReleases',
  'gltfPreparationQueueHighWater',
  'imageQueueHighWater',
  'iblImageQueueHighWater',
];

const errors = [];
const warnings = [];

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const requireObject = (value, label) => {
  if (isObject(value)) return true;
  errors.push(`${label} must be an object`);
  return false;
};

const requireArray = (value, label) => {
  if (Array.isArray(value)) return true;
  errors.push(`${label} must be an array`);
  return false;
};

const requireNumber = (value, label) => {
  if (isNumber(value)) return true;
  errors.push(`${label} must be a finite number`);
  return false;
};

const requireString = (value, label) => {
  if (typeof value === 'string' && value.length > 0) return true;
  errors.push(`${label} must be a non-empty string`);
  return false;
};

const requireBoolean = (value, label) => {
  if (typeof value === 'boolean') return true;
  errors.push(`${label} must be a boolean`);
  return false;
};

const requirePositiveNumber = (value, label) => {
  if (!requireNumber(value, label)) return;
  if (value <= 0) errors.push(`${label} must be greater than 0`);
};

const requireNonNegativeNumber = (value, label) => {
  if (!requireNumber(value, label)) return;
  if (value < 0) errors.push(`${label} must be at least 0`);
};

const requireZero = (value, label) => {
  if (!requireNumber(value, label)) return;
  if (value !== 0) errors.push(`${label} must be 0`);
};

const rootTransformUploadBytes = (counters) =>
  (isNumber(counters?.rootPoseUploadBytes) ? counters.rootPoseUploadBytes : 0) +
  (isNumber(counters?.rootScaleUploadBytes) ? counters.rootScaleUploadBytes : 0);

const instancedDrawCount = (counters) =>
  (isNumber(counters?.drawArraysInstanced) ? counters.drawArraysInstanced : 0) +
  (isNumber(counters?.drawElementsInstanced) ? counters.drawElementsInstanced : 0);

const requireGlCounters = (value, label) => {
  if (!requireObject(value, label)) return false;
  for (const counter of [...requiredGlCounters, ...requiredGlEvidenceCounters]) {
    requireNumber(value[counter], `${label}.${counter}`);
  }
  return true;
};

const requireGltfInstancingCounters = (value, label) => {
  if (!requireObject(value, label)) return;
  for (const counter of requiredGltfInstancingCounters) {
    requireNumber(value[counter], `${label}.${counter}`);
  }
};

const warnPartialTimeout = (label, sampleCount, requestedSampleCount) => {
  const sampleText = isNumber(sampleCount) && isNumber(requestedSampleCount)
    ? ` after ${sampleCount}/${requestedSampleCount} samples`
    : '';
  warnings.push(`${label} timed out partially${sampleText}; p95/jitter evidence is incomplete`);
};

const checkFrameStats = (value, label) => {
  if (!requireObject(value, label)) return;
  for (const field of requiredFrameStats) {
    requireNumber(value[field], `${label}.${field}`);
  }
  if (value.failed === true) {
    errors.push(`${label} failed${typeof value.reason === 'string' ? `: ${value.reason}` : ''}`);
  }
  if (requireBoolean(value.timedOut, `${label}.timedOut`) && value.timedOut) {
    if (isNumber(value.sampleCount) && value.sampleCount > 0) {
      warnPartialTimeout(label, value.sampleCount, value.requestedSampleCount);
    } else {
      errors.push(`${label} has no usable frame samples`);
    }
  }
  if (isNumber(value.sampleCount) && value.sampleCount <= 0) {
    errors.push(`${label}.sampleCount must be greater than 0`);
  }
  if (
    isNumber(value.sampleCount) &&
    isNumber(value.requestedSampleCount) &&
    value.sampleCount < value.requestedSampleCount &&
    value.timedOut !== true
  ) {
    errors.push(`${label} is missing samples without timedOut=true`);
  }
};

const checkRouteFrameEvidence = (route, routeLabel) => {
  requireBoolean(route.ready, `${routeLabel}.ready`);
  requireNumber(route.wallNavigationAndReadyMs, `${routeLabel}.wallNavigationAndReadyMs`);
  checkFrameStats(route.frameStats, `${routeLabel}.frameStats`);
  if (route.ready === false) {
    if (isNumber(route.frameStats?.sampleCount) && route.frameStats.sampleCount > 0) {
      warnings.push(`${routeLabel}.ready is false; frame evidence exists but route readiness is incomplete`);
    } else {
      errors.push(`${routeLabel}.ready must be true when no frame samples are available`);
    }
  }
};

const checkSummaryFailure = (value, label) => {
  if (value === undefined) return;
  if (value === 'partial-timeout') {
    warnings.push(`${label} is partial-timeout; visible metrics may be based on incomplete samples`);
    return;
  }
  errors.push(`${label} is ${JSON.stringify(value)}`);
};

const checkSummaryRows = (rows, label, requiredCounters) => {
  if (!requireArray(rows, label)) return;
  rows.forEach((row, index) => {
    const rowLabel = `${label}[${index}]`;
    if (!requireObject(row, rowLabel)) return;
    for (const counter of requiredCounters) {
      requireNumber(row[counter], `${rowLabel}.${counter}`);
    }
    checkSummaryFailure(row.frameFailure, `${rowLabel}.frameFailure`);
    checkSummaryFailure(row.cameraDragFailure, `${rowLabel}.cameraDragFailure`);
  });
};

const checkGltfSampleEvidence = (gltfInstancing, frameStats, label, { animated }) => {
  if (!requireObject(gltfInstancing, label)) return;
  requireBoolean(gltfInstancing.available, `${label}.available`);
  if (gltfInstancing.available !== true) {
    errors.push(`${label}.available must be true for glTF instancing routes`);
  }
  requireGltfInstancingCounters(gltfInstancing.delta, `${label}.delta`);
  requireGltfInstancingCounters(gltfInstancing.perFrame, `${label}.perFrame`);
  requireNumber(gltfInstancing.rendererFrames, `${label}.rendererFrames`);
  requireNumber(gltfInstancing.sampleFrames, `${label}.sampleFrames`);
  if (
    isNumber(gltfInstancing.sampleFrames) &&
    isNumber(frameStats?.sampleCount) &&
    gltfInstancing.sampleFrames !== frameStats.sampleCount
  ) {
    if (frameStats?.timedOut === true) {
      warnings.push(
        `${label}.sampleFrames differs from frameStats.sampleCount on a partial timeout; check per-frame summaries`,
      );
    } else {
      errors.push(`${label}.sampleFrames must match frameStats.sampleCount`);
    }
  }
  if (
    animated &&
    isNumber(gltfInstancing.rendererFrames) &&
    isNumber(gltfInstancing.sampleFrames) &&
    gltfInstancing.rendererFrames !== gltfInstancing.sampleFrames
  ) {
    warnings.push(
      `${label}.rendererFrames differs from sampleFrames; compare raw renderer counters with frame samples`,
    );
  }
};

const checkGltfSetupEvidence = (gltfInstancing, label) => {
  if (!requireObject(gltfInstancing, label)) return;
  requireBoolean(gltfInstancing.available, `${label}.available`);
  if (gltfInstancing.available !== true) {
    errors.push(`${label}.available must be true for glTF instancing routes`);
  }
  requireGltfInstancingCounters(gltfInstancing.counters, `${label}.counters`);
  requireNumber(gltfInstancing.rendererFrame, `${label}.rendererFrame`);
};

const checkRendererCounters = (value, label, keys, field) => {
  if (!requireObject(value, label)) return;
  requireBoolean(value.available, `${label}.available`);
  if (value.available !== true) errors.push(`${label}.available must be true`);
  const counters = value[field];
  if (!requireObject(counters, `${label}.${field}`)) return;
  for (const key of keys) requireNumber(counters[key], `${label}.${field}.${key}`);
};

const checkRendererCounterBridge = (route, routeLabel) => {
  if (!requireObject(route.renderer, `${routeLabel}.renderer`)) return;
  checkRendererCounters(route.renderer.planning, `${routeLabel}.renderer.planning`, requiredPlanningCounters, 'delta');
  checkRendererCounters(
    route.renderer.resourceLifetime,
    `${routeLabel}.renderer.resourceLifetime`,
    requiredResourceLifetimeCounters,
    'delta',
  );
  if (!requireObject(route.renderer.setup, `${routeLabel}.renderer.setup`)) return;
  checkRendererCounters(
    route.renderer.setup.planning,
    `${routeLabel}.renderer.setup.planning`,
    requiredPlanningCounters,
    'counters',
  );
  checkRendererCounters(
    route.renderer.setup.resourceLifetime,
    `${routeLabel}.renderer.setup.resourceLifetime`,
    requiredResourceLifetimeCounters,
    'counters',
  );
};

const checkInstancingRoute = (route, routeLabel) => {
  const animated = route.profile?.animate === true;
  requireBoolean(route.profile?.animate, `${routeLabel}.profile.animate`);
  requireNumber(route.profile?.instanceCount, `${routeLabel}.profile.instanceCount`);
  if (!requireObject(route.renderer, `${routeLabel}.renderer`)) return;

  const gltfInstancing = route.renderer.gltfInstancing;
  const setupGltfInstancing = route.renderer.setup?.gltfInstancing;
  checkGltfSampleEvidence(gltfInstancing, route.frameStats, `${routeLabel}.renderer.gltfInstancing`, { animated });
  if (requireObject(route.renderer.setup, `${routeLabel}.renderer.setup`)) {
    checkGltfSetupEvidence(setupGltfInstancing, `${routeLabel}.renderer.setup.gltfInstancing`);
  }

  if (animated) {
    requirePositiveNumber(route.gl.instancedDrawCalls, `${routeLabel}.gl.instancedDrawCalls`);
    requirePositiveNumber(instancedDrawCount(route.gl), `${routeLabel}.gl.instancedDrawCallsEvidence`);
    requirePositiveNumber(
      gltfInstancing?.delta?.drawCalls,
      `${routeLabel}.renderer.gltfInstancing.delta.drawCalls`,
    );
    requirePositiveNumber(
      gltfInstancing?.delta?.instancesDrawn,
      `${routeLabel}.renderer.gltfInstancing.delta.instancesDrawn`,
    );
    requirePositiveNumber(
      rootTransformUploadBytes(gltfInstancing?.delta),
      `${routeLabel}.renderer.gltfInstancing.delta.rootTransformUploadBytes`,
    );
  } else {
    requirePositiveNumber(route.gl.setup?.instancedDrawCalls, `${routeLabel}.gl.setup.instancedDrawCalls`);
    requirePositiveNumber(instancedDrawCount(route.gl.setup), `${routeLabel}.gl.setup.instancedDrawCallsEvidence`);
    requirePositiveNumber(
      setupGltfInstancing?.counters?.drawCalls,
      `${routeLabel}.renderer.setup.gltfInstancing.counters.drawCalls`,
    );
    requirePositiveNumber(
      setupGltfInstancing?.counters?.instancesDrawn,
      `${routeLabel}.renderer.setup.gltfInstancing.counters.instancesDrawn`,
    );
  }
};

const checkCameraDrag = (route, routeLabel, cameraDragEnabled) => {
  if (!cameraDragEnabled && route.cameraDrag === undefined) return;
  if (!requireObject(route.cameraDrag, `${routeLabel}.cameraDrag`)) return;
  checkFrameStats(route.cameraDrag.frameStats, `${routeLabel}.cameraDrag.frameStats`);
  requireGlCounters(route.cameraDrag.gl, `${routeLabel}.cameraDrag.gl`);
  if (route.profile?.kind === 'gltf-instancing') {
    checkGltfSampleEvidence(
      route.cameraDrag.renderer?.gltfInstancing,
      route.cameraDrag.frameStats,
      `${routeLabel}.cameraDrag.renderer.gltfInstancing`,
      { animated: route.profile.animate === true },
    );
  }
};

const isGltfLoadReport = (value) =>
  isObject(value?.metrics) &&
  isObject(value?.route) &&
  isObject(value?.page) &&
  !Array.isArray(value?.routes);

const checkUsableCanvasSample = (value, label) => {
  if (!requireObject(value, label)) return;
  requirePositiveNumber(value.colorBuckets, `${label}.colorBuckets`);
  requirePositiveNumber(value.height, `${label}.height`);
  requirePositiveNumber(value.paintedPixels, `${label}.paintedPixels`);
  requirePositiveNumber(value.paintedRatio, `${label}.paintedRatio`);
  requirePositiveNumber(value.width, `${label}.width`);
};

const checkVtFrameSample = (value, label, { generatedVt }) => {
  if (!requireObject(value, label)) return;
  requireBoolean(value.timedOut, `${label}.timedOut`);
  requirePositiveNumber(value.requestedFrames, `${label}.requestedFrames`);
  if (requireObject(value.frameStats, `${label}.frameStats`)) {
    requirePositiveNumber(value.frameStats.sampleCount, `${label}.frameStats.sampleCount`);
    if (
      value.timedOut !== true &&
      isNumber(value.frameStats.sampleCount) &&
      isNumber(value.requestedFrames) &&
      value.frameStats.sampleCount !== value.requestedFrames
    ) {
      errors.push(`${label}.frameStats.sampleCount must match ${label}.requestedFrames`);
    }
    if (value.timedOut === true && isNumber(value.frameStats.sampleCount) && isNumber(value.requestedFrames)) {
      warnings.push(
        `${label} timed out partially after ${value.frameStats.sampleCount}/${value.requestedFrames} samples`,
      );
    }
  }
  if (requireObject(value.gl, `${label}.gl`)) {
    requirePositiveNumber(value.gl.drawCalls, `${label}.gl.drawCalls`);
  }
  if (generatedVt && requireObject(value.virtualTexturing, `${label}.virtualTexturing`)) {
    if (requireObject(value.virtualTexturing.after, `${label}.virtualTexturing.after`)) {
      requirePositiveNumber(value.virtualTexturing.after.uploadedPages, `${label}.virtualTexturing.after.uploadedPages`);
      requirePositiveNumber(
        value.virtualTexturing.after.uploadedPageBytes,
        `${label}.virtualTexturing.after.uploadedPageBytes`,
      );
    }
  }
};

const checkGltfLoadReport = (report) => {
  requireString(report.route.path, 'report.route.path');
  requireString(report.route.url, 'report.route.url');

  const metrics = report.metrics;
  if (!requireObject(metrics, 'report.metrics')) return;
  requirePositiveNumber(metrics.firstDrawMs, 'report.metrics.firstDrawMs');
  requirePositiveNumber(metrics.firstTextureUploadMs, 'report.metrics.firstTextureUploadMs');
  requirePositiveNumber(metrics.firstTexturedFrameMs, 'report.metrics.firstTexturedFrameMs');
  requirePositiveNumber(metrics.firstUsableDrawMs, 'report.metrics.firstUsableDrawMs');
  requirePositiveNumber(metrics.fullyLoadedMs, 'report.metrics.fullyLoadedMs');
  requirePositiveNumber(metrics.wallNavigationAndFullyLoadedMs, 'report.metrics.wallNavigationAndFullyLoadedMs');
  if (requireObject(metrics.timedOut, 'report.metrics.timedOut')) {
    requireBoolean(metrics.timedOut.firstUsable, 'report.metrics.timedOut.firstUsable');
    requireBoolean(metrics.timedOut.fullyLoaded, 'report.metrics.timedOut.fullyLoaded');
    if (metrics.timedOut.firstUsable === true) errors.push('report.metrics.timedOut.firstUsable must be false');
    if (metrics.timedOut.fullyLoaded === true) errors.push('report.metrics.timedOut.fullyLoaded must be false');
  }

  if (requireObject(metrics.gl, 'report.metrics.gl')) {
    requirePositiveNumber(metrics.gl.drawCalls, 'report.metrics.gl.drawCalls');
    requirePositiveNumber(metrics.gl.textureUploadCalls, 'report.metrics.gl.textureUploadCalls');
    requirePositiveNumber(metrics.gl.textureUploadBytesRough, 'report.metrics.gl.textureUploadBytesRough');
  }
  if (requireObject(metrics.textures, 'report.metrics.textures')) {
    requirePositiveNumber(metrics.textures.allocations, 'report.metrics.textures.allocations');
    requirePositiveNumber(metrics.textures.allocationCalls, 'report.metrics.textures.allocationCalls');
    requirePositiveNumber(metrics.textures.uploadBytesRough, 'report.metrics.textures.uploadBytesRough');
    requirePositiveNumber(metrics.textures.uploadCalls, 'report.metrics.textures.uploadCalls');
  }

  if (requireObject(metrics.gltfLoadSummary, 'report.metrics.gltfLoadSummary')) {
    requirePositiveNumber(metrics.gltfLoadSummary.assets, 'report.metrics.gltfLoadSummary.assets');
    requirePositiveNumber(metrics.gltfLoadSummary.sceneReadyAssets, 'report.metrics.gltfLoadSummary.sceneReadyAssets');
    requireZero(metrics.gltfLoadSummary.errorAssets, 'report.metrics.gltfLoadSummary.errorAssets');
    requireZero(metrics.gltfLoadSummary.loadingAssets, 'report.metrics.gltfLoadSummary.loadingAssets');
    if (requireObject(metrics.gltfLoadSummary.totals, 'report.metrics.gltfLoadSummary.totals')) {
      requireZero(metrics.gltfLoadSummary.totals.imageFailures, 'report.metrics.gltfLoadSummary.totals.imageFailures');
      requirePositiveNumber(metrics.gltfLoadSummary.totals.imageLoaded, 'report.metrics.gltfLoadSummary.totals.imageLoaded');
      requirePositiveNumber(metrics.gltfLoadSummary.totals.imageRequests, 'report.metrics.gltfLoadSummary.totals.imageRequests');
    }
  }

  // Optional so reports captured before hitch sampling was introduced remain
  // checkable. New load reports always include this independent navigation-to-
  // ready sample; it is deliberately not a pass/fail performance gate.
  if (metrics.loadHitches !== undefined) {
    if (requireObject(metrics.loadHitches, 'report.metrics.loadHitches')) {
      for (const key of ['framesOver25Ms', 'framesOver50Ms', 'framesOver100Ms']) {
        requireNonNegativeNumber(metrics.loadHitches[key], `report.metrics.loadHitches.${key}`);
      }
      if (requireObject(metrics.loadHitches.frameStats, 'report.metrics.loadHitches.frameStats')) {
        for (const key of ['averageMs', 'maxMs', 'minMs', 'p50Ms', 'p95Ms', 'p99Ms']) {
          requirePositiveNumber(
            metrics.loadHitches.frameStats[key],
            `report.metrics.loadHitches.frameStats.${key}`,
          );
        }
        requirePositiveNumber(
          metrics.loadHitches.frameStats.sampleCount,
          'report.metrics.loadHitches.frameStats.sampleCount',
        );
      }
      if (requireObject(metrics.loadHitches.longTasks, 'report.metrics.loadHitches.longTasks')) {
        requireBoolean(
          metrics.loadHitches.longTasks.supported,
          'report.metrics.loadHitches.longTasks.supported',
        );
        for (const key of ['count', 'maxMs', 'totalMs']) {
          requireNonNegativeNumber(
            metrics.loadHitches.longTasks[key],
            `report.metrics.loadHitches.longTasks.${key}`,
          );
        }
      }
    }
  }

  if (requireObject(report.page, 'report.page')) {
    checkUsableCanvasSample(report.page.firstTexturedFrameSample, 'report.page.firstTexturedFrameSample');
    checkUsableCanvasSample(report.page.firstUsableSample, 'report.page.firstUsableSample');
  }

  const generatedVt = report.config?.forceGeneratedVirtualTexturing === true;
  if (generatedVt) {
    const generatedPagePrep = metrics.vt?.generatedPagePrep;
    if (requireObject(generatedPagePrep, 'report.metrics.vt.generatedPagePrep')) {
      requirePositiveNumber(generatedPagePrep.generatedManifestUses, 'report.metrics.vt.generatedPagePrep.generatedManifestUses');
      requirePositiveNumber(generatedPagePrep.generatedPageRequests, 'report.metrics.vt.generatedPagePrep.generatedPageRequests');
      requirePositiveNumber(generatedPagePrep.generatedPagesTarget, 'report.metrics.vt.generatedPagePrep.generatedPagesTarget');
      requireZero(generatedPagePrep.generatedPageFailures, 'report.metrics.vt.generatedPagePrep.generatedPageFailures');
    }
  }

  const vtRenderer = metrics.vt?.renderer;
  if (isObject(vtRenderer)) {
    requireZero(vtRenderer.pendingPages, 'report.metrics.vt.renderer.pendingPages');
    requireZero(vtRenderer.generatedPageFailures, 'report.metrics.vt.renderer.generatedPageFailures');
    requireZero(vtRenderer.unsupportedDraws, 'report.metrics.vt.renderer.unsupportedDraws');
    if (generatedVt) {
      requirePositiveNumber(vtRenderer.uploadedPages, 'report.metrics.vt.renderer.uploadedPages');
      requirePositiveNumber(vtRenderer.uploadedPageBytes, 'report.metrics.vt.renderer.uploadedPageBytes');
      requirePositiveNumber(vtRenderer.shaderBinds, 'report.metrics.vt.renderer.shaderBinds');
    }
  }
  if (report.config?.vtFrameSampleEnabled === true) {
    checkVtFrameSample(metrics.vtFrameSample, 'report.metrics.vtFrameSample', { generatedVt });
  }
};

const parseReport = async () => {
  try {
    return JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read benchmark report ${JSON.stringify(reportPathInput)}: ${message}`);
  }
};

const report = await parseReport();

if (requireObject(report, 'report')) {
  if (isGltfLoadReport(report)) {
    checkGltfLoadReport(report);
  } else {
    const cameraDragEnabled = report.options?.cameraDragEnabled === true;
    if (requireArray(report.routes, 'report.routes')) {
      report.routes.forEach((route, index) => {
        const routeLabel = `report.routes[${index}]${typeof route?.id === 'string' ? ` (${route.id})` : ''}`;
        if (!requireObject(route, routeLabel)) return;
        checkRouteFrameEvidence(route, routeLabel);
        checkRendererCounterBridge(route, routeLabel);
        if (!requireGlCounters(route.gl, `${routeLabel}.gl`)) return;
        if (requireObject(route.gl.setup, `${routeLabel}.gl.setup`)) {
          requireGlCounters(route.gl.setup, `${routeLabel}.gl.setup`);
        }
        checkCameraDrag(route, routeLabel, cameraDragEnabled);
        if (route.profile?.kind === 'gltf-instancing') {
          checkInstancingRoute(route, routeLabel);
        }
      });
    }

    if (requireObject(report.analysis, 'report.analysis')) {
      for (const [rawName, rawRequiredCounters] of [
        ['slowestRoutesByP95', requiredVisibleSummaryCounters],
        ['heaviestGlStateRoutes', [...requiredVisibleSummaryCounters, ...requiredSummaryCounters]],
        ['heaviestUniformRoutes', [...requiredVisibleSummaryCounters, 'uniformCallsPerFrame']],
        ['heaviestDrawRoutes', [...requiredVisibleSummaryCounters, 'drawCallsPerFrame']],
      ]) {
        const name = String(rawName);
        const requiredCounters = rawRequiredCounters.map(String);
        checkSummaryRows(report.analysis[name], `report.analysis.${name}`, requiredCounters);
      }
      if (cameraDragEnabled) {
        if (requireObject(report.analysis.cameraDrag, 'report.analysis.cameraDrag')) {
          checkSummaryRows(
            report.analysis.cameraDrag.failures,
            'report.analysis.cameraDrag.failures',
            [],
          );
          checkSummaryRows(
            report.analysis.cameraDrag.slowestRoutesByP95,
            'report.analysis.cameraDrag.slowestRoutesByP95',
            [...requiredVisibleSummaryCounters, 'cameraDragDrawP95Ms'],
          );
        }
      }
    }
  }
}

if (warnings.length > 0) {
  console.warn(`Benchmark report check warnings for ${reportPath}:`);
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (errors.length > 0) {
  console.error(`Benchmark report check failed for ${reportPath}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Benchmark report check passed: ${reportPath}`);
