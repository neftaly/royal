export type WebGpuBackendMode = "webgpu" | "webgl2" | "auto";

export type ResolvedRendererBackend = "webgpu" | "webgl2";

export type RendererBackendStatus = "ready" | "degraded" | "unavailable";

export type WebGpuPowerPreference = "high-performance" | "low-power";

export type RendererFallbackPolicy =
  | "error"
  | "webgl2"
  | "disable-feature"
  | "cpu"
  | "asset";

export type RoyalRendererFeature =
  | "indexed-geometry"
  | "uint32-indices"
  | "instancing"
  | "compute-pass"
  | "storage-buffer"
  | "timestamp-query"
  | "texture-compression-bc"
  | "texture-compression-astc"
  | "texture-compression-etc2"
  | "texture-asset"
  | "readback-buffer";

export type RendererBackendDiagnosticCode =
  | "backend_unavailable"
  | "device_request_failed"
  | "fallback_selected"
  | "feature_unavailable"
  | "probe_failed";

export type RendererBackendDiagnostic = {
  readonly code: RendererBackendDiagnosticCode;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly backend?: ResolvedRendererBackend | WebGpuBackendMode | undefined;
  readonly detail?: unknown;
  readonly fallback?: RendererFallbackPolicy | undefined;
  readonly feature?: RoyalRendererFeature | undefined;
};

export type WebGpuAdapterLike = {
  readonly features?: Iterable<string> | undefined;
  readonly limits?: object | undefined;
  readonly requestDevice?: (
    descriptor?: WebGpuDeviceDescriptorLike,
  ) => Promise<WebGpuDeviceLike>;
};

export type WebGpuDeviceDescriptorLike = {
  readonly label?: string | undefined;
  readonly requiredFeatures?: readonly string[] | undefined;
  readonly requiredLimits?: Readonly<Record<string, number>> | undefined;
};

export type WebGpuDeviceLike = {
  readonly features?: Iterable<string> | undefined;
  readonly limits?: object | undefined;
  readonly queue?: unknown;
  readonly destroy?: (() => void) | undefined;
};

export type WebGpuApiLike = {
  readonly getPreferredCanvasFormat?: (() => string) | undefined;
  readonly requestAdapter: (options?: {
    readonly forceFallbackAdapter?: boolean | undefined;
    readonly powerPreference?: WebGpuPowerPreference | undefined;
  }) => Promise<WebGpuAdapterLike | null>;
};

export type NavigatorGpuLike = {
  readonly gpu?: WebGpuApiLike | undefined;
};

export type WebGpuCapabilityProbe = {
  readonly kind: "webgpu_capability_probe";
  readonly adapterStatus: "available" | "unavailable";
  readonly deviceStatus: "available" | "not-requested" | "unavailable";
  readonly diagnostics: readonly RendererBackendDiagnostic[];
  readonly features: ReadonlySet<string>;
  readonly limits: Readonly<Record<string, number>>;
  readonly reason?: string | undefined;
  readonly royalFeatures: ReadonlySet<RoyalRendererFeature>;
};

export type WebGpuCapabilityProbeOptions = {
  readonly forceFallbackAdapter?: boolean | undefined;
  readonly gpu?: WebGpuApiLike | undefined;
  readonly navigator?: NavigatorGpuLike | undefined;
  readonly powerPreference?: WebGpuPowerPreference | undefined;
};

export type WebGpuDeviceRequestOptions = WebGpuCapabilityProbeOptions & {
  readonly label?: string | undefined;
  readonly requiredGpuFeatures?: readonly string[] | undefined;
  readonly requiredLimits?: Readonly<Record<string, number>> | undefined;
  readonly requiredRoyalFeatures?: readonly RoyalRendererFeature[] | undefined;
};

export type WebGpuDeviceRequestResult = {
  readonly probe: WebGpuCapabilityProbe;
  readonly status: "available" | "unavailable";
  readonly device?: WebGpuDeviceLike | undefined;
};

