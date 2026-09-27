import {writeFile} from 'node:fs/promises';
import {connectCdpPage,evaluate} from '../../apps/examples-react/scripts/browser-harness.mjs';
const session=await connectCdpPage({debugHost:'127.0.0.1',debugPort:19386,commandTimeoutMs:30000});
const result={errors:[]};
const read=()=>evaluate(session,`({status:document.querySelector('[data-royal-xr-status]')?.dataset.royalXrStatus,text:document.querySelector('.xr-session-status')?.textContent,snapshot:window.__royalExamplesRendererBenchmarkSnapshot?.()})`);
const wait=async predicate=>{for(let n=0;n<300;n++){const s=await read();if(predicate(s))return s;await new Promise(r=>setTimeout(r,100));}throw new Error('XR state timed out: '+JSON.stringify(await read()));};
try {
 await session.call('Runtime.enable');
 session.on('Runtime.exceptionThrown',event=>result.errors.push(event.exceptionDetails));
 await session.call('Page.navigate',{url:'http://127.0.0.1:5197/webxr-vr'});
 result.before=await wait(s=>s.status==='available'&&s.snapshot?.gltfLoadDiagnostics?.assets?.every(a=>a.status==='ready'));
 await evaluate(session,"document.querySelector('.xr-session-button').click()",{userGesture:true});
 result.entered=await wait(s=>s.status==='active'||s.status==='suspended'||s.status==='error');
 if(result.entered.status!=='active')throw new Error('XR did not become active');
 result.active=await wait(s=>s.status==='active'&&s.snapshot?.frame>result.entered.snapshot.frame+20);
 await evaluate(session,"document.querySelector('.xr-session-button').click()",{userGesture:true});
 result.exited=await wait(s=>s.status==='available');
 if(result.errors.length)throw new Error('XR page reported exceptions');
 result.completed=true;
 console.log(JSON.stringify(result));
} catch(error){result.failure=String(error);throw error;}
finally {
 const state=await read().catch(()=>null);
 if(state&&['active','suspended'].includes(state.status)) await evaluate(session,"document.querySelector('.xr-session-button').click()",{userGesture:true}).catch(()=>{});
 await writeFile(new URL('./quest-xr.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 session.socket.close();
}
