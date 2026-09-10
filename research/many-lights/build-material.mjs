import { build } from 'vite';
await build({
 configFile:false,
 build:{outDir:'/tmp/royal-many-light-material',emptyOutDir:true,minify:false,
  lib:{entry:'research/many-lights/material-entry.ts',formats:['iife'],name:'RoyalLightMaterialProbe',fileName:()=> 'probe.js'}},
});
