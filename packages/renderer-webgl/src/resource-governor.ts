/**
 * Root-local resource admission policy. This module deliberately has no WebGL
 * dependencies: producers describe costs, then perform side effects only after
 * receiving a reservation.
 */

export const RESOURCE_GOVERNOR_CLASSES = [
  "geometry",
  "ordinary-texture",
  "virtual-texture",
  "render-target",
  "asset-decode",
] as const;

export type ResourceGovernorClass = (typeof RESOURCE_GOVERNOR_CLASSES)[number];

export interface ResourceGovernorCost {
  /** Durable decoded CPU memory, in bytes. */
  readonly cpuDecodedBytes?: number;
  /** Concurrent asynchronous jobs; released when the reservation commits or cancels. */
  readonly jobs?: number;
  /** Durable GPU allocation, in bytes. */
  readonly persistentGpuBytes?: number;
  /** Temporary concurrent working-set peak, in bytes. */
  readonly transientPeakBytes?: number;
  /** GPU upload traffic charged to the current renderer frame, in bytes. */
  readonly uploadBytes?: number;
}

export interface ResourceGovernorUsage {
  /** Durable decoded CPU memory, in bytes. */
  readonly cpuDecodedBytes: number;
  /** Concurrent asynchronous jobs. */
  readonly jobs: number;
  /** Durable GPU allocation, in bytes. */
  readonly persistentGpuBytes: number;
  /** Temporary concurrent working-set peak, in bytes. */
  readonly transientPeakBytes: number;
  /** GPU upload traffic spent in the current renderer frame, in bytes. */
  readonly uploadBytes: number;
}

export interface ResourceGovernorDurableBudget {
  /** Byte capacity protected from borrowing while this class is below its floor. */
  readonly mandatoryFloor: number;
  /** Byte threshold used for borrowing diagnostics; it is not a hard per-class cap. */
  readonly softLimit: number;
  /**
   * Optional hard ceiling for this class. Other classes cannot lend capacity
   * above it. When omitted, the class may borrow every root-wide byte not
   * protected by another class's mandatory floor.
   */
  readonly hardLimit?: number;
}

export interface ResourceGovernorClassPolicy {
  readonly cpuDecodedBytes: ResourceGovernorDurableBudget;
  readonly persistentGpuBytes: ResourceGovernorDurableBudget;
}

export interface ResourceGovernorPolicy {
  /** Borrowing policy for durable CPU and GPU bytes, keyed by resource class. */
  readonly classes: Readonly<Record<ResourceGovernorClass, ResourceGovernorClassPolicy>>;
  /** Root-wide hard capacities. Byte-named fields are bytes; `jobs` is a count. */
  readonly limits: ResourceGovernorUsage;
}

/**
 * Nested overrides applied to the renderer's complete default resource policy.
 * A lowered hard ceiling also clamps inherited soft/floor values; explicit
 * dependent values remain authoritative. Lower root capacities may require
 * corresponding class-floor overrides.
 */
export interface ResourceGovernorPolicyInput {
  readonly classes?: Readonly<Partial<Record<ResourceGovernorClass, {
    readonly cpuDecodedBytes?: Readonly<Partial<ResourceGovernorDurableBudget>>;
    readonly persistentGpuBytes?: Readonly<Partial<ResourceGovernorDurableBudget>>;
  }>>>;
  readonly limits?: Readonly<Partial<ResourceGovernorUsage>>;
}

export type ResourceGovernorDenialReason =
  | "cpu-decoded-capacity"
  | "cpu-decoded-hard-limit"
  | "cpu-decoded-mandatory-floor"
  | "job-capacity"
  | "persistent-gpu-capacity"
  | "persistent-gpu-hard-limit"
  | "persistent-gpu-mandatory-floor"
  | "transient-peak-capacity"
  | "upload-capacity";

export interface ResourceGovernorAdmission {
  readonly admitted: boolean;
  readonly borrowedCpuDecodedBytes: number;
  readonly borrowedPersistentGpuBytes: number;
  readonly reason?: ResourceGovernorDenialReason;
}

export interface ResourceGovernorPolicyView {
  readonly byClass: Readonly<Record<ResourceGovernorClass, ResourceGovernorUsage>>;
  readonly total: ResourceGovernorUsage;
}

const ZERO_USAGE: ResourceGovernorUsage = Object.freeze({
  cpuDecodedBytes: 0,
  jobs: 0,
  persistentGpuBytes: 0,
  transientPeakBytes: 0,
  uploadBytes: 0,
});

