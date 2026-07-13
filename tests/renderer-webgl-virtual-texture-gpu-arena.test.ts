import { describe, expect, it } from "vitest";
import type { VirtualTextureManifestModel, VirtualTexturePageId } from
  "../packages/renderer-webgl/src/virtual-texturing";
import { stabilizeVirtualTextureDesiredPagesInto } from
  "../packages/renderer-webgl/src/virtual-texture-demand";
import {
  accumulateVirtualTextureGpuActivePagesByMip,
  accumulateVirtualTextureGpuCachedPagesByMip,
  admitVirtualTextureGpuResource,
  bindVirtualTextureGpuResource,
  clearVirtualTextureGpuOutcomes,
  consumeVirtualTextureGpuWake,
  createVirtualTextureGpuArena,
  dropVirtualTextureGpuContext,
  flushVirtualTextureGpuPageTables,
  processVirtualTextureGpuUploads,
  queueVirtualTextureGpuUpload,
  releaseVirtualTextureGpuAllocation,
  releaseVirtualTextureGpuResource,
  setVirtualTextureGpuDesiredPageKeys,
  touchVirtualTextureGpuResidency,
  virtualTextureGpuArenaSnapshot,
  virtualTextureGpuAdmission,
  virtualTextureGpuCachedResidency,
  virtualTextureGpuCoverage,
  virtualTextureGpuDrawable,
  virtualTextureGpuExactResidency,
  virtualTextureGpuHasActionableUploads,
  virtualTextureGpuOutcome,
  virtualTextureGpuOutcomeCount,
  virtualTextureGpuResource,
  virtualTextureGpuResourceSnapshot,
  type VirtualTextureGpuArena,
  type VirtualTextureGpuPendingUpload,
  type VirtualTextureGpuResource,
  type VirtualTextureGpuResourceOptions,
} from "../packages/renderer-webgl/src/webgl/virtual-texture-gpu-arena";
import {
  createTextureHandleArena,
  dropTextureHandleContext,
  releaseTextureHandleContextHandles,
  textureHandleArenaSnapshot,
} from "../packages/renderer-webgl/src/webgl/texture-handle-arena";

type Handle = { readonly serial: number };

class FakeGl {
  readonly CLAMP_TO_EDGE = 0x812f;
  readonly LINEAR = 0x2601;
  readonly MAX_TEXTURE_SIZE = 0x0d33;
  readonly MAX_TEXTURE_IMAGE_UNITS = 0x8872;
  readonly NEAREST = 0x2600;
  readonly RGBA = 0x1908;
  readonly RGBA8 = 0x8058;
  readonly SRGB8_ALPHA8 = 0x8c43;
  readonly TEXTURE0 = 0x84c0;
  readonly TEXTURE_2D = 0x0de1;
  readonly TEXTURE_MAG_FILTER = 0x2800;
  readonly TEXTURE_MIN_FILTER = 0x2801;
  readonly TEXTURE_WRAP_S = 0x2802;
  readonly TEXTURE_WRAP_T = 0x2803;
  readonly UNPACK_ALIGNMENT = 0x0cf5;
  readonly UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243;
  readonly UNPACK_FLIP_Y_WEBGL = 0x9240;
  readonly UNPACK_IMAGE_HEIGHT = 0x806e;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
  readonly UNPACK_ROW_LENGTH = 0x0cf2;
  readonly UNPACK_SKIP_IMAGES = 0x806d;
  readonly UNPACK_SKIP_PIXELS = 0x0cf4;
  readonly UNPACK_SKIP_ROWS = 0x0cf3;
  readonly UNSIGNED_BYTE = 0x1401;
  readonly activeUnits: number[] = [];
  readonly deleted: number[] = [];
  readonly imageAllocations: unknown[] = [];
  readonly subUploads: Array<{ readonly serial: number; readonly source: unknown }> = [];
  createFaultAt = 0;
  deleteFaultAt = 0;
  deleteFault: unknown = new Error("delete fault");
  operationFaultAt = 0;
  operationFault: unknown = new Error("operation fault");
  maxTextureSize = 16_384;
  maxTextureUnits = 8;
  #bound = 0;
  #createCalls = 0;
  #deleteCalls = 0;
  #operationCalls = 0;
  #serial = 1;

