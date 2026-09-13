import { writeFile } from 'node:fs/promises';
import { deepStrictEqual } from 'node:assert';
const methods = { slice: blocks => blocks.slice(), constructor: blocks => new Uint8Array(blocks) };
const sizes = [5184, 9216, 10368, 20736];
for (const size of sizes) for (const offset of [0, 7, 160, 1024]) {
  const buffer = new Uint8Array(size + offset + 1024);
  const input = buffer.subarray(offset, offset + size);
  for (let i = 0; i < size; i++) input[i] = (i * 31 + 17) % 251;
  for (const copy of Object.values(methods)) {
    const output = copy(input);
    deepStrictEqual(output, input);
    if (output.buffer === input.buffer || output.byteOffset !== 0 || output.buffer.byteLength !== size) throw new Error('Copy storage contract failed');
  }
}
const results = [];
for (const size of sizes) {
  const source = new Uint8Array(size + 160).subarray(160); source.fill(73);
  for (let round = 0; round < 8; round++) for (const method of round % 2 ? ['constructor', 'slice'] : ['slice', 'constructor']) {
    const copy = methods[method];
    for (let i = 0; i < 5000; i++) copy(source);
    global.gc?.();
    const start = performance.now(); let checksum = 0;
    for (let i = 0; i < 10000; i++) { const bytes = copy(source); checksum += bytes[0] + bytes[bytes.length - 1]; }
    results.push({ size, round, method, calls: 10000, elapsedMs: performance.now() - start, checksum });
  }
}
await writeFile('research/vt-comparison/native-copy-comparison.json', JSON.stringify({ node: process.version,
  equivalentInputs: 16, results, note: 'Isolated Node CPU screening: ordinary Uint8Array views at nonzero offsets. No native parser, Response, GPU, retained-page queue or full-read throughput is measured. Copy bytes are consumed; allocation and GC costs occur in both variants.' }, null, 2) + '\n');
