import { readFile } from 'node:fs/promises';

const reportPath = process.argv[2] ?? process.env.EXAMPLES_BENCH_OUTPUT;

if (reportPath === undefined || reportPath.trim() === '') {
  console.error('Usage: node scripts/check-benchmark-report.mjs <report.json>');
  process.exit(2);
}

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
  'rootPositionUploadBytes',
  'rootPositionUploadCalls',
  'rootRotationUploadBytes',
  'rootRotationUploadCalls',
  'rootScaleUploadBytes',
  'rootScaleUploadCalls',
];

const errors = [];

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

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
  if (typeof value === 'number' && Number.isFinite(value)) return;
  errors.push(`${label} must be a finite number`);
};

const requireBoolean = (value, label) => {
  if (typeof value === 'boolean') return;
  errors.push(`${label} must be a boolean`);
};

const requireGltfInstancingCounters = (value, label) => {
  if (!requireObject(value, label)) return;
  for (const counter of requiredGltfInstancingCounters) {
    requireNumber(value[counter], `${label}.${counter}`);
  }
};

const parseReport = async () => {
  try {
    return JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read benchmark report ${JSON.stringify(reportPath)}: ${message}`);
  }
};

const report = await parseReport();

if (requireObject(report, 'report')) {
  if (requireArray(report.routes, 'report.routes')) {
    report.routes.forEach((route, index) => {
      const routeLabel = `report.routes[${index}]${typeof route?.id === 'string' ? ` (${route.id})` : ''}`;
      if (!requireObject(route, routeLabel)) return;
      if (!requireObject(route.gl, `${routeLabel}.gl`)) return;
      for (const counter of requiredGlCounters) {
        requireNumber(route.gl[counter], `${routeLabel}.gl.${counter}`);
      }
      if (requireObject(route.gl.setup, `${routeLabel}.gl.setup`)) {
        for (const counter of requiredGlCounters) {
          requireNumber(route.gl.setup[counter], `${routeLabel}.gl.setup.${counter}`);
        }
      }
      if (route.profile?.kind === 'gltf-instancing') {
        if (requireObject(route.renderer, `${routeLabel}.renderer`)) {
          if (requireObject(route.renderer.gltfInstancing, `${routeLabel}.renderer.gltfInstancing`)) {
            requireBoolean(
              route.renderer.gltfInstancing.available,
              `${routeLabel}.renderer.gltfInstancing.available`,
            );
            requireGltfInstancingCounters(
              route.renderer.gltfInstancing.delta,
              `${routeLabel}.renderer.gltfInstancing.delta`,
            );
            requireGltfInstancingCounters(
              route.renderer.gltfInstancing.perFrame,
              `${routeLabel}.renderer.gltfInstancing.perFrame`,
            );
            requireNumber(
              route.renderer.gltfInstancing.rendererFrames,
              `${routeLabel}.renderer.gltfInstancing.rendererFrames`,
            );
            requireNumber(
              route.renderer.gltfInstancing.sampleFrames,
              `${routeLabel}.renderer.gltfInstancing.sampleFrames`,
            );
          }
          if (requireObject(route.renderer.setup, `${routeLabel}.renderer.setup`)) {
            if (requireObject(
              route.renderer.setup.gltfInstancing,
              `${routeLabel}.renderer.setup.gltfInstancing`,
            )) {
              requireBoolean(
                route.renderer.setup.gltfInstancing.available,
                `${routeLabel}.renderer.setup.gltfInstancing.available`,
              );
              requireGltfInstancingCounters(
                route.renderer.setup.gltfInstancing.counters,
                `${routeLabel}.renderer.setup.gltfInstancing.counters`,
              );
              requireNumber(
                route.renderer.setup.gltfInstancing.rendererFrame,
                `${routeLabel}.renderer.setup.gltfInstancing.rendererFrame`,
              );
            }
          }
        }
      }
    });
  }

  if (requireObject(report.analysis, 'report.analysis')) {
    for (const [name, requiredCounters] of [
      ['heaviestGlStateRoutes', requiredSummaryCounters],
      ['heaviestUniformRoutes', ['uniformCallsPerFrame']],
      ['heaviestDrawRoutes', ['drawCallsPerFrame']],
    ]) {
      const rows = report.analysis[name];
      if (!requireArray(rows, `report.analysis.${name}`)) continue;
      rows.forEach((row, index) => {
        const rowLabel = `report.analysis.${name}[${index}]`;
        if (!requireObject(row, rowLabel)) return;
        for (const counter of requiredCounters) {
          requireNumber(row[counter], `${rowLabel}.${counter}`);
        }
      });
    }
  }
}

if (errors.length > 0) {
  console.error(`Benchmark report check failed for ${reportPath}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Benchmark report check passed: ${reportPath}`);
