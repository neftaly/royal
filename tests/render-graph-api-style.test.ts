import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const publicPackageJsonPaths = [
  'packages/react/package.json',
  'packages/renderer-core/package.json',
  'packages/renderer-webgl/package.json',
  'packages/royal-tarstate-lens/package.json'
] as const;
const testingOnlyPublicExportSpecifiers = new Set<string>();
const publicSourceExtensions = new Set(['.ts', '.tsx']);
const researchOnlyPublicExportNames = new Set([
  'customShaderMaterial',
  'shaderUniform',
  'shaderAttribute',
  'DynamicImpostorNode',
  'dynamicImpostor',
  'VirtualTextureNode',
  'VirtualTextureRuntime',
  'LOD',
  'Lod',
  'lod',
  'LODNode',
  'LodNode',
  'lodNode',
  'LevelOfDetailNode',
  'levelOfDetail',
  'dynamicLod',
  'lodLevel',
  'lodRange',
  'lodThreshold',
  'lodDistance',
  'lodPolicy',
  'lodBias',
  'lodBudget',
  'FormControl',
  'formControl',
  'input',
  'select',
  'textarea',
  'PageCache',
  'pageCache',
  'createPageCache',
  'PageTable',
  'pageTable',
  'createPageTable',
  'createVirtualTexturePageTableTexture',
  'uploadVirtualTexturePageTableTexels',
  'virtualTexturePageTableMipDimensions'
]);

type PublicSnippet = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

type PublicPackageEntryFile = {
  readonly file: string;
  readonly specifier: string;
};

type PublicExportSymbol = PublicSnippet & {
  readonly name: string;
  readonly specifier: string;
};

type PublicPackageJson = {
  readonly name?: string;
  readonly exports?: string | Readonly<Record<string, unknown>>;
};

function listConsumerPackageEntryFiles(): readonly PublicPackageEntryFile[] {
  return publicPackageJsonPaths.flatMap((packageJsonRelativePath) => {
    const packageJsonPath = path.join(repoRoot, packageJsonRelativePath);
    if (!existsSync(packageJsonPath)) return [];

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PublicPackageJson;
    const packageName = packageJson.name;
    if (typeof packageName !== 'string' || packageJson.exports === undefined) return [];

    const packageDir = path.dirname(packageJsonPath);
    const exportEntries = typeof packageJson.exports === 'string'
      ? [['.', packageJson.exports] as const]
      : Object.entries(packageJson.exports);

    return exportEntries.flatMap(([subpath, target]) => {
      const targetPath = packageExportTargetPath(target);
      const specifier = packageExportSpecifier(packageName, subpath);
      if (
        targetPath === null ||
        testingOnlyPublicExportSpecifiers.has(specifier)
      ) {
        return [];
      }

      const file = resolvePackageExportTargetPath(packageDir, targetPath);
      return file === null ? [] : [{ file, specifier }];
    });
  });
}

function packageExportSpecifier(packageName: string, subpath: string): string {
  return subpath === '.' ? packageName : `${packageName}/${subpath.replace(/^\.\//, '')}`;
}

function packageExportTargetPath(target: unknown): string | null {
  if (typeof target === 'string') return target;
  if (typeof target !== 'object' || target === null || Array.isArray(target)) return null;

  const record = target as Readonly<Record<string, unknown>>;
  return packageExportTargetPath(
    record.import ??
      record.default ??
      record.types ??
      Object.values(record)[0]
  );
}

function resolvePackageExportTargetPath(packageDir: string, targetPath: string): string | null {
  return resolveSourceFilePath(path.resolve(packageDir, targetPath));
}

function publicPackageExportSymbols(): readonly PublicExportSymbol[] {
  return listConsumerPackageEntryFiles().flatMap(({ file, specifier }) =>
    publicExportSymbolsFromFile(file, specifier)
  );
}

