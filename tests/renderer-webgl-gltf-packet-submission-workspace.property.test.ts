import { describe, expect, it } from "vitest";
import {
  appendGltfPacketSubmission,
  assertGltfPacketSubmissionWorkspaceCurrent,
  clearGltfPacketSubmissionWorkspace,
  createGltfPacketSubmissionWorkspace,
  preparedGltfPacketSubmissionMaterialBindingId,
  preparedGltfPacketSubmissionRootBindingId,
  readGltfPacketSubmissionInto,
  resetGltfPacketSubmissionWorkspaceForFrame,
  resetGltfPacketSubmissionWorkspaceForSegment,
  resetGltfPacketSubmissionWorkspaceForView,
  resolveGltfPacketSubmissionLightBinding,
  resolveGltfPacketSubmissionMaterialBinding,
  resolveGltfPacketSubmissionRootBinding,
  retainGltfPacketSubmissionLightBinding,
  retainGltfPacketSubmissionMaterialBinding,
  retainGltfPacketSubmissionRootBinding,
  writeGltfPacketSubmissionBatchId,
  type GltfPacketSubmissionRow,
  type MutableGltfPacketSubmissionRow,
} from "../packages/renderer-webgl/src/gltf-packet-submission-workspace";
import {
  appendFramePacket,
  createFramePacketCatalog,
  FRAME_PACKET_RENDER_CLASS,
  FRAME_PACKET_SIDEDNESS,
  NO_FRAME_PACKET_ID,
  resetFramePacketCatalog,
} from "../packages/renderer-webgl/src/frame/packets";
import { forEachFuzzCase } from "./fuzz";

const catalogWithPackets = (count: number, orderingSegment = 3) => {
  const catalog = createFramePacketCatalog(Math.max(1, count));
  for (let index = 0; index < count; index += 1) {
    appendFramePacket(catalog, {
      boundsId: index,
      geometryId: 100 + index,
      instanceCount: 1,
      instanceFirst: index,
      localModelId: index,
      lodRequirementCount: 0,
      lodRequirementFirst: 0,
      materialId: index,
      orderingSegment,
      renderClass: FRAME_PACKET_RENDER_CLASS.opaque,
      rootSourceId: index,
      sidedness: FRAME_PACKET_SIDEDNESS.frontFaceCcw,
    });
  }
  return catalog;
};

const begin = <M, R, L>(
  workspace: ReturnType<typeof createGltfPacketSubmissionWorkspace<M, R, L>>,
  catalog = catalogWithPackets(1),
) => {
  resetGltfPacketSubmissionWorkspaceForFrame(workspace, 7, catalog);
  resetGltfPacketSubmissionWorkspaceForView(workspace, 7, catalog, 0);
  resetGltfPacketSubmissionWorkspaceForSegment(workspace, 7, catalog, 3);
  return catalog;
};

const row = (
  packetIndex: number,
  geometryId: number,
  materialBindingId: number,
  rootBindingId: number,
  lightBindingId?: number,
): GltfPacketSubmissionRow => ({
  geometryId,
  geometryIdentityId: Number.MAX_SAFE_INTEGER - packetIndex,
  lightBindingId: lightBindingId ?? NO_FRAME_PACKET_ID,
  lightScopeId: lightBindingId === undefined ? 0 : 7_000,
  localModelId: packetIndex,
  materialBindingId,
  packetIndex,
  renderClass: FRAME_PACKET_RENDER_CLASS.opaque,
  rootBindingId,
  sidedness: FRAME_PACKET_SIDEDNESS.frontFaceCcw,
});

