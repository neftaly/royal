import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseVirtualTextureManifest } from "../../packages/renderer-webgl/src/virtual-texture/manifest.ts";
import { parseKtx2Native } from "../../packages/renderer-webgl/src/texture/ktx2-native.ts";
import { virtualTexturePageFormat, virtualTexturePageBytes } from "../../packages/renderer-webgl/src/virtual-texture/page-format.ts";

for (const directory of process.argv.slice(2)) {
  const manifest = parseVirtualTextureManifest(JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")));
  let count = 0;
  for (let mip = 0; mip < manifest.mipCount; mip++) {
    const layout = manifest.mipLayouts[mip]!;
    for (let y = 0; y < layout.height; y++) for (let x = 0; x < layout.width; x++) {
      const bytes = readFileSync(join(directory, String(mip), `${x}-${y}.ktx2`));
      const parsed = parseKtx2Native(bytes);
      if (parsed.format !== virtualTexturePageFormat(manifest.pageEncoding)
          || parsed.colorSpace !== manifest.colorSpace || parsed.levels.length !== 1
          || parsed.width !== manifest.pageSize + 2 * manifest.borderTexels
          || parsed.height !== parsed.width || parsed.levels[0]!.blocks.byteLength !== virtualTexturePageBytes(manifest)) {
        throw new Error(`Incompatible page ${mip}/${x}/${y}`);
      }
      count++;
    }
    if (readdirSync(join(directory, String(mip))).length !== layout.width * layout.height) throw new Error("Extra pages");
  }
  console.log(JSON.stringify({ directory, encoding: manifest.pageEncoding, validatedPages: count }));
}
