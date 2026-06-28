export type WebGlContextVersion = 1 | 2 | "unknown";

export type RendererCapabilityName =
  | "webgl"
  | "webgl2"
  | "webgpu"
  | "draw_buffers"
  | "depth_texture"
  | "instancing"
  | "gpu_timer_query"
  | "anisotropy"
  | "float_texture"
  | "half_float_texture"
  | "compressed_texture"
  | "lose_context";

export type RendererCapabilitySource =
  | "webgl-core"
  | "webgl2-core"
  | "webgl-extension"
  | "webgpu-probe"
  | "unprobed"
  | "missing";

export type RendererCapabilityRow = {
  readonly kind: "renderer_capability";
  readonly capability: RendererCapabilityName;
  readonly supported: boolean;
  readonly source: RendererCapabilitySource;
  readonly extension?: string | undefined;
  readonly detail?: string | undefined;
};

export type WebGlExtensionRow = {
  readonly kind: "webgl_extension";
  readonly name: string;
  readonly supported: true;
};

export type GpuTimerQuerySupportRow = {
  readonly kind: "gpu_timer_query_support";
  readonly supported: boolean;
  readonly extension?: string | undefined;
  readonly queryApi: "webgl2" | "webgl1-extension" | "none";
};

export type CompressedTextureFormatRow = {
  readonly kind: "compressed_texture_format";
  readonly family: CompressedTextureFamily;
  readonly extension: string;
  readonly format: string;
  readonly value?: number | undefined;
};

export type TextureLimitRow = {
  readonly kind: "max_texture_size" | "max_texture_units";
  readonly value: number;
  readonly scope?: "fragment" | "combined" | undefined;
};

export type ContextVersionRow = {
  readonly kind: "context_version";
  readonly api: "webgl";
  readonly version: WebGlContextVersion;
  readonly versionLabel?: string | undefined;
  readonly shadingLanguageVersion?: string | undefined;
  readonly vendor?: string | undefined;
  readonly renderer?: string | undefined;
};

export type WebGpuFeatureGateRow = {
  readonly kind: "webgpu_feature_gate";
  readonly feature: string;
  readonly supported: boolean;
};

export type WebGpuLimitRow = {
  readonly kind: "webgpu_limit";
  readonly name: string;
  readonly value: number;
};

export type RendererCapabilityProbeRow =
  | RendererCapabilityRow
  | WebGlExtensionRow
  | GpuTimerQuerySupportRow
  | CompressedTextureFormatRow
  | TextureLimitRow
  | ContextVersionRow
  | WebGpuFeatureGateRow
  | WebGpuLimitRow;

export type RendererCapabilityDiagnostic = {
  readonly code: "renderer_capability_missing" | "webgl_probe_error" | "webgpu_unavailable";
  readonly severity: "info" | "warning";
  readonly message: string;
  readonly relation:
    | "renderer_capability"
    | "webgl_extension"
    | "max_texture_size"
    | "max_texture_units"
    | "context_version";
  readonly field?: string | undefined;
  readonly key?: string | undefined;
  readonly detail?: unknown;
};

export type WebGlLikeContext = {
  readonly VERSION?: number;
  readonly SHADING_LANGUAGE_VERSION?: number;
  readonly VENDOR?: number;
  readonly RENDERER?: number;
  readonly MAX_TEXTURE_SIZE?: number;
  readonly MAX_TEXTURE_IMAGE_UNITS?: number;
  readonly MAX_COMBINED_TEXTURE_IMAGE_UNITS?: number;
  readonly COMPRESSED_TEXTURE_FORMATS?: number;
  readonly READ_BUFFER?: number;
  readonly TEXTURE_3D?: number;
  readonly getSupportedExtensions?: () => readonly string[] | null;
  readonly getExtension?: (name: string) => unknown;
  readonly getParameter?: (name: number) => unknown;
  readonly texStorage2D?: unknown;
  readonly drawBuffers?: unknown;
  readonly vertexAttribDivisor?: unknown;
  readonly beginQuery?: unknown;
};

export type WebGpuProbeInput = {
  readonly status: "available" | "unavailable" | "unknown";
  readonly reason?: string | undefined;
  readonly features?: readonly string[];
  readonly limits?: Readonly<Record<string, number>>;
};

export type RendererCapabilityProbeOptions = {
  readonly contextVersion?: 1 | 2;
  readonly webgpu?: WebGpuProbeInput;
  readonly includeMissingDiagnostics?: boolean;
};

export type RendererCapabilityProbeResult = {
  readonly rows: readonly RendererCapabilityProbeRow[];
  readonly diagnostics: readonly RendererCapabilityDiagnostic[];
};

