import { describe, expect, it } from "vitest";
import {
  beginGltfPacketBatchRegistryFrame,
  assertGltfPacketBatchSegmentGroupsCurrent,
  clearGltfPacketBatchRegistry,
  clearGltfPacketBatchSegmentGroups,
  createGltfPacketBatchRegistry,
  createGltfPacketBatchSegmentGroups,
  gltfPacketBatchTupleHash,
  groupGltfPacketSubmissionSegment,
  type GltfPacketBatchTuple,
} from "../packages/renderer-webgl/src/gltf-packet-batch-registry";
import {
  appendGltfPacketSubmission,
  createGltfPacketSubmissionWorkspace,
  resetGltfPacketSubmissionWorkspaceForFrame,
  resetGltfPacketSubmissionWorkspaceForSegment,
  resetGltfPacketSubmissionWorkspaceForView,
  retainGltfPacketSubmissionLightBinding,
  retainGltfPacketSubmissionMaterialBinding,
  retainGltfPacketSubmissionRootBinding,
} from "../packages/renderer-webgl/src/gltf-packet-submission-workspace";
import {
  appendFramePacket,
  createFramePacketCatalog,
  FRAME_PACKET_RENDER_CLASS,
  FRAME_PACKET_SIDEDNESS,
  NO_FRAME_PACKET_ID,
  type FramePacketRenderClass,
} from "../packages/renderer-webgl/src/frame/packets";
import { forEachFuzzCase } from "./fuzz";
import { gltfFrameBatchIsRetained } from "../packages/renderer-webgl/src/gltf/frame-batch-arena";

type TupleSpec = GltfPacketBatchTuple;

const tuple = (
  geometryIdentityId: number,
  materialBatchClassId = 1,
  lightScopeId = 0,
  sidedness = FRAME_PACKET_SIDEDNESS.frontFaceCcw,
  renderClass: FramePacketRenderClass = FRAME_PACKET_RENDER_CLASS.opaque,
): TupleSpec => ({ geometryIdentityId, lightScopeId, materialBatchClassId, renderClass, sidedness });

const segment = (specs: readonly TupleSpec[], segmentId = 3, viewIndex = 0) => {
  const catalog = createFramePacketCatalog(Math.max(1, specs.length));
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index]!;
    appendFramePacket(catalog, {
      boundsId: index,
      geometryId: 100 + index,
      instanceCount: 1,
      instanceFirst: 0,
      localModelId: index,
      lodRequirementCount: 0,
      lodRequirementFirst: 0,
      materialId: index,
      orderingSegment: segmentId,
      renderClass: spec.renderClass,
      rootSourceId: index,
      sidedness: spec.sidedness & FRAME_PACKET_SIDEDNESS.doubleSided,
    });
  }
  const workspace = createGltfPacketSubmissionWorkspace<object, object, object>();
  resetGltfPacketSubmissionWorkspaceForFrame(workspace, 7, catalog);
  for (let index = 0; index <= viewIndex; index += 1) {
    resetGltfPacketSubmissionWorkspaceForView(workspace, 7, catalog, index);
  }
  resetGltfPacketSubmissionWorkspaceForSegment(workspace, 7, catalog, segmentId);
  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index]!;
    const materialBindingId = retainGltfPacketSubmissionMaterialBinding(
      workspace, 7, catalog, index, spec.materialBatchClassId, {},
    );
    const rootBindingId = retainGltfPacketSubmissionRootBinding(
      workspace, 7, catalog, index, 0, spec.lightScopeId, {},
    );
    const lightBindingId = spec.lightScopeId === 0
      ? NO_FRAME_PACKET_ID
      : retainGltfPacketSubmissionLightBinding(workspace, 7, catalog, spec.lightScopeId, {});
    appendGltfPacketSubmission(workspace, 7, catalog, {
      geometryId: 100 + index,
      geometryIdentityId: spec.geometryIdentityId,
      lightBindingId,
      lightScopeId: spec.lightScopeId,
      localModelId: index,
      materialBindingId,
      packetIndex: index,
      renderClass: spec.renderClass,
      rootBindingId,
      sidedness: spec.sidedness,
    });
  }
  return { catalog, workspace };
};

const activeIds = (groups: ReturnType<typeof createGltfPacketBatchSegmentGroups>): number[] =>
  Array.from(groups.activeBatchIds.subarray(0, groups.activeBatchCount));

