/** @jsxImportSource @royal/react */
import { describe, expect, it, vi } from "vitest";
import type { JSX as ReactDevJSX } from "@royal/react/jsx-dev-runtime";
import {
  Button,
  Input,
  Text,
  Textarea,
  type RenderObjectHandle,
  textFieldHeight,
} from "@royal/react";
import {
  boxGeometry,
  type RenderRoot,
  unlitMaterial,
} from "@royal/renderer-core";
import { resolveCanvasChildren } from "../packages/react/src/canvas";
import { createRoyalRendererTree } from "../packages/react/src/renderer-tree";
import type { RoyalRendererRoot } from "../packages/react/src/root";

type ReactElementLike = {
  readonly $$typeof: symbol;
  readonly props: {
    readonly children?: unknown;
  };
  readonly type: unknown;
};

const perspectiveProps = {
  far: 10,
  fovY: Math.PI / 3,
  near: 0.1,
  position: [0, 0, 4] as const,
  rotation: [0, 0, 0] as const,
};

const isReactElementLike = (value: unknown): value is ReactElementLike =>
  typeof value === "object" &&
  value !== null &&
  "$$typeof" in value &&
  "props" in value &&
  "type" in value;

const Cube = () => (
  <mesh
    geometry={boxGeometry(1)}
    material={unlitMaterial({ color: [1, 0, 0, 1] })}
  />
);

const zeroGltfInstancingSnapshot = {
  batchInstancesTotal: 0,
  batchPlansBuilt: 0,
  drawCalls: 0,
  instancesDrawn: 0,
  localModelUploadBytes: 0,
  localModelUploadCalls: 0,
  rootPoseUploadBytes: 0,
  rootPoseUploadCalls: 0,
  rootScaleUploadBytes: 0,
  rootScaleUploadCalls: 0,
};

const zeroGltfLoadDiagnosticsSnapshot = {
  assets: [],
  errorAssets: 0,
  loadingAssets: 0,
  sceneReadyAssets: 0,
};

const zeroVirtualTexturingSnapshot = {
  atlasTextures: 0,
  generatedManifestUses: 0,
  generatedPageFailures: 0,
  generatedPageRasterizeMaxMs: 0,
  generatedPageRasterizeMs: 0,
  generatedPageRequests: 0,
  generatedPagesTarget: 0,
  manifestFailures: 0,
  manifestRequests: 0,
  manifestsReady: 0,
  pageTableTextures: 0,
  pageTableUpdates: 0,
  pendingPages: 0,
  preparedResidencyResolutions: 0,
  requestedPages: 0,
  residentPages: 0,
  shaderBinds: 0,
  unreadyDraws: 0,
  unsupportedDraws: 0,
  uploadedPageBytes: 0,
  uploadedPages: 0,
};

const fakeRoot = (): RoyalRendererRoot => {
  let frame = 0;
  let latestScene: RenderRoot | undefined;
  const root: RoyalRendererRoot = {
    canvas: {} as HTMLCanvasElement,
    context: {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: false,
    },
    get disposed() {
      return false;
    },
    get frame() {
      return frame;
    },
    get latestScene() {
      return latestScene;
    },
    dispose: vi.fn(),
    invalidate: vi.fn(),
    pick: vi.fn(() => undefined),
    render: vi.fn((scene: RenderRoot) => {
      latestScene = scene;
      frame += 1;
    }),
    snapshot: vi.fn(() => ({
      context: root.context,
      disposed: root.disposed,
      frame: root.frame,
      gltfInstancing: zeroGltfInstancingSnapshot,
      gltfLoadDiagnostics: zeroGltfLoadDiagnosticsSnapshot,
      latestScene: root.latestScene,
      virtualTexturing: zeroVirtualTexturingSnapshot,
    })),
  };

  return root;
};

