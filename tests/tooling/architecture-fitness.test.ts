import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
// TypeScript 7 is the compiler; its stable JS AST API still lives in this package.
import ts from "@typescript/typescript6";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const packagesRoot = path.join(repoRoot, "packages");

const sourceFilesBelow = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      sourceFilesBelow(absolute).forEach((file) => files.push(file));
    } else if (/\.(?:ts|tsx)$/u.test(entry) && !entry.endsWith(".d.ts")) {
      files.push(absolute);
    }
  }
  return files.sort();
};

const packageSourceFiles = readdirSync(packagesRoot)
  .map((name) => path.join(packagesRoot, name, "src"))
  .filter((directory) => {
    try {
      return statSync(directory).isDirectory();
    } catch {
      return false;
    }
  })
  .flatMap(sourceFilesBelow);

const sourceTrees = new Map(packageSourceFiles.map((file) => [
  file,
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  ),
]));
const workspaceEntrypoints = new Map([
  ["@royal/react", path.join(packagesRoot, "react", "src", "index.ts")],
  ["@royal/react/scene", path.join(packagesRoot, "react", "src", "scene.ts")],
  ["@royal/react/xr", path.join(packagesRoot, "react", "src", "xr.ts")],
  ["@royal/renderer-core", path.join(packagesRoot, "renderer-core", "src", "index.ts")],
  [
    "@royal/renderer-core/render-object",
    path.join(packagesRoot, "renderer-core", "src", "render-object.ts"),
  ],
  ["@royal/renderer-webgl", path.join(packagesRoot, "renderer-webgl", "src", "index.ts")],
  ["@royal/renderer-webgl/xr", path.join(packagesRoot, "renderer-webgl", "src", "xr.ts")],
]);

const staticSpecifiers = (file: string): string[] => {
  const source = sourceTrees.get(file)!;
  const specifiers: string[] = [];
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      const onlyNamedTypes = clause?.name === undefined
        && clause?.namedBindings !== undefined
        && ts.isNamedImports(clause.namedBindings)
        && clause.namedBindings.elements.every((element) => element.isTypeOnly);
      if (clause?.isTypeOnly !== true && !onlyNamedTypes) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    }
    if (
      ts.isExportDeclaration(statement)
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const onlyNamedTypes = statement.exportClause !== undefined
        && ts.isNamedExports(statement.exportClause)
        && statement.exportClause.elements.every((element) => element.isTypeOnly);
      if (!statement.isTypeOnly && !onlyNamedTypes) specifiers.push(statement.moduleSpecifier.text);
    }
  }
  return specifiers;
};

const allModuleSpecifiers = (file: string): string[] => {
  const specifiers: string[] = [];
  for (const statement of sourceTrees.get(file)!.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))
      && statement.moduleSpecifier !== undefined
      && ts.isStringLiteral(statement.moduleSpecifier)
    ) specifiers.push(statement.moduleSpecifier.text);
  }
  return specifiers;
};

const referencesBrowserAuthority = (file: string): boolean => {
  const source = sourceTrees.get(file)!;
  const names = new Set([
    "HTMLCanvasElement",
    "WebGL2RenderingContext",
    "WebGLRenderingContext",
    "Worker",
    "XRSession",
    "document",
    "fetch",
    "window",
  ]);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && names.has(node.text)) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const resolveRelativeSource = (from: string, specifier: string): string | undefined => {
  const workspaceEntry = workspaceEntrypoints.get(specifier);
  if (workspaceEntry !== undefined) return workspaceEntry;
  if (!specifier.startsWith(".")) return undefined;
  const unresolved = path.resolve(path.dirname(from), specifier);
  const withoutJavaScriptExtension = unresolved.replace(/\.(?:mjs|cjs|js)$/u, "");
  for (const candidate of [
    unresolved,
    `${withoutJavaScriptExtension}.ts`,
    `${withoutJavaScriptExtension}.tsx`,
    path.join(unresolved, "index.ts"),
    path.join(unresolved, "index.tsx"),
  ]) {
    if (sourceTrees.has(candidate)) return candidate;
  }
  return undefined;
};

const staticGraph = new Map(packageSourceFiles.map((file) => [
  file,
  staticSpecifiers(file)
    .map((specifier) => resolveRelativeSource(file, specifier))
    .filter((dependency): dependency is string => dependency !== undefined),
]));

const reachableFrom = (entry: string): Set<string> => {
  const reached = new Set<string>();
  const visit = (file: string): void => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const dependency of staticGraph.get(file) ?? []) visit(dependency);
  };
  visit(entry);
  return reached;
};

const relative = (file: string): string => path.relative(repoRoot, file);

