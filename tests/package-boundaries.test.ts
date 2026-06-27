import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Canvas, createRoot as createRoyalRoot } from '@royal/react';
import { createRoot as createRoyalSubpathRoot } from '@royal/react/root';
import { jsx as royalJsx } from '@royal/react/jsx-runtime';
import { jsx as reactReglCompatJsx } from 'react-regl-fiber/jsx-runtime';
import { jsx as reactRoyalCompatJsx } from 'react-royal-fiber/jsx-runtime';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

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

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoots = ['apps', 'packages'] as const;
const sourceExtensions = new Set(['.ts', '.tsx']);
const expectedPackages = [
  { name: '@royal/examples-react', root: 'apps/examples-react' },
  { name: 'react-regl-fiber', root: 'packages/react-regl-fiber-compat' },
  { name: '@royal/react', root: 'packages/react-royal-fiber' },
  { name: 'react-royal-fiber', root: 'packages/react-royal-fiber-compat' },
  { name: '@royal/renderer-core', root: 'packages/renderer-core' },
  { name: '@royal/tarstate-lens', root: 'packages/royal-tarstate-lens' },
  { name: '@tarstate/core', root: 'packages/tarstate-core' }
] as const;

function readManifest(manifestPath: string): PackageManifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest;
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

function listSourceFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    return sourceExtensions.has(path.extname(entry.name)) ? [entryPath] : [];
  });
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

function declaredPackages(manifest: PackageManifest, options: { readonly allowDevDependencies: boolean }): Set<string> {
  const sections = [manifest.dependencies, manifest.optionalDependencies, manifest.peerDependencies, options.allowDevDependencies ? manifest.devDependencies : undefined];
  return new Set([manifest.name, ...sections.flatMap((section) => Object.keys(section ?? {}))].filter((name) => name !== undefined));
}

describe('package boundaries', () => {
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
      type: 'module'
    })));
  });

  it('keeps @royal/react as the implementation and compat packages as wrappers', () => {
    const reactManifest = readManifest(path.join(repoRoot, 'packages/react-royal-fiber/package.json'));
    const reglCompat = readManifest(path.join(repoRoot, 'packages/react-regl-fiber-compat/package.json'));
    const royalCompat = readManifest(path.join(repoRoot, 'packages/react-royal-fiber-compat/package.json'));

    expect(reactManifest.dependencies?.['@royal/renderer-core']).toBe('workspace:*');
    expect(reactManifest.dependencies?.['react-regl-fiber']).toBeUndefined();
    expect(reglCompat.dependencies?.['@royal/react']).toBe('workspace:*');
    expect(royalCompat.dependencies?.['@royal/react']).toBe('workspace:*');
    expect(typeof Canvas).toBe('function');
    expect(createRoyalRoot).toBe(createRoyalSubpathRoot);
    expect(reactReglCompatJsx).toBe(royalJsx);
    expect(reactRoyalCompatJsx).toBe(royalJsx);
  });

  it('keeps @royal/tarstate-lens v1 behind an explicit public subpath', () => {
    const manifest = readManifest(path.join(repoRoot, 'packages/royal-tarstate-lens/package.json'));
    expect(manifest.dependencies?.['@tarstate/core']).toBe('workspace:*');
    expect(manifest.dependencies?.['@patchpit/tarstate']).toBeUndefined();
    expect(manifest.exports).toMatchObject({ '.': './src/index.ts', './v1': './src/v1.ts' });
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
