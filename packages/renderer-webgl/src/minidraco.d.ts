declare module "minidraco" {
  export interface Attribute {
    readonly numComponents: number;
    extractTo(constructor: Float32ArrayConstructor, count: number): Float32Array;
  }

  export interface Mesh {
    readonly faces_: Uint32Array;
    getAttributeByUniqueId(uniqueId: number): Attribute | null;
    numFaces(): number;
    numPoints(): number;
  }

  export function decodeDracoMesh(bytes: Uint8Array): Mesh;
}
