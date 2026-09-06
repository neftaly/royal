const normalized = (value) => value.replaceAll('\\', '/').replace(/^\0/u, '');

const publishedRendererModule = (id, stem) =>
  id.includes(`/renderer-webgl/dist/${stem}`);

const capabilityDefinitions = [
  {
    fixture: 'gltf',
    name: 'draco',
    owns: (id) =>
      id.includes('/renderer-webgl/src/gltf/draco.ts')
      || id.includes('/renderer-webgl/src/gltf/static-draco-executor.ts')
      || publishedRendererModule(id, 'draco-')
      || id.includes('/minidraco/'),
  },
  {
    fixture: 'environment',
    name: 'environment',
    owns: (id) =>
      id.includes('/renderer-webgl/src/environment/')
      || publishedRendererModule(id, 'gpu-owner-')
      || publishedRendererModule(id, 'royal-environment-ktx1-'),
  },
  {
    fixture: 'gltf',
    name: 'ktx2',
    owns: (id) =>
      id.includes('/renderer-webgl/src/texture/ktx2-etc2.ts')
      || id.includes('/renderer-webgl/src/texture/etc2-storage.ts')
      || id.includes('/renderer-webgl/src/virtual-texture/ktx2-etc2.ts')
      || publishedRendererModule(id, 'etc2-storage-')
      || publishedRendererModule(id, 'ktx2-etc2-'),
  },
  {
    fixture: 'gltf',
    name: 'meshopt',
    owns: (id) =>
      id.includes('/renderer-webgl/src/gltf/meshopt.ts')
      || publishedRendererModule(id, 'static-source-')
      || publishedRendererModule(id, 'meshopt-codec-')
      || id.includes('/meshoptimizer/'),
  },
  {
    fixture: 'gltf',
    name: 'svg',
    owns: (id) =>
      id.includes('/renderer-webgl/src/texture/svg-source.ts')
      || publishedRendererModule(id, 'svg-source-'),
  },
  {
    fixture: 'gltf',
    name: 'transmission',
    owns: (id) =>
      id.includes('/renderer-webgl/src/surface/surface-composite-owner.ts')
      || id.includes('/renderer-webgl/src/surface/surface-composite-plan.ts')
      || id.includes('/renderer-webgl/src/surface/surface-depth-prepass-owner.ts')
      || id.includes('/renderer-webgl/src/surface/surface-depth-prepass.ts')
      || publishedRendererModule(id, 'surface-composite-owner-')
      || publishedRendererModule(id, 'surface-composite-plan-')
      || publishedRendererModule(id, 'surface-depth-prepass-owner-'),
  },
  {
    fixture: 'xr',
    name: 'xr',
    owns: (id) =>
      id.includes('/react/src/xr.ts')
      || id.includes('/react/src/xr/')
      || id.includes('/renderer-webgl/src/xr.ts')
      || id.includes('/renderer-webgl/src/xr/')
      || id.includes('/react/dist/xr.js')
      || id.includes('/renderer-webgl/dist/xr.js'),
  },
];

const emptyTotals = () => ({ initial: 0, lazy: 0, total: 0, worker: 0 });

const addByPhase = (totals, chunk, bytes) => {
  if (chunk.initial && chunk.worker) {
    throw new Error(`Bundle chunk ${chunk.file} cannot be both initial and a worker`);
  }
  totals.total += bytes;
  if (chunk.initial) totals.initial += bytes;
  else totals.lazy += bytes;
  if (chunk.worker) totals.worker += bytes;
};

export const attributeCapabilities = (chunks, definitions = capabilityDefinitions) =>
  Object.fromEntries(definitions.map((definition) => {
    const gzipBytes = emptyTotals();
    const renderedBytes = emptyTotals();
    const files = [];
    for (const chunk of chunks) {
      const modules = chunk.modules
        .map((module) => ({ ...module, id: normalized(module.id) }))
        .filter((module) => definition.owns(module.id));
      if (modules.length === 0) continue;
      addByPhase(gzipBytes, chunk, chunk.gzipBytes);
      for (const module of modules) addByPhase(renderedBytes, chunk, module.renderedBytes);
      files.push({
        file: chunk.file,
        gzipBytes: chunk.gzipBytes,
        initial: chunk.initial,
        modules: modules
          .map(({ id, renderedBytes: bytes }) => ({ id, renderedBytes: bytes }))
          .sort((left, right) => left.id.localeCompare(right.id)),
        worker: chunk.worker,
      });
    }
    if (files.length === 0) {
      throw new Error(`Bundle attribution found no emitted modules for ${definition.name}`);
    }
    return [definition.name, {
      files: files.sort((left, right) => left.file.localeCompare(right.file)),
      fixture: definition.fixture,
      gzipWholeChunkUpperBoundBytes: gzipBytes,
      matchedModuleRenderedBytes: renderedBytes,
    }];
  }).sort(([left], [right]) => left.localeCompare(right)));

export const bundleCapabilityDefinitions = capabilityDefinitions;
