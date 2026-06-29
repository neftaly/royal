import { describe, expect, it } from "vitest";
import {
  chooseRendererBackend,
  preferredWebGpuCanvasFormat,
  probeWebGl2Capabilities,
  probeWebGpuCapabilities,
  requestWebGpuDevice,
  type NavigatorGpuLike,
  type RendererProbeSnapshot,
  type RoyalRendererFeature,
  type WebGpuAdapterLike,
  type WebGpuDeviceDescriptorLike,
  type WebGpuDeviceLike
} from "../src/capabilities";

const webgpuProbe = (
  features: readonly string[]
): RendererProbeSnapshot["webgpu"] => ({
  adapterStatus: "available",
  deviceStatus: "not-requested",
  diagnostics: [],
  features: new Set(features),
  kind: "webgpu_capability_probe",
  limits: {},
  royalFeatures: new Set([
    "compute-pass",
    "indexed-geometry",
    "instancing",
    "readback-buffer",
    "storage-buffer",
    "texture-asset",
    "uint32-indices",
    ...features.filter((feature): feature is RoyalRendererFeature =>
      feature === "texture-compression-astc"
      || feature === "texture-compression-bc"
      || feature === "texture-compression-etc2"
      || feature === "timestamp-query"
    )
  ])
});

const unavailableWebGpu = (): RendererProbeSnapshot["webgpu"] => ({
  adapterStatus: "unavailable",
  deviceStatus: "not-requested",
  diagnostics: [],
  features: new Set(),
  kind: "webgpu_capability_probe",
  limits: {},
  reason: "no gpu",
  royalFeatures: new Set()
});

const webgl2Probe = (
  features: readonly RoyalRendererFeature[] = [
    "indexed-geometry",
    "instancing",
    "readback-buffer",
    "texture-asset",
    "uint32-indices"
  ]
): RendererProbeSnapshot["webgl2"] => ({
  diagnostics: [],
  features: new Set(features),
  kind: "webgl2_capability_probe",
  status: "available"
});

const unavailableWebGl2 = (): RendererProbeSnapshot["webgl2"] => ({
  diagnostics: [],
  features: new Set(),
  kind: "webgl2_capability_probe",
  reason: "no canvas",
  status: "unavailable"
});

const fakeNavigator = (
  adapter: WebGpuAdapterLike | null,
  preferredFormat = "rgba8unorm"
): NavigatorGpuLike => ({
  gpu: {
    getPreferredCanvasFormat: () => preferredFormat,
    requestAdapter: async () => adapter
  }
});

const fakeAdapter = (
  options: {
    readonly features?: readonly string[];
    readonly limits?: Readonly<Record<string, number>>;
    readonly requestDevice?: (
      descriptor?: WebGpuDeviceDescriptorLike,
    ) => Promise<WebGpuDeviceLike>;
  } = {}
): WebGpuAdapterLike => ({
  features: options.features ?? [],
  limits: options.limits ?? {},
  requestDevice: options.requestDevice ?? (async () => ({
    features: options.features ?? [],
    limits: options.limits ?? {},
    queue: { submit: () => undefined }
  }))
});

