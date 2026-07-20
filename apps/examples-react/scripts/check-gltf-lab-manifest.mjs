import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const publicRoot = path.join(appRoot, 'public');
const fixtureRoot = path.join(publicRoot, 'fixtures/khronos');
const manifest = JSON.parse(readFileSync(
  path.join(appRoot, 'src/examples/gltf-lab-manifest.json'),
  'utf8',
));
const statuses = new Set([
  'supported-oracle',
  'core-fallback-oracle',
  'normalized-ingestion',
  'parsed-unsupported',
  'intentional-out-of-scope',
  'known-limitation',
  'expected-required-failure',
]);
const supportedRequiredExtensions = new Set([
  'EXT_mesh_gpu_instancing',
  'EXT_texture_webp',
  'KHR_draco_mesh_compression',
  'KHR_lights_punctual',
  'KHR_materials_emissive_strength',
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_unlit',
  'KHR_materials_variants',
  'KHR_materials_volume',
  'KHR_mesh_quantization',
  'KHR_texture_transform',
  'MSFT_lod',
]);
const unsupportedVisibleFeatures = new Set([
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_iridescence',
  'KHR_materials_sheen',
]);

const fixtureNames = readdirSync(fixtureRoot)
  .filter((name) => existsSync(path.join(fixtureRoot, name, 'glTF-Binary', `${name}.glb`)))
  .sort((left, right) => left.localeCompare(right));
const manifestNames = manifest.cases.map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right));
if (JSON.stringify(fixtureNames) !== JSON.stringify(manifestNames)) {
  throw new Error(`Manifest inventory differs from vendored fixtures (${manifestNames.length}/${fixtureNames.length})`);
}

for (const entry of manifest.cases) {
  if (!statuses.has(entry.status)) throw new Error(`${entry.name}: unknown status ${entry.status}`);
  const bytes = readFileSync(path.join(publicRoot, decodeURIComponent(entry.path)));
  if (bytes.length !== entry.bytes) throw new Error(`${entry.name}: byte count changed`);
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new Error(`${entry.name}: SHA-256 changed`);
  }
  if (!existsSync(path.join(publicRoot, decodeURIComponent(entry.provenance)))) {
    throw new Error(`${entry.name}: provenance file is missing`);
  }
  const unsupportedRequired = entry.extensionsRequired.filter(
    (extension) => !supportedRequiredExtensions.has(extension),
  );
  if (unsupportedRequired.length > 0 && !new Set([
    'expected-required-failure',
    'known-limitation',
    'parsed-unsupported',
  ]).has(entry.status)) {
    throw new Error(`${entry.name}: unsupported required extensions need a non-success status`);
  }
  const unsupportedVisible = entry.features.filter(
    (feature) => unsupportedVisibleFeatures.has(feature),
  );
  if (unsupportedVisible.length > 0 && entry.status === 'supported-oracle') {
    throw new Error(`${entry.name}: unsupported visible features need core-fallback-oracle status`);
  }

  const jsonLength = bytes.readUInt32LE(12);
  let jsonEnd = 20 + jsonLength;
  while (bytes[jsonEnd - 1] === 0) jsonEnd -= 1;
  const document = JSON.parse(bytes.toString('utf8', 20, jsonEnd));
  const primitives = (document.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
  const parsed = {
    animations: document.animations?.length ?? 0,
    morphPrimitives: primitives.filter((primitive) => (primitive.targets?.length ?? 0) > 0).length,
    skins: document.skins?.length ?? 0,
  };
  if (JSON.stringify(parsed) !== JSON.stringify(entry.parsed)) {
    throw new Error(`${entry.name}: parsed structural facts changed`);
  }
  const requiresDeformation = parsed.skins > 0 || parsed.morphPrimitives > 0;
  if (requiresDeformation && entry.status !== 'parsed-unsupported') {
    throw new Error(`${entry.name}: deformation status does not match parsed GLB structure`);
  }
  if (!requiresDeformation && parsed.animations > 0 && entry.status !== 'known-limitation') {
    throw new Error(`${entry.name}: unevaluated rigid animation must be classified known-limitation`);
  }
}

console.log(`glTF lab manifest: ${manifest.cases.length} fixtures, ` +
  `${manifest.cases.filter((entry) => entry.status === 'core-fallback-oracle').length} core-fallback, ` +
  `${manifest.cases.filter((entry) => entry.status === 'expected-required-failure').length} required-failure, ` +
  `${manifest.cases.filter((entry) => entry.status === 'parsed-unsupported').length} parsed-unsupported, ` +
  `${manifest.cases.filter((entry) => entry.status === 'known-limitation').length} known-limitation`);
