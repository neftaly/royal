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

const contextVersion = (
  gl: WebGlLikeContext,
  options: RendererCapabilityProbeOptions,
): WebGlContextVersion => {
  if (options.contextVersion !== undefined) return options.contextVersion;

  const label = gl.VERSION === undefined ? undefined : gl.getParameter?.(gl.VERSION);
  return typeof label === "string" && label.includes("WebGL 2") ? 2 : "unknown";
};

/**
 * Deterministic capability report for the stub backend. The function keeps the
 * old public import usable while making it explicit that no GPU has been probed.
 */
export const collectRendererCapabilityRows = (
  gl: WebGlLikeContext = {},
  options: RendererCapabilityProbeOptions = {},
): RendererCapabilityProbeResult => {
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
