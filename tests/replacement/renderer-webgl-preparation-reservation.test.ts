import { describe, expect, it } from "vitest";
import {
  canReserveTextureSource,
  preparingTextureReservation,
  replaceTextureReservationInto,
  type TextureReservation,
} from "../../packages/renderer-webgl/src/texture/preparation-reservation";

describe("texture preparation reservations", () => {
  it("conserves totals across overlapping completion, cancellation, and lease transfer", () => {
    const entries: TextureReservation[] = Array(12).fill(undefined);
    const totals = { activePreparations: 0, sourceReservations: 0, decodedHandoffBytes: 0 };
    const transition = (index: number, next: TextureReservation): void => {
      replaceTextureReservationInto(totals, entries[index], next);
      entries[index] = next;
      // Independent inventory oracle, including release of an already released entry.
      expect(totals).toEqual({
        activePreparations: entries.filter((entry) => entry?.phase === "preparing").length,
        sourceReservations: entries.filter((entry) => entry !== undefined).length,
        decodedHandoffBytes: entries.reduce(
          (sum, entry) => sum + (entry?.phase === "handoff" ? entry.bytes : 0),
          0,
        ),
      });
    };
    for (let i = 0; i < entries.length; i += 1) transition(i, preparingTextureReservation);
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      transition(i, i % 3 === 0 ? undefined : { phase: "handoff", bytes: (i + 1) * 1024 });
    }
    for (let i = 0; i < entries.length; i += 1) transition(i, undefined);
    expect(totals).toEqual({
      activePreparations: 0,
      sourceReservations: 0,
      decodedHandoffBytes: 0,
    });
  });

  it("blocks behind an oversized handoff until release and respects both count ceilings", () => {
    const totals = { activePreparations: 0, sourceReservations: 1, decodedHandoffBytes: 200 };
    expect(canReserveTextureSource(totals, 2, 4, 100)).toBe(false);
    replaceTextureReservationInto(totals, { phase: "handoff", bytes: 200 }, undefined);
    expect(canReserveTextureSource(totals, 2, 4, 100)).toBe(true);
    expect(
      canReserveTextureSource(
        { ...totals, activePreparations: 2, sourceReservations: 2 },
        2,
        4,
        100,
      ),
    ).toBe(false);
    expect(canReserveTextureSource({ ...totals, sourceReservations: 4 }, 2, 4, 100)).toBe(false);
  });
});
