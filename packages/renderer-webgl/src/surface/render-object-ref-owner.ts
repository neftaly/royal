import type {
  GltfNode,
  MeshNode,
  RenderObjectRef,
  Transform,
} from "@royal/renderer-core";
import {
  attachRenderObjectRef,
  readRenderObjectHandleTransform,
  type RenderObjectRefAttachment,
} from "@royal/renderer-core/render-object";

type RenderObjectNode = MeshNode | GltfNode;

type RenderObjectRefEntry = {
  attachment: RenderObjectRefAttachment;
  node: RenderObjectNode;
  readonly ref: RenderObjectRef;
};

export type RenderObjectRefOwnerPlatform = Readonly<{
  onError(error: unknown): void;
  onTransform(node: RenderObjectNode, transform: Transform): void;
}>;

const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

const renderObjectNodes = (
  nodes: readonly unknown[],
): readonly RenderObjectNode[] => {
  const result: RenderObjectNode[] = [];
  for (const candidate of nodes) {
    const node = candidate as Partial<RenderObjectNode> | null;
    if (
      node !== null
      && (node.kind === "mesh" || node.kind === "gltf")
      && node.ref !== undefined
    ) result.push(node as RenderObjectNode);
  }
  return result;
};

/** Root-scoped attachment shell around renderer-core's shared ref lifecycle. */
export class RenderObjectRefOwner {
  #disposed = false;
  #entries: readonly RenderObjectRefEntry[] = [];
  #generation = 0;
  readonly #platform: RenderObjectRefOwnerPlatform;
  readonly #retryDetaches: RenderObjectRefAttachment[] = [];

  constructor(platform: RenderObjectRefOwnerPlatform) {
    this.#platform = platform;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    const entries = this.#entries;
    this.#entries = [];
    for (const entry of entries) this.#detach(entry.attachment, false);
    this.#retryFailedDetaches(false);
  }

  reconcile(nodes: readonly unknown[]): void {
    if (this.#disposed) return;
    const generation = ++this.#generation;
    this.#retryFailedDetaches(true);
    const available = new Map<RenderObjectRef, RenderObjectRefEntry[]>();
    for (const entry of this.#entries) {
      const entries = available.get(entry.ref);
      if (entries === undefined) available.set(entry.ref, [entry]);
      else entries.push(entry);
    }
    const next: RenderObjectRefEntry[] = [];
    for (const node of renderObjectNodes(nodes)) {
      const ref = node.ref!;
      const reusable = available.get(ref)?.shift();
      if (reusable !== undefined) {
        reusable.node = node;
        next.push(reusable);
        continue;
      }
      let entry: RenderObjectRefEntry | undefined;
      try {
        const attachment = attachRenderObjectRef(
          ref,
          node.transform ?? IDENTITY_TRANSFORM,
          () => {
            if (entry === undefined || this.#disposed) return;
            this.#publishEntryTransform(entry);
          },
        );
        entry = { attachment, node, ref };
        next.push(entry);
      } catch (error) {
        this.#platform.onError(error);
      }
      if (this.#generation !== generation) {
        for (const created of next) {
          if (!this.#entries.includes(created)) this.#detach(created.attachment, true);
        }
        return;
      }
    }
    const previous = this.#entries;
    this.#entries = next;
    for (const entry of next) {
      try {
        entry.attachment.syncTransform(entry.node.transform ?? IDENTITY_TRANSFORM);
      } catch (error) {
        this.#platform.onError(error);
      }
      if (this.#generation !== generation) return;
    }
    for (const entry of previous) {
      if (!next.includes(entry)) this.#detach(entry.attachment, true);
      if (this.#generation !== generation) return;
    }
    this.applyCurrentTransforms();
  }

  applyCurrentTransforms(): void {
    if (this.#disposed) return;
    const generation = this.#generation;
    for (const entry of this.#entries) {
      this.#publishEntryTransform(entry);
      if (this.#generation !== generation) return;
    }
  }

  #detach(attachment: RenderObjectRefAttachment, retry: boolean): void {
    try {
      attachment.detach();
    } catch (error) {
      if (retry) this.#retryDetaches.push(attachment);
      this.#platform.onError(error);
    }
  }

  #publishEntryTransform(entry: RenderObjectRefEntry): void {
    this.#platform.onTransform(
      entry.node,
      readRenderObjectHandleTransform(entry.attachment.handle),
    );
  }

  #retryFailedDetaches(retainFailures: boolean): void {
    if (this.#retryDetaches.length === 0) return;
    const pending = this.#retryDetaches.splice(0);
    for (const attachment of pending) this.#detach(attachment, retainFailures);
  }
}
