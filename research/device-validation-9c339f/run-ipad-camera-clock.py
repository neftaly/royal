import asyncio,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
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
   for n in range(120):
    snap=await d.execute_script('return window.__royalExamplesRendererBenchmarkSnapshot?.()')
    if snap and snap['gltfLoadDiagnostics']['assets'] and all(a['status']=='ready' for a in snap['gltfLoadDiagnostics']['assets']) and snap['virtualTexturing']['pendingPages']==0 and snap['virtualTexturing']['unresidentPages']==0:break
    await asyncio.sleep(.5)
   await d.execute_script('return '+(ROOT/'research/device-validation-9c339f/camera-clock-probe.js').read_text())
   for n in range(90):
    r=await asyncio.wait_for(d.execute_script('return window.clockProbe'),10)
    if r and not r.get('running'):break
    await asyncio.sleep(1)
   (ROOT/'research/device-validation-9c339f/ipad/sponza-camera-clock.json').write_text(json.dumps(r,indent=2)+'\n')
   print(json.dumps(r),flush=True)
  finally:await asyncio.wait_for(s.stop_session(),10)
cli()
