import { describe, expect, it } from "vitest";
import {
  createXrSessionStore,
  selectXrSessionSnapshot,
  useRoyalXR,
} from "@royal/react/xr";

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

    store.getState().setSnapshot({
      active: false,
      offerStatus: "offered",
      status: "available",
    });

    expect(store.getState().session).toBe(session);
    expect(store.getState().active).toBe(false);
    expect(store.getState().offerStatus).toBe("offered");
    expect(store.getState().status).toBe("available");
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
    });
  });

  it("exports an explicit-store Royal XR hook", () => {
    expect(typeof useRoyalXR).toBe("function");
  });
});
