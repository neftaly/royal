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
      readonly borderTexels: number;
      readonly contractVersion: number;
      readonly mipCount: number;
      readonly pageSize: number;
      readonly physicalByteBudget: number;
      readonly physicalSlots: number;
      readonly virtualSize: readonly [number, number];
    };
    const files = (await readdir(pagesDirectory)).filter((file) => file.endsWith(".svg")).sort();
    const expectedFiles: string[] = [];
    const canonicalMaps = new Set<string>();
    const storedPageSize = manifest.pageSize + manifest.borderTexels * 2;

    expect(manifest).toEqual(expect.objectContaining({
      borderTexels: 1,
      contractVersion: 2,
      physicalSlots: 24,
    }));
    const pageTableBytes = Math.ceil(manifest.virtualSize[0] / manifest.pageSize)
      * Math.ceil(manifest.virtualSize[1] / manifest.pageSize)
      * 4;
    const atlasColumns = Math.ceil(Math.sqrt(manifest.physicalSlots));
    const atlasRows = Math.ceil(manifest.physicalSlots / atlasColumns);
    expect({ atlasColumns, atlasRows }).toEqual({ atlasColumns: 5, atlasRows: 5 });
    expect(manifest.physicalByteBudget).toBe(
      storedPageSize ** 2 * 4 * atlasColumns * atlasRows + pageTableBytes,
    );

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
          const sourceX = x * sourceSize;
          const sourceY = y * sourceSize;
          expect(source).toContain(`width="${storedPageSize}" height="${storedPageSize}"`);
          expect(source).toContain(
            `viewBox="${sourceX - scale} ${sourceY - scale} ${storedPageSize * scale} ${storedPageSize * scale}"`,
          );
          expect(source).toContain(`data-vt-page="${mip}/${x}/${y}"`);
          expect(source).toContain(`<rect x="${sourceX + 8 * scale}" y="${sourceY + 8 * scale}"`);
          expect(source.indexOf('id="canonical-map-periodic-copies"')).toBeLessThan(
            source.indexOf('id="vt-debug-overlay"'),
          );
          for (const translatedX of [-4096, 0, 4096]) {
            for (const translatedY of [-4096, 0, 4096]) {
              expect(source).toContain(
                `<use href="#canonical-map" transform="translate(${translatedX} ${translatedY})"/>`,
              );
            }
          }
          const canonical = source.match(/<g id="canonical-map"[\s\S]*?<\/g>/)?.[0];
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
