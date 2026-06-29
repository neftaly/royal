import type { RendererWebGlContext } from "./gl";
import type { VirtualTextureManifest } from "./virtual-texture-manifest";
import {
  createVirtualTexturePageTableTexture,
  uploadVirtualTexturePageTableTexels,
  virtualTexturePageTableMipDimensions,
  type VirtualTexturePageTableTexture,
} from "./virtual-texture-page-table-texture";
import {
  type VirtualTexturePageAddress,
  VirtualTextureRuntime,
} from "./virtual-texture-runtime";
import {
  planVirtualTextureUploads,
  type VirtualTexturePhysicalAtlasPageUpload,
  type VirtualTextureUploadPlan,
} from "./virtual-texture-upload-plan";

type VirtualTextureResourceGl = Pick<
  RendererWebGlContext,
  | "CLAMP_TO_EDGE"
  | "NEAREST"
  | "RGBA"
  | "RGBA8"
  | "TEXTURE_2D"
  | "TEXTURE_MAG_FILTER"
  | "TEXTURE_MIN_FILTER"
  | "TEXTURE_WRAP_S"
  | "TEXTURE_WRAP_T"
  | "UNSIGNED_BYTE"
  | "bindTexture"
  | "createTexture"
  | "deleteTexture"
  | "texImage2D"
  | "texParameteri"
  | "texSubImage2D"
>;

export type VirtualTexturePhysicalAtlasTexture = {
  readonly height: number;
  readonly paddedPageSize: number;
  readonly slotColumns: number;
  readonly slotRows: number;
  readonly texture: WebGLTexture;
  readonly width: number;
};

export type VirtualTextureResourceUploadBatch = {
  readonly frame: number;
  readonly plan: VirtualTextureUploadPlan;
};

export type VirtualTextureResourceUploadStats = {
  readonly bytesUploaded: number;
  readonly dirtyBatches: number;
  readonly lastFrame: number | null;
  readonly lastUploadCount: number;
  readonly pageTableBytesUploaded: number;
  readonly pageTableTexelsUploaded: number;
  readonly physicalAtlasBytesUploaded: number;
  readonly physicalAtlasPagesUploaded: number;
};

type MutableUploadStats = {
  bytesUploaded: number;
  dirtyBatches: number;
  lastFrame: number | null;
  lastUploadCount: number;
  pageTableBytesUploaded: number;
  pageTableTexelsUploaded: number;
  physicalAtlasBytesUploaded: number;
  physicalAtlasPagesUploaded: number;
};

export class VirtualTextureResource {
  readonly #gl: VirtualTextureResourceGl;
  readonly #stats: MutableUploadStats = {
    bytesUploaded: 0,
    dirtyBatches: 0,
    lastFrame: null,
    lastUploadCount: 0,
    pageTableBytesUploaded: 0,
    pageTableTexelsUploaded: 0,
    physicalAtlasBytesUploaded: 0,
    physicalAtlasPagesUploaded: 0,
  };
  #disposed = false;

  readonly manifest: VirtualTextureManifest;
  readonly pageTable: VirtualTexturePageTableTexture;
  readonly physicalAtlas: VirtualTexturePhysicalAtlasTexture;
  readonly runtime: VirtualTextureRuntime;

  constructor(gl: VirtualTextureResourceGl, manifest: VirtualTextureManifest) {
    this.#gl = gl;
    this.manifest = manifest;
    this.runtime = new VirtualTextureRuntime(manifest.runtimeOptions);
    this.pageTable = createVirtualTexturePageTableTexture(
      gl,
      virtualTexturePageTableMipDimensions({
        mipCount: this.runtime.mipCount,
        pageSize: manifest.pageSize,
        virtualSize: manifest.virtualSize,
      }),
    );
    this.physicalAtlas = createVirtualTexturePhysicalAtlasTexture(gl, {
      paddedPageSize: manifest.pageSize + manifest.borderTexels * 2,
      slotColumns: this.runtime.slotColumns,
      slotRows: this.runtime.slotRows,
    });
  }

  get uploadStats(): VirtualTextureResourceUploadStats {
    return { ...this.#stats };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#gl.deleteTexture(this.pageTable.texture);
    this.#gl.deleteTexture(this.physicalAtlas.texture);
    this.#disposed = true;
  }

  drainUploadPlan(frame = 0): VirtualTextureResourceUploadBatch {
    this.#assertLive();
    const dirtyEntries = this.runtime.drainDirtyEntries(frame);
    const plan = planVirtualTextureUploads(dirtyEntries, {
      borderTexels: this.manifest.borderTexels,
      bytesPerTexel: this.manifest.bytesPerTexel,
      pageSize: this.manifest.pageSize,
    });
    this.#stats.dirtyBatches += 1;
    this.#stats.lastFrame = frame;
    this.#stats.lastUploadCount = plan.uploadCount;
    return { frame, plan };
  }

  makeResident(page: VirtualTexturePageAddress, frame = 0): ReturnType<VirtualTextureRuntime["makeResident"]> {
    this.#assertLive();
    return this.runtime.makeResident(page, frame);
  }

  resolve(page: VirtualTexturePageAddress, frame = 0): ReturnType<VirtualTextureRuntime["resolve"]> {
    this.#assertLive();
    return this.runtime.resolve(page, frame);
  }

  uploadPageTable(plan: VirtualTextureUploadPlan): void {
    this.#assertLive();
    const result = uploadVirtualTexturePageTableTexels(this.#gl, this.pageTable, plan.pageTableUploads);
    this.#stats.bytesUploaded += result.bytesUploaded;
    this.#stats.pageTableBytesUploaded += result.bytesUploaded;
    this.#stats.pageTableTexelsUploaded += result.texelsUploaded;
  }

  uploadPhysicalAtlasPage(upload: VirtualTexturePhysicalAtlasPageUpload, pixels: ArrayBufferView): void {
    this.#assertLive();
    if (pixels.byteLength !== upload.byteLength) {
      throw new Error(
        `Virtual texture physical atlas upload for ${upload.residentPageId} expected ${upload.byteLength} bytes, got ${pixels.byteLength}`,
      );
    }

    this.#gl.bindTexture(this.#gl.TEXTURE_2D, this.physicalAtlas.texture);
    this.#gl.texSubImage2D(
      this.#gl.TEXTURE_2D,
      upload.level,
      upload.xOffset,
      upload.yOffset,
      upload.width,
      upload.height,
      this.#gl.RGBA,
      this.#gl.UNSIGNED_BYTE,
      pixels,
    );
    this.#stats.bytesUploaded += pixels.byteLength;
    this.#stats.physicalAtlasBytesUploaded += pixels.byteLength;
    this.#stats.physicalAtlasPagesUploaded += 1;
  }

  #assertLive(): void {
    if (this.#disposed) throw new Error("Virtual texture resource has been disposed");
  }
}

const createVirtualTexturePhysicalAtlasTexture = (
  gl: VirtualTextureResourceGl,
  options: {
    readonly paddedPageSize: number;
    readonly slotColumns: number;
    readonly slotRows: number;
  },
): VirtualTexturePhysicalAtlasTexture => {
  const width = options.slotColumns * options.paddedPageSize;
  const height = options.slotRows * options.paddedPageSize;
  const texture = gl.createTexture();
  if (texture === null) throw new Error("Failed to create virtual texture physical atlas texture");

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    height,
    paddedPageSize: options.paddedPageSize,
    slotColumns: options.slotColumns,
    slotRows: options.slotRows,
    texture,
    width,
  };
};
