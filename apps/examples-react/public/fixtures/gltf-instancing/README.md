# Royal glTF instancing fixtures

`instanced-cube-a.gltf`, `instanced-cube-b.gltf`, and
`instanced-cube-c.gltf` are locally generated fixtures for the examples app.
They intentionally have identical cube geometry and material data while living
at different URLs, so the renderer can demonstrate automatic cross-asset glTF
geometry instancing.

`ext-mesh-gpu-instancing-cube.gltf` is a locally generated fixture using the
ratified `EXT_mesh_gpu_instancing` extension. It stores one cube mesh and a
5x5x5 translation grid so the renderer can demonstrate asset-authored GPU
instancing.

The buffer data is embedded as a data URI so each fixture is self-contained.
