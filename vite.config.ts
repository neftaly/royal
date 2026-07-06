import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
        text: 'src/text/index.ts',
        'text/editable': 'src/text/editable/index.ts',
        'text/font': 'src/text/font.ts',
        'text/layout': 'src/text/layout.ts',
        'text/mesh': 'src/text/mesh.ts',
        'text/node': 'src/text/node.ts',
        'text/shaping': 'src/text/shaping.ts',
        'text/types': 'src/text/types.ts'
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
        capabilities: 'src/capabilities.ts',
        webxr: 'src/webxr.ts'
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
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-reconciler',
      'react-reconciler/constants.js'
    ],
    lib: {
      entry: {
        index: 'src/index.ts',
        scene: 'src/scene.ts',
        xr: 'src/xr.ts',
        'jsx-dev-runtime': 'src/jsx-dev-runtime.ts',
        'jsx-runtime': 'src/jsx-runtime.ts',
        'renderer-jsx-dev-runtime': 'src/renderer-jsx-dev-runtime.ts',
        'renderer-jsx-runtime': 'src/renderer-jsx-runtime.ts'
      },
      formats: ['es'],
      fileName: (_format, entryName) => entryName + '.js'
    }
  }
};

const appPackageNames = new Set(['@royal/examples-react']);
const reactAppPackageNames = new Set(['@royal/examples-react']);
const fixtureAppPackageNames = new Set(['@royal/examples-react']);
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as PackageManifest;
const packageConfig = manifest.name ? buildConfigsByPackageName[manifest.name] : undefined;
const isAppPackage = manifest.name === undefined ? false : appPackageNames.has(manifest.name);
const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const appBase = process.env.BASE_PATH ?? '/';
export const sourceAliases = [
  { find: '@royal/renderer-webgl/capabilities', replacement: path.join(repoRoot, 'packages/renderer-webgl/src/capabilities.ts') },
  { find: '@royal/renderer-webgl/webxr', replacement: path.join(repoRoot, 'packages/renderer-webgl/src/webxr.ts') },
  { find: '@royal/renderer-webgl', replacement: path.join(repoRoot, 'packages/renderer-webgl/src/index.ts') },
  { find: '@royal/renderer-core/render-object', replacement: path.join(repoRoot, 'packages/renderer-core/src/render-object.ts') },
  { find: '@royal/renderer-core/text/editable', replacement: path.join(repoRoot, 'packages/renderer-core/src/text/editable/index.ts') },
  { find: '@royal/renderer-core/text/font', replacement: path.join(repoRoot, 'packages/renderer-core/src/text/font.ts') },
  { find: '@royal/renderer-core/text/layout', replacement: path.join(repoRoot, 'packages/renderer-core/src/text/layout.ts') },
  { find: '@royal/renderer-core/text/mesh', replacement: path.join(repoRoot, 'packages/renderer-core/src/text/mesh.ts') },
  { find: '@royal/renderer-core/text/node', replacement: path.join(repoRoot, 'packages/renderer-core/src/text/node.ts') },
  { find: '@royal/renderer-core/text/shaping', replacement: path.join(repoRoot, 'packages/renderer-core/src/text/shaping.ts') },
  { find: '@royal/renderer-core/text/types', replacement: path.join(repoRoot, 'packages/renderer-core/src/text/types.ts') },
  { find: '@royal/renderer-core/text', replacement: path.join(repoRoot, 'packages/renderer-core/src/text/index.ts') },
  { find: '@royal/react/jsx-dev-runtime', replacement: path.join(repoRoot, 'packages/react/src/jsx-dev-runtime.ts') },
  { find: '@royal/react/jsx-runtime', replacement: path.join(repoRoot, 'packages/react/src/jsx-runtime.ts') },
  { find: '@royal/react/renderer/jsx-dev-runtime', replacement: path.join(repoRoot, 'packages/react/src/renderer-jsx-dev-runtime.ts') },
  { find: '@royal/react/renderer/jsx-runtime', replacement: path.join(repoRoot, 'packages/react/src/renderer-jsx-runtime.ts') },
  { find: '@royal/react/scene', replacement: path.join(repoRoot, 'packages/react/src/scene.ts') },
  { find: '@royal/react/xr', replacement: path.join(repoRoot, 'packages/react/src/xr.ts') },
  { find: '@royal/react', replacement: path.join(repoRoot, 'packages/react/src/index.ts') },
  { find: '@royal/renderer-core', replacement: path.join(repoRoot, 'packages/renderer-core/src/index.ts') }
];

const failOnRollupWarning = (warning: string | { readonly message?: string }): never => {
  const message = typeof warning === 'string' ? warning : warning.message ?? JSON.stringify(warning);
  throw new Error('Rollup warning treated as error: ' + message);
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
      rollupOptions: {
        ...sharedBuildOptions.rollupOptions,
        external: packageExternalPredicate(manifest, packageConfig)
      }
    },
    resolve: { alias: sourceAliases }
  };
};