type ExtensionProbe = {
  readonly name: string;
  readonly object: unknown;
};

type CapabilityProbe = {
  readonly capability: RendererCapabilityName;
  readonly supported: boolean;
  readonly source: RendererCapabilitySource;
  readonly extension?: string | undefined;
  readonly detail?: string | undefined;
};

type CompressedTextureFamily =
  | "astc"
  | "bptc"
  | "etc"
  | "etc1"
  | "pvrtc"
  | "s3tc"
  | "s3tc_srgb"
  | "unknown";

const wishlistCapabilities: readonly RendererCapabilityName[] = [
  "webgl",
  "webgl2",
  "webgpu",
  "draw_buffers",
  "depth_texture",
  "instancing",
  "gpu_timer_query",
  "anisotropy",
  "float_texture",
  "half_float_texture",
  "compressed_texture",
  "lose_context",
];

const compressedTextureExtensions = new Map<string, CompressedTextureFamily>([
  ["WEBGL_compressed_texture_astc", "astc"],
  ["EXT_texture_compression_bptc", "bptc"],
  ["WEBGL_compressed_texture_etc", "etc"],
  ["WEBGL_compressed_texture_etc1", "etc1"],
  ["WEBGL_compressed_texture_pvrtc", "pvrtc"],
  ["WEBKIT_WEBGL_compressed_texture_pvrtc", "pvrtc"],
  ["WEBGL_compressed_texture_s3tc", "s3tc"],
  ["WEBGL_compressed_texture_s3tc_srgb", "s3tc_srgb"],
]);

/**
 * Prototype probe rows for Royal renderer startup.
 *
 * Future tarstate mapping:
 * - renderer_capability rows become renderer startup facts and missing-gate diagnostics.
 * - webgl_extension rows explain why a gate is enabled through core WebGL2 or an extension.
 * - max_texture_size/max_texture_units rows feed texture atlas and text-cache budget diagnostics.
 * - compressed_texture_format rows explain portable asset-format choices.
 * - gpu_timer_query_support rows gate profile:gpu timing rows without coupling probes to draws.
 */
export const collectRendererCapabilityRows = (
  gl: WebGlLikeContext,
  options: RendererCapabilityProbeOptions = {},
): RendererCapabilityProbeResult => {
  const diagnostics: RendererCapabilityDiagnostic[] = [];
  const extensionCache = createExtensionCache(gl, diagnostics);
  const version = options.contextVersion ?? inferContextVersion(gl);
  const timerQuery = timerQuerySupport(version, extensionCache);
  const compressedRows = compressedTextureRows(gl, extensionCache, diagnostics);
  const capabilities = capabilityProbes(version, extensionCache, timerQuery, compressedRows, options.webgpu);
  const rows: RendererCapabilityProbeRow[] = [
    contextVersionRow(gl, version, diagnostics),
    ...textureLimitRows(gl, diagnostics),
    ...capabilities.map(capabilityRow),
    ...extensionCache.extensionRows(),
    timerQueryRow(timerQuery),
    ...compressedRows,
    ...webGpuRows(options.webgpu),
  ];

  if (options.includeMissingDiagnostics ?? true) {
    diagnostics.push(...missingCapabilityDiagnostics(capabilities, options.webgpu));
  }

  return {
    diagnostics: diagnostics.sort(compareDiagnostics),
    rows,
  };
};

const createExtensionCache = (
  gl: WebGlLikeContext,
  diagnostics: RendererCapabilityDiagnostic[],
): {
  readonly find: (names: readonly string[]) => ExtensionProbe | undefined;
  readonly extensionRows: () => readonly WebGlExtensionRow[];
} => {
  const supportedNames = new Set<string>();
  const objects = new Map<string, unknown>();

  try {
    for (const name of gl.getSupportedExtensions?.() ?? []) {
      supportedNames.add(name);
    }
  } catch (error) {
    diagnostics.push(probeError("webgl_extension", "getSupportedExtensions failed", error));
  }

  const load = (name: string): ExtensionProbe | undefined => {
    if (objects.has(name)) {
      return { name, object: objects.get(name) };
    }

    if (!supportedNames.has(name) && gl.getSupportedExtensions !== undefined) {
      return undefined;
    }

    try {
      const object = gl.getExtension?.(name) ?? null;
      if (object === null) return undefined;
      supportedNames.add(name);
      objects.set(name, object);
      return { name, object };
    } catch (error) {
      diagnostics.push(probeError("webgl_extension", `getExtension(${name}) failed`, error, name));
      return undefined;
    }
  };

  return {
    extensionRows: () => Array.from(supportedNames)
      .sort(compareStrings)
      .map((name) => ({ kind: "webgl_extension", name, supported: true })),
    find: (names) => {
      for (const name of names) {
        const extension = load(name);
        if (extension !== undefined) return extension;
      }
      return undefined;
    },
  };
};

