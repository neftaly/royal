import { build } from '/home/neftaly/dev/royal/node_modules/vite/dist/node/index.js';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const repo='/home/neftaly/dev/royal';
const root='/tmp/royal-size-experiments';
mkdirSync(root,{recursive:true});
process.chdir(repo+'/packages/renderer-webgl');
await build({configFile:repo+'/vite.config.ts',logLevel:'warn',worker:{format:'es'},build:{outDir:root+'/es-worker-package',sourcemap:false,emptyOutDir:true}});
const results={};
for (const variant of ['baseline','es-worker']) {
 const out=root+'/'+variant;
 const dist=variant==='baseline'?repo+'/packages/renderer-webgl/dist':root+'/es-worker-package';
 await build({root:repo+'/apps/examples-react/bundle-size/royal',configFile:false,logLevel:'warn',resolve:{alias:[{find:'@royal/renderer-core/render-object',replacement:repo+'/packages/renderer-core/dist/render-object.js'},{find:'@royal/renderer-core',replacement:repo+'/packages/renderer-core/dist/index.js'},{find:'@royal/renderer-webgl',replacement:dist+'/index.js'}]},build:{outDir:out,emptyOutDir:true,target:'safari17',manifest:true}});
 const files=readdirSync(out+'/assets').filter(x=>x.endsWith('.js')).map(name=>({name,bytes:gzipSync(readFileSync(out+'/assets/'+name),{level:9}).length}));
 results[variant]={total:files.reduce((a,b)=>a+b.bytes,0),files};
}
writeFileSync(root+'/results.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
