import { describe, expect, it, vi } from "vitest";
import {
  createXrSessionStore,
  selectXrSessionSnapshot,
  type XrSessionActivationOptions,
  type XrSessionAvailabilityOptions,
  type XrSessionBeginOptions,
  type XrSessionBlockOptions,
  type XrSessionBlockReason,
  type XrSessionEndOptions,
  type XrSessionFailureOptions,
  type XrSessionStoreInitialState,
  type XrSessionStatus,
  useXrSessionSnapshot,
} from "@royal/react/xr";
import { createXrSessionSelectionReaders } from "../packages/react/src/xr-store";

type TestXrSession = {
  readonly id: string;
};

describe("React XR session store", () => {
  it("rejects malformed initial state, subscriptions, and selectors eagerly", () => {
    expect(() => createXrSessionStore(
      null as unknown as XrSessionStoreInitialState,
    )).toThrow("XR session store initialState must be an object");
    expect(() => createXrSessionStore({
      available: "yes",
    } as unknown as XrSessionStoreInitialState)).toThrow(/initialState available must be a boolean/i);
    expect(() => createXrSessionStore({
      sessionMode: "immersive-vr",
    } as unknown as XrSessionStoreInitialState)).toThrow(/unsupported option.*sessionMode/i);

    const store = createXrSessionStore<TestXrSession>();
    expect(() => store.subscribe(null as unknown as () => void))
      .toThrow("XR session store subscribe listener must be a function");
    expect(() => createXrSessionSelectionReaders(
      store,
      null as unknown as (state: ReturnType<typeof store.getState>) => unknown,
    )).toThrow("XR session selector must be a function");
    expect(() => createXrSessionSelectionReaders(
      store,
      (state) => state.status,
      null as unknown as (left: string, right: string) => boolean,
    )).toThrow("XR session selector equality must be a function");
  });

  it("notifies later subscribers after an earlier subscriber throws", () => {
    const store = createXrSessionStore<TestXrSession>();
    const failure = new Error("subscriber failed");
    const healthy = vi.fn();
    store.subscribe(() => {
      throw failure;
    });
    store.subscribe(healthy);

    expect(() => store.getState().setAvailability(true)).toThrow(failure);
    expect(healthy).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ available: true, status: "available" });
  });

  it("derives a consistent acquisition status from initial availability", () => {
    expect(createXrSessionStore().getState()).toMatchObject({
      available: false,
      status: "checking",
    });
    expect(createXrSessionStore({ available: true }).getState()).toMatchObject({
      available: true,
      status: "available",
    });
    expect(createXrSessionStore({ available: false }).getState()).toMatchObject({
      available: false,
      status: "unavailable",
    });
  });

  it("keeps snapshots serializable while live session control stays imperative", () => {
    const session: TestXrSession = { id: "session-a" };
    const store = createXrSessionStore<TestXrSession>({
      available: true,
    });

    store.getState().beginSession(session, { mode: "immersive-vr" });
    store.getState().activateSession(session, { mode: "immersive-vr" });

    const snapshot = selectXrSessionSnapshot(store.getState());
    expect(snapshot).toMatchObject({
      active: true,
      available: true,
      blockReason: null,
      mode: "immersive-vr",
      status: "active",
      visibilityState: "visible",
    });
    expect("session" in snapshot).toBe(false);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect("activateSession" in snapshot).toBe(false);
  });

  it("distinguishes live-session suspension from acquisition blocking", () => {
    const session: TestXrSession = { id: "session-hidden" };
    const store = createXrSessionStore<TestXrSession>({ available: true });

    store.getState().beginSession(session, { mode: "immersive-vr" });
    store.getState().activateSession(session, {
      mode: "immersive-vr",
      visibilityState: "hidden",
    });
    expect(store.getState()).toMatchObject({
      active: false,
      session,
      status: "suspended",
      visibilityState: "hidden",
    });

    store.getState().setSessionVisibility("visible-blurred");
    expect(store.getState()).toMatchObject({
      active: true,
      session,
      status: "active",
      visibilityState: "visible-blurred",
    });

    store.getState().beginSessionEnd();
    expect(store.getState()).toMatchObject({
      active: false,
      session,
      status: "ending",
    });

    store.getState().failSessionEnd(new Error("end rejected"));
    expect(store.getState()).toMatchObject({
      active: true,
      error: "end rejected",
      session,
      status: "active",
    });
    store.getState().beginSessionEnd();

    store.getState().setAvailability(false);
    expect(store.getState()).toMatchObject({
      available: false,
      session,
      status: "ending",
    });

    store.getState().endSession();
    expect(store.getState()).toMatchObject({
      active: false,
      available: false,
      session: null,
      status: "unavailable",
      visibilityState: null,
    });
  });

  it("records why acquisition was blocked without claiming session ownership", () => {
    const store = createXrSessionStore<TestXrSession>({ available: true });

    store.getState().beginSession(undefined, { mode: "immersive-vr" });
    store.getState().blockSession(
      "immersive-session-already-active",
      new Error("another immersive session owns the device"),
      { available: true, mode: "immersive-vr" },
    );
    expect(store.getState()).toMatchObject({
      active: false,
      available: true,
      blockReason: "immersive-session-already-active",
      error: "another immersive session owns the device",
      mode: "immersive-vr",
      session: null,
      status: "blocked",
    });

    store.getState().setAvailability(true);
    expect(store.getState()).toMatchObject({
      blockReason: null,
      error: null,
      status: "available",
    });
  });

  it("does not misclassify a failure after session ownership as blocked acquisition", () => {
    const session: TestXrSession = { id: "owned-session" };
    const store = createXrSessionStore<TestXrSession>({ available: true });
    store.getState().activateSession(session, { mode: "immersive-vr" });

    expect(() => {
      store.getState().blockSession("immersive-session-already-active");
    }).toThrow("Cannot block XR acquisition while a live session is owned");
    expect(store.getState()).toMatchObject({ session, status: "active" });
  });

  it("ignores live-session-only actions until a session is owned", () => {
    const store = createXrSessionStore<TestXrSession>({ available: true });
    const initial = store.getState();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications += 1);

    store.getState().beginSessionEnd();
    store.getState().setSessionVisibility("hidden");
    store.getState().recordFrame({ frameIndex: 42 });

    expect(store.getState()).toBe(initial);
    expect(notifications).toBe(0);
    unsubscribe();
  });

  it("owns duplicate subscriber callbacks independently", () => {
    const store = createXrSessionStore<TestXrSession>();
    const listener = vi.fn();
    const unsubscribeFirst = store.subscribe(listener);
    const unsubscribeSecond = store.subscribe(listener);

    store.getState().setAvailability(true);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribeFirst();
    store.getState().setAvailability(false);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribeSecond();
  });

  it("uses semantic actions for session lifecycle state", () => {
    const session: TestXrSession = { id: "session-b" };
    const store = createXrSessionStore<TestXrSession>();

    store.getState().setAvailability(true);
    store.getState().beginSession(session, { mode: "immersive-vr" });
    expect(store.getState()).toMatchObject({
      active: false,
      mode: "immersive-vr",
      session,
      status: "starting",
    });

    store.getState().activateSession(session, { mode: "immersive-vr" });
    store.getState().recordFrame({
      viewports: [{ height: 20, width: 10, x: 1, y: 2 }],
    });
    expect(store.getState()).toMatchObject({
      active: true,
      available: true,
      frameIndex: 1,
      status: "active",
      viewCount: 1,
    });

    store.getState().failSession(new Error("XR failed"), {
      available: false,
      mode: null,
    });
    expect(store.getState()).toMatchObject({
      active: false,
      available: false,
      error: "XR failed",
      mode: null,
      session: null,
      status: "error",
      viewCount: 0,
      viewports: [],
    });

    store.getState().endSession({ available: false });
    expect(store.getState()).toMatchObject({
      available: false,
      status: "unavailable",
    });
  });

  it("does not expose arbitrary status overrides on semantic actions", () => {
    // @ts-expect-error Availability derives its status from the boolean input.
    const invalidAvailability = { status: "active" } satisfies XrSessionAvailabilityOptions;
    // @ts-expect-error Beginning a session always enters starting.
    const invalidBegin = { status: "available" } satisfies XrSessionBeginOptions;
    // @ts-expect-error Activating a session always enters active.
    const invalidActivation = { mode: "immersive-vr", status: "starting" } satisfies XrSessionActivationOptions;
    // @ts-expect-error Ending derives available or unavailable from availability.
    const invalidEnd = { status: "active" } satisfies XrSessionEndOptions;
    // @ts-expect-error Failure always enters error.
    const invalidFailure = { status: "available" } satisfies XrSessionFailureOptions;
    // @ts-expect-error Blocking cannot override its derived status.
    const invalidBlock = { status: "error" } satisfies XrSessionBlockOptions;
    // @ts-expect-error Block reasons are a closed, inspectable vocabulary.
    const invalidBlockReason = "unknown" satisfies XrSessionBlockReason;
    // @ts-expect-error A store cannot begin with an active session it does not own.
    const invalidInitial = { active: true } satisfies XrSessionStoreInitialState;
    // @ts-expect-error No lifecycle action produces an ended status.
    const invalidStatus = "ended" satisfies XrSessionStatus;
    expect([
      invalidAvailability,
      invalidBegin,
      invalidActivation,
      invalidEnd,
      invalidFailure,
      invalidBlock,
      invalidBlockReason,
      invalidInitial,
      invalidStatus,
    ]).toHaveLength(9);

    const store = createXrSessionStore<TestXrSession>();
    if (false) {
      // @ts-expect-error endSession no longer accepts a status shorthand.
      store.getState().endSession("unavailable");
    }
  });

  it("exports an explicit-store XR snapshot hook", () => {
    expect(typeof useXrSessionSnapshot).toBe("function");
  });

  it("retains unrelated selector snapshots across frame records", () => {
    const session = { id: "selector-session" };
    const store = createXrSessionStore({ available: true });
    store.getState().activateSession(session, { mode: "immersive-vr" });
    const readers = createXrSessionSelectionReaders(
      store,
      (state) => ({ available: state.available, status: state.status }),
      (previous, next) =>
        previous.available === next.available && previous.status === next.status,
    );
    let selected = readers.getSelection();
    const before = selected;
    let selectionChanges = 0;
    const unsubscribe = store.subscribe(() => {
      const next = readers.getSelection();
      if (Object.is(next, selected)) return;
      selected = next;
      selectionChanges += 1;
    });

    store.getState().recordFrame({ frameIndex: 42 });

    expect(readers.getSelection()).toBe(before);
    expect(readers.getSelection()).toBe(before);
    expect(selectionChanges).toBe(0);
    store.getState().setAvailability(false);
    expect(readers.getSelection()).not.toBe(before);
    expect(selectionChanges).toBe(1);
    unsubscribe();
  });
});
