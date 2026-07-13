import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const fixtureDirectory = new URL(
  "../apps/examples-react/public/fixtures/virtual-texture-stress/",
  import.meta.url,
);
const pagesDirectory = new URL("map-pages/", fixtureDirectory);

describe("virtual texture stress fixture", () => {
  it("forms one spatially coherent mip pyramid with diagnostic-only page overlays", async () => {
    const manifest = JSON.parse(await readFile(new URL("map.vt.json", fixtureDirectory), "utf8")) as {
      readonly mipCount: number;
      readonly pageSize: number;
      readonly virtualSize: readonly [number, number];
    };
    const files = (await readdir(pagesDirectory)).filter((file) => file.endsWith(".svg")).sort();
    const expectedFiles: string[] = [];
    const canonicalMaps = new Set<string>();

    for (let mip = 0; mip < manifest.mipCount; mip += 1) {
      const scale = 2 ** mip;
      const gridWidth = Math.ceil(manifest.virtualSize[0] / manifest.pageSize / scale);
      const gridHeight = Math.ceil(manifest.virtualSize[1] / manifest.pageSize / scale);
      for (let y = 0; y < gridHeight; y += 1) {
        for (let x = 0; x < gridWidth; x += 1) {
          const file = `m${mip}-${x}-${y}.svg`;
          expectedFiles.push(file);
          const source = await readFile(new URL(file, pagesDirectory), "utf8");
          const sourceSize = manifest.pageSize * scale;
          expect(source).toContain(`viewBox="${x * sourceSize} ${y * sourceSize} ${sourceSize} ${sourceSize}"`);
          expect(source).toContain(`data-vt-page="${mip}/${x}/${y}"`);
          const canonical = source.match(/<g id="canonical-map">[\s\S]*?<\/g>/)?.[0];
          expect(canonical, `${file} must embed the canonical map`).toBeDefined();
          canonicalMaps.add(canonical!);
        }
      }
    }

    expect(files).toEqual(expectedFiles.sort());
    expect(files).toHaveLength(85);
    // This is the cross-mip landmark/color invariant: every tile clips the same
    // canonical artwork, so only the explicitly marked debug overlay may vary.
    expect(canonicalMaps.size).toBe(1);
  });
});
