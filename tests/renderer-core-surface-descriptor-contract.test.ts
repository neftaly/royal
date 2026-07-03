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
} from "@royal/renderer-core";

describe("renderer-core surface descriptor contract", () => {
  it("builds normalized plain descriptors without renderer or app state", () => {
    const item = surfaceItem({
      id: " piece-a ",
      label: "Piece A",
    });
    const table = surfaceTable({
      children: [
        surfaceZone({
          children: [item],
          id: " board ",
          label: "Board",
        }),
      ],
      id: " table ",
      label: "Table",
    });
    const panel = surfacePanel({
      children: [surfaceText({ id: " readout ", value: "Ready" })],
      id: " panel ",
      label: "Status",
    });
    const descriptor = surface({
      id: " workspace ",
      nodes: [table, panel],
    });

    expect(descriptor).toEqual({
      id: "workspace",
      nodes: [
        {
          children: [
            {
              children: [
                {
                  id: "piece-a",
                  kind: "item",
                  label: "Piece A",
                },
              ],
              id: "board",
              kind: "zone",
              label: "Board",
            },
          ],
          id: "table",
          kind: "table",
          label: "Table",
        },
        {
          children: [
            {
              id: "readout",
              kind: "text",
              value: "Ready",
            },
          ],
          id: "panel",
          kind: "panel",
          label: "Status",
        },
      ],
    });
    expect(validateSurfaceDescriptor(descriptor)).toEqual([]);
    expect(JSON.parse(JSON.stringify(descriptor))).toEqual(descriptor);
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.nodes)).toBe(true);
    expect(Object.isFrozen(table.children)).toBe(true);
    expect(Object.isFrozen(panel.children)).toBe(true);
  });

  it("keeps surface event rows serializable and target-id based", () => {
    const event = surfaceEventRow({
      path: [" workspace ", " table ", " piece-a "],
      targetId: " piece-a ",
      type: "pick",
    });

    expect(event).toEqual({
      path: ["workspace", "table", "piece-a"],
      targetId: "piece-a",
      type: "pick",
    });
    expect(JSON.parse(JSON.stringify(event))).toEqual(event);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.path)).toBe(true);
  });

  it("reports duplicate and empty target ids as diagnostics", () => {
    expect(validateSurfaceDescriptor({
      id: "workspace",
      nodes: [
        { id: "piece", kind: "item" },
        { id: "piece", kind: "text", value: "duplicate" },
        { id: " ", kind: "item" },
      ],
    })).toEqual([
      {
        code: "duplicate_target_id",
        message: "Duplicate surface target ID: piece",
        targetId: "piece",
      },
      {
        code: "empty_target_id",
        message: "Surface target IDs must be non-empty strings",
        targetId: " ",
      },
    ]);
  });

  it("reports duplicate target ids after normalizing direct descriptors", () => {
    expect(validateSurfaceDescriptor({
      id: "workspace",
      nodes: [
        { id: " piece ", kind: "item" },
        { id: "piece", kind: "text", value: "duplicate" },
      ],
    })).toEqual([
      {
        code: "duplicate_target_id",
        message: "Duplicate surface target ID: piece",
        targetId: "piece",
      },
    ]);
  });

  it("rejects empty ids at constructor boundaries", () => {
    expect(() => surface({ id: " " })).toThrow("Surface target ID must be a non-empty string");
    expect(() => surfaceItem({ id: "" })).toThrow("Surface target ID must be a non-empty string");
    expect(() => surfaceEventRow({
      path: ["surface"],
      targetId: "",
      type: "focus",
    })).toThrow("Surface target ID must be a non-empty string");
  });

  it("rejects event rows without a target-terminated path", () => {
    expect(() => surfaceEventRow({
      path: [],
      targetId: "piece-a",
      type: "pick",
    })).toThrow("Surface event path must include the target ID");
    expect(() => surfaceEventRow({
      path: ["surface", "piece-b"],
      targetId: "piece-a",
      type: "pick",
    })).toThrow("Surface event path must end with the target ID");
  });

  it("keeps decomposition in renderer-owned node rows", () => {
    const descriptor = surface({
      id: "surface",
      nodes: [
        surfaceTable({
          children: [
            surfaceZone({
              children: [
                surfaceItem({ id: "piece-a", label: "Piece A" }),
                surfaceText({ id: "piece-count", value: "1" }),
              ],
              id: "board",
            }),
          ],
          id: "table",
        }),
      ],
    });

    expect(descriptor.nodes).toHaveLength(1);
    expect(JSON.stringify(descriptor)).not.toMatch(/dom|css|layout|schema|fallback/i);
  });
});
