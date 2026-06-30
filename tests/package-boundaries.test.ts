import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Canvas, createRoot as createRoyalRoot } from '@royal/react';
import { jsx as royalJsx } from '@royal/react/jsx-runtime';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { buildConfigsByPackageName, sourceAliases } from '../vite.config';

type PackageManifest = {
  readonly name?: string;
  readonly private?: boolean;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly license?: string;
  readonly optionalDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly peerDependenciesMeta?: Record<string, { readonly optional?: boolean }>;
  readonly type?: string;
  readonly exports?: Record<string, unknown>;
};

type TsConfig = {
  readonly compilerOptions?: {
    readonly paths?: Record<string, readonly string[]>;
  };
};

type PackageSourceExport = {
  readonly exportKey: string;
  readonly packageName: string;
  readonly sourcePath: string;
  readonly specifier: string;
};

type TemporaryTestingLabExport = {
  readonly exportKey: string;
  readonly packageName: string;
  readonly rationale: string;
  readonly removalOwner: string;
  readonly sourcePath: string;
};

type ClassifiedPackageExport = {
  readonly classification: 'diagnostic' | 'prototype';
  readonly exportKey: string;
  readonly packageName: string;
  readonly rationale: string;
  readonly sourcePath: string;
};

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoots = ['apps', 'packages'] as const;
const boundarySourceRoots = ['apps', 'packages', 'tests'] as const;
const examplesReactSourceRoot = 'apps/examples-react/src';
const examplesReactExampleSourceRoot = 'apps/examples-react/src/examples';
const sourceExtensions = new Set(['.ts', '.tsx']);
const generatedSourceDirectories = new Set(['dist', 'node_modules']);
const rendererPackageRoots = ['packages/renderer-core', 'packages/renderer-webgl', 'packages/renderer-webgpu', 'packages/react'] as const;
const tarstateControlPlanePackageNames = new Set(['@tarstate/core', '@royal/tarstate-lens']);
const tarstateControlPlanePackageRoots = ['packages/royal-tarstate-lens'] as const;
const artifactDisplaySourceFiles = new Set(['apps/examples-react/src/ResearchArtifacts.tsx']);
const artifactReferenceLinePattern = /apps\/examples-react\/public\/artifacts|['"`(]\s*\/?artifacts\/[^'"`\s)]/;
const rendererTestingSubpathPattern = /^@royal\/renderer-[a-z0-9-]+(?:\/.*)?\/testing(?:\/.*)?$/;
const expectedPackages = [
  { name: '@royal/examples-react', root: 'apps/examples-react', type: 'module' },
  { name: '@royal/expo-hello', root: 'apps/expo-hello', type: undefined },
  { name: '@royal/react', root: 'packages/react', type: 'module' },
  { name: '@royal/renderer-core', root: 'packages/renderer-core', type: 'module' },
  { name: '@royal/renderer-webgl', root: 'packages/renderer-webgl', type: 'module' },
  { name: '@royal/renderer-webgpu', root: 'packages/renderer-webgpu', type: 'module' },
  { name: '@royal/tarstate-lens', root: 'packages/royal-tarstate-lens', type: 'module' }
] as const;
const temporaryTestingLabExports = [
  {
    exportKey: './testing',
    packageName: '@royal/react',
    rationale: 'Keeps renderer capability lab helpers reachable while diagnostics settle on stable package subpaths.',
    removalOwner: 'renderer platform',
    sourcePath: './src/testing.ts'
  },
  {
    exportKey: './virtual-texturing/testing',
    packageName: '@royal/renderer-webgl',
    rationale: 'Keeps low-level virtual-texturing mechanics reachable for lab examples and migration tests.',
    removalOwner: 'virtual texturing',
    sourcePath: './src/virtual-texture-testing.ts'
  }
] as const satisfies readonly TemporaryTestingLabExport[];
const webGpuProbeExportClassifications = [
  {
    classification: 'diagnostic',
    exportKey: './capabilities',
    packageName: '@royal/renderer-webgpu',
    rationale: 'Backend selection and capability probes are diagnostic signals, not renderer runtime primitives.',
    sourcePath: './src/capabilities.ts'
  },
  {
    classification: 'prototype',
    exportKey: './render-probe',
    packageName: '@royal/renderer-webgpu',
    rationale: 'The triangle renderer is a WebGPU bring-up probe for validating backend viability.',
    sourcePath: './src/render-probe.ts'
  },
  {
    classification: 'prototype',
    exportKey: './scene-probe',
    packageName: '@royal/renderer-webgpu',
    rationale: 'The scene probe describes proposed WebGPU lowering shape before a committed runtime exists.',
    sourcePath: './src/scene-probe.ts'
  }
] as const satisfies readonly ClassifiedPackageExport[];

function readManifest(manifestPath: string): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
}

