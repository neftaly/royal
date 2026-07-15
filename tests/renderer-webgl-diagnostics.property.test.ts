import { describe, expect, it } from "vitest";
import {
  BoundedDiagnosticLog,
  boundedDiagnosticDecision,
} from "../packages/renderer-webgl/src/diagnostics";
import { forEachFuzzCase } from "./fuzz";

describe("bounded WebGL diagnostics", () => {
  it("keeps retained storage bounded while aggregating repeated keys", () => {
    forEachFuzzCase({ cases: 32, seed: 0xd1a6_0057 }, ({ label, random }) => {
      const capacity = random.int(0, 33);
      const operationCount = random.int(128, 513);
      const keyCount = random.int(1, 97);
      const log = new BoundedDiagnosticLog({ capacity });
      const retained = new Map<string, number>();
      let dropped = 0;

      for (let operation = 0; operation < operationCount; operation += 1) {
        const key = `asset-${random.int(0, keyCount)}`;
        const existing = retained.get(key);
        const decision = boundedDiagnosticDecision(existing !== undefined, retained.size, capacity);
        if (decision === "increment") retained.set(key, existing! + 1);
        else if (decision === "append") retained.set(key, 1);
        else dropped += 1;

        log.record(key, `${key}:${"x".repeat(random.int(0, 1025))}`);
      }

      const snapshot = log.snapshot();
      expect(snapshot.entries.length, label).toBeLessThanOrEqual(capacity);
      expect(snapshot.entries, label).toEqual(
        [...retained].map(([key, occurrences]) => ({
          key,
          message: expect.any(String),
          occurrences,
        })),
      );
      expect(snapshot.dropped, label).toBe(dropped);
      expect(snapshot.entries.every((entry) => entry.message.length <= 768), label).toBe(true);
      expect(Object.isFrozen(snapshot), label).toBe(true);
      expect(Object.isFrozen(snapshot.entries), label).toBe(true);
      expect(snapshot.entries.every(Object.isFrozen), label).toBe(true);
    });

    const longValue = "attacker-controlled-".repeat(256);
    const log = new BoundedDiagnosticLog({ capacity: 1 });
    log.record(longValue, longValue);
    log.record(longValue, longValue);
    const snapshot = log.snapshot();
    expect(snapshot.entries[0]?.message.length).toBeLessThanOrEqual(768);
    expect(snapshot.entries).toEqual([{
      key: expect.stringMatching(/#[0-9a-f]{8}$/u),
      message: expect.any(String),
      occurrences: 2,
    }]);
    expect(snapshot.entries[0]?.key.length).toBeLessThanOrEqual(192);
  });
});
