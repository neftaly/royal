export async function runNativeCopy() {
const methods = { slice: (blocks: Uint8Array) => blocks.slice(), constructor: (blocks: Uint8Array) => new Uint8Array(blocks) };
const sizes = [5184, 9216, 10368, 20736];
for (const size of sizes) for (const offset of [0, 7, 160, 1024]) {
  const buffer = new Uint8Array(size + offset + 1024);
  const input = buffer.subarray(offset, offset + size);
  for (let i = 0; i < size; i++) input[i] = (i * 31 + 17) % 251;
  for (const copy of Object.values(methods)) {
    const output = copy(input);
    if (output.findIndex((byte, index) => byte !== input[index]) !== -1) throw new Error('Copy bytes differ');
    if (output.buffer === input.buffer || output.byteOffset !== 0 || output.buffer.byteLength !== size) throw new Error('Copy storage contract failed');
  }
}
const results = [];
for (const size of sizes) {
  const source = new Uint8Array(size + 160).subarray(160); source.fill(73);
  for (let round = 0; round < 8; round++) for (const method of round % 2 ? (['constructor', 'slice'] as const) : (['slice', 'constructor'] as const)) {
    const copy = methods[method];
    for (let i = 0; i < 5000; i++) copy(source);

    const start = performance.now(); let checksum = 0;
    for (let i = 0; i < 10000; i++) { const bytes = copy(source); checksum += bytes[0]! + bytes[bytes.length - 1]!; }
    results.push({ size, round, method, calls: 10000, elapsedMs: performance.now() - start, checksum });
  }
}
return { results, equivalentInputs: 16, note: 'Isolated browser typed-array copy screening. Per-batch timings exclude validation and warm-up; aggregate trace includes them. No parser, Response, runtime queue or upload. Each output is exact-size, separate storage and every byte is verified before timing.' };
}
