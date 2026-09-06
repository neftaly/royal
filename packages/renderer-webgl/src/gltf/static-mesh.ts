import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import type { DecodedDracoPrimitive } from "./draco";
import type { PreparedStaticMaterialLod } from "./static-asset";
import type { createStaticMaterialSetPreparer } from "./static-material-set";
import { array, fail, index, integer, object, type JsonObject } from "./gltf-values";
import {
  decodedPositions,
  readFloatVectors,
  readIndices,
  readPositions,
  readTextureCoordinates,
  readVertexColors,
  validateDecodedVectors,
  type AccessorContext,
} from "./accessor-reader";
import { canonicalTriangleIndices } from "./triangle-topology";
import { staticGeometryTaskKeyMap, type StaticGeometryTaskPlan } from "./static-geometry-plan";

export type StaticDracoDecoder = (primitive: JsonObject, path: string) => DecodedDracoPrimitive;

type PreparedMeshPrimitive = Readonly<{
  deferredGeometryKey?: string;
  geometry: CanonicalTriangleGeometry;
  material: CanonicalSurfaceMaterial;
  materialLod?: PreparedStaticMaterialLod;
  materialVariants?: ReadonlyMap<string, CanonicalSurfaceMaterial>;
  materialVariantLods?: ReadonlyMap<string, PreparedStaticMaterialLod>;
}>;

/** Decoded and accessor-backed attributes converge before mesh assembly. */
const readVertexAttribute = (
  context: AccessorContext,
  attributes: JsonObject,
  decoded: DecodedDracoPrimitive | undefined,
  semantic: "NORMAL" | "TANGENT" | "TEXCOORD_0" | "TEXCOORD_1",
  vertexCount: number,
  primitivePath: string,
): Float32Array | undefined => {
  if (attributes[semantic] === undefined) return undefined;
  const { label, accessors } = context;
  const path = `${primitivePath}.attributes.${semantic}`;
  const components = semantic === "NORMAL" ? 3 : semantic === "TANGENT" ? 4 : 2;
  const decodedValues = decoded?.attribute(semantic);
  let values: Float32Array;
  if (decodedValues !== undefined) {
    values = validateDecodedVectors(decodedValues, components, label, path);
  } else {
    const accessor = index(attributes[semantic], accessors, label, path);
    values =
      semantic === "TEXCOORD_0" || semantic === "TEXCOORD_1"
        ? readTextureCoordinates(context, accessor, semantic)
        : readFloatVectors(
            context,
            accessor,
            semantic === "NORMAL" ? "VEC3" : "VEC4",
            components,
            semantic,
          );
  }
  if (values.length / components !== vertexCount) fail(label, path, "count must match POSITION");
  return values;
};

