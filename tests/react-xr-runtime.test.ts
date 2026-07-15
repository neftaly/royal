import { describe, expect, it, vi } from "vitest";
import { createXrSessionStore, type XrFrame, type XrSession } from "@royal/react/xr";
import { createXrSessionRuntimeWithRenderer } from "../packages/react/src/xr-runtime";
import { fakeRendererRoot } from "./react-test-fixtures";
import type { RoyalRendererRootLifecycleSnapshot } from "../packages/react/src/root";
import type { XrSessionRenderer } from "../packages/react/src/xr-renderer";

type Deferred<Value> = {
  readonly promise: Promise<Value>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: Value) => void;
};

const deferred = <Value>(): Deferred<Value> => {
  let reject = (_error: unknown): void => undefined;
  let resolve = (_value: Value): void => undefined;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
};

type TestXrSession = XrSession & {
  emit(type: "end" | "visibilitychange"): void;
  runNextFrame(frame?: XrFrame): void;
  setVisibility(visibilityState: NonNullable<XrSession["visibilityState"]>): void;
};

const createTestSession = (): TestXrSession => {
  const events = new EventTarget();
  const callbacks = new Map<number, (time: number, frame: XrFrame) => void>();
  let nextHandle = 1;
  let visibilityState: NonNullable<XrSession["visibilityState"]> = "visible";
  const session: TestXrSession = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener: events.addEventListener.bind(events),
    cancelAnimationFrame: vi.fn((handle: number) => {
      callbacks.delete(handle);
    }),
    emit: (type) => events.dispatchEvent(new Event(type)),
    end: vi.fn(async () => {
      events.dispatchEvent(new Event("end"));
    }),
    removeEventListener: events.removeEventListener.bind(events),
    requestAnimationFrame: vi.fn((callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    }),
    requestReferenceSpace: vi.fn(async () => ({})),
    runNextFrame: (frame = { getViewerPose: () => null }) => {
      const entry = callbacks.entries().next().value as
        | [number, (time: number, frame: XrFrame) => void]
        | undefined;
      if (entry === undefined) throw new Error("No XR frame is scheduled");
      callbacks.delete(entry[0]);
      entry[1](0, frame);
    },
    setVisibility: (nextVisibilityState) => {
      visibilityState = nextVisibilityState;
    },
    updateRenderState: vi.fn(),
  };
  return session;
};

const createTestRenderer = () => {
  let disposed = false;
  const renderer: XrSessionRenderer = {
    get disposed() {
      return disposed;
    },
    dispose: vi.fn(() => {
      disposed = true;
    }),
    referenceSpace: {},
    renderFrame: vi.fn(() => true),
  };
  return renderer;
};

const createObservedRoot = () => {
  const root = fakeRendererRoot();
  let publishLifecycle = (_snapshot: RoyalRendererRootLifecycleSnapshot): void => undefined;
  const unobserve = vi.fn();
  vi.mocked(root.observeLifecycle).mockImplementation((publish) => {
    publishLifecycle = publish;
    publish({ generation: 1, interruptions: 0, recoveries: 0, state: "available" });
    return unobserve;
  });
  return { publishLifecycle: (snapshot: RoyalRendererRootLifecycleSnapshot) => {
    publishLifecycle(snapshot);
  }, root, unobserve };
};

