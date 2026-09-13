import { mkdir, writeFile } from 'node:fs/promises';
import { createKtx2Fixture } from '../../tests/replacement/support/ktx2-fixture.ts';
const directory = new URL('./generated/native-read/', import.meta.url);
await mkdir(directory, { recursive: true });
for (const [name, vk] of [['ktx2-etc2', 152], ['ktx2-astc-6x6', 166], ['ktx2-astc-8x8', 172],
  ['ktx2-bc1', 134], ['ktx2-bc3', 138], ['ktx2-bc7', 146]]) {
  await writeFile(new URL(`${name}.ktx2`, directory), createKtx2Fixture(vk, 144, 144, 1));
}
