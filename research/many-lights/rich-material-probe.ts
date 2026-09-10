import { captureImage } from '../../packages/renderer-webgl/src/capture';
import { createRendererRoot } from '../../packages/renderer-webgl/src/index';
import { boxGeometry, directionalLight, gltf, mesh, orthographicCamera, scene, studioEnvironment, unlitMaterial } from '../../packages/renderer-core/src/index';
import { staticTexturedTriangleGlb } from '../../tests/replacement/support/static-glb';

/** Actual glTF transmission/volume and shared material textures with large lights. */
export const runRichMaterials = async () => {
  const canvas=document.createElement('canvas');document.body.append(canvas);
  const root=createRendererRoot(canvas,{antialias:true,alpha:true});
  const camera=orthographicCamera({left:-1.2,right:1.2,bottom:-1.2,top:1.2,position:[0,0,4]});
  const background=mesh({geometry:boxGeometry(2),transform:{position:[0,0,-2]},material:unlitMaterial({color:[0.15,0.35,0.55,1]})});
  const urls:string[]=[];const results=[];
  try {
    root.setSize({cssWidth:96,cssHeight:96,pixelRatio:1});
    for(const textureSize of [2,1024]) {
      const source=document.createElement('canvas');source.width=source.height=textureSize;
      const context=source.getContext('2d')!;context.fillStyle='rgb(120,180,235)';context.fillRect(0,0,textureSize,textureSize);
      const png=Uint8Array.from(atob(source.toDataURL('image/png').split(',')[1]!),c=>c.charCodeAt(0));
      const padded=new Uint8Array(Math.ceil(png.length/4)*4);padded.set(png);
      const bytes=staticTexturedTriangleGlb(padded,'unused.png',document=>{
        document.nodes=[{mesh:0}];document.scenes=[{nodes:[0]}];document.scene=0;
        document.extensionsRequired=[];document.extensionsUsed=['KHR_materials_specular','KHR_materials_transmission','KHR_materials_volume','KHR_materials_ior'];
        document.materials=[{
          pbrMetallicRoughness:{baseColorFactor:[0.8,0.7,0.6,1],baseColorTexture:{index:0},metallicFactor:0.1,roughnessFactor:0.4,metallicRoughnessTexture:{index:0}},
          normalTexture:{index:0,scale:0.2},occlusionTexture:{index:0,strength:0.7},emissiveFactor:[0.03,0.01,0.02],emissiveTexture:{index:0},
          extensions:{KHR_materials_specular:{specularFactor:0.7,specularColorFactor:[0.8,0.9,1],specularTexture:{index:0},specularColorTexture:{index:0}},
            KHR_materials_transmission:{transmissionFactor:0.4,transmissionTexture:{index:0}},
            KHR_materials_volume:{thicknessFactor:0.2,thicknessTexture:{index:0},attenuationColor:[0.7,0.8,0.9],attenuationDistance:2},KHR_materials_ior:{ior:1.45}},
        }];
      });
      const src=URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>],{type:'model/gltf-binary'}));urls.push(src);
      let reference:Uint8ClampedArray|undefined;
      for(const count of [1,256,512,1]) {
        root.setScene(scene({camera,environment:studioEnvironment({radianceScaleNits:0.4}),nodes:[background,gltf({src}),...Array.from({length:count},()=>directionalLight({direction:[0,-0.6,-0.8],illuminanceLux:1/count}))]}));
        const capture=await captureImage(root,{timeoutMs:30000});
        const bitmap=await createImageBitmap(capture.blob),target=document.createElement('canvas');target.width=bitmap.width;target.height=bitmap.height;
        const ctx=target.getContext('2d')!;ctx.drawImage(bitmap,0,0);bitmap.close();const pixels=ctx.getImageData(0,0,target.width,target.height).data;
        reference??=pixels;let maxDifference=0;
        for(let i=0;i<pixels.length;i++)maxDifference=Math.max(maxDifference,Math.abs(pixels[i]!-reference[i]!));
        if(maxDifference>2)throw new Error(JSON.stringify({textureSize,count,maxDifference,snapshot:root.getSnapshot()}));
        results.push({textureSize,count,maxDifference,timings:capture.timings,resources:root.getSnapshot().resources});
      }
    }
    return {date:new Date().toISOString(),results};
  } finally {root.dispose();canvas.remove();for(const url of urls)URL.revokeObjectURL(url);}
};
