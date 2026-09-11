import assert from 'node:assert/strict';
import test from 'node:test';
import { buildViewLists } from './view-lists.mjs';
import { buildViewListsFactored } from './view-lists-factored.mjs';
import { buildViewListsFast } from './view-lists-fast.mjs';

test('optimized candidate loop preserves every CSR word and exhaustion decision',()=>{
  let seed=12345;const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  for(let trial=0;trial<80;trial++){
    const lights=Array.from({length:trial%3===0?512:Math.floor(random()*257)},()=>({kind:random()<.1?'directional':'point',position:[random()*100-50,random()*100-50,random()*100-50],range:random()<.15?0:random()*30}));
    const matrix=Array.from({length:16},()=>random()*4-2);
    const options={columns:1+Math.floor(random()*24),rows:1+Math.floor(random()*24),byteBudget:[0,2048,32768,1048576][trial%4]};
    assert.deepEqual(buildViewListsFactored(lights,matrix,options),buildViewLists(lights,matrix,options));
    assert.deepEqual(buildViewListsFast(lights,matrix,options),buildViewLists(lights,matrix,options));
  }
});
