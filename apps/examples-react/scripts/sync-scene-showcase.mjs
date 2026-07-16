import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const upstreamRepository = 'KhronosGroup/glTF-Sample-Assets';
const upstreamRevision = '2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = path.join(appRoot, 'public/fixtures/scenes');
const metadataFiles = ['LICENSE.md', 'README.body.md', 'README.md', 'metadata.json'];
const sharedFiles = ['LICENSES/LicenseRef-3DRT-Testing.txt'];

const sceneSelections = [
  {
    model: 'Sponza',
    include: (relativePath) => relativePath.startsWith('glTF/'),
  },
  {
    model: 'ABeautifulGame',
    include: (relativePath) => relativePath === 'glTF-Binary/ABeautifulGame.glb',
  },
  {
    model: 'VirtualCity',
    include: (relativePath) => relativePath === 'glTF-Binary/VirtualCity.glb',
  },
];

const requireResponse = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'royal-scene-showcase-sync' },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response;
};

const treeUrl = `https://api.github.com/repos/${upstreamRepository}/git/trees/${upstreamRevision}?recursive=1`;
const tree = await requireResponse(treeUrl).then((response) => response.json());
if (tree.truncated === true || !Array.isArray(tree.tree)) {
  throw new Error('Khronos Sample Assets tree response was truncated or malformed');
}

const modelDownloads = sceneSelections.flatMap(({ model, include }) => {
  const modelPrefix = `Models/${model}/`;
  return tree.tree
    .filter((entry) => entry.type === 'blob' && entry.path.startsWith(modelPrefix))
    .filter((entry) => {
      const relativePath = entry.path.slice(modelPrefix.length);
      return metadataFiles.includes(relativePath) || include(relativePath);
    })
    .map((entry) => ({
      destination: path.join(fixtureRoot, entry.path.slice('Models/'.length)),
      sourcePath: entry.path,
    }));
});
const downloads = [
  ...modelDownloads,
  ...sharedFiles.map((sourcePath) => ({
    destination: path.join(fixtureRoot, sourcePath),
    sourcePath,
  })),
];

const download = async ({ destination, sourcePath }) => {
  const url = `https://raw.githubusercontent.com/${upstreamRepository}/${upstreamRevision}/${sourcePath}`;
  const bytes = Buffer.from(await requireResponse(url).then((response) => response.arrayBuffer()));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return bytes.length;
};

const pending = [...downloads];
const workers = Array.from({ length: Math.min(8, pending.length) }, async () => {
  let workerBytes = 0;
  while (pending.length > 0) {
    const entry = pending.shift();
    if (entry === undefined) return workerBytes;
    workerBytes += await download(entry);
  }
  return workerBytes;
});
const downloadedBytes = (await Promise.all(workers))
  .reduce((total, workerBytes) => total + workerBytes, 0);

console.log(
  `Scene showcase: ${downloads.length} files, ${downloadedBytes} bytes, `
  + `${upstreamRepository}@${upstreamRevision}`,
);
