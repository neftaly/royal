import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connectCdpPage, evaluate, spawnLogged, stopProcess } from '../../apps/examples-react/scripts/browser-harness.mjs';

// Start Probability through its root pnpm dev with ROYAL_DEV_PATH first.
const url = process.env.ROYAL_GAME_URL ?? 'http://localhost:3003/play/#{%22doc%22:%22automerge:3vtV6rcsy9fMYzNonX6DWkpTkwtZ%22,%22sync%22:[%22wss://subduction.sync.inkandswitch.com%22]}';
const profile = await mkdtemp('/tmp/royal-game-browser-');
const browser = spawnLogged('chromium', ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan', '--ignore-gpu-blocklist', '--disable-software-rasterizer', '--use-gpu-in-tests', '--remote-allow-origins=*', '--remote-debugging-port=19385', `--user-data-dir=${profile}`, 'about:blank']);
const errors = [];
const result = { url, errors };
let session;
try {
  session = await connectCdpPage({debugHost:'127.0.0.1',debugPort:19385,commandTimeoutMs:30000});
  await session.call('Runtime.enable');
  await session.call('Network.enable');
  await session.call('Emulation.setDeviceMetricsOverride', {width:1024,height:768,deviceScaleFactor:1,mobile:false});
  session.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails));
  session.on('Runtime.consoleAPICalled', event => { if(event.type==='error') errors.push(event.args); });
  session.on('Network.responseReceived', event => {
    if(event.type==='Script' && event.response.status>=400) errors.push({url:event.response.url,status:event.response.status});
  });
  session.on('Network.loadingFailed', event => { if(event.type==='Script' && !event.canceled) errors.push(event); });
  const started = performance.now();
  await session.call('Page.navigate',{url});
  for(let n=0;n<1800;n++) {
    const state = await evaluate(session, `(() => {
      const c=document.querySelector('canvas');
      let f=c?.[Object.keys(c).find(k=>k.startsWith('__reactFiber'))];
      for(;f;f=f.return) for(let h=f.memoizedState;h;h=h.next) {
        const v=h.memoizedState?.current??h.memoizedState;
        if(v&&typeof v.getSnapshot==='function'&&typeof v.getLifecycleSnapshot==='function')
          return {snapshot:v.getSnapshot(),overlay:!!document.querySelector('vite-error-overlay')};
      }
    })()`);
    if(state) {
      result.snapshot=state.snapshot;
      if(state.overlay || state.snapshot.presentation==='failed') throw new Error('Game failed presentation');
      const resources=state.snapshot.resources;
      if(state.snapshot.presentation==='ready' && resources.virtualTextures.automaticCandidates>=324
        && resources.imageTextures.residentTextures>=300 && resources.gltfSourceReads.activeReads===0
        && resources.gltfSharedGeometry.pendingPreparationTasks===0) {
        result.elapsedMs=performance.now()-started;
        result.completed=true;
        break;
      }
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!result.completed) throw new Error('Game did not settle');
  if(errors.length) throw new Error('Browser reported game errors');
  console.log(JSON.stringify({elapsedMs:result.elapsedMs,gpu:result.snapshot.resources.persistentGpu,vt:result.snapshot.resources.virtualTextures}));
} catch(error) {
  result.failure=String(error);
  throw error;
} finally {
  await writeFile(new URL('./game-final.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  session?.socket.close();
  await stopProcess(browser);
  await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
