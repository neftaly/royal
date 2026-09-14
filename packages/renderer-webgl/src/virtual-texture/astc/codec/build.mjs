// Rebuild with Emscripten 6.0.9 and official Arm astc-encoder 5.5.0.
// Usage: node build.mjs /path/to/astc-encoder /path/to/em++
import { execFileSync } from 'node:child_process';
import { chmodSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const source = resolve(process.argv[2], 'Source');
const files = readdirSync(source)
  .filter((name) => name.startsWith('astcenc_') && name.endsWith('.cpp'))
  .map((name) => resolve(source, name));
execFileSync(
  process.argv[3] ?? 'em++',
  [
    ...files,
    resolve(directory, 'astc.cpp'),
    '-I',
    source,
    '-O3',
    '-flto',
    '-std=c++14',
    '-msimd128',
    '-msse4.1',
    '-DASTCENC_SSE=41',
    '-DASTCENC_AVX=0',
    '-DASTCENC_NEON=0',
    '-DASTCENC_POPCNT=0',
    '-DASTCENC_F16C=0',
    '-DASTCENC_BLOCK_MAX_TEXELS=64',
    '-DNDEBUG',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sINITIAL_MEMORY=4194304',
    '-sFILESYSTEM=0',
    '-sMALLOC=emmalloc',
    '-sENVIRONMENT=worker',
    '--no-entry',
    '-sSTANDALONE_WASM=1',
    '-sEXPORTED_FUNCTIONS=["_create_encoder","_encode","_downsample","_destroy_encoder","_malloc","_free"]',
    '-o',
    resolve(directory, '../encoder.wasm'),
  ],
  { stdio: 'inherit' },
);

chmodSync(resolve(directory, '../encoder.wasm'), 0o644);
