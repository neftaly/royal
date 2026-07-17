import {
  GltfImageDemandCoordinator,
  gltfImageRefinementWakeDelay,
  type GltfImageRecipeLease,
} from "../packages/renderer-webgl/src/gltf/image-demand-coordinator";
import {
  loadGltfImageSourceRecipe,
  preparedGltfImageSourceRecipeWithoutTransport,
  type GltfImageSourceRecipe,
  type LoadedGltfImageSource,
  type PreparedGltfImageSourceRecipe,
} from "../packages/renderer-webgl/src/gltf/image-source-recipe";
import type {
  GltfLoadMetrics,
  LoadedGltfMaterial,
} from "../packages/renderer-webgl/src/gltf/prepared-asset";
import type { ResourceArenaSourceLease } from "../packages/renderer-webgl/src/resource-arena";
import { ResourceGovernorCpuCapacityError } from "../packages/renderer-webgl/src/resource-governor";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture/sources";
import type {
  SurfaceImageBasedLight,
  SurfaceImageBasedLightSpecular,
} from "../packages/renderer-webgl/src/webgl/lights";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  flushMicrotasks as flushTestMicrotasks,
} from "./async-test-fixtures";
import { forEachFuzzCaseAsync } from "./fuzz";

vi.mock("../packages/renderer-webgl/src/gltf/image-source-recipe", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../packages/renderer-webgl/src/gltf/image-source-recipe")
  >();
  return { ...actual, loadGltfImageSourceRecipe: vi.fn() };
});

const flushMicrotasks = (): Promise<void> => flushTestMicrotasks(12);
const flushSchedulerTurn = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks();
};

const recipe = (key: string): GltfImageSourceRecipe => ({
  key,
  source: { kind: "html-image", uri: `https://example.test/${key}.png` },
});

const byteRecipe = (key: string, bytes: ArrayBuffer): GltfImageSourceRecipe => ({
  key,
  source: {
    bytes,
    kind: "bitmap-bytes",
  },
});

const recipeLease = (): GltfImageRecipeLease & {
  readonly release: ReturnType<typeof vi.fn<() => void>>;
  readonly resize: ReturnType<typeof vi.fn<(retainedBytes: number) => void>>;
} => ({
  release: vi.fn(),
  resize: vi.fn(),
});

const source = (key: string): LoadedTextureSource => ({
  height: 1,
  key,
  width: 1,
} as unknown as LoadedTextureSource);

const loaded = (key: string): LoadedGltfImageSource => ({
  image: source(key),
});

const material = (
  baseColorImage: string,
  emissiveImage?: string,
): LoadedGltfMaterial => ({
  baseColorTexture: {
    imageUri: baseColorImage,
    textureUri: `texture:${baseColorImage}`,
  },
  ...(emissiveImage === undefined
    ? {}
    : {
        emissiveTexture: {
          imageUri: emissiveImage,
          textureUri: `texture:${emissiveImage}`,
        },
      }),
} as unknown as LoadedGltfMaterial);

const imageBasedLight = (imageKey: string): {
  readonly light: SurfaceImageBasedLight;
  readonly specular: SurfaceImageBasedLightSpecular;
} => {
  const specular = {
    imageLoadKeys: [[imageKey]],
    key: "ibl:specular",
  } as unknown as SurfaceImageBasedLightSpecular;
  return {
    light: { specular } as unknown as SurfaceImageBasedLight,
    specular,
  };
};

const metrics = (): GltfLoadMetrics => ({
  imageFailures: 0,
  imageLoaded: 0,
  imageRequests: 0,
  startedAt: 0,
});

const coordinatorHarness = (options: {
  readonly admitOrdinaryDecode?: () => Readonly<{ release(): void }> | undefined;
  readonly admitOrdinaryTransport?: () => Readonly<{ release(): void }> | undefined;
  readonly closeSource?: (value: LoadedTextureSource) => void;
  readonly diagnostic?: (message: string, key: string) => void;
  readonly decodeRecipe?: (
    prepared: PreparedGltfImageSourceRecipe,
    signal: AbortSignal,
  ) => Promise<LoadedGltfImageSource>;
  readonly invalidate?: () => void;
  readonly now?: () => number;
  readonly progress?: (assetKey: string) => void;
  readonly prepareRecipe?: (
    recipe: GltfImageSourceRecipe,
    signal: AbortSignal,
  ) => Promise<PreparedGltfImageSourceRecipe>;
  readonly retainSource?: (value: LoadedTextureSource) => ResourceArenaSourceLease;
  readonly reserveTransportBytes?: (bytes: number) => Readonly<{ release(): void }>;
} = {}) => {
  const closeSource = vi.fn(options.closeSource ?? ((_value: LoadedTextureSource) => undefined));
  const diagnostic = vi.fn(options.diagnostic ?? ((_message: string, _key: string) => undefined));
  const invalidate = vi.fn(options.invalidate ?? (() => undefined));
  const progress = vi.fn(options.progress ?? ((_assetKey: string) => undefined));
  const leaseReleases = new Map<LoadedTextureSource, ReturnType<typeof vi.fn<() => boolean>>>();
  const retainSource = vi.fn(options.retainSource ?? ((value: LoadedTextureSource) => {
    const release = vi.fn(() => true);
    leaseReleases.set(value, release);
    return { release };
  }));
  const coordinator = new GltfImageDemandCoordinator({
    ...(options.admitOrdinaryDecode === undefined
      ? {}
      : { admitOrdinaryDecode: options.admitOrdinaryDecode }),
    ...(options.admitOrdinaryTransport === undefined
      ? {}
      : { admitOrdinaryTransport: options.admitOrdinaryTransport }),
    closeSource,
    decodeRecipe: options.decodeRecipe
      ?? ((prepared, signal) => loadGltfImageSourceRecipe(prepared.recipe, signal)),
    diagnostic,
    invalidate,
    ...(options.now === undefined ? {} : { now: options.now }),
    progress,
    ...(options.prepareRecipe === undefined ? {} : { prepareRecipe: options.prepareRecipe }),
    retainSource,
    ...(options.reserveTransportBytes === undefined
      ? {}
      : { reserveTransportBytes: options.reserveTransportBytes }),
  });
  return {
    closeSource,
    coordinator,
    diagnostic,
    invalidate,
    leaseReleases,
    progress,
    retainSource,
  };
};

const loadRecipeMock = vi.mocked(loadGltfImageSourceRecipe);

