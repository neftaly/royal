import asyncio,json,base64,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
from typer_injector import InjectingTyper
from pymobiledevice3.cli.cli_common import ServiceProviderDep,async_command
from pymobiledevice3.cli.webinspector import webinspector_service,SAFARI
from pymobiledevice3.services.web_protocol.driver import WebDriver
out=ROOT/'research/device-validation-9c339f/ipad';out.mkdir(parents=True,exist_ok=True)
cli=InjectingTyper()
@cli.command()
@async_command
async def check(service_provider:ServiceProviderDep):
 async with webinspector_service(service_provider) as inspector:
  safari=await asyncio.wait_for(inspector.open_app(SAFARI),20)
  session=await asyncio.wait_for(inspector.automation_session(safari),20)
  d=WebDriver(session)
  try:
   await asyncio.wait_for(d.start_session(),20)
   print('Safari automation ready',flush=True)
   for route in ['gltf-helmet','virtual-texture-stress','texture-materials','gltf-scenes','webxr-vr']:
    print('START '+route,flush=True)
    await asyncio.wait_for(d.get('http://192.168.0.224:5193/'+route+'?bench=auto&frames=24&warmup=8&cameraDrag=1&timeoutMs=60000&run='+str(time.time())),30)
    for i in range(150):
     state=await asyncio.wait_for(d.execute_script('return {report:window.__royalBrowserBenchmarkReport,error:window.__royalBrowserBenchmarkError}'),15)
     if state.get('report') or state.get('error'):break
     await asyncio.sleep(.5)
    (out/(route+'.json')).write_text(json.dumps(state,indent=2)+'\n')
    r=state.get('report') or {}
    print(json.dumps({'route':route,'ready':r.get('ready'),'frames':r.get('frameStats'),'warnings':r.get('warnings'),'error':state.get('error')}),flush=True)
    for settle in range(120):
     snap=await d.execute_script('return window.__royalExamplesRendererBenchmarkSnapshot?.()')
     vt=(snap or {}).get('virtualTexturing') or {}
     if vt.get('pendingPages')==0 and vt.get('unresidentPages')==0: break
     await asyncio.sleep(.5)
    (out/(route+'-settled.json')).write_text(json.dumps(snap,indent=2)+'\n')
    try:
     png=await d.execute_script('window.__royalExamplesRenderNow?.();return document.querySelector("canvas").toDataURL("image/png")')
     (out/(route+'.png')).write_bytes(base64.b64decode(png.split(',')[1]))
    except Exception as e: print('capture '+str(e),flush=True)
    if route=='virtual-texture-stress':
     await d.execute_script('return '+(ROOT/'research/virtual-texture-latency/zoom-probe.js').read_text())
     for i in range(120):
      await asyncio.sleep(.5)
      z=await asyncio.wait_for(d.execute_script('return window.__royalZoomProbe'),15)
      if z and not z.get('running'):break
     (out/'vt-zoom.json').write_text(json.dumps(z,indent=2)+'\n')
     print('ZOOM '+json.dumps({'error':z.get('error'),'runs':[{k:v for k,v in r.items() if k not in ['samples','before','after']} for r in z['runs']]}),flush=True)
  finally:
   await asyncio.wait_for(session.stop_session(),10)
cli()
