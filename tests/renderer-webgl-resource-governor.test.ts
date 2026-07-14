import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESOURCE_GOVERNOR_POLICY,
  RESOURCE_GOVERNOR_CLASSES,
  beginResourceGovernorFrame,
  createResourceGovernor,
  defineResourceGovernorPolicy,
  evaluateResourceGovernorAdmission,
  maximumResourceGovernorClassDurableBytes,
  reserveResourceGovernor,
  replaceResourceGovernorLease,
  resourceGovernorSnapshot,
  setResourceGovernorObservedDurableUsage,
  subscribeResourceGovernorDurableCapacityRelease,
  type ResourceGovernorClassPolicy,
  type ResourceGovernorPolicy,
  type ResourceGovernorReservation,
} from "../packages/renderer-webgl/src/resource-governor";
import { forEachFuzzCase } from "./fuzz";

const classPolicy = (
  gpuFloor = 0,
  _gpuSoft = 100,
  cpuFloor = 0,
  _cpuSoft = 100,
): ResourceGovernorClassPolicy => ({
  cpuDecodedBytes: { mandatoryFloor: cpuFloor },
  persistentGpuBytes: { mandatoryFloor: gpuFloor },
});

const policy = (overrides: Partial<ResourceGovernorPolicy["limits"]> = {}): ResourceGovernorPolicy => ({
  classes: {
    "asset-decode": classPolicy(),
    geometry: classPolicy(),
    "ordinary-texture": classPolicy(),
    "render-target": classPolicy(),
    "virtual-texture": classPolicy(),
  },
  limits: {
    cpuDecodedBytes: 100,
    jobs: 4,
    persistentGpuBytes: 100,
    transientPeakBytes: 50,
    uploadBytes: 40,
    ...overrides,
  },
});

const reservation = (value: ResourceGovernorReservation | string): ResourceGovernorReservation => {
  expect(typeof value).not.toBe("string");
  return value as ResourceGovernorReservation;
};

