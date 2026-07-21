const isRecord = (value) => typeof value === 'object'
  && value !== null
  && !Array.isArray(value);

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/** Pure classification shared by live collection and offline report validation. */
export const isExpectedIpadDevTransportDiagnostic = (entry, entries) => {
  if (
    entry.kind !== 'console'
    || entry.level !== 'error'
    || !/^WebSocket connection to 'ws:\/\/[^/]+\/\?token=[^']+' failed: WebSocket is closed due to suspension\.$/u
      .test(entry.text)
  ) return false;
  return entries.some((candidate) =>
    candidate.kind === 'console'
    && candidate.level === 'debug'
    && candidate.text === '[vite] connecting...'
    && /\/@vite\/client(?:\?|$)/u.test(candidate.url)
    && candidate.timestamp >= entry.timestamp
    && candidate.timestamp - entry.timestamp < 2
  );
};

export const isIpadSafariBenchmarkEnvelope = (value) => isRecord(value)
  && isRecord(value.report)
  && typeof value.receivedAt === 'string'
  && 'browserDiagnostics' in value;

/** Pure validation for one physical Safari report emitted by the iPad harness. */
export const validateIpadSafariBenchmarkEnvelope = (envelope) => {
  const errors = [];
  const warnings = [];
  const expectRecord = (value, label) => {
    if (isRecord(value)) return true;
    errors.push(`${label} must be an object`);
    return false;
  };
  const expectArray = (value, label) => {
    if (Array.isArray(value)) return true;
    errors.push(`${label} must be an array`);
    return false;
  };
  const expectBoolean = (value, label) => {
    if (typeof value === 'boolean') return true;
    errors.push(`${label} must be a boolean`);
    return false;
  };
  const expectNumber = (value, label, { positive = false } = {}) => {
    if (!isFiniteNumber(value)) {
      errors.push(`${label} must be a finite number`);
      return false;
    }
    if (positive ? value <= 0 : value < 0) {
      errors.push(`${label} must be ${positive ? 'greater than' : 'at least'} 0`);
      return false;
    }
    return true;
  };
  const expectString = (value, label) => {
    if (typeof value === 'string' && value.length > 0) return true;
    errors.push(`${label} must be a non-empty string`);
    return false;
  };

  if (!expectRecord(envelope, 'report')) return { errors, warnings };
  expectString(envelope.receivedAt, 'report.receivedAt');
  expectBoolean(envelope.cameraDrag, 'report.cameraDrag');
  expectBoolean(envelope.coldCache, 'report.coldCache');

  if (expectRecord(envelope.browserDiagnostics, 'report.browserDiagnostics')) {
    expectNumber(
      envelope.browserDiagnostics.droppedEntries,
      'report.browserDiagnostics.droppedEntries',
    );
    if (expectArray(envelope.browserDiagnostics.entries, 'report.browserDiagnostics.entries')) {
      envelope.browserDiagnostics.entries.forEach((entry, index) => {
        const label = `report.browserDiagnostics.entries[${index}]`;
        if (!expectRecord(entry, label)) return;
        expectString(entry.kind, `${label}.kind`);
        expectString(entry.level, `${label}.level`);
        if (typeof entry.text !== 'string') errors.push(`${label}.text must be a string`);
        if (
          (entry.kind === 'exception' || entry.level === 'error')
          && !isExpectedIpadDevTransportDiagnostic(entry, envelope.browserDiagnostics.entries)
        ) {
          errors.push(`${label} contains a browser error: ${String(entry.text)}`);
        } else if (entry.level === 'warning') {
          warnings.push(`${label} contains a browser warning: ${String(entry.text)}`);
        }
      });
    }
  }

  if (envelope.canvasCapture !== undefined) {
    if (expectRecord(envelope.canvasCapture, 'report.canvasCapture')) {
      expectNumber(envelope.canvasCapture.byteLength, 'report.canvasCapture.byteLength', {
        positive: true,
      });
      if (
        !expectString(envelope.canvasCapture.filename, 'report.canvasCapture.filename')
        || !envelope.canvasCapture.filename.endsWith('.png')
      ) errors.push('report.canvasCapture.filename must end with .png');
    }
  }

  const report = envelope.report;
  if (!expectRecord(report, 'report.report')) return { errors, warnings };
  expectString(report.generatedAt, 'report.report.generatedAt');
  expectString(report.url, 'report.report.url');
  expectBoolean(report.ready, 'report.report.ready');
  if (report.ready !== true) errors.push('report.report.ready must be true');
  expectBoolean(report.warmupComplete, 'report.report.warmupComplete');
  if (report.warmupComplete !== true) errors.push('report.report.warmupComplete must be true');

  if (expectRecord(report.source, 'report.report.source')) {
    expectString(report.source.buildId, 'report.report.source.buildId');
    expectString(report.source.builtAt, 'report.report.source.builtAt');
    expectBoolean(report.source.dirty, 'report.report.source.dirty');
    expectString(report.source.revision, 'report.report.source.revision');
  }
  if (expectRecord(report.device, 'report.report.device')) {
    expectNumber(report.device.dpr, 'report.report.device.dpr', { positive: true });
    expectString(report.device.userAgent, 'report.report.device.userAgent');
    if (expectRecord(report.device.webgl, 'report.report.device.webgl')) {
      expectString(report.device.webgl.renderer, 'report.report.device.webgl.renderer');
      expectString(report.device.webgl.version, 'report.report.device.webgl.version');
    }
  }
  if (expectRecord(report.example, 'report.report.example')) {
    expectString(report.example.id, 'report.report.example.id');
    expectString(report.example.path, 'report.report.example.path');
  }

  const frameStats = report.frameStats;
  if (expectRecord(frameStats, 'report.report.frameStats')) {
    for (const key of [
      'averageMs',
      'maxMs',
      'minMs',
      'p50Ms',
      'p95Ms',
      'p99Ms',
      'requestedSampleCount',
      'sampleCount',
      'samplesMissing',
      'timeoutMs',
    ]) expectNumber(frameStats[key], `report.report.frameStats.${key}`);
    expectBoolean(frameStats.complete, 'report.report.frameStats.complete');
    expectBoolean(frameStats.failed, 'report.report.frameStats.failed');
    expectBoolean(frameStats.timedOut, 'report.report.frameStats.timedOut');
    if (frameStats.complete !== true) errors.push('report.report.frameStats.complete must be true');
    if (frameStats.failed === true) errors.push('report.report.frameStats.failed must be false');
    if (frameStats.timedOut === true) errors.push('report.report.frameStats.timedOut must be false');
    if (
      isFiniteNumber(frameStats.sampleCount)
      && isFiniteNumber(frameStats.requestedSampleCount)
      && frameStats.sampleCount !== frameStats.requestedSampleCount
    ) errors.push('report.report.frameStats.sampleCount must match requestedSampleCount');
  }

  if (expectRecord(report.gl, 'report.report.gl')) {
    for (const phase of ['frames', 'setup']) {
      if (!expectRecord(report.gl[phase], `report.report.gl.${phase}`)) continue;
      for (const key of ['drawCalls', 'stateChanges', 'uniformCalls']) {
        expectNumber(report.gl[phase][key], `report.report.gl.${phase}.${key}`);
      }
    }
  }

  if (expectArray(report.warnings, 'report.report.warnings')) {
    report.warnings.forEach((warning, index) => {
      if (typeof warning !== 'string') errors.push(`report.report.warnings[${index}] must be a string`);
      else warnings.push(`report.report.warnings[${index}]: ${warning}`);
    });
  }

  const after = report.renderer?.after;
  if (expectRecord(after, 'report.report.renderer.after')) {
    const assets = after.gltfLoadDiagnostics?.assets;
    if (assets !== undefined && expectArray(assets, 'report.report.renderer.after.gltfLoadDiagnostics.assets')) {
      assets.forEach((asset, index) => {
        const label = `report.report.renderer.after.gltfLoadDiagnostics.assets[${index}]`;
        if (!expectRecord(asset, label)) return;
        if (asset.status !== 'ready' && asset.status !== 'degraded') {
          errors.push(`${label}.status must be ready or degraded`);
        }
        for (const key of ['imageFailures', 'imagesLoaded', 'imageRequests']) {
          expectNumber(asset[key], `${label}.${key}`);
        }
        if (
          isFiniteNumber(asset.imageFailures)
          && isFiniteNumber(asset.imagesLoaded)
          && isFiniteNumber(asset.imageRequests)
          && asset.imageFailures + asset.imagesLoaded !== asset.imageRequests
        ) errors.push(`${label} must settle every requested image`);
      });
    }
    const virtualTexturing = after.virtualTexturing;
    if (virtualTexturing !== null && virtualTexturing !== undefined) {
      if (expectRecord(virtualTexturing, 'report.report.renderer.after.virtualTexturing')) {
        for (const key of ['failedPages', 'manifestFailures', 'pendingPages']) {
          expectNumber(virtualTexturing[key], `report.report.renderer.after.virtualTexturing.${key}`);
          if (virtualTexturing[key] !== 0) {
            errors.push(`report.report.renderer.after.virtualTexturing.${key} must be 0`);
          }
        }
        expectNumber(
          virtualTexturing.residentPages,
          'report.report.renderer.after.virtualTexturing.residentPages',
          { positive: true },
        );
      }
    }
  }

  return { errors, warnings };
};