describe("glTF packet numeric batch registry", () => {
  it("retains recently culled batch plans across frame-epoch wrap safely", () => {
    expect(gltfFrameBatchIsRetained(10, 10)).toBe(true);
    expect(gltfFrameBatchIsRetained(70, 10)).toBe(true);
    expect(gltfFrameBatchIsRetained(71, 10)).toBe(false);
    expect(gltfFrameBatchIsRetained(1, 0)).toBe(false);
    expect(gltfFrameBatchIsRetained(1, 0xffff_ffff)).toBe(true);
  });

  it("resolves open-address collisions with exact tuple comparisons", () => {
    const first = tuple(1);
    let second = tuple(2);
    while ((gltfPacketBatchTupleHash(first) & 3) !== (gltfPacketBatchTupleHash(second) & 3)) {
      second = tuple(second.geometryIdentityId + 1);
    }
    const { catalog, workspace } = segment([first, second, first]);
    const registry = createGltfPacketBatchRegistry(1);
    const groups = createGltfPacketBatchSegmentGroups(1, 1);
    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, workspace, 7, catalog);
    expect(registry.batchCount).toBe(2);
    expect(Array.from(workspace.batchIds.subarray(0, 3))).toEqual([0, 1, 0]);
    expect(activeIds(groups)).toEqual([0, 1]);
    expect(groups.batchCounts[0]).toBe(2);
    expect(Array.from(groups.memberIndices.subarray(0, 3))).toEqual([0, 2, 1]);
  });

  it("distinguishes every tuple lane including values above Uint32", () => {
    const base = tuple(0x1_0000_0001, 0x1_0000_0002, 0x1_0000_0003);
    const specs = [
      base,
      { ...base, geometryIdentityId: base.geometryIdentityId + 1 },
      { ...base, materialBatchClassId: base.materialBatchClassId + 1 },
      { ...base, lightScopeId: base.lightScopeId + 1 },
      { ...base, sidedness: FRAME_PACKET_SIDEDNESS.doubleSided },
    ];
    const { catalog, workspace } = segment(specs);
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, workspace, 7, catalog);
    expect(registry.batchCount).toBe(specs.length);
    expect(activeIds(groups)).toEqual([0, 1, 2, 3, 4]);
    expect(registry.batchGeometryIdentityIds[0]).toBe(base.geometryIdentityId);
    expect(registry.batchMaterialBatchClassIds[0]).toBe(base.materialBatchClassId);
    expect(registry.batchLightScopeIds[0]).toBe(base.lightScopeId);
  });

  it("keeps persistent IDs stable while active order follows current first visibility", () => {
    const a = tuple(10);
    const b = tuple(20);
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    beginGltfPacketBatchRegistryFrame(registry);
    const first = segment([a, b]);
    groupGltfPacketSubmissionSegment(registry, groups, first.workspace, 7, first.catalog);
    expect(Array.from(first.workspace.batchIds.subarray(0, 2))).toEqual([0, 1]);
    const second = segment([b, a, b], 4, 1);
    groupGltfPacketSubmissionSegment(registry, groups, second.workspace, 7, second.catalog);
    expect(Array.from(second.workspace.batchIds.subarray(0, 3))).toEqual([1, 0, 1]);
    expect(activeIds(groups)).toEqual([1, 0]);
    expect(registry.batchCount).toBe(2);
    expect(registry.touchedBatchCount).toBe(2);
    expect(Array.from(registry.touchedBatchIds.subarray(0, 2))).toEqual([0, 1]);
    expect(() => assertGltfPacketBatchSegmentGroupsCurrent(
      registry, groups, second.workspace, 7, second.catalog,
    )).not.toThrow();
    appendGltfPacketSubmission(second.workspace, 7, second.catalog, {
      geometryId: second.workspace.geometryIds[0]!,
      geometryIdentityId: second.workspace.geometryIdentityIds[0]!,
      lightBindingId: second.workspace.lightBindingIds[0]!,
      lightScopeId: second.workspace.lightScopeIds[0]!,
      localModelId: second.workspace.localModelIds[0]!,
      materialBindingId: second.workspace.materialBindingIds[0]!,
      packetIndex: second.workspace.packetIndices[0]!,
      renderClass: second.workspace.renderClasses[0]! as FramePacketRenderClass,
      rootBindingId: second.workspace.rootBindingIds[0]!,
      sidedness: second.workspace.sidedness[0]!,
    });
    expect(() => assertGltfPacketBatchSegmentGroupsCurrent(
      registry, groups, second.workspace, 7, second.catalog,
    )).toThrow(/stale/);
    groupGltfPacketSubmissionSegment(registry, groups, second.workspace, 7, second.catalog);
    expect(() => assertGltfPacketBatchSegmentGroupsCurrent(
      registry, groups, second.workspace, 7, second.catalog,
    )).not.toThrow();
    beginGltfPacketBatchRegistryFrame(registry);
    expect(() => assertGltfPacketBatchSegmentGroupsCurrent(
      registry, groups, second.workspace, 7, second.catalog,
    )).toThrow(/stale/);
  });

  it("reuses packet batch identities only while their exact tuple remains current", () => {
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    const current = segment([tuple(10), tuple(20)]);
    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, current.workspace, 7, current.catalog);
    expect(Array.from(registry.packetBatchIds.subarray(0, 2))).toEqual([0, 1]);

    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, current.workspace, 7, current.catalog);
    expect(Array.from(current.workspace.batchIds.subarray(0, 2))).toEqual([0, 1]);
    expect(registry.batchCount).toBe(2);

    current.workspace.geometryIdentityIds[0] = 30;
    groupGltfPacketSubmissionSegment(registry, groups, current.workspace, 7, current.catalog);
    expect(Array.from(current.workspace.batchIds.subarray(0, 2))).toEqual([2, 1]);
    expect(Array.from(registry.packetBatchIds.subarray(0, 2))).toEqual([2, 1]);
    expect(registry.batchCount).toBe(3);
  });

  it("retains first-seen global and per-class order with prefix/scatter ranges", () => {
    const blended = tuple(1, 1, 0, 0, FRAME_PACKET_RENDER_CLASS.blended);
    const opaqueA = tuple(2);
    const transmissive = tuple(3, 1, 0, 0, FRAME_PACKET_RENDER_CLASS.transmissive);
    const opaqueB = tuple(4);
    const { catalog, workspace } = segment([blended, opaqueA, transmissive, blended, opaqueB, opaqueA]);
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, workspace, 7, catalog);
    expect(activeIds(groups)).toEqual([0, 1, 2, 3]);
    expect(Array.from(groups.opaqueBatchIds.subarray(0, groups.opaqueBatchCount))).toEqual([1, 3]);
    expect(Array.from(groups.transmissiveBatchIds.subarray(0, groups.transmissiveBatchCount))).toEqual([2]);
    expect(Array.from(groups.blendedBatchIds.subarray(0, groups.blendedBatchCount))).toEqual([0]);
    expect(Array.from(groups.memberIndices.subarray(0, groups.memberCount))).toEqual([0, 3, 1, 5, 2, 4]);
    expect([0, 1, 2, 3].map((id) => groups.batchMemberFirsts[id])).toEqual([0, 2, 4, 5]);
  });

  it("clusters opaque batches by material state without reordering composited classes", () => {
    const blendedA = tuple(1, 9, 0, 0, FRAME_PACKET_RENDER_CLASS.blended);
    const opaqueB = tuple(2, 20);
    const transmissiveB = tuple(3, 20, 0, 0, FRAME_PACKET_RENDER_CLASS.transmissive);
    const opaqueA = tuple(4, 10);
    const blendedB = tuple(5, 8, 0, 0, FRAME_PACKET_RENDER_CLASS.blended);
    const transmissiveA = tuple(6, 10, 0, 0, FRAME_PACKET_RENDER_CLASS.transmissive);
    const { catalog, workspace } = segment([
      blendedA, opaqueB, transmissiveB, opaqueA, blendedB, transmissiveA,
    ]);
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, workspace, 7, catalog);

    expect(Array.from(groups.opaqueBatchIds.subarray(0, groups.opaqueBatchCount))).toEqual([3, 1]);
    expect(Array.from(groups.transmissiveBatchIds.subarray(0, groups.transmissiveBatchCount))).toEqual([2, 5]);
    expect(Array.from(groups.blendedBatchIds.subarray(0, groups.blendedBatchCount))).toEqual([0, 4]);
  });

  it("invalidates retained opaque order when registry identities restart", () => {
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    const first = segment([tuple(1, 20), tuple(2, 10)]);
    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, first.workspace, 7, first.catalog);
    expect(Array.from(groups.opaqueBatchIds.subarray(0, 2))).toEqual([1, 0]);

    clearGltfPacketBatchRegistry(registry);
    const second = segment([tuple(3, 5), tuple(4, 15)]);
    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, second.workspace, 7, second.catalog);
    expect(Array.from(groups.opaqueBatchIds.subarray(0, 2))).toEqual([0, 1]);
  });

  it("handles injected epoch wrap and retains grown capacity across segment resets", () => {
    const registry = createGltfPacketBatchRegistry(1, 0xffff_fffe);
    const groups = createGltfPacketBatchSegmentGroups(1, 1, 0xffff_fffe);
    beginGltfPacketBatchRegistryFrame(registry);
    const first = segment([tuple(1), tuple(2), tuple(3)]);
    groupGltfPacketSubmissionSegment(registry, groups, first.workspace, 7, first.catalog);
    expect(registry.frameEpoch).toBe(0xffff_ffff);
    expect(groups.epoch).toBe(0xffff_ffff);
    const batchCapacity = registry.batchCapacity;
    const memberCapacity = groups.memberCapacity;
    const second = segment([tuple(3)]);
    groups.validationEpoch = 0xffff_ffff;
    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, second.workspace, 7, second.catalog);
    expect(registry.frameEpoch).toBe(1);
    expect(groups.epoch).toBe(1);
    expect(groups.validationEpoch).toBe(1);
    expect(activeIds(groups)).toEqual([2]);
    expect(groups.batchCounts[2]).toBe(1);
    expect(registry.batchCapacity).toBe(batchCapacity);
    expect(groups.memberCapacity).toBe(memberCapacity);
    expect(() => assertGltfPacketBatchSegmentGroupsCurrent(
      registry, groups, second.workspace, 7, second.catalog,
    )).not.toThrow();
    clearGltfPacketBatchRegistry(registry);
    beginGltfPacketBatchRegistryFrame(registry);
    expect(() => assertGltfPacketBatchSegmentGroupsCurrent(
      registry, groups, second.workspace, 7, second.catalog,
    )).toThrow(/stale/);
    clearGltfPacketBatchSegmentGroups(groups);
    expect(registry.batchCount).toBe(0);
    expect(groups).toMatchObject({ activeBatchCount: 0, epoch: 0, memberCount: 0 });
    expect(registry.batchCapacity).toBe(batchCapacity);
  });

  it("rejects inactive or view-only workspace state", () => {
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    beginGltfPacketBatchRegistryFrame(registry);
    const catalog = createFramePacketCatalog();
    const workspace = createGltfPacketSubmissionWorkspace<object, object, object>();
    expect(() => groupGltfPacketSubmissionSegment(registry, groups, workspace, 1, catalog)).toThrow(/stale/);
    resetGltfPacketSubmissionWorkspaceForFrame(workspace, 1, catalog);
    resetGltfPacketSubmissionWorkspaceForView(workspace, 1, catalog, 0);
    expect(() => groupGltfPacketSubmissionSegment(registry, groups, workspace, 1, catalog)).toThrow(/active workspace segment/);
  });

  it("prevalidates a later invalid row without partial registry, groups, or batch-ID mutation", () => {
    const { catalog, workspace } = segment([tuple(1), tuple(2)]);
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    beginGltfPacketBatchRegistryFrame(registry);
    workspace.sidedness[1] = 4;
    const priorBatchIds = Array.from(workspace.batchIds.subarray(0, workspace.count));
    expect(() => groupGltfPacketSubmissionSegment(registry, groups, workspace, 7, catalog))
      .toThrow(/unknown bits|invalid or stale/);
    expect(registry.batchCount).toBe(0);
    expect(registry.touchedBatchCount).toBe(0);
    expect(groups).toMatchObject({ activeBatchCount: 0, epoch: 0, memberCount: 0 });
    expect(Array.from(workspace.batchIds.subarray(0, workspace.count))).toEqual(priorBatchIds);
  });

  it("rejects render-class provenance conflicts for one stable four-lane identity atomically", () => {
    const opaque = tuple(9);
    const blended = { ...opaque, renderClass: FRAME_PACKET_RENDER_CLASS.blended };
    expect(gltfPacketBatchTupleHash(opaque)).toBe(gltfPacketBatchTupleHash(blended));
    const { catalog, workspace } = segment([opaque, blended]);
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    beginGltfPacketBatchRegistryFrame(registry);
    const priorBatchIds = Array.from(workspace.batchIds.subarray(0, workspace.count));
    expect(() => groupGltfPacketSubmissionSegment(registry, groups, workspace, 7, catalog))
      .toThrow(/conflicting render classes/);
    expect(registry.batchCount).toBe(0);
    expect(groups).toMatchObject({ activeBatchCount: 0, epoch: 0, memberCount: 0 });
    expect(Array.from(workspace.batchIds.subarray(0, workspace.count))).toEqual(priorBatchIds);
    expect(() => gltfPacketBatchTupleHash({ ...opaque, sidedness: 4 })).toThrow(/unknown bits/);
    expect(() => gltfPacketBatchTupleHash({ ...opaque, renderClass: 9 as FramePacketRenderClass }))
      .toThrow(/render class/);

    const retained = segment([opaque]);
    groupGltfPacketSubmissionSegment(registry, groups, retained.workspace, 7, retained.catalog);
    const retainedEpoch = groups.epoch;
    const conflicting = segment([blended]);
    const conflictingBatchIds = Array.from(conflicting.workspace.batchIds.subarray(0, 1));
    expect(() => groupGltfPacketSubmissionSegment(
      registry, groups, conflicting.workspace, 7, conflicting.catalog,
    )).toThrow(/conflicting render classes/);
    expect(registry.batchCount).toBe(1);
    expect(groups.epoch).toBe(retainedEpoch);
    expect(Array.from(conflicting.workspace.batchIds.subarray(0, 1))).toEqual(conflictingBatchIds);
  });

  it("groups an empty active segment and rejects unsupported capacity ceilings", () => {
    const { catalog, workspace } = segment([]);
    const registry = createGltfPacketBatchRegistry();
    const groups = createGltfPacketBatchSegmentGroups();
    beginGltfPacketBatchRegistryFrame(registry);
    groupGltfPacketSubmissionSegment(registry, groups, workspace, 7, catalog);
    expect(groups).toMatchObject({ activeBatchCount: 0, memberCount: 0 });
    expect(() => assertGltfPacketBatchSegmentGroupsCurrent(
      registry, groups, workspace, 7, catalog,
    )).not.toThrow();
    expect(() => createGltfPacketBatchRegistry(0x4000_0001)).toThrow(/supported power-of-two/);
    expect(() => createGltfPacketBatchSegmentGroups(0x2000_0001)).toThrow(/supported hash range/);
    registry.generation = Number.MAX_SAFE_INTEGER;
    expect(() => clearGltfPacketBatchRegistry(registry)).toThrow(/generation is exhausted/);
    expect(registry.batchCount).toBe(0);
  });

  it("matches a randomized first-seen reference grouping", () => {
    forEachFuzzCase({ cases: 64, seed: 0x4241_5443 }, ({ random }) => {
      const pool = Array.from({ length: random.int(1, 9) }, (_, index) => tuple(
        0x1_0000_0000 + index + 1,
        100 + index,
        index % 2 === 0 ? 0 : 500 + index,
        index % 2 === 0 ? FRAME_PACKET_SIDEDNESS.frontFaceCcw : FRAME_PACKET_SIDEDNESS.doubleSided,
        [
          FRAME_PACKET_RENDER_CLASS.opaque,
          FRAME_PACKET_RENDER_CLASS.transmissive,
          FRAME_PACKET_RENDER_CLASS.blended,
        ][index % 3] as FramePacketRenderClass,
      ));
      const specs = Array.from({ length: random.int(1, 33) }, () => pool[random.int(0, pool.length)]!);
      const { catalog, workspace } = segment(specs);
      const registry = createGltfPacketBatchRegistry();
      const groups = createGltfPacketBatchSegmentGroups();
      beginGltfPacketBatchRegistryFrame(registry);
      groupGltfPacketSubmissionSegment(registry, groups, workspace, 7, catalog);

      const idsByPoolIndex = new Map<number, number>();
      const expectedIds: number[] = [];
      const expectedMembers: number[][] = [];
      for (let memberIndex = 0; memberIndex < specs.length; memberIndex += 1) {
        const poolIndex = pool.indexOf(specs[memberIndex]!);
        let batchId = idsByPoolIndex.get(poolIndex);
        if (batchId === undefined) {
          batchId = idsByPoolIndex.size;
          idsByPoolIndex.set(poolIndex, batchId);
          expectedMembers.push([]);
        }
        expectedIds.push(batchId);
        expectedMembers[batchId]!.push(memberIndex);
      }
      expect(Array.from(workspace.batchIds.subarray(0, workspace.count))).toEqual(expectedIds);
      expect(activeIds(groups)).toEqual(Array.from({ length: idsByPoolIndex.size }, (_, index) => index));
      expect(Array.from(groups.memberIndices.subarray(0, groups.memberCount)))
        .toEqual(expectedMembers.flat());
    });
  });
});
