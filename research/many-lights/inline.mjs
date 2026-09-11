import { readFile } from 'node:fs/promises';
const source=await readFile('packages/renderer-webgl/src/webgl/shaders/surface.frag','utf8');
const lists=(await readFile('research/many-lights/lists.mjs','utf8')).replaceAll('export const ','const ');
const oracle=(await readFile('research/many-lights/oracle.mjs','utf8')).replaceAll('export const ','const ');
let probe=(await readFile(process.env.LIGHTS_PROBE_FILE ?? 'research/many-lights/probe.mjs','utf8'))
 .replace("import { buildPlaneLists, fixture } from './lists.mjs';",lists)
 .replace("import { referencePixel } from './oracle.mjs';",oracle)
 .replace('export const run','const run');
const start=probe.indexOf('  // Vite'),end=probe.indexOf('  const brdf=',start);
if(start<0||end<0)throw new Error('Probe injection boundary missing');
probe=probe.slice(0,start)+`  const source=${JSON.stringify(source)};\n`+probe.slice(end);
const soak=(await readFile('research/many-lights/soak.mjs','utf8')).replace('export const runSoak','const runSoak');
const expression=process.env.LIGHTS_SOAK==='1' ? 'options=>runSoak(run,options)' : 'run';
console.log(`(()=>{document.body.innerHTML='<p id="status">Starting</p>';${probe}\n${soak}\nglobalThis.runManyLights=${expression};return 'ready';})()`);
