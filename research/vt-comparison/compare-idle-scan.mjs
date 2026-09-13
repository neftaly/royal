import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const paths = { before: process.env.VT_BASELINE_FILE ?? '/tmp/royal-vt-before-idle-scan-runtime.ts', after: process.env.VT_CANDIDATE_FILE ?? 'packages/renderer-webgl/src/virtual-texture/runtime.ts' };
const sources = {}, functions = {};
for (const [name,path] of Object.entries(paths)) {
 const source = await readFile(path,'utf8');
 const body = source.match(/#schedulePageReads\(\): void \{([\s\S]*?)\n  \}\n\n  #pageSlot/)?.[1];
 if(!body) throw new Error('Scheduler method not found');
 sources[name]=body;
 functions[name]=new Function('state','MAX_DECODE_JOBS',stripTypeScriptTypes(body.replaceAll('this.#','state.')));
}
let seed=143;
const random=()=> (seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32;
const run=(name,input)=>{
 const state={...input,scheduleResources:input.scheduleResources.map(r=>({...r,jobs:r.jobs.map(j=>({...j}))})),started:[],cachedVisits:0,ordinaryVisits:0};
 state.startNextPageRead=(resource,cachedOnly=false)=>{
  if(cachedOnly)state.cachedVisits++;else state.ordinaryVisits++;
  const index=resource.jobs.findIndex(j=>(!cachedOnly||j.cached)&&(!j.detail||state.detailJobs===0));
  if(index<0)return false;
  const [job]=resource.jobs.splice(index,1);
  state.started.push([resource.id,job.id,cachedOnly]);state.activeJobs++;if(job.detail)state.detailJobs++;
  return true;
 };
 functions[name](state,4);
 return {started:state.started,cursor:state.scheduleCursor,active:state.activeJobs,detail:state.detailJobs,remaining:state.scheduleResources.map(r=>r.jobs),cachedVisits:state.cachedVisits,ordinaryVisits:state.ordinaryVisits};
};
let comparisons=0;
for(let trial=0;trial<10000;trial++) {
 const count=Math.floor(random()*33),activeJobs=Math.floor(random()*4);
 const input={activeJobs,readyPages:Math.floor(random()*3),detailJobs:activeJobs>0&&random()<.5?1:0,scheduleCursor:count?Math.floor(random()*(count+1)):0,
  scheduleResources:Array.from({length:count},(_,id)=>({id,jobs:Array.from({length:Math.floor(random()*5)},(_,id)=>({id,cached:random()<.5,detail:random()<.5}))}))};
 const before=run('before',input),after=run('after',input);
 const {cachedVisits:a,...oldState}=before,{cachedVisits:b,...newState}=after;
 if(JSON.stringify(oldState)!==JSON.stringify(newState)||b>a)throw new Error(`Scheduler mismatch ${trial}`);
 comparisons++;
}
const idle=[1,8,16,64].map(count=>{
 const input={activeJobs:0,readyPages:0,detailJobs:0,scheduleCursor:0,scheduleResources:Array.from({length:count},(_,id)=>({id,jobs:[]}))};
 return {resources:count,before:run('before',input),after:run('after',input)};
});
await writeFile('research/vt-comparison/idle-scan-comparison.json',JSON.stringify({sources,comparisons,idle,note:'Actual synchronous scheduler bodies with deterministic job queues. Tests cached/cold priority, cursor, slot limit and detail exclusivity across 10000 seeded states. Failed attempts do not complete asynchronous jobs; renderer tests cover real source work.'},null,2)+'\n');
