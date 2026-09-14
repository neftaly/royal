let codec;
const started = performance.now();
const ready = WebAssembly.instantiateStreaming(fetch('./encoder.wasm'), {
 env: {emscripten_notify_memory_growth() {}},
 wasi_snapshot_preview1: {fd_close:()=>8, fd_seek:()=>8, fd_write:()=>8}
}).then(({instance})=>{codec=instance.exports;codec._initialize();return performance.now()-started;});
onmessage = async ({data}) => {
 try {
  const initMs=await ready;
  const contextStart=performance.now();
  const context=codec.create_encoder(data.block,0);
  if(!context)throw Error('encoder context failed');
  const contextMs=performance.now()-contextStart;
  const length=Math.ceil(data.size/data.block)**2*16;
  const input=codec.malloc(data.rgba.byteLength+length);
  if(!input)throw Error('scratch allocation failed');
  const start=performance.now();
  new Uint8Array(codec.memory.buffer,input,data.rgba.byteLength).set(data.rgba);
  const output=input+data.rgba.byteLength;
  const status=codec.encode(context,input,data.size,data.size,output,length);
  const encodeMs=performance.now()-start;
  if(status)throw Error('encode status '+status);
  const bytes=new Uint8Array(codec.memory.buffer,output,length).slice();
  codec.free(input);codec.destroy_encoder(context);
  postMessage({initMs,contextMs,encodeMs,memoryBytes:codec.memory.buffer.byteLength,bytes},[bytes.buffer]);
 }catch(error){postMessage({error:String(error)});}
};
