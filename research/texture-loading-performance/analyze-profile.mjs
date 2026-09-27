import {readFile,writeFile} from 'node:fs/promises';
const directory=process.argv[2];
if(!directory)throw Error('Usage: node analyze-profile.mjs /tmp/royal-nova-profiles/LABEL');
const profile=JSON.parse(await readFile(`${directory}/cpu.cpuprofile`,'utf8'));
const result=JSON.parse(await readFile(`${directory}/result.json`,'utf8'));
const nodes=new Map(profile.nodes.map(n=>[n.id,{...n,self:0,total:0}]));
for(let i=0;i<profile.samples.length;i++)nodes.get(profile.samples[i]).self+=(profile.timeDeltas[i]??0)/1000;
const sum=id=>{const n=nodes.get(id);return n.total=n.self+(n.children??[]).reduce((v,c)=>v+sum(c),0);};
const root=profile.nodes[0].id;sum(root);
const aggregate=new Map();
for(const n of nodes.values()){
 const f=n.callFrame,key=`${f.url}:${f.lineNumber+1} ${f.functionName||'(anonymous)'}`;
 aggregate.set(key,(aggregate.get(key)??0)+n.self);
}
const seen=new Map(),reductions=[];
for(const e of result.probe?.events??[]){
 if(e.kind!=='texture-upload'||!e.root||e.level!==0||!e.size?.[0]
   ||e.size[0]!==e.storage?.[0]||e.size[1]!==e.storage?.[1])continue;
 const previous=seen.get(e.root);
 if(previous&&previous.size[0]>e.size[0]*2&&previous.size[1]>e.size[1]*2)reductions.push({root:e.root,from:previous.size,to:e.size,time:e.time});
 if(!previous||previous.size[0]*previous.size[1]<e.size[0]*e.size[1])seen.set(e.root,e);
}
const summary={label:result.label,readyMs:result.readyMs,completed:result.completed,errors:result.errors,
 counts:result.probe?.counts,longTasks:result.probe?.longTasks.length,longTaskMs:result.probe?.longTasks.reduce((n,x)=>n+x.duration,0),
 sameSourceSizeReductions:reductions.length,topSelfMs:[...aggregate].sort((a,b)=>b[1]-a[1]).slice(0,40),snapshot:result.samples.at(-1)?.snapshot};
await writeFile(`${directory}/summary.json`,JSON.stringify(summary,null,2)+'\n');
const graph=JSON.stringify({root,nodes:[...nodes.values()]}).replaceAll('<','\\u003c');
await writeFile(`${directory}/flamegraph.html`,`<!doctype html><meta charset="utf-8"><title>Nova CPU flame graph</title><style>body{font:14px system-ui;margin:20px}button{margin:8px}#graph{position:relative} .frame{position:absolute;height:22px;box-sizing:border-box;border:1px solid white;overflow:hidden;white-space:nowrap;font:11px monospace;cursor:pointer;padding:3px}#info{white-space:pre-wrap;min-height:65px}</style><h1>Nova sampled CPU — ${result.label}</h1><p>Click a frame to zoom; width is inclusive sampled time, not elapsed loading time. Idle/program samples are retained. Open cpu.cpuprofile or trace.json.gz in Chrome DevTools for the original timeline.</p><button id="reset">Reset</button><div id="info"></div><div id="graph"></div><script>const data=${graph};const nodes=new Map(data.nodes.map(n=>[n.id,n]));const graph=document.querySelector('#graph'),info=document.querySelector('#info');function draw(id){graph.replaceChildren();const base=nodes.get(id);let depth=0;function frame(id,x,y){const n=nodes.get(id),w=n.total/base.total*100;depth=Math.max(depth,y);if(w<0.03)return;const e=document.createElement('div');e.className='frame';e.style.cssText='left:'+x+'%;top:'+(y*23)+'px;width:'+w+'%;background:hsl('+(20+(id*17)%50)+' 85% 72%)';e.textContent=n.callFrame.functionName||'(anonymous)';e.onmouseenter=()=>info.textContent=e.textContent+'\\nSelf: '+n.self.toFixed(1)+' ms; inclusive: '+n.total.toFixed(1)+' ms\\n'+n.callFrame.url+':'+(n.callFrame.lineNumber+1);e.onclick=()=>draw(id);graph.append(e);let cx=x;for(const child of n.children??[]){frame(child,cx,y+1);cx+=nodes.get(child).total/base.total*100;}}frame(id,0,0);graph.style.height=((depth+1)*23)+'px';}document.querySelector('#reset').onclick=()=>draw(data.root);draw(data.root);</script>`);
console.log(JSON.stringify({readyMs:summary.readyMs,counts:summary.counts,longTaskMs:summary.longTaskMs,top:summary.topSelfMs.slice(0,12)},null,2));