/** Exact physical positive oracle for Royal's optional ETC2 glTF delivery path. */
export const validateIpadEtc2BenchmarkEnvelope = (envelope) => {
  const result = validateIpadSafariBenchmarkEnvelope(envelope);
  const errors = [...result.errors];
  const report = envelope?.report;
  if (!isRecord(report)) return { errors, warnings: result.warnings };
  if (report.source?.dirty !== false) errors.push('ETC2 oracle source must be a clean build');
  if (report.example?.id !== 'gltf-lab') errors.push('ETC2 oracle example must be gltf-lab');
  if (!String(report.url ?? '').includes('case=RoyalEtc2OptionalFallback')) {
    errors.push('ETC2 oracle URL must select RoyalEtc2OptionalFallback');
  }
  const extensions = report.device?.webgl?.extensions;
  if (!Array.isArray(extensions) || !extensions.includes('WEBGL_compressed_texture_etc')) {
    errors.push('ETC2 oracle device must expose WEBGL_compressed_texture_etc');
  }
  const residency = report.renderer?.after?.textureResidency;
  if (!isRecord(residency)) {
    errors.push('ETC2 oracle textureResidency must be an object');
  } else {
    const exact = {
      bytes: 16,
      compressedBytes: 16,
      compressedResources: 1,
      fitted: 0,
      resources: 1,
    };
    for (const [key, value] of Object.entries(exact)) {
      if (residency[key] !== value) errors.push(`ETC2 oracle textureResidency.${key} must be ${value}`);
    }
  }
  const assets = report.renderer?.after?.gltfLoadDiagnostics?.assets;
  const asset = Array.isArray(assets)
    ? assets.find((candidate) => candidate?.src?.endsWith('/optional-fallback-quad.gltf'))
    : undefined;
  if (!isRecord(asset)) {
    errors.push('ETC2 oracle glTF asset diagnostics are missing');
  } else if (
    asset.status !== 'ready'
    || asset.imageCandidates !== 1
    || asset.imageRequests !== 1
    || asset.imagesLoaded !== 1
    || asset.imageFailures !== 0
  ) {
    errors.push('ETC2 oracle must settle exactly one selected image without failure');
  }
  return { errors, warnings: result.warnings };
};