function trackedGeneratedDistFiles(): readonly string[] {
  return execFileSync('git', ['ls-files', 'apps/*/dist/**', 'packages/*/dist/**'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function workspacePackageManifests(): readonly { readonly root: string; readonly manifest: PackageManifest }[] {
  return workspaceRoots.flatMap((workspaceRoot) => {
    const absoluteRoot = path.join(repoRoot, workspaceRoot);
    if (!existsSync(absoluteRoot)) return [];

    return readdirSync(absoluteRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => existsSync(path.join(absoluteRoot, entry.name, 'package.json')))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => {
        const packageRoot = path.join(absoluteRoot, entry.name);
        return { root: path.relative(repoRoot, packageRoot), manifest: readManifest(path.join(packageRoot, 'package.json')) };
      });
  });
}

function readRootTsConfig(): TsConfig {
  return JSON.parse(readFileSync(path.join(repoRoot, 'tsconfig.json'), 'utf8')) as TsConfig;
}

function listSourceFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      return generatedSourceDirectories.has(entry.name) ? [] : listSourceFiles(entryPath);
    }
    return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

function listSourceFilesUnderRoots(roots: readonly string[]): readonly string[] {
  return roots.flatMap((root) => {
    const absoluteRoot = path.join(repoRoot, root);
    return existsSync(absoluteRoot) ? listSourceFiles(absoluteRoot) : [];
  });
}

function toRepoPath(filePath: string): string {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  return path.relative(repoRoot, absolutePath).split(path.sep).join('/');
}

function isTestSourceFile(filePath: string): boolean {
  return /\.test\.tsx?$/.test(filePath);
}

function listImplementationSourceFilesUnderRoot(root: string): readonly string[] {
  const absoluteRoot = path.join(repoRoot, root);
  return existsSync(absoluteRoot)
    ? listSourceFiles(absoluteRoot).filter((filePath) => !isTestSourceFile(filePath)).sort()
    : [];
}

function packageExportSpecifier(packageName: string, exportKey: string): string {
  return exportKey === '.' ? packageName : packageName + exportKey.slice(1);
}

function packageSourceExports(packageNames: ReadonlySet<string>): readonly PackageSourceExport[] {
  return workspacePackageManifests()
    .flatMap(({ manifest, root }) => {
      const packageName = manifest.name;
      if (packageName === undefined || !packageNames.has(packageName)) return [];

      return Object.entries(manifest.exports ?? {}).flatMap(([exportKey, exportTarget]) =>
        typeof exportTarget === 'string'
          ? [{
            exportKey,
            packageName,
            sourcePath: toRepoPath(path.join(root, exportTarget)),
            specifier: packageExportSpecifier(packageName, exportKey)
          }]
          : []
      );
    })
    .sort((left, right) => left.specifier.localeCompare(right.specifier));
}

function packageBuildEntrySourcePaths(packageRoot: string, entry: string | Record<string, string>): readonly string[] {
  const entryPaths = typeof entry === 'string' ? [entry] : Object.values(entry);
  return entryPaths.map((entryPath) => toRepoPath(path.join(packageRoot, entryPath))).sort();
}

function collectModuleSpecifiers(filePath: string): readonly string[] {
  const sourceFile = ts.createSourceFile(filePath, readFileSync(filePath, 'utf8'), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument !== undefined && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

function externalPackageName(moduleSpecifier: string): string | undefined {
  if (moduleSpecifier.startsWith('.') || moduleSpecifier.startsWith('/') || moduleSpecifier.startsWith('node:')) return undefined;
  if (moduleSpecifier.startsWith('@')) {
    const [scope, name] = moduleSpecifier.split('/');
    return scope === undefined || name === undefined ? moduleSpecifier : scope + '/' + name;
  }
  return moduleSpecifier.split('/')[0];
}

function externalPackageImport(moduleSpecifier: string): { readonly packageName: string; readonly exportKey: string; readonly subpath: string } | undefined {
  const packageName = externalPackageName(moduleSpecifier);
  if (packageName === undefined) return undefined;
  const subpath = moduleSpecifier.slice(packageName.length);
  return { packageName, exportKey: subpath === '' ? '.' : '.' + subpath, subpath };
}

function hasPackageExport(manifest: PackageManifest, exportKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(manifest.exports ?? {}, exportKey);
}

function isTestingExportKey(exportKey: string): boolean {
  return exportKey.endsWith('/testing');
}

function stableManifestExports(manifest: PackageManifest): Record<string, unknown> {
  return Object.fromEntries(Object.entries(manifest.exports ?? {}).filter(([exportKey]) => !isTestingExportKey(exportKey)));
}

function isPackageSourcePathImport(moduleSpecifier: string): boolean {
  const externalImport = externalPackageImport(moduleSpecifier);
  return externalImport !== undefined && (externalImport.subpath === '/src' || externalImport.subpath.startsWith('/src/'));
}

function resolvedRelativeRepoPath(filePath: string, moduleSpecifier: string): string | undefined {
  if (!moduleSpecifier.startsWith('.')) return undefined;
  return toRepoPath(path.resolve(path.dirname(filePath), moduleSpecifier));
}

function isPathInside(parentPath: string, candidatePath: string): boolean {
  return candidatePath === parentPath || candidatePath.startsWith(parentPath + path.sep);
}

function relativeImportTargetSourcePackageRoot(filePath: string, moduleSpecifier: string, packageRoots: readonly string[]): string | undefined {
  if (!moduleSpecifier.startsWith('.')) return undefined;

  const resolvedPath = path.resolve(path.dirname(filePath), moduleSpecifier);
  return packageRoots.find((packageRoot) => isPathInside(path.join(repoRoot, packageRoot, 'src'), resolvedPath));
}

function isFileInPackageSource(filePath: string, packageRoot: string): boolean {
  return isPathInside(path.join(repoRoot, packageRoot, 'src'), filePath);
}

function resolvedRelativePackageRoot(filePath: string, moduleSpecifier: string): string | undefined {
  if (!moduleSpecifier.startsWith('.')) return undefined;

  const resolvedPath = path.resolve(path.dirname(filePath), moduleSpecifier);
  return tarstateControlPlanePackageRoots.find((packageRoot) => {
    const absolutePackageRoot = path.join(repoRoot, packageRoot);
    return resolvedPath === absolutePackageRoot || resolvedPath.startsWith(absolutePackageRoot + path.sep);
  });
}

function declaredPackages(manifest: PackageManifest, options: { readonly allowDevDependencies: boolean }): Set<string> {
  const sections = [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies, options.allowDevDependencies ? manifest.devDependencies : undefined];
  return new Set([manifest.name, ...sections.flatMap((section) => Object.keys(section ?? {}))].filter((name) => name !== undefined));
}

function manifestDependencyEntries(manifest: PackageManifest): readonly { readonly section: string; readonly packageName: string }[] {
  const sections: readonly [string, Record<string, string> | undefined][] = [
    ['dependencies', manifest.dependencies],
    ['optionalDependencies', manifest.optionalDependencies],
    ['peerDependencies', manifest.peerDependencies],
    ['devDependencies', manifest.devDependencies]
  ];
  return sections.flatMap(([section, dependencies]) => Object.keys(dependencies ?? {}).map((packageName) => ({ section, packageName })));
}

function sourceLinesMatching(filePath: string, pattern: RegExp): readonly { readonly line: number; readonly text: string }[] {
  return readFileSync(filePath, 'utf8').split('\n').flatMap((lineText, index) =>
    pattern.test(lineText)
      ? [{ line: index + 1, text: lineText.trim() }]
      : []
  );
}

function isResearchFixtureSpecifier(filePath: string, moduleSpecifier: string): boolean {
  const candidates = [moduleSpecifier, resolvedRelativeRepoPath(filePath, moduleSpecifier)]
    .filter((candidate): candidate is string => candidate !== undefined)
    .map((candidate) => candidate.split(path.sep).join('/'));

  return candidates.some((candidate) => /(?:^|\/)research\/.*\/fixtures(?:\/|$)/.test(candidate));
}

function isPublicArtifactSpecifier(filePath: string, moduleSpecifier: string): boolean {
  const candidates = [moduleSpecifier, resolvedRelativeRepoPath(filePath, moduleSpecifier)]
    .filter((candidate): candidate is string => candidate !== undefined)
    .map((candidate) => candidate.split(path.sep).join('/'));

  return candidates.some(
    (candidate) =>
      candidate === 'apps/examples-react/public/artifacts' ||
      candidate.startsWith('apps/examples-react/public/artifacts/') ||
      candidate.startsWith('/artifacts/') ||
      candidate.startsWith('artifacts/'),
  );
}

function examplesResearchBoundaryImportReason(filePath: string, moduleSpecifier: string): string | undefined {
  if (moduleSpecifier === '@royal/renderer-webgpu' || moduleSpecifier.startsWith('@royal/renderer-webgpu/')) {
    return 'renderer WebGPU package';
  }
  if (rendererTestingSubpathPattern.test(moduleSpecifier)) return 'renderer testing subpath';
  if (isResearchFixtureSpecifier(filePath, moduleSpecifier)) return 'research fixture path';
  if (isPublicArtifactSpecifier(filePath, moduleSpecifier)) return 'public artifact path';
  return undefined;
}

describe('package boundaries', () => {
  it('keeps generated dist trees out of tracked workspace files', () => {
    expect(trackedGeneratedDistFiles()).toEqual([]);
  });

  it('keeps the clean Royal workspace shape explicit', () => {
    expect(workspacePackageManifests().map(({ manifest, root }) => ({
      license: manifest.license,
      name: manifest.name,
      private: manifest.private,
      root,
      type: manifest.type
    }))).toEqual(expectedPackages.map((entry) => ({
      license: 'AGPL-3.0-only',
      name: entry.name,
      private: true,
      root: entry.root,
      type: entry.type
    })));
  });

  it('keeps @royal/react as the React adapter package', () => {
    const reactManifest = readManifest(path.join(repoRoot, 'packages/react/package.json'));
    const webglManifest = readManifest(path.join(repoRoot, 'packages/renderer-webgl/package.json'));

    expect(reactManifest.dependencies?.['@royal/renderer-core']).toBe('workspace:*');
    expect(reactManifest.dependencies?.['@royal/renderer-webgl']).toBe('workspace:*');
    expect(reactManifest.dependencies?.['gl-matrix']).toBeUndefined();
    expect(stableManifestExports(reactManifest)).toEqual({
      '.': './src/index.ts',
      './jsx-dev-runtime': './src/jsx-dev-runtime.ts',
      './jsx-runtime': './src/jsx-runtime.ts'
    });
    expect(webglManifest.dependencies?.['@royal/renderer-core']).toBe('workspace:*');
    expect(webglManifest.dependencies?.['gl-matrix']).toBe('^3.4.4');
    expect(stableManifestExports(webglManifest)).toEqual({
      '.': './src/index.ts',
      './capabilities': './src/capabilities.ts',
      './virtual-texturing': './src/virtual-texturing.ts'
    });
    expect(typeof Canvas).toBe('function');
    expect(createRoyalRoot).toBeTypeOf('function');
    expect(royalJsx).toBeTypeOf('function');
  });

  it('keeps renderer-core text and SVG lowering helpers on explicit subpaths', () => {
    const manifest = readManifest(path.join(repoRoot, 'packages/renderer-core/package.json'));

    expect(stableManifestExports(manifest)).toEqual({
      '.': './src/index.ts',
      './svg': './src/svg-index.ts',
      './text': './src/text-index.ts'
    });
  });

  it('allows testing/lab exports only through the temporary testing allowlist', () => {
    const manifestsByName = new Map(workspacePackageManifests().flatMap(({ manifest, root }) =>
      manifest.name === undefined ? [] : [[manifest.name, { manifest, root }] as const]
    ));
    const actualTestingExports = workspacePackageManifests()
      .flatMap(({ manifest }) => {
        const packageName = manifest.name;
        if (packageName === undefined) return [];

        return Object.entries(manifest.exports ?? {})
          .filter(([exportKey]) => isTestingExportKey(exportKey))
          .map(([exportKey, sourcePath]) => ({ exportKey, packageName, sourcePath }));
      })
      .sort((left, right) => `${left.packageName}${left.exportKey}`.localeCompare(`${right.packageName}${right.exportKey}`));
    const expectedTestingExports = temporaryTestingLabExports
      .map(({ exportKey, packageName, sourcePath }) => ({ exportKey, packageName, sourcePath }))
      .sort((left, right) => `${left.packageName}${left.exportKey}`.localeCompare(`${right.packageName}${right.exportKey}`));
    const metadataViolations = temporaryTestingLabExports.flatMap((entry) => [
      ...(isTestingExportKey(entry.exportKey) ? [] : [{ ...entry, reason: 'export key must end in /testing' }]),
      ...(entry.rationale.trim().length > 0 ? [] : [{ ...entry, reason: 'rationale required' }]),
      ...(entry.removalOwner.trim().length > 0 ? [] : [{ ...entry, reason: 'removal owner required' }])
    ]);
    const missingAllowlistedExports = temporaryTestingLabExports.flatMap((entry) => {
      const manifest = manifestsByName.get(entry.packageName)?.manifest;
      const actualSourcePath = manifest?.exports?.[entry.exportKey];
      return actualSourcePath === entry.sourcePath
        ? []
        : [{ ...entry, actualSourcePath }];
    });

    expect(actualTestingExports).toEqual(expectedTestingExports);
    expect(metadataViolations).toEqual([]);
    expect(missingAllowlistedExports).toEqual([]);
  });

  it('classifies WebGPU probe exports as diagnostic or prototype surfaces', () => {
    const manifestsByName = new Map(workspacePackageManifests().flatMap(({ manifest }) =>
      manifest.name === undefined ? [] : [[manifest.name, manifest] as const]
    ));
    const missingClassifiedExports = webGpuProbeExportClassifications.flatMap((entry) => {
      const actualSourcePath = manifestsByName.get(entry.packageName)?.exports?.[entry.exportKey];
      return actualSourcePath === entry.sourcePath
        ? []
        : [{ ...entry, actualSourcePath }];
    });
    const metadataViolations = webGpuProbeExportClassifications.flatMap((entry) =>
      entry.rationale.trim().length > 0 ? [] : [{ ...entry, reason: 'rationale required' }]
    );

    expect(webGpuProbeExportClassifications.map(({ classification, exportKey, packageName }) => ({
      classification,
      exportKey,
      packageName
    }))).toEqual([
      { classification: 'diagnostic', exportKey: './capabilities', packageName: '@royal/renderer-webgpu' },
      { classification: 'prototype', exportKey: './render-probe', packageName: '@royal/renderer-webgpu' },
      { classification: 'prototype', exportKey: './scene-probe', packageName: '@royal/renderer-webgpu' }
    ]);
    expect(missingClassifiedExports).toEqual([]);
    expect(metadataViolations).toEqual([]);
  });

  it('keeps shared Vite package exports covered by TS paths, aliases, and build entries', () => {
    const sharedPackageNames = new Set(Object.keys(buildConfigsByPackageName));
    const packageRootByName = new Map(workspacePackageManifests().flatMap(({ manifest, root }) =>
      manifest.name === undefined ? [] : [[manifest.name, root] as const]
    ));
    const exportedSources = packageSourceExports(sharedPackageNames);
    const tsPaths = readRootTsConfig().compilerOptions?.paths ?? {};
    const aliasTargetBySpecifier = new Map(sourceAliases.map(({ find, replacement }) => [find, toRepoPath(replacement)] as const));
    const pathViolations = exportedSources.flatMap((exportedSource) => {
      const actualTargets = (tsPaths[exportedSource.specifier] ?? []).map(toRepoPath).sort();
      return actualTargets.includes(exportedSource.sourcePath)
        ? []
        : [{ specifier: exportedSource.specifier, expected: exportedSource.sourcePath, actual: actualTargets }];
    });
    const aliasViolations = exportedSources.flatMap((exportedSource) => {
      const actualTarget = aliasTargetBySpecifier.get(exportedSource.specifier);
      return actualTarget === exportedSource.sourcePath
        ? []
        : [{ specifier: exportedSource.specifier, expected: exportedSource.sourcePath, actual: actualTarget }];
    });
    const buildEntryViolations = Array.from(sharedPackageNames).sort().flatMap((packageName) => {
      const packageRoot = packageRootByName.get(packageName);
      const buildConfig = buildConfigsByPackageName[packageName];
      if (packageRoot === undefined || buildConfig === undefined) {
        return [{
          packageName,
          specifier: packageName,
          expected: 'shared package root and build config',
          actual: [] as readonly string[]
        }];
      }

      const buildEntrySources = packageBuildEntrySourcePaths(packageRoot, buildConfig.lib.entry);
      return exportedSources
        .filter((exportedSource) => exportedSource.packageName === packageName)
        .flatMap((exportedSource) =>
          buildEntrySources.includes(exportedSource.sourcePath)
            ? []
            : [{
                packageName,
                specifier: exportedSource.specifier,
                expected: exportedSource.sourcePath,
                actual: buildEntrySources
              }]
        );
    });

    expect({ aliasViolations, buildEntryViolations, pathViolations }).toEqual({
      aliasViolations: [],
      buildEntryViolations: [],
      pathViolations: []
    });
  });

  it('keeps examples research-only imports out of primary examples', () => {
    const researchBoundaryImports = listImplementationSourceFilesUnderRoot(examplesReactExampleSourceRoot)
      .flatMap((filePath) =>
        collectModuleSpecifiers(filePath).flatMap((specifier) => {
          const reason = examplesResearchBoundaryImportReason(filePath, specifier);
          return reason === undefined
            ? []
            : [{ file: toRepoPath(filePath), reason, specifier }];
        })
      );

    expect(researchBoundaryImports).toEqual([]);
  });

  it('keeps public artifact URLs isolated to the research artifact display source', () => {
    const artifactReferenceHits = listImplementationSourceFilesUnderRoot(examplesReactSourceRoot)
      .flatMap((filePath) =>
        sourceLinesMatching(filePath, artifactReferenceLinePattern).map(({ line, text }) => ({
          file: toRepoPath(filePath),
          line,
          text
        }))
      );
    const violations = artifactReferenceHits.filter(
      ({ file }) => !artifactDisplaySourceFiles.has(file),
    );

    expect(violations).toEqual([]);
    expect(new Set(artifactReferenceHits.map(({ file }) => file))).toEqual(artifactDisplaySourceFiles);
  });

  it('keeps @royal/tarstate-lens root export on the v1 facade', () => {
    const manifest = readManifest(path.join(repoRoot, 'packages/royal-tarstate-lens/package.json'));
    expect(manifest.dependencies?.['@tarstate/core']).toBe(
      'github:neftaly/tarstate#9b664a8421ffbd18c94a2766a25b3581a4129c33&path:/packages/core'
    );
    expect(manifest.dependencies?.['@patchpit/tarstate']).toBeUndefined();
    expect(manifest.exports).toMatchObject({ '.': './src/v1.ts', './v1': './src/v1.ts' });
  });

  it('keeps Tarstate API consumers on package exports instead of source paths', () => {
    const workspaceManifests = workspacePackageManifests();
    const packageRoots = workspaceManifests.map(({ root }) => root);
    const tarstateApiPackages = new Map(tarstateControlPlanePackageRoots.map((root) => {
      const manifest = readManifest(path.join(repoRoot, root, 'package.json'));
      return [manifest.name, { manifest, root }] as const;
    }));
    const tarstateApiRoots = new Set<string>(tarstateControlPlanePackageRoots);
    const violations = listSourceFilesUnderRoots(boundarySourceRoots)
      .flatMap((filePath) =>
        collectModuleSpecifiers(filePath).flatMap((specifier) => {
          const packageImport = externalPackageImport(specifier);
          if (packageImport !== undefined) {
            const apiPackage = tarstateApiPackages.get(packageImport.packageName);
            if (apiPackage !== undefined && !hasPackageExport(apiPackage.manifest, packageImport.exportKey)) {
              return [{ file: path.relative(repoRoot, filePath), specifier, reason: 'not in package exports' }];
            }
            if (tarstateControlPlanePackageNames.has(packageImport.packageName) && isPackageSourcePathImport(specifier)) {
              return [{ file: path.relative(repoRoot, filePath), specifier, reason: 'package source path' }];
            }
          }

          const targetPackageRoot = relativeImportTargetSourcePackageRoot(filePath, specifier, packageRoots);
          if (
            targetPackageRoot !== undefined &&
            tarstateApiRoots.has(targetPackageRoot) &&
            !isFileInPackageSource(filePath, targetPackageRoot)
          ) {
            return [{ file: path.relative(repoRoot, filePath), specifier, reason: 'relative package source path' }];
          }

          return [];
        })
      );

    expect(violations).toEqual([]);
  });

  it('keeps renderer packages independent from Tarstate control-plane packages', () => {
    const dependencyViolations = rendererPackageRoots.flatMap((root) => {
      const manifest = readManifest(path.join(repoRoot, root, 'package.json'));
      return manifestDependencyEntries(manifest)
        .filter(({ packageName }) => tarstateControlPlanePackageNames.has(packageName) || packageName.includes('tarstate'))
        .map(({ packageName, section }) => ({ root, section, packageName }));
    });
    const violations = rendererPackageRoots.flatMap((root) =>
      listSourceFiles(path.join(repoRoot, root)).flatMap((filePath) =>
        collectModuleSpecifiers(filePath)
          .filter((specifier) => {
            const packageName = externalPackageName(specifier);
            return packageName === undefined
              ? resolvedRelativePackageRoot(filePath, specifier) !== undefined
              : tarstateControlPlanePackageNames.has(packageName) || packageName.includes('tarstate');
          })
          .map((specifier) => ({ root, file: path.relative(repoRoot, filePath), specifier }))
      )
    );

    expect({ dependencyViolations, importViolations: violations }).toEqual({ dependencyViolations: [], importViolations: [] });
  });

  it('keeps reusable packages independent from apps', () => {
    const manifests = workspacePackageManifests();
    const appPackageNames = new Set(manifests.filter(({ root }) => root.startsWith('apps/')).map(({ manifest }) => manifest.name));
    const packageManifests = manifests.filter(({ root }) => root.startsWith('packages/'));

    expect(packageManifests.flatMap(({ manifest, root }) =>
      Object.keys(manifest.dependencies ?? {}).filter((dependencyName) => appPackageNames.has(dependencyName)).map((dependencyName) => ({ dependencyName, root }))
    )).toEqual([]);
  });

  it('keeps package imports declared by the owning package', () => {
    const violations = workspacePackageManifests().flatMap(({ manifest, root }) => {
      const declared = declaredPackages(manifest, { allowDevDependencies: true });
      return listSourceFiles(path.join(repoRoot, root)).flatMap((filePath) =>
        collectModuleSpecifiers(filePath)
          .map((specifier) => ({ packageName: externalPackageName(specifier), specifier }))
          .filter((entry): entry is { readonly packageName: string; readonly specifier: string } => entry.packageName !== undefined)
          .filter(({ packageName }) => !declared.has(packageName))
          .map(({ specifier }) => ({ root, file: path.relative(repoRoot, filePath), specifier }))
      );
    });

    expect(violations).toEqual([]);
  });
});
