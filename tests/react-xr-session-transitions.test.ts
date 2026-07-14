import { describe, expect, it } from "vitest";
import {
  createInitialXrSessionStoreData,
  reduceXrSessionStoreData,
} from "../packages/react/src/xr-session-transitions";

type Session = { readonly id: string };

describe("XR session transition core", () => {
  it("models hidden activation, visibility recovery, and detached frame data", () => {
    const session: Session = { id: "session-a" };
    const initial = createInitialXrSessionStoreData<Session>({ available: true });
    const activeHidden = reduceXrSessionStoreData(initial, {
      options: { mode: "immersive-vr", visibilityState: "hidden" },
      session,
      type: "activate",
    });
    const visible = reduceXrSessionStoreData(activeHidden, {
      type: "visibility",
      visibilityState: "visible-blurred",
    });
    const sourceViewports = [{ height: 600, width: 800, x: 0, y: 0 }];
    const framed = reduceXrSessionStoreData(visible, {
      frame: { viewports: sourceViewports },
      type: "frame",
    });

    expect(activeHidden).toMatchObject({
      active: false,
      session,
      status: "suspended",
      visibilityState: "hidden",
    });
    expect(visible).toMatchObject({
      active: true,
      status: "active",
      visibilityState: "visible-blurred",
    });
    expect(framed).toMatchObject({ frameIndex: 1, viewCount: 1 });
    expect(framed.viewports).toEqual(sourceViewports);
    expect(framed.viewports).not.toBe(sourceViewports);
    expect(initial).toMatchObject({ active: false, session: null, status: "available" });
  });

  it("preserves identity for inapplicable owned-session transitions", () => {
    const initial = createInitialXrSessionStoreData<Session>({ available: true });

    expect(reduceXrSessionStoreData(initial, { type: "begin-end" })).toBe(initial);
    expect(reduceXrSessionStoreData(initial, { error: "ignored", type: "fail-end" })).toBe(initial);
    expect(reduceXrSessionStoreData(initial, { frame: {}, type: "frame" })).toBe(initial);
    expect(reduceXrSessionStoreData(initial, {
      type: "visibility",
      visibilityState: "hidden",
    })).toBe(initial);
  });

  it("rejects acquisition blocking while retaining a live session", () => {
    const session: Session = { id: "session-a" };
    const active = reduceXrSessionStoreData(
      createInitialXrSessionStoreData<Session>({ available: true }),
      { options: { mode: "immersive-ar" }, session, type: "activate" },
    );

    expect(() => reduceXrSessionStoreData(active, {
      error: undefined,
      options: {},
      reason: "immersive-session-already-active",
      type: "block",
    })).toThrow("Cannot block XR acquisition while a live session is owned");
    expect(active).toMatchObject({ active: true, session, status: "active" });
  });
});
