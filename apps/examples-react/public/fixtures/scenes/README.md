# glTF scene showcase fixtures

These scene assets are pinned from
[`KhronosGroup/glTF-Sample-Assets`](https://github.com/KhronosGroup/glTF-Sample-Assets)
at revision `2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf`.

- `Sponza/glTF/` preserves the complete upstream multi-file core glTF variant.
- `ABeautifulGame/glTF-Binary/ABeautifulGame.glb` preserves the upstream GLB.
- `VirtualCity/glTF-Binary/VirtualCity.glb` preserves the upstream GLB.

Each model directory also preserves its upstream README, metadata, and license;
`LICENSES/` contains the full text for referenced repository-local licenses.
Run `pnpm --filter @royal/examples-react sync:scene-showcase` to reproduce the
vendored files from the pinned revision.
