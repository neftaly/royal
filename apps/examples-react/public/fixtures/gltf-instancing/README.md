# Royal glTF instancing fixtures

`instanced-cube-a.gltf`, `instanced-cube-b.gltf`, and
`instanced-cube-c.gltf` are locally generated fixtures for the examples app.
They intentionally have identical cube geometry and material data while living
at different URLs, so the renderer can demonstrate automatic cross-asset glTF
geometry instancing.

The buffer data is embedded as a data URI so each fixture is self-contained.