const emptyClassUsage = (): Record<ResourceGovernorClass, ResourceGovernorUsage> => ({
  "asset-decode": { ...ZERO_USAGE },
  geometry: { ...ZERO_USAGE },
  "ordinary-texture": { ...ZERO_USAGE },
  "render-target": { ...ZERO_USAGE },
  "virtual-texture": { ...ZERO_USAGE },
});

const normalizedCost = (cost: ResourceGovernorCost): ResourceGovernorUsage => ({
  cpuDecodedBytes: cost.cpuDecodedBytes ?? 0,
  jobs: cost.jobs ?? 0,
  persistentGpuBytes: cost.persistentGpuBytes ?? 0,
  transientPeakBytes: cost.transientPeakBytes ?? 0,
  uploadBytes: cost.uploadBytes ?? 0,
});

const assertCount = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer, received ${value}`);
  }
};

const checkedCost = (cost: ResourceGovernorCost): ResourceGovernorUsage => {
  const value = normalizedCost(cost);
  assertCount(value.cpuDecodedBytes, "cpuDecodedBytes");
  assertCount(value.jobs, "jobs");
  assertCount(value.persistentGpuBytes, "persistentGpuBytes");
  assertCount(value.transientPeakBytes, "transientPeakBytes");
  assertCount(value.uploadBytes, "uploadBytes");
  return value;
};

const protectedCapacity = (
  policy: ResourceGovernorPolicy,
  view: ResourceGovernorPolicyView,
  requester: ResourceGovernorClass,
  dimension: "cpuDecodedBytes" | "persistentGpuBytes",
): number => {
  let protectedBytes = 0;
  for (const resourceClass of RESOURCE_GOVERNOR_CLASSES) {
    if (resourceClass === requester) continue;
    const floor = policy.classes[resourceClass][dimension].mandatoryFloor;
    protectedBytes += Math.max(0, floor - view.byClass[resourceClass][dimension]);
  }
  return protectedBytes;
};

/**
 * Maximum durable bytes one class can own under a policy. This combines its
 * optional hard ceiling with the root capacity left after protecting every
 * other class's mandatory floor.
 */
export const maximumResourceGovernorClassDurableBytes = (
  policy: ResourceGovernorPolicy,
  resourceClass: ResourceGovernorClass,
  dimension: "cpuDecodedBytes" | "persistentGpuBytes",
): number => {
  const otherFloors = RESOURCE_GOVERNOR_CLASSES
    .filter((candidate) => candidate !== resourceClass)
    .reduce((sum, candidate) => sum + policy.classes[candidate][dimension].mandatoryFloor, 0);
  const borrowableMaximum = Math.max(0, policy.limits[dimension] - otherFloors);
  return Math.min(
    borrowableMaximum,
    policy.classes[resourceClass][dimension].hardLimit ?? borrowableMaximum,
  );
};

/** Pure admission decision; callers can fuzz this independently of resource side effects. */
export const evaluateResourceGovernorAdmission = (
  policy: ResourceGovernorPolicy,
  view: ResourceGovernorPolicyView,
  resourceClass: ResourceGovernorClass,
  requestedCost: ResourceGovernorCost,
): ResourceGovernorAdmission => {
  const cost = checkedCost(requestedCost);
  const own = view.byClass[resourceClass];
  const gpuHardLimit = policy.classes[resourceClass].persistentGpuBytes.hardLimit;
  if (gpuHardLimit !== undefined && cost.persistentGpuBytes > gpuHardLimit - own.persistentGpuBytes) {
    return { admitted: false, borrowedCpuDecodedBytes: 0, borrowedPersistentGpuBytes: 0,
      reason: "persistent-gpu-hard-limit" };
  }
  if (cost.persistentGpuBytes > policy.limits.persistentGpuBytes - view.total.persistentGpuBytes) {
    return { admitted: false, borrowedCpuDecodedBytes: 0, borrowedPersistentGpuBytes: 0,
      reason: "persistent-gpu-capacity" };
  }
  if (cost.persistentGpuBytes > policy.limits.persistentGpuBytes
    - protectedCapacity(policy, view, resourceClass, "persistentGpuBytes")
    - view.total.persistentGpuBytes) {
    return { admitted: false, borrowedCpuDecodedBytes: 0, borrowedPersistentGpuBytes: 0,
      reason: "persistent-gpu-mandatory-floor" };
  }
  const cpuHardLimit = policy.classes[resourceClass].cpuDecodedBytes.hardLimit;
  if (cpuHardLimit !== undefined && cost.cpuDecodedBytes > cpuHardLimit - own.cpuDecodedBytes) {
    return { admitted: false, borrowedCpuDecodedBytes: 0, borrowedPersistentGpuBytes: 0,
      reason: "cpu-decoded-hard-limit" };
  }
  if (cost.cpuDecodedBytes > policy.limits.cpuDecodedBytes - view.total.cpuDecodedBytes) {
    return { admitted: false, borrowedCpuDecodedBytes: 0, borrowedPersistentGpuBytes: 0,
      reason: "cpu-decoded-capacity" };
  }
  if (cost.cpuDecodedBytes > policy.limits.cpuDecodedBytes
    - protectedCapacity(policy, view, resourceClass, "cpuDecodedBytes")
    - view.total.cpuDecodedBytes) {
    return { admitted: false, borrowedCpuDecodedBytes: 0, borrowedPersistentGpuBytes: 0,
      reason: "cpu-decoded-mandatory-floor" };
  }
  if (cost.transientPeakBytes > policy.limits.transientPeakBytes - view.total.transientPeakBytes) {
    return { admitted: false, borrowedCpuDecodedBytes: 0, borrowedPersistentGpuBytes: 0,
      reason: "transient-peak-capacity" };
  }
  if (cost.uploadBytes > policy.limits.uploadBytes - view.total.uploadBytes) {
    return { admitted: false, borrowedCpuDecodedBytes: 0, borrowedPersistentGpuBytes: 0,
      reason: "upload-capacity" };
  }
  if (cost.jobs > policy.limits.jobs - view.total.jobs) {
    return { admitted: false, borrowedCpuDecodedBytes: 0, borrowedPersistentGpuBytes: 0,
      reason: "job-capacity" };
  }
  const cpuSoftLimit = policy.classes[resourceClass].cpuDecodedBytes.softLimit;
  const gpuSoftLimit = policy.classes[resourceClass].persistentGpuBytes.softLimit;
  return {
    admitted: true,
    borrowedCpuDecodedBytes: Math.max(
      0,
      own.cpuDecodedBytes + cost.cpuDecodedBytes - cpuSoftLimit,
    ) - Math.max(
      0,
      own.cpuDecodedBytes - cpuSoftLimit,
    ),
    borrowedPersistentGpuBytes: Math.max(
      0,
      own.persistentGpuBytes + cost.persistentGpuBytes - gpuSoftLimit,
    ) - Math.max(
      0,
      own.persistentGpuBytes - gpuSoftLimit,
    ),
  };
};

const mib = (value: number): number => value * 1024 * 1024;
const durable = (gpuFloor: number, gpuSoft: number, cpuFloor: number, cpuSoft: number) => Object.freeze({
  cpuDecodedBytes: Object.freeze({ mandatoryFloor: mib(cpuFloor), softLimit: mib(cpuSoft) }),
  persistentGpuBytes: Object.freeze({ mandatoryFloor: mib(gpuFloor), softLimit: mib(gpuSoft) }),
});

/** Conservative desktop defaults; device-derived policy can replace this later. */
export const DEFAULT_RESOURCE_GOVERNOR_POLICY: ResourceGovernorPolicy = Object.freeze({
  classes: Object.freeze({
    "asset-decode": durable(0, 0, 32, 192),
    geometry: durable(32, 128, 16, 96),
    "ordinary-texture": durable(32, 128, 24, 128),
    "render-target": durable(48, 128, 0, 0),
    "virtual-texture": durable(64, 192, 32, 128),
  }),
  limits: Object.freeze({
    cpuDecodedBytes: mib(512),
    jobs: 8,
    persistentGpuBytes: mib(512),
    transientPeakBytes: mib(192),
    uploadBytes: mib(16),
  }),
});

/**
 * Resolves one deeply immutable, complete policy from concise nested overrides.
 * Structural validation occurs when a renderer root or governor is created.
 */
export const defineResourceGovernorPolicy = (
  input?: ResourceGovernorPolicyInput,
): ResourceGovernorPolicy => {
  if (input === undefined) return DEFAULT_RESOURCE_GOVERNOR_POLICY;
  const budget = (
    fallback: ResourceGovernorDurableBudget,
    overrides: Readonly<Partial<ResourceGovernorDurableBudget>> | undefined,
  ): ResourceGovernorDurableBudget => {
    const hardLimit = overrides !== undefined && "hardLimit" in overrides
      ? overrides.hardLimit
      : fallback.hardLimit;
    const softLimit = overrides?.softLimit ?? (hardLimit === undefined
      ? fallback.softLimit
      : Math.min(fallback.softLimit, hardLimit));
    const inheritedMandatoryFloor = Math.min(fallback.mandatoryFloor, softLimit);
    return Object.freeze({
      ...(hardLimit === undefined ? {} : { hardLimit }),
      mandatoryFloor: overrides?.mandatoryFloor ?? inheritedMandatoryFloor,
      softLimit,
    });
  };
  const resourceClass = (resourceClass: ResourceGovernorClass): ResourceGovernorClassPolicy => {
    const fallback = DEFAULT_RESOURCE_GOVERNOR_POLICY.classes[resourceClass];
    const overrides = input.classes?.[resourceClass];
    return Object.freeze({
      cpuDecodedBytes: budget(fallback.cpuDecodedBytes, overrides?.cpuDecodedBytes),
      persistentGpuBytes: budget(fallback.persistentGpuBytes, overrides?.persistentGpuBytes),
    });
  };
  return Object.freeze({
    classes: Object.freeze({
      "asset-decode": resourceClass("asset-decode"),
      geometry: resourceClass("geometry"),
      "ordinary-texture": resourceClass("ordinary-texture"),
      "render-target": resourceClass("render-target"),
      "virtual-texture": resourceClass("virtual-texture"),
    }),
    limits: Object.freeze({
      cpuDecodedBytes: input.limits?.cpuDecodedBytes
        ?? DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.cpuDecodedBytes,
      jobs: input.limits?.jobs ?? DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.jobs,
      persistentGpuBytes: input.limits?.persistentGpuBytes
        ?? DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.persistentGpuBytes,
      transientPeakBytes: input.limits?.transientPeakBytes
        ?? DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.transientPeakBytes,
      uploadBytes: input.limits?.uploadBytes ?? DEFAULT_RESOURCE_GOVERNOR_POLICY.limits.uploadBytes,
    }),
  });
};

export interface ResourceGovernorSnapshot {
  readonly admissions: number;
  readonly borrowAdmissions: number;
  readonly byClass: Readonly<Record<ResourceGovernorClass, ResourceGovernorUsage>>;
  readonly denials: number;
  readonly denialsByReason: Readonly<Record<ResourceGovernorDenialReason, number>>;
  readonly frame: number;
  readonly highWater: ResourceGovernorUsage;
  readonly lastDenial?: {
    readonly reason: ResourceGovernorDenialReason;
    readonly resourceClass: ResourceGovernorClass;
  };
  readonly limits: ResourceGovernorUsage;
  /** Effective hard durable ceilings after root capacity and protected floors. */
  readonly maximumDurableBytesByClass: Readonly<Record<ResourceGovernorClass, {
    readonly cpuDecodedBytes: number;
    readonly persistentGpuBytes: number;
  }>>;
  readonly outstandingLeases: number;
  readonly outstandingReservations: number;
  /** Current durable usage above each class's soft, borrowable budget. */
  readonly softExcessByClass: Readonly<Record<ResourceGovernorClass, {
    readonly cpuDecodedBytes: number;
    readonly persistentGpuBytes: number;
  }>>;
  readonly total: ResourceGovernorUsage;
}

interface MutableUsage {
  cpuDecodedBytes: number;
  jobs: number;
  persistentGpuBytes: number;
  transientPeakBytes: number;
  uploadBytes: number;
}

type MutableClassUsage = Record<ResourceGovernorClass, MutableUsage>;

interface ResourceGovernorState {
  admissions: number;
  borrowAdmissions: number;
  readonly byClass: MutableClassUsage;
  denials: number;
  readonly denialsByReason: Record<ResourceGovernorDenialReason, number>;
  frame: number;
  readonly highWater: MutableUsage;
  lastDenial: ResourceGovernorSnapshot["lastDenial"];
  readonly leases: Map<ResourceGovernorLease, ResourceGovernorLeaseRecord>;
  readonly durableCapacityReleaseListeners: Set<ResourceGovernorDurableCapacityReleaseListener>;
  nextId: number;
  readonly observedByClass: MutableClassUsage;
  outstandingLeases: number;
  readonly policy: ResourceGovernorPolicy;
  readonly reservations: Map<number, { readonly cost: ResourceGovernorUsage; readonly resourceClass: ResourceGovernorClass }>;
  readonly total: MutableUsage;
}

interface ResourceGovernorLeaseRecord {
  cost: ResourceGovernorUsage;
  replacementPending: boolean;
  readonly resourceClass: ResourceGovernorClass;
}

declare const governorAuthority: unique symbol;
export interface ResourceGovernor { readonly [governorAuthority]: "ResourceGovernor" }

export interface ResourceGovernorLease {
  /** Idempotently releases durable CPU and GPU bytes owned by this lease. */
  release(): boolean;
}

export class ResourceGovernorCpuCapacityError extends Error {
  readonly permanent: boolean;

  constructor(message: string, permanent: boolean) {
    super(message);
    this.name = "ResourceGovernorCpuCapacityError";
    this.permanent = permanent;
  }
}

/**
 * Runs synchronously after released capacity is committed. Listener failures
 * are isolated: they neither stop later listeners nor affect the mutating
 * governor call, its accounting, or its returned ownership. Each pass uses a
 * subscriber snapshot and a frozen payload; subscriptions added during a pass
 * begin with the next notification.
 */
export type ResourceGovernorDurableCapacityReleaseListener = (
  released: Readonly<Pick<ResourceGovernorUsage, "cpuDecodedBytes" | "persistentGpuBytes">>,
) => void;

export interface ResourceGovernorReservation {
  /** Publishes durable ownership and spends this frame's upload budget. */
  commit(): ResourceGovernorLease;
  /** Idempotently rolls back the complete tentative reservation. */
  cancel(): boolean;
}

const denialReasons: readonly ResourceGovernorDenialReason[] = [
  "cpu-decoded-capacity", "cpu-decoded-hard-limit", "cpu-decoded-mandatory-floor", "job-capacity",
  "persistent-gpu-capacity", "persistent-gpu-hard-limit", "persistent-gpu-mandatory-floor",
  "transient-peak-capacity", "upload-capacity",
];

const validatePolicy = (policy: ResourceGovernorPolicy): void => {
  checkedCost(policy.limits);
  if (policy.limits.jobs < 1) {
    throw new RangeError(`jobs capacity must be at least 1, received ${policy.limits.jobs}`);
  }
  for (const dimension of ["cpuDecodedBytes", "persistentGpuBytes"] as const) {
    let floors = 0;
    for (const resourceClass of RESOURCE_GOVERNOR_CLASSES) {
      const budget = policy.classes[resourceClass][dimension];
      assertCount(budget.mandatoryFloor, `${resourceClass}.${dimension}.mandatoryFloor`);
      assertCount(budget.softLimit, `${resourceClass}.${dimension}.softLimit`);
      if (budget.hardLimit !== undefined) {
        assertCount(budget.hardLimit, `${resourceClass}.${dimension}.hardLimit`);
      }
      if (budget.mandatoryFloor > budget.softLimit) {
        throw new RangeError(`${resourceClass}.${dimension} mandatory floor exceeds its soft limit`);
      }
      if (budget.hardLimit !== undefined && budget.softLimit > budget.hardLimit) {
        throw new RangeError(`${resourceClass}.${dimension} soft limit exceeds its hard limit`);
      }
      if (budget.hardLimit !== undefined && budget.hardLimit > policy.limits[dimension]) {
        throw new RangeError(`${resourceClass}.${dimension} hard limit exceeds root capacity`);
      }
      floors += budget.mandatoryFloor;
    }
    if (floors > policy.limits[dimension]) throw new RangeError(`${dimension} mandatory floors exceed capacity`);
  }
};

export const createResourceGovernor = (
  policy: ResourceGovernorPolicy = DEFAULT_RESOURCE_GOVERNOR_POLICY,
): ResourceGovernor => {
  validatePolicy(policy);
  return {
    admissions: 0,
    borrowAdmissions: 0,
    byClass: emptyClassUsage(),
    denials: 0,
    denialsByReason: Object.fromEntries(denialReasons.map((reason) => [reason, 0])),
    frame: 0,
    highWater: { ...ZERO_USAGE },
    lastDenial: undefined,
    leases: new Map(),
    durableCapacityReleaseListeners: new Set(),
    nextId: 1,
    observedByClass: emptyClassUsage(),
    outstandingLeases: 0,
    policy,
    reservations: new Map(),
    total: { ...ZERO_USAGE },
  } as unknown as ResourceGovernor;
};

const stateOf = (governor: ResourceGovernor): ResourceGovernorState =>
  governor as unknown as ResourceGovernorState;

const addUsage = (target: MutableUsage, cost: ResourceGovernorUsage, sign: 1 | -1): void => {
  target.cpuDecodedBytes += sign * cost.cpuDecodedBytes;
  target.jobs += sign * cost.jobs;
  target.persistentGpuBytes += sign * cost.persistentGpuBytes;
  target.transientPeakBytes += sign * cost.transientPeakBytes;
  target.uploadBytes += sign * cost.uploadBytes;
};

const durableUsage = (cost: ResourceGovernorUsage): ResourceGovernorUsage => ({
  cpuDecodedBytes: cost.cpuDecodedBytes,
  jobs: 0,
  persistentGpuBytes: cost.persistentGpuBytes,
  transientPeakBytes: 0,
  uploadBytes: 0,
});

const notifyDurableCapacityReleased = (
  state: ResourceGovernorState,
  released: Pick<ResourceGovernorUsage, "cpuDecodedBytes" | "persistentGpuBytes">,
): void => {
  if (released.cpuDecodedBytes === 0 && released.persistentGpuBytes === 0) return;
  const capacity = Object.freeze({
    cpuDecodedBytes: released.cpuDecodedBytes,
    persistentGpuBytes: released.persistentGpuBytes,
  });
  for (const listener of Array.from(state.durableCapacityReleaseListeners)) {
    try {
      listener(capacity);
    } catch {
      // Capacity listeners are wake-up observers. A broken observer must not
      // make a committed ownership mutation appear to have failed or prevent
      // independent waiters from seeing newly available capacity.
    }
  }
};

const releaseLease = (
  state: ResourceGovernorState,
  lease: ResourceGovernorLease,
  replacing = false,
): boolean => {
  const record = state.leases.get(lease);
  if (record === undefined) return false;
  if (record.replacementPending && !replacing) {
    throw new Error("Resource governor lease cannot be released while replacement is pending");
  }
  state.leases.delete(lease);
  const durable = durableUsage(record.cost);
  addUsage(state.total, durable, -1);
  addUsage(state.byClass[record.resourceClass], durable, -1);
  state.outstandingLeases -= 1;
  if (!replacing) notifyDurableCapacityReleased(state, durable);
  return true;
};

const createLease = (
  state: ResourceGovernorState,
  resourceClass: ResourceGovernorClass,
  cost: ResourceGovernorUsage,
): ResourceGovernorLease => {
  let lease!: ResourceGovernorLease;
  lease = { release: () => releaseLease(state, lease) };
  state.leases.set(lease, { cost, replacementPending: false, resourceClass });
  state.outstandingLeases += 1;
  return lease;
};

const updateHighWater = (state: ResourceGovernorState): void => {
  for (const key of Object.keys(state.highWater) as (keyof MutableUsage)[]) {
    state.highWater[key] = Math.max(state.highWater[key], state.total[key]);
  }
};

/**
 * Replaces observational durable usage for a subsystem not yet migrated to
 * reservations. A producer must use either observation or leases for the same
 * bytes, never both. Frame-local pressure is intentionally reservation-only.
 */
export const setResourceGovernorObservedDurableUsage = (
  governor: ResourceGovernor,
  resourceClass: ResourceGovernorClass,
  requestedCost: Pick<ResourceGovernorCost, "cpuDecodedBytes" | "persistentGpuBytes">,
): void => {
  const state = stateOf(governor);
  const cost = checkedCost(requestedCost);
  const previous = state.observedByClass[resourceClass];
  const nextTotalCpuDecodedBytes = state.total.cpuDecodedBytes
    - previous.cpuDecodedBytes + cost.cpuDecodedBytes;
  const nextTotalPersistentGpuBytes = state.total.persistentGpuBytes
    - previous.persistentGpuBytes + cost.persistentGpuBytes;
  assertCount(nextTotalCpuDecodedBytes, "observed total cpuDecodedBytes");
  assertCount(nextTotalPersistentGpuBytes, "observed total persistentGpuBytes");
  const delta: ResourceGovernorUsage = {
    cpuDecodedBytes: cost.cpuDecodedBytes - previous.cpuDecodedBytes,
    jobs: 0,
    persistentGpuBytes: cost.persistentGpuBytes - previous.persistentGpuBytes,
    transientPeakBytes: 0,
    uploadBytes: 0,
  };
  addUsage(state.total, delta, 1);
  addUsage(state.byClass[resourceClass], delta, 1);
  previous.cpuDecodedBytes = cost.cpuDecodedBytes;
  previous.persistentGpuBytes = cost.persistentGpuBytes;
  updateHighWater(state);
  notifyDurableCapacityReleased(state, {
    cpuDecodedBytes: Math.max(0, -delta.cpuDecodedBytes),
    persistentGpuBytes: Math.max(0, -delta.persistentGpuBytes),
  });
};

export const subscribeResourceGovernorDurableCapacityRelease = (
  governor: ResourceGovernor,
  listener: ResourceGovernorDurableCapacityReleaseListener,
): (() => void) => {
  const listeners = stateOf(governor).durableCapacityReleaseListeners;
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/** Starts a new upload-accounting frame. Upload-bearing reservations may not straddle frames. */
export const beginResourceGovernorFrame = (governor: ResourceGovernor): void => {
  const state = stateOf(governor);
  for (const reservation of state.reservations.values()) {
    if (reservation.cost.uploadBytes !== 0) {
      throw new Error("Resource governor upload reservations cannot straddle frames");
    }
  }
  state.frame += 1;
  state.total.uploadBytes = 0;
  for (const resourceClass of RESOURCE_GOVERNOR_CLASSES) state.byClass[resourceClass].uploadBytes = 0;
};

const policyView = (state: ResourceGovernorState): ResourceGovernorPolicyView => ({
  byClass: state.byClass,
  total: state.total,
});

/** Atomically reserves all dimensions or returns a reason without mutating usage. */
export const reserveResourceGovernor = (
  governor: ResourceGovernor,
  resourceClass: ResourceGovernorClass,
  requestedCost: ResourceGovernorCost,
): ResourceGovernorReservation | ResourceGovernorDenialReason => {
  const state = stateOf(governor);
  const cost = checkedCost(requestedCost);
  const admission = evaluateResourceGovernorAdmission(state.policy, policyView(state), resourceClass, cost);
  if (!admission.admitted) {
    const reason = admission.reason!;
    state.denials += 1;
    state.denialsByReason[reason] += 1;
    state.lastDenial = { reason, resourceClass };
    return reason;
  }
  const id = state.nextId;
  state.nextId += 1;
  state.admissions += 1;
  if (admission.borrowedCpuDecodedBytes !== 0 || admission.borrowedPersistentGpuBytes !== 0) {
    state.borrowAdmissions += 1;
  }
  state.reservations.set(id, { cost, resourceClass });
  addUsage(state.total, cost, 1);
  addUsage(state.byClass[resourceClass], cost, 1);
  updateHighWater(state);
  let settled = false;
  const settleReservation = (): boolean => {
    if (settled) return false;
    settled = true;
    state.reservations.delete(id);
    return true;
  };
  return {
    cancel: (): boolean => {
      if (!settleReservation()) return false;
      addUsage(state.total, cost, -1);
      addUsage(state.byClass[resourceClass], cost, -1);
      notifyDurableCapacityReleased(state, durableUsage(cost));
      return true;
    },
    commit: (): ResourceGovernorLease => {
      if (!settleReservation()) throw new Error("Resource governor reservation is already settled");
      // Jobs and transient memory exist only around the admitted transaction.
      // Upload bytes stay spent until the next frame; durable bytes become a lease.
      state.total.jobs -= cost.jobs;
      state.total.transientPeakBytes -= cost.transientPeakBytes;
      state.byClass[resourceClass].jobs -= cost.jobs;
      state.byClass[resourceClass].transientPeakBytes -= cost.transientPeakBytes;
      return createLease(state, resourceClass, cost);
    },
  };
};

/**
 * Atomically replaces a durable lease. Admission credits the previous durable
 * bytes while still charging the caller-supplied transient peak for the full
 * side-by-side allocation. Cancellation preserves the previous lease; a
 * successful commit updates and returns that same lease token.
 */
export const replaceResourceGovernorLease = (
  governor: ResourceGovernor,
  previousLease: ResourceGovernorLease,
  requestedCost: ResourceGovernorCost,
): ResourceGovernorReservation | ResourceGovernorDenialReason => {
  const state = stateOf(governor);
  const previous = state.leases.get(previousLease);
  if (previous === undefined) throw new Error("Resource governor replacement requires an active lease");
  if (previous.replacementPending) throw new Error("Resource governor lease already has a pending replacement");
  const cost = checkedCost(requestedCost);
  const previousDurable = durableUsage(previous.cost);
  const creditedClass = {
    ...state.byClass[previous.resourceClass],
    cpuDecodedBytes: state.byClass[previous.resourceClass].cpuDecodedBytes - previousDurable.cpuDecodedBytes,
    persistentGpuBytes: state.byClass[previous.resourceClass].persistentGpuBytes
      - previousDurable.persistentGpuBytes,
  };
  const view: ResourceGovernorPolicyView = {
    byClass: { ...state.byClass, [previous.resourceClass]: creditedClass },
    total: {
      ...state.total,
      cpuDecodedBytes: state.total.cpuDecodedBytes - previousDurable.cpuDecodedBytes,
      persistentGpuBytes: state.total.persistentGpuBytes - previousDurable.persistentGpuBytes,
    },
  };
  const admission = evaluateResourceGovernorAdmission(
    state.policy,
    view,
    previous.resourceClass,
    cost,
  );
  if (!admission.admitted) {
    const reason = admission.reason!;
    state.denials += 1;
    state.denialsByReason[reason] += 1;
    state.lastDenial = { reason, resourceClass: previous.resourceClass };
    return reason;
  }
  state.admissions += 1;
  if (admission.borrowedCpuDecodedBytes !== 0 || admission.borrowedPersistentGpuBytes !== 0) {
    state.borrowAdmissions += 1;
  }
  const transactionCost: ResourceGovernorUsage = {
    cpuDecodedBytes: 0,
    jobs: cost.jobs,
    persistentGpuBytes: 0,
    transientPeakBytes: cost.transientPeakBytes,
    uploadBytes: cost.uploadBytes,
  };
  const id = state.nextId;
  state.nextId += 1;
  state.reservations.set(id, { cost, resourceClass: previous.resourceClass });
  previous.replacementPending = true;
  addUsage(state.total, transactionCost, 1);
  addUsage(state.byClass[previous.resourceClass], transactionCost, 1);
  updateHighWater(state);
  let settled = false;
  const settle = (): boolean => {
    if (settled) return false;
    settled = true;
    state.reservations.delete(id);
    previous.replacementPending = false;
    return true;
  };
  return {
    cancel: (): boolean => {
      if (!settle()) return false;
      addUsage(state.total, transactionCost, -1);
      addUsage(state.byClass[previous.resourceClass], transactionCost, -1);
      return true;
    },
    commit: (): ResourceGovernorLease => {
      if (state.leases.get(previousLease) !== previous) {
        throw new Error("Resource governor replaced lease is no longer active");
      }
      if (!settle()) throw new Error("Resource governor reservation is already settled");
      const completedWork = { ...transactionCost, uploadBytes: 0 };
      addUsage(state.total, completedWork, -1);
      addUsage(state.byClass[previous.resourceClass], completedWork, -1);
      const nextDurable = durableUsage(cost);
      addUsage(state.total, previousDurable, -1);
      addUsage(state.byClass[previous.resourceClass], previousDurable, -1);
      addUsage(state.total, nextDurable, 1);
      addUsage(state.byClass[previous.resourceClass], nextDurable, 1);
      // Preserve the lease token so a synchronous capacity-listener failure
      // cannot strand the newly committed durable ownership before the caller
      // receives a replacement handle. Notifications run after accounting is
      // committed; observer failures are isolated from ownership mutations.
      previous.cost = cost;
      updateHighWater(state);
      previous.replacementPending = true;
      try {
        notifyDurableCapacityReleased(state, {
          cpuDecodedBytes: Math.max(0, previousDurable.cpuDecodedBytes - nextDurable.cpuDecodedBytes),
          persistentGpuBytes: Math.max(
            0,
            previousDurable.persistentGpuBytes - nextDurable.persistentGpuBytes,
          ),
        });
      } finally {
        previous.replacementPending = false;
      }
      return previousLease;
    },
  };
};

export const resourceGovernorSnapshot = (governor: ResourceGovernor): ResourceGovernorSnapshot => {
  const state = stateOf(governor);
  return {
    admissions: state.admissions,
    borrowAdmissions: state.borrowAdmissions,
    byClass: Object.fromEntries(RESOURCE_GOVERNOR_CLASSES.map((resourceClass) => [
      resourceClass, { ...state.byClass[resourceClass] },
    ])) as unknown as Readonly<Record<ResourceGovernorClass, ResourceGovernorUsage>>,
    denials: state.denials,
    denialsByReason: { ...state.denialsByReason },
    frame: state.frame,
    highWater: { ...state.highWater },
    ...(state.lastDenial === undefined ? {} : { lastDenial: { ...state.lastDenial } }),
    limits: { ...state.policy.limits },
    maximumDurableBytesByClass: Object.fromEntries(RESOURCE_GOVERNOR_CLASSES.map((resourceClass) => [
      resourceClass,
      {
        cpuDecodedBytes: maximumResourceGovernorClassDurableBytes(
          state.policy,
          resourceClass,
          "cpuDecodedBytes",
        ),
        persistentGpuBytes: maximumResourceGovernorClassDurableBytes(
          state.policy,
          resourceClass,
          "persistentGpuBytes",
        ),
      },
    ])) as unknown as ResourceGovernorSnapshot["maximumDurableBytesByClass"],
    outstandingLeases: state.outstandingLeases,
    outstandingReservations: state.reservations.size,
    softExcessByClass: Object.fromEntries(RESOURCE_GOVERNOR_CLASSES.map((resourceClass) => {
      const usage = state.byClass[resourceClass];
      const classPolicy = state.policy.classes[resourceClass];
      return [resourceClass, {
        cpuDecodedBytes: Math.max(0, usage.cpuDecodedBytes - classPolicy.cpuDecodedBytes.softLimit),
        persistentGpuBytes: Math.max(
          0,
          usage.persistentGpuBytes - classPolicy.persistentGpuBytes.softLimit,
        ),
      }];
    })) as unknown as ResourceGovernorSnapshot["softExcessByClass"],
    total: { ...state.total },
  };
};
