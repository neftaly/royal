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
      expect(snapshot.retained, label).toBeLessThanOrEqual(capacity);
      expect(snapshot.messages, label).toHaveLength(snapshot.retained);
      expect(snapshot.occurrences, label).toEqual(
        [...retained].map(([key, count]) => ({ count, key })),
      );
      expect(snapshot.dropped, label).toBe(dropped);
      expect(snapshot.messages.every((message) => message.length <= 768), label).toBe(true);
      expect(Object.isFrozen(snapshot), label).toBe(true);
      expect(Object.isFrozen(snapshot.messages), label).toBe(true);
      expect(Object.isFrozen(snapshot.occurrences), label).toBe(true);
    });

    const longValue = "attacker-controlled-".repeat(256);
    const log = new BoundedDiagnosticLog({ capacity: 1 });
    log.record(longValue, longValue);
    log.record(longValue, longValue);
    const snapshot = log.snapshot();
    expect(snapshot.messages[0]?.length).toBeLessThanOrEqual(768);
    expect(snapshot.occurrences).toEqual([{
      count: 2,
      key: expect.stringMatching(/#[0-9a-f]{8}$/u),
    }]);
    expect(snapshot.occurrences[0]?.key.length).toBeLessThanOrEqual(192);
  });
});
