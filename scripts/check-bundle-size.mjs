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
const showDetails = process.argv.includes('--details');

const gzipBytes = (filePath) => gzipSync(readFileSync(filePath), { level: 9 }).byteLength;

const buildRendererAttribution = async () => {
  const packageRoot = path.join(repoRoot, 'packages/renderer-webgl');
  const chunks = new Map();
  const previousWorkingDirectory = process.cwd();
  try {
    process.chdir(packageRoot);
    await build({
      configFile: path.join(repoRoot, 'vite.config.ts'),
      logLevel: 'silent',
      plugins: [{
        name: 'royal-renderer-source-attribution',
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle)) {
            if (output.type !== 'chunk') continue;
            chunks.set(output.fileName, {
              imports: output.imports,
              isEntry: output.isEntry,
              modules: output.modules,
              name: output.name,
            });
          }
        },
      }],
      build: {
        emptyOutDir: true,
        outDir: path.join(temporaryRoot, 'renderer-attribution'),
        sourcemap: false,
      },
    });
  } finally {
    process.chdir(previousWorkingDirectory);
  }
  const entry = Array.from(chunks.values()).find((chunk) => chunk.isEntry && chunk.name === 'index');
  if (entry === undefined) throw new Error('Renderer attribution build has no index entry');
  const initialChunks = new Set();
  const visit = (chunk) => {
    if (initialChunks.has(chunk)) return;
    initialChunks.add(chunk);
    for (const imported of chunk.imports) {
      const dependency = chunks.get(imported);
      if (dependency !== undefined) visit(dependency);
    }
  };
  visit(entry);
  const bytesByModule = new Map();
  for (const chunk of initialChunks) {
    for (const [id, module] of Object.entries(chunk.modules)) {
      bytesByModule.set(id, (bytesByModule.get(id) ?? 0) + (module.renderedLength ?? 0));
    }
  }
  const initialModules = Array.from(bytesByModule)
    .filter(([id]) => id.startsWith(path.join(packageRoot, 'src')))
    .sort((left, right) => right[1] - left[1]);
  const lazyChunks = Array.from(chunks.entries())
    .filter(([, chunk]) => !initialChunks.has(chunk))
    .map(([file, chunk]) => [
      file,
      Object.entries(chunk.modules)
        .filter(([id]) => id.startsWith(path.join(packageRoot, 'src')))
        .map(([id, module]) => [id, module.renderedLength ?? 0])
        .sort((left, right) => right[1] - left[1]),
    ]);
  return { initialModules, lazyChunks };
};

const buildFixture = async (name) => {
  const outputDirectory = path.join(temporaryRoot, name);
  const renderedModulesByFile = new Map();
  await build({
    root: path.join(fixtureRoot, name),
    configFile: false,
    logLevel: 'silent',
    plugins: [{
      name: 'royal-bundle-size-attribution',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue;
          renderedModulesByFile.set(output.fileName, Object.entries(output.modules).map(
            ([id, module]) => [id, module.renderedLength ?? 0],
          ));
        }
      },
    }],
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
  const initialJsNames = new Set(
    Array.from(initialFiles).filter((file) => file.endsWith('.js')).map((file) => path.basename(file)),
  );
  const initialRenderedBytesByModule = new Map();
  for (const file of initialFiles) {
    for (const [id, bytes] of renderedModulesByFile.get(file) ?? []) {
      initialRenderedBytesByModule.set(
        id,
        (initialRenderedBytesByModule.get(id) ?? 0) + bytes,
      );
    }
  }
  return {
    gzipByFile,
    initialFiles,
    initialGzipBytes: Array.from(initialFiles)
      .filter((file) => file.endsWith('.js'))
      .reduce((sum, file) => sum + gzipBytes(path.join(outputDirectory, file)), 0),
    lazyGzipBytes: jsFiles
      .filter((file) => !initialJsNames.has(file))
      .reduce((sum, file) => sum + gzipByFile[file], 0),
    totalGzipBytes: Object.values(gzipByFile).reduce((sum, bytes) => sum + bytes, 0),
    workerGzipBytes: jsFiles
      .filter((file) => file.includes('-worker-'))
      .reduce((sum, file) => sum + gzipByFile[file], 0),
    initialRenderedBytesByModule,
    renderedModulesByFile,
  };
};

const formatBytes = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

