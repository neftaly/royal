import { readFileSync } from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import glsl from 'vite-plugin-glsl';

type PackageConfig = {
  readonly external?: readonly string[];
  readonly lib: {
    readonly entry: string | Record<string, string>;
    readonly formats: readonly ['es'];
    readonly fileName: string | ((_format: string, entryName: string) => string);
  };
};

const buildConfigsByPackageName: Record<string, PackageConfig> = {
  '@royal/renderer-core': {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' }
  },
  '@royal/react': {
    external: ['@royal/renderer-core', 'react'],
    lib: {
      entry: { index: 'src/index.ts', root: 'src/root.ts', 'jsx-dev-runtime': 'src/jsx-dev-runtime.ts', 'jsx-runtime': 'src/jsx-runtime.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => entryName + '.js'
    }
  },
  'react-regl-fiber': {
    external: ['@royal/react', '@royal/react/root', '@royal/react/jsx-dev-runtime', '@royal/react/jsx-runtime'],
    lib: {
      entry: { index: 'src/index.ts', root: 'src/root.ts', 'jsx-dev-runtime': 'src/jsx-dev-runtime.ts', 'jsx-runtime': 'src/jsx-runtime.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => entryName + '.js'
    }
  },
  'react-royal-fiber': {
    external: ['@royal/react', '@royal/react/root', '@royal/react/jsx-dev-runtime', '@royal/react/jsx-runtime'],
    lib: {
      entry: { index: 'src/index.ts', root: 'src/root.ts', 'jsx-dev-runtime': 'src/jsx-dev-runtime.ts', 'jsx-runtime': 'src/jsx-runtime.ts' },
      formats: ['es'],
      fileName: (_format, entryName) => entryName + '.js'
    }
  }
};

const appPackageNames = new Set(['@royal/examples-react']);
const reactAppPackageNames = new Set(['@royal/examples-react']);
const fixtureAppPackageNames = new Set(['@royal/examples-react']);
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { readonly name?: string };
const packageConfig = manifest.name ? buildConfigsByPackageName[manifest.name] : undefined;
const isAppPackage = manifest.name === undefined ? false : appPackageNames.has(manifest.name);
const repoRoot = path.dirname(new URL(import.meta.url).pathname);
const appBase = process.env.BASE_PATH ?? '/';
const sourceAliases = [
  { find: '@tarstate/core', replacement: path.join(repoRoot, 'packages/tarstate-core/src/index.ts') },
  { find: '@royal/react/root', replacement: path.join(repoRoot, 'packages/react-royal-fiber/src/root.ts') },
  { find: '@royal/react/jsx-dev-runtime', replacement: path.join(repoRoot, 'packages/react-royal-fiber/src/jsx-dev-runtime.ts') },
  { find: '@royal/react/jsx-runtime', replacement: path.join(repoRoot, 'packages/react-royal-fiber/src/jsx-runtime.ts') },
  { find: '@royal/react', replacement: path.join(repoRoot, 'packages/react-royal-fiber/src/index.ts') },
  { find: 'react-regl-fiber/root', replacement: path.join(repoRoot, 'packages/react-regl-fiber-compat/src/root.ts') },
  { find: 'react-regl-fiber/jsx-dev-runtime', replacement: path.join(repoRoot, 'packages/react-regl-fiber-compat/src/jsx-dev-runtime.ts') },
  { find: 'react-regl-fiber/jsx-runtime', replacement: path.join(repoRoot, 'packages/react-regl-fiber-compat/src/jsx-runtime.ts') },
  { find: 'react-regl-fiber', replacement: path.join(repoRoot, 'packages/react-regl-fiber-compat/src/index.ts') },
  { find: 'react-royal-fiber/root', replacement: path.join(repoRoot, 'packages/react-royal-fiber-compat/src/root.ts') },
  { find: 'react-royal-fiber/jsx-dev-runtime', replacement: path.join(repoRoot, 'packages/react-royal-fiber-compat/src/jsx-dev-runtime.ts') },
  { find: 'react-royal-fiber/jsx-runtime', replacement: path.join(repoRoot, 'packages/react-royal-fiber-compat/src/jsx-runtime.ts') },
  { find: 'react-royal-fiber', replacement: path.join(repoRoot, 'packages/react-royal-fiber-compat/src/index.ts') },
  { find: '@royal/renderer-core', replacement: path.join(repoRoot, 'packages/renderer-core/src/index.ts') },
  { find: '@royal/tarstate-lens/v1', replacement: path.join(repoRoot, 'packages/royal-tarstate-lens/src/v1.ts') },
  { find: '@royal/tarstate-lens', replacement: path.join(repoRoot, 'packages/royal-tarstate-lens/src/index.ts') }
];

const failOnRollupWarning = (warning: string | { readonly message?: string }): never => {
  const message = typeof warning === 'string' ? warning : warning.message ?? JSON.stringify(warning);
  throw new Error('Rollup warning treated as error: ' + message);
};

const sharedBuildOptions = { target: 'safari17', sourcemap: true, rollupOptions: { onwarn: failOnRollupWarning } };

export default ({ command, mode }: { readonly command: string; readonly mode: string }) => {
  const sharedPlugins = [glsl({ include: ['**/*.frag', '**/*.vert'], minify: mode === 'production' })];

  if (isAppPackage) {
    return {
      base: appBase,
      clearScreen: false,
      publicDir: fixtureAppPackageNames.has(manifest.name ?? '') ? path.join(repoRoot, 'fixtures') : undefined,
      plugins: [...(reactAppPackageNames.has(manifest.name ?? '') ? [react()] : []), ...sharedPlugins],
      resolve: { alias: sourceAliases },
      build: sharedBuildOptions
    };
  }

  if (packageConfig === undefined) {
    if (command !== 'build') return { clearScreen: false, plugins: sharedPlugins, resolve: { alias: sourceAliases } };
    throw new Error('No shared Vite config for package: ' + (manifest.name ?? '<unknown>'));
  }

  return {
    clearScreen: false,
    plugins: sharedPlugins,
    build: {
      ...sharedBuildOptions,
      lib: packageConfig.lib,
      rollupOptions: { ...sharedBuildOptions.rollupOptions, ...(packageConfig.external === undefined ? {} : { external: packageConfig.external }) }
    },
    resolve: { alias: sourceAliases }
  };
};
