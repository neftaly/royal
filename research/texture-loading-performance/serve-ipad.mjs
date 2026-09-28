import http from 'node:http';
import https from 'node:https';
import {readFileSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
// Local physical-device fixture: only the known iPad may fetch game assets.
const root=process.env.ROYAL_DEVICE_BUILD??'/tmp/royal-nova-production';
const publicRoot='/home/neftaly/dev/probability/apps/site/public';
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
https.createServer({key:readFileSync('/tmp/royal-ipad-test-key.pem'),cert:readFileSync('/tmp/royal-ipad-test-cert.pem')},async(req,res)=>{
 if(req.socket.remoteAddress!=='192.168.0.80'){res.writeHead(403).end();return;}
 if(req.url.startsWith('/nova/')) {const upstream=http.request({hostname:'127.0.0.1',port:45944,path:'/compact/'+req.url.slice(6),method:req.method},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>res.writeHead(502).end());req.pipe(upstream);return;}
 try{
 const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const base=path.startsWith('/play')?root:publicRoot;
 let file=resolve(base,'.'+(base===root?path.slice(5):path));
 if(!file.startsWith(base+'/')&&file!==base){res.writeHead(403).end();return;}
 try{if((await stat(file)).isDirectory())file=resolve(file,'index.html');}catch{if(base===root&&!extname(path))file=resolve(root,'index.html');}
 let bytes=await readFile(file);if(extname(file)==='.html')bytes=Buffer.from(bytes.toString().replace('<head>',`<head><script>performance.setResourceTimingBufferSize(5000);if(new URLSearchParams(location.search).has('archive')){const original=window.fetch;window.fetch=function(input,init){const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.href);if(url.hostname==='registry.probabilityusercontent.nz'){if(new URLSearchParams(location.search).get('archive')==='off'&&url.pathname.endsWith('.zip'))return Promise.reject(new TypeError('Archive disabled by profiling control'));return original.call(this,input,{...init,cache:'no-store'});}return original.call(this,input,init);};}window.__royalDeviceErrors=[];window.__royalDeviceEvents=[];for(const name of ['webglcontextlost','webglcontextrestored'])addEventListener(name,e=>window.__royalDeviceEvents.push({type:name,time:performance.now(),status:e.statusMessage}),true);const report=e=>window.__royalDeviceErrors.push(String(e?.stack??e));addEventListener('error',e=>report(e.error??e.message));addEventListener('unhandledrejection',e=>report(e.reason));const oldError=console.error;console.error=(...a)=>{a.forEach(report);oldError.apply(console,a)};</script>`));res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'}).end(bytes);
 }catch{res.writeHead(404).end();}
}).listen(5200,'192.168.0.224',()=>console.log('iPad-only HTTPS fixture listening on 192.168.0.224:5200'));
