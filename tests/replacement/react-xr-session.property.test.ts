import { describe, it } from "vitest";
import {
  initialXrSessionSnapshot,
  reduceXrSessionSnapshot,
  type XrSessionEvent,
  type XrSessionMode,
  type XrSessionSnapshot,
  type XrSessionStatus,
  type XrVisibilityState,
} from "../../packages/react/src/xr/session-state";
import {
  assertFuzz,
  assertFuzzEqual,
  forEachFuzzCase,
  type SeededRandom,
} from "../fuzz";

const MODES: readonly XrSessionMode[] = ["immersive-ar", "immersive-vr", "inline"];
const VISIBILITY_STATES: readonly XrVisibilityState[] = [
  "hidden",
  "visible",
  "visible-blurred",
];

const randomEvent = (random: SeededRandom): XrSessionEvent => {
  switch (random.int(0, 10)) {
    case 0: return { kind: "availability", supported: random.boolean() };
    case 1: return { kind: "begin" };
    case 2: return { kind: "activate", visibilityState: random.pick(VISIBILITY_STATES) };
    case 3: return { kind: "visibility", visibilityState: random.pick(VISIBILITY_STATES) };
    case 4: return { kind: "begin-end" };
    case 5: return {
      error: random.boolean() ? "" : `end-${random.int(0, 8)}`,
      kind: "end-failed",
    };
    case 6: return { kind: "ended" };
    case 7: return {
      blocked: random.boolean(),
      error: random.boolean() ? "" : `failure-${random.int(0, 8)}`,
      kind: "fail",
    };
    case 8: return { kind: "dispose" };
    default: return { kind: "begin" };
  }
};

const assertSnapshotInvariant = (snapshot: XrSessionSnapshot): void => {
  const observed: Readonly<{
    error?: string;
    status: XrSessionStatus;
    visibilityState: XrVisibilityState | null;
  }> = snapshot;
  switch (observed.status) {
    case "available":
    case "checking":
    case "disposed":
    case "starting":
    case "unavailable":
      assertFuzzEqual(observed.error, undefined, `${observed.status} error`);
      assertFuzzEqual(observed.visibilityState, null, `${observed.status} visibility`);
      return;
    case "blocked":
    case "error":
      assertFuzz(
        typeof observed.error === "string",
        `${observed.status} requires an error string`,
      );
      assertFuzzEqual(observed.visibilityState, null, `${observed.status} visibility`);
      return;
    case "active":
      assertFuzz(
        observed.visibilityState === "visible" || observed.visibilityState === "visible-blurred",
        "active visibility must be visible or visible-blurred",
      );
      return;
    case "suspended":
      assertFuzzEqual(observed.visibilityState, "hidden", "suspended visibility");
      return;
    case "ending":
      assertFuzz(observed.visibilityState !== null, "ending visibility must be retained");
  }
};

describe("XR session state properties", () => {
  it("preserves correlated public state under arbitrary event sequences", () => {
    forEachFuzzCase({ cases: 32, seed: 0x58_52_53_54 }, ({ random }) => {
      const mode = random.pick(MODES);
      let snapshot = initialXrSessionSnapshot(mode);
      assertSnapshotInvariant(snapshot);
      for (let step = 0; step < 128; step += 1) {
        const previous = snapshot;
        snapshot = reduceXrSessionSnapshot(snapshot, randomEvent(random));
        assertFuzzEqual(snapshot.mode, mode, "session mode");
        assertSnapshotInvariant(snapshot);
        if (previous.status === "disposed") {
          assertFuzzEqual(snapshot, previous, "disposed state must be absorbing");
        }
      }
    });
  });
});
