"""Self-contained probe in a fresh Safari automation tab; no LAN server needed."""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typer_injector import InjectingTyper
from pymobiledevice3.cli.cli_common import ServiceProviderDep, async_command
from pymobiledevice3.cli.webinspector import webinspector_service, SAFARI
from pymobiledevice3.services.web_protocol.driver import WebDriver

cli = InjectingTyper()

@cli.command()
@async_command
async def check(service_provider: ServiceProviderDep):
    source = (Path(os.environ['LIGHTS_INLINE_FILE']).read_text() if 'LIGHTS_INLINE_FILE' in os.environ
              else subprocess.check_output(['node', 'research/many-lights/inline.mjs'], text=True))
    options = json.loads(os.environ.get('LIGHTS_OPTIONS', '{}'))
    async with webinspector_service(service_provider) as inspector:
        print("Opening Safari", flush=True)
        safari = await asyncio.wait_for(inspector.open_app(SAFARI), 30)
        print("Creating automation session", flush=True)
        session = await asyncio.wait_for(inspector.automation_session(safari), 30)
        driver = WebDriver(session)
        try:
            print("Starting session", flush=True)
            await asyncio.wait_for(driver.start_session(), 30)
            print("Transferring source", flush=True)
            # Keep inspector protocol messages bounded for the integrated bundle.
            await driver.execute_script('window.manyLightsSource = ""; const status=document.createElement("pre"); status.id="status"; document.body.append(status); return "ready"')
            for offset in range(0, len(source), 4096):
                await asyncio.wait_for(driver.execute_script('window.manyLightsSource += arguments[0]; return true', source[offset:offset+4096]), 30)
                if offset % 65536 == 0:
                    print(f"Transferred {offset+4096} bytes", flush=True)
            print(await asyncio.wait_for(driver.execute_script('eval(window.manyLightsSource); delete window.manyLightsSource; return "ready"'), 60), flush=True)
            await driver.execute_script('window.runManyLights(' + json.dumps(options) + ').then(value=>window.manyLightsResult=value,error=>window.manyLightsError=String(error)+" | "+String(error.stack));return "started"')
            previous = None
            for attempt in range(1800):
                state = await asyncio.wait_for(driver.execute_script('return {status:document.querySelector("#status")?.textContent,error:window.manyLightsError,done:!!window.manyLightsResult}'), 180)
                if state.get('error'):
                    raise RuntimeError(state['error'])
                if state.get('status') != previous:
                    print(state, flush=True)
                    previous = state.get('status')
                if state.get('done'):
                    result = await driver.execute_script('return window.manyLightsResult')
                    destination = Path(os.environ.get('LIGHTS_REPORT', 'research/many-lights/ipad-results.json'))
                    destination.write_text(json.dumps(result, indent=2) + '\n')
                    print(json.dumps({'destination': str(destination), 'capabilities': result.get('capabilities'), 'cases': len(result['results'])}), flush=True)
                    break
                if attempt == 1799:
                    raise RuntimeError('iPad experiment timed out')
                await asyncio.sleep(5)
        finally:
            active_error = sys.exc_info()[0] is not None
            try:
                await asyncio.wait_for(session.stop_session(), 10)
            except Exception:
                if not active_error:
                    raise

cli()
