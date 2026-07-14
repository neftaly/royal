import { describe, expect, it, vi } from "vitest";
import { gltfRequestKey } from "../packages/renderer-webgl/src/frame-plan";
import { textureCacheKey } from "../packages/renderer-webgl/src/webgl/materials";
import { PreparedGltfRuntime } from "../packages/renderer-webgl/src/gltf/prepared-runtime";
import type { PreparedAssetArenaEvent } from "../packages/renderer-webgl/src/resource-arena";
import {
  createResourceGovernor,
  defineResourceGovernorPolicy,
  resourceGovernorSnapshot,
} from "../packages/renderer-webgl/src/resource-governor";
import { GLTF_PACKET_OCCURRENCE_STATUS } from "../packages/renderer-webgl/src/gltf-packet-topology";
import {
  automaticRasterVirtualTextureSource,
  type VirtualTextureRuntimeState,
} from "../packages/renderer-webgl/src/virtual-texture-runtime";
import { VirtualTextureRuntimeShell } from "../packages/renderer-webgl/src/virtual-texture-runtime-shell";

const event = (key: string): PreparedAssetArenaEvent => ({
  snapshot: { key } as PreparedAssetArenaEvent["snapshot"],
});

const virtualTextureState = (key: string, admissionTicket: number): VirtualTextureRuntimeState => ({
  activeSource: {
    loadManifest: async () => ({ diagnostics: [] }),
    loadPage: () => ({ kind: "absent" }),
    manifestUri: `/${key}.json`,
  },
  admissionTicket,
  demandPublished: false,
  demandedPageKeys: new Set(),
  demandedPageKeysScratch: new Set(),
  diagnosticsEnabled: true,
  desiredPageKeys: new Set(),
  desiredPageKeysScratch: new Set(),
  desiredPages: [],
  desiredPagesScratch: [],
  key,
  lastDemandFrame: Number.NEGATIVE_INFINITY,
  manifest: {} as NonNullable<VirtualTextureRuntimeState["manifest"]>,
  sourceGeneration: 1,
  stats: {} as VirtualTextureRuntimeState["stats"],
  status: "ready",
  texture: { kind: "virtual-asset", manifestUri: `/${key}.json` },
});

const virtualTextureShell = (): VirtualTextureRuntimeShell => new VirtualTextureRuntimeShell({
  active: () => false,
  admitJob: () => undefined,
  decodedSources: {} as never,
  diagnostic: vi.fn(),
  disposed: () => false,
  frame: () => 0,
  automaticVirtualTextures: false,
  gpu: {} as never,
  invalidate: vi.fn(),
  loadImageSource: () => Promise.reject(new Error("unused")),
  maximumDecodedCpuBytes: 0,
  resourceGovernor: {} as never,
});

