// @ts-expect-error Fixture authoring utility is plain JavaScript.
import { mapArtwork } from "../../apps/examples-react/scripts/generate-virtual-texture-stress.mjs";
import { readdir, readFile } from "node:fs/promises";
import { expect, it } from "vitest";
it("supplies one full-resolution raster for every automatic page", async () => {
  const directory = new URL("../../apps/examples-react/public/fixtures/virtual-texture-stress/", import.meta.url);
  expect((await readdir(directory)).sort()).toEqual(["map-overview.svg", "map.png"]);
  const png = await readFile(new URL("map.png", directory));
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.readUInt32BE(16)).toBe(4096);
  expect(png.readUInt32BE(20)).toBe(4096);
  expect(mapArtwork()).toContain('viewBox="0 0 4096 4096"');
  for (const landmark of ["NORTHWEST", "NORTHEAST", "SOUTHWEST", "SOUTHEAST", "CROWN HARBOR"]) expect(mapArtwork()).toContain(landmark);
});
