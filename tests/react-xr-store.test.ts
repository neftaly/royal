import { describe, expect, it } from "vitest";
import {
  createXrSessionStore,
  selectXrSessionSnapshot,
  useXrSessionSnapshot,
} from "@royal/react/xr";
import { createXrSessionSelectionReaders } from "../packages/react/src/xr-store";

type TestXrSession = {
  readonly id: string;
};

describe("React XR session store", () => {
  it("keeps snapshots serializable while live session control stays imperative", () => {
    const session: TestXrSession = { id: "session-a" };
    const store = createXrSessionStore<TestXrSession>({
      available: true,
      offerStatus: "pending",
    });

    store.getState().beginSession(session, { mode: "immersive-vr" });
    store.getState().activateSession(session, { mode: "immersive-vr" });

    const snapshot = selectXrSessionSnapshot(store.getState());
    expect(snapshot).toMatchObject({
      active: true,
      available: true,
      mode: "immersive-vr",
      offerStatus: "pending",
      status: "active",
    });
    expect("session" in snapshot).toBe(false);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect("activateSession" in snapshot).toBe(false);
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

  it("exports an explicit-store XR snapshot hook", () => {
    expect(typeof useXrSessionSnapshot).toBe("function");
  });

  it("retains unrelated selector snapshots across frame records", () => {
    const store = createXrSessionStore({ available: true });
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