export type WebGl2ContextLike = {
  readonly getExtension?: (name: string) => unknown;
};

export type WebGl2CanvasLike = {
  readonly getContext: (
    contextId: "webgl2",
    contextAttributes?: Readonly<Record<string, unknown>>,
  ) => WebGl2ContextLike | null;
};

export type WebGl2CapabilityProbe = {
  readonly kind: "webgl2_capability_probe";
  readonly diagnostics: readonly RendererBackendDiagnostic[];
  readonly features: ReadonlySet<RoyalRendererFeature>;
  readonly reason?: string | undefined;
  readonly status: "available" | "unavailable";
};

export type WebGl2CapabilityProbeOptions = {
  readonly canvas?: WebGl2CanvasLike | undefined;
  readonly contextAttributes?: Readonly<Record<string, unknown>> | undefined;
};

export type RendererProbeSnapshot = {
  readonly webgl2: WebGl2CapabilityProbe;
  readonly webgpu: WebGpuCapabilityProbe;
};

export type RendererBackendRequest = {
  readonly backend?: WebGpuBackendMode | undefined;
  readonly fallback?: RendererFallbackPolicy | undefined;
  readonly requiredFeatures?: readonly RoyalRendererFeature[] | undefined;
};

export type RendererFeatureFallback = {
  readonly feature: RoyalRendererFeature;
  readonly policy: Exclude<RendererFallbackPolicy, "error" | "webgl2">;
  readonly reason: string;
};

export type RendererBackendChoice = {
  readonly backend: ResolvedRendererBackend | "none";
  readonly diagnostics: readonly RendererBackendDiagnostic[];
  readonly fallbackPolicy: RendererFallbackPolicy;
  readonly fallbacks: readonly RendererFeatureFallback[];
  readonly features: ReadonlySet<RoyalRendererFeature>;
  readonly missingFeatures: readonly RoyalRendererFeature[];
  readonly status: RendererBackendStatus;
};

export const WEBGPU_BASELINE_FEATURES: ReadonlySet<RoyalRendererFeature> = new Set([
  "compute-pass",
  "indexed-geometry",
  "instancing",
  "readback-buffer",
  "storage-buffer",
  "texture-asset",
  "uint32-indices"
]);

export const WEBGL2_BASELINE_FEATURES: ReadonlySet<RoyalRendererFeature> = new Set([
  "indexed-geometry",
  "instancing",
  "readback-buffer",
  "texture-asset",
  "uint32-indices"
]);

const webGpuFeatureGates: Readonly<Record<string, RoyalRendererFeature>> = {
  "texture-compression-astc": "texture-compression-astc",
  "texture-compression-bc": "texture-compression-bc",
  "texture-compression-etc2": "texture-compression-etc2",
  "timestamp-query": "timestamp-query"
};

const royalFeatureGpuGate: Readonly<Partial<Record<RoyalRendererFeature, string>>> = {
  "texture-compression-astc": "texture-compression-astc",
  "texture-compression-bc": "texture-compression-bc",
  "texture-compression-etc2": "texture-compression-etc2",
  "timestamp-query": "timestamp-query"
};

export const probeWebGpuCapabilities = async (
  options: WebGpuCapabilityProbeOptions = {},
): Promise<WebGpuCapabilityProbe> => {
  const gpu = resolveGpu(options);

  if (gpu === undefined) {
    return unavailableWebGpuProbe("navigator.gpu is unavailable");
  }

  let adapter: WebGpuAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter(adapterOptions(options));
  } catch (error) {
    return unavailableWebGpuProbe("navigator.gpu.requestAdapter failed", error);
  }

  if (adapter === null) {
    return unavailableWebGpuProbe("navigator.gpu.requestAdapter returned null");
  }

  const features = new Set(adapter.features ?? []);

  return {
    adapterStatus: "available",
    deviceStatus: "not-requested",
    diagnostics: [],
    features,
    kind: "webgpu_capability_probe",
    limits: numericLimits(adapter.limits),
    royalFeatures: royalFeaturesFromWebGpu(features)
  };
};

