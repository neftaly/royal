// Independent double-precision reference, sampled outside the timed GPU loop.
const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const normalize=a=>{const length=Math.hypot(...a);return a.map(x=>x/length);};
const clamp=x=>Math.max(0,Math.min(1,x));
export const referencePixel=(data,count,x,y,size,depth)=>{
 const position=[(x+0.5)/size*8-4,(y+0.5)/size*8-4,depth];
 const normal=normalize([0.1*Math.sin(position[0]),0.1*Math.cos(position[1]),1]);
 const view=normalize([-position[0],-position[1],6-depth]);
 const nv=Math.max(dot(normal,view),0),lit=[0,0,0],base=[0.6,0.4,0.2];
 for(let i=0;i<count;i++){
  const light=data.subarray(i*16,i*16+16);
  let direction=Array.from(light.subarray(4,7),x=>-x),attenuation=1;
  if(light[3]>0.5){
   const vector=position.map((p,k)=>light[8+k]-p);
   const squared=Math.max(dot(vector,vector),0.000001);
   direction=vector.map(v=>v/Math.sqrt(squared));attenuation=1/squared;
   if(light[11]>0){const ratioSquared=squared/(light[11]*light[11]);attenuation*=Math.max(1-ratioSquared*ratioSquared,0)**2;}
   if(light[3]>1.5){const angle=-dot(direction,light.subarray(4,7));const t=clamp((angle-light[13])/(light[12]-light[13]));attenuation*=t*t*(3-2*t);}
  }
  const nl=Math.max(dot(normal,direction),0);if(nl<=0)continue;
  const h0=direction.map((v,k)=>v+view[k]);const h=dot(h0,h0)<=1e-8?normal:normalize(h0);
  const nh=Math.max(dot(normal,h),0),vh=Math.max(dot(view,h),0),f=0.04+0.96*(1-clamp(vh))**5;
  const denominator=nh*nh*(0.0625-1)+1;
  const distribution=0.0625/Math.max(Math.PI*denominator*denominator,0.0001);
  const visibility=0.5/Math.max(nl*Math.sqrt(Math.max(nv*nv*(1-0.0625)+0.0625,0))+nv*Math.sqrt(Math.max(nl*nl*(1-0.0625)+0.0625,0)),0.0001);
  for(let c=0;c<3;c++)lit[c]+=(base[c]*(1-f)/Math.PI+f*distribution*visibility)*nl*light[c]*attenuation;
 }
 return [...lit.map(v=>Math.round(clamp(Math.max(v,0)**(1/2.2))*255)),179];
};
