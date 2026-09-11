import path from 'node:path';
const url = value => JSON.stringify('/@fs' + path.resolve(value));
process.env.LIGHTS_REPORT ??= 'research/many-lights/software-package-integration-results.json';
process.env.LIGHTS_EXPRESSION = `Promise.all([
  import(${url('research/many-lights/integration-probe.ts')}),
  import(${url('packages/renderer-webgl/dist/index.js')}),
  import(${url('packages/renderer-webgl/dist/capture.js')})
]).then(async ([probe,renderer,capture]) => {
  const requests = () => performance.getEntriesByType('resource').filter(x=>x.name.includes('large-light-runtime')).map(x=>x.name);
  const result = await probe.runIntegration({
    rootFactory: renderer.createRendererRoot, captureFactory: capture.captureImage,
    onSmallReady: () => { if(requests().length !== 0) throw new Error('Small scene loaded the optional light module'); }
  });
  if(requests().length !== 1) throw new Error('Expected one lazy large-light request');
  return {...result,largeLightRequests:requests()};
})`;
await import('./run-cdp.mjs');
