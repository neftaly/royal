import {
  unlitMaterial,
  virtualTexture,
  type UnlitMaterial,
} from '@royal/react/scene';

const surfaceSampler = {
  magFilter: 'linear',
  minFilter: 'linear',
  wrapS: 'clamp-to-edge',
  wrapT: 'clamp-to-edge',
} as const;

export const surfaceVirtualTextureProbe = {
  activeGrid: '4x4',
  activeMip: 1,
  activePages: 16,
  format: 'rgba8',
  generator: 'debug-rgba',
  id: 'generated-virtual-texturing-surface',
  manifestUri: `${import.meta.env.BASE_URL}generated-virtual-texturing-surface.vt.json`,
  pageSourceKind: 'generated',
  pageSize: 128,
  physicalSlots: 17,
  probe: 'generated-debug-rgba-pages',
  revision: 'generated-debug-rgba-pages-v2-capacity-mip1',
  virtualSize: '1024x1024',
} as const;

export const createSurfaceMaterial = (): UnlitMaterial =>
  unlitMaterial({
    texture: virtualTexture({
      colorSpace: 'srgb',
      assetId: surfaceVirtualTextureProbe.id,
      sampler: surfaceSampler,
      src: surfaceVirtualTextureProbe.manifestUri,
      version: surfaceVirtualTextureProbe.revision,
    }),
  });
