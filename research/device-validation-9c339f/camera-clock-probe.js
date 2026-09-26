(() => {
 const snapshot=()=>window.__royalExamplesRendererBenchmarkSnapshot();
 const canvas=document.querySelector('canvas'),rect=canvas.getBoundingClientRect();
 const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
 const dispatch=(type,dx,buttons)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,button:type==='pointermove'?-1:0,buttons,clientX:x+dx,clientY:y,pointerId:1,pointerType:'mouse'}));
 window.clockProbe={running:true,before:snapshot(),userAgent:navigator.userAgent,samples:[]};
 const p=window.clockProbe;
 void(async()=>{
  dispatch('pointerdown',0,1);
  try{
   for(let i=0;i<60;i++){
    const before=snapshot().frame,start=performance.now();dispatch('pointermove',i<30?i+1:59-i,1);
    await new Promise(requestAnimationFrame);
    let retries=0;while(snapshot().frame===before&&retries++<120)await new Promise(requestAnimationFrame);
    p.samples.push({ms:performance.now()-start,frameDelta:snapshot().frame-before});
   }
  }finally{dispatch('pointerup',0,0);}
  p.after=snapshot();const values=p.samples.map(v=>v.ms).sort((a,b)=>a-b);
  p.p50Ms=values[Math.floor(values.length*.5)];p.p95Ms=values[Math.floor(values.length*.95)];p.maxMs=values.at(-1);p.pass=p.samples.length===60&&p.samples.every(v=>v.frameDelta>0&&v.ms>=0);
 })().catch(e=>p.error=String(e)).finally(()=>p.running=false);
 return 'started';
})()
