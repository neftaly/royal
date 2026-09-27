(() => {
  const longTasks=[];
  if(PerformanceObserver.supportedEntryTypes?.includes('longtask'))new PerformanceObserver(list=>{
    for(const e of list.getEntries())longTasks.push({start:e.startTime,duration:e.duration});
  }).observe({type:'longtask',buffered:true});
  globalThis.__royalLoadingProbe={events:[],counts:{},longTasks,sample:()=>{
    const canvas=document.querySelector('canvas');
    let fiber=canvas?.[Object.keys(canvas).find(key=>key.startsWith('__reactFiber'))];
    for(;fiber;fiber=fiber.return)for(let hook=fiber.memoizedState;hook;hook=hook.next){
      const root=hook.memoizedState?.current??hook.memoizedState;
      if(root&&typeof root.getSnapshot==='function'&&typeof root.getLifecycleSnapshot==='function')return {
        time:performance.now(),snapshot:root.getSnapshot(),busy:canvas.closest('[aria-busy]')?.getAttribute('aria-busy'),
      };
    }
    return {time:performance.now(),text:document.body?.innerText.slice(0,500)};
  }};
})();
