import { readFileSync } from 'node:fs';

export const exampleContract = JSON.parse(readFileSync(
  new URL('../example-contract.json', import.meta.url),
  'utf8',
));

if (exampleContract.schema !== 'royal-examples-contract' || exampleContract.version !== 1) {
  throw new Error('Unsupported Royal examples contract');
}

export const exampleRouteById = new Map(
  exampleContract.examples.map(({ id, path }) => [id, { id, path }]),
);

export const requireExampleRoute = (id) => {
  const route = exampleRouteById.get(id);
  if (route === undefined) throw new Error(`Royal examples contract has no route ${JSON.stringify(id)}`);
  return { ...route };
};

export const rendererSnapshotExpression =
  `globalThis[${JSON.stringify(exampleContract.benchmark.bridge.rendererSnapshotGlobal)}]?.() ?? null`;

export const renderNowExpression =
  `globalThis[${JSON.stringify(exampleContract.benchmark.bridge.renderNowGlobal)}]?.()`;
