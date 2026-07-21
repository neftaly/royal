import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'royal-package-consumer-'));
const artifactsDirectory = path.join(temporaryRoot, 'artifacts');
const fixtureDirectory = path.join(repoRoot, 'scripts/fixtures/packed-consumer');
mkdirSync(artifactsDirectory);
const pnpmCli = process.env.npm_execpath;

const runPnpm = (arguments_, options = {}) => {
  const command = pnpmCli === undefined ? 'pnpm' : process.execPath;
  const commandArguments = pnpmCli === undefined ? arguments_ : [pnpmCli, ...arguments_];
  execFileSync(command, commandArguments, { stdio: 'inherit', ...options });
};

const packageDirectories = [
  'packages/renderer-core',
  'packages/renderer-webgl',
  'packages/react',
];

const packageSizeBudgets = {
  '@royal/react': 128 * 1024,
  '@royal/renderer-core': 512 * 1024,
  '@royal/renderer-webgl': 435 * 1024,
};

const readPackage = (directory) => JSON.parse(readFileSync(
  path.join(repoRoot, directory, 'package.json'),
  'utf8',
));

const packageTarballName = (manifest) =>
  `${manifest.name.replace('@', '').replace('/', '-')}-${manifest.version}.tgz`;

const exportTargets = (value) => {
  if (typeof value === 'string') return value.startsWith('./') ? [value] : [];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(exportTargets);
};

const listTarballEntries = (tarball) => {
  const archive = gunzipSync(readFileSync(tarball));
  const entries = [];
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const readString = (start, end) => header.subarray(start, end)
      .toString('utf8')
      .replace(/\0.*$/u, '');
    const name = readString(0, 100);
    const prefix = readString(345, 500);
    entries.push(prefix === '' ? name : `${prefix}/${name}`);
    const size = Number.parseInt(readString(124, 136).trim() || '0', 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
};

try {
  for (const directory of packageDirectories) {
    const manifest = readPackage(directory);
    const tarball = path.join(artifactsDirectory, packageTarballName(manifest));
    runPnpm(['--dir', path.join(repoRoot, directory), 'pack', '--out', tarball], { stdio: 'pipe' });

    const contents = listTarballEntries(tarball);
    const unexpectedFile = contents.find((entry) =>
      entry !== 'package/package.json'
      && entry !== 'package/README.md'
      && !entry.startsWith('package/dist/'));
    if (unexpectedFile !== undefined) {
      throw new Error(`${manifest.name} packed unexpected file: ${unexpectedFile}`);
    }
    const missingTarget = exportTargets(manifest.exports)
      .map((target) => `package/${target.slice(2)}`)
      .find((target) => !contents.includes(target));
    if (missingTarget !== undefined) {
      throw new Error(`${manifest.name} packed export target is missing: ${missingTarget}`);
    }
    if (manifest.name === '@royal/renderer-webgl') {
      const worker = contents.find((entry) =>
        /^package\/dist\/assets\/static-preparation-worker-.*\.js$/u.test(entry));
      if (worker === undefined) {
        throw new Error('@royal/renderer-webgl packed worker entry is missing');
      }
      const browserPreparationName = readdirSync(path.join(repoRoot, directory, 'dist'))
        .find((file) => file.startsWith('browser-static-preparation-') && file.endsWith('.js'));
      const browserPreparation = browserPreparationName === undefined
        ? ''
        : readFileSync(path.join(repoRoot, directory, 'dist', browserPreparationName), 'utf8');
      if (!browserPreparation.includes('new URL("assets/static-preparation-worker-')) {
        throw new Error('@royal/renderer-webgl worker URL is not package-relative');
      }
    }
    const packedBytes = statSync(tarball).size;
    const sizeBudget = packageSizeBudgets[manifest.name];
    if (sizeBudget === undefined || packedBytes > sizeBudget) {
      throw new Error(`${manifest.name} tarball is ${packedBytes} bytes; budget is ${sizeBudget ?? 0}`);
    }
    console.log(`ok packed ${manifest.name} ${Math.ceil(packedBytes / 1024)} KiB`);
  }

  const manifests = packageDirectories.map(readPackage);
  const fileDependencies = Object.fromEntries(manifests.map((manifest) => [
    manifest.name,
    `file:./artifacts/${packageTarballName(manifest)}`,
  ]));
  writeFileSync(path.join(temporaryRoot, 'package.json'), `${JSON.stringify({
    dependencies: {
      ...fileDependencies,
      react: `link:${path.join(repoRoot, 'node_modules/react')}`,
    },
    devDependencies: {
      '@types/react': `link:${path.join(repoRoot, 'node_modules/@types/react')}`,
      typescript: `link:${path.join(repoRoot, 'node_modules/typescript')}`,
    },
    name: 'royal-packed-consumer-smoke',
    pnpm: { overrides: fileDependencies },
    private: true,
    type: 'module',
    version: '0.0.0',
  }, null, 2)}\n`);
  writeFileSync(path.join(temporaryRoot, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      exactOptionalPropertyTypes: true,
      jsx: 'react-jsx',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      noEmit: true,
      strict: true,
      target: 'ES2022',
    },
    include: ['*.ts', '*.tsx'],
  }, null, 2)}\n`);
  for (const fixture of readdirSync(fixtureDirectory)) {
    writeFileSync(
      path.join(temporaryRoot, fixture),
      readFileSync(path.join(fixtureDirectory, fixture)),
    );
  }

  runPnpm(['install', '--prefer-offline', '--ignore-scripts'], { cwd: temporaryRoot });
  runPnpm(['exec', 'tsc'], { cwd: temporaryRoot });
  execFileSync(process.execPath, ['imports.mjs'], { cwd: temporaryRoot, stdio: 'inherit' });
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}
