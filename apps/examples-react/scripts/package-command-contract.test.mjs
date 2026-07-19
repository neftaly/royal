import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const packageJson = JSON.parse(readFileSync(
  new URL('../package.json', import.meta.url),
  'utf8',
));
const readme = readFileSync(new URL('./README.md', import.meta.url), 'utf8');

describe('examples package command contract', () => {
  it('defines every package script advertised by the benchmark guide', () => {
    const advertised = [...readme.matchAll(
      /pnpm --filter @royal\/examples-react ([\w:-]+)/gu,
    )].map((match) => match[1]);

    expect(advertised.length).toBeGreaterThan(0);
    expect(advertised.filter((name) => packageJson.scripts[name] === undefined)).toEqual([]);
  });
});