  activeTexture = (unit: number): void => { this.activeUnits.push(unit); };
  bindTexture = (_target: number, texture: WebGLTexture | null): void => {
    this.#bound = texture === null ? 0 : (texture as unknown as Handle).serial;
  };
  createTexture = (): WebGLTexture | null => {
    this.#createCalls += 1;
    if (this.#createCalls === this.createFaultAt) return null;
    return { serial: this.#serial++ } as unknown as WebGLTexture;
  };
  deleteTexture = (texture: WebGLTexture): void => {
    this.#deleteCalls += 1;
    this.deleted.push((texture as unknown as Handle).serial);
    if (this.#deleteCalls === this.deleteFaultAt) throw this.deleteFault;
  };
  getParameter = (parameter: number): unknown => {
    if (parameter === this.MAX_TEXTURE_SIZE) return this.maxTextureSize;
    if (parameter === this.MAX_TEXTURE_IMAGE_UNITS) return this.maxTextureUnits;
    return undefined;
  };
  pixelStorei = (): void => undefined;
  texImage2D = (...args: readonly unknown[]): void => {
    this.#operation();
    this.imageAllocations.push(args.at(-1));
  };
  texParameteri = (): void => { this.#operation(); };
  texSubImage2D = (...args: readonly unknown[]): void => {
    this.#operation();
    this.subUploads.push({ serial: this.#bound, source: args.at(-1) });
  };

  failNextOperation(error: unknown): void {
    this.operationFault = error;
    this.operationFaultAt = this.#operationCalls + 1;
  }

  failOperationAfter(offset: number, error?: unknown): void {
    this.operationFault = arguments.length < 2 ? new Error("operation fault") : error;
    this.operationFaultAt = this.#operationCalls + offset;
  }

  #operation(): void {
    this.#operationCalls += 1;
    if (this.#operationCalls === this.operationFaultAt) throw this.operationFault;
  }
}

const manifest: VirtualTextureManifestModel = {
  height: 8,
  mipCount: 4,
  pageSize: 2,
  pages: [],
  width: 8,
};

const options = (
  overrides: Partial<VirtualTextureGpuResourceOptions> = {},
): VirtualTextureGpuResourceOptions => ({
  atlasMagFilter: "linear",
  atlasMinFilter: "linear",
  colorSpace: "linear",
  manifest,
  sourceGeneration: 1,
  ...overrides,
});

const image = (serial: number): TexImageSource => ({ serial }) as unknown as TexImageSource;
const upload = (
  page: VirtualTexturePageId,
  serial: number,
): VirtualTextureGpuPendingUpload => ({
  image: image(serial),
  page,
  pageKey: `${page.mip}/${page.x}/${page.y}`,
  sourceGeneration: 1,
});

const setup = (
  maxPhysicalBytes = 10_000_000_000,
  capabilities: { readonly maxTextureSize?: number; readonly maxTextureUnits?: number } = {},
) => {
  const gl = new FakeGl();
  gl.maxTextureSize = capabilities.maxTextureSize ?? gl.maxTextureSize;
  gl.maxTextureUnits = capabilities.maxTextureUnits ?? gl.maxTextureUnits;
  const context = gl as unknown as WebGL2RenderingContext;
  const handles = createTextureHandleArena(context);
  return {
    arena: createVirtualTextureGpuArena(context, handles, { maxPhysicalBytes }),
    gl,
    handles,
  };
};

const admitTestVirtualTextureGpuResource = (
  arena: VirtualTextureGpuArena,
  key: string,
  generation: number,
  resourceOptions: VirtualTextureGpuResourceOptions,
): VirtualTextureGpuResource => {
  const result = admitVirtualTextureGpuResource(arena, key, generation, resourceOptions);
  if (result.kind === "ready" || result.kind === "dormant") return result.resource;
  if (result.kind === "failed") throw result.error;
  throw new Error(`Virtual texture ${key} is unsupported: ${result.reason}`);
};

describe("virtual texture GPU arena", () => {
  it("allocates idempotently and rolls back every allocation stage", () => {
    const successful = setup();
    const first = admitTestVirtualTextureGpuResource(successful.arena, "a", 1, options());
    expect(admitTestVirtualTextureGpuResource(successful.arena, "a", 1, options())).toBe(first);
    expect(textureHandleArenaSnapshot(successful.handles).ownedTextureCount).toBe(2);
    expect(successful.gl.imageAllocations).toEqual([null, null]);
    expect(() => admitTestVirtualTextureGpuResource(successful.arena, "a", 2, options())).toThrow(
      /stale context generation/,
    );

    const maximumTable = setup();
    admitTestVirtualTextureGpuResource(maximumTable.arena, "max", 1, options({
      manifest: { ...manifest, height: 32_768, pageSize: 2, width: 32_768 },
    }));
    expect(maximumTable.gl.imageAllocations).toEqual([null, null]);

    for (const createFaultAt of [1, 2]) {
      const fault = setup();
      fault.gl.createFaultAt = createFaultAt;
      expect(() => admitTestVirtualTextureGpuResource(fault.arena, "a", 1, options())).toThrow(
        /texture creation failed/,
      );
      expect(virtualTextureGpuArenaSnapshot(fault.arena)).toEqual({
        allocatedBytes: 0,
        allocatedResources: 0,
        budgetBytes: 10_000_000_000,
        chargedBytes: 0,
        pendingUploads: 0,
        resources: 0,
        schedulerSlots: 0,
        quarantinedBytes: 0,
      });
      expect(textureHandleArenaSnapshot(fault.handles).ownedTextureCount).toBe(0);
    }

    for (const operationOffset of Array.from({ length: 10 }, (_unused, index) => index + 1)) {
      const fault = setup();
      fault.gl.failOperationAfter(operationOffset);
      expect(() => admitTestVirtualTextureGpuResource(fault.arena, "a", 1, options())).toThrow(
        /operation fault/,
      );
      expect(textureHandleArenaSnapshot(fault.handles).ownedTextureCount).toBe(0);
      expect(fault.gl.deleted.sort((a, b) => a - b)).toEqual([1, 2]);
    }
  });

  it("rejects invalid and oversized allocation dimensions before creating handles", () => {
    const invalid = setup();
    const invalidOptions = options({ manifest: { ...manifest, pageSize: 0 } });
    expect(virtualTextureGpuAdmission(invalidOptions, invalid.gl.maxTextureSize, 1_000_000, 8)).toEqual({
      kind: "unsupported",
      reason: "invalid-dimensions",
    });
    expect(() => admitTestVirtualTextureGpuResource(invalid.arena, "invalid", 1, invalidOptions)).toThrow(
      /invalid-dimensions/,
    );
    expect(textureHandleArenaSnapshot(invalid.handles).ownedTextureCount).toBe(0);

    const atlas = setup(10_000_000_000, { maxTextureSize: 8 });
    const atlasOptions = options({ physicalSlots: 4, manifest: { ...manifest, pageSize: 9 } });
    expect(virtualTextureGpuAdmission(atlasOptions, atlas.gl.maxTextureSize, 1_000_000, 8)).toMatchObject({
      kind: "unsupported",
      reason: "texture-size-exceeded",
    });
    expect(() => admitTestVirtualTextureGpuResource(atlas.arena, "atlas", 1, atlasOptions)).toThrow(
      /texture-size-exceeded/,
    );
    expect(textureHandleArenaSnapshot(atlas.handles).ownedTextureCount).toBe(0);

    const table = setup(10_000_000_000, { maxTextureSize: 8 });
    const tableOptions = options({ manifest: { ...manifest, height: 18, pageSize: 2, width: 18 } });
    expect(() => admitTestVirtualTextureGpuResource(table.arena, "table", 1, tableOptions)).toThrow(
      /texture-size-exceeded/,
    );
    expect(textureHandleArenaSnapshot(table.handles).ownedTextureCount).toBe(0);

    const sampler = setup();
    const samplerOptions = options({ atlasMinFilter: "invalid" as "linear" });
    expect(virtualTextureGpuAdmission(
      samplerOptions,
      sampler.gl.maxTextureSize,
      1_000_000,
      8,
    )).toEqual({ kind: "unsupported", reason: "invalid-sampler" });
    expect(() => admitTestVirtualTextureGpuResource(sampler.arena, "sampler", 1, samplerOptions)).toThrow(
      /invalid-sampler/,
    );
    expect(textureHandleArenaSnapshot(sampler.handles).ownedTextureCount).toBe(0);

    for (const maxTextureUnits of [0, 1]) {
      const units = setup(10_000_000_000, { maxTextureUnits });
      expect(() => admitTestVirtualTextureGpuResource(units.arena, "units", 1, options())).toThrow(
        /insufficient-texture-units/,
      );
      expect(textureHandleArenaSnapshot(units.handles).ownedTextureCount).toBe(0);
      expect(virtualTextureGpuArenaSnapshot(units.arena).chargedBytes).toBe(0);
    }
  });

  it("computes exact padded atlas and odd page-table byte admission", () => {
    const oddManifest = { ...manifest, height: 7, pageSize: 2, width: 5 };
    expect(virtualTextureGpuAdmission(
      options({ manifest: oddManifest, physicalSlots: 1 }),
      16_384,
      64,
      8,
    )).toMatchObject({
      allocatedBytes: 64,
      atlasBytes: 16,
      effectiveSlots: 1,
      kind: "supported",
      paddedSlots: 1,
      pageTableBytes: 48,
    });
    expect(virtualTextureGpuAdmission(
      options({ manifest: oddManifest, physicalSlots: 3 }),
      16_384,
      112,
      8,
    )).toMatchObject({
      allocatedBytes: 112,
      atlasBytes: 64,
      effectiveSlots: 3,
      kind: "supported",
      paddedSlots: 4,
      pageTableBytes: 48,
    });
    expect(virtualTextureGpuAdmission(
      options({ manifest: oddManifest, physicalSlots: 5 }),
      16_384,
      144,
      8,
    )).toMatchObject({
      allocatedBytes: 144,
      atlasBytes: 96,
      effectiveSlots: 5,
      kind: "supported",
      paddedSlots: 6,
      pageTableBytes: 48,
    });
    expect(virtualTextureGpuAdmission(
      options({ manifest: oddManifest, physicalSlots: 5 }),
      16_384,
      143,
      8,
    )).toMatchObject({ allocatedBytes: 112, effectiveSlots: 4, kind: "supported" });
    expect(virtualTextureGpuAdmission(
      options({ manifest: oddManifest, physicalSlots: 1 }),
      16_384,
      63,
      8,
    )).toEqual({
      kind: "dormant",
      reason: "physical-budget-exceeded",
      requiredBytes: 64,
    });
  });

  it("caps physical slots at the 16-bit page-table encoding limit", () => {
    expect(virtualTextureGpuAdmission(
      options({
        manifest: { ...manifest, height: 256, pageSize: 1, width: 256 },
        physicalSlots: 1_000_000,
      }),
      1_024,
      1_000_000,
      8,
    )).toMatchObject({ effectiveSlots: 65_535, kind: "supported" });
  });

  it("enforces per-manifest bytes and globally re-admits dormant resources after release", () => {
    const perManifest = {
      ...manifest,
      physicalByteBudget: 80,
      physicalSlots: 4,
    };
    expect(virtualTextureGpuAdmission(options({ manifest: perManifest }), 16_384, 1_000, 8)).toMatchObject({
      allocatedBytes: 80,
      effectiveSlots: 1,
      kind: "supported",
    });

    const { arena, handles } = setup(200);
    const first = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const second = admitTestVirtualTextureGpuResource(arena, "b", 1, options());
    expect(virtualTextureGpuResourceSnapshot(first)).toMatchObject({ allocated: true, allocatedBytes: 128 });
    expect(virtualTextureGpuResourceSnapshot(second)).toMatchObject({
      admissionKind: "dormant",
      allocated: false,
    });
    expect(textureHandleArenaSnapshot(handles).ownedTextureCount).toBe(2);
    expect(virtualTextureGpuArenaSnapshot(arena)).toMatchObject({ allocatedBytes: 128, budgetBytes: 200 });
    queueVirtualTextureGpuUpload(arena, second, upload({ mip: 0, x: 0, y: 0 }, 1));
    expect(consumeVirtualTextureGpuWake(arena)).toBe(false);
    releaseVirtualTextureGpuResource(arena, "a");
    expect(admitVirtualTextureGpuResource(arena, "b", 1, options())).toEqual({
      kind: "ready",
      resource: second,
    });
    expect(virtualTextureGpuResourceSnapshot(second)).toMatchObject({ allocated: true, allocatedBytes: 128 });
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(false);
    expect(virtualTextureGpuArenaSnapshot(arena).allocatedBytes).toBeLessThanOrEqual(200);
  });

  it("keeps an existing dormant resource atomic when direct admission allocation fails", () => {
    const { arena, gl, handles } = setup(200);
    admitTestVirtualTextureGpuResource(arena, "active", 1, options());
    const dormant = admitTestVirtualTextureGpuResource(arena, "dormant", 1, options());
    releaseVirtualTextureGpuResource(arena, "active");
    const fault = new Error("direct readmission allocation fault");
    gl.failNextOperation(fault);

    expect(admitVirtualTextureGpuResource(arena, "dormant", 1, options())).toEqual({
      error: fault,
      kind: "failed",
    });
    expect(virtualTextureGpuResourceSnapshot(dormant)).toMatchObject({ allocated: false });
    expect(virtualTextureGpuArenaSnapshot(arena)).toMatchObject({
      allocatedBytes: 0,
      chargedBytes: 0,
    });
    expect(textureHandleArenaSnapshot(handles).ownedTextureCount).toBe(0);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(false);
    expect(virtualTextureGpuArenaSnapshot(arena)).toMatchObject({
      allocatedBytes: 0,
      chargedBytes: 0,
    });
  });

  it("zeros global accounting on context drop and admits retained demand on restore", () => {
    const { arena, handles } = setup(200);
    admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const retained = admitTestVirtualTextureGpuResource(arena, "b", 1, options());
    queueVirtualTextureGpuUpload(arena, retained, upload({ mip: 0, x: 0, y: 0 }, 1));
    dropVirtualTextureGpuContext(arena);
    expect(virtualTextureGpuArenaSnapshot(arena).allocatedBytes).toBe(0);
    dropTextureHandleContext(handles);
    admitTestVirtualTextureGpuResource(arena, "b", 2, options());
    expect(virtualTextureGpuResourceSnapshot(retained)).toMatchObject({ allocated: true, pendingUploads: 1 });
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
  });

  it("retains handle ownership when rollback deletion fails so central release can retry", () => {
    const { arena, gl, handles } = setup(128);
    gl.failOperationAfter(1);
    gl.deleteFaultAt = 1;
    expect(() => admitTestVirtualTextureGpuResource(arena, "a", 1, options())).toThrow(/operation fault/);
    expect(textureHandleArenaSnapshot(handles).ownedTextureCount).toBe(1);
    expect(virtualTextureGpuArenaSnapshot(arena)).toMatchObject({
      allocatedBytes: 0,
      chargedBytes: 128,
      quarantinedBytes: 128,
    });
    const blocked = admitTestVirtualTextureGpuResource(arena, "b", 1, options());
    expect(virtualTextureGpuResourceSnapshot(blocked).admissionKind).toBe("dormant");
    releaseTextureHandleContextHandles(handles);
    expect(textureHandleArenaSnapshot(handles).ownedTextureCount).toBe(0);
    expect(virtualTextureGpuArenaSnapshot(arena).chargedBytes).toBe(128);
    dropVirtualTextureGpuContext(arena);
    expect(virtualTextureGpuArenaSnapshot(arena).chargedBytes).toBe(0);
  });

  it("keeps atlas failures transactional, including a thrown undefined", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const pending = upload({ mip: 0, x: 0, y: 0 }, 1);
    expect(queueVirtualTextureGpuUpload(arena, resource, pending)).toBe(true);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
    gl.failNextOperation(undefined);
    let caught = false;
    try {
      processVirtualTextureGpuUploads(arena, 1);
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      // The unpublished mapping remains staged for the phaseful retry.
      dirtyPageTableUpdates: 1,
      occupiedSlots: 1,
      pendingUploads: 1,
      cachedPages: 0,
    });
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(0);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(false);
    processVirtualTextureGpuUploads(arena, 1);
    expect(virtualTextureGpuOutcome(arena, 0)).toEqual({ key: "a", kind: "completed", upload: pending });
  });

  it("publishes one sticky demand wake when the final page upload settles", () => {
    const { arena } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const pending = upload({ mip: 0, x: 0, y: 0 }, 1);
    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set([pending.pageKey]));
    expect(queueVirtualTextureGpuUpload(arena, resource, pending)).toBe(true);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);

    processVirtualTextureGpuUploads(arena, 1);

    expect(virtualTextureGpuHasActionableUploads(arena)).toBe(false);
    expect(virtualTextureGpuOutcome(arena, 0)).toEqual({ key: "a", kind: "completed", upload: pending });
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(false);
  });

  it("leaves denied governor uploads queued without performing GL side effects", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 0, x: 0, y: 0 }, 1));
    const uploadsBefore = gl.subUploads.length;
    let requestedBytes = 0;

    processVirtualTextureGpuUploads(arena, 1, {
      reserve: (bytes) => {
        requestedBytes = bytes;
        return undefined;
      },
    });

    expect(requestedBytes).toBe(manifest.pageSize ** 2 * 4);
    expect(gl.subUploads).toHaveLength(uploadsBefore);
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      pendingUploads: 1,
      uploadedPages: 0,
    });
    expect(virtualTextureGpuHasActionableUploads(arena)).toBe(true);
  });

  it("does not start an upload while an independent reconciliation flush is blocked", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options({ physicalSlots: 1 }));
    const resident = upload({ mip: 0, x: 0, y: 0 }, 1);
    queueVirtualTextureGpuUpload(arena, resource, resident);
    processVirtualTextureGpuUploads(arena, 1);

    const replacement = upload({ mip: 0, x: 1, y: 0 }, 2);
    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set([replacement.pageKey]));
    queueVirtualTextureGpuUpload(arena, resource, replacement);
    const uploadsBefore = gl.subUploads.length;
    const requestedBytes: number[] = [];
    const blockedAdmission = {
      reserve: (bytes: number) => {
        requestedBytes.push(bytes);
        return undefined;
      },
    };

    processVirtualTextureGpuUploads(arena, 2, blockedAdmission);

    expect(requestedBytes).toEqual([4]);
    expect(gl.subUploads).toHaveLength(uploadsBefore);
    expect(virtualTextureGpuCachedResidency(arena, "a", resident.page)).toBeDefined();
    expect(virtualTextureGpuCachedResidency(arena, "a", replacement.page)).toBeUndefined();
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      dirtyPageTableUpdates: 1,
      pendingUploads: 1,
      uploadedPages: 1,
    });

    processVirtualTextureGpuUploads(arena, 2);
    const resumed = gl.subUploads.slice(uploadsBefore);
    expect(resumed.map(({ serial }) => serial)).toEqual([
      2, // Reconciliation invalidates the old mapping.
      1, // Only then may the atlas slot be overwritten.
      2, // Finally publish the replacement mapping.
    ]);
    expect(resumed[1]?.source).toBe(replacement.image);
    expect(virtualTextureGpuExactResidency(arena, "a", replacement.page)).toBeDefined();
  });

  it("counts a budget-blocked staged assignment as occupied without exposing it as cache", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options({ physicalSlots: 3 }));
    const prior = [0, 1, 2].map((x, serial) => upload({ mip: 0, x, y: 0 }, serial + 1));
    for (const pending of prior) queueVirtualTextureGpuUpload(arena, resource, pending);
    processVirtualTextureGpuUploads(arena, 1);
    processVirtualTextureGpuUploads(arena, 2);

    const replacement = upload({ mip: 0, x: 3, y: 0 }, 4);
    queueVirtualTextureGpuUpload(arena, resource, replacement);
    const atlasUploadsBefore = gl.subUploads.filter(({ serial }) => serial === 1).length;
    const requestedBytes: number[] = [];
    processVirtualTextureGpuUploads(arena, 3, {
      reserve: (bytes) => {
        requestedBytes.push(bytes);
        if (bytes !== manifest.pageSize ** 2 * 4) return undefined;
        return { cancel: () => undefined, commit: () => undefined };
      },
    });

    // The clock has claimed an old slot for the replacement, but the denied
    // invalidation means the atlas write has not happened. It is neither a
    // valid cache hit nor a free slot that demand planning may admit again.
    const snapshot = virtualTextureGpuResourceSnapshot(resource);
    expect(requestedBytes).toEqual([16, 4, 16, 4]);
    expect(snapshot).toMatchObject({
      activePages: 2,
      cachedPages: 2,
      occupiedSlots: 3,
      pendingUploads: 1,
    });
    expect(virtualTextureGpuCachedResidency(arena, "a", replacement.page)).toBeUndefined();
    expect(gl.subUploads.filter(({ serial }) => serial === 1)).toHaveLength(atlasUploadsBefore);

    const survivors = prior
      .filter(({ page }) => virtualTextureGpuCachedResidency(arena, "a", page) !== undefined)
      .map(({ page }) => page);
    const previousPages = [replacement.page, ...survivors];
    const previousKeys = new Set(previousPages.map(({ mip, x, y }) => `${mip}/${x}/${y}`));
    const nextCandidate = { mip: 0, x: 0, y: 1 };
    const desiredPages: VirtualTexturePageId[] = [];
    const desiredPageKeys = new Set<string>();
    expect(stabilizeVirtualTextureDesiredPagesInto(
      [replacement.page, nextCandidate],
      previousPages,
      previousKeys,
      snapshot.occupiedSlots,
      (page) => virtualTextureGpuCachedResidency(arena, "a", page) !== undefined,
      snapshot.effectiveSlots,
      desiredPages,
      desiredPageKeys,
    )).toEqual({ admissions: 0, deferred: true, retentions: 2 });
    expect(desiredPages).toEqual(previousPages);
    expect(desiredPageKeys.has(`${nextCandidate.mip}/${nextCandidate.x}/${nextCandidate.y}`)).toBe(false);

    processVirtualTextureGpuUploads(arena, 4);
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      cachedPages: 3,
      occupiedSlots: 3,
      pendingUploads: 0,
    });
  });

  it("retries only page-table publication when its admission follows an admitted atlas upload", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    // Isolate the upload transaction from the allocation's initial empty-table
    // publication; the adversarial denial below targets the new page mapping.
    processVirtualTextureGpuUploads(arena, 0);
    queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 0, x: 0, y: 0 }, 1));
    const requestedBytes: number[] = [];
    let atlasCommits = 0;
    let pageTableCommits = 0;
    let admitPageTable = false;
    const admission = {
      reserve: (bytes: number) => {
        requestedBytes.push(bytes);
        if (bytes === 4 && !admitPageTable) return undefined;
        return {
          cancel: () => undefined,
          commit: () => {
            if (bytes === 4) pageTableCommits += 1;
            else atlasCommits += 1;
          },
        };
      },
    };
    const atlasUploadsBefore = gl.subUploads.filter(({ serial }) => serial === 1).length;
    const pageTableUploadsBefore = gl.subUploads.filter(({ serial }) => serial === 2).length;

    processVirtualTextureGpuUploads(arena, 1, admission);

    expect(gl.subUploads.filter(({ serial }) => serial === 1)).toHaveLength(atlasUploadsBefore + 1);
    expect(gl.subUploads.filter(({ serial }) => serial === 2)).toHaveLength(pageTableUploadsBefore);
    expect({ atlasCommits, pageTableCommits }).toEqual({ atlasCommits: 1, pageTableCommits: 0 });
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      activePages: 0,
      cachedPages: 1,
      pendingUploads: 1,
      uploadedPages: 0,
    });

    admitPageTable = true;
    processVirtualTextureGpuUploads(arena, 1, admission);

    expect(gl.subUploads.filter(({ serial }) => serial === 1)).toHaveLength(atlasUploadsBefore + 1);
    expect(gl.subUploads.filter(({ serial }) => serial === 2)).toHaveLength(pageTableUploadsBefore + 1);
    expect(requestedBytes[0]).toBe(manifest.pageSize ** 2 * 4);
    expect(requestedBytes.filter((bytes) => bytes === manifest.pageSize ** 2 * 4)).toHaveLength(1);
    expect(requestedBytes.slice(1).every((bytes) => bytes === 4)).toBe(true);
    expect({ atlasCommits, pageTableCommits }).toEqual({ atlasCommits: 1, pageTableCommits: 1 });
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      pendingUploads: 0,
      cachedPages: 1,
      uploadedPages: 1,
    });
  });

  it("commits admitted upload reservations and cancels them on a GL failure", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 0, x: 0, y: 0 }, 1));
    let commits = 0;
    let cancels = 0;
    const requestedBytes: number[] = [];
    const admission = {
      reserve: (bytes: number) => {
        requestedBytes.push(bytes);
        return {
          cancel: () => { cancels += 1; },
          commit: () => { commits += 1; },
        };
      },
    };
    gl.failNextOperation(new Error("governed upload failure"));

    expect(() => processVirtualTextureGpuUploads(arena, 1, admission))
      .toThrow("governed upload failure");
    expect({ cancels, commits }).toEqual({ cancels: 1, commits: 0 });

    processVirtualTextureGpuUploads(arena, 1, admission);
    // The successful retry independently charges its atlas texels and exact
    // page-table texels.
    expect({ cancels, commits }).toEqual({ cancels: 1, commits: 2 });
    expect(requestedBytes).toEqual([
      manifest.pageSize ** 2 * 4,
      manifest.pageSize ** 2 * 4,
      4,
    ]);
    expect(virtualTextureGpuResourceSnapshot(resource).uploadedPages).toBe(1);
  });

  it("charges atlas and attempted page-table uploads exactly once when publication fails", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 0, x: 0, y: 0 }, 1));
    let commits = 0;
    let cancels = 0;
    const requestedBytes: number[] = [];
    const admission = {
      reserve: (bytes: number) => {
        requestedBytes.push(bytes);
        return {
          cancel: () => { cancels += 1; },
          commit: () => { commits += 1; },
        };
      },
    };
    // Atlas upload succeeds; the following page-table upload fails.
    gl.failOperationAfter(2);

    expect(() => processVirtualTextureGpuUploads(arena, 1, admission)).toThrow(/operation fault/);
    expect({ cancels, commits }).toEqual({ cancels: 0, commits: 2 });
    expect(requestedBytes).toEqual([manifest.pageSize ** 2 * 4, 4]);

    processVirtualTextureGpuUploads(arena, 1, admission);
    expect({ cancels, commits }).toEqual({ cancels: 0, commits: 2 });
    expect(requestedBytes).toEqual([manifest.pageSize ** 2 * 4, 4]);
    expect(virtualTextureGpuResourceSnapshot(resource).uploadedPages).toBe(1);
  });

  it("withholds completion and exact residency until a failed page-table upload retries", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const pending = upload({ mip: 0, x: 0, y: 0 }, 1);
    queueVirtualTextureGpuUpload(arena, resource, pending);
    // First sub-upload is atlas, second is page table.
    gl.failOperationAfter(2, undefined);
    let caught = false;
    try {
      processVirtualTextureGpuUploads(arena, 1);
    } catch (error) {
      caught = true;
      expect(error).toBeUndefined();
    }
    expect(caught).toBe(true);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(0);
    expect(virtualTextureGpuExactResidency(arena, "a", pending.page)).toBeUndefined();
    expect(virtualTextureGpuDrawable(arena, "a")).toBe(false);
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      activePages: 0,
      cachedPages: 1,
      dirtyPageTableUpdates: 1,
      pendingUploads: 1,
      uploadedPages: 0,
    });
    const atlasUploads = gl.subUploads.filter(({ serial }) => serial === 1).length;
    flushVirtualTextureGpuPageTables(arena);
    expect(gl.subUploads.filter(({ serial }) => serial === 1)).toHaveLength(atlasUploads);
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      dirtyPageTableUpdates: 0,
      pendingUploads: 0,
      cachedPages: 1,
      uploadedPages: 1,
    });
    expect(virtualTextureGpuExactResidency(arena, "a", pending.page)).toBeDefined();
    expect(virtualTextureGpuOutcome(arena, 0)).toEqual({ key: "a", kind: "completed", upload: pending });
  });

  it("acknowledges page-table rows individually when an eviction flush partially fails", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options({ physicalSlots: 1 }));
    const evicted = { mip: 1, x: 0, y: 0 };
    const replacement = { mip: 0, x: 1, y: 1 };
    queueVirtualTextureGpuUpload(arena, resource, upload(evicted, 1));
    processVirtualTextureGpuUploads(arena, 1);
    clearVirtualTextureGpuOutcomes(arena);
    queueVirtualTextureGpuUpload(arena, resource, upload(replacement, 2));
    // Eviction fallback + atlas succeed; replacement row fails.
    gl.failOperationAfter(3);
    expect(() => processVirtualTextureGpuUploads(arena, 2)).toThrow(/operation fault/);
    expect(virtualTextureGpuResourceSnapshot(resource).dirtyPageTableUpdates).toBe(1);
    expect(virtualTextureGpuExactResidency(arena, "a", evicted)).toBeUndefined();
    expect(virtualTextureGpuExactResidency(arena, "a", replacement)).toBeUndefined();
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(0);
    flushVirtualTextureGpuPageTables(arena);
    expect(virtualTextureGpuResourceSnapshot(resource).dirtyPageTableUpdates).toBe(0);
    expect(virtualTextureGpuExactResidency(arena, "a", replacement)).toBeDefined();
    expect(virtualTextureGpuOutcome(arena, 0)).toMatchObject({
      evictedPageKey: "1/0/0",
      kind: "completed",
    });
  });

  it("invalidates an evicted mapping before overwriting its atlas slot and publishing the replacement", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options({ physicalSlots: 1 }));
    const evicted = upload({ mip: 1, x: 0, y: 0 }, 1);
    const replacement = upload({ mip: 0, x: 1, y: 1 }, 2);
    queueVirtualTextureGpuUpload(arena, resource, evicted);
    processVirtualTextureGpuUploads(arena, 1);
    clearVirtualTextureGpuOutcomes(arena);
    const replacementStart = gl.subUploads.length;

    queueVirtualTextureGpuUpload(arena, resource, replacement);
    processVirtualTextureGpuUploads(arena, 2);

    const replacementUploads = gl.subUploads.slice(replacementStart);
    expect(replacementUploads.map(({ serial }) => serial)).toEqual([
      2, // Invalidate the old page-table mapping.
      1, // The slot is now safe to overwrite in the atlas.
      2, // Publish the replacement page-table mapping.
    ]);
    expect(replacementUploads[1]?.source).toBe(replacement.image);
    expect(virtualTextureGpuExactResidency(arena, "a", evicted.page)).toBeUndefined();
    expect(virtualTextureGpuExactResidency(arena, "a", replacement.page)).toBeDefined();
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(1);
    expect(virtualTextureGpuOutcome(arena, 0)).toEqual({
      evictedPageKey: evicted.pageKey,
      key: "a",
      kind: "completed",
      upload: replacement,
    });
  });

  it.each([
    ["invalidation", 1],
    ["atlas overwrite", 2],
    ["replacement publication", 3],
  ] as const)("retries safely after an eviction %s failure", (_phase, operationOffset) => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options({ physicalSlots: 1 }));
    const evicted = upload({ mip: 1, x: 0, y: 0 }, 1);
    const replacement = upload({ mip: 0, x: 1, y: 1 }, 2);
    queueVirtualTextureGpuUpload(arena, resource, evicted);
    processVirtualTextureGpuUploads(arena, 1);
    clearVirtualTextureGpuOutcomes(arena);
    const replacementStart = gl.subUploads.length;

    queueVirtualTextureGpuUpload(arena, resource, replacement);
    gl.failOperationAfter(operationOffset);
    expect(() => processVirtualTextureGpuUploads(arena, 2)).toThrow(/operation fault/);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(0);
    expect(virtualTextureGpuExactResidency(arena, "a", replacement.page)).toBeUndefined();

    processVirtualTextureGpuUploads(arena, 2);

    expect(gl.subUploads.slice(replacementStart).map(({ serial }) => serial)).toEqual([2, 1, 2]);
    expect(gl.subUploads
      .slice(replacementStart)
      .filter(({ serial, source }) => serial === 1 && source === replacement.image)).toHaveLength(1);
    expect(virtualTextureGpuExactResidency(arena, "a", evicted.page)).toBeUndefined();
    expect(virtualTextureGpuExactResidency(arena, "a", replacement.page)).toBeDefined();
    expect(virtualTextureGpuResourceSnapshot(resource).pendingUploads).toBe(0);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(1);
    expect(virtualTextureGpuOutcome(arena, 0)).toEqual({
      evictedPageKey: evicted.pageKey,
      key: "a",
      kind: "completed",
      upload: replacement,
    });
  });

  it("chunks large page-table regions through a bounded reusable payload", () => {
    const { arena, gl } = setup();
    const largeManifest = { ...manifest, height: 2_048, mipCount: 11, width: 2_048 };
    const resource = admitTestVirtualTextureGpuResource(
      arena,
      "large",
      1,
      options({ manifest: largeManifest }),
    );
    queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 10, x: 0, y: 0 }, 1));
    processVirtualTextureGpuUploads(arena, 1);
    const payloads = gl.subUploads
      .map(({ source }) => source)
      .filter((source): source is Uint8Array => source instanceof Uint8Array);
    expect(payloads.length).toBeGreaterThan(1);
    expect(Math.max(...payloads.map(({ byteLength }) => byteLength))).toBeLessThanOrEqual(64 * 1024);
  });

  it("shares the two-success frame budget across resources and leaves a sticky wake", () => {
    const { arena } = setup();
    const a = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const b = admitTestVirtualTextureGpuResource(arena, "b", 1, options());
    queueVirtualTextureGpuUpload(arena, a, upload({ mip: 0, x: 0, y: 0 }, 1));
    queueVirtualTextureGpuUpload(arena, a, upload({ mip: 0, x: 1, y: 0 }, 2));
    queueVirtualTextureGpuUpload(arena, b, upload({ mip: 0, x: 0, y: 1 }, 3));
    consumeVirtualTextureGpuWake(arena);
    processVirtualTextureGpuUploads(arena, 9);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(2);
    expect([virtualTextureGpuOutcome(arena, 0)?.key, virtualTextureGpuOutcome(arena, 1)?.key]).toEqual(
      ["a", "b"],
    );
    expect(virtualTextureGpuHasActionableUploads(arena)).toBe(true);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
    processVirtualTextureGpuUploads(arena, 9);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(2);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
    processVirtualTextureGpuUploads(arena, 10);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(3);
  });

  it("protects resident ancestors using page-grid mip semantics", () => {
    const { arena } = setup();
    const inferredMipManifest: VirtualTextureManifestModel = {
      height: manifest.height,
      pageSize: manifest.pageSize,
      pages: manifest.pages,
      width: manifest.width,
    };
    const resource = admitTestVirtualTextureGpuResource(
      arena,
      "a",
      1,
      options({ manifest: inferredMipManifest, physicalSlots: 2 }),
    );
    const ancestor = { mip: 2, x: 0, y: 0 };
    const evictable = { mip: 0, x: 3, y: 3 };
    queueVirtualTextureGpuUpload(arena, resource, upload(ancestor, 1));
    queueVirtualTextureGpuUpload(arena, resource, upload(evictable, 2));
    processVirtualTextureGpuUploads(arena, 1);
    const child = { mip: 0, x: 0, y: 0 };
    queueVirtualTextureGpuUpload(arena, resource, upload(child, 3));
    processVirtualTextureGpuUploads(arena, 2);
    expect(virtualTextureGpuExactResidency(arena, "a", ancestor)?.pageKey).toBe("2/0/0");
    expect(virtualTextureGpuExactResidency(arena, "a", evictable)).toBeUndefined();
  });

  it("accepts inferred final mips for NPOT page grids", () => {
    const { arena } = setup();
    const inferredManifest: VirtualTextureManifestModel = {
      height: 10,
      pageSize: 2,
      pages: [],
      width: 6,
    };
    const resource = admitTestVirtualTextureGpuResource(
      arena,
      "npot",
      1,
      options({ manifest: inferredManifest, physicalSlots: 1 }),
    );
    expect(queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 3, x: 0, y: 0 }, 1))).toBe(true);
    expect(queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 4, x: 0, y: 0 }, 2))).toBe(false);
  });

  it("preserves the current working set while committing replacement uploads", () => {
    const { arena } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options({ physicalSlots: 3 }));
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const evictable = { mip: 0, x: 2, y: 0 };
    queueVirtualTextureGpuUpload(arena, resource, upload(first, 1));
    queueVirtualTextureGpuUpload(arena, resource, upload(second, 2));
    queueVirtualTextureGpuUpload(arena, resource, upload(evictable, 3));
    processVirtualTextureGpuUploads(arena, 1);
    processVirtualTextureGpuUploads(arena, 2);

    const replacement = { mip: 0, x: 3, y: 0 };
    queueVirtualTextureGpuUpload(arena, resource, upload(replacement, 4));
    expect(setVirtualTextureGpuDesiredPageKeys(
      arena,
      resource,
      new Set(["0/0/0", "0/1/0", "0/3/0"]),
    )).toBe(true);
    processVirtualTextureGpuUploads(arena, 3);

    expect(virtualTextureGpuExactResidency(arena, "a", first)).toBeDefined();
    expect(virtualTextureGpuExactResidency(arena, "a", second)).toBeDefined();
    expect(virtualTextureGpuExactResidency(arena, "a", evictable)).toBeUndefined();
    expect(virtualTextureGpuExactResidency(arena, "a", replacement)).toBeDefined();
  });

  it("cancels obsolete queued uploads through exactly one discard outcome", () => {
    const { arena } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const obsolete = upload({ mip: 0, x: 0, y: 0 }, 1);
    const desired = upload({ mip: 0, x: 1, y: 0 }, 2);
    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set([obsolete.pageKey, desired.pageKey]));
    queueVirtualTextureGpuUpload(arena, resource, obsolete);
    queueVirtualTextureGpuUpload(arena, resource, desired);

    expect(setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set([desired.pageKey]))).toBe(true);
    expect(virtualTextureGpuResourceSnapshot(resource).pendingUploads).toBe(1);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(1);
    expect(virtualTextureGpuOutcome(arena, 0)).toEqual({
      key: "a",
      kind: "discarded",
      upload: obsolete,
    });
    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set([desired.pageKey]));
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(1);

    processVirtualTextureGpuUploads(arena, 1);
    expect(virtualTextureGpuOutcome(arena, 1)).toEqual({
      key: "a",
      kind: "completed",
      upload: desired,
    });
  });

  it("unmaps inactive pages while caching and reactivating them without an atlas upload", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const pending = upload({ mip: 0, x: 0, y: 0 }, 1);
    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set([pending.pageKey]));
    queueVirtualTextureGpuUpload(arena, resource, pending);
    processVirtualTextureGpuUploads(arena, 1);
    const atlasUploads = gl.subUploads.filter(({ serial }) => serial === 1).length;
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      activePages: 1,
      cachedPages: 1,
    });

    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set());
    expect(virtualTextureGpuExactResidency(arena, "a", pending.page)).toBeUndefined();
    expect(virtualTextureGpuCachedResidency(arena, "a", pending.page)).toBeDefined();
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({ activePages: 0, cachedPages: 1 });
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
    processVirtualTextureGpuUploads(arena, 2);

    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set([pending.pageKey]));
    expect(virtualTextureGpuExactResidency(arena, "a", pending.page)).toBeUndefined();
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
    processVirtualTextureGpuUploads(arena, 3);

    expect(gl.subUploads.filter(({ serial }) => serial === 1)).toHaveLength(atlasUploads);
    expect(virtualTextureGpuCachedResidency(arena, "a", pending.page)).toBeDefined();
    expect(virtualTextureGpuExactResidency(arena, "a", pending.page)).toBeDefined();
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      activePages: 1,
      cachedPages: 1,
      pendingUploads: 0,
      uploadedPages: 1,
    });
  });

  it("retains an in-flight upload while canceling later queued work", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const inFlight = upload({ mip: 0, x: 0, y: 0 }, 1);
    const queued = upload({ mip: 0, x: 1, y: 0 }, 2);
    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set([inFlight.pageKey, queued.pageKey]));
    queueVirtualTextureGpuUpload(arena, resource, inFlight);
    queueVirtualTextureGpuUpload(arena, resource, queued);
    // Atlas succeeds and the page-table publication fails, leaving the first
    // upload transaction in flight.
    gl.failOperationAfter(2);
    expect(() => processVirtualTextureGpuUploads(arena, 1)).toThrow(/operation fault/);

    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set());
    expect(virtualTextureGpuResourceSnapshot(resource).pendingUploads).toBe(1);
    expect(virtualTextureGpuOutcome(arena, 0)).toEqual({
      key: "a",
      kind: "discarded",
      upload: queued,
    });
    flushVirtualTextureGpuPageTables(arena);
    expect(virtualTextureGpuOutcome(arena, 1)).toEqual({
      key: "a",
      kind: "completed",
      upload: inFlight,
    });
    expect(virtualTextureGpuResourceSnapshot(resource).pendingUploads).toBe(0);
    expect(virtualTextureGpuExactResidency(arena, "a", inFlight.page)).toBeUndefined();
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({ activePages: 0, cachedPages: 1 });
  });

  it("matches clock fallback behavior when every resident slot is protected", () => {
    const { arena } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options({ physicalSlots: 1 }));
    const ancestor = { mip: 1, x: 0, y: 0 };
    queueVirtualTextureGpuUpload(arena, resource, upload(ancestor, 1));
    processVirtualTextureGpuUploads(arena, 1);
    const child = { mip: 0, x: 0, y: 0 };
    queueVirtualTextureGpuUpload(arena, resource, upload(child, 2));
    processVirtualTextureGpuUploads(arena, 2);
    expect(virtualTextureGpuExactResidency(arena, "a", child)?.pageKey).toBe("0/0/0");
    expect(virtualTextureGpuExactResidency(arena, "a", ancestor)).toBeUndefined();
  });

  it("separates pure exact and coverage queries from the explicit fallback touch command", () => {
    const { arena } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const ancestor = { mip: 1, x: 0, y: 0 };
    queueVirtualTextureGpuUpload(arena, resource, upload(ancestor, 1));
    processVirtualTextureGpuUploads(arena, 1);
    const child = { mip: 0, x: 0, y: 0 };
    expect(virtualTextureGpuExactResidency(arena, "a", child)).toBeUndefined();
    expect(virtualTextureGpuCoverage(arena, "a", child, 1)?.pageKey).toBe("1/0/0");
    expect(touchVirtualTextureGpuResidency(arena, "a", child, 1)?.pageKey).toBe("1/0/0");
  });

  it("retains decoded work dormant across loss and explicitly wakes it on restore", () => {
    const { arena, gl, handles } = setup();
    const first = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const pending = upload({ mip: 0, x: 0, y: 0 }, 7);
    setVirtualTextureGpuDesiredPageKeys(arena, first, new Set([pending.pageKey]));
    queueVirtualTextureGpuUpload(arena, first, pending);
    consumeVirtualTextureGpuWake(arena);
    dropVirtualTextureGpuContext(arena);
    expect(gl.deleted).toEqual([]);
    expect(virtualTextureGpuResourceSnapshot(first)).toMatchObject({ allocated: false, pendingUploads: 1 });
    expect(virtualTextureGpuHasActionableUploads(arena)).toBe(false);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(false);
    dropTextureHandleContext(handles);
    const restored = admitTestVirtualTextureGpuResource(arena, "a", 2, options());
    expect(restored).toBe(first);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
    processVirtualTextureGpuUploads(arena, 1);
    expect(virtualTextureGpuOutcome(arena, 0)?.upload.image).toBe(pending.image);
  });

  it("retries an unacknowledged upload after context loss", () => {
    const { arena, gl, handles } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 0, x: 0, y: 0 }, 1));
    consumeVirtualTextureGpuWake(arena);
    gl.failOperationAfter(2);
    expect(() => processVirtualTextureGpuUploads(arena, 1)).toThrow();
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      dirtyPageTableUpdates: 1,
      pendingUploads: 1,
    });
    dropVirtualTextureGpuContext(arena);
    dropTextureHandleContext(handles);
    admitTestVirtualTextureGpuResource(arena, "a", 2, options());
    expect(virtualTextureGpuHasActionableUploads(arena)).toBe(true);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(true);
    processVirtualTextureGpuUploads(arena, 2);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(1);
  });

  it("rejects stale fallback-source completions without taking image ownership", () => {
    const { arena } = setup();
    const resource = admitTestVirtualTextureGpuResource(
      arena,
      "fallback",
      1,
      options({ sourceGeneration: 2 }),
    );
    const stale = upload({ mip: 0, x: 0, y: 0 }, 9);
    expect(queueVirtualTextureGpuUpload(arena, resource, stale)).toBe(false);
    expect(virtualTextureGpuResourceSnapshot(resource).pendingUploads).toBe(0);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(0);
  });

  it("rejects malformed and out-of-grid pages before taking image ownership", () => {
    const { arena } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const invalidPages: VirtualTexturePageId[] = [
      { mip: -1, x: 0, y: 0 },
      { mip: Number.NaN, x: 0, y: 0 },
      { mip: 0.5, x: 0, y: 0 },
      { mip: 0, x: -1, y: 0 },
      { mip: 0, x: 0.5, y: 0 },
      { mip: 0, x: 0, y: -1 },
      { mip: 4, x: 0, y: 0 },
      { mip: 0, x: 4, y: 0 },
      { mip: 0, x: 0, y: 4 },
      { mip: 1, x: 2, y: 0 },
      { mip: 1, x: 0, y: 2 },
    ];
    for (const [index, page] of invalidPages.entries()) {
      expect(queueVirtualTextureGpuUpload(arena, resource, upload(page, index))).toBe(false);
    }
    expect(virtualTextureGpuResourceSnapshot(resource).pendingUploads).toBe(0);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(0);
    expect(consumeVirtualTextureGpuWake(arena)).toBe(false);
  });

  it("releases actively, publishes every queued image, and never closes one", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const first = upload({ mip: 0, x: 0, y: 0 }, 1);
    const second = upload({ mip: 0, x: 1, y: 0 }, 2);
    queueVirtualTextureGpuUpload(arena, resource, first);
    queueVirtualTextureGpuUpload(arena, resource, second);
    expect(releaseVirtualTextureGpuResource(arena, "a")).toEqual({
      releaseError: undefined,
      releaseErrorPresent: false,
    });
    expect(gl.deleted.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(virtualTextureGpuResource(arena, "a")).toBeUndefined();
    expect(virtualTextureGpuOutcome(arena, 0)).toEqual({ key: "a", kind: "discarded", upload: first });
    expect(virtualTextureGpuOutcome(arena, 1)).toEqual({ key: "a", kind: "discarded", upload: second });
  });

  it("releases only physical allocation while preserving resource identity", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    setVirtualTextureGpuDesiredPageKeys(arena, resource, new Set(["0/0/0"]));
    const pending = upload({ mip: 0, x: 0, y: 0 }, 1);
    queueVirtualTextureGpuUpload(arena, resource, pending);

    expect(releaseVirtualTextureGpuAllocation(arena, "a")).toEqual({
      releaseError: undefined,
      releaseErrorPresent: false,
    });
    expect(gl.deleted.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(virtualTextureGpuResource(arena, "a")).toBe(resource);
    expect(virtualTextureGpuResourceSnapshot(resource)).toMatchObject({
      allocated: false,
      pendingUploads: 0,
    });
    expect(virtualTextureGpuArenaSnapshot(arena)).toMatchObject({
      allocatedBytes: 0,
      allocatedResources: 0,
      resources: 1,
      schedulerSlots: 1,
    });
    expect(virtualTextureGpuOutcome(arena, 0)).toEqual({
      key: "a",
      kind: "discarded",
      upload: pending,
    });

    expect(admitTestVirtualTextureGpuResource(arena, "a", 1, options())).toBe(resource);
    expect(virtualTextureGpuResourceSnapshot(resource).allocated).toBe(true);
  });

  it("preserves the presence of a release error thrown as undefined and attempts both handles", () => {
    const { arena, gl } = setup(128);
    admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    gl.deleteFaultAt = 1;
    gl.deleteFault = undefined;
    const result = releaseVirtualTextureGpuResource(arena, "a");
    expect(result.releaseErrorPresent).toBe(true);
    expect(result.releaseError).toBeUndefined();
    expect(gl.deleted.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(virtualTextureGpuArenaSnapshot(arena)).toMatchObject({
      allocatedBytes: 0,
      chargedBytes: 128,
      quarantinedBytes: 128,
    });
    const blocked = admitTestVirtualTextureGpuResource(arena, "b", 1, options());
    expect(virtualTextureGpuResourceSnapshot(blocked).admissionKind).toBe("dormant");
  });

  it("publishes outcomes exactly once and clears them only on explicit acknowledgement", () => {
    const { arena } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 0, x: 0, y: 0 }, 1));
    processVirtualTextureGpuUploads(arena, 1);
    processVirtualTextureGpuUploads(arena, 2);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(1);
    clearVirtualTextureGpuOutcomes(arena);
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(0);
    releaseVirtualTextureGpuResource(arena, "a");
    expect(virtualTextureGpuOutcomeCount(arena)).toBe(0);
  });

  it("keeps scheduler storage dense under churn and fairly serves three hot resources", () => {
    const { arena } = setup();
    for (let index = 0; index < 100; index += 1) {
      admitTestVirtualTextureGpuResource(arena, `released-${index}`, 1, options());
      releaseVirtualTextureGpuResource(arena, `released-${index}`);
    }
    const resources = new Map<string, ReturnType<typeof admitTestVirtualTextureGpuResource>>();
    const nextSerial = new Map<string, number>();
    const hotOptions = options({ physicalSlots: 1 });
    for (const key of ["a", "b", "c"]) {
      const resource = admitTestVirtualTextureGpuResource(arena, key, 1, hotOptions);
      resources.set(key, resource);
      nextSerial.set(key, 0);
      queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 0, x: 0, y: 0 }, 0));
    }
    expect(virtualTextureGpuArenaSnapshot(arena).schedulerSlots).toBe(3);
    const counts = new Map<string, number>([["a", 0], ["b", 0], ["c", 0]]);
    let acknowledged = 0;
    for (let frame = 1; frame <= 30; frame += 1) {
      processVirtualTextureGpuUploads(arena, frame);
      while (acknowledged < virtualTextureGpuOutcomeCount(arena)) {
        const outcome = virtualTextureGpuOutcome(arena, acknowledged);
        acknowledged += 1;
        if (outcome === undefined) continue;
        counts.set(outcome.key, (counts.get(outcome.key) ?? 0) + 1);
        const serial = (nextSerial.get(outcome.key) ?? 0) + 1;
        nextSerial.set(outcome.key, serial);
        const resource = resources.get(outcome.key);
        if (resource !== undefined) {
          const pageIndex = serial % 16;
          queueVirtualTextureGpuUpload(arena, resource, upload({
            mip: 0,
            x: pageIndex % 4,
            y: Math.floor(pageIndex / 4),
          }, serial));
        }
      }
    }
    const serviced = [...counts.values()];
    expect(Math.max(...serviced) - Math.min(...serviced)).toBeLessThanOrEqual(1);
    expect(serviced.reduce((sum, count) => sum + count, 0)).toBe(60);
  });

  it("exposes opaque residency, drawable, binding, and snapshot queries", () => {
    const { arena, gl } = setup();
    const resource = admitTestVirtualTextureGpuResource(arena, "a", 1, options());
    const page = { mip: 0, x: 0, y: 0 };
    expect(bindVirtualTextureGpuResource(arena, "a", 3, 4)).toBeUndefined();
    queueVirtualTextureGpuUpload(arena, resource, upload(page, 1));
    processVirtualTextureGpuUploads(arena, 1);
    expect(virtualTextureGpuDrawable(arena, "a")).toBe(true);
    expect(virtualTextureGpuExactResidency(arena, "a", page)).toMatchObject({ residentMip: 0, slot: 0 });
    queueVirtualTextureGpuUpload(arena, resource, upload({ mip: 2, x: 0, y: 0 }, 2));
    processVirtualTextureGpuUploads(arena, 2);
    const activePagesByMip: number[] = [];
    const cachedPagesByMip: number[] = [];
    accumulateVirtualTextureGpuActivePagesByMip(resource, activePagesByMip);
    accumulateVirtualTextureGpuCachedPagesByMip(resource, cachedPagesByMip);
    expect(activePagesByMip).toEqual([1, 0, 1]);
    expect(cachedPagesByMip).toEqual([1, 0, 1]);
    gl.maxTextureUnits = 1;
    expect(bindVirtualTextureGpuResource(arena, "a", 3, 4)).toMatchObject({
      atlasGridColumns: 2,
      pageSize: 2,
      pageTableHeight: 4,
      pageTableWidth: 4,
    });
    expect(gl.activeUnits.slice(-2)).toEqual([gl.TEXTURE0 + 3, gl.TEXTURE0 + 4]);
    const activeCount = gl.activeUnits.length;
    for (const units of [[3, 3], [-1, 2], [1, 8], [1.5, 2]] as const) {
      expect(bindVirtualTextureGpuResource(arena, "a", units[0], units[1])).toBeUndefined();
      expect(gl.activeUnits).toHaveLength(activeCount);
    }
    expect(virtualTextureGpuArenaSnapshot(arena)).toEqual({
      allocatedBytes: 128,
      allocatedResources: 1,
      budgetBytes: 10_000_000_000,
      chargedBytes: 128,
      pendingUploads: 0,
      resources: 1,
      schedulerSlots: 1,
      quarantinedBytes: 0,
    });
  });
});
