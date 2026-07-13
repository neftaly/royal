import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const maximumPhysicalLines = 2_000;
const testsDirectory = fileURLToPath(new URL(".", import.meta.url));
const sourceExtensions = new Set([".ts", ".tsx"]);
// Generated and vendored fixture data is not authored test code. There are no
// matching TypeScript directories today; keep the exclusion explicit rather
// than silently teaching the guard to ignore an oversized authored helper.
const excludedDirectoryNames = new Set(["generated", "vendor"]);

const physicalLineCount = (text: string): number => {
  if (text.length === 0) return 0;
  const newlineCount = text.match(/\n/g)?.length ?? 0;
  return newlineCount + (text.endsWith("\n") ? 0 : 1);
};

const testSources = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!excludedDirectoryNames.has(entry.name)) files.push(...testSources(join(directory, entry.name)));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(join(directory, entry.name));
  }
  return files.sort();
};

describe("test source size", () => {
  it("keeps tests and shared test helpers within the 2,000-line review ceiling", () => {
    const oversized = testSources(testsDirectory)
      .map((file) => ({ file, lines: physicalLineCount(readFileSync(file, "utf8")) }))
      .filter(({ lines }) => lines > maximumPhysicalLines)
      .map(({ file, lines }) => `${file.slice(testsDirectory.length)}: ${lines} lines`);

    expect(oversized, "split oversized test sources by coherent responsibility").toEqual([]);
  });
});