export const requestWebGpuDevice = async (
  options: WebGpuDeviceRequestOptions = {},
): Promise<WebGpuDeviceRequestResult> => {
  const gpu = resolveGpu(options);

  if (gpu === undefined) {
    return unavailableDeviceResult(unavailableWebGpuProbe("navigator.gpu is unavailable"));
  }

  let adapter: WebGpuAdapterLike | null;
  try {
    adapter = await gpu.requestAdapter(adapterOptions(options));
  } catch (error) {
    return unavailableDeviceResult(unavailableWebGpuProbe("navigator.gpu.requestAdapter failed", error));
  }

  if (adapter === null) {
    return unavailableDeviceResult(unavailableWebGpuProbe("navigator.gpu.requestAdapter returned null"));
  }

  const adapterFeatures = new Set(adapter.features ?? []);
  const requiredGpuFeatures = requiredGpuFeatureNames(options);
  const missingGpuFeatures = requiredGpuFeatures.filter((feature) => !adapterFeatures.has(feature));
  const baseProbe: WebGpuCapabilityProbe = {
    adapterStatus: "available",
    deviceStatus: "not-requested",
    diagnostics: [],
    features: adapterFeatures,
    kind: "webgpu_capability_probe",
    limits: numericLimits(adapter.limits),
    royalFeatures: royalFeaturesFromWebGpu(adapterFeatures)
  };

  if (missingGpuFeatures.length > 0) {
    const diagnostics = missingGpuFeatures.map((feature): RendererBackendDiagnostic => ({
      backend: "webgpu",
      code: "feature_unavailable",
      feature: webGpuFeatureGates[feature],
      message: `WebGPU adapter is missing required GPU feature: ${feature}.`,
      severity: "error"
    }));
    return unavailableDeviceResult(withDeviceStatus(baseProbe, "unavailable", diagnostics));
  }

  if (adapter.requestDevice === undefined) {
    return unavailableDeviceResult(withDeviceStatus(baseProbe, "unavailable", [{
      backend: "webgpu",
      code: "device_request_failed",
      message: "WebGPU adapter does not expose requestDevice.",
      severity: "error"
    }]));
  }

  try {
    const device = await adapter.requestDevice(deviceDescriptor(options, requiredGpuFeatures));
    const deviceFeatures = new Set(device.features ?? adapterFeatures);
    const probe = {
      ...baseProbe,
      deviceStatus: "available",
      features: deviceFeatures,
      limits: {
        ...baseProbe.limits,
        ...numericLimits(device.limits)
      },
      royalFeatures: royalFeaturesFromWebGpu(deviceFeatures)
    } satisfies WebGpuCapabilityProbe;

    return {
      device,
      probe,
      status: "available"
    };
  } catch (error) {
    return unavailableDeviceResult(withDeviceStatus(baseProbe, "unavailable", [{
      backend: "webgpu",
      code: "device_request_failed",
      detail: error,
      message: "WebGPU adapter.requestDevice failed.",
      severity: "error"
    }]));
  }
};

export const preferredWebGpuCanvasFormat = (
  options: Pick<WebGpuCapabilityProbeOptions, "gpu" | "navigator"> = {},
): string => {
  return resolveGpu(options)?.getPreferredCanvasFormat?.() ?? "bgra8unorm";
};

