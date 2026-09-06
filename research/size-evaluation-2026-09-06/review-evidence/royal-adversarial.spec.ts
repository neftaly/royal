import {test,expect} from '@playwright/test';
for (const name of ['duck.glb','duck.gltf']) {
 test(`missing Draco rejects ${name} without hanging or an unhandled rejection`,async({context,page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*draco-codec*.js',route=>route.abort());
  await page.goto('http://127.0.0.1:3319/');await page.waitForFunction(()=>window.ready);
  const result=await page.evaluate(async(name)=>{
   try{await window.runDecode(name);return 'unexpected success';}catch(e){return String(e);}
  },name);
  expect(result).toMatch(/fetch|import|module/i);
  expect(errors).toEqual([]);
 });
}
test('unavailable Worker API retains serial Draco and Meshopt decoding',async({page})=>{
 await page.addInitScript(()=>{window.Worker=undefined as any;});
 await page.goto('http://127.0.0.1:3319/');await page.waitForFunction(()=>window.ready);
 const draco=await page.evaluate(()=>window.runDecode('duck.gltf'));
 expect(draco.geometry.length).toBeGreaterThan(0);
 const meshopt=await page.evaluate(()=>window.runDecode('meshopt.gltf'));
 expect(meshopt.geometry[0].positions).toEqual([-1,-1,0,1,-1,0,0,1,0]);
});
