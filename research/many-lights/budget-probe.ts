import { captureImage } from '../../packages/renderer-webgl/src/capture';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { boxGeometry, directionalLight, mesh, orthographicCamera, scene, standardMaterial } from '../../packages/renderer-core/src/index';

export const runBudgetRecovery = async () => {
  const canvas=document.createElement('canvas');document.body.append(canvas);
  const root=createRendererRoot(canvas,{persistentGpuByteBudget:40000,antialias:true,alpha:true});
  const camera=orthographicCamera({left:-1,right:1,bottom:-1,top:1,position:[0,0,4]});
  const shape=mesh({geometry:boxGeometry(1),material:standardMaterial({color:[0.7,0.4,0.2,1]})});
  const input=(count:number)=>scene({camera,nodes:[shape,...Array.from({length:count},()=>directionalLight({direction:[0,0,-1],illuminanceLux:1/count}))]});
  const read=async()=>{
    const result=await captureImage(root,{timeoutMs:5000}),bitmap=await createImageBitmap(result.blob);
    const target=document.createElement('canvas');target.width=bitmap.width;target.height=bitmap.height;
    const ctx=target.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();return ctx.getImageData(0,0,target.width,target.height).data;
  };
  try {
    root.setSize({cssWidth:96,cssHeight:96,pixelRatio:1});root.setScene(input(256));const before=await read();
    root.setScene(input(512));let failure='';
    try{await read();}catch(error){failure=String(error);}
    if(!failure.includes('Large-light GPU budget exhausted'))throw new Error(`Expected explicit light-budget denial, got ${failure}`);
    root.setScene(input(1));const recovered=await read();let maxDifference=0;
    for(let i=0;i<before.length;i++)maxDifference=Math.max(maxDifference,Math.abs(before[i]!-recovered[i]!));
    if(maxDifference>2||root.getSnapshot().lastFrameFailure!==undefined)throw new Error('Replacement did not recover from budget denial');
    return {results:[{budgetBytes:40000,failure,recovered:true,maxDifference}]};
  } finally {root.dispose();canvas.remove();}
};
