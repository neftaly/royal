export enum CameraKind {
  Perspective = 1,
  Orthographic = 2
}

export enum GeometryKind {
  Box = 100
}

export enum MaterialKind {
  Standard = 200,
  Unlit = 201
}

export enum RenderGraphKind {
  Pass = 300,
  Scene = 301
}

export enum RenderNodeKind {
  DirectionalLight = 400,
  Gltf = 401,
  Mesh = 402,
  VectorText = 403
}