try {
  const react = await buildFixture('react');
  const royal = await buildFixture('royal');
  const gltf = await buildFixture('gltf');
  const incrementalGzipBytes = royal.initialGzipBytes - react.initialGzipBytes;
  const gltfIncrementalGzipBytes = gltf.initialGzipBytes - royal.initialGzipBytes;
  const totalIncrementalGzipBytes = royal.totalGzipBytes - react.initialGzipBytes;

  console.log(`React baseline:       ${formatBytes(react.initialGzipBytes)} gzip`);
  console.log(`Royal initial:        ${formatBytes(royal.initialGzipBytes)} gzip`);
  console.log(`Royal incremental:    ${formatBytes(incrementalGzipBytes)} gzip`);
  console.log(`Royal glTF initial:   ${formatBytes(gltf.initialGzipBytes)} gzip`);
  console.log(`glTF authoring delta: ${formatBytes(gltfIncrementalGzipBytes)} gzip`);
  console.log(`Royal lazy chunks:    ${formatBytes(royal.lazyGzipBytes)} gzip`);
  console.log(`Royal worker assets:  ${formatBytes(royal.workerGzipBytes)} gzip`);
  console.log(`Royal deployed JS:    ${formatBytes(royal.totalGzipBytes)} gzip`);
  console.log(`Royal-only graph:     ${formatBytes(totalIncrementalGzipBytes)} gzip`);
  if (showDetails) {
    console.log('Royal JavaScript files by gzip bytes:');
    for (const [file, bytes] of Object.entries(royal.gzipByFile)
      .sort((left, right) => right[1] - left[1])) {
      console.log(`${String(bytes).padStart(7)}  ${file}`);
    }
    const royalModules = Array.from(royal.initialRenderedBytesByModule)
      .filter(([id]) => id.startsWith(path.join(repoRoot, 'packages')))
      .sort((left, right) => right[1] - left[1]);
    console.log('Initial Royal modules by rendered bytes:');
    for (const [id, bytes] of royalModules.slice(0, 30)) {
      console.log(`${String(bytes).padStart(7)}  ${path.relative(repoRoot, id)}`);
    }
    const rendererAttribution = await buildRendererAttribution();
    console.log('Initial renderer sources by rendered bytes:');
    for (const [id, bytes] of rendererAttribution.initialModules.slice(0, 40)) {
      console.log(`${String(bytes).padStart(7)}  ${path.relative(repoRoot, id)}`);
    }
    console.log('Lazy renderer sources by rendered bytes:');
    for (const [file, modules] of rendererAttribution.lazyChunks) {
      console.log(`  ${file}`);
      for (const [id, bytes] of modules.slice(0, 16)) {
        console.log(`${String(bytes).padStart(7)}  ${path.relative(repoRoot, id)}`);
      }
    }
  }

  const failures = [];
  if (royal.initialGzipBytes > budget.royalInitialGzipBytes) {
    failures.push(
      `Royal initial gzip ${royal.initialGzipBytes} exceeds ${budget.royalInitialGzipBytes}`,
    );
  }
  if (incrementalGzipBytes > budget.royalIncrementalGzipBytes) {
    failures.push(
      `Royal incremental gzip ${incrementalGzipBytes} exceeds ${budget.royalIncrementalGzipBytes}`,
    );
  }
  if (gltf.initialGzipBytes > budget.royalGltfInitialGzipBytes) {
    failures.push(
      `Royal glTF initial gzip ${gltf.initialGzipBytes} exceeds ${budget.royalGltfInitialGzipBytes}`,
    );
  }
  if (gltfIncrementalGzipBytes > budget.royalGltfIncrementalGzipBytes) {
    failures.push(
      `Royal glTF authoring delta ${gltfIncrementalGzipBytes} exceeds ${budget.royalGltfIncrementalGzipBytes}`,
    );
  }
  if (royal.lazyGzipBytes > budget.royalLazyGzipBytes) {
    failures.push(
      `Royal lazy gzip ${royal.lazyGzipBytes} exceeds ${budget.royalLazyGzipBytes}`,
    );
  }
  if (royal.workerGzipBytes > budget.royalWorkerGzipBytes) {
    failures.push(
      `Royal worker gzip ${royal.workerGzipBytes} exceeds ${budget.royalWorkerGzipBytes}`,
    );
  }
  if (royal.totalGzipBytes > budget.royalTotalGzipBytes) {
    failures.push(
      `Royal deployed JS gzip ${royal.totalGzipBytes} exceeds ${budget.royalTotalGzipBytes}`,
    );
  }
  if (totalIncrementalGzipBytes > budget.royalTotalIncrementalGzipBytes) {
    failures.push(
      `Royal-only main graph gzip ${totalIncrementalGzipBytes} exceeds ${budget.royalTotalIncrementalGzipBytes}`,
    );
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
