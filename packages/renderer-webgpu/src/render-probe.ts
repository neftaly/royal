import {
  preferredWebGpuCanvasFormat,
  requestWebGpuDevice,
  type NavigatorGpuLike,
  type RendererBackendDiagnostic,
  type RoyalRendererFeature,
  type WebGpuDeviceLike,
  type WebGpuPowerPreference
} from "./capabilities";

export type WebGpuCanvasProbeTarget = {
  readonly height: number;
  readonly width: number;
  readonly getContext: (contextId: "webgpu") => WebGpuCanvasContextLike | null;
};

export type WebGpuCanvasContextLike = {
  readonly configure: (configuration: Readonly<Record<string, unknown>>) => void;
  readonly getCurrentTexture: () => {
    readonly createView: () => unknown;
  };
};

export type WebGpuRenderDeviceLike = WebGpuDeviceLike & {
  readonly createCommandEncoder: (
    descriptor?: Readonly<Record<string, unknown>>,
  ) => WebGpuCommandEncoderLike;
  readonly createRenderPipeline: (
    descriptor: Readonly<Record<string, unknown>>,
  ) => unknown;
  readonly createShaderModule: (
    descriptor: Readonly<Record<string, unknown>>,
  ) => unknown;
  readonly queue: {
    readonly submit: (commandBuffers: readonly unknown[]) => void;
  };
};

export type WebGpuCommandEncoderLike = {
  readonly beginRenderPass: (
    descriptor: Readonly<Record<string, unknown>>,
  ) => WebGpuRenderPassEncoderLike;
  readonly finish: () => unknown;
};

export type WebGpuRenderPassEncoderLike = {
  readonly draw: (vertexCount: number) => void;
  readonly end: () => void;
  readonly setPipeline: (pipeline: unknown) => void;
};

export type WebGpuRenderProbeStatus = "rendered" | "unavailable";

export type WebGpuRenderProbeOptions = {
  readonly clearColor?: readonly [number, number, number, number] | undefined;
  readonly color?: readonly [number, number, number, number] | undefined;
  readonly forceFallbackAdapter?: boolean | undefined;
  readonly format?: string | undefined;
  readonly navigator?: NavigatorGpuLike | undefined;
  readonly powerPreference?: WebGpuPowerPreference | undefined;
  readonly requiredFeatures?: readonly RoyalRendererFeature[] | undefined;
};

export type WebGpuRenderProbeResult = {
  readonly diagnostics: readonly RendererBackendDiagnostic[];
  readonly format?: string | undefined;
  readonly status: WebGpuRenderProbeStatus;
};

const DEFAULT_CLEAR_COLOR = [0.02, 0.03, 0.04, 1] as const;
const DEFAULT_TRIANGLE_COLOR = [0.9, 0.55, 0.15, 1] as const;

export const renderWebGpuProbeTriangle = async (
  canvas: WebGpuCanvasProbeTarget,
  options: WebGpuRenderProbeOptions = {}
): Promise<WebGpuRenderProbeResult> => {
  const deviceResult = await requestWebGpuDevice({
    forceFallbackAdapter: options.forceFallbackAdapter,
    navigator: options.navigator,
    powerPreference: options.powerPreference,
    requiredRoyalFeatures: options.requiredFeatures
  });

  if (deviceResult.status !== "available" || deviceResult.device === undefined) {
    return {
      diagnostics: deviceResult.probe.diagnostics,
      status: "unavailable"
    };
  }

  if (!isRenderDevice(deviceResult.device)) {
    return {
      diagnostics: [
        ...deviceResult.probe.diagnostics,
        {
          backend: "webgpu",
          code: "device_request_failed",
          message: "WebGPU device does not expose the render methods required by the probe.",
          severity: "error"
        }
      ],
      status: "unavailable"
    };
  }

  const context = canvas.getContext("webgpu");
  if (context === null) {
    return {
      diagnostics: [{
        backend: "webgpu",
        code: "backend_unavailable",
        message: "canvas.getContext(\"webgpu\") returned null.",
        severity: "error"
      }],
      status: "unavailable"
    };
  }

  const device = deviceResult.device;
  const format = options.format ?? preferredWebGpuCanvasFormat({ navigator: options.navigator });
  context.configure({
    alphaMode: "premultiplied",
    device,
    format
  });

  const color = options.color ?? DEFAULT_TRIANGLE_COLOR;
  const clearColor = options.clearColor ?? DEFAULT_CLEAR_COLOR;
  const shaderModule = device.createShaderModule({
    code: probeTriangleShader(color),
    label: "royal-webgpu-probe-triangle"
  });
  const pipeline = device.createRenderPipeline({
    fragment: {
      entryPoint: "fragmentMain",
      module: shaderModule,
      targets: [{ format }]
    },
    layout: "auto",
    primitive: { topology: "triangle-list" },
    vertex: {
      entryPoint: "vertexMain",
      module: shaderModule
    }
  });
  const encoder = device.createCommandEncoder({ label: "royal-webgpu-probe-encoder" });
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      clearValue: {
        a: clearColor[3],
        b: clearColor[2],
        g: clearColor[1],
        r: clearColor[0]
      },
      loadOp: "clear",
      storeOp: "store",
      view: context.getCurrentTexture().createView()
    }],
    label: "royal-webgpu-probe-pass"
  });

  pass.setPipeline(pipeline);
  pass.draw(3);
  pass.end();
  device.queue.submit([encoder.finish()]);

  return {
    diagnostics: deviceResult.probe.diagnostics,
    format,
    status: "rendered"
  };
};

const isRenderDevice = (device: WebGpuDeviceLike): device is WebGpuRenderDeviceLike => {
  const candidate = device as Partial<WebGpuRenderDeviceLike>;
  return typeof candidate.createShaderModule === "function"
    && typeof candidate.createRenderPipeline === "function"
    && typeof candidate.createCommandEncoder === "function"
    && typeof candidate.queue?.submit === "function";
};

const probeTriangleShader = (
  color: readonly [number, number, number, number]
): string => {
  const fragmentColor = color.map(wgslFloat).join(", ");
  return `
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(
    vec2f(0.0, 0.72),
    vec2f(-0.72, -0.58),
    vec2f(0.72, -0.58)
  );
  return vec4f(positions[vertexIndex], 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4f {
  return vec4f(${fragmentColor});
}
`;
};

const wgslFloat = (value: number): string => {
  if (!Number.isFinite(value)) return "0.0";
  const clamped = Math.min(1, Math.max(0, value));
  return clamped.toFixed(6);
};
