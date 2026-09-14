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
let generation = 0;
let context = 0, scratch = 0, capacity = 0;
let current: { id: number; size: number; row: number; rgba: Uint8ClampedArray; blocks: Uint8Array } | undefined;
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
// A grant encodes exactly one six-pixel block row. No autonomous work loop:
// the owner grants another row only while foreground preparation is idle.
self.onmessage = async ({ data }: MessageEvent<{ type: string; id: number; bitmap?: ImageBitmap; size?: number }>) => {
  try {
    if (data.type === "cancel") { generation++; current = undefined; return; }
    if (data.type === "start") {
      const token = ++generation;
      const bitmap = data.bitmap!;
      try {
        const c = await initialize();
        if (token !== generation) return;
        const size = data.size!;
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
        current = { id: data.id, size, rgba, row: 0, blocks: new Uint8Array((size / 6) * rowBytes) };
        self.postMessage({ id: data.id, type: "yield" });
      } finally { bitmap.close(); }
    } else if (data.type === "step" && current?.id === data.id) {
      const { size, row, rgba, blocks } = current;
      const c = codec!;
      const inputBytes = size * 6 * 4, rowBytes = size / 6 * 16;
      new Uint8Array(c.memory.buffer, scratch, inputBytes).set(rgba.subarray(row * size * 4, (row + 6) * size * 4));
      const status = c.encode(context, scratch, size, 6, scratch + inputBytes, rowBytes);
      if (status !== 0) throw new Error(`ASTC encoding failed (${status})`);
      blocks.set(new Uint8Array(c.memory.buffer, scratch + inputBytes, rowBytes), row / 6 * rowBytes);
      current.row += 6;
      if (current.row === size) {
        current = undefined;
        self.postMessage({ id: data.id, type: "complete", blocks }, { transfer: [blocks.buffer] });
      } else self.postMessage({ id: data.id, type: "yield" });
    }
  } catch (error) {
    current = undefined;
    self.postMessage({ id: data.id, type: "error", error: String(error) });
  }
};

export {};