describe("React XR session runtime", () => {
  it("rejects malformed startup inputs before taking session ownership", async () => {
    const { root } = createObservedRoot();
    const session = createTestSession();
    const store = createXrSessionStore<TestXrSession>({ available: true });
    const createRenderer = vi.fn(async () => createTestRenderer());

    await expect(createXrSessionRuntimeWithRenderer(
      root,
      store,
      session,
      {} as never,
      createRenderer,
    )).rejects.toThrow("XR session runtime mode must be immersive-ar, immersive-vr, or inline");
    await expect(createXrSessionRuntimeWithRenderer(
      root,
      store,
      session,
      { mode: "immersive-vr", renderOptions: {} } as never,
      createRenderer,
    )).rejects.toThrow(/unsupported option.*renderOptions/i);
    await expect(createXrSessionRuntimeWithRenderer(
      root,
      store,
      session,
      {
        mode: "immersive-vr",
        rendererOptions: { referenceSpacePreference: [] },
      },
      createRenderer,
    )).rejects.toThrow(/referenceSpacePreference must contain at least one/i);
    await expect(createXrSessionRuntimeWithRenderer(
      root,
      store,
      session,
      {
        mode: "immersive-vr",
        rendererOptions: {
          webGlLayer: { framebufferScaleFactor: 0 },
        },
      },
      createRenderer,
    )).rejects.toThrow(/framebufferScaleFactor must be positive and finite/i);
    await expect(createXrSessionRuntimeWithRenderer(
      root,
      store,
      session,
      { mode: "immersive-vr" },
      null as never,
    )).rejects.toThrow("XR session runtime createRenderer must be a function");

    expect(createRenderer).not.toHaveBeenCalled();
    expect(session.end).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ session: null, status: "available" });
  });

  it("owns frames, visibility, browser end, and exactly-once cleanup", async () => {
    const { root, unobserve } = createObservedRoot();
    const session = createTestSession();
    const store = createXrSessionStore<TestXrSession>({ available: true });
    const renderer = createTestRenderer();
    const createRenderer = vi.fn(async () => renderer);

    const runtime = await createXrSessionRuntimeWithRenderer(
      root,
      store,
      session,
      { mode: "immersive-vr", rendererOptions: { referenceSpacePreference: ["local"] } },
      createRenderer,
    );

    expect(createRenderer).toHaveBeenCalledWith(
      root,
      session,
      { referenceSpacePreference: ["local"] },
    );
    expect(store.getState()).toMatchObject({
      session,
      status: "active",
      visibilityState: "visible",
    });
    expect(session.requestAnimationFrame).toHaveBeenCalledTimes(1);

    session.setVisibility("hidden");
    session.emit("visibilitychange");
    expect(store.getState()).toMatchObject({
      session,
      status: "suspended",
      visibilityState: "hidden",
    });

    session.runNextFrame();
    expect(renderer.renderFrame).toHaveBeenCalledTimes(1);
    expect(session.requestAnimationFrame).toHaveBeenCalledTimes(2);

    session.emit("end");
    session.emit("end");
    expect(runtime.disposed).toBe(true);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(session.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(unobserve).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ session: null, status: "available" });
  });

  it("restores a live session when an explicit end request rejects", async () => {
    const { root } = createObservedRoot();
    const session = createTestSession();
    const store = createXrSessionStore<TestXrSession>({ available: true });
    const renderer = createTestRenderer();
    const firstEnd = deferred<void>();
    vi.mocked(session.end)
      .mockImplementationOnce(() => firstEnd.promise)
      .mockImplementationOnce(async () => undefined);
    const runtime = await createXrSessionRuntimeWithRenderer(
      root,
      store,
      session,
      { mode: "immersive-vr" },
      async () => renderer,
    );

    const ending = runtime.end();
    expect(store.getState()).toMatchObject({ session, status: "ending" });
    firstEnd.reject(new Error("browser refused to end"));
    await expect(ending).rejects.toThrow("browser refused to end");
    expect(runtime.disposed).toBe(false);
    expect(renderer.dispose).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      error: "browser refused to end",
      session,
      status: "active",
    });

    await runtime.end();
    expect(runtime.disposed).toBe(true);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ session: null, status: "available" });
  });

  it("disposes Royal resources immediately and settles state after browser end", async () => {
    const { root } = createObservedRoot();
    const session = createTestSession();
    const store = createXrSessionStore<TestXrSession>({ available: true });
    const renderer = createTestRenderer();
    const browserEnd = deferred<void>();
    vi.mocked(session.end).mockImplementationOnce(() => browserEnd.promise);
    const runtime = await createXrSessionRuntimeWithRenderer(
      root,
      store,
      session,
      { mode: "immersive-vr" },
      async () => renderer,
    );

    runtime.dispose();
    runtime.dispose();
    expect(runtime.disposed).toBe(true);
    expect(renderer.dispose).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ session, status: "ending" });

    browserEnd.resolve(undefined);
    await browserEnd.promise;
    await Promise.resolve();
    expect(store.getState()).toMatchObject({ session: null, status: "available" });
  });

  it("terminates the session after frame or renderer-root failure", async () => {
    const frameCase = createObservedRoot();
    const frameSession = createTestSession();
    const frameStore = createXrSessionStore<TestXrSession>({ available: true });
    const frameRenderer = createTestRenderer();
    vi.mocked(frameRenderer.renderFrame).mockImplementationOnce(() => {
      throw new Error("frame exploded");
    });
    const frameRuntime = await createXrSessionRuntimeWithRenderer(
      frameCase.root,
      frameStore,
      frameSession,
      { mode: "immersive-vr" },
      async () => frameRenderer,
    );

    frameSession.runNextFrame();
    expect(frameRuntime.disposed).toBe(true);
    expect(frameStore.getState()).toMatchObject({
      error: "frame exploded",
      session: null,
      status: "error",
    });
    expect(frameSession.end).toHaveBeenCalledTimes(1);

    const rootCase = createObservedRoot();
    const rootSession = createTestSession();
    const rootStore = createXrSessionStore<TestXrSession>({ available: true });
    const rootRenderer = createTestRenderer();
    const rootRuntime = await createXrSessionRuntimeWithRenderer(
      rootCase.root,
      rootStore,
      rootSession,
      { mode: "immersive-vr" },
      async () => rootRenderer,
    );
    rootCase.publishLifecycle({
      error: "context lost",
      generation: 2,
      interruptions: 1,
      recoveries: 0,
      state: "failed",
    });
    expect(rootRuntime.disposed).toBe(true);
    expect(rootStore.getState()).toMatchObject({
      error: "XR renderer root failed: context lost",
      session: null,
      status: "error",
    });
    expect(rootSession.end).toHaveBeenCalledTimes(1);
  });

  it("closes the browser session when renderer setup fails or startup is interrupted", async () => {
    const failedSession = createTestSession();
    const failedStore = createXrSessionStore<TestXrSession>({ available: true });
    await expect(createXrSessionRuntimeWithRenderer(
      createObservedRoot().root,
      failedStore,
      failedSession,
      { mode: "immersive-vr" },
      async () => { throw new Error("renderer setup failed"); },
    )).rejects.toThrow("renderer setup failed");
    expect(failedSession.end).toHaveBeenCalledTimes(1);
    expect(failedStore.getState()).toMatchObject({
      error: "renderer setup failed",
      session: null,
      status: "error",
    });

    const interruptedSession = createTestSession();
    const interruptedStore = createXrSessionStore<TestXrSession>({ available: true });
    const rendererReady = deferred<XrSessionRenderer>();
    const interruptedRenderer = createTestRenderer();
    const starting = createXrSessionRuntimeWithRenderer(
      createObservedRoot().root,
      interruptedStore,
      interruptedSession,
      { mode: "immersive-vr" },
      () => rendererReady.promise,
    );
    interruptedStore.getState().beginSessionEnd();
    rendererReady.resolve(interruptedRenderer);
    await expect(starting).rejects.toThrow("startup was interrupted");
    expect(interruptedRenderer.dispose).toHaveBeenCalledTimes(1);
    expect(interruptedSession.end).toHaveBeenCalledTimes(1);
    expect(interruptedStore.getState()).toMatchObject({
      session: null,
      status: "available",
    });
  });

  it("rolls back session ownership when startup observers or event setup throw", async () => {
    const observerSession = createTestSession();
    const observerStore = createXrSessionStore<TestXrSession>({ available: true });
    const observerFailure = new Error("starting observer failed");
    observerStore.subscribe(() => {
      throw observerFailure;
    });
    const createRenderer = vi.fn(async () => createTestRenderer());

    await expect(createXrSessionRuntimeWithRenderer(
      createObservedRoot().root,
      observerStore,
      observerSession,
      { mode: "immersive-vr" },
      createRenderer,
    )).rejects.toBe(observerFailure);
    expect(createRenderer).not.toHaveBeenCalled();
    expect(observerSession.end).toHaveBeenCalledOnce();
    expect(observerStore.getState()).toMatchObject({
      error: "starting observer failed",
      session: null,
      status: "error",
    });

    const eventSession = createTestSession();
    const eventStore = createXrSessionStore<TestXrSession>({ available: true });
    const renderer = createTestRenderer();
    const eventFailure = new Error("event setup failed");
    vi.spyOn(eventSession, "addEventListener").mockImplementationOnce(() => {
      throw eventFailure;
    });

    await expect(createXrSessionRuntimeWithRenderer(
      createObservedRoot().root,
      eventStore,
      eventSession,
      { mode: "immersive-vr" },
      async () => renderer,
    )).rejects.toBe(eventFailure);
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(eventSession.end).toHaveBeenCalledOnce();
    expect(eventStore.getState()).toMatchObject({
      error: "event setup failed",
      session: null,
      status: "error",
    });
  });
});
