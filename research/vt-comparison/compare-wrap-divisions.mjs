import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';
import ts from '@typescript/typescript6';
const source = await readFile('packages/renderer-webgl/src/virtual-texture/demand.ts', 'utf8');
const before = source.slice(source.indexOf('const addWrappedRange = ('), source.indexOf('const addClippedTriangleDemand = ('));
let after = before;
for (const [name, expression] of [['u0','screen[2]! / screen[4]!'],['u1','screen[7]! / screen[9]!'],['u2','screen[12]! / screen[14]!'],['v0','screen[3]! / screen[4]!'],['v1','screen[8]! / screen[9]!'],['v2','screen[13]! / screen[14]!']]) {
  after = after.replaceAll(expression, name);
}
after = after.replace('const screen = workspace.screen;', `const screen = workspace.screen;
  const u0 = screen[2]! / screen[4]!, u1 = screen[7]! / screen[9]!, u2 = screen[12]! / screen[14]!;
  const v0 = screen[3]! / screen[4]!, v1 = screen[8]! / screen[9]!, v2 = screen[13]! / screen[14]!;`);
const compile = block => new Function('addPageWithAncestors', ts.transpileModule(block, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText + '\nreturn addWrappedRange;');
const factories = { before: compile(before), after: compile(after) };
let seed = 82719;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2**32);
const cases = [];
const wraps = ['clamp-to-edge', 'repeat', 'mirrored-repeat'];
for (let i = 0; i < 10000; i++) {
  const screen = new Float64Array(15);
  for (let v = 0; v < 3; v++) {
    const divisor = random() * 3 + .1;
    screen[v*5+2] = (random()*4-2)*divisor;
    screen[v*5+3] = (random()*4-2)*divisor;
    screen[v*5+4] = divisor;
  }
  cases.push({ screen, sampler: { wrapS: wraps[i%3], wrapT: wraps[Math.floor(i/3)%3] }, manifest: { mipLayouts: [{ width: 1 + i%8, height: 1 + Math.floor(i/8)%8 }] } });
}
for (const c of cases) {
  const outputs = [];
  for (const factory of Object.values(factories)) {
    const output = [];
    factory((_w,_m,mip,x,y) => output.push([mip,x,y]))({ screen:c.screen }, c.manifest, 0, c.sampler);
    outputs.push(output);
  }
  deepStrictEqual(...outputs);
}
const functions = Object.fromEntries(Object.entries(factories).map(([k,f]) => [k,f((w,_m,_mip,x,y) => { w.checksum += x+y+1; })]));
const results = [];
for (let round = 0; round < 6; round++) for (const version of round%2 ? ['after','before'] : ['before','after']) {
  const w = {screen:cases[0].screen, checksum:0}; const fn=functions[version];
  for (let i=0;i<50000;i++) { const c=cases[i%cases.length]; w.screen=c.screen; fn(w,c.manifest,0,c.sampler); }
  const start=performance.now();
  for (let i=0;i<500000;i++) { const c=cases[i%cases.length]; w.screen=c.screen; fn(w,c.manifest,0,c.sampler); }
  results.push({version,round,elapsedMs:performance.now()-start,checksum:w.checksum});
}
await writeFile('research/vt-comparison/wrap-divisions-comparison.json', JSON.stringify({ sourceHash:createHash('sha256').update(source).digest('hex'), equivalentCases:cases.length, callsPerRound:500000, results, note:'Actual extracted wrapped-range block; page insertion replaced with identical sequence capture/checksum. CPU screening only, no rendering or allocation claim.' },null,2)+'\n');
await writeFile('research/vt-comparison/wrap-divisions-candidate.txt',after);
console.log(JSON.stringify(results));