const demandImages = (
  coordinator: GltfImageDemandCoordinator,
  assetKey: string,
  baseColorImage: string,
  emissiveImage?: string,
): void => { coordinator.demandMaterial(assetKey, material(baseColorImage, emissiveImage)); };

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("glTF image refinement wake policy", () => {
  it("wakes the first and final publications immediately and bounds intermediate latency", () => {
    expect(gltfImageRefinementWakeDelay({ elapsedMs: 0, firstWake: true, urgent: false })).toBe(0);
    expect(gltfImageRefinementWakeDelay({ elapsedMs: 0, firstWake: false, urgent: true })).toBe(0);
    expect(gltfImageRefinementWakeDelay({ elapsedMs: 25, firstWake: false, urgent: false })).toBe(75);
    expect(gltfImageRefinementWakeDelay({ elapsedMs: 100, firstWake: false, urgent: false })).toBe(0);
    expect(gltfImageRefinementWakeDelay({ elapsedMs: 150, firstWake: false, urgent: false })).toBe(0);
  });

  it("cancels a deferred wake after an intervening frame and flushes final settlement", async () => {
    vi.useFakeTimers();
    let now = 0;
    const jobs = new Map([
      ["first", deferred<LoadedGltfImageSource>()],
      ["second", deferred<LoadedGltfImageSource>()],
      ["third", deferred<LoadedGltfImageSource>()],
    ]);
    loadRecipeMock.mockImplementation((value) => jobs.get(value.key)!.promise);
    const harness = coordinatorHarness({ now: () => now });
    const materials = [material("first"), material("second"), material("third")];
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials,
      recipeLease: recipeLease(),
      recipes: [recipe("first"), recipe("second"), recipe("third")],
      stateInstanceKey: 1,
    });
    for (const candidate of materials) harness.coordinator.demandMaterial("asset", candidate);
    await flushMicrotasks();

    jobs.get("first")!.resolve(loaded("first"));
    await flushMicrotasks();
    expect(harness.invalidate).toHaveBeenCalledOnce();
    harness.coordinator.acknowledgePublicationFrame();

    now = 10;
    jobs.get("second")!.resolve(loaded("second"));
    await flushMicrotasks();
    expect(harness.invalidate).toHaveBeenCalledOnce();
    harness.coordinator.acknowledgePublicationFrame();
    await vi.advanceTimersByTimeAsync(100);
    expect(harness.invalidate).toHaveBeenCalledOnce();

    now = 20;
    jobs.get("third")!.resolve(loaded("third"));
    await flushMicrotasks();
    expect(harness.invalidate).toHaveBeenCalledTimes(2);
    harness.coordinator.dispose();
  });
});