/** Per-document mesh lowering cache. Transport, scene traversal and publication stay with their owners. */
export const createStaticMeshPreparer = (
  meshes: readonly unknown[],
  context: AccessorContext,
  contentKey: string,
  preparePrimitiveMaterialSet: ReturnType<typeof createStaticMaterialSetPreparer>,
  decodeDraco: StaticDracoDecoder | undefined,
  geometryTasks: StaticGeometryTaskPlan | undefined,
  computeGeometryTaskKeys: ReadonlySet<string> | undefined,
) => {
  const { accessors, label } = context;
  const geometryTaskKeys = staticGeometryTaskKeyMap(geometryTasks);
  const preparedMeshes: Array<readonly PreparedMeshPrimitive[] | undefined> = [];
  const prepareMesh = (meshIndex: number): readonly PreparedMeshPrimitive[] => {
    const retained = preparedMeshes[meshIndex];
    if (retained !== undefined) return retained;
    const meshPath = `meshes[${meshIndex}]`;
    const mesh = object(meshes[meshIndex], label, meshPath);
    if (mesh.weights !== undefined) fail(label, `${meshPath}.weights`, "are not supported yet");
    const primitives = array(mesh.primitives, label, `${meshPath}.primitives`);
    const prepared = primitives.map((primitiveValue, primitiveIndex): PreparedMeshPrimitive => {
      const path = `${meshPath}.primitives[${primitiveIndex}]`;
      const primitive = object(primitiveValue, label, path);
      const primitiveMode =
        primitive.mode === undefined ? 4 : integer(primitive.mode, label, `${path}.mode`);
      const mode: 4 | 5 | 6 =
        primitiveMode === 4 || primitiveMode === 5 || primitiveMode === 6
          ? primitiveMode
          : fail(label, `${path}.mode`, "must be TRIANGLES, TRIANGLE_STRIP, or TRIANGLE_FAN");
      if (primitive.targets !== undefined) fail(label, `${path}.targets`, "are not supported yet");
      const attributes = object(primitive.attributes, label, `${path}.attributes`);
      const extensions =
        primitive.extensions === undefined
          ? {}
          : object(primitive.extensions, label, `${path}.extensions`);
      const hasDraco = extensions.KHR_draco_mesh_compression !== undefined;
      const {
        material,
        materialLod,
        materialVariants,
        materialVariantLods,
        usesTextureCoordinates0,
        usesTextureCoordinates1,
      } = preparePrimitiveMaterialSet(primitive, extensions, path);
      const plannedTaskKey = geometryTaskKeys.get(`${meshIndex}:${primitiveIndex}`);
      if (geometryTasks !== undefined && plannedTaskKey === undefined) {
        fail(label, path, "is missing its planned geometry task");
      }
      const deferGeometry =
        plannedTaskKey !== undefined && computeGeometryTaskKeys?.has(plannedTaskKey) === false;
      if (deferGeometry) {
        index(attributes.POSITION, accessors, label, `${path}.attributes.POSITION`);
        if (hasDraco && mode !== 4) {
          fail(label, `${path}.mode`, "Draco geometry must use TRIANGLES");
        }
        if (usesTextureCoordinates0 && attributes.TEXCOORD_0 === undefined) {
          fail(label, `${path}.attributes.TEXCOORD_0`, "is required by the material");
        }
        if (usesTextureCoordinates1 && attributes.TEXCOORD_1 === undefined) {
          fail(label, `${path}.attributes.TEXCOORD_1`, "is required by the material");
        }
        return {
          deferredGeometryKey: plannedTaskKey,
          geometry: {
            bounds: { max: [0, 0, 0], min: [0, 0, 0] },
            indices: new Uint16Array(),
            key: `shared:${plannedTaskKey}`,
            positions: new Float32Array(),
            sourceKey: plannedTaskKey,
          },
          material,
          ...(materialLod === undefined ? {} : { materialLod }),
          ...(materialVariants === undefined ? {} : { materialVariants }),
          ...(materialVariantLods === undefined ? {} : { materialVariantLods }),
        };
      }
      const decoded = hasDraco
        ? (decodeDraco?.(primitive, path) ??
          fail(label, `${path}.extensions.KHR_draco_mesh_compression`, "is unsupported"))
        : undefined;
      const positionAccessor = index(
        attributes.POSITION,
        accessors,
        label,
        `${path}.attributes.POSITION`,
      );
      const decodedPositionValues = decoded?.attribute("POSITION");
      const { bounds, positions } =
        decodedPositionValues === undefined
          ? readPositions(context, positionAccessor)
          : decodedPositions(decodedPositionValues, label, `${path}.attributes.POSITION`);
      const vertexCount = positions.length / 3;
      const colors =
        attributes.COLOR_0 === undefined
          ? undefined
          : readVertexColors(
              context,
              index(attributes.COLOR_0, accessors, label, `${path}.attributes.COLOR_0`),
              decoded?.attribute("COLOR_0"),
            );
      if (colors !== undefined && colors.length / 4 !== vertexCount) {
        fail(label, `${path}.attributes.COLOR_0`, "count must match POSITION");
      }
      const normals = readVertexAttribute(
        context,
        attributes,
        decoded,
        "NORMAL",
        vertexCount,
        path,
      );
      const textureCoordinates0 = readVertexAttribute(
        context,
        attributes,
        decoded,
        "TEXCOORD_0",
        vertexCount,
        path,
      );
      const textureCoordinates1 = usesTextureCoordinates1
        ? readVertexAttribute(context, attributes, decoded, "TEXCOORD_1", vertexCount, path)
        : undefined;
      const tangents = readVertexAttribute(
        context,
        attributes,
        decoded,
        "TANGENT",
        vertexCount,
        path,
      );
      const indexAccessor =
        primitive.indices === undefined
          ? undefined
          : index(primitive.indices, accessors, label, `${path}.indices`);
      if (decoded !== undefined && mode !== 4) {
        fail(label, `${path}.mode`, "Draco geometry must use TRIANGLES");
      }
      const indices = canonicalTriangleIndices(
        decoded?.indices ?? readIndices(context, indexAccessor, vertexCount),
        mode,
      );
      if (indices.length < 3 || indices.length % 3 !== 0) {
        fail(label, path, "triangle index count must be a positive multiple of 3");
      }
      for (let item = 0; item < indices.length; item += 1) {
        if (indices[item]! >= vertexCount) {
          fail(label, `${path}.indices[${item}]`, "decoded vertex index is out of range");
        }
      }
      if (usesTextureCoordinates0 && textureCoordinates0 === undefined) {
        fail(label, `${path}.attributes.TEXCOORD_0`, "is required by the material");
      }
      if (usesTextureCoordinates1 && textureCoordinates1 === undefined) {
        fail(label, `${path}.attributes.TEXCOORD_1`, "is required by the material");
      }
      const sourceKey = plannedTaskKey;
      return {
        geometry: {
          bounds,
          ...(colors === undefined ? {} : { colors }),
          indices,
          key: `${contentKey}:mesh:${meshIndex}:primitive:${primitiveIndex}`,
          ...(normals === undefined ? {} : { normals }),
          positions,
          ...(tangents === undefined ? {} : { tangents }),
          ...(textureCoordinates0 === undefined ? {} : { textureCoordinates0 }),
          ...(textureCoordinates1 === undefined ? {} : { textureCoordinates1 }),
          ...(sourceKey === undefined ? {} : { sourceKey }),
        },
        material,
        ...(materialLod === undefined ? {} : { materialLod }),
        ...(materialVariants === undefined ? {} : { materialVariants }),
        ...(materialVariantLods === undefined ? {} : { materialVariantLods }),
      };
    });
    preparedMeshes[meshIndex] = prepared;
    return prepared;
  };

  return prepareMesh;
};