export const probeWebGl2Capabilities = (
  options: WebGl2CapabilityProbeOptions = {},
): WebGl2CapabilityProbe => {
  if (options.canvas === undefined) {
    return unavailableWebGl2Probe("No canvas was provided for WebGL2 probing.");
  }

  let gl: WebGl2ContextLike | null;
  try {
    gl = options.canvas.getContext("webgl2", options.contextAttributes);
  } catch (error) {
    return unavailableWebGl2Probe("canvas.getContext(\"webgl2\") failed.", error);
  }

  if (gl === null) {
    return unavailableWebGl2Probe("canvas.getContext(\"webgl2\") returned null.");
  }

  const features = new Set(WEBGL2_BASELINE_FEATURES);
  if (hasAnyExtension(gl, ["EXT_disjoint_timer_query_webgl2"])) {
    features.add("timestamp-query");
  }
  if (hasAnyExtension(gl, ["EXT_texture_compression_bptc", "WEBGL_compressed_texture_s3tc"])) {
    features.add("texture-compression-bc");
  }
  if (hasAnyExtension(gl, ["WEBGL_compressed_texture_astc"])) {
    features.add("texture-compression-astc");
  }
  if (hasAnyExtension(gl, ["WEBGL_compressed_texture_etc"])) {
    features.add("texture-compression-etc2");
  }

  return {
    diagnostics: [],
    features,
    kind: "webgl2_capability_probe",
    status: "available"
  };
};

export const chooseRendererBackend = (
  snapshot: RendererProbeSnapshot,
  request: RendererBackendRequest = {},
): RendererBackendChoice => {
  const requestedBackend = request.backend ?? "auto";
  const fallbackPolicy = request.fallback ?? defaultFallbackPolicy(requestedBackend);
  const requiredFeatures = uniqueFeatures(request.requiredFeatures ?? []);

  if (requestedBackend === "auto") {
    const webgpuChoice = evaluateBackend("webgpu", snapshot.webgpu, requiredFeatures, fallbackPolicy);
    if (webgpuChoice.status !== "unavailable") return webgpuChoice;

    if (fallbackPolicy === "webgl2") {
      const webgl2Choice = evaluateBackend("webgl2", snapshot.webgl2, requiredFeatures, "error");
      if (webgl2Choice.status !== "unavailable") {
        return withFallbackSelected(webgl2Choice, "webgpu");
      }
    }

    return webgpuChoice;
  }

  if (requestedBackend === "webgpu") {
    const webgpuChoice = evaluateBackend("webgpu", snapshot.webgpu, requiredFeatures, fallbackPolicy);
    if (webgpuChoice.status !== "unavailable") return webgpuChoice;

    if (fallbackPolicy === "webgl2") {
      const webgl2Choice = evaluateBackend("webgl2", snapshot.webgl2, requiredFeatures, "error");
      if (webgl2Choice.status !== "unavailable") {
        return withFallbackSelected(webgl2Choice, "webgpu");
      }
    }

    return webgpuChoice;
  }

  return evaluateBackend("webgl2", snapshot.webgl2, requiredFeatures, fallbackPolicy);
};

export const royalFeaturesFromWebGpu = (
  gpuFeatures: ReadonlySet<string>,
): ReadonlySet<RoyalRendererFeature> => {
  const features = new Set(WEBGPU_BASELINE_FEATURES);
  for (const [gpuFeature, royalFeature] of Object.entries(webGpuFeatureGates)) {
    if (gpuFeatures.has(gpuFeature)) features.add(royalFeature);
  }
  return features;
};