describe("GltfImageDemandCoordinator lifecycle", () => {
  it("owns an independent initial publication barrier for each material", () => {
    const harness = coordinatorHarness();
    const first = material("first");
    const second = material("second");
    const solid = {} as LoadedGltfMaterial;
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [first, second, solid],
      publicationGroups: [[first], [second], [solid]],
      recipeLease: recipeLease(),
      recipes: [recipe("first"), recipe("second")],
      stateInstanceKey: 1,
    });

    const firstPublication = harness.coordinator.publication("asset", first);
    const secondPublication = harness.coordinator.publication("asset", second);
    expect(firstPublication).toEqual({ ready: false });
    expect(secondPublication).toEqual({ ready: false });
    expect(firstPublication).not.toBe(secondPublication);
    expect(harness.coordinator.publication("asset", solid)).toEqual({ ready: true });

    firstPublication!.ready = true;
    expect(secondPublication?.ready).toBe(false);
    harness.coordinator.dispose();
  });

  it("keeps material recipes dormant while eagerly demanding IBL on its independent lane", async () => {
    let now = 10;
    const ordinaryKey = "ordinary";
    const iblKey = "ibl";
    const jobs = new Map([
      [ordinaryKey, deferred<LoadedGltfImageSource>()],
      [iblKey, deferred<LoadedGltfImageSource>()],
    ]);
    loadRecipeMock.mockImplementation((value) => jobs.get(value.key)!.promise);
    const harness = coordinatorHarness({ now: () => now });
    const load = metrics();
    const ownership = recipeLease();
    const ibl = imageBasedLight(iblKey);
    const ordinaryMaterial = material(ordinaryKey);
    harness.coordinator.registerAsset({
      imageBasedLight: ibl.light,
      key: "asset",
      load,
      materials: [ordinaryMaterial],
      recipeLease: ownership,
      recipes: [recipe(ordinaryKey), recipe(iblKey)],
      stateInstanceKey: 7,
    });

    expect(harness.coordinator.snapshot()).toMatchObject({
      active: 1,
      candidates: 2,
      dormant: 1,
      loading: 1,
    });
    expect(load.imageRequests).toBe(1);
    expect(load.imageLoadStartedAt).toBe(10);
    await flushMicrotasks();
    expect(loadRecipeMock.mock.calls.map(([value]) => value.key)).toEqual([iblKey]);

    harness.coordinator.demandMaterial("asset", ordinaryMaterial);
    await flushMicrotasks();

    expect(load.imageRequests).toBe(2);
    expect(loadRecipeMock.mock.calls.map(([value]) => value.key).sort()).toEqual([iblKey, ordinaryKey]);
    expect(harness.coordinator.snapshot()).toMatchObject({ active: 2, loading: 2, queued: 0 });
    expect(ownership.release).not.toHaveBeenCalled();

    now = 20;
    jobs.get(ordinaryKey)!.resolve(loaded(ordinaryKey));
    await flushMicrotasks();
    expect(load.imageLoaded).toBe(1);
    expect(ownership.release).not.toHaveBeenCalled();

    now = 30;
    jobs.get(iblKey)!.resolve(loaded(iblKey));
    await flushMicrotasks();

    expect(load).toMatchObject({ imageFailures: 0, imageLoaded: 2, imageRequests: 2 });
    expect(load.firstImageSettledAt).toBe(20);
    expect(load.imagesSettledAt).toBe(30);
    expect(ownership.release).toHaveBeenCalledOnce();
    expect(harness.coordinator.readyKeys("asset").has(ordinaryKey)).toBe(true);
    expect(harness.coordinator.readyKeys("asset").has(iblKey)).toBe(true);

    const outcomes = harness.coordinator.pendingReadyOutcomes();
    expect(outcomes).toHaveLength(2);
    const ordinaryOutcome = outcomes.find((outcome) => outcome.key === ordinaryKey)!;
    const iblOutcome = outcomes.find((outcome) => outcome.key === iblKey)!;
    expect(ordinaryOutcome).toMatchObject({ assetKey: "asset", stateInstanceKey: 7 });
    expect(ordinaryOutcome.bindings).toHaveLength(1);
    expect(iblOutcome.iblSpecular).toBe(ibl.specular);
    for (const outcome of outcomes) {
      const release = harness.leaseReleases.get(outcome.source)!;
      expect(release).not.toHaveBeenCalled();
      outcome.acknowledge();
      outcome.acknowledge();
      expect(release).toHaveBeenCalledOnce();
    }
    expect(harness.closeSource.mock.calls.map(([value]) => value)).toEqual(
      expect.arrayContaining(outcomes.map((outcome) => outcome.source)),
    );
    harness.coordinator.dispose();
  });

  it("keeps a ready settlement deterministic when invalidation observers throw", async () => {
    loadRecipeMock.mockResolvedValue(loaded("invalidate-failure"));
    const harness = coordinatorHarness({
      invalidate: () => { throw new Error("invalidation observer failed"); },
    });
    const load = metrics();
    harness.coordinator.registerAsset({
      key: "asset",
      load,
      materials: [material("invalidate-failure")],
      recipeLease: recipeLease(),
      recipes: [recipe("invalidate-failure")],
      stateInstanceKey: 1,
    });

    demandImages(harness.coordinator, "asset", "invalidate-failure");
    await flushMicrotasks();

    expect(load).toMatchObject({ imageFailures: 0, imageLoaded: 1, imageRequests: 1 });
    expect(load.imageCandidates).toBe(1);
    expect(harness.progress).toHaveBeenCalledOnce();
    expect(harness.progress).toHaveBeenCalledWith("asset");
    expect(harness.coordinator.readyKeys("asset").has("invalidate-failure")).toBe(true);
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([
      expect.objectContaining({ key: "invalidate-failure" }),
    ]);
    expect(harness.diagnostic).toHaveBeenCalledWith(
      expect.stringContaining("invalidation observer failed"),
      "invalidate-failure",
    );
    harness.coordinator.pendingReadyOutcomes()[0]!.acknowledge();
    harness.coordinator.dispose();
  });

  it("isolates throwing diagnostics from rejected image jobs", async () => {
    loadRecipeMock.mockRejectedValue(new Error("decode failed"));
    const harness = coordinatorHarness({
      diagnostic: () => { throw new Error("diagnostic observer failed"); },
    });
    const load = metrics();
    harness.coordinator.registerAsset({
      key: "asset",
      load,
      materials: [material("decode-failure")],
      recipeLease: recipeLease(),
      recipes: [recipe("decode-failure")],
      stateInstanceKey: 1,
    });

    demandImages(harness.coordinator, "asset", "decode-failure");
    await flushMicrotasks();

    expect(load).toMatchObject({ imageFailures: 1, imageLoaded: 0, imageRequests: 1 });
    expect(load.imageFailureDetails).toEqual([{
      key: "decode-failure",
      message: "decode failed",
    }]);
    expect(harness.coordinator.snapshot()).toMatchObject({ errors: 1, loading: 0 });
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([]);
    harness.coordinator.dispose();
  });

  it("settles retention failure as an image failure without queuing an outcome", async () => {
    const denied = source("denied");
    loadRecipeMock.mockResolvedValue({ image: denied });
    const harness = coordinatorHarness({
      retainSource: () => { throw new Error("decoded source retention denied"); },
    });
    const load = metrics();
    const ownership = recipeLease();
    harness.coordinator.registerAsset({
      key: "asset",
      load,
      materials: [material("denied")],
      recipeLease: ownership,
      recipes: [recipe("denied")],
      stateInstanceKey: 1,
    });

    demandImages(harness.coordinator, "asset", "denied");
    await flushMicrotasks();

    expect(load).toMatchObject({ imageFailures: 1, imageLoaded: 0, imageRequests: 1 });
    expect(load.firstImageSettledAt).toEqual(expect.any(Number));
    expect(load.imagesSettledAt).toEqual(expect.any(Number));
    expect(harness.coordinator.snapshot()).toMatchObject({ errors: 1, loading: 0 });
    expect(harness.closeSource).toHaveBeenCalledOnce();
    expect(harness.closeSource).toHaveBeenCalledWith(denied);
    expect(harness.diagnostic).toHaveBeenCalledWith(
      expect.stringContaining("decoded source retention denied"),
      "denied",
    );
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([]);
    expect(ownership.release).toHaveBeenCalledOnce();
    harness.coordinator.dispose();
  });

  it("keeps temporary decoded-capacity denial retryable without degrading the asset", async () => {
    const denied = source("capacity-denied");
    const retried = source("capacity-retried");
    const refinement = source("capacity-refinement");
    loadRecipeMock
      .mockResolvedValueOnce({ image: denied })
      .mockResolvedValueOnce({ image: retried })
      .mockResolvedValueOnce({ image: refinement });
    let retainAttempt = 0;
    const release = vi.fn(() => true);
    const harness = coordinatorHarness({
      retainSource: () => {
        retainAttempt += 1;
        if (retainAttempt === 1) throw new ResourceGovernorCpuCapacityError("temporary pressure", false);
        return { release };
      },
    });
    const load = metrics();
    const capacityMaterial = material("capacity", "refinement");
    harness.coordinator.registerAsset({
      key: "asset",
      load,
      materials: [capacityMaterial],
      recipeLease: recipeLease(),
      recipes: [recipe("capacity"), recipe("refinement")],
      stateInstanceKey: 1,
    });

    expect(harness.coordinator.demandMaterial("asset", capacityMaterial)).toBe(true);
    await flushMicrotasks();

    expect(load).toMatchObject({ imageFailures: 0, imageLoaded: 0, imageRequests: 1 });
    expect(harness.coordinator.snapshot()).toMatchObject({ errors: 0, ready: 0 });
    expect(harness.coordinator.demandMaterial("asset", capacityMaterial)).toBe(true);
    await flushMicrotasks();
    expect(loadRecipeMock.mock.calls.map(([value]) => value.key)).toEqual(["capacity"]);
    expect(harness.coordinator.wakeCpuCapacity()).toBe(true);
    await flushMicrotasks();

    expect(load).toMatchObject({ imageFailures: 0, imageLoaded: 2, imageRequests: 2 });
    expect(harness.coordinator.pendingReadyOutcomes()).toHaveLength(2);
    expect(harness.closeSource).toHaveBeenCalledWith(denied);
    expect(harness.diagnostic).not.toHaveBeenCalled();
    harness.coordinator.dispose();
  });

  it("preserves retention failure while retrying its unleased source close", async () => {
    const denied = source("denied-close-retry");
    loadRecipeMock.mockResolvedValue({ image: denied });
    const closeSource = vi.fn<(value: LoadedTextureSource) => void>()
      .mockImplementationOnce(() => { throw new Error("unleased close failed"); })
      .mockImplementationOnce(() => { throw new Error("unleased close still failed"); })
      .mockImplementation(() => undefined);
    const harness = coordinatorHarness({
      closeSource,
      retainSource: () => { throw new Error("decoded source retention denied"); },
    });
    const load = metrics();
    harness.coordinator.registerAsset({
      key: "asset",
      load,
      materials: [material("denied-close-retry")],
      recipeLease: recipeLease(),
      recipes: [recipe("denied-close-retry")],
      stateInstanceKey: 1,
    });

    demandImages(harness.coordinator, "asset", "denied-close-retry");
    await flushMicrotasks();

    expect(load).toMatchObject({ imageFailures: 1, imageLoaded: 0, imageRequests: 1 });
    expect(harness.diagnostic).toHaveBeenCalledWith(
      expect.stringContaining("decoded source retention denied"),
      "denied-close-retry",
    );
    expect(closeSource).toHaveBeenCalledTimes(2);

    harness.coordinator.wake();
    harness.coordinator.wake();

    expect(closeSource).toHaveBeenCalledTimes(3);
    harness.coordinator.dispose();
  });

  it("aborts stale ownership but holds the recipe token until active decode settles", async () => {
    const job = deferred<LoadedGltfImageSource>();
    loadRecipeMock.mockImplementation(() => job.promise);
    const harness = coordinatorHarness();
    const ownership = recipeLease();
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("slow")],
      recipeLease: ownership,
      recipes: [recipe("slow")],
      stateInstanceKey: 3,
    });
    demandImages(harness.coordinator, "asset", "slow");
    await flushMicrotasks();

    expect(harness.coordinator.snapshot()).toMatchObject({ active: 1, loading: 1 });
    harness.coordinator.releaseAsset("asset");
    expect(harness.coordinator.snapshot()).toMatchObject({ active: 1, candidates: 0 });
    expect(ownership.release).not.toHaveBeenCalled();

    const stale = loaded("slow").image;
    job.resolve({ image: stale });
    await flushMicrotasks();

    expect(harness.retainSource).not.toHaveBeenCalled();
    expect(harness.closeSource).toHaveBeenCalledOnce();
    expect(harness.closeSource).toHaveBeenCalledWith(stale);
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([]);
    expect(ownership.release).toHaveBeenCalledOnce();
    harness.coordinator.dispose();
  });

  it("retries a failed close for a stale active-job completion", async () => {
    const job = deferred<LoadedGltfImageSource>();
    loadRecipeMock.mockImplementation(() => job.promise);
    const closeSource = vi.fn<(value: LoadedTextureSource) => void>()
      .mockImplementationOnce(() => { throw new Error("stale close failed"); })
      .mockImplementationOnce(() => { throw new Error("stale close still failed"); })
      .mockImplementation(() => undefined);
    const harness = coordinatorHarness({ closeSource });
    const ownership = recipeLease();
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("stale-close-retry")],
      recipeLease: ownership,
      recipes: [recipe("stale-close-retry")],
      stateInstanceKey: 1,
    });
    demandImages(harness.coordinator, "asset", "stale-close-retry");
    await flushMicrotasks();
    harness.coordinator.releaseAsset("asset");

    const stale = loaded("stale-close-retry").image;
    job.resolve({ image: stale });
    await flushMicrotasks();

    expect(harness.retainSource).not.toHaveBeenCalled();
    expect(closeSource).toHaveBeenCalledTimes(2);
    expect(ownership.release).toHaveBeenCalledOnce();

    harness.coordinator.wake();
    harness.coordinator.wake();

    expect(closeSource).toHaveBeenCalledTimes(3);
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([]);
    harness.coordinator.dispose();
  });

  it("transfers a lease exactly once when retainSource replaces the active generation", async () => {
    loadRecipeMock.mockResolvedValue(loaded("retain-reentrant"));
    let coordinator!: GltfImageDemandCoordinator;
    const release = vi.fn<() => boolean>(() => true);
    const harness = coordinatorHarness({
      retainSource: () => {
        coordinator.releaseAsset("asset");
        return { release };
      },
    });
    coordinator = harness.coordinator;
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("retain-reentrant")],
      recipeLease: recipeLease(),
      recipes: [recipe("retain-reentrant")],
      stateInstanceKey: 1,
    });

    demandImages(harness.coordinator, "asset", "retain-reentrant");
    await flushMicrotasks();

    expect(release).toHaveBeenCalledOnce();
    expect(harness.closeSource).toHaveBeenCalledOnce();
    expect(harness.coordinator.snapshot()).toMatchObject({ candidates: 0, ready: 0 });
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([]);
    harness.coordinator.dispose();
  });

  it("retains a ready source while publication retries", async () => {
    loadRecipeMock.mockResolvedValue(loaded("retry"));
    const harness = coordinatorHarness();
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("retry")],
      recipeLease: recipeLease(),
      recipes: [recipe("retry")],
      stateInstanceKey: 11,
    });
    demandImages(harness.coordinator, "asset", "retry");
    await flushMicrotasks();

    const publish = (fail: boolean): void => {
      const [outcome] = harness.coordinator.pendingReadyOutcomes();
      expect(outcome).toBeDefined();
      if (fail) throw new Error("transient prepared texture publication failure");
      outcome!.acknowledge();
    };

    expect(() => publish(true)).toThrow("transient prepared texture publication failure");
    const retainedOutcome = harness.coordinator.pendingReadyOutcomes()[0]!;
    const release = harness.leaseReleases.get(retainedOutcome.source)!;
    expect(release).not.toHaveBeenCalled();
    expect(harness.closeSource).not.toHaveBeenCalled();

    publish(false);

    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([]);
    expect(release).toHaveBeenCalledOnce();
    expect(harness.closeSource).toHaveBeenCalledOnce();
    expect(harness.closeSource).toHaveBeenCalledWith(retainedOutcome.source);
    harness.coordinator.dispose();
  });

  it("charges shared restorable recipe buffers once until the asset releases", async () => {
    const sharedBytes = new ArrayBuffer(64);
    loadRecipeMock.mockImplementation(async (value) => loaded(value.key));
    const harness = coordinatorHarness();
    const ownership = recipeLease();
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("first", "second")],
      recipeLease: ownership,
      recipes: [byteRecipe("first", sharedBytes), byteRecipe("second", sharedBytes)],
      stateInstanceKey: 4,
    });
    expect(ownership.resize.mock.calls).toEqual([[64]]);

    demandImages(harness.coordinator, "asset", "first");
    await flushMicrotasks();
    expect(harness.coordinator.snapshot()).toMatchObject({ dormant: 1, ready: 1 });
    expect(ownership.resize.mock.calls).toEqual([[64]]);
    expect(ownership.release).not.toHaveBeenCalled();

    demandImages(harness.coordinator, "asset", "second");
    await flushMicrotasks();
    expect(ownership.resize.mock.calls).toEqual([[64]]);
    expect(ownership.release).not.toHaveBeenCalled();
    harness.coordinator.dispose();
    expect(ownership.release).toHaveBeenCalledOnce();
  });

  it("re-decodes one retained embedded recipe when its prepared texture is requested again", async () => {
    const bytes = new ArrayBuffer(32);
    loadRecipeMock.mockImplementation(async (value) => loaded(value.key));
    const harness = coordinatorHarness();
    const load = metrics();
    const ownership = recipeLease();
    harness.coordinator.registerAsset({
      key: "asset",
      load,
      materials: [material("restorable")],
      recipeLease: ownership,
      recipes: [byteRecipe("restorable", bytes)],
      stateInstanceKey: 4,
    });

    demandImages(harness.coordinator, "asset", "restorable");
    await flushMicrotasks();
    harness.coordinator.pendingReadyOutcomes()[0]!.acknowledge();
    expect(load).toMatchObject({ imageFailures: 0, imageLoaded: 1, imageRequests: 1 });

    const texture = {
      colorSpace: "srgb",
      kind: "asset",
      preparedOnly: true,
      releaseSourceAfterUpload: true,
      src: "texture:restorable",
    } as const;
    expect(harness.coordinator.recoverPreparedTexture(texture)).toBe(true);
    expect(harness.coordinator.recoverPreparedTexture(texture)).toBe(false);
    expect(load).toMatchObject({ imageFailures: 0, imageLoaded: 0, imageRequests: 1 });
    await flushMicrotasks();

    expect(loadRecipeMock).toHaveBeenCalledTimes(2);
    expect(load).toMatchObject({ imageFailures: 0, imageLoaded: 1, imageRequests: 1 });
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([
      expect.objectContaining({ key: "restorable" }),
    ]);
    expect(ownership.resize.mock.calls).toEqual([[32]]);
    harness.coordinator.dispose();
  });

  it("loads two visible base colors concurrently before each material's refinement maps", async () => {
    const jobs = new Map([
      ["base-a", deferred<LoadedGltfImageSource>()],
      ["base-b", deferred<LoadedGltfImageSource>()],
      ["emissive-a", deferred<LoadedGltfImageSource>()],
      ["emissive-b", deferred<LoadedGltfImageSource>()],
    ]);
    loadRecipeMock.mockImplementation((value) => jobs.get(value.key)!.promise);
    const first = material("base-a", "emissive-a");
    const second = material("base-b", "emissive-b");
    const harness = coordinatorHarness();
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [first, second],
      recipeLease: recipeLease(),
      recipes: [...jobs.keys()].map(recipe),
      stateInstanceKey: 1,
    });

    harness.coordinator.demandMaterial("asset", first);
    harness.coordinator.demandMaterial("asset", second);
    await flushMicrotasks();
    expect(loadRecipeMock.mock.calls.map(([value]) => value.key)).toEqual(["base-a", "base-b"]);
    expect(harness.coordinator.snapshot()).toMatchObject({ dormant: 2, loading: 2, queued: 0 });

    jobs.get("base-a")!.resolve(loaded("base-a"));
    await flushSchedulerTurn();
    expect(loadRecipeMock.mock.calls.map(([value]) => value.key)).toEqual([
      "base-a",
      "base-b",
      "emissive-a",
    ]);

    jobs.get("base-b")!.resolve(loaded("base-b"));
    await flushSchedulerTurn();
    expect(loadRecipeMock.mock.calls.map(([value]) => value.key)).toEqual([
      "base-a",
      "base-b",
      "emissive-a",
      "emissive-b",
    ]);

    jobs.get("emissive-a")!.resolve(loaded("emissive-a"));
    await flushSchedulerTurn();
    jobs.get("emissive-b")!.resolve(loaded("emissive-b"));
    await flushSchedulerTurn();
    expect(harness.coordinator.snapshot()).toMatchObject({ dormant: 0, loading: 0, queued: 0, ready: 4 });
    for (const outcome of harness.coordinator.pendingReadyOutcomes()) outcome.acknowledge();
    harness.coordinator.dispose();
  });

  it("keeps ordinary transport and decode independently paused behind backpressure", async () => {
    let transportAllowed = false;
    let decodeAllowed = false;
    const imageRecipe = recipe("bounded");
    const prepareRecipe = vi.fn(async () => ({
      ...preparedGltfImageSourceRecipeWithoutTransport(imageRecipe),
      transportBytes: 4,
    }));
    const decodeRecipe = vi.fn(async () => loaded("bounded"));
    const harness = coordinatorHarness({
      admitOrdinaryDecode: () => decodeAllowed ? { release: vi.fn() } : undefined,
      admitOrdinaryTransport: () => transportAllowed ? { release: vi.fn() } : undefined,
      decodeRecipe,
      prepareRecipe,
      reserveTransportBytes: () => ({ release: vi.fn() }),
    });
    const boundedMaterial = material("bounded");
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [boundedMaterial],
      recipeLease: recipeLease(),
      recipes: [imageRecipe],
      stateInstanceKey: 1,
    });

    harness.coordinator.demandMaterial("asset", boundedMaterial);
    await flushMicrotasks();
    expect(prepareRecipe).not.toHaveBeenCalled();

    transportAllowed = true;
    harness.coordinator.wake();
    await flushSchedulerTurn();
    expect(prepareRecipe).toHaveBeenCalledOnce();
    expect(decodeRecipe).not.toHaveBeenCalled();

    decodeAllowed = true;
    harness.coordinator.wake();
    await flushSchedulerTurn();
    expect(decodeRecipe).toHaveBeenCalledOnce();
    expect(harness.coordinator.snapshot()).toMatchObject({ ready: 1 });
    for (const outcome of harness.coordinator.pendingReadyOutcomes()) outcome.acknowledge();
    harness.coordinator.dispose();
  });

  it("overlaps transport while preserving demand-ordered decode and exact byte leases", async () => {
    await forEachFuzzCaseAsync({ cases: 8, seed: 0x1a6e_7a4e }, async ({ random }) => {
      const keys = ["first", "second", "third", "fourth"];
      const transportOrder = [...keys];
      for (let index = transportOrder.length - 1; index > 0; index -= 1) {
        const swap = random.int(0, index + 1);
        [transportOrder[index], transportOrder[swap]] = [transportOrder[swap]!, transportOrder[index]!];
      }
      const recipes = new Map(keys.map((key) => [key, recipe(key)]));
      const transports = new Map(keys.map((key) => [key, deferred<PreparedGltfImageSourceRecipe>()]));
      const decodes = new Map(keys.map((key) => [key, deferred<LoadedGltfImageSource>()]));
      const bytes = new Map(keys.map((key, index) => [key, (index + 1) * 10]));
      const prepareRecipe = vi.fn((value: GltfImageSourceRecipe) => transports.get(value.key)!.promise);
      const decodeRecipe = vi.fn((value: PreparedGltfImageSourceRecipe) =>
        decodes.get(value.recipe.key)!.promise);
      const transportReleases = new Map<number, ReturnType<typeof vi.fn<() => void>>>();
      const reserveTransportBytes = vi.fn((size: number) => {
        const release = vi.fn<() => void>();
        transportReleases.set(size, release);
        return { release };
      });
      const harness = coordinatorHarness({ decodeRecipe, prepareRecipe, reserveTransportBytes });
      const materials = keys.map((key) => material(key));
      harness.coordinator.registerAsset({
        key: "asset",
        load: metrics(),
        materials,
        recipeLease: recipeLease(),
        recipes: keys.map((key) => recipes.get(key)!),
        stateInstanceKey: 1,
      });

      for (const imageMaterial of materials) harness.coordinator.demandMaterial("asset", imageMaterial);
      expect(prepareRecipe.mock.calls.map(([value]) => value.key)).toEqual(keys);

      for (const key of transportOrder) {
        transports.get(key)!.resolve({
          ...preparedGltfImageSourceRecipeWithoutTransport(recipes.get(key)!),
          transportBytes: bytes.get(key)!,
        });
        await flushMicrotasks();
      }
      expect(reserveTransportBytes.mock.calls.map(([size]) => size))
        .toEqual(transportOrder.map((key) => bytes.get(key)));
      expect(decodeRecipe.mock.calls.map(([value]) => value.recipe.key)).toEqual(keys.slice(0, 2));

      for (const [index, key] of keys.entries()) {
        decodes.get(key)!.resolve(loaded(key));
        await flushSchedulerTurn();
        await flushSchedulerTurn();
        expect(transportReleases.get(bytes.get(key)!)).toHaveBeenCalledOnce();
        expect(decodeRecipe.mock.calls.map(([value]) => value.recipe.key))
          .toEqual(keys.slice(0, index + 3));
      }
      expect(harness.coordinator.snapshot()).toMatchObject({ loading: 0, queued: 0, ready: keys.length });
      for (const outcome of harness.coordinator.pendingReadyOutcomes()) outcome.acknowledge();
      harness.coordinator.dispose();
    });
  });

  it("settles byte-admission denial without entering decode or leaking recipe ownership", async () => {
    const deniedMaterial = material("denied-transport");
    const deniedRecipe = recipe("denied-transport");
    const ownership = recipeLease();
    const decodeRecipe = vi.fn(async () => loaded("must-not-decode"));
    const harness = coordinatorHarness({
      decodeRecipe,
      prepareRecipe: async () => ({
        ...preparedGltfImageSourceRecipeWithoutTransport(deniedRecipe),
        transportBytes: 32,
      }),
      reserveTransportBytes: () => { throw new Error("transport bytes denied"); },
    });
    const load = metrics();
    harness.coordinator.registerAsset({
      key: "asset",
      load,
      materials: [deniedMaterial],
      recipeLease: ownership,
      recipes: [deniedRecipe],
      stateInstanceKey: 1,
    });

    harness.coordinator.demandMaterial("asset", deniedMaterial);
    await flushMicrotasks();

    expect(decodeRecipe).not.toHaveBeenCalled();
    expect(load).toMatchObject({ imageFailures: 1, imageLoaded: 0, imageRequests: 1 });
    expect(harness.coordinator.snapshot()).toMatchObject({ active: 0, errors: 1, loading: 0 });
    expect(harness.diagnostic).toHaveBeenCalledWith(
      expect.stringContaining("transport bytes denied"),
      "denied-transport",
    );
    expect(ownership.release).toHaveBeenCalledOnce();
    harness.coordinator.dispose();
  });

  it("keeps queued and active recipe bytes charged until cancellation settles each job", async () => {
    const active = deferred<LoadedGltfImageSource>();
    loadRecipeMock.mockImplementation((value) => {
      if (value.key === "active") return active.promise;
      throw new Error(`queued recipe ${value.key} must not start`);
    });
    const harness = coordinatorHarness();
    const ownership = recipeLease();
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("active", "queued")],
      recipeLease: ownership,
      recipes: [
        byteRecipe("active", new ArrayBuffer(10)),
        byteRecipe("queued", new ArrayBuffer(20)),
      ],
      stateInstanceKey: 5,
    });
    demandImages(harness.coordinator, "asset", "active", "queued");
    await flushMicrotasks();
    expect(harness.coordinator.snapshot()).toMatchObject({ active: 1, dormant: 1, loading: 1, queued: 0 });

    harness.coordinator.releaseAsset("asset");
    expect(ownership.resize.mock.calls).toEqual([[30], [10]]);
    expect(ownership.release).not.toHaveBeenCalled();
    await flushMicrotasks();
    expect(ownership.resize.mock.calls).toEqual([[30], [10]]);
    expect(ownership.release).not.toHaveBeenCalled();

    const stale = loaded("active").image;
    active.resolve({ image: stale });
    await flushMicrotasks();
    expect(ownership.resize.mock.calls).toEqual([[30], [10], [0]]);
    expect(ownership.release).toHaveBeenCalledOnce();
    expect(harness.closeSource).toHaveBeenCalledWith(stale);
    harness.coordinator.dispose();
  });

  it("automatically retries recipe cleanup that fails after a disposed job settles", async () => {
    const job = deferred<LoadedGltfImageSource>();
    loadRecipeMock.mockImplementation(() => job.promise);
    const harness = coordinatorHarness();
    const ownership = recipeLease();
    ownership.release
      .mockImplementationOnce(() => { throw new Error("post-dispose release failed"); })
      .mockImplementation(() => undefined);
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("post-dispose")],
      recipeLease: ownership,
      recipes: [recipe("post-dispose")],
      stateInstanceKey: 1,
    });
    demandImages(harness.coordinator, "asset", "post-dispose");
    harness.coordinator.dispose();

    expect(ownership.release).not.toHaveBeenCalled();
    job.resolve(loaded("post-dispose"));
    await flushMicrotasks();

    expect(ownership.release).toHaveBeenCalledTimes(2);
    expect(harness.diagnostic).toHaveBeenCalledWith(
      expect.stringContaining("post-dispose release failed"),
      "asset",
    );
    expect(() => harness.coordinator.dispose()).not.toThrow();
    expect(ownership.release).toHaveBeenCalledTimes(2);
  });

  it("keeps previous recipe ownership when a shrink fails and retries later", async () => {
    loadRecipeMock.mockImplementation(async (value) => loaded(value.key));
    const harness = coordinatorHarness();
    const resize = vi.fn<(retainedBytes: number) => void>()
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        harness.coordinator.wake();
        throw new Error("replacement denied");
      })
      .mockImplementation(() => undefined);
    const release = vi.fn<() => void>();
    const ownership: GltfImageRecipeLease = { release, resize };
    const embedded = material("first", "second");
    const external: LoadedGltfMaterial = {
      ...embedded,
      baseColorTexture: {
        ...embedded.baseColorTexture!,
        sourceUri: "https://example.test/first.png",
      },
      emissiveTexture: {
        ...embedded.emissiveTexture!,
        sourceUri: "https://example.test/second.png",
      },
    };
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [external],
      recipeLease: ownership,
      recipes: [
        byteRecipe("first", new ArrayBuffer(12)),
        byteRecipe("second", new ArrayBuffer(12)),
      ],
      stateInstanceKey: 6,
    });

    demandImages(harness.coordinator, "asset", "first");
    await flushMicrotasks();
    expect(resize.mock.calls).toEqual([[24], [12]]);
    expect(harness.diagnostic).toHaveBeenCalledWith(
      expect.stringContaining("replacement denied"),
      "asset",
    );
    harness.coordinator.wake();
    expect(resize.mock.calls).toEqual([[24], [12], [12]]);

    demandImages(harness.coordinator, "asset", "second");
    await flushMicrotasks();
    expect(resize.mock.calls).toEqual([[24], [12], [12], [0]]);
    expect(release).toHaveBeenCalledOnce();
    harness.coordinator.dispose();
  });

  it("installs and demands a replacement after old-generation cleanup fails", async () => {
    loadRecipeMock.mockImplementation(async (value) => loaded(value.key));
    const harness = coordinatorHarness();
    const oldOwnership = recipeLease();
    oldOwnership.release
      .mockImplementationOnce(() => {
        harness.coordinator.wake();
        throw new Error("old recipe cleanup failed");
      })
      .mockImplementation(() => undefined);
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("old")],
      recipeLease: oldOwnership,
      recipes: [recipe("old")],
      stateInstanceKey: 1,
    });

    const replacementLoad = metrics();
    const replacementOwnership = recipeLease();
    harness.coordinator.registerAsset({
      key: "asset",
      load: replacementLoad,
      materials: [material("replacement")],
      recipeLease: replacementOwnership,
      recipes: [recipe("replacement")],
      stateInstanceKey: 2,
    });

    expect(oldOwnership.release).toHaveBeenCalledOnce();
    expect(harness.diagnostic).toHaveBeenCalledWith(
      "glTF image replacement failed for asset: old recipe cleanup failed",
      "asset",
    );
    expect(harness.coordinator.snapshot()).toMatchObject({ candidates: 1, dormant: 1 });

    harness.coordinator.wake();
    harness.coordinator.wake();
    expect(oldOwnership.release).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.snapshot()).toMatchObject({ candidates: 1, dormant: 1 });

    demandImages(harness.coordinator, "asset", "replacement");
    await flushMicrotasks();

    expect(replacementLoad).toMatchObject({ imageFailures: 0, imageLoaded: 1, imageRequests: 1 });
    expect(harness.coordinator.readyKeys("asset").has("replacement")).toBe(true);
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([
      expect.objectContaining({ assetKey: "asset", key: "replacement", stateInstanceKey: 2 }),
    ]);
    harness.coordinator.dispose();
  });

  it("does not publish a registration when its initial resize reentrantly disposes the coordinator", () => {
    const harness = coordinatorHarness();
    const ownership = recipeLease();
    ownership.resize.mockImplementationOnce(() => harness.coordinator.dispose());

    expect(() => harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("disposed-during-resize")],
      recipeLease: ownership,
      recipes: [recipe("disposed-during-resize")],
      stateInstanceKey: 1,
    })).toThrow("glTF image registration superseded for asset");

    expect(ownership.resize).toHaveBeenCalledOnce();
    expect(ownership.release).toHaveBeenCalledOnce();
    expect(harness.coordinator.snapshot()).toMatchObject({
      active: 0,
      candidates: 0,
      dormant: 0,
      loading: 0,
      queued: 0,
      ready: 0,
    });
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([]);
    expect(() => harness.coordinator.dispose()).not.toThrow();
    expect(ownership.release).toHaveBeenCalledOnce();
  });

  it("does not overwrite a replacement registered reentrantly by the outer initial resize", async () => {
    loadRecipeMock.mockImplementation(async (value) => loaded(value.key));
    const harness = coordinatorHarness();
    const outerOwnership = recipeLease();
    const replacementOwnership = recipeLease();
    const replacementLoad = metrics();
    outerOwnership.resize.mockImplementationOnce(() => {
      harness.coordinator.registerAsset({
        key: "asset",
        load: replacementLoad,
        materials: [material("replacement")],
        recipeLease: replacementOwnership,
        recipes: [recipe("replacement")],
        stateInstanceKey: 2,
      });
    });

    expect(() => harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("outer")],
      recipeLease: outerOwnership,
      recipes: [recipe("outer")],
      stateInstanceKey: 1,
    })).toThrow("glTF image registration superseded for asset");

    expect(outerOwnership.resize).toHaveBeenCalledOnce();
    expect(outerOwnership.release).toHaveBeenCalledOnce();
    expect(replacementOwnership.resize).toHaveBeenCalledOnce();
    expect(replacementOwnership.release).not.toHaveBeenCalled();
    expect(harness.coordinator.snapshot()).toMatchObject({ candidates: 1, dormant: 1 });

    demandImages(harness.coordinator, "asset", "replacement");
    await flushMicrotasks();

    expect(replacementLoad).toMatchObject({ imageFailures: 0, imageLoaded: 1, imageRequests: 1 });
    expect(harness.coordinator.readyKeys("asset").has("outer")).toBe(false);
    expect(harness.coordinator.readyKeys("asset").has("replacement")).toBe(true);
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([
      expect.objectContaining({ assetKey: "asset", key: "replacement", stateInstanceKey: 2 }),
    ]);
    expect(replacementOwnership.release).toHaveBeenCalledOnce();

    harness.coordinator.pendingReadyOutcomes()[0]!.acknowledge();
    harness.coordinator.dispose();
    expect(outerOwnership.release).toHaveBeenCalledOnce();
    expect(replacementOwnership.release).toHaveBeenCalledOnce();
  });

  it("isolates replacement cleanup diagnostics from the new generation", () => {
    const harness = coordinatorHarness({
      diagnostic: () => { throw new Error("diagnostic observer failed"); },
    });
    const oldOwnership = recipeLease();
    oldOwnership.release
      .mockImplementationOnce(() => { throw new Error("old cleanup failed"); })
      .mockImplementation(() => undefined);
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("old")],
      recipeLease: oldOwnership,
      recipes: [recipe("old")],
      stateInstanceKey: 1,
    });

    expect(() => harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("replacement")],
      recipeLease: recipeLease(),
      recipes: [recipe("replacement")],
      stateInstanceKey: 2,
    })).not.toThrow();

    expect(harness.coordinator.snapshot()).toMatchObject({ candidates: 1, dormant: 1 });
    harness.coordinator.wake();
    expect(oldOwnership.release).toHaveBeenCalledTimes(2);
    harness.coordinator.dispose();
  });

  it("automatically retries only the close phase after final source release succeeds", async () => {
    loadRecipeMock.mockResolvedValue(loaded("close-retry"));
    let coordinator!: GltfImageDemandCoordinator;
    const closeSource = vi.fn<(value: LoadedTextureSource) => void>()
      .mockImplementationOnce(() => {
        coordinator.wake();
        throw new Error("decoded close failed");
      })
      .mockImplementation(() => undefined);
    const sourceRelease = vi.fn<() => boolean>(() => {
      coordinator.wake();
      return true;
    });
    const harness = coordinatorHarness({
      closeSource,
      retainSource: () => ({ release: sourceRelease }),
    });
    coordinator = harness.coordinator;
    harness.coordinator.registerAsset({
      key: "asset",
      load: metrics(),
      materials: [material("close-retry")],
      recipeLease: recipeLease(),
      recipes: [recipe("close-retry")],
      stateInstanceKey: 1,
    });
    demandImages(harness.coordinator, "asset", "close-retry");
    await flushMicrotasks();

    expect(() => harness.coordinator.releaseAsset("asset")).toThrow("decoded close failed");
    expect(harness.coordinator.snapshot()).toMatchObject({ candidates: 0, ready: 0 });
    expect(sourceRelease).toHaveBeenCalledOnce();
    expect(closeSource).toHaveBeenCalledOnce();

    await flushMicrotasks();

    expect(sourceRelease).toHaveBeenCalledOnce();
    expect(closeSource).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([]);
    harness.coordinator.dispose();
  });

  it("exhausts disposal after cleanup failures and remains idempotent", async () => {
    loadRecipeMock.mockImplementation(async (value) => loaded(value.key));
    const firstSource = source("first-source");
    const firstSourceRelease = vi.fn<() => boolean>()
      .mockImplementationOnce(() => { throw new Error("first source cleanup failed"); })
      .mockImplementation(() => true);
    const secondSourceRelease = vi.fn<() => boolean>(() => true);
    const harness = coordinatorHarness({
      retainSource: (value) => ({
        release: value === firstSource ? firstSourceRelease : secondSourceRelease,
      }),
    });
    loadRecipeMock.mockImplementation(async (value) => ({
      ...loaded(value.key),
      image: value.key === "first" ? firstSource : source(value.key),
    }));
    const firstOwnership = recipeLease();
    const secondOwnership = recipeLease();
    const dormantOwnership = recipeLease();
    const secondIbl = imageBasedLight("second");
    dormantOwnership.release
      .mockImplementationOnce(() => { throw new Error("later recipe cleanup failed"); })
      .mockImplementation(() => undefined);
    harness.coordinator.registerAsset({
      key: "first-asset",
      load: metrics(),
      materials: [material("first")],
      recipeLease: firstOwnership,
      recipes: [recipe("first")],
      stateInstanceKey: 1,
    });
    harness.coordinator.registerAsset({
      imageBasedLight: secondIbl.light,
      key: "second-asset",
      load: metrics(),
      materials: [],
      recipeLease: secondOwnership,
      recipes: [recipe("second")],
      stateInstanceKey: 2,
    });
    harness.coordinator.registerAsset({
      key: "dormant-asset",
      load: metrics(),
      materials: [material("dormant")],
      recipeLease: dormantOwnership,
      recipes: [recipe("dormant")],
      stateInstanceKey: 3,
    });
    demandImages(harness.coordinator, "first-asset", "first");
    await flushMicrotasks();
    await flushMicrotasks();
    expect(harness.coordinator.pendingReadyOutcomes()).toHaveLength(2);

    expect(() => harness.coordinator.dispose()).toThrow("first source cleanup failed");

    expect(firstSourceRelease).toHaveBeenCalledOnce();
    expect(secondSourceRelease).toHaveBeenCalledOnce();
    expect(harness.closeSource).toHaveBeenCalledWith(
      expect.objectContaining({ key: "second" }),
    );
    expect(dormantOwnership.release).toHaveBeenCalledOnce();
    expect(harness.coordinator.snapshot()).toMatchObject({
      active: 0,
      candidates: 0,
      dormant: 0,
      loading: 0,
      queued: 0,
      ready: 0,
    });
    expect(harness.coordinator.pendingReadyOutcomes()).toEqual([]);
    expect(() => harness.coordinator.registerAsset({
      key: "after-dispose",
      load: metrics(),
      materials: [],
      recipeLease: recipeLease(),
      recipes: [],
      stateInstanceKey: 4,
    })).toThrow("glTF image coordinator disposed");

    expect(() => harness.coordinator.dispose()).not.toThrow();
    expect(firstSourceRelease).toHaveBeenCalledTimes(2);
    expect(secondSourceRelease).toHaveBeenCalledOnce();
    expect(dormantOwnership.release).toHaveBeenCalledTimes(2);
    expect(harness.closeSource).toHaveBeenCalledWith(firstSource);

    expect(() => harness.coordinator.dispose()).not.toThrow();
    expect(firstSourceRelease).toHaveBeenCalledTimes(2);
    expect(secondSourceRelease).toHaveBeenCalledOnce();
    expect(dormantOwnership.release).toHaveBeenCalledTimes(2);
  });
});
