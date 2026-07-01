export type WebGlContextVersion = 1 | 2 | "unknown";

export type RendererCapabilityName =
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
  | "webgl2-core"
  | "webgl-extension"
  | "webgpu-probe"
  | "stub"
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
  readonly queryApi: "webgl2" | "none";
};

export type CompressedTextureFamily =
  | "astc"
  | "bptc"
  | "etc"
  | "etc1"
  | "pvrtc"
  | "s3tc"
  | "s3tc_srgb"
  | "unknown";

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
  readonly api: "stub" | "webgl";
  readonly version: WebGlContextVersion;
  readonly renderer?: string | undefined;
  readonly shadingLanguageVersion?: string | undefined;
  readonly vendor?: string | undefined;
  readonly versionLabel?: string | undefined;
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
  | ContextVersionRow
  | RendererCapabilityRow
  | WebGlExtensionRow
  | GpuTimerQuerySupportRow
  | CompressedTextureFormatRow
  | TextureLimitRow
  | WebGpuFeatureGateRow
  | WebGpuLimitRow;

export type RendererCapabilityDiagnostic = {
  readonly code: "renderer_capability_stubbed";
  readonly severity: "info";
  readonly message: string;
  readonly relation: "renderer_capability" | "context_version";
  readonly key?: string | undefined;
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
  readonly beginQuery?: unknown;
  readonly drawBuffers?: unknown;
  readonly getExtension?: (name: string) => unknown;
  readonly getParameter?: (name: number) => unknown;
  readonly getSupportedExtensions?: () => readonly string[] | null;
  readonly texStorage2D?: unknown;
  readonly vertexAttribDivisor?: unknown;
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

const stubCapabilities: readonly RendererCapabilityName[] = [
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

const extensionCapabilities = {
  anisotropy: [
    "EXT_texture_filter_anisotropic",
    "MOZ_EXT_texture_filter_anisotropic",
    "WEBKIT_EXT_texture_filter_anisotropic",
  ],
  compressed_texture: [
    "WEBGL_compressed_texture_astc",
    "EXT_texture_compression_bptc",
    "WEBGL_compressed_texture_etc",
    "WEBGL_compressed_texture_etc1",
    "WEBGL_compressed_texture_pvrtc",
    "WEBKIT_WEBGL_compressed_texture_pvrtc",
    "WEBGL_compressed_texture_s3tc",
    "WEBGL_compressed_texture_s3tc_srgb",
  ],
  depth_texture: ["WEBGL_depth_texture"],
  draw_buffers: ["WEBGL_draw_buffers"],
  float_texture: ["EXT_color_buffer_float", "OES_texture_float"],
  gpu_timer_query: ["EXT_disjoint_timer_query_webgl2", "EXT_disjoint_timer_query"],
  half_float_texture: ["EXT_color_buffer_half_float", "OES_texture_half_float"],
  instancing: ["ANGLE_instanced_arrays"],
  lose_context: ["WEBGL_lose_context"],
} as const satisfies Partial<Record<RendererCapabilityName, readonly string[]>>;

const compressedTextureFamilies: Readonly<Record<string, CompressedTextureFamily>> = {
  EXT_texture_compression_bptc: "bptc",
  WEBGL_compressed_texture_astc: "astc",
  WEBGL_compressed_texture_etc: "etc",
  WEBGL_compressed_texture_etc1: "etc1",
  WEBGL_compressed_texture_pvrtc: "pvrtc",
  WEBGL_compressed_texture_s3tc: "s3tc",
  WEBGL_compressed_texture_s3tc_srgb: "s3tc_srgb",
  WEBKIT_WEBGL_compressed_texture_pvrtc: "pvrtc",
};

const compressedTextureFormatNames: Readonly<Record<number, string>> = {
  0x83F0: "COMPRESSED_RGB_S3TC_DXT1_EXT",
  0x83F1: "COMPRESSED_RGBA_S3TC_DXT1_EXT",
  0x83F2: "COMPRESSED_RGBA_S3TC_DXT3_EXT",
  0x83F3: "COMPRESSED_RGBA_S3TC_DXT5_EXT",
  0x8C4C: "COMPRESSED_SRGB_S3TC_DXT1_EXT",
  0x8C4D: "COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT",
  0x8C4E: "COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT",
  0x8C4F: "COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT",
  0x9274: "COMPRESSED_RGB8_ETC2",
  0x9275: "COMPRESSED_SRGB8_ETC2",
  0x9276: "COMPRESSED_RGB8_PUNCHTHROUGH_ALPHA1_ETC2",
  0x9277: "COMPRESSED_SRGB8_PUNCHTHROUGH_ALPHA1_ETC2",
  0x9278: "COMPRESSED_RGBA8_ETC2_EAC",
  0x9279: "COMPRESSED_SRGB8_ALPHA8_ETC2_EAC",
  0x9270: "COMPRESSED_R11_EAC",
  0x9271: "COMPRESSED_SIGNED_R11_EAC",
  0x9272: "COMPRESSED_RG11_EAC",
  0x9273: "COMPRESSED_SIGNED_RG11_EAC",
};

const hasGlProbeSurface = (gl: WebGlLikeContext): boolean =>
  typeof gl.getParameter === "function" ||
  typeof gl.getSupportedExtensions === "function" ||
  typeof gl.getExtension === "function";

const readStringParameter = (gl: WebGlLikeContext, parameter: number | undefined): string | undefined => {
  if (parameter === undefined || typeof gl.getParameter !== "function") return undefined;
  const value = gl.getParameter(parameter);
  return typeof value === "string" ? value : undefined;
};

const readNumberParameter = (gl: WebGlLikeContext, parameter: number | undefined): number | undefined => {
  if (parameter === undefined || typeof gl.getParameter !== "function") return undefined;
  const value = gl.getParameter(parameter);
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const isNumericArrayLike = (value: unknown): value is ArrayLike<number> =>
  typeof value === "object" &&
  value !== null &&
  "length" in value &&
  typeof value.length === "number";

const readCompressedTextureFormats = (gl: WebGlLikeContext): readonly number[] => {
  if (gl.COMPRESSED_TEXTURE_FORMATS === undefined || typeof gl.getParameter !== "function") return [];
  const value = gl.getParameter(gl.COMPRESSED_TEXTURE_FORMATS);
  if (ArrayBuffer.isView(value) && isNumericArrayLike(value)) return Array.from(value);
  if (Array.isArray(value)) return value.filter((format): format is number => typeof format === "number");
  return [];
};

const contextVersion = (
  gl: WebGlLikeContext,
  options: RendererCapabilityProbeOptions,
): WebGlContextVersion => {
  if (options.contextVersion !== undefined) return options.contextVersion;

  const label = readStringParameter(gl, gl.VERSION);
  if (label?.includes("WebGL 2")) return 2;
  if (label?.includes("WebGL 1") || label?.includes("WebGL 1.0")) return 1;
  if (hasWebGl2CoreSurface(gl)) return 2;
  return "unknown";
};

const hasWebGl2CoreSurface = (gl: WebGlLikeContext): boolean =>
  gl.READ_BUFFER !== undefined ||
  gl.TEXTURE_3D !== undefined ||
  typeof gl.beginQuery === "function" ||
  typeof gl.drawBuffers === "function" ||
  typeof gl.texStorage2D === "function";

const supportedExtensionSet = (gl: WebGlLikeContext): Set<string> => {
  const supported = new Set(
    (gl.getSupportedExtensions?.() ?? []).filter((extension): extension is string => typeof extension === "string"),
  );

  for (const extensionNames of Object.values(extensionCapabilities)) {
    for (const extension of extensionNames) {
      if (supported.has(extension)) continue;
      if (gl.getExtension?.(extension)) supported.add(extension);
    }
  }

  return supported;
};

const firstSupportedExtension = (
  supportedExtensions: ReadonlySet<string>,
  extensionNames: readonly string[] | undefined,
): string | undefined => extensionNames?.find((extension) => supportedExtensions.has(extension));

const capabilityRow = (
  capability: RendererCapabilityName,
  supported: boolean,
  source: RendererCapabilitySource,
  extension?: string,
  detail?: string,
): RendererCapabilityRow => ({
  capability,
  detail,
  extension,
  kind: "renderer_capability",
  source,
  supported,
});

const missingCapabilityDetail = (
  capability: RendererCapabilityName,
  extensionNames: readonly string[] | undefined,
): string => {
  if (extensionNames === undefined || extensionNames.length === 0) {
    return `${capability} is not available from the probed renderer.`;
  }

  return `${capability} is not available; none of ${extensionNames.join(", ")} are supported by the probed renderer.`;
};

const collectWebGlRows = (
  gl: WebGlLikeContext,
  options: RendererCapabilityProbeOptions,
): RendererCapabilityProbeRow[] => {
  const version = contextVersion(gl, options);
  const versionLabel = readStringParameter(gl, gl.VERSION);
  const renderer = readStringParameter(gl, gl.RENDERER);
  const shadingLanguageVersion = readStringParameter(gl, gl.SHADING_LANGUAGE_VERSION);
  const vendor = readStringParameter(gl, gl.VENDOR);
  const maxTextureSize = readNumberParameter(gl, gl.MAX_TEXTURE_SIZE);
  const maxTextureImageUnits = readNumberParameter(gl, gl.MAX_TEXTURE_IMAGE_UNITS);
  const maxCombinedTextureImageUnits = readNumberParameter(gl, gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
  const supportedExtensions = supportedExtensionSet(gl);
  const rows: RendererCapabilityProbeRow[] = [{
    api: "webgl",
    kind: "context_version",
    renderer,
    shadingLanguageVersion,
    vendor,
    version,
    versionLabel,
  }];

  rows.push(capabilityRow(
    "webgl2",
    version === 2,
    version === 2 ? "webgl2-core" : "missing",
    undefined,
    version === 2 ? undefined : "webgl2 is not available from the probed renderer.",
  ));
  rows.push(capabilityRow(
    "webgpu",
    options.webgpu?.status === "available",
    "webgpu-probe",
    undefined,
    options.webgpu?.status === "available"
      ? undefined
      : options.webgpu?.reason ?? "webgpu is not available from the current environment probe.",
  ));

  const drawBuffersExtension = firstSupportedExtension(supportedExtensions, extensionCapabilities.draw_buffers);
  rows.push(capabilityRow(
    "draw_buffers",
    version === 2 || drawBuffersExtension !== undefined || typeof gl.drawBuffers === "function",
    version === 2 || typeof gl.drawBuffers === "function" ? "webgl2-core" : drawBuffersExtension ? "webgl-extension" : "missing",
    drawBuffersExtension,
    version === 2 || drawBuffersExtension !== undefined || typeof gl.drawBuffers === "function"
      ? undefined
      : missingCapabilityDetail("draw_buffers", extensionCapabilities.draw_buffers),
  ));

  const depthTextureExtension = firstSupportedExtension(supportedExtensions, extensionCapabilities.depth_texture);
  rows.push(capabilityRow(
    "depth_texture",
    version === 2 || depthTextureExtension !== undefined || gl.TEXTURE_3D !== undefined,
    version === 2 || gl.TEXTURE_3D !== undefined ? "webgl2-core" : depthTextureExtension ? "webgl-extension" : "missing",
    depthTextureExtension,
    version === 2 || depthTextureExtension !== undefined || gl.TEXTURE_3D !== undefined
      ? undefined
      : missingCapabilityDetail("depth_texture", extensionCapabilities.depth_texture),
  ));

  const instancingExtension = firstSupportedExtension(supportedExtensions, extensionCapabilities.instancing);
  rows.push(capabilityRow(
    "instancing",
    version === 2 || instancingExtension !== undefined || typeof gl.vertexAttribDivisor === "function",
    version === 2 || typeof gl.vertexAttribDivisor === "function"
      ? "webgl2-core"
      : instancingExtension ? "webgl-extension" : "missing",
    instancingExtension,
    version === 2 || instancingExtension !== undefined || typeof gl.vertexAttribDivisor === "function"
      ? undefined
      : missingCapabilityDetail("instancing", extensionCapabilities.instancing),
  ));

  for (const capability of ["gpu_timer_query", "anisotropy", "float_texture", "half_float_texture", "compressed_texture", "lose_context"] as const) {
    const extension = firstSupportedExtension(supportedExtensions, extensionCapabilities[capability]);
    rows.push(capabilityRow(
      capability,
      extension !== undefined,
      extension === undefined ? "missing" : "webgl-extension",
      extension,
      extension === undefined ? missingCapabilityDetail(capability, extensionCapabilities[capability]) : undefined,
    ));
  }

  rows.push({
    extension: firstSupportedExtension(supportedExtensions, extensionCapabilities.gpu_timer_query),
    kind: "gpu_timer_query_support",
    queryApi: version === 2 && typeof gl.beginQuery === "function" ? "webgl2" : "none",
    supported: firstSupportedExtension(supportedExtensions, extensionCapabilities.gpu_timer_query) !== undefined,
  });

  for (const name of [...supportedExtensions].sort()) {
    rows.push({ kind: "webgl_extension", name, supported: true });
  }

  const compressedTextureExtension = firstSupportedExtension(supportedExtensions, extensionCapabilities.compressed_texture);
  if (compressedTextureExtension !== undefined) {
    for (const value of readCompressedTextureFormats(gl)) {
      rows.push({
        extension: compressedTextureExtension,
        family: compressedTextureFamilies[compressedTextureExtension] ?? "unknown",
        format: compressedTextureFormatNames[value] ?? `0x${value.toString(16).toUpperCase()}`,
        kind: "compressed_texture_format",
        value,
      });
    }
  }

  if (maxTextureSize !== undefined) rows.push({ kind: "max_texture_size", value: maxTextureSize });
  if (maxTextureImageUnits !== undefined) {
    rows.push({ kind: "max_texture_units", scope: "fragment", value: maxTextureImageUnits });
  }
  if (maxCombinedTextureImageUnits !== undefined) {
    rows.push({ kind: "max_texture_units", scope: "combined", value: maxCombinedTextureImageUnits });
  }

  if (options.webgpu?.features !== undefined) {
    for (const feature of options.webgpu.features) {
      rows.push({ feature, kind: "webgpu_feature_gate", supported: options.webgpu.status === "available" });
    }
  }

  if (options.webgpu?.limits !== undefined) {
    for (const [name, value] of Object.entries(options.webgpu.limits)) {
      rows.push({ kind: "webgpu_limit", name, value });
    }
  }

  return rows;
};

/**
 * Deterministic capability report for the stub backend. The function keeps the
 * old public import usable while making it explicit that no GPU has been probed.
 */
export const collectRendererCapabilityRows = (
  gl: WebGlLikeContext = {},
  options: RendererCapabilityProbeOptions = {},
): RendererCapabilityProbeResult => {
  if (hasGlProbeSurface(gl)) {
    return {
      diagnostics: [],
      rows: collectWebGlRows(gl, options),
    };
  }

  const version = contextVersion(gl, options);
  const rows: RendererCapabilityProbeRow[] = [
    {
      api: "stub",
      kind: "context_version",
      version,
      versionLabel: version === "unknown" ? "Royal stub renderer" : `Royal stub renderer over WebGL ${version}`,
    },
    ...stubCapabilities.map((capability): RendererCapabilityRow => ({
      capability,
      detail: "Capability probing is disabled while the renderer backend is stubbed.",
      kind: "renderer_capability",
      source: capability === "webgl2" && version === 2 ? "stub" : "unprobed",
      supported: false,
    })),
  ];

  return {
    diagnostics: (options.includeMissingDiagnostics ?? true)
      ? [{
          code: "renderer_capability_stubbed",
          key: "stub",
          message: "Renderer capabilities are stubbed and do not reflect device support.",
          relation: "renderer_capability",
          severity: "info",
        }]
      : [],
    rows,
  };
};
