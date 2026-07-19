import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const AVIF_EXTENSION = "EXT_texture_avif";

const object = (value, label) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
};

const without = (values, value) => values.filter((candidate) => candidate !== value);

/**
 * Normalizes Bistro's non-registered AVIF texture marker at the example-ingestion boundary.
 * Geometry, materials, indices, image identities, and sampler identities are unchanged.
 */
export const normalizeBistroWebDocument = (input) => {
  const document = structuredClone(object(input, "Bistro document"));
  if (!Array.isArray(document.textures)) throw new Error("Bistro textures must be an array");
  let normalizedTextures = 0;
  for (let index = 0; index < document.textures.length; index += 1) {
    const texture = object(document.textures[index], `Bistro textures[${index}]`);
    const extensions = texture.extensions === undefined
      ? undefined
      : object(texture.extensions, `Bistro textures[${index}].extensions`);
    const avif = extensions?.[AVIF_EXTENSION];
    if (avif === undefined) continue;
    const source = object(avif, `Bistro textures[${index}].extensions.${AVIF_EXTENSION}`).source;
    if (!Number.isSafeInteger(source) || source < 0) {
      throw new Error(`Bistro textures[${index}] AVIF source must be a non-negative index`);
    }
    if (texture.source !== undefined && texture.source !== source) {
      throw new Error(`Bistro textures[${index}] has conflicting texture sources`);
    }
    texture.source = source;
    delete extensions[AVIF_EXTENSION];
    if (Object.keys(extensions).length === 0) delete texture.extensions;
    normalizedTextures += 1;
  }
  if (normalizedTextures === 0) {
    throw new Error(`Bistro document does not use ${AVIF_EXTENSION}`);
  }
  if (Array.isArray(document.extensionsUsed)) {
    document.extensionsUsed = without(document.extensionsUsed, AVIF_EXTENSION);
  }
  if (Array.isArray(document.extensionsRequired)) {
    document.extensionsRequired = without(document.extensionsRequired, AVIF_EXTENSION);
  }
  return { document, normalizedTextures };
};

const main = async () => {
  const [, , inputPath, outputPath] = process.argv;
  if (inputPath === undefined || outputPath === undefined) {
    throw new Error("usage: normalize-bistro-web.mjs INPUT.gltf OUTPUT.gltf");
  }
  const input = JSON.parse(await readFile(inputPath, "utf8"));
  const { document, normalizedTextures } = normalizeBistroWebDocument(input);
  await writeFile(outputPath, `${JSON.stringify(document)}\n`);
  console.log(`Bistro web: normalized ${normalizedTextures} AVIF texture sources`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
