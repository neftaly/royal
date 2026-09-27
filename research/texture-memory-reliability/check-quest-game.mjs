import { writeFile } from 'node:fs/promises';
import { connectCdpPage, evaluate } from '../../apps/examples-react/scripts/browser-harness.mjs';

// Start Probability through its root pnpm dev with ROYAL_DEV_PATH first.
const url = process.env.ROYAL_GAME_URL ?? 'http://127.0.0.1:3004/play/#{%22doc%22:%22automerge:3vtV6rcsy9fMYzNonX6DWkpTkwtZ%22,%22sync%22:[%22wss://subduction.sync.inkandswitch.com%22]}';
const errors = [];
const result = { url, errors };
let session;
try {
  session = await connectCdpPage({debugHost:'127.0.0.1',debugPort:19386,commandTimeoutMs:30000});
  await session.call('Runtime.enable');
  await session.call('Network.enable');
  await session.call('Page.enable');
  // Meta can treat navigation to the current hash URL as same-document.
  // Leave it first so the old ready root cannot satisfy this run.
  await session.call('Page.navigate', { url: 'about:blank' });
  for (let n = 0; n < 100; n++) {
    try { if (await evaluate(session, 'location.href === "about:blank"')) break; } catch {}
    if (n === 99) throw new Error('Could not leave the previous game document');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const navigationToken = `quest-game-${Date.now()}`;
  await session.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__royalGameCheckNavigation=${JSON.stringify(navigationToken)}` });
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
      if(window.__royalGameCheckNavigation!==${JSON.stringify(navigationToken)}) return;
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
        && resources.gltfSourceReads.activeReads===0
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
  await writeFile(new URL(process.env.ROYAL_GAME_RESULT ?? './quest-game.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
  session?.socket.close();
}
