import { describe, it } from "vitest";
import { IDENTITY_TEXTURE_COORDINATES } from "../../packages/renderer-webgl/src/surface/texture-coordinates";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { prepareCanonicalGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import type { CanonicalTextureSampler } from "../../packages/renderer-webgl/src/texture/sampler";
import { transformedWorldBounds } from "../../packages/renderer-webgl/src/surface/surface-visibility";
import {
  collectVirtualTextureDemand,
  createVirtualTextureDemandWorkspace,
} from "../../packages/renderer-webgl/src/virtual-texture/demand";
import {
  derivedVirtualTextureMipCount,
  parseVirtualTextureManifest,
  virtualTexturePageKeyParts,
} from "../../packages/renderer-webgl/src/virtual-texture/manifest";
import {
  virtualTexturePageTableByteLength,
  writeVirtualTexturePageTable,
} from "../../packages/renderer-webgl/src/virtual-texture/residency";
import { assertFuzz, forEachFuzzCase } from "../fuzz";

describe("VT2 bounded planning properties", () => {
  it("keeps randomized demand finite, unique, in-grid, and capacity-bounded", () => {
    forEachFuzzCase({ cases: 32, seed: 0x76_74_32_01 }, ({ random }) => {
      const pageSize = random.pick([64, 128, 256]);
      const width = random.int(1, 8193);
      const height = random.int(1, 8193);
      const mipCount = derivedVirtualTextureMipCount(width, height, pageSize);
      const manifest = parseVirtualTextureManifest({
        borderTexels: 2,
        contractVersion: 2,
        mipCount,
        pageSize,
        pages: { uriTemplate: "{mip}/{x}/{y}.png" },
        virtualSize: [width, height],
      });
      const capacity = random.int(1, 65);
      const workspace = createVirtualTextureDemandWorkspace(capacity);
      const projection = identityMat4();
      projection[0] = random.number(0.05, 20);
      projection[5] = random.number(0.05, 20);
      projection[12] = random.number(-1.5, 1.5);
      projection[13] = random.number(-1.5, 1.5);
      const sampler: CanonicalTextureSampler = {
        magFilter: random.pick(["linear", "nearest"]),
        minFilter: "linear-mipmap-linear",
        wrapS: random.pick(["clamp-to-edge", "repeat", "mirrored-repeat"]),
        wrapT: random.pick(["clamp-to-edge", "repeat", "mirrored-repeat"]),
      };
      const geometry = prepareCanonicalGeometry({ kind: "plane", size: [1, 1] }, true);
      const model = identityMat4();
      collectVirtualTextureDemand(
        workspace,
        manifest,
        [{
          geometry,
          model,
          textureCoordinates: IDENTITY_TEXTURE_COORDINATES,
          worldBounds: transformedWorldBounds(geometry.bounds, model),
        }],
        [{ viewProjection: projection, viewport: { height: 720, width: 1280, x: 0, y: 0 } }],
        sampler,
      );
      assertFuzz(workspace.count <= capacity, "demand exceeded caller capacity");
      assertFuzz(workspace.keys.size === workspace.count, "demand retained duplicate keys");
      for (let index = 0; index < workspace.count; index += 1) {
        const mip = workspace.mips[index]!;
        const x = workspace.xs[index]!;
        const y = workspace.ys[index]!;
        assertFuzz(mip < mipCount, "demand mip escaped manifest");
        assertFuzz(x < manifest.mipLayouts[mip]!.width, "demand x escaped mip grid");
        assertFuzz(y < manifest.mipLayouts[mip]!.height, "demand y escaped mip grid");
      }
    });
  });

  it("maps randomized missing pages only to resident ancestors", () => {
    forEachFuzzCase({ cases: 24, seed: 0x76_74_32_02 }, ({ random }) => {
      const manifest = parseVirtualTextureManifest({
        borderTexels: 1,
        contractVersion: 2,
        pageSize: 128,
        pages: { uriTemplate: "{page}.png" },
        virtualSize: [random.int(129, 2049), random.int(129, 2049)],
      });
      const residents = new Map<number | string, number>();
      let slot = 0;
      for (let mip = manifest.mipCount - 1; mip >= 0 && slot < 32; mip -= 1) {
        const layout = manifest.mipLayouts[mip]!;
        for (let y = 0; y < layout.height && slot < 32; y += 1) {
          for (let x = 0; x < layout.width && slot < 32; x += 1) {
            if (mip === manifest.mipCount - 1 || random.boolean(0.2)) {
              residents.set(virtualTexturePageKeyParts(mip, x, y), slot);
              slot += 1;
            }
          }
        }
      }
      const table = new Uint8Array(virtualTexturePageTableByteLength(manifest));
      writeVirtualTexturePageTable(manifest, residents, 8, table);
      for (let mip = 0; mip < manifest.mipCount; mip += 1) {
        const layout = manifest.mipLayouts[mip]!;
        const storageWidth = Math.max(1, manifest.tableWidth / 2 ** mip);
        for (let y = 0; y < layout.height; y += 1) {
          for (let x = 0; x < layout.width; x += 1) {
            const offset = layout.byteOffset + (y * storageWidth + x) * 4;
            let ancestorMip = mip;
            let ancestorX = x;
            let ancestorY = y;
            let expectedSlot: number | undefined;
            while (ancestorMip < manifest.mipCount) {
              expectedSlot = residents.get(virtualTexturePageKeyParts(
                ancestorMip,
                ancestorX,
                ancestorY,
              ));
              if (expectedSlot !== undefined) break;
              ancestorMip += 1;
              ancestorX = Math.floor(ancestorX / 2);
              ancestorY = Math.floor(ancestorY / 2);
            }
            assertFuzz(expectedSlot !== undefined, "fuzz oracle lost coarsest resident page");
            assertFuzz(table[offset] === expectedSlot % 8, "page-table atlas x diverged");
            assertFuzz(
              table[offset + 1] === Math.floor(expectedSlot / 8),
              "page-table atlas y diverged",
            );
            assertFuzz(table[offset + 2] === ancestorMip, "page-table ancestor mip diverged");
            assertFuzz(table[offset + 3] === 255, "page-table residency diverged");
          }
        }
      }
    });
  });
});
