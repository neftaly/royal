import {connectCdpPage,evaluate} from '../../apps/examples-react/scripts/browser-harness.mjs';
import {writeFile} from 'node:fs/promises';
const s=await connectCdpPage({debugHost:'127.0.0.1',debugPort:9222,commandTimeoutMs:30000});
try {
 await s.call('Page.enable');await s.call('Page.navigate',{url:'http://127.0.0.1:5193/compact-fallback-probe.html'});
 let r;
 for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));r=await evaluate(s,'window.compactResult');if(r)break;}
 await writeFile(new URL('./quest-compact-fallback.json',import.meta.url),JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify(r));
}finally{s.close();}
