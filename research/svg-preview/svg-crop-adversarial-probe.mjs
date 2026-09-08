/** Regression: crop rendering must preserve document-root CSS and viewport units. */
import {parseSvgTextureSource} from '../../packages/renderer-webgl/src/texture/svg-source.ts';

export async function runSvgCropAdversarialProbe(){
 const {createAutomaticSvgPageSource}=await import('../../packages/renderer-webgl/src/virtual-texture/automatic-page-source.ts');
 const results=[];
 for(const [name,attrs,content] of [
 ['viewport-looking-id','width="200" height="100" viewBox="0 0 200 100"','<defs><linearGradient id="50vw"><stop stop-color="red"/><stop offset="1" stop-color="red"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#50vw)"/>'],
 ['selector-specificity','width="200" height="100" viewBox="0 0 200 100"','<style>:root > rect {fill:red}.blue {fill:blue} rect {fill:green}</style><rect class="blue" width="100%" height="100%"/>'],
 ['selector-list-specificity','width="200" height="100" viewBox="0 0 200 100"','<style>#absent, rect {fill:red}.blue {fill:blue}</style><rect class="blue" width="100%" height="100%"/>'],
 ['nested-svg-selector','width="200" height="100" viewBox="0 0 200 100"','<style>svg svg rect {fill:blue}</style><rect width="100%" height="100%" fill="red"/>'],
 ['authored-transform','width="200" height="100" viewBox="0 0 200 100" transform="translate(20 10)"','<rect width="100%" height="100%" fill="red"/>'],
 ['root-child-selector','width="200" height="100" viewBox="0 0 200 100"','<style>:root > rect {fill:red}</style><rect width="100%" height="100%"/>'],
 ['css-root-size','width="200" height="100" viewBox="0 0 200 100" style="width:100px;height:100px"','<rect width="100%" height="100%" fill="red"/><rect width="50%" height="100%" fill="blue"/>'],
 ['em-root-size','width="20em" height="10em" viewBox="0 0 200 100"','<rect width="100%" height="100%" fill="red"/><rect width="50%" height="100%" fill="blue"/>'],
 ['svg-selector-size','width="200" height="100" viewBox="0 0 200 100"','<style>svg {width:200px;height:100px}</style><rect width="100%" height="100%" fill="red"/>'],
 ['viewport-units','width="200" height="100" viewBox="0 0 200 100"','<rect width="100%" height="100%" fill="red"/><rect width="50vw" height="100%" fill="blue"/>']
 ]){
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${content}</svg>`;
 const blob=new Blob([svg],{type:'image/svg+xml'}),url=URL.createObjectURL(blob),img=new Image();img.src=url;await img.decode();
 const source=createAutomaticSvgPageSource({blob,byteLength:blob.size,parsed:parseSvgTextureSource(svg)},200,100,{wrapS:'clamp-to-edge',wrapT:'clamp-to-edge',minFilter:'linear',magFilter:'linear'},'srgb');
 const mip=5,width=source.manifest.width/2**mip,height=source.manifest.height/2**mip;
 const make=()=>{const c=document.createElement('canvas');c.width=width;c.height=height;return c.getContext('2d')};
 const ref=make();ref.drawImage(img,0,0,width,height);const expected=ref.getImageData(0,0,width,height).data;
 const actualCtx=make();const tile=await source.read({mip,x:0,y:0},new AbortController().signal);actualCtx.drawImage(tile.source,-2,-2);const actual=actualCtx.getImageData(0,0,width,height).data;
 let mismatches=0;for(let i=0;i<expected.length;i++)if(Math.abs(expected[i]-actual[i])>2)mismatches++;
 const at=(a,x,y)=>[...a.slice((y*width+x)*4,(y*width+x)*4+4)];
 results.push({name,width,height,naturalSize:[img.naturalWidth,img.naturalHeight],mismatches,center:{expected:at(expected,128,64),actual:at(actual,128,64)},grid:[32,96,160,224].map(y=>({y,expected:at(expected,128,y),actual:at(actual,128,y)}))});
 tile.close();source.close();URL.revokeObjectURL(url);
 if(mismatches)throw new Error(JSON.stringify(results.at(-1)));
 }
 return results;
}
