import { describe, expect, it } from "vitest";
import {
  appendFramePacket,
  appendFramePacketLodRequirement,
  appendSelectedFramePacket,
  assertSelectedFramePacketsCurrent,
  beginSelectedFramePacketView,
  beginSelectedFramePacketViews,
  beginSelectedFramePackets,
  createFramePacketCatalog,
  createFramePacketLodRequirements,
  createSelectedFramePackets,
  FRAME_PACKET_RENDER_CLASS,
  endSelectedFramePacketView,
  framePacketLodRequirementsMatch,
  NO_FRAME_PACKET_ID,
  resetFramePacketCatalog,
  resetFramePacketLodRequirements,
  resetSelectedFramePackets,
  selectedFramePacketViewRange,
  writeFramePacket,
  writeFramePacketLodRequirement,
  type FramePacketCatalog,
  type FramePacketRow,
  type SelectedFramePackets,
} from "../packages/renderer-webgl/src/frame/packets";
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
    lodRequirementCount: 0,
    lodRequirementFirst: 0,
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
    expect(catalog.lodRequirementCounts[index]).toBe(row.lodRequirementCount);
    expect(catalog.lodRequirementFirsts[index]).toBe(row.lodRequirementFirst);
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
  it("retains contiguous nonoverlapping ranges for randomized view selections", () => {
    forEachFuzzCase({ cases: 96, seed: 0x5649_4557 }, ({ random }) => {
      const packetCount = random.int(1, 48);
      const viewCount = random.int(0, 24);
      const catalog = createFramePacketCatalog(packetCount);
      for (let index = 0; index < packetCount; index += 1) {
        appendFramePacket(catalog, randomRow(random));
      }
      const selected = createSelectedFramePackets(catalog, random.int(1, 4), random.int(1, 4));
      const expected: number[] = [];
      const expectedFirsts: number[] = [];
      const expectedCounts: number[] = [];
      const range = { count: -1, first: -1 };

      beginSelectedFramePacketViews(selected, catalog, viewCount);
      for (let viewIndex = 0; viewIndex < viewCount; viewIndex += 1) {
        expectedFirsts.push(expected.length);
        beginSelectedFramePacketView(selected, catalog, viewIndex);
        const count = random.int(0, packetCount + 1);
        expectedCounts.push(count);
        for (let packet = 0; packet < count; packet += 1) {
          const packetIndex = random.int(0, packetCount);
          appendSelectedFramePacket(selected, catalog, packetIndex);
          expected.push(packetIndex);
        }
        endSelectedFramePacketView(selected, catalog, viewIndex);
        selectedFramePacketViewRange(selected, catalog, viewIndex, range);
        expect(range).toEqual({ count, first: expectedFirsts[viewIndex] });
      }

      expectSelection(selected, expected);
      expect(selected.viewCount).toBe(viewCount);
      expect(selected.nextViewIndex).toBe(viewCount);
      expect(selected.openViewIndex).toBe(-1);
      expect(Array.from(selected.viewFirsts.subarray(0, viewCount))).toEqual(expectedFirsts);
      expect(Array.from(selected.viewCounts.subarray(0, viewCount))).toEqual(expectedCounts);
      for (let viewIndex = 1; viewIndex < viewCount; viewIndex += 1) {
        expect(selected.viewFirsts[viewIndex]).toBe(
          selected.viewFirsts[viewIndex - 1]! + selected.viewCounts[viewIndex - 1]!,
        );
      }
    });
  }, 15_000);

  it("rejects invalid view lifecycle operations and stale ranges without partial mutation", () => {
    const catalog = createFramePacketCatalog();
    appendFramePacket(catalog, randomRow(new SeededRandom(0x5241_4e47)));
    const selected = createSelectedFramePackets(catalog);
    const range = { count: 9, first: 9 };

    expect(() => beginSelectedFramePacketViews(selected, catalog, -1)).toThrow(/view count/);
    expect(() => beginSelectedFramePacketViews(selected, catalog, 0x1_0000_0000)).toThrow(/view count/);
    expect(selected.viewCount).toBe(0);
    beginSelectedFramePacketViews(selected, catalog, 0);
    expect(() => appendSelectedFramePacket(selected, catalog, 0)).toThrow(/open view/);
    beginSelectedFramePacketViews(selected, catalog, 2);
    expect(() => endSelectedFramePacketView(selected, catalog, -1)).toThrow(/match/);
    expect(selected.nextViewIndex).toBe(0);
    expect(() => beginSelectedFramePacketView(selected, catalog, 1)).toThrow(/dense index order/);
    expect(() => appendSelectedFramePacket(selected, catalog, 0)).toThrow(/open view/);
    expect(() => selectedFramePacketViewRange(selected, catalog, 0, range)).toThrow(/completed/);
    expect(range).toEqual({ count: 9, first: 9 });

    beginSelectedFramePacketView(selected, catalog, 0);
    expect(() => beginSelectedFramePacketView(selected, catalog, 0)).toThrow(/must be ended/);
    appendSelectedFramePacket(selected, catalog, 0);
    expect(() => endSelectedFramePacketView(selected, catalog, 1)).toThrow(/match/);
    expect(selected.count).toBe(1);
    expect(selected.openViewIndex).toBe(0);
    endSelectedFramePacketView(selected, catalog, 0);
    expect(() => endSelectedFramePacketView(selected, catalog, -1)).toThrow(/match/);
    expect(selected.nextViewIndex).toBe(1);
    expect(() => endSelectedFramePacketView(selected, catalog, 0)).toThrow(/match/);
    expect(() => beginSelectedFramePacketView(selected, catalog, 0)).toThrow(/dense index order/);
    expect(() => beginSelectedFramePacketView(selected, catalog, 2)).toThrow(/dense index order/);

    appendFramePacket(catalog, randomRow(new SeededRandom(0x5354_414c)));
    expect(() => beginSelectedFramePacketView(selected, catalog, 1)).toThrow(/stale/);
    expect(() => selectedFramePacketViewRange(selected, catalog, 0, range)).toThrow(/stale/);
    expect(range).toEqual({ count: 9, first: 9 });
  });

  it("grows packet and view storage independently and retains identities once warm", () => {
    const catalog = createFramePacketCatalog(16);
    for (let index = 0; index < 16; index += 1) {
      appendFramePacket(catalog, randomRow(new SeededRandom(index + 1)));
    }
    const selected = createSelectedFramePackets(catalog, 1, 1);
    const initialPackets = selected.orderedPacketIndices;
    const initialFirsts = selected.viewFirsts;
    const initialCounts = selected.viewCounts;
    beginSelectedFramePacketViews(selected, catalog, 8);
    expect(selected.viewFirsts).not.toBe(initialFirsts);
    expect(selected.viewCounts).not.toBe(initialCounts);
    expect(selected.orderedPacketIndices).toBe(initialPackets);
    const warmFirsts = selected.viewFirsts;
    const warmCounts = selected.viewCounts;

    for (let viewIndex = 0; viewIndex < 8; viewIndex += 1) {
      beginSelectedFramePacketView(selected, catalog, viewIndex);
      appendSelectedFramePacket(selected, catalog, viewIndex);
      endSelectedFramePacketView(selected, catalog, viewIndex);
    }
    expect(selected.orderedPacketIndices).not.toBe(initialPackets);
    const warmPackets = selected.orderedPacketIndices;

    for (let iteration = 0; iteration < 3; iteration += 1) {
      beginSelectedFramePacketViews(selected, catalog, 8);
      for (let viewIndex = 0; viewIndex < 8; viewIndex += 1) {
        beginSelectedFramePacketView(selected, catalog, viewIndex);
        appendSelectedFramePacket(selected, catalog, viewIndex);
        endSelectedFramePacketView(selected, catalog, viewIndex);
      }
      expect(selected.orderedPacketIndices).toBe(warmPackets);
      expect(selected.viewFirsts).toBe(warmFirsts);
      expect(selected.viewCounts).toBe(warmCounts);
    }
  });

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
        lodRequirementCounts: catalog.lodRequirementCounts,
        lodRequirementFirsts: catalog.lodRequirementFirsts,
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
      { ...valid, lodRequirementCount: 2, lodRequirementFirst: 0xffff_ffff },
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

  it("matches zero, one, and simultaneous node-and-material LOD predicates", () => {
    const requirements = createFramePacketLodRequirements();
    const nodeFirst = appendFramePacketLodRequirement(requirements, 2, 1);
    const bothFirst = appendFramePacketLodRequirement(requirements, 2, 1);
    appendFramePacketLodRequirement(requirements, 7, 3);
    const catalog = createFramePacketCatalog();
    const row = randomRow(new SeededRandom(0x4c4f_4452));
    appendFramePacket(catalog, row);
    appendFramePacket(catalog, {
      ...row,
      lodRequirementCount: 1,
      lodRequirementFirst: nodeFirst,
    });
    appendFramePacket(catalog, {
      ...row,
      lodRequirementCount: 2,
      lodRequirementFirst: bothFirst,
    });
    const selectedLevels = new Uint32Array(8);
    selectedLevels.fill(NO_FRAME_PACKET_ID);
    const selectedLevelEpochs = new Uint32Array(8);
    const epoch = 7;

    expect(framePacketLodRequirementsMatch(
      catalog, requirements, 0, selectedLevels, selectedLevelEpochs, epoch,
    )).toBe(true);
    expect(framePacketLodRequirementsMatch(
      catalog, requirements, 1, selectedLevels, selectedLevelEpochs, epoch,
    )).toBe(false);
    selectedLevels[2] = 1;
    selectedLevelEpochs[2] = epoch;
    expect(framePacketLodRequirementsMatch(
      catalog, requirements, 1, selectedLevels, selectedLevelEpochs, epoch,
    )).toBe(true);
    expect(framePacketLodRequirementsMatch(
      catalog, requirements, 2, selectedLevels, selectedLevelEpochs, epoch,
    )).toBe(false);
    selectedLevels[7] = 3;
    selectedLevelEpochs[7] = epoch;
    expect(framePacketLodRequirementsMatch(
      catalog, requirements, 2, selectedLevels, selectedLevelEpochs, epoch,
    )).toBe(true);
    selectedLevels[2] = 0;
    expect(framePacketLodRequirementsMatch(
      catalog, requirements, 2, selectedLevels, selectedLevelEpochs, epoch,
    )).toBe(false);
    selectedLevels[2] = NO_FRAME_PACKET_ID;
    expect(framePacketLodRequirementsMatch(
      catalog, requirements, 2, selectedLevels, selectedLevelEpochs, epoch,
    )).toBe(false);
    selectedLevels[2] = 1;
    selectedLevelEpochs[2] = epoch - 1;
    expect(framePacketLodRequirementsMatch(
      catalog, requirements, 1, selectedLevels, selectedLevelEpochs, epoch,
    )).toBe(false);
  });

  it("grows, densely rewrites, and resets caller-owned LOD requirements", () => {
    const requirements = createFramePacketLodRequirements(1);
    const initialSelectionIds = requirements.selectionIds;
    const initialLevels = requirements.levels;
    expect(appendFramePacketLodRequirement(requirements, 1, 2)).toBe(0);
    expect(appendFramePacketLodRequirement(requirements, 3, 4)).toBe(1);
    expect(requirements.capacity).toBe(2);
    expect(requirements.selectionIds).not.toBe(initialSelectionIds);
    expect(requirements.levels).not.toBe(initialLevels);
    expect(Array.from(requirements.selectionIds)).toEqual([1, 3]);
    expect(Array.from(requirements.levels)).toEqual([2, 4]);

    const warmSelectionIds = requirements.selectionIds;
    const warmLevels = requirements.levels;
    writeFramePacketLodRequirement(requirements, 0, 5, 6);
    expect(Array.from(requirements.selectionIds)).toEqual([5, 3]);
    expect(Array.from(requirements.levels)).toEqual([6, 4]);
    resetFramePacketLodRequirements(requirements);
    expect(requirements.count).toBe(0);
    appendFramePacketLodRequirement(requirements, 7, 8);
    expect(requirements.selectionIds).toBe(warmSelectionIds);
    expect(requirements.levels).toBe(warmLevels);
    expect(requirements.selectionIds[0]).toBe(7);
    expect(requirements.levels[0]).toBe(8);
  });

  it("rejects invalid LOD requirement rows, spans, IDs, and selected-level lookups atomically", () => {
    const requirements = createFramePacketLodRequirements();
    appendFramePacketLodRequirement(requirements, 1, 2);
    const selectionIds = requirements.selectionIds;
    const levels = requirements.levels;
    for (const [selectionId, level] of [
      [-1, 0],
      [NO_FRAME_PACKET_ID, 0],
      [0, -1],
      [0, NO_FRAME_PACKET_ID],
      [1.5, 0],
    ] as const) {
      expect(() => writeFramePacketLodRequirement(requirements, 0, selectionId, level)).toThrow();
      expect(requirements.count).toBe(1);
      expect(requirements.selectionIds).toBe(selectionIds);
      expect(requirements.levels).toBe(levels);
      expect(requirements.selectionIds[0]).toBe(1);
      expect(requirements.levels[0]).toBe(2);
    }
    expect(() => writeFramePacketLodRequirement(requirements, 2, 0, 0)).toThrow(/dense row/);

    const catalog = createFramePacketCatalog();
    const row = randomRow(new SeededRandom(0x5350_414e));
    appendFramePacket(catalog, { ...row, lodRequirementCount: 2, lodRequirementFirst: 0 });
    expect(() => framePacketLodRequirementsMatch(
      catalog,
      requirements,
      0,
      new Uint32Array(2),
      new Uint32Array(2),
      1,
    )).toThrow(/span/);
    writeFramePacket(catalog, 0, { ...row, lodRequirementCount: 1, lodRequirementFirst: 0 });
    expect(() => framePacketLodRequirementsMatch(
      catalog,
      requirements,
      0,
      new Uint32Array(1),
      new Uint32Array(1),
      1,
    )).toThrow(/selection ID/);
    appendFramePacketLodRequirement(requirements, 5, 0);
    writeFramePacket(catalog, 0, { ...row, lodRequirementCount: 2, lodRequirementFirst: 0 });
    expect(() => framePacketLodRequirementsMatch(
      catalog,
      requirements,
      0,
      new Uint32Array([0, 0]),
      new Uint32Array([1, 1]),
      1,
    )).toThrow(/selection ID/);
    writeFramePacket(catalog, 0, { ...row, lodRequirementCount: 1, lodRequirementFirst: 0 });
    expect(() => framePacketLodRequirementsMatch(
      catalog,
      requirements,
      1,
      new Uint32Array(2),
      new Uint32Array(2),
      1,
    )).toThrow(/populated catalog row/);
    expect(() => framePacketLodRequirementsMatch(
      catalog,
      requirements,
      0,
      new Uint32Array(2),
      new Uint32Array(2),
      1,
      -1,
    )).toThrow(/sentinel/);
  });

  it("invalidates retained packet selections when only a LOD requirement span changes", () => {
    const catalog = createFramePacketCatalog();
    const row = randomRow(new SeededRandom(0x5245_5653));
    appendFramePacket(catalog, row);
    const selected = createSelectedFramePackets(catalog);
    appendSelectedFramePacket(selected, catalog, 0);
    const revision = catalog.revision;

    writeFramePacket(catalog, 0, { ...row, lodRequirementCount: 1 });
    expect(catalog.revision).toBe(revision + 1);
    expect(() => assertSelectedFramePacketsCurrent(selected, catalog)).toThrow(/stale/);
    beginSelectedFramePackets(selected, catalog);
    const secondRevision = catalog.revision;
    writeFramePacket(catalog, 0, { ...row, lodRequirementFirst: 3, lodRequirementCount: 1 });
    expect(catalog.revision).toBe(secondRevision + 1);
    expect(() => assertSelectedFramePacketsCurrent(selected, catalog)).toThrow(/stale/);
  });
});
