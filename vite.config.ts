import { codecModulePlugin } from "./scripts/codec-module-plugin";
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import glsl from 'vite-plugin-glsl';
import type { Plugin } from 'vite';

type PackageConfig = {
  readonly external?: readonly string[];
  readonly lib: {
    readonly entry: string | Record<string, string>;
    readonly formats: readonly ['es'];
    readonly fileName: string | ((_format: string, entryName: string) => string);
  };
};

type PackageManifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly name?: string;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
};

export const buildConfigsByPackageName: Record<string, PackageConfig> = {
  '@royal/renderer-core': {
    lib: {
      entry: {
        index: 'src/index.ts',
        'render-object': 'src/render-object.ts',
      },
      formats: ['es'],
      fileName: (_format, entryName) => entryName + '.js'
    }
  },
  '@royal/renderer-webgl': {
    external: ['@royal/renderer-core', '@royal/renderer-core/render-object'],
    lib: {
      entry: {
        index: 'src/index.ts',
        ktx2: 'src/ktx2.ts',
        xr: 'src/xr.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => entryName + '.js'
    }
  },
  '@royal/react': {
    external: [
      '@royal/renderer-core',
      '@royal/renderer-core/render-object',
      '@royal/renderer-webgl',
      'react'
    ],
    lib: {
      entry: {
        index: 'src/index.ts',
        scene: 'src/scene.ts',
        xr: 'src/xr.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => entryName + '.js'
    }
  }
};

const appPackageNames = new Set(['@royal/examples-react']);
const reactAppPackageNames = new Set(['@royal/examples-react']);
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest;
const packageConfig = manifest.name ? buildConfigsByPackageName[manifest.name] : undefined;
const isAppPackage = manifest.name === undefined ? false : appPackageNames.has(manifest.name);
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const appBase = process.env.BASE_PATH ?? '/';
export const sourceAliases = [
  { find: '@royal/renderer-webgl/xr', replacement: path.join(repoRoot, 'packages/renderer-webgl/src/xr.ts') },
  { find: '@royal/renderer-webgl/ktx2', replacement: path.join(repoRoot, 'packages/renderer-webgl/src/ktx2.ts') },
  { find: '@royal/react/xr', replacement: path.join(repoRoot, 'packages/react/src/xr.ts') },
  { find: '@royal/renderer-webgl', replacement: path.join(repoRoot, 'packages/renderer-webgl/src/index.ts') },
  { find: '@royal/renderer-core/render-object', replacement: path.join(repoRoot, 'packages/renderer-core/src/render-object.ts') },
  { find: '@royal/react/scene', replacement: path.join(repoRoot, 'packages/react/src/scene.ts') },
  { find: '@royal/react', replacement: path.join(repoRoot, 'packages/react/src/index.ts') },
  { find: '@royal/renderer-core', replacement: path.join(repoRoot, 'packages/renderer-core/src/index.ts') }
];

const failOnRollupWarning = (warning: string | { readonly message?: string }): never => {
  const message = typeof warning === 'string' ? warning : warning.message ?? JSON.stringify(warning);
  throw new Error('Rollup warning treated as error: ' + message);
};

const assertPublishedSourceMapReferences = (directory: string): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      assertPublishedSourceMapReferences(entryPath);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const source = readFileSync(entryPath, 'utf8');
    for (const match of source.matchAll(/\/\/# sourceMappingURL=([^\r\n]+)/gu)) {
      const reference = match[1];
      if (reference === undefined || reference.startsWith('data:')) continue;
      const target = path.resolve(path.dirname(entryPath), reference);
      if (!existsSync(target)) {
        throw new Error(`Published JavaScript references a missing source map: ${entryPath} -> ${reference}`);
      }
    }
  }
};

const normalizePublishedWorkerSourceMap = (): Plugin => {
  let outputDirectory: string | undefined;
  return {
    name: 'royal-normalize-published-worker-source-map',
    writeBundle: (options) => {
      outputDirectory = options.dir;
    },
    closeBundle: () => {
      if (outputDirectory === undefined) return;
      const assets = path.join(outputDirectory, 'assets');
      let files: readonly string[];
      try {
        files = readdirSync(assets);
      } catch {
        files = [];
      }
      for (const fileName of files) {
        if (/^static-preparation-worker-.*\.js$/u.test(fileName)) {
          const workerPath = path.join(assets, fileName);
          const source = readFileSync(workerPath, 'utf8');
          const normalized = source.replace(
            /(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]+(?:\r?\n)?$/u,
            '\n'
          );
          if (normalized !== source) writeFileSync(workerPath, normalized);
        }
        if (/^static-preparation-worker-.*\.js\.map$/u.test(fileName)) {
          rmSync(path.join(assets, fileName), { force: true });
        }
      }
      assertPublishedSourceMapReferences(outputDirectory);
    }
  };
};

const sharedBuildOptions = { target: 'safari17', sourcemap: true, rollupOptions: { onwarn: failOnRollupWarning } };

const packageDependencyNames = (packageManifest: PackageManifest): readonly string[] => [
  ...Object.keys(packageManifest.dependencies ?? {}),
  ...Object.keys(packageManifest.optionalDependencies ?? {}),
  ...Object.keys(packageManifest.peerDependencies ?? {})
];

const packageExternalPredicate = (
  packageManifest: PackageManifest,
  config: PackageConfig
): ((id: string) => boolean) => {
  const externalPackageNames = new Set([
    ...packageDependencyNames(packageManifest),
    ...(config.external ?? [])
  ]);
  const externalPackagePrefixes = Array.from(externalPackageNames).map((packageName) => packageName + '/');

  return (id) =>
    id.startsWith('@royal/') ||
    externalPackageNames.has(id) ||
    externalPackagePrefixes.some((packageName) => id.startsWith(packageName));
};

export default ({ command, mode }: { readonly command: string; readonly mode: string }) => {
  const sharedPlugins = [
    codecModulePlugin(),
    glsl({ include: ['**/*.frag', '**/*.vert'], minify: mode === 'production' }),
    normalizePublishedWorkerSourceMap()
  ];
  const worker = {
    format: 'es' as const,
    rolldownOptions: { output: { codeSplitting: false as const } },
    plugins: () => {
      let outputDirectory: string | undefined;
      const workerChunks: string[] = [];
      const plugin: Plugin = {
        name: 'royal-omit-worker-source-maps',
        generateBundle: (_options, bundle) => {
          for (const output of Object.values(bundle)) {
            if (output.type === 'chunk') workerChunks.push(output.fileName);
          }
          for (const fileName of Object.keys(bundle)) {
            if (fileName.endsWith('.map')) delete bundle[fileName];
          }
        },
        writeBundle: (options) => {
          if (options.dir === undefined) return;
          outputDirectory = options.dir;
          for (const fileName of workerChunks) {
            rmSync(path.join(options.dir, fileName + '.map'), { force: true });
          }
        },
        closeBundle: () => {
          if (outputDirectory === undefined) return;
          for (const fileName of readdirSync(outputDirectory)) {
            if (/^static-preparation-worker-.*\.js\.map$/u.test(fileName)) {
              rmSync(path.join(outputDirectory, fileName), { force: true });
            }
          }
        }
      };
      return [codecModulePlugin(true), plugin];
    }
  };

  if (isAppPackage) {
    return {
      base: appBase,
      clearScreen: false,
      publicDir: false,
      plugins: [...(reactAppPackageNames.has(manifest.name ?? '') ? [react()] : []), ...sharedPlugins],
      resolve: { alias: sourceAliases },
      build: sharedBuildOptions,
      worker
    };
  }

  if (packageConfig === undefined) {
    if (command !== 'build') return { clearScreen: false, plugins: sharedPlugins, resolve: { alias: sourceAliases } };
    throw new Error('No shared Vite config for package: ' + (manifest.name ?? '<unknown>'));
  }

  return {
    base: './',
    clearScreen: false,
    plugins: sharedPlugins,
    worker,
    build: {
      ...sharedBuildOptions,
      lib: packageConfig.lib,
      rollupOptions: {
        ...sharedBuildOptions.rollupOptions,
        external: packageExternalPredicate(manifest, packageConfig)
      }
    },
    resolve: { alias: sourceAliases }
  };
};
