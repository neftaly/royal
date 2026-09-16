// Integration benchmark: run against a rebuilt Royal linked into Probability.
const {createRequire}=require('node:module');
const {writeFileSync}=require('node:fs');
const {resolve}=require('node:path');
const probability=process.env.PROBABILITY_DIR??resolve(__dirname,'../../../probability');
const appRequire=createRequire(resolve(probability,'apps/onboarding/package.json'));
const report=process.env.ROYAL_ANISO_REPORT??resolve(__dirname,'performance.json');
const {chromium}=appRequire('@playwright/test');
(async()=>{
const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
const results=[];try {for(const anisotropy of [1,4,16,16,4,1]){
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1});
const errors=[];let patched=0;
if(anisotropy!==16) await context.route('**/*renderer-webgl/dist/index.js*',async route=>{
 const response=await route.fetch(); let body=await response.text();
 if(body.includes('e.anisotropy === void 0 ? 16 : e.anisotropy')){patched++;body=body.replace('e.anisotropy === void 0 ? 16 : e.anisotropy',`e.anisotropy === void 0 ? ${anisotropy} : e.anisotropy`);}
 await route.fulfill({response,body});
});
await context.addInitScript(()=>{
 const WS=window.WebSocket;window.WebSocket=function(url,protocols){if(protocols==='vite-hmr')return {addEventListener(){},removeEventListener(){},send(){},close(){},readyState:1};return new WS(url,protocols)};Object.assign(window.WebSocket,{OPEN:1,CLOSED:3});
 const state=window.top.__royalPerf??={samples:[],enabled:false,draws:0,contexts:new Set(),pixel:new Uint8Array(4)};window.__perf=state;
 const isPlay=location.pathname.startsWith('/play');
 const getContext=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...args){const gl=getContext.apply(this,args);if(isPlay&&args[0]==='webgl2'&&gl)state.contexts.add(gl);return gl};
 for(const name of ['drawArrays','drawElements','drawArraysInstanced','drawElementsInstanced']){const original=WebGL2RenderingContext.prototype[name];WebGL2RenderingContext.prototype[name]=function(...args){if(isPlay)state.draws++;return original.apply(this,args)}}
 const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>raf(time=>{const before=state.draws,start=performance.now();callback(time);const submitted=performance.now();if(state.enabled&&state.draws>before){for(const gl of state.contexts)gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,state.pixel);state.samples.push({cpu:submitted-start,completed:performance.now()-start,draws:state.draws-before})}});
 const locations=new WeakMap();window.__aniso={hardware:[],virtual:[]};
 const proto=WebGL2RenderingContext.prototype;
 const get=proto.getUniformLocation;proto.getUniformLocation=function(p,n){const l=get.call(this,p,n);if(l)locations.set(l,n);return l};
 const uniform=proto.uniform4fv;proto.uniform4fv=function(l,v,...args){if(locations.get(l)==='virtualSettings1'&&!window.__aniso.virtual.includes(v[3]))window.__aniso.virtual.push(v[3]);return uniform.call(this,l,v,...args)};
 const sampler=proto.samplerParameterf;proto.samplerParameterf=function(s,p,v){if(p===0x84fe&&!window.__aniso.hardware.includes(v))window.__aniso.hardware.push(v);return sampler.call(this,s,p,v)};
});
const page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('BROWSER ERROR',m.text())}});
page.on('response',r=>{if(r.status()>=400&&r.request().resourceType()==='script')errors.push(r.url()+': '+r.status());});
await page.goto(`${process.env.PROBABILITY_URL??'http://localhost:3001'}/onboarding?diagnostics=1`);
await page.waitForFunction(()=>performance.getEntriesByName('onboarding:play-scene-ready').length>0,{},{timeout:45000});
await page.locator('iframe[title="Imported game in Play"]').scrollIntoViewIfNeeded();
const frame=page.frames().find(f=>f.url().includes('embedded=onboarding'));
console.log('camera', await frame.evaluate(()=>{
const c=document.querySelector('canvas');let node=c[Object.keys(c).find(k=>k.startsWith('__reactFiber$'))];while(node.return)node=node.return;
let props;const visit=n=>{if(!n)return;if(n.memoizedProps?.camera?.setView&&n.memoizedProps?.pieces)props=n.memoizedProps;visit(n.child);visit(n.sibling)};visit(node);
if(!props)throw Error('Camera controller not found');const piece=props.pieces.find(p=>p.piece.importSource?.includes('business-card-front'));if(!piece)throw Error('Business card missing');
const view={...props.camera.getView(),target:[...piece.worldPosition],distance:0.16,pitch:0.5,yaw:0};props.camera.setView(view);window.__camera=props.camera;return view;
}));
await page.waitForTimeout(250);
const settle=()=>frame.waitForFunction(()=>{const s=window.__playDiagnostics?.()?.snapshot;return s&&s.context.phase==='active'&&s.resources.virtualTextures.desiredPages>0&&!s.resources.virtualTextures.pendingPages&&!s.resources.virtualTextures.unresidentPages&&!s.resources.asyncPreparation.activeJobs;},{},{timeout:45000});
console.log('rendering',anisotropy,patched);
try {await settle();} catch(e) {console.log('settle failed',JSON.stringify({errors, data:await frame.evaluate(()=>({snapshot:window.__playDiagnostics?.()?.snapshot,settings:window.__aniso}))}));throw e;}

for(const pitch of [0.5,0.12]) {
 await frame.evaluate(pitch=>window.__camera.setView({...window.__camera.getView(),pitch,yaw:0}),pitch);await settle();
 const data=await frame.evaluate(async()=>{
  const next=()=>new Promise(resolve=>requestAnimationFrame(resolve));
  const camera=window.__camera,base=camera.getView();
  for(let i=0;i<120;i++){if(i===40){window.__perf.samples=[];window.__perf.enabled=true;}camera.setView({...base,yaw:Math.sin(i*.1)*.025});await next();await next();}
  window.__perf.enabled=false;
  const gl=document.querySelector('canvas').getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');
  return {samples:window.__perf.samples,snapshot:window.__playDiagnostics().snapshot,settings:window.__aniso,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),error:gl.getError()};
 });
 if(data.samples.length<40||data.error||errors.length||!data.settings.virtual.includes(anisotropy))throw Error(JSON.stringify({errors,data}));
 const percentile=(name,p)=>{const s=data.samples.map(v=>v[name]).sort((a,b)=>a-b);return s[Math.floor(s.length*p)]};
 const summary={anisotropy,pitch,n:data.samples.length,cpu50:percentile('cpu',.5),cpu95:percentile('cpu',.95),completed50:percentile('completed',.5),completed95:percentile('completed',.95),pages:data.snapshot.resources.virtualTextures.desiredPages,atlasBytes:data.snapshot.resources.virtualTextures.atlasBytes,renderer:data.renderer};
 console.log(JSON.stringify(summary));results.push({...summary,...data});writeFileSync(report,JSON.stringify(results,null,2));
}
await page.goto('about:blank',{waitUntil:'networkidle'});await context.close();
}}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