describe("source architecture fitness", () => {
  it("keeps package source imports acyclic", () => {
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];
    const cycles: string[] = [];
    const visit = (file: string): void => {
      if (visited.has(file)) return;
      if (visiting.has(file)) {
        const start = stack.indexOf(file);
        cycles.push([...stack.slice(start), file].map(relative).join(" -> "));
        return;
      }
      visiting.add(file);
      stack.push(file);
      for (const dependency of staticGraph.get(file) ?? []) visit(dependency);
      stack.pop();
      visiting.delete(file);
      visited.add(file);
    };
    packageSourceFiles.forEach(visit);
    expect(cycles).toEqual([]);
  });

  it("keeps renderer-core free of browser and framework authority", () => {
    const coreRoot = path.join(packagesRoot, "renderer-core", "src");
    const violations: string[] = [];
    for (const file of packageSourceFiles.filter((candidate) => candidate.startsWith(coreRoot))) {
      const externalImports = staticSpecifiers(file).filter((specifier) => !specifier.startsWith("."));
      if (externalImports.length > 0) {
        violations.push(`${relative(file)} imports ${externalImports.join(", ")}`);
      }
      if (referencesBrowserAuthority(file)) {
        violations.push(`${relative(file)} references browser authority`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps direct element-array writes in reviewed VAO owners", () => {
    const writes: string[] = [];
    const missingLocalOwner: string[] = [];
    for (const file of packageSourceFiles) {
      const source = sourceTrees.get(file)!;
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node)
          && ts.isPropertyAccessExpression(node.expression)
          && node.expression.name.text === "bindBuffer"
          && node.arguments[0] !== undefined
          && ts.isPropertyAccessExpression(node.arguments[0])
          && node.arguments[0].name.text === "ELEMENT_ARRAY_BUFFER"
        ) {
          let owner: ts.Node | undefined = node;
          while (
            owner !== undefined
            && !ts.isMethodDeclaration(owner)
            && !ts.isFunctionDeclaration(owner)
          ) owner = owner.parent;
          const ownerName = owner !== undefined && "name" in owner && owner.name !== undefined
            ? owner.name.getText(source)
            : "anonymous";
          const label = `${relative(file)}:${ownerName}`;
          writes.push(label);

          let statement: ts.Node = node;
          while (statement.parent !== undefined && !ts.isBlock(statement.parent)) {
            statement = statement.parent;
          }
          const block = statement.parent;
          const statementIndex = ts.isBlock(block) ? block.statements.indexOf(statement as ts.Statement) : -1;
          const establishedLocally = ts.isBlock(block)
            && statementIndex >= 0
            && block.statements.slice(0, statementIndex).some((candidate) =>
              candidate.getText(source).includes(".bindVertexArray("));
          if (!establishedLocally) missingLocalOwner.push(label);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(writes.sort()).toEqual([
      "packages/renderer-webgl/src/surface/bounded-volume-gpu-owner.ts:#ensureResources",
      "packages/renderer-webgl/src/surface/edge-overlay-owner.ts:#createCombinedGeometry",
      "packages/renderer-webgl/src/surface/edge-overlay-owner.ts:#prepareBatches",
      "packages/renderer-webgl/src/surface/surface-geometry-gpu-owner.ts:#createGeometryArena",
      "packages/renderer-webgl/src/surface/surface-geometry-gpu-owner.ts:#createInstanceVertexArray",
      "packages/renderer-webgl/src/surface/surface-geometry-gpu-owner.ts:#uploadGeometry",
    ]);
    expect(missingLocalOwner).toEqual([]);
  });

  it("keeps shared frame data below renderer feature owners", () => {
    const frameRoot = path.join(packagesRoot, "renderer-webgl", "src", "frame");
    const violations: string[] = [];
    for (const file of packageSourceFiles.filter((candidate) => candidate.startsWith(frameRoot))) {
      for (const specifier of allModuleSpecifiers(file)) {
        if (specifier.startsWith(".") && !specifier.startsWith("./") && specifier !== "../math/mat4") {
          violations.push(`${relative(file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps immutable texture consumers below the texture lifecycle owner", () => {
    const rendererRoot = path.join(packagesRoot, "renderer-webgl", "src");
    const assetOwner = path.join(rendererRoot, "texture", "asset-owner.ts");
    const expectedOwner = path.join(rendererRoot, "runtime", "canvas-root.ts");
    const owners = packageSourceFiles.filter((file) =>
      staticGraph.get(file)?.includes(assetOwner) === true);
    expect(owners.map(relative)).toEqual([relative(expectedOwner)]);
  });

  it("keeps canonical texture coordinates below glTF ingestion", () => {
    const rendererRoot = path.join(packagesRoot, "renderer-webgl", "src");
    const gltfCoordinates = path.join(rendererRoot, "gltf", "texture-coordinates.ts");
    const allowedOwner = path.join(rendererRoot, "gltf", "static-material.ts");
    const consumers = packageSourceFiles.filter((file) =>
      staticGraph.get(file)?.includes(gltfCoordinates) === true);
    expect(consumers.map(relative)).toEqual([relative(allowedOwner)]);
  });

  it("keeps optional renderer implementations out of the main static graph", () => {
    const rendererRoot = path.join(packagesRoot, "renderer-webgl", "src");
    const reached = [...reachableFrom(path.join(rendererRoot, "index.ts"))].map(relative);
    const forbidden = [
      "/gltf/browser-static-preparation.ts",
      "/gltf/gltf-values.ts",
      "/gltf/static-asset.ts",
      "/gltf/static-node-selection.ts",
      "/gltf/texture-coordinates.ts",
      "/surface/surface-depth-prepass-owner.ts",
      "/virtual-texture/automatic-page-source.ts",
      "/virtual-texture/browser-page-source.ts",
      "/virtual-texture/runtime.ts",
      "/xr/",
      "/xr.ts",
    ];
    expect(reached.filter((file) => forbidden.some((suffix) => file.includes(suffix)))).toEqual([]);
  });

  it("does not introduce TypeScript runtime feature helpers", () => {
    const violations: string[] = [];
    for (const file of packageSourceFiles) {
      const source = sourceTrees.get(file)!;
      const visit = (node: ts.Node): void => {
        if (ts.isEnumDeclaration(node)) violations.push(`${relative(file)} declares an enum`);
        if (ts.isModuleDeclaration(node)) violations.push(`${relative(file)} declares a namespace`);
        if (ts.canHaveDecorators(node) && (ts.getDecorators(node)?.length ?? 0) > 0) {
          violations.push(`${relative(file)} uses a decorator`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(violations).toEqual([]);
  });
});