describe("renderer runtime ownership", () => {
  it("keeps bypassed non-finite scalar identities collision-safe", () => {
    expect(gltfRequestKey("/asset.glb", Number.NaN))
      .not.toBe(gltfRequestKey("/asset.glb", Number.POSITIVE_INFINITY));
    expect(gltfRequestKey("/asset.glb", Number.POSITIVE_INFINITY))
      .not.toBe(gltfRequestKey("/asset.glb", Number.NEGATIVE_INFINITY));

    const key = (version: number): string => textureCacheKey({
      kind: "asset",
      uri: "/texture.png",
      version,
    });
    expect(key(Number.NaN)).not.toBe(key(Number.POSITIVE_INFINITY));
    expect(key(Number.POSITIVE_INFINITY)).not.toBe(key(Number.NEGATIVE_INFINITY));
  });

  it("keeps prepared glTF generations and node identity in one registry", () => {
    const runtime = new PreparedGltfRuntime();
    const key = gltfRequestKey("/asset.glb", undefined);
    const first = runtime.ensure(key, "/asset.glb", undefined, 3, 10);
    const node = { asset: { uri: "/asset.glb" }, kind: "gltf" } as never;

    expect(runtime.ensure(key, "/asset.glb", undefined, 3, 20)).toBe(first);
    expect(runtime.stateForNode(node)).toBe(first);
    expect(() => runtime.ensure(key, "/asset.glb", undefined, 4, 20)).toThrow(/generation 4 conflicts with 3/i);

    runtime.delete(key);
    const replacement = runtime.ensure(key, "/asset.glb", undefined, 4, 30);
    expect(replacement.instanceKey).toBeGreaterThan(first.instanceKey);
    expect(runtime.stateForNode(node)).toBe(replacement);
    runtime.dispose();
  });

  it("publishes focused prepared glTF state transitions by semantic asset key", () => {
    const reportFailure = vi.fn();
    const runtime = new PreparedGltfRuntime(2, undefined, reportFailure);
    const key = gltfRequestKey("/observed.glb", "v1");
    const observed: Array<string | undefined> = [];
    const stop = runtime.observeState(key, (state) => observed.push(state?.status));

    const state = runtime.ensure(key, "/observed.glb", "v1", 1, 10);
    state.status = "ready";
    runtime.publishStateChange(key);
    runtime.delete(key);
    stop();
    runtime.ensure(key, "/observed.glb", "v1", 2, 20);

    expect(observed).toEqual([undefined, "loading", "ready", undefined]);
    const listenerFailure = new Error("listener failed");
    let failListener = false;
    runtime.observeState(key, () => {
      if (failListener) throw listenerFailure;
    });
    const survivingListener = vi.fn();
    runtime.observeState(key, survivingListener);
    failListener = true;
    runtime.publishStateChange(key);
    expect(reportFailure).toHaveBeenCalledWith(listenerFailure);
    expect(survivingListener).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it("retries a failed prepared event from the same queue head", () => {
    const runtime = new PreparedGltfRuntime();
    runtime.enqueueEvents([event("first"), event("second")]);
    const applied: string[] = [];
    let fail = true;

    expect(() => runtime.drainEvents(({ snapshot }) => {
      if (snapshot.key === "first" && fail) throw new Error("publication failed");
      applied.push(snapshot.key);
    })).toThrow("publication failed");
    fail = false;
    runtime.drainEvents(({ snapshot }) => applied.push(snapshot.key));

    expect(applied).toEqual(["first", "second"]);
    runtime.dispose();
  });

  it("owns VT request identity and rotates frame admission fairly", () => {
    const runtime = virtualTextureShell();
    const first = virtualTextureState("first", runtime.nextAdmissionTicket());
    const second = virtualTextureState("second", runtime.nextAdmissionTicket());
    runtime.register(first);
    runtime.register(second);

    runtime.beginFrame();
    runtime.beginView(0);
    runtime.submit(first, 1, { candidates: [{ mip: 0, x: 0, y: 0 }], preferTargetMip: true }, []);
    runtime.submit(second, 1, { candidates: [{ mip: 0, x: 1, y: 0 }], preferTargetMip: true }, []);
    const firstFrame = runtime.finishFrame(true)!;
    expect(firstFrame.admissions.map((state) => state.key)).toEqual(["first", "second"]);
    runtime.commitPublication([], 1);
    runtime.clearFinishedFrame();

    runtime.beginFrame();
    runtime.beginView(0);
    runtime.submit(first, 1, { candidates: [{ mip: 0, x: 0, y: 0 }], preferTargetMip: true }, []);
    runtime.submit(second, 1, { candidates: [{ mip: 0, x: 1, y: 0 }], preferTargetMip: true }, []);
    const secondFrame = runtime.finishFrame(true)!;
    expect(secondFrame.admissions.map((state) => state.key)).toEqual(["second", "first"]);

    runtime.forget(first);
    expect(runtime.get("first")).toBeUndefined();
  });

  it("owns automatic VT source setup and abort-safe teardown", () => {
    const runtime = virtualTextureShell();
    const state = runtime.acquire({ kind: "virtual-asset", manifestUri: "/generated" }, {
      automaticSource: automaticRasterVirtualTextureSource("test", {
        decodedBytes: 1024 * 1024 * 4,
        height: 1024,
        label: "generated",
        source: {} as never,
        width: 1024,
      }),
    });

    expect(state.status).toBe("ready");
    expect(state.manifest).toMatchObject({ height: 1024, width: 1024 });
    runtime.forget(state);
    expect(state.sourceGeneration).toBe(2);
    expect(runtime.get(state.key)).toBeUndefined();
  });

  it("owns prepared CPU leases and packet patch publication", () => {
    const runtime = new PreparedGltfRuntime();
    const policy = defineResourceGovernorPolicy();
    const governor = createResourceGovernor(policy);
    const wake = vi.fn();
    runtime.configureCpuOwnership({ governor, policy, scheduleCapacityWake: wake });
    const admission = runtime.reserveCpuAdmission("asset", {
      assetDecode: 64,
      geometry: 128,
      transientPeak: 32,
    });
    runtime.finalizeCpuAdmission("asset", {
      assetDecode: 64,
      geometry: 128,
      transientPeak: 32,
    }, {
      hasMaterialLod: false,
      hasMaterialVariants: false,
      hasNodeLod: false,
      lights: [],
      load: { imageFailures: 0, imageLoaded: 0, imageRequests: 0, startedAt: 0 },
      nodeCount: 0,
      primitives: [],
      variants: [],
    }, admission);
    expect(resourceGovernorSnapshot(governor).total.cpuDecodedBytes).toBe(0);
    expect(wake).toHaveBeenCalledOnce();

    const loading = {
      kind: "gltf" as const,
      occurrenceIndex: 0,
      orderingSegment: 0,
      outerCount: 1,
      planOccurrenceIndex: 0,
    };
    runtime.rebuildPacketTopology(4, ["asset"], [loading]);
    expect(runtime.packetTopology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.loading);
    runtime.publishReadyPackets("asset", 4, false, () => ({ ...loading, primitives: [] }));
    expect(runtime.packetTopology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.ready);
    runtime.publishPacketError("asset", 4);
    expect(runtime.packetTopology.occurrenceStatuses[0]).toBe(GLTF_PACKET_OCCURRENCE_STATUS.failed);
    runtime.dispose();
  });
});
