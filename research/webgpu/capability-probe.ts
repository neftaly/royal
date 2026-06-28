export type RoyalBackendMode = "webgl" | "webgpu" | "auto";

export type RoyalResolvedBackend = "webgl" | "webgpu";

export type RoyalFeatureRequirement =
  | "indexed-geometry"
  | "uint32-indices"
  | "instancing"
  | "compute-pass"
  | "storage-buffer"
  | "timestamp-query"
  | "texture-compression-bc"
  | "texture-compression-astc"
  | "texture-compression-etc2";

export type RoyalFallbackPolicy =
  | "error"
  | "webgl"
  | "disable-feature"
  | "cpu"
  | "asset";

export type RoyalBackendRequest = {
  readonly backend?: RoyalBackendMode;
  readonly fallback?: RoyalFallbackPolicy;
  readonly requiredFeatures?: readonly RoyalFeatureRequirement[];
};

export type RoyalCapabilityDiagnostic = {
  readonly code:
    | "backend_unavailable"
    | "feature_unavailable"
    | "fallback_selected";
  readonly message: string;
  readonly backend?: RoyalBackendMode | RoyalResolvedBackend;
  readonly feature?: RoyalFeatureRequirement;
};

export type RoyalWebGpuProbe = {
  readonly available: boolean;
  readonly features: ReadonlySet<string>;
  readonly limits: Readonly<Record<string, number>>;
  readonly reason?: string;
};

export type RoyalWebGlProbe = {
  readonly available: boolean;
  readonly version: 2 | "unknown";
  readonly features: ReadonlySet<RoyalFeatureRequirement>;
  readonly reason?: string;
};

export type RoyalGpuProbe = {
  readonly webgl: RoyalWebGlProbe;
  readonly webgpu: RoyalWebGpuProbe;
};

export type RoyalBackendChoice = {
  readonly backend: RoyalResolvedBackend;
  readonly diagnostics: readonly RoyalCapabilityDiagnostic[];
  readonly features: ReadonlySet<RoyalFeatureRequirement>;
};

type GpuAdapterLike = {
  readonly features?: Iterable<string>;
  readonly limits?: object;
};

type NavigatorWithGpu = Navigator & {
  readonly gpu?: {
    readonly requestAdapter: (options?: {
      readonly powerPreference?: "low-power" | "high-performance";
    }) => Promise<GpuAdapterLike | null>;
  };
};

export const probeRoyalGpuCapabilities = async (input: {
  readonly canvas?: HTMLCanvasElement;
  readonly navigator?: NavigatorWithGpu;
  readonly powerPreference?: "low-power" | "high-performance";
} = {}): Promise<RoyalGpuProbe> => {
  const nav = input.navigator ?? (globalThis.navigator as NavigatorWithGpu | undefined);

  return {
    webgl: probeWebGl(input.canvas),
    webgpu: await probeWebGpu(nav, input.powerPreference),
  };
};

export const chooseRoyalBackend = (
  probe: RoyalGpuProbe,
  request: RoyalBackendRequest = {},
): RoyalBackendChoice => {
  const backend = request.backend ?? "auto";
  const requiredFeatures = request.requiredFeatures ?? [];
  const diagnostics: RoyalCapabilityDiagnostic[] = [];

  if (backend === "webgpu") {
    return requireBackend("webgpu", probe, requiredFeatures, diagnostics);
  }

  if (backend === "webgl") {
    return requireBackend("webgl", probe, requiredFeatures, diagnostics);
  }

  if (probe.webgpu.available) {
    const webgpu = requireBackend("webgpu", probe, requiredFeatures, diagnostics);
    if (webgpu.diagnostics.every((diagnostic) => diagnostic.code !== "feature_unavailable")) {
      return webgpu;
    }
  }

  if (probe.webgl.available && request.fallback !== "error") {
    diagnostics.push({
      backend: "webgl",
      code: "fallback_selected",
      message: "Selected WebGL because WebGPU was unavailable or missing required features.",
    });
    return requireBackend("webgl", probe, requiredFeatures, diagnostics);
  }

  return requireBackend("webgpu", probe, requiredFeatures, diagnostics);
};

const probeWebGpu = async (
  nav: NavigatorWithGpu | undefined,
  powerPreference: "low-power" | "high-performance" | undefined,
): Promise<RoyalWebGpuProbe> => {
  if (nav?.gpu === undefined) {
    return {
      available: false,
      features: new Set(),
      limits: {},
      reason: "navigator.gpu is unavailable",
    };
  }

  const adapter = await nav.gpu.requestAdapter(
    powerPreference === undefined ? undefined : { powerPreference },
  );
  if (adapter === null) {
    return {
      available: false,
      features: new Set(),
      limits: {},
      reason: "requestAdapter returned null",
    };
  }

  return {
    available: true,
    features: new Set(adapter.features ?? []),
    limits: numericLimits(adapter.limits),
  };
};

const probeWebGl = (canvas: HTMLCanvasElement | undefined): RoyalWebGlProbe => {
  if (canvas === undefined) {
    return {
      available: false,
      features: new Set(),
      reason: "No canvas was provided for WebGL probing.",
      version: "unknown",
    };
  }

  const gl2 = canvas.getContext("webgl2");
  if (gl2 === null) {
    return {
      available: false,
      features: new Set(),
      reason: "WebGL2 context creation returned null. Royal does not support WebGL1.",
      version: "unknown",
    };
  }

  return {
    available: true,
    features: new Set(["indexed-geometry", "uint32-indices", "instancing"]),
    version: 2,
  };
};

const requireBackend = (
  backend: RoyalResolvedBackend,
  probe: RoyalGpuProbe,
  requiredFeatures: readonly RoyalFeatureRequirement[],
  diagnostics: RoyalCapabilityDiagnostic[],
): RoyalBackendChoice => {
  const backendProbe = backend === "webgpu" ? probe.webgpu : probe.webgl;
  const availableFeatures = backend === "webgpu"
    ? royalFeaturesFromWebGpu(probe.webgpu)
    : probe.webgl.features;

  if (!backendProbe.available) {
    diagnostics.push({
      backend,
      code: "backend_unavailable",
      message: `${backend} is unavailable.`,
    });
  }

  for (const feature of requiredFeatures) {
    if (!availableFeatures.has(feature)) {
      diagnostics.push({
        backend,
        code: "feature_unavailable",
        feature,
        message: `${feature} is unavailable on ${backend}.`,
      });
    }
  }

  return {
    backend,
    diagnostics,
    features: availableFeatures,
  };
};

const royalFeaturesFromWebGpu = (
  webgpu: RoyalWebGpuProbe,
): ReadonlySet<RoyalFeatureRequirement> => {
  const features = new Set<RoyalFeatureRequirement>([
    "indexed-geometry",
    "uint32-indices",
    "instancing",
    "compute-pass",
    "storage-buffer",
  ]);

  if (webgpu.features.has("timestamp-query")) {
    features.add("timestamp-query");
  }
  if (webgpu.features.has("texture-compression-bc")) {
    features.add("texture-compression-bc");
  }
  if (webgpu.features.has("texture-compression-astc")) {
    features.add("texture-compression-astc");
  }
  if (webgpu.features.has("texture-compression-etc2")) {
    features.add("texture-compression-etc2");
  }

  return features;
};

const numericLimits = (limits: object | undefined): Readonly<Record<string, number>> => {
  if (limits === undefined) return {};

  return Object.fromEntries(
    Object.entries(limits).filter((entry): entry is [string, number] => {
      const value = entry[1];
      return typeof value === "number" && Number.isFinite(value);
    }),
  );
};