const inferContextVersion = (gl: WebGlLikeContext): WebGlContextVersion => {
  const versionLabel = stringParameter(gl, gl.VERSION);
  if (versionLabel?.includes("WebGL 2") === true) return 2;

  if (
    gl.READ_BUFFER !== undefined
    || gl.TEXTURE_3D !== undefined
    || gl.texStorage2D !== undefined
    || gl.drawBuffers !== undefined
    || gl.beginQuery !== undefined
  ) {
    return 2;
  }

  return versionLabel === undefined ? "unknown" : 1;
};

const contextVersionRow = (
  gl: WebGlLikeContext,
  version: WebGlContextVersion,
  diagnostics: RendererCapabilityDiagnostic[],
): ContextVersionRow => {
  return {
    api: "webgl",
    kind: "context_version",
    renderer: stringParameter(gl, gl.RENDERER, diagnostics, "renderer"),
    shadingLanguageVersion: stringParameter(gl, gl.SHADING_LANGUAGE_VERSION, diagnostics, "shadingLanguageVersion"),
    vendor: stringParameter(gl, gl.VENDOR, diagnostics, "vendor"),
    version,
    versionLabel: stringParameter(gl, gl.VERSION, diagnostics, "versionLabel"),
  };
};

const textureLimitRows = (
  gl: WebGlLikeContext,
  diagnostics: RendererCapabilityDiagnostic[],
): readonly TextureLimitRow[] => {
  const rows: TextureLimitRow[] = [];
  const maxTextureSize = numberParameter(gl, gl.MAX_TEXTURE_SIZE, diagnostics, "max_texture_size");
  const fragmentUnits = numberParameter(gl, gl.MAX_TEXTURE_IMAGE_UNITS, diagnostics, "max_texture_units");
  const combinedUnits = numberParameter(gl, gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS, diagnostics, "max_texture_units");

  if (maxTextureSize !== undefined) {
    rows.push({ kind: "max_texture_size", value: maxTextureSize });
  }
  if (fragmentUnits !== undefined) {
    rows.push({ kind: "max_texture_units", scope: "fragment", value: fragmentUnits });
  }
  if (combinedUnits !== undefined) {
    rows.push({ kind: "max_texture_units", scope: "combined", value: combinedUnits });
  }

  return rows;
};

const capabilityProbes = (
  version: WebGlContextVersion,
  extensions: ReturnType<typeof createExtensionCache>,
  timerQuery: ExtensionProbe | undefined,
  compressedRows: readonly CompressedTextureFormatRow[],
  webgpu: WebGpuProbeInput | undefined,
): readonly CapabilityProbe[] => {
  const isWebGl2 = version === 2;
  const drawBuffers = extensionCapability(
    "draw_buffers",
    isWebGl2,
    extensions.find(["WEBGL_draw_buffers"]),
    "webgl2-core",
  );
  const depthTexture = extensionCapability(
    "depth_texture",
    isWebGl2,
    extensions.find(["WEBGL_depth_texture"]),
    "webgl2-core",
  );
  const instancing = extensionCapability(
    "instancing",
    isWebGl2,
    extensions.find(["ANGLE_instanced_arrays"]),
    "webgl2-core",
  );
  const anisotropy = extensionCapability("anisotropy", false, extensions.find([
    "EXT_texture_filter_anisotropic",
    "MOZ_EXT_texture_filter_anisotropic",
    "WEBKIT_EXT_texture_filter_anisotropic",
  ]));
  const floatTexture = extensionCapability("float_texture", isWebGl2, extensions.find([
    "OES_texture_float",
    "EXT_color_buffer_float",
  ]), "webgl2-core");
  const halfFloatTexture = extensionCapability("half_float_texture", isWebGl2, extensions.find([
    "OES_texture_half_float",
    "EXT_color_buffer_half_float",
  ]), "webgl2-core");
  const compressedTexture = compressedRows.length > 0
    ? supportedCapability("compressed_texture", "webgl-extension", compressedRows[0]?.extension)
    : missingCapability("compressed_texture");
  const loseContext = extensionCapability("lose_context", false, extensions.find(["WEBGL_lose_context"]));

  return wishlistCapabilities.map((capability) => {
    switch (capability) {
      case "webgl":
        return supportedCapability("webgl", "webgl-core");
      case "webgl2":
        return isWebGl2
          ? supportedCapability("webgl2", "webgl2-core")
          : missingCapability("webgl2", version === "unknown" ? "context version was not reported" : undefined);
      case "webgpu":
        return webGpuCapability(webgpu);
      case "draw_buffers":
        return drawBuffers;
      case "depth_texture":
        return depthTexture;
      case "instancing":
        return instancing;
      case "gpu_timer_query":
        return timerQuery === undefined
          ? missingCapability("gpu_timer_query")
          : supportedCapability("gpu_timer_query", "webgl-extension", timerQuery.name);
      case "anisotropy":
        return anisotropy;
      case "float_texture":
        return floatTexture;
      case "half_float_texture":
        return halfFloatTexture;
      case "compressed_texture":
        return compressedTexture;
      case "lose_context":
        return loseContext;
    }
  });
};

