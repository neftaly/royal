import { describe, expect, it } from "vitest";
import {
  appendFramePacket,
  appendSelectedFramePacket,
  assertSelectedFramePacketsCurrent,
  beginSelectedFramePackets,
  createFramePacketCatalog,
  createSelectedFramePackets,
  FRAME_PACKET_RENDER_CLASS,
  NO_FRAME_PACKET_ID,
  resetFramePacketCatalog,
  resetSelectedFramePackets,
  writeFramePacket,
  type FramePacketCatalog,
  type FramePacketRow,
  type SelectedFramePackets,
} from "../packages/renderer-webgl/src/frame-packets";
import { forEachFuzzCase, SeededRandom } from "./fuzz";

const randomRow = (random: SeededRandom): FramePacketRow => {
  const instanceFirst = random.int(0, 10_000);
  return {
    boundsId: random.int(0, 100_000),
    geometryId: random.int(0, 100_000),
    instanceCount: random.int(1, 1_000),
    instanceFirst,
    ...(random.boolean() ? { instanceStreamId: random.int(0, 100_000) } : {}),
    localModelId: random.int(0, 100_000),
    materialId: random.int(0, 100_000),
    orderingSegment: random.int(0, 1_000),
    renderClass: random.pick([
      FRAME_PACKET_RENDER_CLASS.opaque,
      FRAME_PACKET_RENDER_CLASS.transmissive,
      FRAME_PACKET_RENDER_CLASS.blended,
    ]),
    rootSourceId: random.int(0, 100_000),
    sidedness: random.int(0, 4),
  };
};

const expectCatalog = (catalog: FramePacketCatalog, rows: readonly FramePacketRow[]): void => {
  expect(catalog.count).toBe(rows.length);
  expect(catalog.capacity).toBeGreaterThanOrEqual(catalog.count);
  for (const [index, row] of rows.entries()) {
    expect(catalog.boundsIds[index]).toBe(row.boundsId);
    expect(catalog.geometryIds[index]).toBe(row.geometryId);
    expect(catalog.instanceCounts[index]).toBe(row.instanceCount);
    expect(catalog.instanceFirsts[index]).toBe(row.instanceFirst);
    expect(catalog.instanceStreamIds[index]).toBe(row.instanceStreamId ?? NO_FRAME_PACKET_ID);
    expect(catalog.localModelIds[index]).toBe(row.localModelId);
    expect(catalog.materialIds[index]).toBe(row.materialId);
    expect(catalog.orderingSegments[index]).toBe(row.orderingSegment);
    expect(catalog.renderClasses[index]).toBe(row.renderClass);
    expect(catalog.rootSourceIds[index]).toBe(row.rootSourceId);
    expect(catalog.sidedness[index]).toBe(row.sidedness);
  }
};

const expectSelection = (
  selected: SelectedFramePackets,
  expected: readonly number[],
): void => {
  expect(selected.count).toBe(expected.length);
  expect(selected.capacity).toBeGreaterThanOrEqual(selected.count);
  expect(Array.from(selected.orderedPacketIndices.subarray(0, selected.count))).toEqual(expected);
};

