import {mkdtemp,mkdir,readFile,writeFile,open,rm} from 'node:fs/promises';
import {connectCdpPage,evaluate,spawnLogged,stopProcess} from '../../apps/examples-react/scripts/browser-harness.mjs';
const label=process.env.ROYAL_PROFILE_LABEL??'baseline';
const remotePort=Number(process.env.ROYAL_PROFILE_REMOTE_PORT??0);
const timingOnly=process.env.ROYAL_PROFILE_MODE==='timing';
const cpuOnly=process.env.ROYAL_PROFILE_MODE==='cpu';
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid profile label');
const directory=`/tmp/royal-nova-profiles/${label}`;
await mkdir(directory,{recursive:true});
const profile=await mkdtemp('/tmp/royal-nova-browser-');
const browser=remotePort?undefined:spawnLogged('chromium',[...(process.env.ROYAL_PROFILE_NETLOG==='1'?[`--log-net-log=${directory}/netlog.json`]:[]),...(process.env.ROYAL_PROFILE_QUIC==='force'?['--enable-quic','--origin-to-force-quic-on=registry.probabilityusercontent.nz:443']:process.env.ROYAL_PROFILE_QUIC==='off'?['--disable-quic']:[]),'--headless=new','--no-sandbox','--use-gl=angle','--use-angle=vulkan','--ignore-gpu-blocklist','--disable-software-rasterizer','--use-gpu-in-tests','--remote-allow-origins=*','--remote-debugging-port=19387',`--user-data-dir=${profile}`,'about:blank']);
const url=process.env.ROYAL_NOVA_URL??'http://localhost:3004/play/#template=http%3A%2F%2F127.0.0.1%3A45944%2Fcompact%2F';
const result={label,url,timingOnly,archiveDisabled:process.env.ROYAL_PROFILE_DISABLE_ARCHIVE==='1',quic:process.env.ROYAL_PROFILE_QUIC??'default',samples:[],requests:[],errors:[]};
let session,tracing=false,profiling=false;
try{
 session=await connectCdpPage({debugHost:'127.0.0.1',debugPort:remotePort||19387,commandTimeoutMs:60000});
 await session.call('Runtime.enable');await session.call('Network.enable');await session.call('Page.enable');
 if(!remotePort)await session.call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await session.call('Page.navigate',{url:'about:blank'});
 await session.call('Network.setCacheDisabled',{cacheDisabled:true});
 // Same wrapper in both arms; only the optional whole-archive request differs.
 await session.call('Page.addScriptToEvaluateOnNewDocument',{source:`(() => {
  performance.setResourceTimingBufferSize(5000);
  const original = window.fetch;
  window.fetch = function(input, init) {
   const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, location.href);
   if (${result.archiveDisabled} && url.hostname === 'registry.probabilityusercontent.nz' && url.pathname.endsWith('.zip')) return Promise.reject(new TypeError('Archive disabled by profiling control'));
   return original.call(this,input,init);
  };
 })()`});
 if(process.env.ROYAL_PROFILE_DISABLE_BACKFACES==='1') {
  result.backfacesDisabled=true;
  await session.call('Fetch.enable',{patterns:[{urlPattern:'*/renderer-webgl/dist/runtime-*.js*',requestStage:'Response'}]});
  session.on('Fetch.requestPaused',async e=>{
   try {
    const body=await session.call('Fetch.getResponseBody',{requestId:e.requestId});
    const source=Buffer.from(body.body,body.base64Encoded?'base64':'utf8').toString();
    const needle='< -1e-12 * Math.max(1, Math.abs(';
    const matches=source.split(needle).length-1;
    if(matches>1)throw Error('Ambiguous backface diagnostic patch');
    if(matches===1)result.backfacePatchApplied=true;
    await session.call('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:e.responseStatusCode??200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source.replace(needle,'< -Infinity * Math.max(1, Math.abs(')).toString('base64')});
   }catch(error){result.errors.push(String(error));await session.call('Fetch.continueRequest',{requestId:e.requestId});}
  });
 }
 if(process.env.ROYAL_PROFILE_DISABLE_ASTC==='1') {
  result.astcDisabled=true;
  await session.call('Page.addScriptToEvaluateOnNewDocument',{source:`(() => { const get = WebGL2RenderingContext.prototype.getExtension; WebGL2RenderingContext.prototype.getExtension = function(name) { return name === 'WEBGL_compressed_texture_astc' ? null : get.call(this,name); }; })()`});
 }
 await session.call('Page.addScriptToEvaluateOnNewDocument',{source:await readFile(new URL((timingOnly||cpuOnly)?'./timing-probe.js':'./browser-probe.js',import.meta.url),'utf8')});
 await session.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.__royalLoadingProbe.sample=()=>{${await readFile(new URL('./device-sample.js',import.meta.url),'utf8')}};`});
 if(process.env.ROYAL_PROFILE_SUPPORT_COUNTS==='1')await session.call('Page.addScriptToEvaluateOnNewDocument',{source:`
 const supportWorkers=new WeakSet();const NativeWorker=Worker;
 window.Worker=new Proxy(NativeWorker,{construct(target,args){const worker=Reflect.construct(target,args);if(String(args[0]).includes('support-worker'))supportWorkers.add(worker);return worker;}});
 const post=NativeWorker.prototype.postMessage;
 NativeWorker.prototype.postMessage=function(message,...args){if(supportWorkers.has(this)&&message?.method==='prepare'){const counts=window.__royalLoadingProbe.counts;counts.supportPreparations=(counts.supportPreparations??0)+1;}return post.call(this,message,...args);};
 `});
 const requests=new Map();
 session.on('Network.requestWillBeSent',e=>{const r={id:e.requestId,url:e.request.url,type:e.type,start:e.timestamp};requests.set(e.requestId,r);result.requests.push(r);});
 session.on('Network.responseReceived',e=>Object.assign(requests.get(e.requestId)??{}, {protocol:e.response.protocol,connectionId:e.response.connectionId,connectionReused:e.response.connectionReused,status:e.response.status,mime:e.response.mimeType,response:e.timestamp,timing:e.response.timing,fromCache:e.response.fromDiskCache}));
 session.on('Network.loadingFinished',e=>Object.assign(requests.get(e.requestId)??{},{end:e.timestamp,encodedBytes:e.encodedDataLength}));
 session.on('Network.loadingFailed',e=>{Object.assign(requests.get(e.requestId)??{},{failure:e.errorText});if(e.type==='Script'&&!e.canceled)result.errors.push(e);});
 session.on('Runtime.exceptionThrown',e=>result.errors.push(e.exceptionDetails));
 session.on('Runtime.consoleAPICalled',e=>{if(e.type==='error')result.errors.push(e.args);});
 if(!timingOnly&&process.env.ROYAL_PROFILE_MODE!=='uploads'){
  await session.call('Profiler.enable');await session.call('Profiler.setSamplingInterval',{interval:1000});await session.call('Profiler.start');profiling=true;
  if(!cpuOnly)await session.call('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,v8,loading',transferMode:'ReturnAsStream',streamCompression:'gzip'});tracing=!cpuOnly;
 }
 await session.call('Page.navigate',{url});
 let settled=0,lastLog=0;
 for(let n=0;n<1800;n++){
  const sample=await evaluate(session,'window.__royalLoadingProbe?.sample()');
  if(sample){result.samples.push(sample);if(result.errors.length)throw Error('Page reported errors during loading');if(sample.models?.total===211&&sample.models.interactive===211&&result.interactionReadyMs===undefined)result.interactionReadyMs=sample.time;const s=sample.snapshot,r=s?.resources;
   if(sample.time-lastLog>5000){lastLog=sample.time;console.log(JSON.stringify({ms:Math.round(sample.time),phase:s?.presentation,images:r?.imageTextures.residentTextures,pages:r?.virtualTextures.residentPages,text:sample.text}));}
   if(s?.presentation==='failed'||await evaluate(session,"!!document.querySelector('vite-error-overlay')"))throw Error('Page failed');
   const ready=s?.presentation==='ready'&&r.virtualTextures.automaticCandidates>=324&&r.gltfSourceReads.activeReads===0&&r.gltfSourceReads.queuedReads===0&&r.gltfSharedGeometry.pendingPreparationTasks===0;
   if(ready&&result.firstReadyMs===undefined)result.firstReadyMs=sample.time;
   settled=ready?settled+1:0;
   if(settled>=6){result.completed=true;result.readyMs=sample.time;break;}
  }
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!result.completed)throw Error('Nova did not settle');
 result.browser=await evaluate(session,`(() => { const gl=document.querySelector('canvas')?.getContext('webgl2'); const debug=gl?.getExtension('WEBGL_debug_renderer_info'); return {userAgent:navigator.userAgent,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl?.getParameter(gl.RENDERER)}; })()`);
 result.probe=await evaluate(session,'({events:window.__royalLoadingProbe.events,counts:window.__royalLoadingProbe.counts,longTasks:window.__royalLoadingProbe.longTasks})');
 const screenshot=await session.call('Page.captureScreenshot',{format:'png'});
 await writeFile(`${directory}/ready.png`,Buffer.from(screenshot.data,'base64'));
 if(process.env.ROYAL_PROFILE_ZOOM==='1') {
  result.zoom=[];
  const record=async label=>{const sample=await evaluate(session,'window.__royalLoadingProbe.sample()');result.zoom.push({label,...sample});return sample;};
  await record('initial');
  for(const [label,delta] of [['in-1',-1500],['out-1',1500],['in-2',-1500],['out-2',1500]]){
   const started=await evaluate(session,'performance.now()');
   await session.call('Input.dispatchMouseEvent',{type:'mouseWheel',x:640,y:425,deltaX:0,deltaY:delta});
   let stable=0,previous;
   for(let n=0;n<120;n++){
    await new Promise(resolve=>setTimeout(resolve,500));
    const sample=await record(label),vt=sample.snapshot?.resources.virtualTextures;
    const state=JSON.stringify([vt?.pageRequests,vt?.uploadedPages,vt?.residentPages,vt?.pendingDemandResources,vt?.pendingPages]);
    stable=state===previous&&vt?.pendingPages===0&&sample.snapshot?.presentation==='ready'?stable+1:0;previous=state;
    if(stable>=4){result.zoom.push({label:label+'-settled',elapsedMs:sample.time-started,...sample});break;}
    if(n===119)throw Error('Zoom did not settle: '+label);
   }
   const shot=await session.call('Page.captureScreenshot',{format:'png'});await writeFile(`${directory}/${label}.png`,Buffer.from(shot.data,'base64'));
  }
 }
 if(result.errors.length)throw Error('Page reported errors');
}catch(error){result.failure=String(error);throw error;}
finally{
 if(profiling){const p=await session.call('Profiler.stop');await writeFile(`${directory}/cpu.cpuprofile`,JSON.stringify(p.profile));}
 if(tracing){
  const finished=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Trace stop timed out')),30000);session.on('Tracing.tracingComplete',e=>{clearTimeout(timer);resolve(e);});});
  await session.call('Tracing.end');const {stream}=await finished;
  const file=await open(`${directory}/trace.json.gz`,'w');
  try{let chunk;do{chunk=await session.call('IO.read',{handle:stream,size:1048576});await file.write(Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8'));}while(!chunk.eof);}finally{await file.close();await session.call('IO.close',{handle:stream});}
 }
 try { await writeFile(`${directory}/result.json`,JSON.stringify(result,null,2)+'\n'); }
 finally {
  session?.socket.close();if(browser)await stopProcess(browser);await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
 }
 console.log(directory);
}
