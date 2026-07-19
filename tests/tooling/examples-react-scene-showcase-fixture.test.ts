import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const fixtureRoot = path.resolve(
  import.meta.dirname,
  '../../apps/examples-react/public/fixtures/scenes',
);

const sha256 = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

const directoryPayloadSha256 = (root: string): string => {
  const files: string[] = [];
  const collect = (directory: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      if (statSync(file).isDirectory()) collect(file);
      else files.push(file);
    }
  };
  collect(root);
  const digest = createHash('sha256');
  for (const file of files) {
    digest.update(path.relative(root, file));
    digest.update(Buffer.from([0]));
    digest.update(readFileSync(file));
    digest.update(Buffer.from([0]));
  }
  return digest.digest('hex');
};

describe('examples scene showcase fixtures', () => {
  it('pins complete scene assets with their provenance and licenses', () => {
    const readme = readFileSync(path.join(fixtureRoot, 'README.md'), 'utf8');
    expect(readme).toContain('2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf');
    expect(readFileSync(
      path.join(fixtureRoot, 'LICENSES/LicenseRef-3DRT-Testing.txt'),
      'utf8',
    )).toContain('testing your glTF tools');

    for (const model of ['Sponza', 'ABeautifulGame', 'VirtualCity']) {
      expect(existsSync(path.join(fixtureRoot, model, 'README.md'))).toBe(true);
      expect(existsSync(path.join(fixtureRoot, model, 'LICENSE.md'))).toBe(true);
      expect(existsSync(path.join(fixtureRoot, model, 'metadata.json'))).toBe(true);
    }
  });

  it('preserves the expected Sponza resource graph', () => {
    const root = path.join(fixtureRoot, 'Sponza/glTF');
    const document = JSON.parse(readFileSync(path.join(root, 'Sponza.gltf'), 'utf8')) as {
      readonly buffers: readonly { readonly uri?: string }[];
      readonly images: readonly { readonly uri?: string }[];
    };
    for (const resource of [...document.buffers, ...document.images]) {
      expect(resource.uri).toBeTypeOf('string');
      expect(existsSync(path.join(root, resource.uri!))).toBe(true);
    }
    expect(directoryPayloadSha256(root)).toBe(
      '31a34f1272764ba62ba468bb802ea8ae272fde3375215a2cc46efa6d9296fff7',
    );
  });

  it('preserves the selected GLBs exactly', () => {
    const beautifulGamePath = path.join(
      fixtureRoot,
      'ABeautifulGame/glTF-Binary/ABeautifulGame.glb',
    );
    const virtualCityPath = path.join(
      fixtureRoot,
      'VirtualCity/glTF-Binary/VirtualCity.glb',
    );
    expect(sha256(beautifulGamePath)).toBe(
      'bd7133b4b322aae97c589b8839dae8155ad2546acb35ae32a127e722a959d007',
    );
    expect(sha256(virtualCityPath)).toBe(
      'de6666bd842a44cba92fb25a5da9080459a36e045fbc0fd1fd85b830124561fe',
    );

  });
});
