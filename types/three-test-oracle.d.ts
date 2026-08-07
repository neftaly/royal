declare module "three" {
  export class Euler {
    constructor(x?: number, y?: number, z?: number, order?: "XYZ");
  }

  export class Matrix4 {
    readonly elements: number[];
    makeRotationFromEuler(euler: Euler): this;
  }
}