const extensionCapability = (
  capability: RendererCapabilityName,
  webGl2Core: boolean,
  extension: ExtensionProbe | undefined,
  webGl2Source: RendererCapabilitySource = "webgl2-core",
): CapabilityProbe => {
  if (webGl2Core) return supportedCapability(capability, webGl2Source);
  if (extension !== undefined) return supportedCapability(capability, "webgl-extension", extension.name);
  return missingCapability(capability);
};

const webGpuCapability = (webgpu: WebGpuProbeInput | undefined): CapabilityProbe => {
  if (webgpu === undefined) {
    return {
      capability: "webgpu",
      detail: "not probed by this WebGL collector",
      source: "unprobed",
      supported: false,
    };
  }
  if (webgpu.status === "available") {
    return {
      capability: "webgpu",
      detail: webgpu.reason,
      source: "webgpu-probe",
      supported: true,
    };
  }
  return {
    capability: "webgpu",
    detail: webgpu.reason,
    source: "missing",
    supported: false,
  };
};

const supportedCapability = (
  capability: RendererCapabilityName,
  source: RendererCapabilitySource,
  extension?: string,
): CapabilityProbe => {
  return {
    capability,
    extension,
    source,
    supported: true,
  };
};

const missingCapability = (capability: RendererCapabilityName, detail?: string): CapabilityProbe => {
  return {
    capability,
    detail,
    source: "missing",
    supported: false,
  };
};

const capabilityRow = (capability: CapabilityProbe): RendererCapabilityRow => {
  return {
    capability: capability.capability,
    detail: capability.detail,
    extension: capability.extension,
    kind: "renderer_capability",
    source: capability.source,
    supported: capability.supported,
  };
};

const timerQuerySupport = (
  version: WebGlContextVersion,
  extensions: ReturnType<typeof createExtensionCache>,
): ExtensionProbe | undefined => {
  if (version === 2) {
    return extensions.find(["EXT_disjoint_timer_query_webgl2", "EXT_disjoint_timer_query"]);
  }
  return extensions.find(["EXT_disjoint_timer_query"]);
};

const timerQueryRow = (timerQuery: ExtensionProbe | undefined): GpuTimerQuerySupportRow => {
  if (timerQuery === undefined) {
    return { kind: "gpu_timer_query_support", queryApi: "none", supported: false };
  }

  return {
    extension: timerQuery.name,
    kind: "gpu_timer_query_support",
    queryApi: timerQuery.name === "EXT_disjoint_timer_query_webgl2" ? "webgl2" : "webgl1-extension",
    supported: true,
  };
};

const compressedTextureRows = (
  gl: WebGlLikeContext,
  extensions: ReturnType<typeof createExtensionCache>,
  diagnostics: RendererCapabilityDiagnostic[],
): readonly CompressedTextureFormatRow[] => {
  const rows: CompressedTextureFormatRow[] = [];

  for (const [extensionName, family] of compressedTextureExtensions) {
    const extension = extensions.find([extensionName]);
    if (extension === undefined) continue;

    const formatRows = compressedFormatConstants(extensionName, family, extension.object);
    if (formatRows.length === 0) {
      rows.push({
        extension: extensionName,
        family,
        format: "extension_supported",
        kind: "compressed_texture_format",
      });
    } else {
      rows.push(...formatRows);
    }
  }

  const reportedFormats = numericArrayParameter(gl, gl.COMPRESSED_TEXTURE_FORMATS, diagnostics, "compressed_texture_format");
  for (const value of reportedFormats) {
    const alreadyNamed = rows.some((row) => row.value === value);
    if (!alreadyNamed) {
      rows.push({
        extension: "webgl_reported",
        family: "unknown",
        format: `0x${value.toString(16)}`,
        kind: "compressed_texture_format",
        value,
      });
    }
  }

  return rows.sort((left, right) =>
    compareStrings(left.family, right.family)
    || compareStrings(left.extension, right.extension)
    || compareStrings(left.format, right.format)
  );
};

