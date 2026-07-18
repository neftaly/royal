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
    initialRenderedBytesByModule,
    renderedModulesByFile,
  };
};

const formatBytes = (bytes) => `${(bytes / 1000).toFixed(1)} kB`;

try {
  const react = await buildFixture('react');
  const clear = await buildFixture('royal');
  const incrementalGzipBytes = clear.initialGzipBytes - react.initialGzipBytes;

  console.log(`React baseline:       ${formatBytes(react.initialGzipBytes)} gzip`);
  console.log(`Clear-root initial:   ${formatBytes(clear.initialGzipBytes)} gzip`);
  console.log(`Royal incremental:    ${formatBytes(incrementalGzipBytes)} gzip`);
  if (showDetails) {
    const royalModules = Array.from(clear.initialRenderedBytesByModule)
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
  if (clear.initialGzipBytes > budget.clearInitialGzipBytes) {
    failures.push(
      `Clear-root initial gzip ${clear.initialGzipBytes} exceeds ${budget.clearInitialGzipBytes}`,
    );
  }
  if (incrementalGzipBytes > budget.clearIncrementalGzipBytes) {
    failures.push(
      `Clear-root incremental gzip ${incrementalGzipBytes} exceeds ${budget.clearIncrementalGzipBytes}`,
    );
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
