declare module "draco3dgltf" {
  export type DracoDecoderModuleOptions = {
    readonly locateFile?: (path: string, prefix: string) => string;
  };

  export type DracoPointer = {
    readonly ptr: number;
  };

  export type DracoDecoderBuffer = DracoPointer & {
    Init(bytes: Int8Array, byteLength: number): void;
  };

  export type DracoStatus = DracoPointer & {
    code(): number;
    error_msg(): string;
    ok(): boolean;
  };

  export type DracoPointAttribute = DracoPointer & {
    byte_offset(): number;
    byte_stride(): number;
    data_type(): number;
    normalized(): boolean;
    num_components(): number;
    size(): number;
    unique_id(): number;
  };

  export type DracoMesh = DracoPointer & {
    num_attributes(): number;
    num_faces(): number;
    num_points(): number;
  };

  export type DracoFloat32Array = DracoPointer & {
    GetValue(index: number): number;
    size(): number;
  };

  export type DracoInt32Array = DracoPointer & {
    GetValue(index: number): number;
    size(): number;
  };

  export type DracoDecoder = DracoPointer & {
    DecodeBufferToMesh(buffer: DracoDecoderBuffer, mesh: DracoMesh): DracoStatus;
    GetAttributeByUniqueId(mesh: DracoMesh, uniqueId: number): DracoPointAttribute;
    GetAttributeFloatForAllPoints(
      mesh: DracoMesh,
      attribute: DracoPointAttribute,
      output: DracoFloat32Array,
    ): boolean;
    GetEncodedGeometryType(buffer: DracoDecoderBuffer | Int8Array): number;
    GetFaceFromMesh(mesh: DracoMesh, faceIndex: number, output: DracoInt32Array): boolean;
  };

  export type DracoDecoderModule = {
    readonly Decoder: new () => DracoDecoder;
    readonly DecoderBuffer: new () => DracoDecoderBuffer;
    readonly DracoFloat32Array: new () => DracoFloat32Array;
    readonly DracoInt32Array: new () => DracoInt32Array;
    readonly INVALID_GEOMETRY_TYPE: number;
    readonly NORMAL: number;
    readonly POINT_CLOUD: number;
    readonly POSITION: number;
    readonly TEX_COORD: number;
    readonly TRIANGULAR_MESH: number;
    readonly Mesh: new () => DracoMesh;
    destroy(value: DracoPointer): void;
  };

  const draco3dgltf: {
    createDecoderModule(options?: DracoDecoderModuleOptions): Promise<DracoDecoderModule>;
  };

  export default draco3dgltf;
}
