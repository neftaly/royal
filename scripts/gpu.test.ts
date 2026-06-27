import { describe, expect, it } from 'vitest';

import { formatCapabilitySummary } from './gpu';
import type { RendererCapabilityProbeResult } from '../packages/react-royal-fiber/src/webgl/webgl-capabilities';

describe('formatCapabilitySummary', () => {
  it('prints the capability rows required by GPU startup tooling', () => {
    const summary = formatCapabilitySummary({
      diagnostics: [
        {
          code: 'renderer_capability_missing',
          field: 'capability',
          key: 'gpu_timer_query',
          message: 'gpu_timer_query is not available',
          relation: 'renderer_capability',
          severity: 'info'
        }
      ],
      rows: [
        {
          api: 'webgl',
          kind: 'context_version',
          renderer: 'Royal Test Renderer',
          shadingLanguageVersion: 'WebGL GLSL ES 3.00',
          vendor: 'Royal Test Vendor',
          version: 2,
          versionLabel: 'WebGL 2.0'
        },
        { kind: 'max_texture_size', value: 16384 },
        { kind: 'max_texture_units', scope: 'fragment', value: 16 },
        { kind: 'max_texture_units', scope: 'combined', value: 32 },
        {
          capability: 'webgl2',
          kind: 'renderer_capability',
          source: 'webgl2-core',
          supported: true
        },
        {
          capability: 'draw_buffers',
          kind: 'renderer_capability',
          source: 'webgl2-core',
          supported: true
        },
        {
          capability: 'compressed_texture',
          extension: 'WEBGL_compressed_texture_s3tc',
          kind: 'renderer_capability',
          source: 'webgl-extension',
          supported: true
        },
        {
          capability: 'gpu_timer_query',
          kind: 'renderer_capability',
          source: 'missing',
          supported: false
        },
        { kind: 'webgl_extension', name: 'WEBGL_compressed_texture_s3tc', supported: true },
        { kind: 'gpu_timer_query_support', queryApi: 'none', supported: false },
        {
          extension: 'WEBGL_compressed_texture_s3tc',
          family: 's3tc',
          format: 'COMPRESSED_RGB_S3TC_DXT1_EXT',
          kind: 'compressed_texture_format',
          value: 33776
        }
      ]
    } satisfies RendererCapabilityProbeResult);

    expect(summary).toEqual([
      'Context: WebGL 2 (WebGL 2.0) vendor=Royal Test Vendor renderer=Royal Test Renderer',
      'Texture limits: max-size=16384 units(fragment=16, combined=32)',
      'Capability gates: webgl2=yes[webgl2-core], draw_buffers=yes[webgl2-core], compressed_texture=yes[WEBGL_compressed_texture_s3tc], gpu_timer_query=no[missing]',
      'Timer query: no[none]',
      'Compressed texture formats: s3tc:COMPRESSED_RGB_S3TC_DXT1_EXT',
      'WebGL extensions: 1',
      'Capability diagnostics: gpu_timer_query'
    ]);
  });
});
