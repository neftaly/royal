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
 async with webinspector_service(service_provider) as i:
  a=await i.open_app(SAFARI);s=await i.automation_session(a);d=WebDriver(s)
  try:
   await asyncio.wait_for(d.start_session(),20)
   await asyncio.wait_for(d.get(os.environ.get('ROYAL_MEMORY_FIXTURE_URL','http://192.168.0.224:5195/scripts/texture-working-set.html')),30)
   result=[]
   for group in [0,9,0]:
    before=await d.execute_script('return window.textureWorkingSet?.snapshot()?.renderer.frame ?? -1')
    if result: await d.execute_script(f'window.textureWorkingSet.show({group}); return true')
    for n in range(240):
     snap=await asyncio.wait_for(d.execute_script('return window.textureWorkingSet?.snapshot()'),15)
     if snap and snap['renderer']['frame']>before and snap['renderer']['presentation'] in ['ready','failed']:
      result.append({'group':group,'snapshot':snap});break
     await asyncio.sleep(.5)
    else:
     result.append({'group':group,'timeout':True,'snapshot':snap});break
    print(json.dumps({'group':group,'presentation':snap['renderer']['presentation'],'elapsedMs':snap['elapsedMs']}),flush=True)
   supported=await d.execute_script("return !!document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context')")
   if supported:
    await d.execute_script("setTimeout(()=>{const e=document.querySelector('canvas').getContext('webgl2').getExtension('WEBGL_lose_context');e.loseContext();setTimeout(()=>e.restoreContext(),300)},0);return true")
    await asyncio.sleep(1)
    for n in range(240):
     snap=await asyncio.wait_for(d.execute_script('return window.textureWorkingSet?.snapshot()'),15)
     if snap and snap['renderer']['presentation']=='ready' and snap['renderer']['context']['generation']>1:
      result.append({'restored':True,'snapshot':snap});break
     await asyncio.sleep(.5)
    else:result.append({'restored':False,'snapshot':snap})
   Path(__file__).with_name('ipad-working-set.json').write_text(json.dumps(result,indent=2)+'\n')
   for entry in result:
    snap=entry['snapshot'];resources=snap['renderer']['resources']
    assert snap['renderer']['presentation']=='ready' and not entry.get('timeout')
    assert entry.get('restored',True)
    assert resources['persistentGpu']['retainedBytes']<=snap['budget']
    assert resources['virtualTextures']['rasterCachePeakBytes']<=33554432
    assert resources['imageTextures']['residentTextures']<=324
  finally: await asyncio.wait_for(s.stop_session(),10)
cli()
