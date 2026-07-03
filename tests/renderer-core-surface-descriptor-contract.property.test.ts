import { describe, expect, it } from "vitest";
import {
  surface,
  surfaceEventRow,
  surfaceItem,
  surfacePanel,
  surfaceTable,
  surfaceText,
  surfaceZone,
  validateSurfaceDescriptor,
  type SurfaceNode,
} from "@royal/renderer-core";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

const idFor = (prefix: string, value: number): string => ` ${prefix}-${value} `;

const leafNode = (
  random: SeededRandom,
  id: string,
): SurfaceNode =>
  random.boolean()
    ? surfaceItem({
      id,
      label: `Item ${id.trim()}`,
    })
    : surfaceText({
      id,
      value: `Text ${id.trim()}`,
    });

describe("renderer-core surface descriptor properties", () => {
  it("normalizes sparse surface inputs without mutating author arrays", () => {
    forEachFuzzCase({ cases: 24, seed: 0x51faced }, ({ label, random, seed }) => {
      const item = leafNode(random, idFor("item", seed));
      const zoneChildren = [item];
      const zone = surfaceZone({
        children: zoneChildren,
        id: idFor("zone", seed),
        ...(random.boolean() ? { label: "Zone" } : {}),
      });
      const tableChildren = [zone];
      const panelChildren = [surfaceText({ id: idFor("readout", seed), value: "Ready" })];
      const nodes = [
        surfaceTable({
          children: tableChildren,
          id: idFor("table", seed),
        }),
        surfacePanel({
          children: panelChildren,
          id: idFor("panel", seed),
        }),
      ];
      const descriptor = surface({
        id: idFor("surface", seed),
        nodes,
      });

      expect(descriptor.id, label).toBe(`surface-${seed}`);
      expect(descriptor.nodes, label).not.toBe(nodes);
      expect((descriptor.nodes[0] as Extract<SurfaceNode, { kind: "table" }>).children, label).not.toBe(tableChildren);
      expect((descriptor.nodes[1] as Extract<SurfaceNode, { kind: "panel" }>).children, label).not.toBe(panelChildren);
      expect(zone.children, label).not.toBe(zoneChildren);
      expect(validateSurfaceDescriptor(descriptor), label).toEqual([]);
      expect(JSON.parse(JSON.stringify(descriptor)), label).toEqual(descriptor);
    });
  });

  it("keeps generated event rows JSON-safe and target-id based", () => {
    forEachFuzzCase({ cases: 24, seed: 0xe7e475 }, ({ label, random, seed }) => {
      const type = random.boolean() ? "pick" : random.boolean() ? "focus" : "activate";
      const targetId = idFor("target", seed);
      const event = surfaceEventRow({
        path: [idFor("surface", seed), idFor("node", seed), targetId],
        targetId,
        type,
      });

      expect(event.targetId, label).toBe(`target-${seed}`);
      expect(event.path.at(-1), label).toBe(event.targetId);
      expect(JSON.parse(JSON.stringify(event)), label).toEqual(event);
      expect(Object.values(event).some((value) => typeof value === "function"), label).toBe(false);
    });
  });
});
