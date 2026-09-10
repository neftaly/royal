import { buildViewLists } from './view-lists.mjs';
import { buildViewListsFactored } from './view-lists-factored.mjs';
import { buildViewListsFast } from './view-lists-fast.mjs';

export const runViewListPerf = async ({samples=15,counts=[256,512],grids=[[16,16],[32,18]]}={}) => {
  const results=[];
  const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
  for(const [columns,rows] of grids)for(const kind of ['sparse','dense','unbounded'])for(const count of counts){
    const lights=Array.from({length:count},(_,i)=>({kind:i%3===0?'spot':'point',position:[((i*37)%101)/101*8-4,((i*19)%97)/97*6-3,-1-((i*31)%89)/89*10],range:kind==='unbounded'?0:kind==='dense'?20:1.5}));
    const near=.1,far=30,matrix=[1.3,0,0,0,0,1.7,0,0,-.12,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
    const options={columns,rows,byteBudget:4*1024*1024};
    const reference=buildViewLists(lights,matrix,options),actual=buildViewListsFast(lights,matrix,options);
    if(reference.kind!==actual.kind||reference.kind!=='tiled'||actual.kind!=='tiled'||reference.words.length!==actual.words.length||reference.words.some((v,i)=>v!==actual.words[i]))throw new Error('CSR parity failure');
    const factoredValue=buildViewListsFactored(lights,matrix,options);
    if(factoredValue.kind!=='tiled'||factoredValue.words.length!==reference.words.length||reference.words.some((v,i)=>v!==factoredValue.words[i]))throw new Error('Factored CSR parity failure');
    const baseline=[],fast=[],factored=[];
    for(let sample=0;sample<samples;sample++){
      for(const mode of sample%3===0?['baseline','fast','factored']:sample%3===1?['factored','baseline','fast']:['fast','factored','baseline']){
        const start=performance.now();const value=(mode==='factored'?buildViewListsFactored:mode==='fast'?buildViewListsFast:buildViewLists)(lights,matrix,options);const ms=performance.now()-start;
        if(value.kind!=='tiled'||value.words.length!==reference.words.length)throw new Error('Non-deterministic list');
        (mode==='factored'?factored:mode==='fast'?fast:baseline).push(ms);
      }
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    results.push({columns,rows,kind,count,uploadBytes:actual.uploadBytes,meanCount:actual.meanCount,baselineMs:{median:percentile(baseline,.5),p95:percentile(baseline,.95),samples:baseline},factoredMs:{median:percentile(factored,.5),p95:percentile(factored,.95),samples:factored},fastMs:{median:percentile(fast,.5),p95:percentile(fast,.95),samples:fast}});
    document.querySelector('#status')?.replaceChildren(`${columns}x${rows} ${kind} ${count}`);
  }
  return {date:new Date().toISOString(),userAgent:navigator.userAgent,results};
};
Object.assign(globalThis,{runManyLights:runViewListPerf});
