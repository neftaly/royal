import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const packageDirectories = ["renderer-core", "renderer-webgl", "react"];

describe("open-source package distribution", () => {
  it("ships the declared canonical license with every publishable package", () => {
    const license = readFileSync(path.join(repoRoot, "LICENSE"), "utf8");
    expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(license).toContain("Version 3, 19 November 2007");

    for (const directory of packageDirectories) {
      const packageRoot = path.join(repoRoot, "packages", directory);
      const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
        license?: unknown;
        private?: unknown;
      };
      expect(manifest.license, directory).toBe("AGPL-3.0-only");
      expect(manifest.private, directory).not.toBe(true);
      expect(readFileSync(path.join(packageRoot, "LICENSE"), "utf8"), directory).toBe(license);
    }
  });
});
