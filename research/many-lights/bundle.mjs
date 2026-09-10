import { build } from 'vite';
import { gzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
const result=await build({configFile:false,logLevel:'warn',build:{write:false,minify:true,
 lib:{entry:'packages/renderer-webgl/src/surface/large-light-activation.ts',formats:['es']},
 rollupOptions:{output:{entryFileNames:'entry.js',chunkFileNames:'[name].js'}}}});
const chunks=(Array.isArray(result)?result:[result]).flatMap(r=>r.output).filter(x=>x.type==='chunk');
const report=chunks.map(chunk=>({file:chunk.fileName,entry:chunk.isEntry,bytes:Buffer.byteLength(chunk.code),gzipBytes:gzipSync(chunk.code).length,imports:chunk.imports,dynamicImports:chunk.dynamicImports}));
await writeFile('research/many-lights/bundle-results.json',JSON.stringify({scope:'Isolated candidate lifecycle and lazy runtime, not an integrated Royal bundle delta',chunks:report},null,2)+'\n');
console.log(JSON.stringify(report,null,2));
