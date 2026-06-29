# Shader API Research Prototype

Date: 2026-06-29

## Scope

This is a research-only proposal for a public custom shader material API. It
does not modify renderer packages, examples, package configuration, CI, or
runtime exports.

Owned files for this prototype:

- `research/shader-api/README.md`
- `research/shader-api/shader-api-prototype.mjs`
- `research/shader-api/fixtures/custom-shader-materials.json`

Run the prototype validator:

```sh
node research/shader-api/shader-api-prototype.mjs
node research/shader-api/shader-api-prototype.mjs --json
```

## Current Renderer Facts

The current public material surface in `packages/renderer-core/src/material.ts`
is a small discriminated union:

- `standard`, with a `baseColor` texture reference.
- `unlit`, with a `baseColor` texture reference.
- `wireframe`, with a `baseColor` texture reference and `width`.

The WebGL renderer currently owns shader programs privately in
`packages/renderer-webgl/src/programs.ts`. Each program has fixed attributes
and uniforms. Missing attributes and uniforms are hard failures through
`attributeLocation` and `uniformLocation` in `packages/renderer-webgl/src/gl.ts`.
Shader compile and program link failures are also hard failures there.

Current shader inputs are narrow:

- Box mesh program: `a_position`, `a_normal`, `u_model`,
  `u_viewProjection`, `u_boxSize`, light uniforms, color/texture uniforms.
- glTF program: `a_position`, `a_normal`, `a_texCoord`, model/view-projection,
  light uniforms, and base-color texture.
- Text program: `a_position`, `a_glyphCoord`, color and view-projection.
- Wireframe program: `a_position`, color, width, model, view-projection.

Capability research already exists in WebGL and WebGPU packages. WebGL rows
cover WebGL2, extensions, texture limits, compressed textures, timer queries,
and WebGPU probe rows. WebGPU research models backend selection, fallback
policies, feature gates such as `storage-buffer`, and renderer diagnostics.

That shape implies the custom shader API should be declarative. Apps should
describe material intent and shader snippets. Backend-specific program objects,
locations, raw GL handles, and extension names should stay private.

## Proposed Public API

The API should add one material constructor to `@royal/renderer-core`:

```ts
const material = customShaderMaterial({
  id: "app:hologram-rim",
  revision: "2026-06-29",
  fallback: unlitMaterial({
    baseColor: solidTexture({ color: [0.1, 0.35, 0.8, 1] })
  }),
  geometryTargets: ["box"],
  gates: {
    backends: ["webgl2", "webgpu"],
    features: ["texture-asset"],
    limits: { fragmentTextureUnits: 1 }
  },
  attributes: {
    position: shaderAttribute.required("position", "vec3"),
    normal: shaderAttribute.required("normal", "vec3")
  },
  uniforms: {
    tint: shaderUniform.vec4([0.2, 0.72, 1, 1]),
    pulse: shaderUniform.float(0.65),
    baseColor: shaderUniform.texture2d(
      solidTexture({ color: [1, 1, 1, 1], colorSpace: "srgb" })
    )
  },
  snippets: {
    language: "royal-shader-v1",
    portability: "webgl2-webgpu",
    vertex: {
      uses: ["position", "normal"],
      outputs: { worldNormal: "vec3" },
      code: `
        let world = royal.model * vec4(attr.position, 1.0);
        out.worldNormal = normalize((royal.normalMatrix * vec4(attr.normal, 0.0)).xyz);
        return royal.viewProjection * world;
      `
    },
    fragment: {
      inputs: { worldNormal: "vec3" },
      code: `
        let rim = pow(1.0 - saturate(dot(normalize(in.worldNormal), royal.viewDir)), 2.0);
        let lit = 0.35 + rim * uniforms.pulse;
        return vec4(uniforms.tint.rgb * lit, uniforms.tint.a);
      `
    }
  }
});
```

This proposal intentionally uses a Royal shader snippet language instead of
raw GLSL or WGSL as the main public path. The first implementation can lower
the snippets to the current GLSL style used by WebGL2. WebGPU can later lower
the same descriptor to WGSL. Raw backend sources can be a later escape hatch,
but they should not be the default public API.

## Material Contract

`CustomShaderMaterial` should be a new `Material` union member:

```ts
export interface CustomShaderMaterial {
  readonly kind: "custom-shader";
  readonly id: string;
  readonly revision?: string | number;
  readonly fallback: Exclude<Material, CustomShaderMaterial>;
  readonly geometryTargets?: readonly ShaderGeometryTarget[];
  readonly gates?: ShaderCapabilityGates;
  readonly attributes: Readonly<Record<string, ShaderAttributeRequirement>>;
  readonly uniforms?: Readonly<Record<string, ShaderUniform>>;
  readonly snippets: ShaderSnippetProgram;
}
```

The fallback is required. If a backend cannot compile the shader, cannot meet
the gate, or is in a portability mode without support for the requested
snippet, the renderer must draw the fallback material or emit a render
diagnostic. It must not silently skip the mesh.

The fallback should be a built-in material in v1. Recursive custom shader
fallbacks create hard-to-debug loops and unstable failure behavior.

## Typed Uniforms

The API should accept only explicit uniform types:

- `float`
- `int`
- `bool`
- `vec2`
- `vec3`
- `vec4`
- `mat4`
- `texture2d`

Uniform defaults and runtime updates must be validated against the declared
type before a draw attempts to bind them. A `vec4` default with three numbers,
a non-integer `int`, or a malformed texture reference should produce a typed
diagnostic before backend calls.