describe("React Canvas renderer tree", () => {
  it("types DOM and Royal scene JSX in the same React file", () => {
    const attrs = { key: "shell" } satisfies ReactDevJSX.IntrinsicAttributes;
    const domProps = { className: "shell" } satisfies ReactDevJSX.IntrinsicElements["div"];
    const shell = (
      <div {...domProps}>
        <scene>
          <pass>
            <perspectiveCamera {...perspectiveProps} />
          </pass>
        </scene>
      </div>
    );

    expect(attrs).toEqual({ key: "shell" });
    expect(isReactElementLike(shell)).toBe(true);
    expect(isReactElementLike(shell) ? shell.type : undefined).toBe("div");
  });

  it("keeps renderer JSX as React elements for Canvas resolution", () => {
    const renderScene = (
      <scene>
        <pass>
          <perspectiveCamera {...perspectiveProps} />
          <Cube />
        </pass>
      </scene>
    );

    expect(isReactElementLike(renderScene)).toBe(true);
    expect(isReactElementLike(renderScene) ? renderScene.type : undefined).toBe("scene");

    const pass = isReactElementLike(renderScene)
      ? renderScene.props.children
      : undefined;
    expect(isReactElementLike(pass)).toBe(true);
    expect(isReactElementLike(pass) ? pass.type : undefined).toBe("pass");

    const passChildren = isReactElementLike(pass)
      ? pass.props.children
      : undefined;
    expect(Array.isArray(passChildren)).toBe(true);
    const child = Array.isArray(passChildren) ? passChildren[1] : undefined;
    expect(isReactElementLike(child)).toBe(true);
    expect(isReactElementLike(child) ? child.type : undefined).toBe(Cube);
  });

  it("resolves an explicit scene regardless of React control order", () => {
    const Controls = () => null;
    const controls = <Controls />;
    const renderScene = (
      <scene>
        <pass>
          <perspectiveCamera {...perspectiveProps} />
        </pass>
      </scene>
    );

    const resolved = resolveCanvasChildren([controls, renderScene]);

    expect(resolved.sceneChild).toBe(renderScene);
    expect(resolved.controls).toEqual([controls]);
  });

  it("requires an explicit scene when React controls sit beside a scene component", () => {
    const Controls = () => null;
    const SceneComponent = () => (
      <scene>
        <pass>
          <perspectiveCamera {...perspectiveProps} />
        </pass>
      </scene>
    );
    const sceneComponent = <SceneComponent />;

    expect(resolveCanvasChildren(sceneComponent).sceneChild).toBe(sceneComponent);
    expect(() => resolveCanvasChildren([
      <Controls />,
      <SceneComponent />,
    ])).toThrow(/explicit <scene>/);
  });

  it("routes surface controls through React components", () => {
    const style = { height: 0.5, left: 0.25, top: 0.5, width: 3 };
    const label = (
      <Text style={style} color={[1, 1, 1, 1]}>
        Boxed label
      </Text>
    );
    const input = (
      <Input
        onValueChange={() => undefined}
        style={style}
        value="Controlled"
      />
    );
    const checkbox = (
      <Input
        checked
        onCheckedChange={() => undefined}
        style={style}
        type="checkbox"
      >
        Checked
      </Input>
    );
    const file = (
      <Input
        onFilesChange={() => undefined}
        style={style}
        type="file"
      >
        File
      </Input>
    );
    const color = (
      <Input
        onValueChange={() => undefined}
        style={style}
        type="color"
        value="#ff0000"
      >
        Color
      </Input>
    );
    const button = (
      <Button
        onPress={() => undefined}
        style={style}
        type="button"
      >
        Press
      </Button>
    );
    const textarea = (
      <Textarea
        onValueChange={() => undefined}
        rows={3}
        style={style}
        value="Notes"
      />
    );

    expect(isReactElementLike(label)).toBe(true);
    expect(isReactElementLike(label) ? label.type : undefined).toBe(Text);
    expect(isReactElementLike(input)).toBe(true);
    expect(isReactElementLike(input) ? input.type : undefined).toBe(Input);
    expect(isReactElementLike(checkbox)).toBe(true);
    expect(isReactElementLike(checkbox) ? checkbox.type : undefined).toBe(Input);
    expect(isReactElementLike(file)).toBe(true);
    expect(isReactElementLike(file) ? file.type : undefined).toBe(Input);
    expect(isReactElementLike(color)).toBe(true);
    expect(isReactElementLike(color) ? color.type : undefined).toBe(Input);
    expect(isReactElementLike(button)).toBe(true);
    expect(isReactElementLike(button) ? button.type : undefined).toBe(Button);
    expect(isReactElementLike(textarea)).toBe(true);
    expect(isReactElementLike(textarea) ? textarea.type : undefined).toBe(Textarea);
  });

  it("does not invalidate again while syncing declarative transform props", () => {
    const tree = createRoyalRendererTree();
    const root = fakeRoot();
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const renderScene = (x: number) => (
      <scene>
        <pass>
          <perspectiveCamera {...perspectiveProps} />
          <mesh
            ref={ref}
            geometry={boxGeometry(1)}
            material={unlitMaterial({ color: [1, 0, 0, 1] })}
            transform={{ position: [x, 0, 0], rotation: [0, 0, 0] }}
          />
        </pass>
      </scene>
    );

    tree.setTarget(root, false);
    tree.render(renderScene(0));
    tree.render(renderScene(1));

    expect(root.render).toHaveBeenCalledTimes(2);
    expect(root.invalidate).not.toHaveBeenCalled();
    expect(ref.current?.position.x).toBe(1);

    ref.current?.position.set([2, 0, 0]);

    expect(root.invalidate).toHaveBeenCalledTimes(1);
    tree.dispose();
  });

  it("measures text field row height from text metrics and padding", () => {
    expect(textFieldHeight({
      lineHeight: 0.4,
      paddingY: 0.1,
      rows: 3,
    })).toBeCloseTo(1.4);
  });
});
