import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  createCameraViewResource,
  mesh,
  perspectiveCamera,
  scene,
  unlitMaterial,
  type CameraViewResource,
  type CameraViewResourceListener,
  type RenderNode,
  type RenderObjectHandle,
} from "@royal/renderer-core";
import {
  compileFramePlan,
  createResourceManifestDiffScratch,
  diffResourceManifests,
  type FramePlan,
  type FramePlanResourceManifest,
} from "../packages/renderer-webgl/src/frame/plan";
import { SceneBindingRegistry } from "../packages/renderer-webgl/src/scene-binding-registry";
import { assertFuzzEqual, forEachFuzzCase } from "./fuzz";

const EMPTY_MANIFEST: FramePlanResourceManifest = {
  bulkInstances: [],
  directGeometries: [],
  gltfRequests: [],
  ordinaryTextures: [],
  renderObjectRefs: [],
  virtualTextures: [],
};

const camera = () => perspectiveCamera({
  far: 1_000,
  fovY: Math.PI / 3,
  near: 0.1,
  position: [0, 0, 5],
  rotation: [0, 0, 0],
});

type TrackedCamera = {
  readonly activeSubscriptions: () => number;
  readonly resource: CameraViewResource;
  readonly subscribeAttempts: () => number;
  readonly unsubscribeAttempts: () => number;
};

const trackedCamera = (options: {
  readonly subscribeFailures?: number;
  readonly unsubscribeFailures?: number;
} = {}): TrackedCamera => {
  const base = createCameraViewResource(camera());
  let activeSubscriptions = 0;
  let subscribeAttempts = 0;
  let unsubscribeAttempts = 0;
  const resource = new Proxy(base, {
    get(target, property) {
      if (property !== "subscribe") return Reflect.get(target, property, target);
      return (listener: CameraViewResourceListener): (() => void) => {
        subscribeAttempts += 1;
        if (subscribeAttempts <= (options.subscribeFailures ?? 0)) {
          throw new Error("camera subscribe failed");
        }
        const unsubscribe = target.subscribe(listener);
        activeSubscriptions += 1;
        let active = true;
        return () => {
          unsubscribeAttempts += 1;
          if (unsubscribeAttempts <= (options.unsubscribeFailures ?? 0)) {
            throw new Error("camera unsubscribe failed");
          }
          if (!active) return;
          active = false;
          activeSubscriptions -= 1;
          unsubscribe();
        };
      };
    },
  });
  return {
    activeSubscriptions: () => activeSubscriptions,
    resource,
    subscribeAttempts: () => subscribeAttempts,
    unsubscribeAttempts: () => unsubscribeAttempts,
  };
};

const plan = (camera: FramePlan["camera"], nodes: readonly RenderNode[] = []): FramePlan =>
  compileFramePlan(scene({ camera, nodes }), 1);

const reconcile = (
  registry: SceneBindingRegistry,
  next: FramePlan,
  previous?: FramePlan,
): void => {
  const delta = diffResourceManifests(
    previous?.manifest ?? EMPTY_MANIFEST,
    next.manifest,
    createResourceManifestDiffScratch(),
  );
  registry.reconcile(next, delta.renderObjectRefs);
};

const renderedMesh = (
  ref?: (handle: RenderObjectHandle | null) => void,
  x = 0,
): RenderNode => mesh({
  geometry: boxGeometry(1),
  material: unlitMaterial({ color: [1, 1, 1, 1] }),
  ...(ref === undefined ? {} : { ref }),
  transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
});

const expectOpaqueFailure = (action: () => void): void => {
  let failurePresent = false;
  try {
    action();
  } catch (error) {
    failurePresent = true;
    expect(error).toBeUndefined();
  }
  expect(failurePresent).toBe(true);
};