Program cache identity should include uniform names and types, not uniform
values. Uniform values belong to material instance state and should not cause
program recompilation.

## Attribute Requirements

Attributes should be semantic requirements, not raw backend names:

```ts
shaderAttribute.required("position", "vec3")
shaderAttribute.optional("uv0", "vec2")
```

The renderer lowers semantics to backend attributes:

- `position` -> current WebGL `a_position`.
- `normal` -> current WebGL `a_normal`.
- `uv0` -> current WebGL `a_texCoord` where geometry supplies it.
- `glyphCoord` remains text-only and should not be accepted for mesh materials.

Required attributes must be available for every declared `geometryTarget`.
Optional attributes can be absent only when snippets do not require them.

Initial practical target: custom shader materials on `mesh` nodes for box and
future indexed geometry. glTF custom material support should wait until glTF
primitives share the same private material-resource and geometry-binding path.

## Snippet Contract

The first public path should require:

- One vertex snippet that returns clip-space position.
- One fragment snippet that returns final RGBA.
- Declared vertex outputs and fragment inputs.
- No raw GLSL or WGSL global syntax in portable mode.

Portable snippets must not reference backend-only constructs such as
`gl_FragColor`, `gl_Position`, GLSL `attribute`/`varying` declarations,
`sampler2D`, `texture2D`, WGSL `@fragment`, or WGSL storage address spaces.

The backend lowering layer should own:

- Precision declarations.
- Built-in uniforms such as model, normal matrix, view-projection, and camera.
- Varying declarations.
- Attribute location names.
- Texture sampling syntax.
- Backend error capture and diagnostics.

## Capability Gates

Custom shader materials need declarative gates:

```ts
type ShaderCapabilityGates = {
  readonly backends?: readonly ("webgl2" | "webgpu")[];
  readonly features?: readonly RoyalRendererFeature[];
  readonly limits?: {
    readonly fragmentTextureUnits?: number;
  };
};
```

Gate evaluation should happen before compilation. If gates fail and fallback
exists, the renderer should draw the fallback and emit a diagnostic such as
`renderer_backend_unavailable`, `renderer_feature_unavailable`, or
`renderer_limit_unavailable`.

Gate failure is not a material definition error. Missing fallback, unsupported
attributes, type mismatch, portability violation, compile failure, and link
failure are material definition errors.

## Cache Identity

Use two identities:

- `programCacheKey`: stable hash of shader id, revision, geometry targets,
  gates, attribute declarations, uniform names/types, and snippet source.
- `materialInstanceKey`: stable hash of `programCacheKey`, fallback material,
  uniform defaults, and initial runtime uniform values.

The program cache key must be stable across object key order and uniform value
changes. This prevents a color animation from recompiling the shader program.

The prototype validator proves this with two descriptors that reorder fields
and change uniform values while keeping the same program cache key.

## Edge Cases Covered By Prototype

`shader-api-prototype.mjs` validates fixtures for:

- Valid portable custom shader material.
- Stable program cache identity across object key order and uniform value
  changes.
- Unsupported required attributes on the selected geometry target.
- Uniform runtime type mismatch.
- Missing fallback material.
- WebGL/WebGPU portability violations in portable mode.
- Capability gate fallback when WebGPU-only features are unavailable.
- Shader compile errors.
- Shader link errors from vertex output and fragment input mismatch.

## Implementation Plan

1. Add `CustomShaderMaterial` types and constructor helpers in
   `@royal/renderer-core`.
2. Add pure descriptor validation in renderer-core or a private shared renderer
   module. It should not need a WebGL context.
3. Add a WebGL lowering module that converts `royal-shader-v1` snippets into
   complete GLSL source. It should reuse the current `createProgram`,
   `attributeLocation`, and `uniformLocation` failure boundaries.
4. Add a private program cache keyed by `programCacheKey`.
5. Add material instance uniform binding keyed by `materialInstanceKey`, but
   keep per-frame uniform values mutable without recompilation.
6. In WebGL draw code, route `material.kind === "custom-shader"` through the
   custom shader program when validation, gates, compile, and link pass.
   Otherwise draw the built-in fallback material.
7. Add diagnostics for every fallback or invalid-material reason.
8. Delay WebGPU lowering until the WebGPU renderer has a real draw path. Keep
   WebGPU gates and portability validation in the API from the start so apps do
   not write WebGL-only public materials by accident.

## Tests To Add

Renderer-core unit tests:

- `customShaderMaterial` preserves id, revision, fallback, gates, attributes,
  uniforms, and snippets.
- Uniform helpers reject invalid defaults with actionable diagnostics.
- `programCacheKey` is stable across object key order and uniform value changes.
- Recursive custom fallback is rejected.

WebGL unit tests:

- Valid custom box shader compiles and draws with `position` and `normal`.
- Missing required shader attribute produces `shader_attribute_unsupported`
  before GL binding.
- Missing compiled attribute/uniform from generated source is reported with the
  existing `Missing shader attribute` or `Missing shader uniform` boundary.
- Compile error includes shader id and stage.
- Link error includes shader id and varying/input names.
- Capability gate miss draws the fallback material.
- Fallback material is required; missing fallback does not skip drawing
  silently.
- Uniform runtime updates bind through the declared uniform type and do not
  change the program cache key.
- Texture uniform uses a solid fallback while the texture asset is unresolved.

WebGPU future tests:

- Portable descriptor validates without GLSL tokens.
- WebGPU-only descriptor falls back on WebGL2 when requested gates cannot be
  met.
- Backend-specific raw sources, if added later, require both WebGL2 and WGSL
  sources unless the gates explicitly exclude one backend.
