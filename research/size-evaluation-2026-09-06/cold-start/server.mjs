import http from 'node:http';
import {readFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
const root='/tmp/royal-cold-start';const cache=new Map();
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');const parts=url.pathname.split('/').filter(Boolean);
 if(parts.length<3){res.writeHead(404).end();return;}
 const [profile,variant,...rest]=parts;
 if(!['normal','latency'].includes(profile)||!['baseline','candidate','candidate-prefetch'].includes(variant)||rest.includes('..')){res.writeHead(404).end();return;}
 const file=path.join(root,variant,'dist',...rest);
 let entry=cache.get(file);
 if(!entry){try{const raw=readFileSync(file);const compress=/\.(js|html|gltf)$/.test(file);entry={body:compress?gzipSync(raw,{level:9}):raw,compress};cache.set(file,entry);}catch{res.writeHead(404).end();return;}}
 const types={'.js':'application/javascript','.html':'text/html','.gltf':'model/gltf+json','.glb':'model/gltf-binary','.png':'image/png'};
 const etag='"'+entry.body.length+'-'+path.basename(file)+'"';
 const headers={'Content-Type':types[path.extname(file)]??'application/octet-stream','Cache-Control':'public, max-age=3600',ETag:etag,...entry.compress?{'Content-Encoding':'gzip'}:{}};
 const delay=profile==='latency'?80+entry.body.length/187500*1000:0;
 setTimeout(()=>{res.writeHead(200,{...headers,'Content-Length':entry.body.length});res.end(entry.body);},delay);
}).listen(3321,'127.0.0.1');