const evaluateBackend = (
  backend: ResolvedRendererBackend,
  probe: WebGpuCapabilityProbe | WebGl2CapabilityProbe,
  requiredFeatures: readonly RoyalRendererFeature[],
  fallbackPolicy: RendererFallbackPolicy,
): RendererBackendChoice => {
  const available = backend === "webgpu"
    ? probe.kind === "webgpu_capability_probe" && probe.adapterStatus === "available"
    : probe.kind === "webgl2_capability_probe" && probe.status === "available";
  const availableFeatures = backend === "webgpu" && probe.kind === "webgpu_capability_probe"
    ? probe.royalFeatures
    : probe.features as ReadonlySet<RoyalRendererFeature>;
  const diagnostics: RendererBackendDiagnostic[] = [...probe.diagnostics];
  const missingFeatures = requiredFeatures.filter((feature) => !availableFeatures.has(feature));
  const fallbacks = missingFeatures.flatMap((feature) => {
    const fallback = resolveFeatureFallback(feature, backend, fallbackPolicy);
    return fallback === undefined ? [] : [fallback];
  });
  const unresolvedFeatures = missingFeatures.filter((feature) =>
    !fallbacks.some((fallback) => fallback.feature === feature)
  );

  if (!available) {
    diagnostics.push({
      backend,
      code: "backend_unavailable",
      message: `${backend} is unavailable.`,
      severity: "error"
    });
  }

  for (const feature of unresolvedFeatures) {
    diagnostics.push({
      backend,
      code: "feature_unavailable",
      feature,
      message: `${feature} is unavailable on ${backend}.`,
      severity: "error"
    });
  }

  if (available && fallbacks.length > 0) {
    for (const fallback of fallbacks) {
      diagnostics.push({
        backend,
        code: "fallback_selected",
        fallback: fallback.policy,
        feature: fallback.feature,
        message: fallback.reason,
        severity: "warning"
      });
    }
  }

  return {
    backend: available ? backend : "none",
    diagnostics,
    fallbackPolicy,
    fallbacks,
    features: availableFeatures,
    missingFeatures,
    status: !available || unresolvedFeatures.length > 0
      ? "unavailable"
      : fallbacks.length > 0
        ? "degraded"
        : "ready"
  };
};

const resolveFeatureFallback = (
  feature: RoyalRendererFeature,
  backend: ResolvedRendererBackend,
  fallbackPolicy: RendererFallbackPolicy,
): RendererFeatureFallback | undefined => {
  if (fallbackPolicy === "error" || fallbackPolicy === "webgl2") return undefined;

  const policy = fallbackPolicy;
  if (policy === "disable-feature") {
    return {
      feature,
      policy,
      reason: `${feature} will be disabled on ${backend}.`
    };
  }

  if (policy === "cpu" && cpuFallbackFeatures.has(feature)) {
    return {
      feature,
      policy,
      reason: `${feature} will use CPU fallback on ${backend}.`
    };
  }

  if (policy === "asset" && assetFallbackFeatures.has(feature)) {
    return {
      feature,
      policy,
      reason: `${feature} will use a baked asset fallback on ${backend}.`
    };
  }

  return undefined;
};

const cpuFallbackFeatures: ReadonlySet<RoyalRendererFeature> = new Set([
  "compute-pass",
  "readback-buffer",
  "storage-buffer",
  "timestamp-query"
]);

const assetFallbackFeatures: ReadonlySet<RoyalRendererFeature> = new Set([
  "compute-pass",
  "storage-buffer",
  "texture-asset",
  "texture-compression-astc",
  "texture-compression-bc",
  "texture-compression-etc2"
]);

const defaultFallbackPolicy = (backend: WebGpuBackendMode): RendererFallbackPolicy => {
  return backend === "auto" ? "webgl2" : "error";
};

const withFallbackSelected = (
  choice: RendererBackendChoice,
  fromBackend: ResolvedRendererBackend,
): RendererBackendChoice => ({
  ...choice,
  diagnostics: [
    {
      ...(choice.backend === "none" ? {} : { backend: choice.backend }),
      code: "fallback_selected",
      fallback: "webgl2",
      message: `Selected WebGL2 because ${fromBackend} was unavailable or missing required features.`,
      severity: "warning"
    },
    ...choice.diagnostics
  ],
  fallbackPolicy: "webgl2"
});

const resolveGpu = (
  options: Pick<WebGpuCapabilityProbeOptions, "gpu" | "navigator">,
): WebGpuApiLike | undefined => {
  return options.gpu ?? options.navigator?.gpu ?? globalNavigator()?.gpu;
};

const globalNavigator = (): NavigatorGpuLike | undefined => {
  return (globalThis as { readonly navigator?: NavigatorGpuLike }).navigator;
};

