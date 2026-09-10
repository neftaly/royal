import { build } from 'vite';
import glsl from 'vite-plugin-glsl';
import path from 'node:path';
import { codecModulePlugin } from '../../scripts/codec-module-plugin.ts';
await build({
 configFile: false, plugins: [glsl(), codecModulePlugin(false), {
  name: 'research-inline-module-base',
  // These fixtures use tiny uncompressed GLBs. Codec URLs must be syntactically
  // valid in an IIFE without pretending that external codecs are embedded.
  resolveFileUrl: ({ fileName }) => JSON.stringify(new URL(fileName, 'https://royal-research.invalid/').href),
 }], worker: { plugins: () => [codecModulePlugin(true)] },
 resolve: { alias: [{find:'@royal/renderer-core/render-object',replacement:path.resolve('packages/renderer-core/src/render-object.ts')},{find:'@royal/renderer-core',replacement:path.resolve('packages/renderer-core/src/index.ts')}] },
 publicDir: false,
 build: { outDir: process.env.LIGHTS_BUILD_DIR ?? '/tmp/royal-many-light-integration', emptyOutDir: true, minify: false,
  lib: { entry: process.env.LIGHTS_ENTRY ?? 'research/many-lights/integration-entry.ts', formats: ['iife'], name: 'RoyalLightIntegrationProbe', fileName: () => 'probe.js' } },
});
