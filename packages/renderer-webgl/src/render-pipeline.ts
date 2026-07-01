import {
  type DirectionalLightNode,
  type GltfNode,
  type MeshNode,
  type RenderNode,
  type RenderPass,
  type TextNode,
} from "@royal/renderer-core";
import { drawGltf, drawMesh, drawVectorText } from "./draw";
import type { GeometryCache } from "./geometry-cache";
import type { GltfAsset, GltfCache } from "./gltf-cache";
import type { RendererWebGlContext } from "./gl";
import type { Mat4 } from "./matrix";
import { markGltf } from "./performance";
import type {
  GltfProgram,
  MeshProgram,
  TextProgram,
  WireframeProgram,
} from "./programs";
import { findDirectionalLight } from "./render-graph";
import type { MaterialVirtualTextureRuntimeStats } from "./material-texture-binding";
import type { TextCache, TextRenderAsset } from "./text-cache";
import type { TextureCache } from "./texture-cache";
import type { VirtualTextureCache } from "./virtual-texture-cache";
import {
  buildVisibilityPackets,
  cullVisibilityPackets,
  extractFrustumPlanes,
  type VisibilityCullResult,
  type VisibilityPacketBuffer,
} from "./visibility";

interface WebGlRenderPipelineResources {
  readonly drawnGltfAssets: WeakSet<object>;
  readonly frame: number;
  readonly geometryCache: GeometryCache;
  readonly gl: RendererWebGlContext;
  readonly gltfCache: GltfCache;
  readonly gltfProgram: GltfProgram;
  readonly meshProgram: MeshProgram;
  readonly onTextureSettled: () => void;
  readonly onVirtualTextureRuntimeStats: (stats: MaterialVirtualTextureRuntimeStats) => void;
  readonly textCache: TextCache;
  readonly textProgram: TextProgram;
  readonly textureCache: TextureCache;
  readonly viewport: { readonly height: number; readonly width: number };
  readonly virtualTextureCache: VirtualTextureCache;
  readonly wireframeProgram: WireframeProgram;
}

type ResolvedRenderPacket =
  | {
    readonly kind: "gltf";
    readonly asset: GltfAsset;
    readonly node: GltfNode;
  }
  | {
    readonly kind: "mesh";
    readonly node: MeshNode;
  }
  | {
    readonly kind: "text";
    readonly asset: TextRenderAsset;
    readonly node: TextNode;
  };

export const renderWebGlPass = (
  pass: RenderPass,
  viewProjectionMatrix: Mat4,
  resources: WebGlRenderPipelineResources,
): void => {
  const directionalLight = findDirectionalLight(pass);
  const packets = buildRenderPackets(pass, resources);
  const visible = cullRenderPackets(packets, viewProjectionMatrix);

  clearRenderPass(resources.gl, pass);
  drawVisibleRenderPackets(
    pass,
    packets,
    visible,
    directionalLight,
    viewProjectionMatrix,
    resources,
  );
};

const buildRenderPackets = (
  pass: RenderPass,
  resources: WebGlRenderPipelineResources,
): VisibilityPacketBuffer =>
  buildVisibilityPackets(pass, {
    gltfBounds: (node) => resources.gltfCache.getBounds(node),
  });

const cullRenderPackets = (
  packets: VisibilityPacketBuffer,
  viewProjectionMatrix: Mat4,
): VisibilityCullResult =>
  cullVisibilityPackets(packets, extractFrustumPlanes(viewProjectionMatrix));

