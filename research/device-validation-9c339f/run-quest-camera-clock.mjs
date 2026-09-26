import {connectCdpPage,evaluate} from '../../apps/examples-react/scripts/browser-harness.mjs';
import {writeFile,readFile} from 'node:fs/promises';
const s=await connectCdpPage({debugHost:'127.0.0.1',debugPort:9222,commandTimeoutMs:30000});
try {
 await evaluate(s,await readFile(new URL('./camera-clock-probe.js',import.meta.url),'utf8'));
 let r;
 for(let i=0;i<180;i++){await new Promise(r=>setTimeout(r,500));r=await evaluate(s,'window.clockProbe');if(r&&!r.running)break;}
 await writeFile(new URL('./quest/sponza-camera-clock.json',import.meta.url),JSON.stringify(r,null,2)+'\n');
 console.log(JSON.stringify(r));
}finally{s.close();}
