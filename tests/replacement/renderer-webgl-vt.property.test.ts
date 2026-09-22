import { describe, it } from "vitest";
import { IDENTITY_TEXTURE_COORDINATES } from "../../packages/renderer-webgl/src/surface/texture-coordinates";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { prepareCanonicalGeometry } from "../../packages/renderer-webgl/src/surface/canonical-geometry";
import type { CanonicalTextureSampler } from "../../packages/renderer-webgl/src/texture/sampler";
import { transformedWorldBounds } from "../../packages/renderer-webgl/src/surface/surface-visibility";
import {
  collectVirtualTextureDemand,
  createVirtualTextureDemandWorkspace,
  truncateVirtualTextureDemand,
} from "../../packages/renderer-webgl/src/virtual-texture/demand";
import {
  derivedVirtualTextureMipCount,
  createGeneratedVirtualTextureLayout,
  virtualTexturePageKeyParts,
} from "../../packages/renderer-webgl/src/virtual-texture/layout";
import { addVirtualTexturePageTablePage, writeVirtualTexturePageTable } from "../../packages/renderer-webgl/src/virtual-texture/residency";
import { assertFuzz, forEachFuzzCase } from "../fuzz";

describe("VT2 bounded planning properties", () => {
  it("coarsens direct demand only as far as needed while preserving every requested region", () => {
    forEachFuzzCase({ cases: 64, seed: 0x76_74_32_04 }, ({ random }) => {
      const width = random.int(1, 16), height = random.int(1, 16);
      const original = [{ mip: 4, x: 0, y: 0 }];
      const originalKeys = new Set(["4/0/0"]);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        for (const mip of random.boolean() ? [0, 1] : [0]) {
          const page = { mip, x: Math.floor(x / 2 ** mip), y: Math.floor(y / 2 ** mip) };
          const key = `${page.mip}/${page.x}/${page.y}`;
          if (!originalKeys.has(key)) { originalKeys.add(key); original.push(page); }
        }
      }
      for (const capacity of [1, 4, random.int(1, original.length), original.length]) {
        const workspace = createVirtualTextureDemandWorkspace(512);
        original.forEach((page, index) => {
          workspace.mips[index] = page.mip; workspace.xs[index] = page.x; workspace.ys[index] = page.y;
          workspace.keys.add(virtualTexturePageKeyParts(page.mip, page.x, page.y));
        });
        workspace.count = original.length;
        // Direct oracle projects all original regions to each candidate level,
        // independently of the production routine's iterative in-place merges.
        let expected = new Set<string>();
        for (let level = 0; level <= 4; level++) {
          expected = new Set(original.map(page => {
            const mip = Math.max(level, page.mip), scale = 2 ** (mip - page.mip);
            return `${mip}/${Math.floor(page.x / scale)}/${Math.floor(page.y / scale)}`;
          }));
          if (expected.size <= capacity) break;
        }
        truncateVirtualTextureDemand(workspace, capacity);
        const actual = Array.from({ length: workspace.count }, (_, index) =>
          `${workspace.mips[index]}/${workspace.xs[index]}/${workspace.ys[index]}`);
        assertFuzz(actual.length === expected.size && actual.every(key => expected.has(key)), "coarsening lost coverage or skipped a feasible detail level");
        assertFuzz(workspace.keys.size === actual.length && workspace.count <= capacity, "coarsened membership or capacity diverged");
        for (let index = 0; index < workspace.count; index++) assertFuzz(workspace.keys.has(
          virtualTexturePageKeyParts(workspace.mips[index]!, workspace.xs[index]!, workspace.ys[index]!),
        ), "coarsened key index lost a retained page");
      }
    });
  });

  it("clears stale ancestors through randomized replacement and empty-table cycles", () => {
    forEachFuzzCase({ cases: 24, seed: 0x76_74_32_03 }, ({ random }) => {
      const manifest = createGeneratedVirtualTextureLayout({ colorSpace: "srgb", borderTexels: 1, pageSize: 128, width: random.int(1, 1025), height: random.int(1, 1025) });
      const pages = manifest.mipLayouts.flatMap((layout, mip) => Array.from(
        { length: layout.width * layout.height }, (_, index) =>
          ({ mip, x: index % layout.width, y: Math.floor(index / layout.width) })));
      const slots: (typeof pages[number] | undefined)[] = Array(7).fill(undefined);
      const residents = new Map<number | string, number>();
      const table = new Uint8Array(manifest.tableByteLength);
      for (let step = 0; step < 80; step += 1) {
        if (step % 17 === 16) {
          slots.fill(undefined);
          residents.clear();
          writeVirtualTexturePageTable(manifest, residents, 3, table);
        } else {
          const page = random.pick(pages), slot = random.int(0, slots.length - 1);
          const key = virtualTexturePageKeyParts(page.mip, page.x, page.y);
          const previousSlot = residents.get(key);
          if (previousSlot !== undefined) slots[previousSlot] = undefined;
          const evicted = slots[slot];
          if (evicted !== undefined) residents.delete(virtualTexturePageKeyParts(evicted.mip, evicted.x, evicted.y));
          slots[slot] = page;
          residents.set(key, slot);
          if (evicted !== undefined) writeVirtualTexturePageTable(manifest, residents, 3, table);
          else addVirtualTexturePageTablePage(manifest, page, slot, 3, table);
        }
        // Independent oracle searches physical residents directly, including
        // holes with no ancestor. It does not read neighboring table entries.
        const expected = new Uint8Array(table.length);
        for (const page of pages) {
          let closest = Infinity, selected = -1;
          for (const [slot, resident] of slots.entries()) {
            if (resident === undefined || resident.mip < page.mip || resident.mip >= closest) continue;
            const scale = 2 ** (resident.mip - page.mip);
            if (resident.x === Math.floor(page.x / scale) && resident.y === Math.floor(page.y / scale)) {
              closest = resident.mip; selected = slot;
            }
          }
          if (selected < 0) continue;
          const offset = manifest.mipLayouts[page.mip]!.byteOffset
            + (page.y * Math.max(1, manifest.tableWidth / 2 ** page.mip) + page.x) * 4;
          expected.set([selected % 3, Math.floor(selected / 3), closest, 255], offset);
        }
        assertFuzz(table.every((value, index) => value === expected[index]), `stale page-table mapping at step ${step}`);
      }
    });
  });

  it("keeps randomized demand finite, unique, in-grid, and capacity-bounded", () => {
    forEachFuzzCase({ cases: 32, seed: 0x76_74_32_01 }, ({ random }) => {
      const pageSize = random.pick([64, 128, 256]);
      const width = random.int(1, 8193);
      const height = random.int(1, 8193);
      const mipCount = derivedVirtualTextureMipCount(width, height, pageSize);
      const manifest = createGeneratedVirtualTextureLayout({ colorSpace: "srgb", borderTexels: 2, pageSize, width: width, height: height });
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
      const manifest = createGeneratedVirtualTextureLayout({ colorSpace: "srgb", borderTexels: 1, pageSize: 128, width: random.int(129, 2049), height: random.int(129, 2049) });
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
      const table = new Uint8Array(manifest.tableByteLength);
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
