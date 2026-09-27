(() => {
  const events = [], counts = {}, objects = new WeakMap(), textures = new WeakMap();
  let next = 0;
  const identity = object => {
    if ((typeof object !== 'object' && typeof object !== 'function') || object === null) return undefined;
    let meta = objects.get(object);
    if (!meta) { meta = { id: ++next, root: next }; objects.set(object, meta); }
    return meta;
  };
  const record = (kind, fields) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (events.length < 20000) events.push({ kind, time: performance.now(), ...fields });
  };
  if (typeof createImageBitmap === 'function') {
    const original = createImageBitmap;
    globalThis.createImageBitmap = async (...args) => {
      const start = performance.now(), parent = identity(args[0]);
      const bitmap = await original(...args);
      objects.set(bitmap, { id: ++next, root: parent?.root ?? next });
      record('bitmap', { duration: performance.now() - start, root: identity(bitmap).root,
        input: [args[0]?.width, args[0]?.height], output: [bitmap.width, bitmap.height],
        encodedBytes: args[0] instanceof Blob ? args[0].size : undefined,
        mime: args[0] instanceof Blob ? args[0].type : undefined });
      return bitmap;
    };
  }
  for (const Constructor of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
    if (!Constructor) continue;
    const draw = Constructor.prototype.drawImage;
    Constructor.prototype.drawImage = function(source, ...args) {
      const meta = identity(source), canvas = identity(this.canvas);
      if (meta && canvas) canvas.root = meta.root;
      if (args.length === 4) record('raster-resize', {root:meta?.root,from:[source.width,source.height],to:[this.canvas.width,this.canvas.height]});
      if (args.length === 8 && this.canvas.width === 132) record('page-render', {root:meta?.root,from:[source.width,source.height],rect:args});
      return draw.call(this, source, ...args);
    };
  }
  const instrumented = new WeakSet();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(...args) {
    const gl = getContext.apply(this, args);
    if (args[0] !== 'webgl2' || !gl || instrumented.has(gl)) return gl;
    instrumented.add(gl);
    const bindings = new Map(); let unit = gl.TEXTURE0;
    for (const name of ['activeTexture','bindTexture','texStorage2D','texImage2D','texSubImage2D','deleteTexture']) {
      const original = gl[name];
      gl[name] = function(...a) {
        if (name === 'activeTexture') unit = a[0];
        else if (name === 'bindTexture') bindings.set(`${unit}:${a[0]}`, a[1]);
        else if (name === 'deleteTexture') record('texture-delete', {texture: identity(a[0])?.id});
        else {
          const texture = bindings.get(`${unit}:${a[0]}`), id = identity(texture)?.id;
          if (name === 'texStorage2D') {
            const size = [a[3], a[4]];
            if (texture) textures.set(texture, size);
            record('texture-storage', {texture:id,size,levels:a[1]});
          } else {
            const source = a.at(-1), meta = identity(source);
            const size = name === 'texImage2D' && a.length === 9 ? [a[3],a[4]]
              : name === 'texSubImage2D' && a.length === 9 ? [a[4],a[5]]
              : [source?.width,source?.height];
            if (name === 'texImage2D' && texture && a[1] === 0) textures.set(texture,size);
            record('texture-upload', {texture:id,root:meta?.root,size,storage:texture?textures.get(texture):undefined,level:a[1]});
          }
        }
        return original.apply(gl, a);
      };
    }
    return gl;
  };
  const longTasks = [];
  if (PerformanceObserver.supportedEntryTypes?.includes('longtask')) new PerformanceObserver(list => {
    for (const e of list.getEntries()) longTasks.push({start:e.startTime,duration:e.duration});
  }).observe({type:'longtask',buffered:true});
  globalThis.__royalLoadingProbe = {events,counts,longTasks,sample:()=>{
    const canvas = document.querySelector('canvas');
    let fiber = canvas?.[Object.keys(canvas).find(key => key.startsWith('__reactFiber'))];
    for (;fiber;fiber=fiber.return) for(let hook=fiber.memoizedState;hook;hook=hook.next) {
      const root=hook.memoizedState?.current??hook.memoizedState;
      if(root&&typeof root.getSnapshot==='function'&&typeof root.getLifecycleSnapshot==='function')
        return {time:performance.now(),snapshot:root.getSnapshot()};
    }
    return {time:performance.now(),text:document.body?.innerText.slice(0,500)};
  }};
})();
