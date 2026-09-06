import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
const require=createRequire('/home/neftaly/dev/probability/apps/play/package.json');
const {chromium}=require('@playwright/test');
const candidate=process.env.ROYAL_COLD_CANDIDATE??'candidate';
const output=process.env.ROYAL_COLD_OUTPUT??'/tmp/royal-dependency-cold-start/results.json';
const repetitions=Number(process.env.ROYAL_COLD_REPS??20);
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const samples=[];const metadata={browser:browser.version(),repetitions,profiles:{normal:'local gzip server, no added delay',latency:'80ms server delay plus gzip-body-size / 187500 bytes/sec, independently per response'},hardware:'Chromium headless SwiftShader; no A10 or Quest attached',warm:'reload within same browser context; cache enabled',cold:'new isolated browser context; cache empty; browser process reused'};
try{
 for(let rep=0;rep<repetitions;rep++)for(const profile of ['normal','latency'])for(const scenario of ['card','dracoMain','dracoWorker']){
  for(const variant of rep%2?[candidate,'baseline']:['baseline',candidate]){
   const context=await browser.newContext({viewport:{width:640,height:640}});
   const page=await context.newPage();const errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});
   const url=`http://127.0.0.1:3322/${profile}/${variant}/index.html?scenario=${scenario}`;
   for(const cache of ['cold','warm']){
    if(cache==='cold')await page.goto(url,{waitUntil:'domcontentloaded'});else await page.reload({waitUntil:'domcontentloaded'});
    try { await page.waitForFunction(()=>window.result,undefined,{timeout:30000}); } catch(e) { console.log(JSON.stringify({url,errors,state:await page.evaluate(()=>({result:window.result,snapshot:window.root?.getSnapshot()}))})); throw e; }
    const result=await page.evaluate(()=>window.result);
    if(result.error||errors.length)throw new Error(JSON.stringify({rep,profile,scenario,variant,result,errors}));
    samples.push({rep,profile,scenario,variant,cache,...result});
    if(rep===0&&profile==='normal'&&cache==='cold')await page.screenshot({path:`/tmp/royal-dependency-cold-start/${variant}-${scenario}.png`});
   }
   await context.close();
  }
  writeFileSync(output,JSON.stringify({metadata,samples},null,2));
  console.log(JSON.stringify({completed:samples.length,rep,profile,scenario,lastPair:samples.slice(-4).map(s=>({variant:s.variant,cache:s.cache,ready:Math.round(s.readyAt),settled:Math.round(s.settledAt)}))}));
 }
}finally{await browser.close();}