describe("retained frame packets", () => {
  it("preserves dense ranges and executor order across randomized writes, resets, and growth", () => {
    forEachFuzzCase({ cases: 64, seed: 0x5041_434b }, ({ random }) => {
      const catalog = createFramePacketCatalog(random.int(1, 5));
      const selected = createSelectedFramePackets(catalog, random.int(1, 5));
      const rows: FramePacketRow[] = [];
      const ordered: number[] = [];

      for (let operation = 0; operation < 96; operation += 1) {
        const kind = random.int(0, 10);
        if (kind < 5 || rows.length === 0) {
          const row = randomRow(random);
          const revision = catalog.revision;
          expect(appendFramePacket(catalog, row)).toBe(rows.length);
          rows.push(row);
          expect(catalog.revision).toBe(revision + 1);
          expect(() => assertSelectedFramePacketsCurrent(selected, catalog)).toThrow(/stale/);
          beginSelectedFramePackets(selected, catalog);
          ordered.length = 0;
        } else if (kind < 7) {
          const index = random.int(0, rows.length);
          const row = randomRow(random);
          const revision = catalog.revision;
          writeFramePacket(catalog, index, row);
          rows[index] = row;
          expect(catalog.revision).toBe(revision + 1);
          expect(() => assertSelectedFramePacketsCurrent(selected, catalog)).toThrow(/stale/);
          beginSelectedFramePackets(selected, catalog);
          ordered.length = 0;
        } else if (kind === 7) {
          const index = random.int(0, rows.length);
          appendSelectedFramePacket(selected, catalog, index);
          ordered.push(index);
        } else if (kind === 8) {
          resetSelectedFramePackets(selected);
          ordered.length = 0;
        } else {
          resetSelectedFramePackets(selected);
          const revision = catalog.revision;
          resetFramePacketCatalog(catalog);
          ordered.length = 0;
          rows.length = 0;
          if (revision !== catalog.revision) {
            expect(() => assertSelectedFramePacketsCurrent(selected, catalog)).toThrow(/stale/);
            beginSelectedFramePackets(selected, catalog);
          }
        }
        expect(catalog.count).toBe(rows.length);
        expect(selected.count).toBe(ordered.length);
        if (operation % 8 === 0) {
          expectCatalog(catalog, rows);
          expectSelection(selected, ordered);
        }
      }
      expectCatalog(catalog, rows);
      expectSelection(selected, ordered);

      const catalogArrays = Object.freeze({
        boundsIds: catalog.boundsIds,
        geometryIds: catalog.geometryIds,
        instanceCounts: catalog.instanceCounts,
        instanceFirsts: catalog.instanceFirsts,
        instanceStreamIds: catalog.instanceStreamIds,
        localModelIds: catalog.localModelIds,
        materialIds: catalog.materialIds,
        orderingSegments: catalog.orderingSegments,
        renderClasses: catalog.renderClasses,
        rootSourceIds: catalog.rootSourceIds,
        sidedness: catalog.sidedness,
      });
      const orderedPacketIndices = selected.orderedPacketIndices;
      const warmCount = Math.min(catalog.capacity, selected.capacity, 4);
      resetSelectedFramePackets(selected);
      resetFramePacketCatalog(catalog);
      for (let index = 0; index < warmCount; index += 1) {
        appendFramePacket(catalog, randomRow(random));
      }
      beginSelectedFramePackets(selected, catalog);
      for (let index = 0; index < warmCount; index += 1) {
        appendSelectedFramePacket(selected, catalog, index);
      }
      for (const [name, value] of Object.entries(catalogArrays)) {
        expect(catalog[name as keyof typeof catalogArrays]).toBe(value);
      }
      expect(selected.orderedPacketIndices).toBe(orderedPacketIndices);
    });
  }, 15_000);

  it("rejects lossy IDs, invalid flags, sparse writes, and overflowing instance ranges atomically", () => {
    const catalog = createFramePacketCatalog();
    const valid = randomRow(new SeededRandom(0x4944_5346));
    appendFramePacket(catalog, valid);
    const selected = createSelectedFramePackets(catalog);
    appendSelectedFramePacket(selected, catalog, 0);
    const revision = catalog.revision;

    const invalidRows: FramePacketRow[] = [
      { ...valid, geometryId: NO_FRAME_PACKET_ID },
      { ...valid, instanceCount: 0 },
      { ...valid, instanceCount: 2, instanceFirst: 0xffff_ffff },
      { ...valid, renderClass: 9 as typeof valid.renderClass },
      { ...valid, sidedness: 4 },
    ];
    for (const row of invalidRows) {
      expect(() => writeFramePacket(catalog, 0, row)).toThrow();
      expectCatalog(catalog, [valid]);
      expect(catalog.revision).toBe(revision);
      expect(() => assertSelectedFramePacketsCurrent(selected, catalog)).not.toThrow();
    }
    expect(() => writeFramePacket(catalog, 2, valid)).toThrow(/dense row/);
    expect(catalog.count).toBe(1);

    expect(() => appendSelectedFramePacket(selected, catalog, 1)).toThrow(/populated/);
    expect(selected.count).toBe(1);
    writeFramePacket(catalog, 0, valid);
    expect(catalog.revision).toBe(revision);
    expect(() => assertSelectedFramePacketsCurrent(selected, catalog)).not.toThrow();
    writeFramePacket(catalog, 0, { ...valid, materialId: valid.materialId + 1 });
    expect(catalog.revision).toBe(revision + 1);
    expect(() => appendSelectedFramePacket(selected, catalog, 0)).toThrow(/stale/);
    beginSelectedFramePackets(selected, catalog);
    appendSelectedFramePacket(selected, catalog, 0);
    expect(selected.count).toBe(1);

    const equalRevisionCatalog = createFramePacketCatalog();
    appendFramePacket(equalRevisionCatalog, valid);
    writeFramePacket(equalRevisionCatalog, 0, { ...valid, materialId: valid.materialId + 1 });
    expect(equalRevisionCatalog.revision).toBe(catalog.revision);
    expect(() => assertSelectedFramePacketsCurrent(selected, equalRevisionCatalog)).toThrow(/stale/);
    beginSelectedFramePackets(selected, equalRevisionCatalog);
    expect(() => assertSelectedFramePacketsCurrent(selected, equalRevisionCatalog)).not.toThrow();
    expect(selected.count).toBe(0);
  });
});
