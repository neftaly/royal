import { build } from 'vite';
await build({
  configFile: false,
  build: { outDir: '/tmp/royal-light-rejection', emptyOutDir: true, minify: false,
    lib: { entry: 'research/many-lights/light-rejection.ts', formats: ['iife'], name: 'RoyalLightRejection', fileName: () => 'probe.js' } },
});