function publicExportSymbolsFromFile(
  filePath: string,
  specifier: string,
  seen = new Set<string>()
): readonly PublicExportSymbol[] {
  const resolvedPath = path.resolve(filePath);
  if (seen.has(resolvedPath) || !isFile(resolvedPath)) return [];
  seen.add(resolvedPath);

  const source = readFileSync(resolvedPath, 'utf8');
  const sourceFile = ts.createSourceFile(resolvedPath, source, ts.ScriptTarget.Latest, true);
  const lines = source.split('\n');
  const relativePath = path.relative(repoRoot, resolvedPath);
  const symbol = (name: string, node: ts.Node): PublicExportSymbol => {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    return {
      file: relativePath,
      line,
      name,
      specifier,
      text: lines[line - 1]?.trim() ?? name
    };
  };

  return sourceFile.statements.flatMap((statement) => {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause !== undefined) {
        if (ts.isNamedExports(statement.exportClause)) {
          return statement.exportClause.elements.map((element) => symbol(element.name.text, element.name));
        }

        return [symbol(statement.exportClause.name.text, statement.exportClause.name)];
      }

      const moduleSpecifier = stringLiteralText(statement.moduleSpecifier);
      const reexportPath = moduleSpecifier?.startsWith('.')
        ? resolveRelativeModulePath(resolvedPath, moduleSpecifier)
        : null;

      return reexportPath === null ? [] : publicExportSymbolsFromFile(reexportPath, specifier, seen);
    }

    if (!hasExportModifier(statement)) return [];

    if (
      ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement)
    ) {
      return statement.name === undefined ? [] : [symbol(statement.name.text, statement.name)];
    }

    if (ts.isModuleDeclaration(statement)) {
      return [
        ...(ts.isIdentifier(statement.name) ? [symbol(statement.name.text, statement.name)] : []),
        ...jsxIntrinsicElementSymbols(statement, sourceFile, lines, relativePath, specifier)
      ];
    }

    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.flatMap((declaration) =>
        ts.isIdentifier(declaration.name) ? [symbol(declaration.name.text, declaration.name)] : []
      );
    }

    return [];
  });
}

function jsxIntrinsicElementSymbols(
  statement: ts.ModuleDeclaration,
  sourceFile: ts.SourceFile,
  lines: readonly string[],
  relativePath: string,
  specifier: string
): readonly PublicExportSymbol[] {
  if (!ts.isIdentifier(statement.name) || statement.name.text !== 'JSX') return [];
  if (statement.body === undefined || !ts.isModuleBlock(statement.body)) return [];

  return statement.body.statements.flatMap((namespaceStatement) => {
    if (!ts.isInterfaceDeclaration(namespaceStatement) || namespaceStatement.name.text !== 'IntrinsicElements') {
      return [];
    }

    return namespaceStatement.members.flatMap((member) => {
      const memberNameNode = member.name;
      if (memberNameNode === undefined) return [];

      const memberName = propertyNameText(memberNameNode);
      if (memberName === null) return [];

      const line = sourceFile.getLineAndCharacterOfPosition(memberNameNode.getStart(sourceFile)).line + 1;
      return [{
        file: relativePath,
        line,
        name: `JSX.IntrinsicElements.${memberName}`,
        specifier,
        text: lines[line - 1]?.trim() ?? memberName
      }];
    });
  });
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword
  ) ?? false);
}

function stringLiteralText(node: ts.Node | undefined): string | null {
  return node !== undefined && ts.isStringLiteral(node) ? node.text : null;
}

function propertyNameText(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function resolveRelativeModulePath(fromFile: string, moduleSpecifier: string): string | null {
  const basePath = path.resolve(path.dirname(fromFile), moduleSpecifier);
  return resolveSourceFilePath(basePath);
}

function resolveSourceFilePath(basePath: string): string | null {
  const extension = path.extname(basePath);
  const directCandidates = extension === '' || publicSourceExtensions.has(extension)
    ? [basePath]
    : [];
  const pathWithoutJsExtension = ['.js', '.jsx', '.mjs', '.cjs'].includes(extension)
    ? basePath.slice(0, -extension.length)
    : null;
  const candidates = [
    ...directCandidates,
    ...(pathWithoutJsExtension === null
      ? []
      : Array.from(publicSourceExtensions, (sourceExtension) => `${pathWithoutJsExtension}${sourceExtension}`)),
    ...Array.from(publicSourceExtensions, (sourceExtension) => `${basePath}${sourceExtension}`),
    ...Array.from(publicSourceExtensions, (sourceExtension) => path.join(basePath, `index${sourceExtension}`))
  ];

  return candidates.find(isFile) ?? null;
}

function isFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile();
}

function isResearchOnlyPublicExportName(name: string): boolean {
  const simpleName = name.startsWith('JSX.IntrinsicElements.')
    ? name.slice('JSX.IntrinsicElements.'.length)
    : name;

  return researchOnlyPublicExportNames.has(simpleName);
}

describe('render graph API boundaries', () => {
  it('keeps consumer package exports free of research-only names', () => {
    const violations = publicPackageExportSymbols()
      .filter(({ name }) => isResearchOnlyPublicExportName(name))
      .map(({ file, line, name, specifier, text }) => ({
        file,
        line,
        name,
        specifier,
        text
      }));

    expect(violations).toEqual([]);
  });
});
