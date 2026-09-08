# Requires a trusted USB-connected iPad, Safari automation, and pymobiledevice3.
import asyncio, json, os
from typer_injector import InjectingTyper
from pymobiledevice3.cli.cli_common import ServiceProviderDep, async_command
from pymobiledevice3.cli.webinspector import webinspector_service, SAFARI
from pymobiledevice3.services.web_protocol.driver import WebDriver
cli=InjectingTyper()
@cli.command()
@async_command
async def check(service_provider: ServiceProviderDep):
 async with webinspector_service(service_provider) as inspector:
  safari=await inspector.open_app(SAFARI)
  session=await inspector.automation_session(safari)
  driver=WebDriver(session)
  try:
   await asyncio.wait_for(driver.start_session(),20)
   try: await asyncio.wait_for(driver.get(os.environ['ROYAL_SOAK_URL']),20)
   except TimeoutError: print('Navigation pending; inspecting',flush=True)
   for i in range(24):
    await asyncio.sleep(10)
    result=await asyncio.wait_for(driver.execute_script('const p=window.probe;return {done:p?.done,errors:p?.errors,last:p?.samples.at(-1)}'),15)
    print(json.dumps(result),flush=True)
    if result.get('done'): break
   result=await driver.execute_script('return window.probe')
   with open(os.environ['ROYAL_SOAK_REPORT'],'w') as f: json.dump(result,f,indent=2)
   print('COMPLETE '+json.dumps({'done':result.get('done'),'errors':result.get('errors'),'idleFrameDelta':result.get('idleFrameDelta')}),flush=True)
   if not result.get('done') or result.get('errors'): raise RuntimeError('VT soak failed; see report')
  finally:
   await asyncio.wait_for(session.stop_session(),5)
cli()