const clearRenderPass = (
  gl: RendererWebGlContext,
  pass: RenderPass,
): void => {
  const clearColor = pass.clearColor;
  gl.clearColor(clearColor[0], clearColor[1], clearColor[2], clearColor[3]);
  gl.clearDepth(1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
};

const drawVisibleRenderPackets = (
  pass: RenderPass,
  packets: VisibilityPacketBuffer,
  visible: VisibilityCullResult,
  directionalLight: DirectionalLightNode | undefined,
  viewProjectionMatrix: Mat4,
  resources: WebGlRenderPipelineResources,
): void => {
  for (const packetIndex of visible.visibleIndices) {
    const node = nodeForPacket(pass, packets, packetIndex);
    const packet = resolveRenderPacketResources(node, resources);
    if (packet === undefined) continue;

    drawResolvedRenderPacket(
      packet,
      directionalLight,
      viewProjectionMatrix,
      resources,
    );
  }
};

const nodeForPacket = (
  pass: RenderPass,
  packets: VisibilityPacketBuffer,
  packetIndex: number,
): RenderNode => {
  const nodeIndex = packets.nodeIndices[packetIndex];
  if (nodeIndex === undefined) {
    throw new Error(`Visibility result references missing packet: ${packetIndex}`);
  }

  const node = pass.children[nodeIndex];
  if (node === undefined) {
    throw new Error(`Visibility packet references missing render node: ${nodeIndex}`);
  }
  return node;
};

const resolveRenderPacketResources = (
  node: RenderNode,
  resources: WebGlRenderPipelineResources,
): ResolvedRenderPacket | undefined => {
  switch (node.kind) {
    case "directional-light":
      return undefined;
    case "gltf":
      {
        const asset = resources.gltfCache.get(node);
        return asset === undefined ? undefined : { asset, kind: "gltf", node };
      }
    case "mesh":
      return { kind: "mesh", node };
    case "text":
      return {
        asset: resources.textCache.get(node),
        kind: "text",
        node,
      };
    default:
      assertNever(node);
  }
};

const drawResolvedRenderPacket = (
  packet: ResolvedRenderPacket,
  directionalLight: DirectionalLightNode | undefined,
  viewProjectionMatrix: Mat4,
  resources: WebGlRenderPipelineResources,
): void => {
  switch (packet.kind) {
    case "gltf":
      drawGltfPacket(packet, directionalLight, viewProjectionMatrix, resources);
      break;
    case "mesh":
      drawMesh(
        resources.gl,
        { mesh: resources.meshProgram, wireframe: resources.wireframeProgram },
        packet.node,
        {
          directionalLight,
          frame: resources.frame,
          geometryCache: resources.geometryCache,
          onVirtualTextureRuntimeStats: resources.onVirtualTextureRuntimeStats,
          onTextureSettled: resources.onTextureSettled,
          textureCache: resources.textureCache,
          viewport: resources.viewport,
          virtualTextureCache: resources.virtualTextureCache,
          viewProjectionMatrix,
        },
      );
      break;
    case "text":
      drawTextPacket(packet, viewProjectionMatrix, resources);
      break;
    default:
      assertNever(packet);
  }
};

const drawGltfPacket = (
  packet: Extract<ResolvedRenderPacket, { readonly kind: "gltf" }>,
  directionalLight: DirectionalLightNode | undefined,
  viewProjectionMatrix: Mat4,
  resources: WebGlRenderPipelineResources,
): void => {
  drawGltf(
    resources.gl,
    { gltf: resources.gltfProgram },
    packet.node,
    packet.asset,
    {
      directionalLight,
      viewProjectionMatrix,
    },
  );
  if (!resources.drawnGltfAssets.has(packet.asset)) {
    resources.drawnGltfAssets.add(packet.asset);
    markGltf("first-draw");
  }
};

const drawTextPacket = (
  packet: Extract<ResolvedRenderPacket, { readonly kind: "text" }>,
  viewProjectionMatrix: Mat4,
  resources: WebGlRenderPipelineResources,
): void => {
  const gl = resources.gl;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.CULL_FACE);
  gl.depthMask(false);
  drawVectorText(
    gl,
    { text: resources.textProgram },
    packet.node,
    packet.asset,
    {
      viewProjectionMatrix,
    },
  );
  gl.depthMask(true);
  gl.enable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
};

const assertNever = (value: never): never => {
  throw new Error(`Unsupported render node kind: ${String(value)}`);
};
