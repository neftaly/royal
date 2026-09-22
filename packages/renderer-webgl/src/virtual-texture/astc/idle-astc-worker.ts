import { loadWorkerRuntime } from "../../workers/runtime";
const { worker, Transfer } = await loadWorkerRuntime();
interface Codec {
  memory: WebAssembly.Memory;
  _initialize(): void;
  create_encoder(block: number, quality: number): number;
  destroy_encoder(context: number): void;
  malloc(bytes: number): number;
  free(pointer: number): void;
  encode(context: number, input: number, width: number, height: number, output: number, bytes: number): number;
}
let codec: Codec | undefined;
let context = 0, scratch = 0, capacity = 0;
let current: { size: number; row: number; rgba: Uint8ClampedArray; blocks: Uint8Array } | undefined;
let initialization: Promise<Codec> | undefined;
const initialize = (): Promise<Codec> => initialization ??= initializeCodec();
const initializeCodec = async (): Promise<Codec> => {
  if (codec !== undefined) return codec;
  const { instance } = await WebAssembly.instantiateStreaming(fetch(new URL("./encoder.wasm", import.meta.url)), {
    env: { emscripten_notify_memory_growth: () => undefined },
    wasi_snapshot_preview1: { fd_close: () => 8, fd_seek: () => 8, fd_write: () => 8 },
  });
  codec = instance.exports as unknown as Codec;
  codec._initialize();
  context = codec.create_encoder(6, 0);
  if (context === 0) throw new Error("ASTC encoder initialization failed");
  return codec;
};
// One RPC encodes one block row; the owner grants rows only when idle.
worker({
  start: async (bitmap: ImageBitmap, size: number) => {
    try {
      const c = await initialize();
      if (size < 6 || size > 264 || size % 6 !== 0) throw new Error("Unsupported ASTC page size");
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("ASTC worker has no raster context");
      ctx.drawImage(bitmap, 0, 0);
      const rgba = ctx.getImageData(0, 0, size, size).data;
      const rowBytes = size / 6 * 16;
      const needed = size * 6 * 4 + rowBytes;
      if (capacity < needed) {
        c.free(scratch); scratch = c.malloc(needed); capacity = needed;
        if (!scratch) throw new Error("ASTC scratch allocation failed");
      }
      current = { size, rgba, row: 0, blocks: new Uint8Array((size / 6) * rowBytes) };
    } finally { bitmap.close(); }
  },
  step: () => {
    if (current === undefined) throw new Error("No active ASTC page");
    const { size, row, rgba, blocks } = current;
    const c = codec!;
    const inputBytes = size * 6 * 4, rowBytes = size / 6 * 16;
    new Uint8Array(c.memory.buffer, scratch, inputBytes).set(rgba.subarray(row * size * 4, (row + 6) * size * 4));
    const status = c.encode(context, scratch, size, 6, scratch + inputBytes, rowBytes);
    if (status !== 0) { current = undefined; throw new Error(`ASTC encoding failed (${status})`); }
    blocks.set(new Uint8Array(c.memory.buffer, scratch + inputBytes, rowBytes), row / 6 * rowBytes);
    current.row += 6;
    if (current.row !== size) return undefined;
    current = undefined;
    return new Transfer(blocks, [blocks.buffer]);
  },
});
