import asyncio,json
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
   await asyncio.wait_for(d.get('http://192.168.0.224:5193/gltf-scenes'),30)
   async def settle():
    for n in range(240):
     snap=await asyncio.wait_for(d.execute_script('return window.__royalExamplesRendererBenchmarkSnapshot?.()'),10)
     v=(snap or {}).get('virtualTexturing',{})
     if snap and snap.get('gltfLoadDiagnostics',{}).get('assets') and all(a['status']=='ready' for a in snap['gltfLoadDiagnostics']['assets']) and not v.get('pendingDemandResources') and v.get('pendingPages')==0 and v.get('unresidentPages')==0 and v.get('desiredPages',0)>0 and v['desiredPages']==v['admittedPages']:return snap
     await asyncio.sleep(.5)
    Path('/tmp/ipad-unsettled.json').write_text(json.dumps(snap,indent=2))
    raise RuntimeError('Full demand failed to settle')
   for trial in range(1,3):
    before=await settle()
    await d.execute_script('return '+Path('/home/neftaly/dev/royal/research/device-validation-9c339f/camera-clock-probe.js').read_text())
    for n in range(120):
     r=await asyncio.wait_for(d.execute_script('return window.clockProbe'),10)
     if r and not r.get('running'):break
     await asyncio.sleep(.5)
    settled=await settle()
    Path(f'/home/neftaly/dev/royal/research/device-fixes-9c339f/ipad-final-{trial}.json').write_text(json.dumps({'before':before,'probe':r,'settled':settled},indent=2)+'\n')
    print(json.dumps({k:r.get(k) for k in ['p50Ms','p95Ms','maxMs','pass','error']}),flush=True)
  finally:await asyncio.wait_for(s.stop_session(),10)
cli()
