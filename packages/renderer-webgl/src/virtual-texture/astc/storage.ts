import { PersistentGpuBudgetOwner } from "../../resource/persistent-gpu-budget";

/** Separate ASTC storage. Retained blocks permit bounded growth without readback. */
export class IdleAstcStorage {
  readonly blocks: Uint8Array[] = [];
  texture: WebGLTexture | undefined;
  columns = 0;
  rows = 0;
  #identity: object = {};
  #pending: { texture: WebGLTexture; identity: object; columns: number; rows: number; copied: number; waits: number; fence?: WebGLSync } | undefined;
  readonly gl: WebGL2RenderingContext;
  readonly budget: PersistentGpuBudgetOwner;
  readonly size: number;
  constructor(gl: WebGL2RenderingContext, budget: PersistentGpuBudgetOwner, size: number) { this.gl = gl; this.budget = budget; this.size = size; }
  get byteLength(): number { return this.size ** 2 / 36 * 16 * (this.columns * this.rows + (this.#pending === undefined ? 0 : this.#pending.columns * this.#pending.rows)); }
  get cpuBytes(): number { return this.blocks.length * this.size ** 2 / 36 * 16; }
  get growing(): boolean { return this.#pending !== undefined; }
  /** At most one existing page transfer per invocation. false means unfinished. */
  ensureCapacity(admit: (bytes: number) => boolean, maxTextureSize: number, poolBytes: number, admitAllocation: () => boolean): boolean {
    if (this.blocks.length < this.columns * this.rows) return true;
    const gl = this.gl;
    if (this.#pending === undefined) {
      const slots = Math.min(512, Math.max(8, this.columns * this.rows * 2));
      if (slots <= this.blocks.length) throw new Error("ASTC page capacity exhausted");
      const columns = Math.min(16, 2 ** Math.floor(Math.log2(slots) / 2));
      const rows = slots / columns;
      if (Math.max(columns, rows) * this.size > maxTextureSize) throw new Error("ASTC storage exceeds device limit");
      const identity = {};
      const bytes = slots * this.size ** 2 / 36 * 16;
      if (bytes > poolBytes) throw new Error("ASTC pool headroom denied");
      if (!admitAllocation()) return false;
      if (!this.budget.tryClaim(identity, bytes)) throw new Error("ASTC migration budget denied");
      const texture = gl.createTexture();
      if (texture === null) { this.budget.release(identity); throw new Error("ASTC allocation failed"); }
      this.#pending = { texture, identity, columns, rows, copied: 0, waits: 0 };
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, 0x93d4, columns * this.size, rows * this.size);
      const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (fence === null) throw new Error("ASTC allocation fence failed");
      this.#pending.fence = fence;
      gl.flush();
      return false;
    }
    const pending = this.#pending;
    if (pending.fence !== undefined) {
      const status = gl.clientWaitSync(pending.fence, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED && ++pending.waits < 120) return false;
      if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) throw new Error("ASTC migration fence failed");
      gl.deleteSync(pending.fence); delete pending.fence;
      if (gl.getError() !== gl.NO_ERROR) throw new Error("ASTC storage validation failed");
    }
    if (pending.copied < this.blocks.length) {
      const blocks = this.blocks[pending.copied]!;
      if (!admit(blocks.byteLength)) return false;
      this.#upload(pending.texture, pending.columns, pending.copied++, blocks);
      if (pending.copied === this.blocks.length) {
        const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (fence === null) throw new Error("ASTC copy fence failed");
        pending.fence = fence; gl.flush();
      }
      return false;
    }
    if (this.texture !== undefined) gl.deleteTexture(this.texture);
    this.budget.release(this.#identity);
    this.texture = pending.texture; this.#identity = pending.identity;
    this.columns = pending.columns; this.rows = pending.rows;
    this.#pending = undefined;
    return true;
  }
  append(blocks: Uint8Array): number {
    const slot = this.blocks.length;
    if (this.texture === undefined || slot >= this.columns * this.rows || blocks.byteLength !== this.size ** 2 / 36 * 16) throw new Error("Invalid ASTC publication");
    this.#upload(this.texture, this.columns, slot, blocks);
    this.blocks.push(blocks);
    return slot;
  }
  #upload(texture: WebGLTexture, columns: number, slot: number, blocks: Uint8Array): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.compressedTexSubImage2D(gl.TEXTURE_2D, 0, slot % columns * this.size, Math.floor(slot / columns) * this.size, this.size, this.size, 0x93d4, blocks);
  }
  cancelGrowth(deleteGpu = true): void {
    const pending = this.#pending;
    if (pending === undefined) return;
    if (deleteGpu) {
      if (pending.fence !== undefined) this.gl.deleteSync(pending.fence);
      this.gl.deleteTexture(pending.texture);
    }
    this.budget.release(pending.identity); this.#pending = undefined;
  }
  dispose(deleteGpu = true): void {
    this.cancelGrowth(deleteGpu);
    if (deleteGpu && this.texture !== undefined) this.gl.deleteTexture(this.texture);
    this.budget.release(this.#identity);
    this.texture = undefined; this.blocks.length = 0;
  }
}
