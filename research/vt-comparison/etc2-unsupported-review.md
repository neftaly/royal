# ETC2 unsupported-device parity

The native VT unsupported-device matrix now includes `ktx2-etc2` alongside ASTC
6×6/8×8 and BC1/3/7. ETC2 capability is supplied by the renderer root, so the
test explicitly passes `etc2Available: false` through the runtime factory's
positional argument instead of relying on a fake GL extension query.

The case loads its manifest, performs 100 frame updates without throwing, and
settles to `unsupported`. It asserts exactly one fetch (the manifest), no texture
storage allocation and zero retained persistent GPU bytes. ETC2 performs no
extension query inside this runtime because the capability was already supplied;
the other formats retain their existing single-query assertion.

Review confirmed the root queries `WEBGL_compressed_texture_etc` and forwards
the result when activating VT. Supported ETC2 already participates in the shared
byte-reservation/upload/invalidation matrix, and its parser tests cover direct
block views without runtime copying or transcoding.

The runtime and KTX2 suites pass 47 tests together, and root type checking passes.
These use fake GL for deterministic unsupported behavior; they are not a new
physical-device capability or performance measurement. No production changes or
size allowances were needed. Everything remains uncommitted.