const adapterOptions = (
  options: Pick<WebGpuCapabilityProbeOptions, "forceFallbackAdapter" | "powerPreference">,
): { readonly forceFallbackAdapter?: boolean; readonly powerPreference?: WebGpuPowerPreference } | undefined => {
  const request: { forceFallbackAdapter?: boolean; powerPreference?: WebGpuPowerPreference } = {};
  if (options.forceFallbackAdapter !== undefined) request.forceFallbackAdapter = options.forceFallbackAdapter;
  if (options.powerPreference !== undefined) request.powerPreference = options.powerPreference;
  return Object.keys(request).length === 0 ? undefined : request;
};

const deviceDescriptor = (
  options: WebGpuDeviceRequestOptions,
  requiredGpuFeatures: readonly string[],
): WebGpuDeviceDescriptorLike | undefined => {
  const descriptor: {
    label?: string;
    requiredFeatures?: readonly string[];
    requiredLimits?: Readonly<Record<string, number>>;
  } = {};
  if (options.label !== undefined) descriptor.label = options.label;
  if (requiredGpuFeatures.length > 0) descriptor.requiredFeatures = requiredGpuFeatures;
  if (options.requiredLimits !== undefined) descriptor.requiredLimits = options.requiredLimits;
  return Object.keys(descriptor).length === 0 ? undefined : descriptor;
};

const requiredGpuFeatureNames = (
  options: Pick<WebGpuDeviceRequestOptions, "requiredGpuFeatures" | "requiredRoyalFeatures">,
): readonly string[] => {
  return [...new Set([
    ...(options.requiredGpuFeatures ?? []),
    ...(options.requiredRoyalFeatures ?? []).flatMap((feature) => {
      const gpuFeature = royalFeatureGpuGate[feature];
      return gpuFeature === undefined ? [] : [gpuFeature];
    })
  ])].sort();
};

const numericLimits = (limits: object | undefined): Readonly<Record<string, number>> => {
  if (limits === undefined) return {};

  return Object.fromEntries(
    Object.entries(limits as Record<string, unknown>).filter((entry): entry is [string, number] => {
      const value = entry[1];
      return typeof value === "number" && Number.isFinite(value);
    })
  );
};

const hasAnyExtension = (
  gl: WebGl2ContextLike,
  names: readonly string[],
): boolean => {
  return names.some((name) => gl.getExtension?.(name) != null);
};

const unavailableWebGpuProbe = (
  reason: string,
  detail?: unknown,
): WebGpuCapabilityProbe => ({
  adapterStatus: "unavailable",
  deviceStatus: "not-requested",
  diagnostics: [{
    backend: "webgpu",
    code: detail === undefined ? "backend_unavailable" : "probe_failed",
    ...(detail === undefined ? {} : { detail }),
    message: reason,
    severity: "error"
  }],
  features: new Set(),
  kind: "webgpu_capability_probe",
  limits: {},
  reason,
  royalFeatures: new Set()
});

const unavailableWebGl2Probe = (
  reason: string,
  detail?: unknown,
): WebGl2CapabilityProbe => ({
  diagnostics: [{
    backend: "webgl2",
    code: detail === undefined ? "backend_unavailable" : "probe_failed",
    ...(detail === undefined ? {} : { detail }),
    message: reason,
    severity: "error"
  }],
  features: new Set(),
  kind: "webgl2_capability_probe",
  reason,
  status: "unavailable"
});

const unavailableDeviceResult = (
  probe: WebGpuCapabilityProbe,
): WebGpuDeviceRequestResult => ({
  probe,
  status: "unavailable"
});

const withDeviceStatus = (
  probe: WebGpuCapabilityProbe,
  deviceStatus: WebGpuCapabilityProbe["deviceStatus"],
  diagnostics: readonly RendererBackendDiagnostic[],
): WebGpuCapabilityProbe => ({
  ...probe,
  deviceStatus,
  diagnostics: [...probe.diagnostics, ...diagnostics]
});

const uniqueFeatures = (
  features: readonly RoyalRendererFeature[],
): readonly RoyalRendererFeature[] => {
  return [...new Set(features)].sort();
};