const compressedFormatConstants = (
  extension: string,
  family: CompressedTextureFamily,
  object: unknown,
): readonly CompressedTextureFormatRow[] => {
  if (object === null || typeof object !== "object") return [];

  return Object.entries(object as Readonly<Record<string, unknown>>)
    .filter(([name, value]) => name.startsWith("COMPRESSED_") && typeof value === "number" && Number.isFinite(value))
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([format, value]) => ({
      extension,
      family,
      format,
      kind: "compressed_texture_format",
      value: value as number,
    }));
};

const webGpuRows = (webgpu: WebGpuProbeInput | undefined): readonly (WebGpuFeatureGateRow | WebGpuLimitRow)[] => {
  if (webgpu === undefined) return [];

  return [
    ...(webgpu.features ?? []).slice().sort(compareStrings).map((feature) => ({
      feature,
      kind: "webgpu_feature_gate" as const,
      supported: webgpu.status === "available",
    })),
    ...Object.entries(webgpu.limits ?? {})
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([name, value]) => ({ kind: "webgpu_limit" as const, name, value })),
  ];
};

const missingCapabilityDiagnostics = (
  capabilities: readonly CapabilityProbe[],
  webgpu: WebGpuProbeInput | undefined,
): readonly RendererCapabilityDiagnostic[] => {
  return capabilities
    .filter((capability) =>
      !capability.supported
      && capability.source !== "unprobed"
      && (capability.capability !== "webgpu" || webgpu?.status === "unavailable")
    )
    .map((capability) => ({
      code: capability.capability === "webgpu" ? "webgpu_unavailable" : "renderer_capability_missing",
      detail: capability.detail,
      field: "capability",
      key: capability.capability,
      message: `${capability.capability} is not available`,
      relation: "renderer_capability",
      severity: "info",
    }));
};

const stringParameter = (
  gl: WebGlLikeContext,
  parameter: number | undefined,
  diagnostics?: RendererCapabilityDiagnostic[],
  field?: string,
): string | undefined => {
  if (parameter === undefined) return undefined;

  try {
    const value = gl.getParameter?.(parameter);
    return typeof value === "string" ? value : undefined;
  } catch (error) {
    diagnostics?.push(probeError("context_version", "getParameter failed", error, field));
    return undefined;
  }
};

const numberParameter = (
  gl: WebGlLikeContext,
  parameter: number | undefined,
  diagnostics: RendererCapabilityDiagnostic[],
  relation: "max_texture_size" | "max_texture_units",
): number | undefined => {
  if (parameter === undefined) return undefined;

  try {
    const value = gl.getParameter?.(parameter);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return undefined;
  } catch (error) {
    diagnostics.push(probeError(relation, "getParameter failed", error));
    return undefined;
  }
};

const numericArrayParameter = (
  gl: WebGlLikeContext,
  parameter: number | undefined,
  diagnostics: RendererCapabilityDiagnostic[],
  field: string,
): readonly number[] => {
  if (parameter === undefined) return [];

  try {
    const value = gl.getParameter?.(parameter);
    if (Array.isArray(value)) {
      return value.filter(isFiniteNumber).sort(compareNumbers);
    }
    if (ArrayBuffer.isView(value) && "length" in value) {
      return Array.from(value as unknown as ArrayLike<unknown>).filter(isFiniteNumber).sort(compareNumbers);
    }
    return [];
  } catch (error) {
    diagnostics.push(probeError("webgl_extension", "getParameter failed", error, field));
    return [];
  }
};

const probeError = (
  relation: RendererCapabilityDiagnostic["relation"],
  message: string,
  error: unknown,
  key?: string,
): RendererCapabilityDiagnostic => {
  return {
    code: "webgl_probe_error",
    detail: error instanceof Error ? error.message : error,
    key,
    message,
    relation,
    severity: "warning",
  };
};

const compareDiagnostics = (
  left: RendererCapabilityDiagnostic,
  right: RendererCapabilityDiagnostic,
): number => {
  return compareStrings(left.relation, right.relation)
    || compareStrings(left.key ?? "", right.key ?? "")
    || compareStrings(left.code, right.code)
    || compareStrings(left.message, right.message);
};

const compareStrings = (left: string, right: string): number => {
  return left.localeCompare(right);
};

const compareNumbers = (left: number, right: number): number => {
  return left - right;
};

const isFiniteNumber = (value: unknown): value is number => {
  return typeof value === "number" && Number.isFinite(value);
};
