import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'vite';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureRoot = path.join(repoRoot, 'apps/examples-react/bundle-size');
const budget = JSON.parse(readFileSync(
  path.join(repoRoot, 'scripts/bundle-size-budget.json'),
  'utf8',
));
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'royal-bundle-size-'));

const gzipBytes = (filePath) => gzipSync(readFileSync(filePath), { level: 9 }).byteLength;

const buildFixture = async (name) => {
  const outputDirectory = path.join(temporaryRoot, name);
  await build({
    root: path.join(fixtureRoot, name),
    configFile: false,
    logLevel: 'silent',
    build: {
      emptyOutDir: true,
      manifest: true,
      outDir: outputDirectory,
      sourcemap: true,
      target: 'safari17',
    },
  });

  const manifest = JSON.parse(readFileSync(
    path.join(outputDirectory, '.vite/manifest.json'),
    'utf8',
  ));
  const entry = Object.values(manifest).find((chunk) => chunk.isEntry === true);
  if (entry === undefined) throw new Error(`Bundle-size fixture ${name} has no entry chunk`);

  const initialFiles = new Set();
  const visitInitialChunk = (chunk) => {
    if (initialFiles.has(chunk.file)) return;
    initialFiles.add(chunk.file);
    for (const importedName of chunk.imports ?? []) visitInitialChunk(manifest[importedName]);
  };
  visitInitialChunk(entry);

  const jsFiles = readdirSync(path.join(outputDirectory, 'assets'))
    .filter((file) => file.endsWith('.js'));
  const gzipByFile = Object.fromEntries(jsFiles.map((file) => [
    file,
    gzipBytes(path.join(outputDirectory, 'assets', file)),
  ]));
  return {
    gzipByFile,
    initialFiles,
    initialGzipBytes: Array.from(initialFiles)
      .filter((file) => file.endsWith('.js'))
      .reduce((sum, file) => sum + gzipBytes(path.join(outputDirectory, file)), 0),
  };
};

const formatBytes = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

try {
  const react = await buildFixture('react');
  const primitive = await buildFixture('royal');
  const gltf = await buildFixture('gltf');
  const incrementalGzipBytes = gltf.initialGzipBytes - react.initialGzipBytes;
  const reachableGzipBytes = Object.values(gltf.gzipByFile)
    .reduce((sum, bytes) => sum + bytes, 0);
  const lazyChunks = Object.entries(gltf.gzipByFile)
    .filter(([file]) => !gltf.initialFiles.has(`assets/${file}`))
    .sort(([left], [right]) => left.localeCompare(right));

  console.log(`React baseline:       ${formatBytes(react.initialGzipBytes)} gzip`);
  console.log(`Primitive initial:    ${formatBytes(primitive.initialGzipBytes)} gzip`);
  console.log(`glTF initial:         ${formatBytes(gltf.initialGzipBytes)} gzip`);
  console.log(`glTF incremental:     ${formatBytes(incrementalGzipBytes)} gzip`);
  console.log(`glTF all reachable:   ${formatBytes(reachableGzipBytes)} gzip`);
  for (const [file, bytes] of lazyChunks) {
    console.log(`Lazy ${file.padEnd(28)} ${formatBytes(bytes)} gzip`);
  }

  const failures = [];
  if (primitive.initialGzipBytes > budget.primitiveInitialGzipBytes) {
    failures.push(
      `Primitive initial gzip ${primitive.initialGzipBytes} exceeds ${budget.primitiveInitialGzipBytes}`,
    );
  }
  if (gltf.initialGzipBytes > budget.gltfInitialGzipBytes) {
    failures.push(
      `glTF initial gzip ${gltf.initialGzipBytes} exceeds ${budget.gltfInitialGzipBytes}`,
    );
  }
  if (incrementalGzipBytes > budget.gltfIncrementalGzipBytes) {
    failures.push(
      `glTF incremental gzip ${incrementalGzipBytes} exceeds ${budget.gltfIncrementalGzipBytes}`,
    );
  }
  if (reachableGzipBytes > budget.gltfReachableGzipBytes) {
    failures.push(
      `glTF reachable gzip ${reachableGzipBytes} exceeds ${budget.gltfReachableGzipBytes}`,
    );
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