describe("glTF packet submission workspace", () => {
  it("grows retained SoA lanes and resets logical state without shrinking", () => {
    forEachFuzzCase({ cases: 32, seed: 0x5355_424d }, ({ random }) => {
      const count = random.int(3, 48);
      const catalog = catalogWithPackets(count, 11);
      const workspace = createGltfPacketSubmissionWorkspace<object, object, object>(1, 1);
      resetGltfPacketSubmissionWorkspaceForFrame(workspace, 7, catalog);
      resetGltfPacketSubmissionWorkspaceForView(workspace, 7, catalog, 0);
      resetGltfPacketSubmissionWorkspaceForSegment(workspace, 7, catalog, 11);
      const rootIds = Array.from({ length: count }, (_, index) =>
        retainGltfPacketSubmissionRootBinding(workspace, 7, catalog, index, index, 0, {}));
      const materialIds = Array.from({ length: count }, (_, index) =>
        retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, index, 1_000 + index, {}));
      for (let index = 0; index < count; index += 1) {
        expect(appendGltfPacketSubmission(
          workspace,
          7,
          catalog,
          row(index, 100 + index, materialIds[index]!, rootIds[index]!),
        )).toBe(index);
      }
      const capacity = workspace.capacity;
      const localModelIds = workspace.localModelIds;
      resetGltfPacketSubmissionWorkspaceForSegment(workspace, 7, catalog, 12);
      expect(workspace.count).toBe(0);
      expect(workspace.capacity).toBe(capacity);
      expect(workspace.localModelIds).toBe(localModelIds);
      expect(workspace.materialBindingCount).toBe(count);
      expect(workspace.materialBindingCapacity).toBeGreaterThanOrEqual(count);
      resetGltfPacketSubmissionWorkspaceForView(workspace, 7, catalog, 1);
      expect(workspace.count).toBe(0);
      expect(workspace.materialBindingCount).toBe(count);
      expect(workspace.capacity).toBe(capacity);
    });
  });

  it("retains sparse source IDs without requiring a source-sized dense allocation", () => {
    const workspace = createGltfPacketSubmissionWorkspace<object, object, object>();
    const catalog = begin(workspace);
    const sparseSourceId = 1 << 20;
    const materialId = retainGltfPacketSubmissionMaterialBinding(
      workspace,
      7,
      catalog,
      sparseSourceId,
      10,
      {},
    );
    const rootId = retainGltfPacketSubmissionRootBinding(
      workspace,
      7,
      catalog,
      sparseSourceId,
      0,
      0,
      {},
    );

    expect(preparedGltfPacketSubmissionMaterialBindingId(workspace, sparseSourceId)).toBe(materialId);
    expect(preparedGltfPacketSubmissionRootBindingId(workspace, sparseSourceId)).toBe(rootId);
    expect(retainGltfPacketSubmissionRootBinding(
      workspace,
      7,
      catalog,
      sparseSourceId,
      0,
      0,
      {},
    )).toBe(rootId);

    resetGltfPacketSubmissionWorkspaceForFrame(workspace, 8, catalog);
    expect(preparedGltfPacketSubmissionMaterialBindingId(workspace, sparseSourceId)).toBeUndefined();
    expect(preparedGltfPacketSubmissionRootBindingId(workspace, sparseSourceId)).toBeUndefined();
  });

  it("rejects stale plan, catalog identity, and catalog revision access", () => {
    const catalog = catalogWithPackets(1);
    const replacement = catalogWithPackets(1);
    const workspace = createGltfPacketSubmissionWorkspace<object, object, object>();
    expect(() => resetGltfPacketSubmissionWorkspaceForFrame(workspace, 0, catalog)).toThrow(/positive/);
    resetGltfPacketSubmissionWorkspaceForFrame(workspace, 4, catalog);
    expect(() => assertGltfPacketSubmissionWorkspaceCurrent(workspace, 5, catalog)).toThrow(/stale/);
    expect(() => assertGltfPacketSubmissionWorkspaceCurrent(workspace, 4, replacement)).toThrow(/stale/);
    resetFramePacketCatalog(catalog);
    expect(() => assertGltfPacketSubmissionWorkspaceCurrent(workspace, 4, catalog)).toThrow(/stale/);
  });

  it("requires views to reset in dense frame order without advancing on rejection", () => {
    const catalog = catalogWithPackets(1);
    const workspace = createGltfPacketSubmissionWorkspace<object, object, object>();
    resetGltfPacketSubmissionWorkspaceForFrame(workspace, 4, catalog);
    expect(() => resetGltfPacketSubmissionWorkspaceForView(workspace, 4, catalog, 1)).toThrow(/dense order/);
    expect(workspace.nextViewIndex).toBe(0);
    resetGltfPacketSubmissionWorkspaceForView(workspace, 4, catalog, 0);
    expect(() => resetGltfPacketSubmissionWorkspaceForView(workspace, 4, catalog, 2)).toThrow(/dense order/);
    expect(workspace.nextViewIndex).toBe(1);
    resetGltfPacketSubmissionWorkspaceForView(workspace, 4, catalog, 1);
    expect(workspace.nextViewIndex).toBe(2);
  });

  it("rejects invalid IDs, provenance, numeric lanes, and sidedness bits before mutation", () => {
    const workspace = createGltfPacketSubmissionWorkspace<object, object, object>();
    const catalog = begin(workspace);
    expect(() => retainGltfPacketSubmissionMaterialBinding(
      workspace,
      7,
      catalog,
      0,
      10,
      undefined as unknown as object,
    )).toThrow(/defined/);
    const materialId = retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, 0, 10, {});
    const rootId = retainGltfPacketSubmissionRootBinding(workspace, 7, catalog, 0, 0, 0, {});
    const lightId = retainGltfPacketSubmissionLightBinding(
      workspace,
      7,
      catalog,
      Number.MAX_SAFE_INTEGER - 1,
      {},
    );
    const wrongMaterialId = retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, 1, 11, {});
    const wrongRootId = retainGltfPacketSubmissionRootBinding(workspace, 7, catalog, 1, 0, 0, {});
    expect(() => retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, 0, 11, {}))
      .toThrow(/conflicting/);
    expect(() => retainGltfPacketSubmissionRootBinding(workspace, 7, catalog, 0, 1, 0, {}))
      .toThrow(/conflicting/);
    expect(retainGltfPacketSubmissionLightBinding(
      workspace,
      7,
      catalog,
      Number.MAX_SAFE_INTEGER - 1,
      {},
    )).toBe(lightId);
    expect(() => retainGltfPacketSubmissionRootBinding(workspace, 7, catalog, 0, 0, 1, {}))
      .toThrow(/conflicting/);
    const valid = row(0, 100, materialId, rootId);
    const invalidRows: GltfPacketSubmissionRow[] = [
      { ...valid, packetIndex: 1 },
      { ...valid, geometryId: NO_FRAME_PACKET_ID },
      { ...valid, materialBindingId: 1 },
      { ...valid, rootBindingId: 1 },
      { ...valid, lightBindingId: 1 },
      { ...valid, sidedness: 4 },
      { ...valid, sidedness: FRAME_PACKET_SIDEDNESS.doubleSided },
      { ...valid, materialBindingId: wrongMaterialId },
      { ...valid, rootBindingId: wrongRootId },
      { ...valid, renderClass: 9 as typeof valid.renderClass },
      { ...valid, localModelId: NO_FRAME_PACKET_ID },
      { ...valid, localModelId: 99 },
      { ...valid, geometryId: 99 },
      { ...valid, geometryIdentityId: 0 },
      { ...valid, geometryIdentityId: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, lightScopeId: -1 },
      { ...valid, lightScopeId: 1 },
      { ...valid, lightBindingId: lightId, lightScopeId: 0 },
      { ...valid, lightBindingId: lightId, lightScopeId: 7_000 },
    ];
    for (const invalid of invalidRows) {
      expect(() => appendGltfPacketSubmission(workspace, 7, catalog, invalid)).toThrow();
      expect(workspace.count).toBe(0);
    }
    expect(appendGltfPacketSubmission(workspace, 7, catalog, { ...valid, sidedness: 0 })).toBe(0);
    resetGltfPacketSubmissionWorkspaceForSegment(workspace, 7, catalog, 3);
    resetGltfPacketSubmissionWorkspaceForSegment(workspace, 7, catalog, 4);
    expect(() => appendGltfPacketSubmission(workspace, 7, catalog, valid)).toThrow(/authoritative/);

    const scopeWorkspace = createGltfPacketSubmissionWorkspace<object, object, object>();
    const scopeCatalog = begin(scopeWorkspace);
    const scopeMaterialId = retainGltfPacketSubmissionMaterialBinding(
      scopeWorkspace, 7, scopeCatalog, 0, 10, {},
    );
    const wrongScopeRootId = retainGltfPacketSubmissionRootBinding(
      scopeWorkspace, 7, scopeCatalog, 0, 0, 7, {},
    );
    expect(() => appendGltfPacketSubmission(
      scopeWorkspace,
      7,
      scopeCatalog,
      row(0, 100, scopeMaterialId, wrongScopeRootId),
    )).toThrow(/authoritative/);
  });

  it("reuses frame-global semantic bindings across segments and views, then releases them", () => {
    const workspace = createGltfPacketSubmissionWorkspace<object, object, object>();
    const catalog = catalogWithPackets(2);
    catalog.orderingSegments[1] = 19;
    catalog.materialIds[1] = 0;
    catalog.rootSourceIds[1] = 0;
    catalog.instanceFirsts[1] = 0;
    resetGltfPacketSubmissionWorkspaceForFrame(workspace, 7, catalog);
    resetGltfPacketSubmissionWorkspaceForView(workspace, 7, catalog, 0);
    resetGltfPacketSubmissionWorkspaceForSegment(workspace, 7, catalog, 3);
    const material = {};
    const root = {};
    const light = {};
    const materialId = retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, 0, 10, material);
    const rootId = retainGltfPacketSubmissionRootBinding(workspace, 7, catalog, 0, 0, 7_000, root);
    const lightId = retainGltfPacketSubmissionLightBinding(workspace, 7, catalog, 7_000, light);
    expect(retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, 0, 10, material)).toBe(materialId);
    expect(retainGltfPacketSubmissionRootBinding(workspace, 7, catalog, 0, 0, 7_000, root)).toBe(rootId);
    expect(retainGltfPacketSubmissionLightBinding(workspace, 7, catalog, 7_000, light)).toBe(lightId);
    appendGltfPacketSubmission(workspace, 7, catalog, row(0, 100, materialId, rootId, lightId));
    writeGltfPacketSubmissionBatchId(workspace, 7, catalog, 0, 5);
    resetGltfPacketSubmissionWorkspaceForSegment(workspace, 7, catalog, 19);
    expect(retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, 0, 10, material)).toBe(materialId);
    appendGltfPacketSubmission(workspace, 7, catalog, row(1, 101, materialId, rootId, lightId));
    expect(workspace.batchIds[0]).toBe(NO_FRAME_PACKET_ID);
    expect(workspace.orderingSegments[0]).toBe(19);
    expect(resolveGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, materialId)).toBe(material);
    expect(resolveGltfPacketSubmissionRootBinding(workspace, 7, catalog, rootId)).toBe(root);
    expect(resolveGltfPacketSubmissionLightBinding(workspace, 7, catalog, lightId)).toBe(light);
    resetGltfPacketSubmissionWorkspaceForView(workspace, 7, catalog, 1);
    expect(retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, 0, 10, {})).toBe(materialId);
    expect(retainGltfPacketSubmissionRootBinding(workspace, 7, catalog, 0, 0, 7_000, {})).toBe(rootId);
    expect(retainGltfPacketSubmissionLightBinding(workspace, 7, catalog, 7_000, {})).toBe(lightId);
    expect(resolveGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, materialId)).toBe(material);
    expect(resolveGltfPacketSubmissionRootBinding(workspace, 7, catalog, rootId)).toBe(root);
    expect(resolveGltfPacketSubmissionLightBinding(workspace, 7, catalog, lightId)).toBe(light);
    resetGltfPacketSubmissionWorkspaceForFrame(workspace, 8, catalog);
    expect(workspace.materialBindings[materialId]).toBeUndefined();
    expect(workspace.rootBindings[rootId]).toBeUndefined();
    expect(workspace.lightBindings[lightId]).toBeUndefined();
    resetGltfPacketSubmissionWorkspaceForView(workspace, 8, catalog, 0);
    expect(retainGltfPacketSubmissionMaterialBinding(workspace, 8, catalog, 0, 10, {})).toBe(0);
  });

  it("preserves exact Float64 safe-integer lanes through validated access", () => {
    const workspace = createGltfPacketSubmissionWorkspace<object, object, object>();
    const catalog = begin(workspace);
    const materialId = retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, 0, 10, {});
    const rootId = retainGltfPacketSubmissionRootBinding(
      workspace,
      7,
      catalog,
      0,
      0,
      Number.MAX_SAFE_INTEGER - 1,
      {},
    );
    const lightId = retainGltfPacketSubmissionLightBinding(
      workspace,
      7,
      catalog,
      Number.MAX_SAFE_INTEGER - 1,
      {},
    );
    const expected = {
      ...row(0, 100, materialId, rootId, lightId),
      geometryIdentityId: Number.MAX_SAFE_INTEGER,
      lightScopeId: Number.MAX_SAFE_INTEGER - 1,
    };
    appendGltfPacketSubmission(workspace, 7, catalog, expected);
    const metadata: MutableGltfPacketSubmissionRow = {
      batchId: -1,
      geometryId: -1,
      geometryIdentityId: -1,
      lightBindingId: -1,
      lightScopeId: -1,
      localModelId: -1,
      materialBatchClassId: -1,
      materialBindingId: -1,
      packetIndex: -1,
      renderClass: FRAME_PACKET_RENDER_CLASS.blended,
      rootBindingId: -1,
      sidedness: 0,
    };
    readGltfPacketSubmissionInto(workspace, 7, catalog, 0, metadata);
    expect(metadata).toEqual({
      batchId: NO_FRAME_PACKET_ID,
      geometryId: 100,
      geometryIdentityId: Number.MAX_SAFE_INTEGER,
      lightBindingId: lightId,
      lightScopeId: Number.MAX_SAFE_INTEGER - 1,
      localModelId: 0,
      materialBatchClassId: 10,
      materialBindingId: materialId,
      packetIndex: 0,
      renderClass: FRAME_PACKET_RENDER_CLASS.opaque,
      rootBindingId: rootId,
      sidedness: FRAME_PACKET_SIDEDNESS.frontFaceCcw,
    });
    writeGltfPacketSubmissionBatchId(workspace, 7, catalog, 0, 42);
    readGltfPacketSubmissionInto(workspace, 7, catalog, 0, metadata);
    expect(metadata.batchId).toBe(42);
    expect(() => writeGltfPacketSubmissionBatchId(workspace, 7, catalog, 0, NO_FRAME_PACKET_ID))
      .toThrow(/resource ID/);
  });

  it("clears live bindings and validity while retaining allocated numeric capacity", () => {
    const workspace = createGltfPacketSubmissionWorkspace<object, object, object>();
    const catalog = begin(workspace);
    const material = {};
    const root = {};
    const light = {};
    const materialId = retainGltfPacketSubmissionMaterialBinding(workspace, 7, catalog, 0, 10, material);
    const rootId = retainGltfPacketSubmissionRootBinding(workspace, 7, catalog, 0, 0, 7_000, root);
    const lightId = retainGltfPacketSubmissionLightBinding(workspace, 7, catalog, 7_000, light);
    appendGltfPacketSubmission(workspace, 7, catalog, row(0, 100, materialId, rootId, lightId));
    const capacity = workspace.capacity;
    clearGltfPacketSubmissionWorkspace(workspace);
    expect(workspace).toMatchObject({
      catalog: undefined,
      catalogRevision: 0,
      count: 0,
      frameActive: false,
      materialBindingCount: 0,
      nextViewIndex: 0,
      planRevision: 0,
      rootBindingCount: 0,
      segment: -1,
      viewIndex: -1,
    });
    expect(workspace.lightBindingCount).toBe(0);
    expect(workspace.materialBindings[materialId]).toBeUndefined();
    expect(workspace.rootBindings[rootId]).toBeUndefined();
    expect(workspace.lightBindings[lightId]).toBeUndefined();
    expect(workspace.capacity).toBe(capacity);
    expect(() => assertGltfPacketSubmissionWorkspaceCurrent(workspace, 7, catalog)).toThrow(/stale/);
  });
});
