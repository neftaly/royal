import asyncio,json,os
from pathlib import Path
from typer_injector import InjectingTyper
from pymobiledevice3.cli.cli_common import ServiceProviderDep,async_command
from pymobiledevice3.cli.webinspector import webinspector_service,SAFARI
from pymobiledevice3.services.web_protocol.driver import WebDriver
cli=InjectingTyper()
@cli.command()
@async_command
async def check(service_provider:ServiceProviderDep):
 async with webinspector_service(service_provider) as inspector:
  if os.environ.get('ROYAL_LOCAL_TEST_CERT') == '1':
   if not os.environ.get('ROYAL_GAME_URL','').startswith('https://192.168.0.224:5200/play/'):
    raise ValueError('Local test certificate exception requires the scoped iPad test origin')
   async def request_test_session(session_id,app_id):
    await inspector._send_message('_rpc_forwardAutomationSessionRequest:', {
     'WIRApplicationIdentifierKey':app_id,
     'WIRSessionIdentifierKey':session_id,
     'WIRSessionCapabilitiesKey':{'org.webkit.webdriver.accept-insecure-certificates':True},
    })
   inspector._forward_automation_session_request=request_test_session
  app=await inspector.open_app(SAFARI);session=await inspector.automation_session(app);driver=WebDriver(session)
  result={};samples=[];forced_generation=None;first_ready=None
  try:
   await asyncio.wait_for(driver.start_session(),20)
   url=os.environ.get('ROYAL_GAME_URL','http://192.168.0.224:3004/play/#{%22doc%22:%22automerge:3vtV6rcsy9fMYzNonX6DWkpTkwtZ%22,%22sync%22:[%22wss://subduction.sync.inkandswitch.com%22]}')
   await asyncio.wait_for(driver.get(url),30)
   if os.environ.get('ROYAL_PROFILE_UPLOADS') == '1':
    await driver.execute_script("""
performance.setResourceTimingBufferSize(5000);window.__royalUploadProfile={};const upload=WebGL2RenderingContext.prototype.texSubImage2D;
WebGL2RenderingContext.prototype.texSubImage2D=function(...args){const source=args.at(-1),key=Object.prototype.toString.call(source)+':'+(source?.width??args[4])+'x'+(source?.height??args[5]);const started=performance.now();try{return upload.apply(this,args);}finally{const duration=performance.now()-started;const stats=window.__royalUploadProfile[key]??={count:0,totalMs:0,maxMs:0};stats.count++;stats.totalMs+=duration;stats.maxMs=Math.max(stats.maxMs,duration);}};
""")
   started=asyncio.get_running_loop().time()
   for n in range(600):
    state=await asyncio.wait_for(driver.execute_script(Path(__file__).parent.parent.joinpath('texture-loading-performance/device-sample.js').read_text()),20)
    samples.append(state)
    if state.get('errors'):raise RuntimeError(json.dumps(state['errors']))
    if not state.get('snapshot'):state['noRenderer']=True
    if state and state.get('noRenderer'):
     if state.get('errors'):raise RuntimeError(json.dumps(state))
     state=None
    if not state and n%20==0:
     error=await driver.execute_script("""
const el=document.querySelector('[role=alert]');let f=el?.[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];
for(;f;f=f.return){let e=f.memoizedProps?.children;for(let n=0;e&&n<5;n++,e=e.props?.children){const result=e.type?._payload?._result;if(result instanceof Error)return {message:result.message,stack:result.stack,issues:result.issues,secure:isSecureContext,crypto:typeof crypto.subtle};}}
return null;
""")
     if error:raise RuntimeError(json.dumps(error))
     print(await driver.execute_script("return JSON.stringify({url:location.href,title:document.title,text:document.body.innerText.slice(0,1200),secure:window.isSecureContext})"),flush=True)
    if state:
     result=dict(state);r=state['snapshot']['resources'];p=state['snapshot']['presentation']
     if state['overlay'] or p=='failed':raise RuntimeError('Game presentation failed')
     if n%20==0:print(json.dumps({'presentation':p,'images':r['imageTextures']['residentTextures'],'pages':r['virtualTextures']['residentPages'],'time':state['time'],'context':state['snapshot']['context'],'models':state.get('models')}),flush=True)
     if p=='ready' and r['virtualTextures']['automaticCandidates']>=324 and r['gltfSourceReads']['activeReads']==0 and r['gltfSharedGeometry']['pendingPreparationTasks']==0 and state.get('models',{}).get('interactive')==state.get('models',{}).get('total'):
      if first_ready is None:first_ready=state['time']
      if os.environ.get('ROYAL_FORCE_CONTEXT_LOSS') == '1' and forced_generation is None:
       import base64
       Path('/tmp/royal-ipad-before-forced-loss.png').write_bytes(base64.b64decode((await driver.execute_script("const r=window.__royalDeviceRoot;r.invalidate();r.flushInvalidated();return r.canvas.toDataURL('image/png').split(',')[1];"))))
       forced_generation=state['snapshot']['context']['generation']
       await driver.execute_script("const extension=window.__royalDeviceRoot.canvas.getContext('webgl2').getExtension('WEBGL_lose_context');if(!extension)throw Error('Missing context-loss test extension');extension.loseContext();setTimeout(()=>extension.restoreContext(),100);")
       await asyncio.sleep(.5)
       continue
      if forced_generation is not None and state['snapshot']['context']['generation']<=forced_generation:
       await asyncio.sleep(.5)
       continue
      result['firstReadyMs']=first_ready;result['forcedContextLoss']=forced_generation is not None
      result['renderCompleted']=True;result['elapsedMs']=state['time'];print(json.dumps({'renderCompleted':True,'elapsedMs':state['time'],'context':state['snapshot']['context']}),flush=True)
      import base64
      Path(os.environ.get('ROYAL_DEVICE_SCREENSHOT','/tmp/royal-ipad-ready.png')).write_bytes(base64.b64decode((await driver.execute_script("const r=window.__royalDeviceRoot;r.invalidate();r.flushInvalidated();return r.canvas.toDataURL('image/png').split(',')[1];"))))
      if os.environ.get('ROYAL_ZOOM_CYCLES') == '1':
       result['zoom']=[{'label':'initial',**state}]
       sample_script=Path(__file__).parent.parent.joinpath('texture-loading-performance/device-sample.js').read_text()
       for label,delta in [('in-1',-1500),('out-1',1500),('in-2',-1500),('out-2',1500)]:
        start=await driver.execute_script(f"const c=window.__royalDeviceRoot.canvas,b=c.getBoundingClientRect();c.dispatchEvent(new WheelEvent('wheel',{{clientX:b.x+b.width/2,clientY:b.y+b.height/2,deltaY:{delta},bubbles:true,cancelable:true}}));return performance.now();")
        stable=0;previous=None
        for attempt in range(120):
         await asyncio.sleep(.5)
         zoom_state=await driver.execute_script(sample_script)
         if zoom_state.get('errors'):raise RuntimeError(json.dumps(zoom_state['errors']))
         vt=zoom_state['snapshot']['resources']['virtualTextures']
         signature=[vt.get(k) for k in ['pageRequests','uploadedPages','residentPages','pendingDemandResources','pendingPages']]
         stable=stable+1 if signature==previous and vt['pendingPages']==0 and zoom_state['snapshot']['presentation']=='ready' else 0
         previous=signature
         result['zoom'].append({'label':label,**zoom_state})
         if stable>=4:
          result['zoom'].append({'label':label+'-settled','elapsedMs':zoom_state['time']-start,**zoom_state})
          print(json.dumps({'zoom':label,'elapsedMs':zoom_state['time']-start,'residentPages':vt['residentPages'],'uploadedPages':vt['uploadedPages']}),flush=True)
          break
        else:raise RuntimeError('Zoom did not settle: '+label)
      point=await driver.execute_script("""
const root=window.__royalDeviceRoot,box=root.canvas.getBoundingClientRect();
for(let y=box.top+80;y<box.bottom-80;y+=24)for(let x=box.left+80;x<box.right-80;x+=24){if(document.elementFromPoint(x,y)!==root.canvas)continue;const hit=root.pick({clientX:x,clientY:y});const id=hit?.target.instanceId??hit?.target.pickingId;if(id&&window.__royalDeviceHandlers?.[id])return {x,y,id};}return null;
""")
      if not point:raise RuntimeError('No selectable model found')
      await driver.execute_script("window.__royalInput=[];for(const type of ['pointerdown','pointerup','pointercancel','touchstart','touchend'])addEventListener(type,e=>window.__royalInput.push({type,trusted:e.isTrusted,x:e.clientX,y:e.clientY,target:e.target.tagName}),true);")
      touch='royal-test-touch'
      await session.perform_interaction_sequence([{'sourceId':touch,'sourceType':'Touch'}],[
       {'states':[{'sourceId':touch,'location':{'x':int(point['x']),'y':int(point['y'])},'pressedButton':'Left','mouseInteraction':'Down','duration':50}]},
       {'states':[{'sourceId':touch,'location':{'x':int(point['x']),'y':int(point['y'])},'mouseInteraction':'Up','duration':50}]},
      ])
      await asyncio.sleep(.2)
      selected=await driver.execute_script("return [...window.__royalDeviceStore.presence.getState().selection];")
      result['interaction']={'point':point,'selected':selected,'events':await driver.execute_script('return window.__royalInput;')}
      if point['id'] not in selected:raise RuntimeError('Physical Safari touch did not select the picked piece')
      if os.environ.get('ROYAL_PROFILE_UPLOADS') == '1':
       result['uploadProfile']=await driver.execute_script('return window.__royalUploadProfile;')
       result['registryTransport']=await driver.execute_script("const entries=performance.getEntriesByType('resource').filter(e=>e.name.includes('registry.probabilityusercontent.nz/'));return {requests:entries.length,transferredBytes:entries.reduce((n,e)=>n+e.transferSize,0),zipDownloads:entries.filter(e=>e.name.endsWith('.zip')).map(e=>({url:e.name,duration:e.duration,encodedBodySize:e.encodedBodySize}))};")
      result['registryProtocols']=await driver.execute_script("return performance.getEntriesByType('resource').filter(e=>e.name.includes('registry.probabilityusercontent.nz/')).map(e=>({url:e.name,protocol:e.nextHopProtocol,duration:e.duration,transferSize:e.transferSize,encodedBodySize:e.encodedBodySize}));")
      result['completed']=True
      break
    await asyncio.sleep(.5)
   if not result.get('completed'):raise RuntimeError('Game did not settle')
   r=result['snapshot']['resources']
   assert r['persistentGpu']['retainedBytes']<=r['persistentGpu']['budgetBytes']
   assert r['virtualTextures']['rasterCachePeakBytes']<=33554432
  except Exception as error:
   result['failure']=str(error);raise
  finally:
   result['samples']=samples
   Path(os.environ.get('ROYAL_GAME_RESULT',str(Path(__file__).with_name('ipad-game.json')))).write_text(json.dumps(result,indent=2)+'\n')
   await asyncio.wait_for(session.stop_session(),10)
cli()
