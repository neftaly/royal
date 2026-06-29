#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = resolve(__dirname, "fixtures/automatic-renderer-policy-fixture.json");
const REPRESENTATION_RANK = Object.freeze({
  meshHigh: 0,
  meshMid: 1,
  octahedral: 2,
  billboard: 3,
  culled: 4
});
const FORBIDDEN_ROW_KEYS = [
  /dynamicImpostor/i,
  /^nodeType$/i,
  /impostor.*threshold/i,
  /billboard.*threshold/i,
  /lod.*threshold/i,
  /lod.*distance/i,
  /impostor.*distance/i,
  /public.*impostor/i
];
const FORBIDDEN_ROW_VALUES = [
  /DynamicImpostorNode/,
  /BillboardLodNode/,
  /ForestNode/
];

const args = parseArgs(process.argv.slice(2));
const fixturePath = stringArg(args.fixture, DEFAULT_FIXTURE);
const backend = stringArg(args.backend, "webgl2");
const fixture = readJson(fixturePath);

if (booleanArg(args.check, false)) {
  const report = runCheckSuite(fixture, { fixturePath, backend });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} else {
  const policyMode = stringArg(args.policy, "automatic");
  const subject = mutateFixtureForArgs(fixture, args, policyMode);
  const report = validateFixture(subject, {
    fixturePath,
    backend,
    policyMode,
    includeFrames: true
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}

function runCheckSuite(sourceFixture, options) {
  const automatic = validateFixture(cloneJson(sourceFixture), {
    ...options,
    policyMode: "automatic",
    includeFrames: false
  });
  const noHysteresis = validateFixture(withoutHysteresis(cloneJson(sourceFixture)), {
    ...options,
    policyMode: "naive-no-hysteresis",
    includeFrames: false
  });
  const publicThreshold = validateFixture(withPublicThresholdLeak(cloneJson(sourceFixture)), {
    ...options,
    policyMode: "automatic",
    includeFrames: false
  });
  const passed = automatic.passed && !noHysteresis.passed && !publicThreshold.passed;

  return {
    validator: "royal-research-automatic-dynamic-lod-impostor-policy",
    fixture: options.fixturePath,
    backend: options.backend,
    passed,
    cases: {
      automaticPolicyPasses: summarizeCase(automatic),
      naiveNoHysteresisFails: summarizeCase(noHysteresis),
      publicThresholdLeakFails: summarizeCase(publicThreshold)
    },
    automaticMetrics: automatic.metrics,
    expectedFailureSignals: {
      naiveNoHysteresis: noHysteresis.failures.map((failure) => failure.code),
      publicThresholdLeak: publicThreshold.failures.map((failure) => failure.code)
    },
    caveat: "Research-only CPU validator. It validates policy boundaries and deterministic packet decisions, not renderer output."
  };
}

function summarizeCase(report) {
  return {
    passed: report.passed,
    failureCount: report.failures.length,
    failures: report.failures
  };
}

function mutateFixtureForArgs(sourceFixture, parsedArgs, policyMode) {
  let result = cloneJson(sourceFixture);
  if (policyMode === "naive-no-hysteresis") result = withoutHysteresis(result);
  if (booleanArg(parsedArgs.injectPublicThreshold, false)) {
    result = withPublicThresholdLeak(result);
  }
  return result;
}

function validateFixture(sourceFixture, options) {
  const failures = [];
  const warnings = [];
  const validation = sourceFixture.validation ?? {};
  const policy = sourceFixture.rendererPolicy ?? {};

  if (sourceFixture.status !== "research-only") {
    failures.push(failure("not-research-only", "Fixture must remain research-only."));
  }
  if (sourceFixture.apiBoundary?.rendererPrivateOutputs !== true) {
    failures.push(failure("outputs-not-private", "Fixture must declare renderer-private outputs."));
  }
  if (sourceFixture.apiBoundary?.publicRendererNodesAllowed !== false) {
    failures.push(failure("public-renderer-nodes-allowed", "Public renderer/impostor nodes must stay disallowed."));
  }
  if (sourceFixture.lodPolicy) {
    failures.push(failure("legacy-lod-policy-thresholds", "Automatic policy fixture must not expose a top-level lodPolicy threshold object."));
  }
  if (policy.owner !== "renderer-private") {
    failures.push(failure("policy-owner-not-renderer-private", "LOD/impostor policy must be renderer-private."));
  }

  const publicLeaks = findPublicPerObjectLeaks(sourceFixture);
  if (publicLeaks.length > 0) {
    failures.push(failure("public-per-object-impostor-threshold", "Visibility/object rows contain public impostor nodes or thresholds.", {
      leaks: publicLeaks.slice(0, 8)
    }));
  }

  const hysteresis = policy.hysteresis;
  if (!hysteresis || hysteresis.screenErrorMarginFraction <= 0 || hysteresis.holdFrames < 1) {
    failures.push(failure("missing-camera-hysteresis", "Automatic LOD needs positive screen-error hysteresis and at least one hold frame."));
  }

  const transition = policy.transition;
  const minCrossFadeFrames = validation.minCrossFadeFrames ?? 1;
  if (!transition || transition.minCrossFadeFrames < minCrossFadeFrames || transition.depthStable !== true) {
    failures.push(failure("missing-stable-crossfade", "Representation switches must carry a depth-stable crossfade window.", {
      requiredMinCrossFadeFrames: minCrossFadeFrames,
      actualMinCrossFadeFrames: transition?.minCrossFadeFrames ?? null
    }));
  }

  const requiredModelFailures = validateModelShape(sourceFixture);
  failures.push(...requiredModelFailures);

  const simulation = simulateFixture(sourceFixture, options.policyMode, options.backend, warnings);
  failures.push(...evaluateSimulation(sourceFixture, simulation));

  return {
    validator: "royal-research-automatic-dynamic-lod-impostor-policy",
    fixture: options.fixturePath,
    schema: sourceFixture.schema,
    backend: options.backend,
    policyMode: options.policyMode,
    passed: failures.length === 0,
    failures,
    warnings,
    metrics: simulation.metrics,
    rendererPrivateOutputShape: {
      packets: [
        "representation",
        "meshLod",
        "culled",
        "transition",
        "requestedAtlasPages",
        "fallbackQuality",
        "batchKey",
        "churn"
      ],
      publicNodeApi: false
    },
    ...(options.includeFrames ? { frames: simulation.frames } : {})
  };
}

function validateModelShape(sourceFixture) {
  const failures = [];
  if (!Array.isArray(sourceFixture.sourceMeshes) || sourceFixture.sourceMeshes.length === 0) {
    failures.push(failure("missing-source-meshes", "Fixture must provide source mesh asset rows."));
  }
  if (!Array.isArray(sourceFixture.impostorAtlases) || sourceFixture.impostorAtlases.length === 0) {
    failures.push(failure("missing-impostor-atlases", "Fixture must provide impostor atlas metadata."));
  }
  if (!sourceFixture.materialTextureBudgets) {
    failures.push(failure("missing-texture-residency-budgets", "Fixture must provide material/texture residency budgets."));
  }
  if (!Array.isArray(sourceFixture.visibilityPackets) || sourceFixture.visibilityPackets.length < 2) {
    failures.push(failure("missing-visibility-packets", "Fixture must provide camera/visibility packets over multiple frames."));
  }

  for (const mesh of sourceFixture.sourceMeshes ?? []) {
    if (!mesh.bounds?.halfExtents || !Number.isFinite(mesh.bounds?.radius)) {
      failures.push(failure("mesh-missing-bounds", "Source meshes need bounds for screen-error and culling decisions.", { meshId: mesh.id }));
    }
    const reps = mesh.errorMetrics?.representations;
    if (!Array.isArray(reps) || reps.length === 0) {
      failures.push(failure("mesh-missing-error-metrics", "Source meshes need representation error metrics.", { meshId: mesh.id }));
    }
    for (const rep of reps ?? []) {
      if (!Number.isFinite(rep.geometricErrorMeters) || !Number.isFinite(rep.costUnits)) {
        failures.push(failure("representation-missing-error-or-cost", "Representation rows need geometric error and cost.", {
          meshId: mesh.id,
          representation: rep.id
        }));
      }
      if ((rep.kind === "octahedral" || rep.kind === "billboard") && (!rep.atlasId || !rep.pageGroup)) {
        failures.push(failure("impostor-representation-missing-atlas", "Impostor rows need atlas id and page group.", {
          meshId: mesh.id,
          representation: rep.id
        }));
      }
    }
  }
  return failures;
}

function simulateFixture(sourceFixture, policyMode, backend, warnings) {
  const meshes = new Map(sourceFixture.sourceMeshes.map((mesh) => [mesh.id, mesh]));
  const instances = new Map(sourceFixture.instances.map((instance) => [instance.objectId, instance]));
  const atlases = new Map(sourceFixture.impostorAtlases.map((atlas) => [atlas.id, atlas]));
  const policy = sourceFixture.rendererPolicy;
  const useHysteresis = policyMode !== "naive-no-hysteresis" && !!policy.hysteresis;
  const state = new Map();
  const pageCache = createPageCache(sourceFixture.materialTextureBudgets.physicalPageSlots);
  const frames = [];
  const perObjectSwitches = new Map();
  let totalPackets = 0;
  let totalSwitches = 0;
  let totalFallbackPackets = 0;
  let fallbackPacketsWithoutQuality = 0;
  let alphaPacketsMissingOrdering = 0;
  let uncertainOcclusionCulled = 0;
  let skinnedImpostorPackets = 0;
  let nonUniformScalePacketsMissingDiagnostics = 0;
  let maxDrawPackets = 0;

  for (const framePacket of sourceFixture.visibilityPackets) {
    const candidatePackets = [];
    const pageDemand = new Map();

    for (const row of framePacket.rows) {
      const instance = instances.get(row.objectId);
      if (!instance) {
        warnings.push({ code: "unknown-visibility-object", objectId: row.objectId, frame: framePacket.frame });
        continue;
      }
      const mesh = meshes.get(instance.sourceMeshId);
      if (!mesh) {
        warnings.push({ code: "unknown-source-mesh", objectId: row.objectId, sourceMeshId: instance.sourceMeshId });
        continue;
      }

      const object = { ...instance, ...row };
      const ideal = selectIdealRepresentation(sourceFixture, mesh, object, framePacket, backend, atlases);
      const previous = state.get(object.objectId);
      const selected = useHysteresis
        ? applyHysteresis(policy, previous, ideal)
        : { selected: ideal, pending: null };
      const switched = !!previous && previous.selected.id !== selected.selected.id;
      const transition = switched ? makeTransition(policy, previous.selected.id, selected.selected.id) : null;

      if (switched) {
        totalSwitches += 1;
        perObjectSwitches.set(object.objectId, (perObjectSwitches.get(object.objectId) ?? 0) + 1);
      }

      state.set(object.objectId, {
        selected: selected.selected,
        pending: selected.pending,
        frame: framePacket.frame
      });

      const requestedPages = requestedAtlasPages(selected.selected, object, framePacket, atlases);
      for (const request of requestedPages) {
        const existing = pageDemand.get(request.key);
        if (existing) {
          existing.priority = Math.max(existing.priority, request.priority);
          existing.samples += 1;
        } else {
          pageDemand.set(request.key, { ...request, samples: 1 });
        }
      }

      const packet = {
        privatePacketKind: "renderer-lod-impostor-selection",
        objectId: object.objectId,
        sourceMeshId: mesh.id,
        representation: selected.selected.id,
        meshLod: selected.selected.meshLod ?? null,
        culled: selected.selected.id === "culled",
        culledReason: selected.selected.culledReason ?? null,
        screenErrorPixels: round(selected.selected.screenErrorPixels),
        projectedDiameterPixels: round(selected.selected.projectedDiameterPixels),
        requestedAtlasPages: requestedPages.map((request) => request.key),
        fallbackQuality: "none",
        transition,
        churn: switched,
        batchKey: batchKeyFor(mesh, selected.selected),
        depthPolicy: depthPolicyFor(mesh, selected.selected),
        sortKey: sortKeyFor(mesh, selected.selected, object),
        occlusion: object.occlusion ?? "none",
        diagnostics: selected.selected.diagnostics
      };
      candidatePackets.push(packet);
    }

    const residency = scheduleResidency(pageCache, pageDemand, sourceFixture.materialTextureBudgets, framePacket.frame);
    for (const packet of candidatePackets) {
      const missingPages = packet.requestedAtlasPages.filter((page) => residency.missingPages.includes(page));
      if (missingPages.length > 0) {
        packet.fallbackQuality = fallbackQualityFor(sourceFixture, packet.representation);
        packet.diagnostics = [...packet.diagnostics, `atlas-page-miss:${missingPages.join(",")}`];
        totalFallbackPackets += 1;
        if (packet.fallbackQuality === "none") fallbackPacketsWithoutQuality += 1;
      }

      const mesh = meshes.get(packet.sourceMeshId);
      const isImpostor = packet.representation === "octahedral" || packet.representation === "billboard";
      if (isImpostor && mesh.material.opacity !== "opaque" && (!packet.depthPolicy || !packet.sortKey)) {
        alphaPacketsMissingOrdering += 1;
      }
      if (packet.occlusion.includes("uncertain") && packet.culled) {
        uncertainOcclusionCulled += 1;
      }
      if (mesh.animation?.skinned && isImpostor) {
        skinnedImpostorPackets += 1;
      }
      if (packet.diagnostics.includes("nonuniform-scale") && !packet.diagnostics.includes("bounds-inflated-by-max-axis")) {
        nonUniformScalePacketsMissingDiagnostics += 1;
      }
    }

    const drawPackets = countDrawPackets(candidatePackets);
    maxDrawPackets = Math.max(maxDrawPackets, drawPackets);
    totalPackets += candidatePackets.length;
    frames.push({
      frame: framePacket.frame,
      camera: framePacket.camera,
      residency,
      drawPackets,
      rendererPrivatePackets: candidatePackets
    });
  }

  const maxSwitchesPerObject = Math.max(0, ...perObjectSwitches.values());
  return {
    frames,
    metrics: {
      frameCount: frames.length,
      totalPackets,
      totalSwitches,
      churnRate: round(ratio(totalSwitches, totalPackets)),
      maxSwitchesPerObject,
      perObjectSwitches: Object.fromEntries([...perObjectSwitches.entries()].sort()),
      totalFallbackPackets,
      fallbackPacketsWithoutQuality,
      alphaPacketsMissingOrdering,
      uncertainOcclusionCulled,
      skinnedImpostorPackets,
      nonUniformScalePacketsMissingDiagnostics,
      maxDrawPackets,
      finalResidentPages: pageCache.pages.size
    }
  };
}

function evaluateSimulation(sourceFixture, simulation) {
  const failures = [];
  const validation = sourceFixture.validation ?? {};
  const policy = sourceFixture.rendererPolicy;
  const metrics = simulation.metrics;

  if (metrics.churnRate > (validation.maxChurnRate ?? 1)) {
    failures.push(failure("lod-churn-too-high", "Camera jitter caused excessive representation churn.", {
      actual: metrics.churnRate,
      limit: validation.maxChurnRate
    }));
  }
  if (metrics.maxSwitchesPerObject > (validation.maxSwitchesPerObject ?? Infinity)) {
    failures.push(failure("per-object-thrashing", "At least one object switched representations too often.", {
      actual: metrics.maxSwitchesPerObject,
      limit: validation.maxSwitchesPerObject,
      perObjectSwitches: metrics.perObjectSwitches
    }));
  }
  if (validation.requireFallbackQualityLabels && metrics.fallbackPacketsWithoutQuality > 0) {
    failures.push(failure("missing-fallback-quality-labels", "Atlas page misses must identify fallback quality.", {
      packets: metrics.fallbackPacketsWithoutQuality
    }));
  }
  if (validation.requireAlphaDepthOrdering && metrics.alphaPacketsMissingOrdering > 0) {
    failures.push(failure("missing-alpha-depth-ordering", "Alpha impostor packets need depth/sort policy.", {
      packets: metrics.alphaPacketsMissingOrdering
    }));
  }
  if (validation.requireConservativeUncertainOcclusion && metrics.uncertainOcclusionCulled > 0) {
    failures.push(failure("uncertain-occlusion-false-negative", "Terrain/object occlusion uncertainty must not cull visible candidates.", {
      packets: metrics.uncertainOcclusionCulled
    }));
  }
  if (validation.requireSkinnedDegrade && metrics.skinnedImpostorPackets > 0) {
    failures.push(failure("skinned-object-used-static-impostor", "Skinned or animated objects must degrade to mesh LOD or unsupported diagnostics.", {
      packets: metrics.skinnedImpostorPackets
    }));
  }
  if (validation.requireNonUniformScaleDiagnostics && metrics.nonUniformScalePacketsMissingDiagnostics > 0) {
    failures.push(failure("missing-nonuniform-scale-diagnostics", "Nonuniform scale must inflate bounds and label quality implications.", {
      packets: metrics.nonUniformScalePacketsMissingDiagnostics
    }));
  }
  if (metrics.maxDrawPackets > policy.batching.maxDrawPacketsPerFrame) {
    failures.push(failure("batching-pressure-too-high", "Renderer-private packet bins exceed the batching pressure budget.", {
      actual: metrics.maxDrawPackets,
      limit: policy.batching.maxDrawPacketsPerFrame
    }));
  }
  if (validation.requireWebGL2PortablePath && sourceFixture.capabilities?.webgl2?.path !== "instanced-quad-impostors-with-page-table-textures") {
    failures.push(failure("missing-webgl2-portable-path", "Fixture must name the WebGL2-compatible private path."));
  }
  return failures;
}

function selectIdealRepresentation(sourceFixture, mesh, object, framePacket, backend, atlases) {
  const camera = framePacket.camera;
  const distance = distanceToCamera(object.center, camera.position);
  const screenScale = screenScalePixels(camera.viewportHeightPx, camera.verticalFovDegrees);
  const scale = scaleInfo(object.scale);
  const projectedDiameterPixels = (mesh.bounds.radius * scale.max * 2 * screenScale) / Math.max(1, distance);
  const diagnostics = [];
  if (scale.nonUniform) diagnostics.push("nonuniform-scale", "bounds-inflated-by-max-axis");
  if (object.occlusion?.includes("uncertain")) diagnostics.push("occlusion-uncertain-conservative-draw");

  const policy = sourceFixture.rendererPolicy;
  const selection = policy.selection;
  const outsideFrustum = object.visibility === "outside-frustum";
  const conservativeOcclusion = object.occlusion?.includes("uncertain");
  if (
    outsideFrustum ||
    (!conservativeOcclusion && (
      distance > selection.cullDistanceMeters ||
      projectedDiameterPixels < selection.cullProjectedDiameterBelowPixels
    ))
  ) {
    return {
      id: "culled",
      kind: "culled",
      screenErrorPixels: 0,
      projectedDiameterPixels,
      targetPixels: 0,
      culledReason: outsideFrustum ? "outside-frustum" : "projected-diameter-or-distance",
      diagnostics
    };
  }

  const targetPixels = qualityTargetPixels(selection, mesh);
  const candidates = mesh.errorMetrics.representations
    .map((representation) => scoreRepresentation(representation, mesh, object, camera, distance, screenScale, scale, targetPixels, backend, atlases))
    .filter((candidate) => candidate.supported);
  const acceptable = candidates
    .filter((candidate) => candidate.screenErrorPixels <= targetPixels)
    .sort(compareCandidateCost);
  const selected = acceptable[0] ?? candidates.sort(compareCandidateDetail)[0];

  return {
    ...selected,
    projectedDiameterPixels,
    targetPixels,
    diagnostics: [...diagnostics, ...selected.diagnostics]
  };
}

function scoreRepresentation(rep, mesh, object, camera, distance, screenScale, scale, targetPixels, backend, atlases) {
  const diagnostics = [];
  let supported = true;
  if (mesh.animation?.skinned && rep.kind !== "mesh") {
    supported = false;
    diagnostics.push("skinned-impostor-unsupported");
  }
  if (mesh.animation?.vertexAnimated && rep.kind !== "mesh") {
    supported = false;
    diagnostics.push("vertex-animation-impostor-unsupported");
  }
  if (scale.nonUniform && rep.kind === "octahedral" && rep.supportsNonUniformScale === false) {
    supported = false;
    diagnostics.push("octahedral-nonuniform-scale-unsupported");
  }
  const atlas = rep.atlasId ? atlases.get(rep.atlasId) : null;
  if ((rep.kind === "octahedral" || rep.kind === "billboard") && !atlas) {
    supported = false;
    diagnostics.push("missing-atlas");
  }
  if (backend === "webgl2" && rep.requiresWebGPU) {
    supported = false;
    diagnostics.push("webgpu-only-representation");
  }

  const screenErrorPixels = (rep.geometricErrorMeters * scale.max * screenScale) / Math.max(1, distance);
  return {
    ...rep,
    supported,
    screenErrorPixels,
    targetPixels,
    diagnostics
  };
}

function applyHysteresis(policy, previous, ideal) {
  if (!previous) return { selected: ideal, pending: null };
  if (previous.selected.id === ideal.id) return { selected: previous.selected, pending: null };
  if (!shouldConsiderSwitch(policy, previous.selected, ideal)) {
    return { selected: previous.selected, pending: null };
  }

  const pending = previous.pending?.id === ideal.id
    ? { id: ideal.id, frames: previous.pending.frames + 1 }
    : { id: ideal.id, frames: 1 };
  if (pending.frames >= policy.hysteresis.holdFrames) {
    return { selected: ideal, pending: null };
  }
  return { selected: previous.selected, pending };
}

function shouldConsiderSwitch(policy, previous, ideal) {
  if (previous.id === "culled" || ideal.id === "culled") return true;
  const previousRank = representationRank(previous.id);
  const idealRank = representationRank(ideal.id);
  const margin = policy.hysteresis.screenErrorMarginFraction;

  if (idealRank > previousRank) {
    return ideal.screenErrorPixels <= ideal.targetPixels * (1 - margin);
  }
  if (idealRank < previousRank) {
    return previous.screenErrorPixels > previous.targetPixels * (1 + margin);
  }
  return true;
}

function makeTransition(policy, from, to) {
  return {
    from,
    to,
    mode: policy.transition.mode,
    frames: policy.transition.minCrossFadeFrames,
    depthStable: policy.transition.depthStable,
    carryPreviousRepresentationDuringFade: policy.transition.carryPreviousRepresentationDuringFade
  };
}

function requestedAtlasPages(selected, object, framePacket, atlases) {
  if (selected.kind !== "octahedral" && selected.kind !== "billboard") return [];
  const atlas = atlases.get(selected.atlasId);
  const directionCount = atlas.directionCount;
  const angle = cameraRelativeAngle(object.yawDegrees ?? 0, framePacket.camera.forward);
  const direction = positiveModulo(Math.floor((angle / 360) * directionCount), directionCount);
  const mip = selected.projectedDiameterPixels > 96 ? 0 : selected.projectedDiameterPixels > 32 ? 1 : 2;
  const blendDirections = selected.kind === "octahedral" ? Math.min(3, atlas.maxBlendDirections ?? 1) : 1;
  const priorityBase = selected.kind === "octahedral" ? 100 : 60;
  const pages = [];
  for (let index = 0; index < blendDirections; index += 1) {
    const dir = positiveModulo(direction + index, directionCount);
    pages.push({
      key: `${selected.pageGroup}/mip${mip}/dir${dir}`,
      pageGroup: selected.pageGroup,
      atlasId: selected.atlasId,
      priority: priorityBase - mip * 8 - index * 3,
      samples: 1
    });
  }
  return pages;
}

function scheduleResidency(pageCache, pageDemand, budgets, frame) {
  const requests = [...pageDemand.values()].sort(comparePageRequest);
  const residentBefore = new Set(pageCache.pages.keys());
  const missingPages = [];
  let hits = 0;
  let misses = 0;
  let uploadedPages = 0;
  let uploadedBytes = 0;

  for (const request of requests) {
    if (pageCache.pages.has(request.key)) {
      hits += request.samples;
      pageCache.pages.get(request.key).lastUsed = frame;
      continue;
    }
    misses += request.samples;
    missingPages.push(request.key);
  }

  for (const request of requests.filter((candidate) => !residentBefore.has(candidate.key))) {
    if (uploadedPages >= budgets.maxUploadsPerFrame) break;
    if (uploadedBytes + budgets.bytesPerPage > budgets.maxUploadBytesPerFrame) break;
    pageCache.insert(request, frame);
    uploadedPages += 1;
    uploadedBytes += budgets.bytesPerPage;
  }

  return {
    uniquePageRequests: requests.length,
    hits,
    misses,
    hitRatio: round(ratio(hits, hits + misses)),
    uploadedPages,
    uploadedBytes,
    residentPages: pageCache.pages.size,
    queuedPagesAfterBudget: Math.max(0, missingPages.length - uploadedPages),
    missingPages
  };
}

function createPageCache(capacity) {
  return {
    pages: new Map(),
    insert(request, frame) {
      if (this.pages.size >= capacity && !this.pages.has(request.key)) {
        const oldest = [...this.pages.entries()].reduce((candidate, entry) => {
          if (!candidate) return entry;
          return entry[1].lastUsed < candidate[1].lastUsed ? entry : candidate;
        }, null);
        if (oldest) this.pages.delete(oldest[0]);
      }
      this.pages.set(request.key, {
        key: request.key,
        atlasId: request.atlasId,
        pageGroup: request.pageGroup,
        lastUsed: frame
      });
    }
  };
}

function countDrawPackets(packets) {
  const keys = new Set();
  for (const packet of packets) {
    if (!packet.culled) keys.add(packet.batchKey);
  }
  return keys.size;
}

function batchKeyFor(mesh, selected) {
  if (selected.id === "culled") return "culled";
  const materialClass = mesh.materialClass;
  const depthPolicy = depthPolicyFor(mesh, selected);
  return `${selected.batchKey ?? selected.id}/${materialClass}/${depthPolicy}`;
}

function depthPolicyFor(mesh, selected) {
  if (selected.id === "culled") return null;
  if (mesh.material.opacity === "opaque") return "opaque-depth";
  if (selected.kind === "mesh") return "alpha-tested-mesh-depth";
  if (selected.kind === "octahedral") return "alpha-tested-impostor-depth-page";
  if (selected.kind === "billboard") return "alpha-tested-cell-depth-sort";
  return "alpha-tested-depth";
}

function sortKeyFor(mesh, selected, object) {
  if (selected.id === "culled") return null;
  if (mesh.material.opacity === "opaque") return "opaque-front-to-back";
  return `${mesh.material.sortPolicy}/${object.objectId}`;
}

function fallbackQualityFor(sourceFixture, representation) {
  const fallback = sourceFixture.rendererPolicy.fallback;
  if (representation === "octahedral") return fallback.missingOctahedralPage ?? "none";
  if (representation === "billboard") return fallback.missingBillboardPage ?? "none";
  return "none";
}

function findPublicPerObjectLeaks(sourceFixture) {
  const leaks = [];
  for (const instance of sourceFixture.instances ?? []) {
    scanObjectForForbiddenRows(instance, `instances.${instance.objectId}`, leaks);
  }
  for (const packet of sourceFixture.visibilityPackets ?? []) {
    for (const row of packet.rows ?? []) {
      scanObjectForForbiddenRows(row, `visibilityPackets.${packet.frame}.${row.objectId}`, leaks);
    }
  }
  if (Array.isArray(sourceFixture.sceneNodes)) {
    leaks.push({ path: "sceneNodes", reason: "public scene node list present" });
  }
  if (sourceFixture.publicApi) {
    leaks.push({ path: "publicApi", reason: "public renderer API policy present" });
  }
  return leaks;
}

function scanObjectForForbiddenRows(value, path, leaks) {
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_ROW_KEYS.some((pattern) => pattern.test(key))) {
      leaks.push({ path: `${path}.${key}`, reason: "forbidden per-object public threshold or node key" });
    }
    if (typeof nested === "string" && FORBIDDEN_ROW_VALUES.some((pattern) => pattern.test(nested))) {
      leaks.push({ path: `${path}.${key}`, reason: "forbidden public impostor node value" });
    }
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      scanObjectForForbiddenRows(nested, `${path}.${key}`, leaks);
    }
  }
}

