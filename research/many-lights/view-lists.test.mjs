import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildViewLists } from './view-lists.mjs';

const perspective = (near = 0.1, far = 100, shift = 0) => [1.3,0,0,0, 0,1.7,0,0, shift,0,(far+near)/(near-far),-1, 0,0,2*far*near/(near-far),0];
const orthographic = [0.2,0,0,0, 0,0.25,0,0, 0,0,-0.02,0, 0,0,-1.002,1];
const projected = (m, [x,y,z]) => {
  const clip = [0,1,2,3].map(i => m[i]*x+m[i+4]*y+m[i+8]*z+m[i+12]);
  return clip.slice(0,3).map(v => v/clip[3]);
};
const tileLights = (result, x, y) => {
  const header = (y * result.columns + x) * 2;
  return result.words.subarray(result.words[header], result.words[header] + result.words[header+1]);
};
let seed=0x537ab12;
const random=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/2**32; };

test('every visible sampled point within a bounded light sphere retains that light', () => {
  let checked=0;
  for (const matrix of [perspective(),perspective(0.7,25,-0.12),perspective(0.7,25,0.12),orthographic]) {
    const lights=Array.from({length:128},(_,i)=>({kind:i%2?'spot':'point',position:[(random()-.5)*15,(random()-.5)*12,-random()*25],range:0.1+random()*5}));
    const lists=buildViewLists(lights,matrix); assert.equal(lists.kind,'tiled');
    for(let index=0;index<lights.length;index++) {
      const light=lights[index];
      for(let sample=0;sample<128;sample++) {
        let offset;
        do { offset=[random()*2-1,random()*2-1,random()*2-1]; } while(Math.hypot(...offset)>1);
        const point=light.position.map((value,i)=>value+offset[i]*light.range);
        const ndc=projected(matrix,point);
        if(point[2]>=0 || ndc.some(v=>v<=-1 || v>=1)) continue;
        const x=Math.floor((ndc[0]+1)*lists.columns/2), y=Math.floor((ndc[1]+1)*lists.rows/2);
        assert.ok(tileLights(lists,x,y).includes(index),JSON.stringify({index,point,ndc,x,y})); checked++;
      }
    }
  }
  assert.ok(checked>10000);
});

test('global lights are never culled, dense lists retain every record in source order', () => {
  const lights=Array.from({length:512},(_,i)=>({kind:i%3?'point':'directional',position:[100,100,100],range:i%2?0:undefined}));
  const lists=buildViewLists(lights,perspective());assert.equal(lists.kind,'tiled');assert.equal(lists.maxCount,512);
  assert.deepEqual(Array.from(tileLights(lists,8,8)),lights.map((_,i)=>i));
  assert.equal(buildViewLists(lights,perspective(),{byteBudget:2048}).kind,'global');
});

test('camera-inside, near-plane intersections and tile-boundary tangencies remain conservative', () => {
  const lights=[{kind:'point',position:[0,0,0],range:2},{kind:'spot',position:[0,0,-0.1],range:0.2}];
  const lists=buildViewLists(lights,perspective());assert.equal(lists.kind,'tiled');
  for(let y=0;y<16;y++)for(let x=0;x<16;x++) assert.deepEqual(Array.from(tileLights(lists,x,y)),[0,1]);
});

test('offscreen finite spheres disappear but missing ranges stay global', () => {
  const lists=buildViewLists([{kind:'point',position:[100,100,-2],range:1},{kind:'point',position:[100,100,-2]}],perspective());
  assert.equal(lists.kind,'tiled');assert.equal(lists.maxCount,1);assert.deepEqual(Array.from(tileLights(lists,4,4)),[1]);
  assert.equal(buildViewLists([],perspective()).uploadBytes,2048);
});
