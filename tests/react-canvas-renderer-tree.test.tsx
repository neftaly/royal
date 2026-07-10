/** @jsxImportSource @royal/react */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JSX as ReactDevJSX } from "@royal/react/jsx-dev-runtime";
import {
  Button,
  createGltfInstanceTransforms,
  Input,
  Text,
  Textarea,
  type RenderObjectHandle,
  textFieldHeight,
  useFrame,
} from "@royal/react";
import {
  boxGeometry,
  unlitMaterial,
} from "@royal/renderer-core";
import { resolveCanvasChildren } from "../packages/react/src/canvas";
import { createFrameLoop, FrameLoopContext } from "../packages/react/src/frame";
import { createRoyalRendererTree } from "../packages/react/src/renderer-tree";
import { fakeRendererRoot } from "./react-test-fixtures";

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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
        aria-label="Controlled input"
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
    const root = fakeRendererRoot();
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

  it("flushes coalesced handle mutations on every active frame", () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const tree = createRoyalRendererTree();
    const root = fakeRendererRoot();
    const frameLoop = createFrameLoop();
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const AnimatedMesh = () => {
      useFrame(() => {
        const handle = ref.current;
        if (handle === null) return;
        handle.position.set(handle.position.x + 1, 0, 0);
        handle.rotation.set(0, handle.rotation.y + 1, 0);
      });

      return (
        <mesh
          ref={ref}
          geometry={boxGeometry(1)}
          material={unlitMaterial({ color: [1, 0, 0, 1] })}
        />
      );
    };

    tree.setTarget(root, false);
    frameLoop.afterFrame(() => tree.flushFrame());
    tree.render(
      <FrameLoopContext.Provider value={frameLoop}>
        <scene>
          <pass>
            <perspectiveCamera {...perspectiveProps} />
            <AnimatedMesh />
          </pass>
        </scene>
      </FrameLoopContext.Provider>,
    );
    expect(root.render).toHaveBeenCalledTimes(1);

    for (let browserFrame = 1; browserFrame <= 3; browserFrame += 1) {
      const callbacksAtFrameStart = frameCallbacks.splice(0);
      expect(callbacksAtFrameStart).toHaveLength(1);
      for (const callback of callbacksAtFrameStart) callback(browserFrame * 16);
      expect(root.invalidate).toHaveBeenCalledTimes(browserFrame);
      expect(root.render).toHaveBeenCalledTimes(browserFrame + 1);
    }

    frameLoop.dispose();
    tree.dispose();
  });

  it("uses renderer JSX child rules when lowering Canvas descriptors", () => {
    const tree = createRoyalRendererTree();
    const root = fakeRendererRoot();
    const onClick = vi.fn();

    tree.setTarget(root, false);
    tree.render(
      <scene>
        {" \n\t "}
        {false}
        <pass clear="none" depthTest={false}>
          {"\n  "}
          <perspectiveCamera {...perspectiveProps} />
          {null}
          <mesh onClick={onClick}>
            {" \n "}
            <boxGeometry size={[1, 2, 3]} />
            <unlitMaterial color={[0.2, 0.4, 0.8, 1]} />
          </mesh>
        </pass>
      </scene>,
    );

    expect(root.latestScene).toMatchObject({
      children: [
        {
          children: [
            {
              geometry: { kind: "box", size: [1, 2, 3] },
              kind: "mesh",
              material: expect.objectContaining({ kind: "unlit" }),
            },
          ],
          clear: "none",
          depthTest: false,
          kind: "pass",
        },
      ],
      kind: "scene",
    });

    const meshNode = root.latestScene?.children[0]?.children[0];
    expect(meshNode).toBeDefined();
    if (meshNode === undefined) throw new Error("Expected Canvas to lower one mesh node");

    expect(meshNode).not.toHaveProperty("onClick");
    expect(tree.hasPointerEventTargets()).toBe(true);
    expect(tree.pointerEventTarget(meshNode)?.handlers.onClick).toBe(onClick);

    tree.dispose();
  });

  it("lowers one bulk glTF instance resource without per-instance hosts", () => {
    const tree = createRoyalRendererTree();
    const root = fakeRendererRoot();
    const onPointerMove = vi.fn();
    const instances = createGltfInstanceTransforms({ count: 2 });

    tree.setTarget(root, false);
    tree.render(
      <scene>
        <pass>
          <perspectiveCamera {...perspectiveProps} />
          <gltfInstances
            instances={instances}
            onPointerMove={onPointerMove}
            src="/bulk.gltf"
          />
        </pass>
      </scene>,
    );

    const node = root.latestScene?.children[0]?.children[0];
    expect(node).toMatchObject({
      asset: { uri: "/bulk.gltf" },
      instances,
      kind: "gltf-instances",
      src: "/bulk.gltf",
    });
    if (node === undefined) throw new Error("Expected one bulk glTF node");
    expect(tree.pointerEventTarget(node)?.handlers.onPointerMove).toBe(onPointerMove);
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