describe("root resource governor", () => {
  it("rejects a zero-job policy because no decode request could ever progress", () => {
    expect(() => createResourceGovernor(policy({ jobs: 0 })))
      .toThrow("jobs capacity must be at least 1");
  });
  it("exports a deeply immutable default policy", () => {
    expect(Object.isFrozen(DEFAULT_RESOURCE_GOVERNOR_POLICY)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RESOURCE_GOVERNOR_POLICY.classes)).toBe(true);
    expect(Object.isFrozen(DEFAULT_RESOURCE_GOVERNOR_POLICY.classes.geometry)).toBe(true);
    expect(Object.isFrozen(
      DEFAULT_RESOURCE_GOVERNOR_POLICY.classes.geometry.persistentGpuBytes,
    )).toBe(true);
    expect(Object.isFrozen(DEFAULT_RESOURCE_GOVERNOR_POLICY.limits)).toBe(true);
  });

  it("defines a complete immutable policy from concise nested overrides", () => {
    const configured = defineResourceGovernorPolicy({
      classes: {
        "virtual-texture": {
          persistentGpuBytes: { hardLimit: 96, mandatoryFloor: 80 },
        },
      },
      limits: { jobs: 3, persistentGpuBytes: 128 },
    });

    expect(configured).toMatchObject({
      classes: {
        geometry: DEFAULT_RESOURCE_GOVERNOR_POLICY.classes.geometry,
        "virtual-texture": {
          persistentGpuBytes: {
            hardLimit: 96,
            mandatoryFloor: 80,
          },
        },
      },
      limits: {
        ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits,
        jobs: 3,
        persistentGpuBytes: 128,
      },
    });
    expect(Object.isFrozen(configured)).toBe(true);
    expect(Object.isFrozen(configured.classes["virtual-texture"].persistentGpuBytes)).toBe(true);
    expect(Object.isFrozen(configured.limits)).toBe(true);
  });

  it("ignores unknown or undefined runtime limit overrides", () => {
    const noisy = {
      limits: { ignored: 1, jobs: undefined },
    } as unknown as Parameters<typeof defineResourceGovernorPolicy>[0];
    const configured = defineResourceGovernorPolicy(noisy);

    expect(configured.limits).toEqual(DEFAULT_RESOURCE_GOVERNOR_POLICY.limits);
    expect(configured.limits).not.toHaveProperty("ignored");
    expect(() => createResourceGovernor(configured)).not.toThrow();
  });

  it("makes admission a pure all-dimension decision", () => {
    const configured = policy();
    const zero = {
      byClass: {
        "asset-decode": { cpuDecodedBytes: 0, jobs: 0, persistentGpuBytes: 0, transientPeakBytes: 0, uploadBytes: 0 },
        geometry: { cpuDecodedBytes: 0, jobs: 0, persistentGpuBytes: 0, transientPeakBytes: 0, uploadBytes: 0 },
        "ordinary-texture": { cpuDecodedBytes: 0, jobs: 0, persistentGpuBytes: 0, transientPeakBytes: 0, uploadBytes: 0 },
        "render-target": { cpuDecodedBytes: 0, jobs: 0, persistentGpuBytes: 0, transientPeakBytes: 0, uploadBytes: 0 },
        "virtual-texture": { cpuDecodedBytes: 0, jobs: 0, persistentGpuBytes: 0, transientPeakBytes: 0, uploadBytes: 0 },
      },
      total: { cpuDecodedBytes: 0, jobs: 0, persistentGpuBytes: 0, transientPeakBytes: 0, uploadBytes: 0 },
    } as const;
    expect(evaluateResourceGovernorAdmission(configured, zero, "geometry", {
      cpuDecodedBytes: 1, jobs: 1, persistentGpuBytes: 1, transientPeakBytes: 1, uploadBytes: 1,
    })).toMatchObject({ admitted: true });
    expect(evaluateResourceGovernorAdmission(configured, zero, "geometry", { transientPeakBytes: 51 }))
      .toMatchObject({ admitted: false, reason: "transient-peak-capacity" });
    expect(evaluateResourceGovernorAdmission(configured, zero, "geometry", { uploadBytes: 41 }))
      .toMatchObject({ admitted: false, reason: "upload-capacity" });
    expect(evaluateResourceGovernorAdmission(configured, zero, "geometry", { jobs: 5 }))
      .toMatchObject({ admitted: false, reason: "job-capacity" });
    expect(zero.total).toEqual({
      cpuDecodedBytes: 0, jobs: 0, persistentGpuBytes: 0, transientPeakBytes: 0, uploadBytes: 0,
    });
  });

  it("protects other classes' mandatory floors while allowing soft-budget borrowing", () => {
    const base = policy();
    const configured: ResourceGovernorPolicy = {
      ...base,
      classes: {
        ...base.classes,
        geometry: classPolicy(0, 25, 0, 25),
        "virtual-texture": classPolicy(30, 40, 20, 30),
      },
    };
    const governor = createResourceGovernor(configured);

    const borrowed = reserveResourceGovernor(governor, "geometry", {
      cpuDecodedBytes: 70,
      persistentGpuBytes: 70,
    });
    expect(typeof borrowed).not.toBe("string");
    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      total: { cpuDecodedBytes: 70, persistentGpuBytes: 70 },
    });
    expect(reserveResourceGovernor(governor, "geometry", { persistentGpuBytes: 1 }))
      .toBe("persistent-gpu-mandatory-floor");
    reservation(borrowed).cancel();

    const virtualTexture = reservation(reserveResourceGovernor(governor, "virtual-texture", {
      cpuDecodedBytes: 20,
      persistentGpuBytes: 30,
    }));
    virtualTexture.commit();
    const geometry = reservation(reserveResourceGovernor(governor, "geometry", {
      persistentGpuBytes: 70,
    }));
    expect(resourceGovernorSnapshot(governor).total.persistentGpuBytes).toBe(100);
    geometry.cancel();
  });

  it("uses optional per-class hard ceilings without disabling borrowing below them", () => {
    const base = policy();
    const configured: ResourceGovernorPolicy = {
      ...base,
      classes: {
        ...base.classes,
        "ordinary-texture": classPolicy(20, 30, 10, 20),
        "virtual-texture": {
          cpuDecodedBytes: { hardLimit: 55, mandatoryFloor: 0 },
          persistentGpuBytes: { hardLimit: 60, mandatoryFloor: 0 },
        },
      },
    };
    const governor = createResourceGovernor(configured);

    expect(maximumResourceGovernorClassDurableBytes(
      configured,
      "virtual-texture",
      "persistentGpuBytes",
    )).toBe(60);
    expect(maximumResourceGovernorClassDurableBytes(
      configured,
      "geometry",
      "persistentGpuBytes",
    )).toBe(80);
    const borrowed = reservation(reserveResourceGovernor(governor, "virtual-texture", {
      cpuDecodedBytes: 55,
      persistentGpuBytes: 60,
    })).commit();
    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      maximumDurableBytesByClass: {
        geometry: { persistentGpuBytes: 80 },
        "virtual-texture": { cpuDecodedBytes: 55, persistentGpuBytes: 60 },
      },
    });
    expect(reserveResourceGovernor(governor, "virtual-texture", { persistentGpuBytes: 1 }))
      .toBe("persistent-gpu-hard-limit");
    expect(reserveResourceGovernor(governor, "virtual-texture", { cpuDecodedBytes: 1 }))
      .toBe("cpu-decoded-hard-limit");
    const otherClass = reservation(reserveResourceGovernor(governor, "geometry", {
      persistentGpuBytes: 20,
    }));
    otherClass.cancel();
    borrowed.release();
  });

  it("applies class hard ceilings atomically when replacing a durable lease", () => {
    const base = policy({ transientPeakBytes: 100 });
    const configured: ResourceGovernorPolicy = {
      ...base,
      classes: {
        ...base.classes,
        "virtual-texture": {
          ...base.classes["virtual-texture"],
          persistentGpuBytes: { hardLimit: 60, mandatoryFloor: 0 },
        },
      },
    };
    const governor = createResourceGovernor(configured);
    const original = reservation(reserveResourceGovernor(governor, "virtual-texture", {
      persistentGpuBytes: 40,
    })).commit();

    expect(replaceResourceGovernorLease(governor, original, {
      persistentGpuBytes: 61,
      transientPeakBytes: 20,
    })).toBe("persistent-gpu-hard-limit");
    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      outstandingLeases: 1,
      outstandingReservations: 0,
      total: { persistentGpuBytes: 40, transientPeakBytes: 0 },
    });
    const replacement = reservation(replaceResourceGovernorLease(governor, original, {
      persistentGpuBytes: 60,
      transientPeakBytes: 20,
    })).commit();
    expect(resourceGovernorSnapshot(governor).total.persistentGpuBytes).toBe(60);
    replacement.release();
  });

  it("rolls back cancelled work and leases committed durable ownership", () => {
    const governor = createResourceGovernor(policy());
    const cancelled = reservation(reserveResourceGovernor(governor, "asset-decode", {
      cpuDecodedBytes: 12,
      jobs: 1,
      transientPeakBytes: 8,
      uploadBytes: 6,
    }));
    expect(resourceGovernorSnapshot(governor).total).toEqual({
      cpuDecodedBytes: 12, jobs: 1, persistentGpuBytes: 0, transientPeakBytes: 8, uploadBytes: 6,
    });
    expect(cancelled.cancel()).toBe(true);
    expect(cancelled.cancel()).toBe(false);
    expect(resourceGovernorSnapshot(governor).total).toEqual({
      cpuDecodedBytes: 0, jobs: 0, persistentGpuBytes: 0, transientPeakBytes: 0, uploadBytes: 0,
    });

    const committed = reservation(reserveResourceGovernor(governor, "ordinary-texture", {
      cpuDecodedBytes: 12,
      jobs: 1,
      persistentGpuBytes: 16,
      transientPeakBytes: 8,
      uploadBytes: 6,
    }));
    const lease = committed.commit();
    expect(() => committed.commit()).toThrow("already settled");
    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      outstandingLeases: 1,
      outstandingReservations: 0,
      total: {
        cpuDecodedBytes: 12, jobs: 0, persistentGpuBytes: 16, transientPeakBytes: 0, uploadBytes: 6,
      },
    });
    expect(lease.release()).toBe(true);
    expect(lease.release()).toBe(false);
    expect(resourceGovernorSnapshot(governor).total).toEqual({
      cpuDecodedBytes: 0, jobs: 0, persistentGpuBytes: 0, transientPeakBytes: 0, uploadBytes: 6,
    });
  });

  it("publishes durable capacity release from leases, cancelled reservations, and observations", () => {
    const governor = createResourceGovernor(policy());
    const released: Array<{ cpuDecodedBytes: number; persistentGpuBytes: number }> = [];
    const unsubscribe = subscribeResourceGovernorDurableCapacityRelease(governor, (capacity) => {
      released.push({ ...capacity });
    });
    const cancelled = reservation(reserveResourceGovernor(governor, "geometry", {
      persistentGpuBytes: 7,
    }));
    cancelled.cancel();
    const lease = reservation(reserveResourceGovernor(governor, "ordinary-texture", {
      cpuDecodedBytes: 3,
      persistentGpuBytes: 11,
    })).commit();
    lease.release();
    setResourceGovernorObservedDurableUsage(governor, "render-target", {
      persistentGpuBytes: 13,
    });
    setResourceGovernorObservedDurableUsage(governor, "render-target", {
      persistentGpuBytes: 5,
    });
    unsubscribe();
    setResourceGovernorObservedDurableUsage(governor, "render-target", {
      persistentGpuBytes: 0,
    });

    expect(released).toEqual([
      { cpuDecodedBytes: 0, persistentGpuBytes: 7 },
      { cpuDecodedBytes: 3, persistentGpuBytes: 11 },
      { cpuDecodedBytes: 0, persistentGpuBytes: 8 },
    ]);
  });

  it("isolates notification payloads and defers subscriptions added during dispatch", () => {
    const governor = createResourceGovernor(policy());
    let mutationSucceeded: boolean | undefined;
    let lateNotifications = 0;
    let unsubscribeLate: (() => void) | undefined;
    const unsubscribeMutator = subscribeResourceGovernorDurableCapacityRelease(
      governor,
      (capacity) => {
        mutationSucceeded = Reflect.set(capacity, "persistentGpuBytes", 999);
        unsubscribeLate ??= subscribeResourceGovernorDurableCapacityRelease(governor, () => {
          lateNotifications += 1;
        });
      },
    );
    const observed: number[] = [];
    const unsubscribeObserver = subscribeResourceGovernorDurableCapacityRelease(
      governor,
      (capacity) => { observed.push(capacity.persistentGpuBytes); },
    );

    reservation(reserveResourceGovernor(governor, "geometry", {
      persistentGpuBytes: 7,
    })).cancel();
    expect(mutationSucceeded).toBe(false);
    expect(observed).toEqual([7]);
    expect(lateNotifications).toBe(0);

    reservation(reserveResourceGovernor(governor, "geometry", {
      persistentGpuBytes: 5,
    })).cancel();
    expect(observed).toEqual([7, 5]);
    expect(lateNotifications).toBe(1);

    unsubscribeMutator();
    unsubscribeObserver();
    unsubscribeLate?.();
  });

  it("releases job capacity when admitted work commits", () => {
    const governor = createResourceGovernor(policy({ jobs: 1 }));
    const first = reservation(reserveResourceGovernor(governor, "asset-decode", { jobs: 1 }));
    expect(reserveResourceGovernor(governor, "asset-decode", { jobs: 1 })).toBe("job-capacity");

    first.commit();

    expect(resourceGovernorSnapshot(governor).total.jobs).toBe(0);
    expect(typeof reserveResourceGovernor(governor, "asset-decode", { jobs: 1 })).not.toBe("string");
  });

  it("accounts upload pressure per frame and forbids ambiguous cross-frame reservations", () => {
    const governor = createResourceGovernor(policy());
    const pending = reservation(reserveResourceGovernor(governor, "geometry", { uploadBytes: 25 }));
    expect(() => beginResourceGovernorFrame(governor)).toThrow("upload reservations cannot straddle frames");
    pending.commit();
    expect(reserveResourceGovernor(governor, "geometry", { uploadBytes: 16 })).toBe("upload-capacity");
    beginResourceGovernorFrame(governor);
    expect(resourceGovernorSnapshot(governor)).toMatchObject({ frame: 1, total: { uploadBytes: 0 } });
    expect(typeof reserveResourceGovernor(governor, "geometry", { uploadBytes: 40 })).not.toBe("string");
  });

  it("allows active job reservations to span upload-accounting frames", () => {
    const governor = createResourceGovernor(policy());
    const activeJob = reservation(reserveResourceGovernor(governor, "asset-decode", { jobs: 1 }));

    expect(() => beginResourceGovernorFrame(governor)).not.toThrow();
    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      frame: 1,
      outstandingReservations: 1,
      total: { jobs: 1 },
    });
    activeJob.cancel();
    expect(resourceGovernorSnapshot(governor).total.jobs).toBe(0);
  });

  it("atomically replaces durable leases while charging full transient peak", () => {
    const governor = createResourceGovernor(policy({ transientPeakBytes: 100 }));
    const original = reservation(reserveResourceGovernor(governor, "render-target", {
      persistentGpuBytes: 60,
    })).commit();
    const growth = reservation(replaceResourceGovernorLease(governor, original, {
      persistentGpuBytes: 90,
      transientPeakBytes: 90,
      uploadBytes: 5,
    }));
    expect(resourceGovernorSnapshot(governor).total).toMatchObject({
      persistentGpuBytes: 60,
      transientPeakBytes: 90,
      uploadBytes: 5,
    });
    expect(() => original.release()).toThrow("replacement is pending");

    const grown = growth.commit();

    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      outstandingLeases: 1,
      outstandingReservations: 0,
      total: { persistentGpuBytes: 90, transientPeakBytes: 0, uploadBytes: 5 },
    });
    const denied = replaceResourceGovernorLease(governor, grown, { persistentGpuBytes: 101 });
    expect(denied).toBe("persistent-gpu-capacity");
    expect(resourceGovernorSnapshot(governor).total.persistentGpuBytes).toBe(90);

    const shrink = reservation(replaceResourceGovernorLease(governor, grown, {
      persistentGpuBytes: 20,
      transientPeakBytes: 20,
    }));
    expect(shrink.cancel()).toBe(true);
    expect(resourceGovernorSnapshot(governor).total.persistentGpuBytes).toBe(90);
    const shrinkRetry = reservation(replaceResourceGovernorLease(governor, grown, {
      persistentGpuBytes: 20,
      transientPeakBytes: 20,
    }));
    const shrunk = shrinkRetry.commit();
    expect(resourceGovernorSnapshot(governor).total.persistentGpuBytes).toBe(20);
    expect(shrunk.release()).toBe(true);
    expect(resourceGovernorSnapshot(governor).total.persistentGpuBytes).toBe(0);
  });

  it("keeps replacement ownership releasable when a capacity listener throws", () => {
    const governor = createResourceGovernor(policy({ transientPeakBytes: 100 }));
    const original = reservation(reserveResourceGovernor(governor, "render-target", {
      cpuDecodedBytes: 30,
      persistentGpuBytes: 60,
    })).commit();
    const unsubscribe = subscribeResourceGovernorDurableCapacityRelease(governor, () => {
      throw new Error("capacity listener failed");
    });
    const laterNotifications: Array<{
      cpuDecodedBytes: number;
      persistentGpuBytes: number;
    }> = [];
    const unsubscribeLater = subscribeResourceGovernorDurableCapacityRelease(governor, (released) => {
      laterNotifications.push({ ...released });
    });
    const shrink = reservation(replaceResourceGovernorLease(governor, original, {
      cpuDecodedBytes: 10,
      persistentGpuBytes: 20,
      transientPeakBytes: 20,
    }));

    const replacement = shrink.commit();
    expect(replacement).toBe(original);
    expect(laterNotifications).toEqual([{ cpuDecodedBytes: 20, persistentGpuBytes: 40 }]);
    const afterListenerFailure = resourceGovernorSnapshot(governor);
    expect(afterListenerFailure).toMatchObject({
      outstandingLeases: 1,
      outstandingReservations: 0,
    });
    expect(afterListenerFailure.total).toEqual({
      cpuDecodedBytes: 10,
      jobs: 0,
      persistentGpuBytes: 20,
      transientPeakBytes: 0,
      uploadBytes: 0,
    });

    unsubscribe();
    unsubscribeLater();
    const retry = reservation(replaceResourceGovernorLease(governor, replacement, {
      cpuDecodedBytes: 8,
      persistentGpuBytes: 16,
      transientPeakBytes: 16,
    })).commit();
    expect(retry).toBe(original);
    const afterRetry = resourceGovernorSnapshot(governor);
    expect(afterRetry).toMatchObject({
      outstandingLeases: 1,
      outstandingReservations: 0,
    });
    expect(afterRetry.total).toEqual({
      cpuDecodedBytes: 8,
      jobs: 0,
      persistentGpuBytes: 16,
      transientPeakBytes: 0,
      uploadBytes: 0,
    });
    expect(retry.release()).toBe(true);
    expect(retry.release()).toBe(false);
    const afterRelease = resourceGovernorSnapshot(governor);
    expect(afterRelease).toMatchObject({
      outstandingLeases: 0,
      outstandingReservations: 0,
    });
    expect(afterRelease.total).toEqual({
      cpuDecodedBytes: 0,
      jobs: 0,
      persistentGpuBytes: 0,
      transientPeakBytes: 0,
      uploadBytes: 0,
    });
  });

  it("keeps the old lease intact when an upload-bearing replacement cannot cross a frame", () => {
    const governor = createResourceGovernor(policy());
    const original = reservation(reserveResourceGovernor(governor, "render-target", {
      persistentGpuBytes: 40,
    })).commit();
    const replacement = reservation(replaceResourceGovernorLease(governor, original, {
      persistentGpuBytes: 60,
      uploadBytes: 5,
    }));

    expect(() => beginResourceGovernorFrame(governor)).toThrow("cannot straddle frames");
    expect(replacement.cancel()).toBe(true);
    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      outstandingLeases: 1,
      outstandingReservations: 0,
      total: { persistentGpuBytes: 40, uploadBytes: 0 },
    });
    expect(original.release()).toBe(true);
  });

  it("reports stable denial and high-water diagnostics", () => {
    const governor = createResourceGovernor(policy());
    const first = reservation(reserveResourceGovernor(governor, "render-target", {
      persistentGpuBytes: 60,
      transientPeakBytes: 30,
    }));
    expect(reserveResourceGovernor(governor, "render-target", { persistentGpuBytes: 41 }))
      .toBe("persistent-gpu-capacity");
    first.cancel();
    const snapshot = resourceGovernorSnapshot(governor);
    expect(snapshot).toMatchObject({
      admissions: 1,
      denials: 1,
      denialsByReason: { "persistent-gpu-capacity": 1 },
      highWater: { persistentGpuBytes: 60, transientPeakBytes: 30 },
      lastDenial: { reason: "persistent-gpu-capacity", resourceClass: "render-target" },
    });
  });

  it("bridges absolute observed usage without double-counting repeated samples", () => {
    const governor = createResourceGovernor(policy());
    setResourceGovernorObservedDurableUsage(governor, "virtual-texture", {
      persistentGpuBytes: 60,
    });
    setResourceGovernorObservedDurableUsage(governor, "virtual-texture", {
      persistentGpuBytes: 60,
    });
    setResourceGovernorObservedDurableUsage(governor, "ordinary-texture", {
      cpuDecodedBytes: 25,
    });
    expect(resourceGovernorSnapshot(governor).total).toMatchObject({
      cpuDecodedBytes: 25,
      persistentGpuBytes: 60,
    });
    expect(reserveResourceGovernor(governor, "geometry", { persistentGpuBytes: 41 }))
      .toBe("persistent-gpu-capacity");
    setResourceGovernorObservedDurableUsage(governor, "virtual-texture", {
      persistentGpuBytes: 10,
    });
    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      highWater: { persistentGpuBytes: 60 },
      total: { persistentGpuBytes: 10 },
    });
  });

  it("preserves safe aggregate observations at the numeric limit", () => {
    const base = policy({ cpuDecodedBytes: Number.MAX_SAFE_INTEGER });
    const configured: ResourceGovernorPolicy = {
      ...base,
      classes: {
        ...base.classes,
        geometry: classPolicy(0, 10, 0, 10),
      },
    };
    const governor = createResourceGovernor(configured);
    reservation(reserveResourceGovernor(governor, "geometry", { cpuDecodedBytes: 20 })).commit();
    reservation(reserveResourceGovernor(governor, "geometry", { jobs: 1 })).cancel();

    setResourceGovernorObservedDurableUsage(governor, "ordinary-texture", {
      cpuDecodedBytes: Number.MAX_SAFE_INTEGER - 20,
    });
    expect(() => setResourceGovernorObservedDurableUsage(governor, "virtual-texture", {
      cpuDecodedBytes: 1,
    })).toThrow("observed total cpuDecodedBytes");
    expect(resourceGovernorSnapshot(governor).total.cpuDecodedBytes).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects invalid costs and impossible floor policies", () => {
    const governor = createResourceGovernor(policy());
    expect(() => reserveResourceGovernor(governor, "geometry", { jobs: -1 })).toThrow(RangeError);
    expect(() => reserveResourceGovernor(governor, "geometry", { uploadBytes: Number.POSITIVE_INFINITY }))
      .toThrow(RangeError);
    const base = policy();
    const impossible: ResourceGovernorPolicy = {
      ...base,
      classes: { ...base.classes, geometry: classPolicy(101, 101) },
    };
    expect(() => createResourceGovernor(impossible)).toThrow("mandatory floors exceed capacity");

    const invalidHardLimit: ResourceGovernorPolicy = {
      ...base,
      classes: {
        ...base.classes,
        geometry: {
          ...base.classes.geometry,
          persistentGpuBytes: { hardLimit: 49, mandatoryFloor: 50 },
        },
      },
    };
    expect(() => createResourceGovernor(invalidHardLimit))
      .toThrow("geometry.persistentGpuBytes mandatory floor exceeds its hard limit");

    const aboveRoot: ResourceGovernorPolicy = {
      ...base,
      classes: {
        ...base.classes,
        geometry: {
          ...base.classes.geometry,
          persistentGpuBytes: { hardLimit: 101, mandatoryFloor: 0 },
        },
      },
    };
    expect(() => createResourceGovernor(aboveRoot))
      .toThrow("geometry.persistentGpuBytes hard limit exceeds root capacity");
  });

  it("admits a terrain, houses, interiors, VT, and frame targets without letting terrain consume their floors", () => {
    const base = policy({ cpuDecodedBytes: 800, persistentGpuBytes: 1_000, transientPeakBytes: 200 });
    const configured: ResourceGovernorPolicy = {
      ...base,
      classes: {
        "asset-decode": classPolicy(0, 0, 100, 150),
        geometry: classPolicy(100, 300, 100, 300),
        "ordinary-texture": classPolicy(150, 250, 100, 200),
        "render-target": classPolicy(100, 180, 0, 0),
        "virtual-texture": classPolicy(200, 300, 100, 200),
      },
    };
    const governor = createResourceGovernor(configured);

    const terrain = reservation(reserveResourceGovernor(governor, "geometry", {
      cpuDecodedBytes: 500,
      persistentGpuBytes: 550,
    })).commit();
    expect(reserveResourceGovernor(governor, "geometry", { persistentGpuBytes: 1 }))
      .toBe("persistent-gpu-mandatory-floor");

    const targets = reservation(reserveResourceGovernor(governor, "render-target", {
      persistentGpuBytes: 100,
    })).commit();
    const houseMaterials = reservation(reserveResourceGovernor(governor, "ordinary-texture", {
      cpuDecodedBytes: 100,
      persistentGpuBytes: 150,
    })).commit();
    const distantTerrainPages = reservation(reserveResourceGovernor(governor, "virtual-texture", {
      cpuDecodedBytes: 100,
      persistentGpuBytes: 200,
    })).commit();
    const interiorDecode = reservation(reserveResourceGovernor(governor, "asset-decode", {
      cpuDecodedBytes: 100,
      jobs: 1,
      transientPeakBytes: 50,
    })).commit();

    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      total: { cpuDecodedBytes: 800, persistentGpuBytes: 1_000 },
    });
    expect(reserveResourceGovernor(governor, "geometry", { cpuDecodedBytes: 1 }))
      .toBe("cpu-decoded-capacity");
    for (const lease of [terrain, targets, houseMaterials, distantTerrainPages, interiorDecode]) {
      lease.release();
    }
    expect(resourceGovernorSnapshot(governor).total).toMatchObject({
      cpuDecodedBytes: 0, persistentGpuBytes: 0,
    });
  });

  it("prevents a repeatedly aggressive class from starving every protected class", () => {
    const base = policy();
    const configured: ResourceGovernorPolicy = {
      ...base,
      classes: {
        ...base.classes,
        geometry: classPolicy(0, 20),
        "ordinary-texture": classPolicy(20, 30),
        "render-target": classPolicy(10, 20),
        "virtual-texture": classPolicy(20, 30),
      },
    };
    const governor = createResourceGovernor(configured);
    const terrain = reservation(reserveResourceGovernor(governor, "geometry", {
      persistentGpuBytes: 50,
    })).commit();

    for (let cycle = 0; cycle < 64; cycle += 1) {
      expect(reserveResourceGovernor(governor, "geometry", { persistentGpuBytes: 1 }))
        .toBe("persistent-gpu-mandatory-floor");
      for (const [resourceClass, bytes] of [
        ["ordinary-texture", 20], ["virtual-texture", 20], ["render-target", 10],
      ] as const) {
        const protectedLease = reservation(reserveResourceGovernor(governor, resourceClass, {
          persistentGpuBytes: bytes,
        })).commit();
        expect(protectedLease.release()).toBe(true);
      }
      beginResourceGovernorFrame(governor);
    }
    expect(terrain.release()).toBe(true);
    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      frame: 64,
      total: { persistentGpuBytes: 0 },
    });
  });

  it("keeps cross-class replacement atomic when another class occupies the reclaimed headroom", () => {
    const governor = createResourceGovernor(policy({ persistentGpuBytes: 120, transientPeakBytes: 100 }));
    const terrain = reservation(reserveResourceGovernor(governor, "geometry", {
      persistentGpuBytes: 60,
    })).commit();
    const houses = reservation(reserveResourceGovernor(governor, "ordinary-texture", {
      persistentGpuBytes: 50,
    })).commit();

    expect(replaceResourceGovernorLease(governor, terrain, {
      persistentGpuBytes: 80,
      transientPeakBytes: 80,
    })).toBe("persistent-gpu-capacity");
    expect(resourceGovernorSnapshot(governor)).toMatchObject({
      outstandingLeases: 2,
      outstandingReservations: 0,
      total: { persistentGpuBytes: 110, transientPeakBytes: 0 },
    });
    expect(terrain.release()).toBe(true);
    expect(houses.release()).toBe(true);
  });

  it("remains exact at the maximum safe aggregate boundary", () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const governor = createResourceGovernor(policy({
      cpuDecodedBytes: maximum,
      jobs: maximum,
      persistentGpuBytes: maximum,
      transientPeakBytes: maximum,
      uploadBytes: maximum,
    }));
    const almostAll = reservation(reserveResourceGovernor(governor, "geometry", {
      cpuDecodedBytes: maximum - 10,
      persistentGpuBytes: maximum - 10,
    })).commit();
    const remainder = reservation(reserveResourceGovernor(governor, "ordinary-texture", {
      cpuDecodedBytes: 10,
      persistentGpuBytes: 10,
    })).commit();
    expect(resourceGovernorSnapshot(governor).total).toMatchObject({
      cpuDecodedBytes: maximum,
      persistentGpuBytes: maximum,
    });
    expect(reserveResourceGovernor(governor, "virtual-texture", { persistentGpuBytes: 1 }))
      .toBe("persistent-gpu-capacity");
    remainder.release();
    almostAll.release();
    expect(resourceGovernorSnapshot(governor).total).toMatchObject({
      cpuDecodedBytes: 0, persistentGpuBytes: 0,
    });
  });

  it("preserves accounting invariants across seeded mixed-scene transaction sequences", () => {
    forEachFuzzCase({ cases: 48, seed: 0x6a07_e20f }, ({ random }) => {
      const base = policy();
      const fuzzPolicy: ResourceGovernorPolicy = {
        ...base,
        classes: {
          ...base.classes,
          "virtual-texture": {
            cpuDecodedBytes: { hardLimit: 35, mandatoryFloor: 0 },
            persistentGpuBytes: { hardLimit: 45, mandatoryFloor: 0 },
          },
        },
      };
      const governor = createResourceGovernor(fuzzPolicy);
      const leases: Array<{ release(): boolean }> = [];
      for (let step = 0; step < 96; step += 1) {
        if (leases.length > 0 && random.boolean(0.2)) {
          leases.splice(random.int(0, leases.length), 1)[0]!.release();
        }
        if (random.boolean(0.08)) beginResourceGovernorFrame(governor);
        const before = resourceGovernorSnapshot(governor);
        const result = reserveResourceGovernor(
          governor,
          random.pick(RESOURCE_GOVERNOR_CLASSES),
          {
            cpuDecodedBytes: random.int(0, 31),
            jobs: random.int(0, 3),
            persistentGpuBytes: random.int(0, 31),
            transientPeakBytes: random.int(0, 21),
            uploadBytes: random.int(0, 21),
          },
        );
        if (typeof result === "string") {
          expect(resourceGovernorSnapshot(governor).total).toEqual(before.total);
        } else if (random.boolean()) {
          result.cancel();
          expect(result.cancel()).toBe(false);
        } else {
          leases.push(result.commit());
        }

        const snapshot = resourceGovernorSnapshot(governor);
        for (const resourceClass of RESOURCE_GOVERNOR_CLASSES) {
          expect(snapshot.byClass[resourceClass].cpuDecodedBytes).toBeLessThanOrEqual(
            snapshot.maximumDurableBytesByClass[resourceClass].cpuDecodedBytes,
          );
          expect(snapshot.byClass[resourceClass].persistentGpuBytes).toBeLessThanOrEqual(
            snapshot.maximumDurableBytesByClass[resourceClass].persistentGpuBytes,
          );
        }
        for (const dimension of Object.keys(snapshot.total) as (keyof typeof snapshot.total)[]) {
          expect(Number.isSafeInteger(snapshot.total[dimension])).toBe(true);
          expect(snapshot.total[dimension]).toBeGreaterThanOrEqual(0);
          expect(snapshot.total[dimension]).toBeLessThanOrEqual(snapshot.limits[dimension]);
          expect(RESOURCE_GOVERNOR_CLASSES.reduce(
            (sum, resourceClass) => sum + snapshot.byClass[resourceClass][dimension],
            0,
          )).toBe(snapshot.total[dimension]);
        }
      }
      for (const lease of leases) lease.release();
      expect(resourceGovernorSnapshot(governor).total).toMatchObject({
        cpuDecodedBytes: 0,
        jobs: 0,
        persistentGpuBytes: 0,
        transientPeakBytes: 0,
      });
    });
  }, 15_000);
});