describe("WebGPU capability probing", () => {
  it("is safe to import and probe without browser globals", async () => {
    const probe = await probeWebGpuCapabilities({ navigator: {} });

    expect(probe).toMatchObject({
      adapterStatus: "unavailable",
      deviceStatus: "not-requested",
      kind: "webgpu_capability_probe",
      reason: "navigator.gpu is unavailable"
    });
    expect([...probe.royalFeatures]).toEqual([]);
  });

  it("collects adapter feature gates and numeric limits", async () => {
    const probe = await probeWebGpuCapabilities({
      navigator: fakeNavigator(fakeAdapter({
        features: ["timestamp-query", "texture-compression-bc"],
        limits: {
          maxBufferSize: 1_024,
          maxTextureDimension2D: 4_096
        }
      }))
    });

    expect(probe.adapterStatus).toBe("available");
    expect(probe.limits).toEqual({
      maxBufferSize: 1_024,
      maxTextureDimension2D: 4_096
    });
    expect([...probe.royalFeatures].sort()).toEqual([
      "compute-pass",
      "indexed-geometry",
      "instancing",
      "readback-buffer",
      "storage-buffer",
      "texture-asset",
      "texture-compression-bc",
      "timestamp-query",
      "uint32-indices"
    ]);
  });

  it("preflights required adapter features before requesting a device", async () => {
    let requestDeviceCalls = 0;
    const result = await requestWebGpuDevice({
      navigator: fakeNavigator(fakeAdapter({
        features: [],
        requestDevice: async () => {
          requestDeviceCalls += 1;
          return { queue: { submit: () => undefined } };
        }
      })),
      requiredRoyalFeatures: ["timestamp-query"]
    });

    expect(result.status).toBe("unavailable");
    expect(result.probe.deviceStatus).toBe("unavailable");
    expect(requestDeviceCalls).toBe(0);
    expect(result.probe.diagnostics).toContainEqual(expect.objectContaining({
      code: "feature_unavailable",
      feature: "timestamp-query"
    }));
  });

  it("passes required GPU features to requestDevice when available", async () => {
    let descriptor: WebGpuDeviceDescriptorLike | undefined;
    const result = await requestWebGpuDevice({
      label: "royal-test-device",
      navigator: fakeNavigator(fakeAdapter({
        features: ["timestamp-query"],
        requestDevice: async (nextDescriptor) => {
          descriptor = nextDescriptor;
          return {
            features: ["timestamp-query"],
            limits: { maxBufferSize: 2_048 },
            queue: { submit: () => undefined }
          };
        }
      })),
      requiredRoyalFeatures: ["timestamp-query"]
    });

    expect(result.status).toBe("available");
    expect(result.probe.deviceStatus).toBe("available");
    expect(descriptor).toEqual({
      label: "royal-test-device",
      requiredFeatures: ["timestamp-query"]
    });
    expect(result.probe.limits).toEqual({ maxBufferSize: 2_048 });
  });

  it("reports the preferred canvas format with a stable fallback", () => {
    expect(preferredWebGpuCanvasFormat({ navigator: fakeNavigator(fakeAdapter()) })).toBe("rgba8unorm");
    expect(preferredWebGpuCanvasFormat({ navigator: {} })).toBe("bgra8unorm");
  });
});

describe("WebGL2 fallback boundaries", () => {
  it("probes WebGL2 without assuming browser globals", () => {
    const unavailable = probeWebGl2Capabilities();
    const available = probeWebGl2Capabilities({
      canvas: {
        getContext: () => ({
          getExtension: (name) => name === "EXT_disjoint_timer_query_webgl2" ? {} : null
        })
      }
    });

    expect(unavailable.status).toBe("unavailable");
    expect([...available.features].sort()).toEqual([
      "indexed-geometry",
      "instancing",
      "readback-buffer",
      "texture-asset",
      "timestamp-query",
      "uint32-indices"
    ]);
  });

  it("selects WebGPU for auto mode when required features are available", () => {
    const choice = chooseRendererBackend({
      webgl2: webgl2Probe(),
      webgpu: webgpuProbe(["timestamp-query"])
    }, {
      backend: "auto",
      requiredFeatures: ["compute-pass", "timestamp-query"]
    });

    expect(choice).toMatchObject({
      backend: "webgpu",
      fallbackPolicy: "webgl2",
      status: "ready"
    });
  });

  it("falls back to WebGL2 in auto mode for WebGL2-compatible features", () => {
    const choice = chooseRendererBackend({
      webgl2: webgl2Probe(),
      webgpu: unavailableWebGpu()
    }, {
      backend: "auto",
      requiredFeatures: ["indexed-geometry"]
    });

    expect(choice.backend).toBe("webgl2");
    expect(choice.status).toBe("ready");
    expect(choice.diagnostics).toContainEqual(expect.objectContaining({
      code: "fallback_selected",
      fallback: "webgl2"
    }));
  });

  it("keeps WebGL2 compute fallback explicit", () => {
    const withoutFallback = chooseRendererBackend({
      webgl2: webgl2Probe(),
      webgpu: unavailableWebGpu()
    }, {
      backend: "webgl2",
      requiredFeatures: ["compute-pass"]
    });
    const withCpuFallback = chooseRendererBackend({
      webgl2: webgl2Probe(),
      webgpu: unavailableWebGpu()
    }, {
      backend: "webgl2",
      fallback: "cpu",
      requiredFeatures: ["compute-pass"]
    });

    expect(withoutFallback.status).toBe("unavailable");
    expect(withoutFallback.diagnostics).toContainEqual(expect.objectContaining({
      code: "feature_unavailable",
      feature: "compute-pass"
    }));
    expect(withCpuFallback.status).toBe("degraded");
    expect(withCpuFallback.fallbacks).toEqual([{
      feature: "compute-pass",
      policy: "cpu",
      reason: "compute-pass will use CPU fallback on webgl2."
    }]);
  });

  it("does not hide a missing required feature behind unavailable WebGL2", () => {
    const choice = chooseRendererBackend({
      webgl2: unavailableWebGl2(),
      webgpu: unavailableWebGpu()
    }, {
      backend: "auto",
      requiredFeatures: ["indexed-geometry"]
    });

    expect(choice).toMatchObject({
      backend: "none",
      status: "unavailable"
    });
  });
});
