# Rust/WASM Scaffold

This is the intended non-prototype shape. It is documented here instead of wired
into the monorepo because this pass owns only `research/pathfinder-svg/**` and
does not change package configs.

## Candidate Crate Layout

```text
research/pathfinder-svg/wasm/
  Cargo.toml
  src/lib.rs
  benches/svg_to_paths.rs
```

Candidate `Cargo.toml` direction:

```toml
[package]
name = "royal_svg_paths_wasm"
version = "0.0.0"
edition = "2021"
publish = false

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
wasm-bindgen = "0.2"
usvg = "0.45" # Placeholder; verify the current usvg release before wiring.

[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
```

The production crate should use current `usvg` directly, not
`pathfinder_svg` as its first dependency. `pathfinder_svg` currently depends on
old `usvg = 0.9` and renderer/content crates, then builds a Pathfinder scene.
That is useful reference code, but it is extra weight for a path extraction
module.

## Backend Adapter Shape

The Rust/WASM crate should enter the JS harness as the `usvg-wasm` backend slot.
Its first responsibility is to emit neutral scene items, not to own every output
policy:

```ts
parseSvgWithUsvg(svg, options) => {
  viewBox,
  items: [{ id, source, transform, style, commands }],
  warnings,
  stats
}
```

The shared JS or product pipeline can then apply transform flattening,
simplification, quantization, packing, benchmark stats, and transfer tests in
the same way as the current `custom-js` backend.

## Export Shape

```rust
#[wasm_bindgen(js_name = parseSvgToPaths)]
pub fn parse_svg_to_paths(svg: &str, options: JsValue) -> Result<JsValue, JsValue> {
    // 1. usvg::Tree::from_str(svg, &Options::default())
    // 2. Walk groups with transform/style state.
    // 3. Emit Royal path commands: M, L, Q, C, Z.
    // 4. Optional flattening/simplification/packing.
    // 5. Return serde-wasm-bindgen JsValue or typed-array handles.
}
```

The JS API should match this prototype:

```ts
parseSvgToPaths(svg, options) => {
  viewBox: { x, y, width, height },
  paths: [
    {
      id,
      source,
      fill,
      stroke,
      fillRule,
      strokeWidth,
      commands: [
        { op: "M", x, y },
        { op: "L", x, y },
        { op: "Q", x1, y1, x, y },
        { op: "C", x1, y1, x2, y2, x, y },
        { op: "Z" }
      ]
    }
  ],
  warnings,
  stats
}
```

For worker-heavy use, prefer a packed return:

```ts
{
  viewBox,
  paths: [{ id, commandOffset, commandCount, coordOffset, coordCount, style }],
  packed: {
    opcodes: Uint8Array,
    coords: Float32Array,
    pathRanges: Uint32Array
  },
  warnings,
  stats
}
```

## Build Steps For The Later Pass

1. Create the crate under `research/pathfinder-svg/wasm` first.
2. Build with `wasm-pack build --target web --release` or a direct
   `cargo build --target wasm32-unknown-unknown --release` plus
   `wasm-bindgen`.
3. Add a benchmark comparing:
   - JSON object graph return through `serde-wasm-bindgen`.
   - Packed typed arrays with transferable buffers.
   - Curve retention versus flattening at several tolerances.
4. Only after the crate is useful, decide where it belongs in the monorepo and
   add package wiring in a separate non-research patch.

## Decomplexion Boundary

Keep parser ownership separate from renderer ownership:

- SVG parsing and style/transform normalization belongs to the SVG asset
  pipeline.
- Curve flattening, quantization, and command packing are asset-output policies.
- Triangulation, GPU upload, and draw submission belong to renderer packages.
- Pathfinder can remain a renderer/reference dependency; it should not dictate
  Royal's asset API.
