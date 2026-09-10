import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { connectCdpPage, evaluate, spawnLogged, stopProcess } from '../../apps/examples-react/scripts/browser-harness.mjs';

const base=process.env.LIGHTS_BASE ?? 'http://127.0.0.1:4583';
const external=process.env.LIGHTS_CDP_PORT;
const profile=external?null:await mkdtemp(path.join(tmpdir(),'royal-lights-'));
let port=Number(external ?? '0');
const browser=external?null:spawnLogged('chromium',[
 '--headless=new','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle',
 '--use-angle=swiftshader-webgl','--enable-unsafe-swiftshader',
 `--remote-debugging-port=${port}`,'--remote-allow-origins=*',`--user-data-dir=${profile}`,'about:blank',
]);
let session;
try{
 if(!external){const deadline=Date.now()+15000;for(;;){try{port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]);break;}catch(error){if(Date.now()>deadline)throw error;await new Promise(resolve=>setTimeout(resolve,50));}}}
 session=await connectCdpPage({debugHost:'127.0.0.1',debugPort:port,commandTimeoutMs:Number(process.env.LIGHTS_TIMEOUT_MS ?? 1800000)});
 const errors=[];await session.call('Runtime.enable');await session.call('Page.enable');
 session.on('Runtime.exceptionThrown',event=>errors.push(event.exceptionDetails.text));
 const loaded=session.wait('Page.loadEventFired',()=>true,{timeoutMs:30000});
 await session.call('Page.navigate',{url:base+'/@fs'+path.resolve('research/many-lights/probe.html')});await loaded;
 if(process.env.LIGHTS_INLINE_FILE) await evaluate(session,await readFile(process.env.LIGHTS_INLINE_FILE,'utf8'));
 const options=JSON.parse(process.env.LIGHTS_OPTIONS ?? '{}');
 const expression=process.env.LIGHTS_EXPRESSION ?? `window.runManyLights(${JSON.stringify(options)})`;
 const result=await evaluate(session,expression);
 if(errors.length)throw new Error(errors.join('\n'));
 const destination=process.env.LIGHTS_REPORT ?? 'research/many-lights/software-results.json';
 await writeFile(destination,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({destination,capabilities:result.capabilities,cases:result.results?.length}));
}finally{
 session?.close();if(browser)await stopProcess(browser);if(profile)await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
