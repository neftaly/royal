# Cooperative ASTC encoding

This optional worker is loaded only after RGBA page demand settles on a device
that supports ASTC LDR. It encodes one six-pixel block row per owner grant;
foreground page work prevents the next grant. Quality 0 is the fastest preset.
The current encoder handles sRGB automatic 132px pages only. Other pages retain
the existing path.

`encoder.wasm` is the existing single-thread SIMD Arm astcenc 5.5.0 build from
Probability's asset pipeline. Apache-2.0 notices are included here and in the
published package THIRD_PARTY_NOTICES. `codec/astc.cpp` and `codec/build.mjs` reproduce the
wrapper with official astcenc 5.5.0 sources and Emscripten 6.0.9; the unused
mip-downsampling ABI remains in this shared binary but is not used by VT pages.

SHA-256: `c283efbbf63930c4a69747321182c58470e33af777fab248c2d0ae23c66e9744`.

Run `node codec/build.mjs /path/to/astc-encoder /path/to/em++` to rebuild.
GPU storage, page publication, cancellation and budget accounting remain owned
by Royal. WASM failure disables the optional optimization and leaves RGBA usable.
