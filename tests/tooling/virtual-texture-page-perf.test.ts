import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const benchmarkHtmlPath = fileURLToPath(
  new URL("../../scripts/virtual-texture-page-perf.html", import.meta.url),
);

describe("VT page performance harness", () => {
  it("imports live VT2 modules and remains exposed through package scripts", () => {
    const html = readFileSync(benchmarkHtmlPath, "utf8");
    const sourceImports = [...html.matchAll(/from\s+["']\/(packages\/[^"']+)["']/g)]
      .map((match) => match[1]);

    expect(sourceImports).not.toHaveLength(0);
    expect(sourceImports).not.toContain(
      "packages/renderer-webgl/src/virtual-texture/automatic-source.ts",
    );
    expect(sourceImports).not.toContain(
      "packages/renderer-webgl/src/virtual-texture/model.ts",
    );
    for (const sourceImport of sourceImports) {
      expect(existsSync(`${repoRoot}/${sourceImport}`), sourceImport).toBe(true);
    }

    const packageJson = JSON.parse(
      readFileSync(`${repoRoot}/package.json`, "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };
    expect(packageJson.scripts?.["check:vt-pages-build"]).toBe(
      "node scripts/virtual-texture-page-perf.ts --build-only",
    );
    expect(packageJson.scripts?.["bench:vt-pages"]).toBe(
      "node scripts/virtual-texture-page-perf.ts",
    );
  });
});
