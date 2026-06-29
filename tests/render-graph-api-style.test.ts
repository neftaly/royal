import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const publicSurfaceRoots = ['README.md', 'apps', 'packages', 'research'] as const;
const publicPackageJsonPaths = [
  'packages/react/package.json',
  'packages/renderer-core/package.json',
  'packages/renderer-webgl/package.json',
  'packages/royal-tarstate-lens/package.json'
] as const;
const testingOnlyPublicExportSpecifiers = new Set([
  '@royal/renderer-webgl/virtual-texturing/testing'
]);
const ignoredDirectories = new Set([
  'coverage',
  'dist',
  'node_modules'
]);
const markdownExtensions = new Set(['.md', '.mdx']);
const publicSourceExtensions = new Set(['.ts', '.tsx']);
const renderGraphFactoryPattern = /(?<![\w$.])(?:scene|pass|mesh|gltf)\s*\(/;
const staleMaterialColorPattern = /(?<![\w$.])standardMaterial\s*\(\s*\{\s*color\s*:/;
const nonCurrentResearchLabelPattern = /\b(?:future|non-current|not current|not public|not an api|pseudocode|pseudo-api|research-only|sketch)\b/i;
const exactResearchOnlyPublicExportNames = new Set([
  'customShaderMaterial',
  'shaderUniform',
  'shaderAttribute',
  'DynamicImpostorNode',
  'dynamicImpostor',
  'VirtualTextureNode',
  'VirtualTextureRuntime',
  'FormControl',
  'formControl',
  'input',
  'textarea',
  'select'
]);
const lodPublicExportNamePattern =
  /^(?:LOD|Lod|lod)(?:Node|Knob|Control|Policy|Range|Threshold|Distance|Switch|Level|Bias|Budget)s?$|^(?:LevelOfDetail|levelOfDetail|dynamicLod|DynamicLod)/;
const pageHandlePublicExportNamePattern =
  /(?:PageCache|PageTable)|(?:^|[a-z])page(?:Cache|Table)(?:$|[A-Z])|page[-_](?:cache|table)/i;

type PublicSnippet = {
  readonly file: string;
  readonly line: number;
  readonly text: string;
};

type MarkdownCodeBlock = {
  readonly code: string;
  readonly language: string;
  readonly startLine: number;
  readonly leadingContext: string;
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

function listFiles(root: string): readonly string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];

    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath);
    return [entryPath];
  });
}

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
        testingOnlyPublicExportSpecifiers.has(specifier) ||
        !publicSourceExtensions.has(path.extname(targetPath))
      ) {
        return [];
      }

      return [{ file: path.join(packageDir, targetPath), specifier }];
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

function listPublicSurfaceFiles(): readonly string[] {
  return publicSurfaceRoots.flatMap((root) => {
    const absoluteRoot = path.join(repoRoot, root);
    if (!existsSync(absoluteRoot)) return [];
    return readdirSync(repoRoot, { withFileTypes: true }).some((entry) => entry.name === root && entry.isFile())
      ? [absoluteRoot]
      : listFiles(absoluteRoot);
  });
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
  if (seen.has(resolvedPath) || !existsSync(resolvedPath)) return [];
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
      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
        return statement.exportClause.elements.map((element) => symbol(element.name.text, element.name));
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
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx')
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function isResearchOnlyPublicExportName(name: string): boolean {
  const simpleName = name.startsWith('JSX.IntrinsicElements.')
    ? name.slice('JSX.IntrinsicElements.'.length)
    : name;

  return (
    exactResearchOnlyPublicExportNames.has(simpleName) ||
    lodPublicExportNamePattern.test(simpleName) ||
    pageHandlePublicExportNamePattern.test(simpleName)
  );
}

function isPublicExampleSource(filePath: string): boolean {
  const relativePath = path.relative(repoRoot, filePath);
  return (
    relativePath.startsWith(`apps${path.sep}`) &&
    relativePath.includes(`${path.sep}src${path.sep}`) &&
    publicSourceExtensions.has(path.extname(filePath)) &&
    !relativePath.endsWith('.test.ts') &&
    !relativePath.endsWith('.test.tsx')
  );
}

function lineNumberAtOffset(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

function markdownCodeBlocks(markdown: string): readonly MarkdownCodeBlock[] {
  const blocks: MarkdownCodeBlock[] = [];
  const fencePattern = /^```([^\s`]*)[^\n]*\n([\s\S]*?)^```/gm;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(markdown)) !== null) {
    const fenceStart = match.index;
    const startLine = lineNumberAtOffset(markdown, fenceStart) + 1;
    const leadingContext = markdown
      .slice(0, fenceStart)
      .split('\n')
      .slice(-5)
      .join('\n');

    blocks.push({
      code: match[2] ?? '',
      language: match[1] ?? '',
      leadingContext,
      startLine
    });
  }

  return blocks;
}

function isCodeLikeMarkdownBlock(block: MarkdownCodeBlock): boolean {
  return block.language === '' || /^(?:js|jsx|ts|tsx|typescript|javascript)$/.test(block.language);
}

function isAllowedNonCurrentResearchSnippet(file: string, block: MarkdownCodeBlock): boolean {
  return file.startsWith(`research${path.sep}`) && nonCurrentResearchLabelPattern.test(block.leadingContext);
}

function matchingLines(
  text: string,
  pattern: RegExp,
  offsetLine = 1
): readonly { readonly line: number; readonly text: string }[] {
  return text.split('\n').flatMap((lineText, index) =>
    pattern.test(lineText)
      ? [{ line: offsetLine + index, text: lineText.trim() }]
      : []
  );
}

function publicSnippetViolations(
  pattern: RegExp,
  options: { readonly allowLabeledResearchSketches: boolean } = { allowLabeledResearchSketches: true }
): readonly PublicSnippet[] {
  return listPublicSurfaceFiles().flatMap((filePath) => {
    const relativePath = path.relative(repoRoot, filePath);
    const extension = path.extname(filePath);
    const isMarkdown = markdownExtensions.has(extension);

    if (isMarkdown) {
      const markdown = readFileSync(filePath, 'utf8');
      return markdownCodeBlocks(markdown)
        .filter(isCodeLikeMarkdownBlock)
        .filter((block) => !(options.allowLabeledResearchSketches && isAllowedNonCurrentResearchSnippet(relativePath, block)))
        .flatMap((block) =>
          matchingLines(block.code, pattern, block.startLine).map(({ line, text }) => ({
            file: relativePath,
            line,
            text
          }))
        );
    }

    if (!isPublicExampleSource(filePath)) return [];

    return matchingLines(readFileSync(filePath, 'utf8'), pattern).map(({ line, text }) => ({
      file: relativePath,
      line,
      text
    }));
  });
}

describe('render graph API style', () => {
  it('keeps consumer package export names free of research-only feature APIs', () => {
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

  it('keeps public examples and current docs on JSX render graph syntax', () => {
    expect(publicSnippetViolations(renderGraphFactoryPattern)).toEqual([]);
  });

  it('keeps public snippets on current standard material options', () => {
    expect(publicSnippetViolations(staleMaterialColorPattern, { allowLabeledResearchSketches: false })).toEqual([]);
  });

  it('keeps internal adapter implementation outside the public example scan', () => {
    expect(existsSync(path.join(repoRoot, 'packages/react/src/jsx-runtime.ts'))).toBe(true);
    expect(isPublicExampleSource(path.join(repoRoot, 'packages/react/src/jsx-runtime.ts'))).toBe(false);
    expect(isPublicExampleSource(path.join(repoRoot, 'tests/render-webgl.test.ts'))).toBe(false);
  });
});