function withoutHysteresis(sourceFixture) {
  delete sourceFixture.rendererPolicy.hysteresis;
  sourceFixture.rendererPolicy.transition = {
    ...sourceFixture.rendererPolicy.transition,
    minCrossFadeFrames: 0,
    depthStable: false
  };
  return sourceFixture;
}

function withPublicThresholdLeak(sourceFixture) {
  const firstRow = sourceFixture.visibilityPackets?.[0]?.rows?.[0];
  if (firstRow) {
    firstRow.nodeType = "DynamicImpostorNode";
    firstRow.impostorThresholdMeters = 310;
  }
  return sourceFixture;
}

function qualityTargetPixels(selection, mesh) {
  return selection.qualityTargetPixels[mesh.materialClass] ?? selection.qualityTargetPixels.default;
}

function compareCandidateCost(a, b) {
  return a.costUnits - b.costUnits || representationRank(b.id) - representationRank(a.id);
}

function compareCandidateDetail(a, b) {
  return representationRank(a.id) - representationRank(b.id);
}

function comparePageRequest(a, b) {
  return b.priority - a.priority || b.samples - a.samples || a.key.localeCompare(b.key);
}

function representationRank(id) {
  return REPRESENTATION_RANK[id] ?? 99;
}

function scaleInfo(scale) {
  const values = Array.isArray(scale) ? scale : [1, 1, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    min,
    max,
    nonUniform: max - min > 0.001
  };
}

function screenScalePixels(viewportHeightPx, verticalFovDegrees) {
  return viewportHeightPx / (2 * Math.tan(degreesToRadians(verticalFovDegrees) / 2));
}

function distanceToCamera(center, position) {
  const dx = center[0] - position[0];
  const dy = center[1] - position[1];
  const dz = center[2] - position[2];
  return Math.hypot(dx, dy, dz);
}

function cameraRelativeAngle(yawDegrees, forward) {
  const cameraDegrees = radiansToDegrees(Math.atan2(forward[2], forward[0]));
  return positiveModulo(cameraDegrees - yawDegrees, 360);
}

function positiveModulo(value, modulo) {
  return ((value % modulo) + modulo) % modulo;
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function radiansToDegrees(value) {
  return value * 180 / Math.PI;
}

function failure(code, message, detail = {}) {
  return { code, message, ...detail };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function stringArg(value, fallback) {
  return value === undefined ? fallback : String(value);
}

function booleanArg(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  if (value === false) return false;
  const normalized = String(value).toLowerCase();
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return true;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals !== -1) {
      result[toCamel(raw.slice(0, equals))] = raw.slice(equals + 1);
      continue;
    }
    const key = toCamel(raw);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}