describe("scene binding registry", () => {
  it("retains declarative model matrices and updates imperative refs by version", () => {
    let handle: RenderObjectHandle | null = null;
    const ref = (value: RenderObjectHandle | null): void => { handle = value; };
    const registry = new SceneBindingRegistry(() => undefined);
    const declarativePlan = plan(camera(), [renderedMesh(undefined, 2)]);
    reconcile(registry, declarativePlan);
    const declarativeNode = declarativePlan.nodes[0] as Extract<RenderNode, { kind: "mesh" }>;
    const declarativeModel = registry.modelMatrix(declarativeNode);
    expect(declarativeModel[12]).toBe(2);
    expect(registry.modelMatrix(declarativeNode)).toBe(declarativeModel);

    const imperativePlan = plan(camera(), [renderedMesh(ref, 3)]);
    reconcile(registry, imperativePlan, declarativePlan);
    const imperativeNode = imperativePlan.nodes[0] as Extract<RenderNode, { kind: "mesh" }>;
    const imperativeModel = registry.modelMatrix(imperativeNode);
    expect(imperativeModel[12]).toBe(3);
    if (handle === null) throw new Error("Expected render-object handle");
    (handle as RenderObjectHandle).position.x = 7;
    expect(registry.modelMatrix(imperativeNode)).toBe(imperativeModel);
    expect(imperativeModel[12]).toBe(7);
    registry.dispose();
  });

  it("retains the old camera owner when replacement unsubscribe fails", () => {
    const first = trackedCamera({ unsubscribeFailures: 1 });
    const second = trackedCamera();
    let invalidations = 0;
    const registry = new SceneBindingRegistry(() => { invalidations += 1; });
    const firstPlan = plan(first.resource);
    const secondPlan = plan(second.resource);
    reconcile(registry, firstPlan);

    expect(() => reconcile(registry, secondPlan, firstPlan)).toThrow("camera unsubscribe failed");
    expect(first.activeSubscriptions()).toBe(1);
    expect(second.activeSubscriptions()).toBe(0);
    first.resource.position[0] = 1;
    first.resource.commit();
    expect(invalidations).toBe(1);

    expect(() => reconcile(registry, secondPlan, firstPlan)).not.toThrow();
    expect(first.activeSubscriptions()).toBe(0);
    expect(second.activeSubscriptions()).toBe(1);
    first.resource.position[0] = 2;
    first.resource.commit();
    second.resource.position[0] = 3;
    second.resource.commit();
    expect(invalidations).toBe(2);
    registry.dispose();
  });

  it("retries camera acquisition and disposal without losing the release handle", () => {
    const acquisition = trackedCamera({ subscribeFailures: 1 });
    const registry = new SceneBindingRegistry(() => undefined);
    const acquisitionPlan = plan(acquisition.resource);
    expect(() => reconcile(registry, acquisitionPlan)).toThrow("camera subscribe failed");
    expect(acquisition.activeSubscriptions()).toBe(0);
    expect(() => reconcile(registry, acquisitionPlan)).not.toThrow();
    expect(acquisition.subscribeAttempts()).toBe(2);
    registry.dispose();

    const disposal = trackedCamera({ unsubscribeFailures: 1 });
    const disposalRegistry = new SceneBindingRegistry(() => undefined);
    reconcile(disposalRegistry, plan(disposal.resource));
    expect(() => disposalRegistry.dispose()).toThrow("camera unsubscribe failed");
    expect(disposal.activeSubscriptions()).toBe(1);
    expect(() => disposalRegistry.dispose()).not.toThrow();
    expect(disposal.activeSubscriptions()).toBe(0);
    expect(disposal.unsubscribeAttempts()).toBe(2);
    expect(() => disposalRegistry.dispose()).not.toThrow();
    expect(disposal.unsubscribeAttempts()).toBe(2);
  });

  it("preserves opaque camera acquisition, camera release, and ref detach failures", () => {
    const subscribeBase = createCameraViewResource(camera());
    let subscribeAttempts = 0;
    const opaqueSubscribe = new Proxy(subscribeBase, {
      get(target, property) {
        if (property !== "subscribe") return Reflect.get(target, property, target);
        return (listener: CameraViewResourceListener): (() => void) => {
          subscribeAttempts += 1;
          if (subscribeAttempts === 1) throw undefined;
          return target.subscribe(listener);
        };
      },
    }) satisfies CameraViewResource;
    const subscribeRegistry = new SceneBindingRegistry(() => undefined);
    const subscribePlan = plan(opaqueSubscribe);
    expectOpaqueFailure(() => reconcile(subscribeRegistry, subscribePlan));
    expect(() => reconcile(subscribeRegistry, subscribePlan)).not.toThrow();
    subscribeRegistry.dispose();

    const unsubscribeBase = createCameraViewResource(camera());
    let unsubscribeAttempts = 0;
    const opaqueUnsubscribe = new Proxy(unsubscribeBase, {
      get(target, property) {
        if (property !== "subscribe") return Reflect.get(target, property, target);
        return (listener: CameraViewResourceListener): (() => void) => {
          const unsubscribe = target.subscribe(listener);
          return () => {
            unsubscribeAttempts += 1;
            if (unsubscribeAttempts === 1) throw undefined;
            unsubscribe();
          };
        };
      },
    }) satisfies CameraViewResource;
    const unsubscribeRegistry = new SceneBindingRegistry(() => undefined);
    reconcile(unsubscribeRegistry, plan(opaqueUnsubscribe));
    expectOpaqueFailure(() => unsubscribeRegistry.dispose());
    expect(() => unsubscribeRegistry.dispose()).not.toThrow();
    expect(unsubscribeAttempts).toBe(2);

    let detachAttempts = 0;
    const ref = (handle: RenderObjectHandle | null): void => {
      if (handle !== null) return;
      detachAttempts += 1;
      if (detachAttempts === 1) throw undefined;
    };
    const detachRegistry = new SceneBindingRegistry(() => undefined);
    reconcile(detachRegistry, plan(camera(), [renderedMesh(ref)]));
    expectOpaqueFailure(() => detachRegistry.dispose());
    expect(() => detachRegistry.dispose()).not.toThrow();
    expect(detachAttempts).toBe(2);
  });

  it("retries failed render-object acquisition and release while preserving the current handle", () => {
    let attachFailures = 1;
    let detachFailures = 1;
    let current: RenderObjectHandle | null = null;
    const ref = (handle: RenderObjectHandle | null): void => {
      if (handle !== null && attachFailures > 0) {
        attachFailures -= 1;
        throw new Error("ref attach failed");
      }
      if (handle === null && detachFailures > 0) {
        detachFailures -= 1;
        throw new Error("ref detach failed");
      }
      current = handle;
    };
    const view = camera();
    const populated = plan(view, [renderedMesh(ref, 2)]);
    const empty = plan(view);
    const registry = new SceneBindingRegistry(() => undefined);

    expect(() => reconcile(registry, populated)).toThrow("ref attach failed");
    expect(() => reconcile(registry, populated)).not.toThrow();
    const handle = current;
    expect(handle).not.toBeNull();
    expect(registry.transform(populated.nodes[0] as Extract<RenderNode, { kind: "mesh" }>)).toMatchObject({
      position: [2, 0, 0],
    });

    expect(() => reconcile(registry, empty, populated)).toThrow("ref detach failed");
    expect(registry.handle(populated.nodes[0] as Extract<RenderNode, { kind: "mesh" }>)).toBe(handle);
    expect(() => reconcile(registry, empty, populated)).not.toThrow();
    expect(current).toBeNull();
    registry.dispose();
  });

  it("keeps one stable handle and exact declarative transforms across replacement traces", () => {
    forEachFuzzCase({ cases: 64, seed: 0x5ce1_b1ad }, ({ random }) => {
      let current: RenderObjectHandle | null = null;
      const ref = (handle: RenderObjectHandle | null): void => { current = handle; };
      const view = camera();
      const registry = new SceneBindingRegistry(() => undefined);
      let previous: FramePlan | undefined;
      let firstHandle: RenderObjectHandle | null = null;
      for (let step = 0; step < 48; step += 1) {
        const x = random.number(-1_000, 1_000);
        const next = plan(view, [renderedMesh(ref, x)]);
        try {
          reconcile(registry, next, previous);
        } catch (error) {
          throw new Error(`step=${step} reconcile failed`, { cause: error });
        }
        const attached = current as unknown as RenderObjectHandle | null;
        if (attached === null) throw new Error("Expected render-object ref to be attached");
        firstHandle ??= attached;
        assertFuzzEqual(attached, firstHandle, `step=${step} handle identity`);
        assertFuzzEqual(attached.position.x, x, `step=${step} position`);
        previous = next;
      }
      registry.dispose();
      assertFuzzEqual(current, null, "dispose ref");
    });
  });
});
