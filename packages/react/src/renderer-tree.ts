import {
  type RenderObjectHandle,
  type RenderObjectRefObject,
  type RenderRoot,
} from '@royal/renderer-core';
import { createRenderObjectHandle } from '@royal/renderer-core/render-object';
import { createContext, type ReactNode } from 'react';
import ReactReconciler from 'react-reconciler';
import {
  ConcurrentRoot,
  DefaultEventPriority,
  NoEventPriority,
} from 'react-reconciler/constants.js';
import {
  createRendererElement,
  isRenderRootDescriptor,
  isRoyalRendererJsxElement,
  type JSX as RoyalReactJSX,
  type RoyalRendererJsxElement,
} from './jsx-runtime-internal';
import {
  hasRoyalPointerEventHandlers,
  royalPointerEventHandlersFrom,
  type RoyalPointerEventTarget,
} from './picking-events';
import { rendererDescriptorHostType } from './renderer-output';
import type { RoyalRendererRoot } from './root';

type RoyalHostType = keyof RoyalReactJSX.IntrinsicElements | typeof rendererDescriptorHostType;
type RoyalHostProps = Record<string, unknown>;
type RoyalRenderObjectTransform = Parameters<typeof createRenderObjectHandle>[0];
type RoyalPublicInstance = RenderObjectHandle | RoyalHostInstance | RoyalTextInstance;
type RoyalHostParent = RoyalHostInstance | RoyalRendererContainer;
type RoyalHostChild = RoyalHostInstance | RoyalTextInstance;
type RoyalHostContext = Record<string, never>;

type RoyalHostInstance = {
  readonly kind: 'host';
  readonly rootContainer: RoyalRendererContainer;
  readonly renderObjectInvalidation: { suppress: boolean } | null;
  readonly renderObjectHandle: RenderObjectHandle | null;
  readonly renderObjectRef: RenderObjectRefObject | null;
  children: RoyalHostChild[];
  hidden: boolean;
  parent: RoyalHostParent | null;
  props: RoyalHostProps;
  type: RoyalHostType;
};

type RoyalTextInstance = {
  readonly kind: 'text';
  hidden: boolean;
  parent: RoyalHostParent | null;
  text: string;
};

type RoyalRendererContainer = {
  children: RoyalHostChild[];
  disabled: boolean;
  hasPointerEventTargets: boolean;
  latestScene: RenderRoot | undefined;
  pointerEventTargets: WeakMap<object, RoyalPointerEventTarget>;
  root: RoyalRendererRoot | null;
  renderLatest(): void;
  scheduleRenderLatest(): void;
};

type RoyalPointerEventTargetRegistry = {
  hasPointerEventTargets: boolean;
  pointerEventTargets: WeakMap<object, RoyalPointerEventTarget>;
};

type RoyalReconciler = ReturnType<typeof createReconciler>;

const identityTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
} satisfies RoyalRenderObjectTransform;
const hostContext = {} as const satisfies RoyalHostContext;

const isRenderObjectHostType = (type: RoyalHostType): boolean =>
  type === 'mesh' || type === 'gltf';

const resolveRenderObjectTransform = (
  transform: unknown,
): RoyalRenderObjectTransform => {
  if (typeof transform !== 'object' || transform === null) return identityTransform;

  const options = transform as Partial<RoyalRenderObjectTransform>;
  return {
    position: options.position ?? identityTransform.position,
    rotation: options.rotation ?? identityTransform.rotation,
    scale: options.scale ?? identityTransform.scale,
  };
};

const removeChildFromList = (
  parent: RoyalHostParent,
  child: RoyalHostChild,
): void => {
  const index = parent.children.indexOf(child);
  if (index !== -1) parent.children.splice(index, 1);
};

const detachChild = (child: RoyalHostChild): void => {
  if (child.parent === null) return;

  removeChildFromList(child.parent, child);
  child.parent = null;
};

const appendHostChild = (
  parent: RoyalHostParent,
  child: RoyalHostChild,
): void => {
  detachChild(child);
  parent.children.push(child);
  child.parent = parent;
};

const insertHostChildBefore = (
  parent: RoyalHostParent,
  child: RoyalHostChild,
  beforeChild: RoyalHostChild,
): void => {
  detachChild(child);
  const beforeIndex = parent.children.indexOf(beforeChild);
  if (beforeIndex === -1) {
    parent.children.push(child);
  } else {
    parent.children.splice(beforeIndex, 0, child);
  }
  child.parent = parent;
};

const removeHostChild = (
  parent: RoyalHostParent,
  child: RoyalHostChild,
): void => {
  removeChildFromList(parent, child);
  child.parent = null;
};

const descriptorChildrenFor = (
  instance: RoyalHostInstance,
  pointerEventRegistry: RoyalPointerEventTargetRegistry,
): readonly (RoyalRendererJsxElement | string)[] => {
  const children: (RoyalRendererJsxElement | string)[] = [];

  for (const child of instance.children) {
    const descriptor = toDescriptorChild(child, pointerEventRegistry, instance.type);
    if (descriptor !== undefined) children.push(descriptor);
  }

  return children;
};

const withDescriptorChildren = (
  instance: RoyalHostInstance,
  children: readonly (RoyalRendererJsxElement | string)[],
): RoyalHostProps => {
  const props = { ...instance.props };
  delete props.children;
  delete props.ref;

  if (children.length === 1) {
    props.children = children[0];
  } else if (children.length > 1) {
    props.children = children;
  }

  if (instance.renderObjectRef !== null) {
    props.ref = instance.renderObjectRef;
  }

  return props;
};

const toDescriptorChild = (
  child: RoyalHostChild,
  pointerEventRegistry: RoyalPointerEventTargetRegistry,
  parentType?: RoyalHostType,
): RoyalRendererJsxElement | string | undefined => {
  if (child.hidden) return undefined;

  if (child.kind === 'text') {
    if (parentType !== 'text' && child.text.trim() === '') return undefined;

    return child.text;
  }

  if (child.type === rendererDescriptorHostType) {
    const descriptor = child.props.descriptor;
    if (isRoyalRendererJsxElement(descriptor)) return descriptor;

    throw new Error('Royal descriptor host expected one renderer descriptor');
  }

  const descriptor = createRendererElement(
    child.type,
    withDescriptorChildren(
      child,
      descriptorChildrenFor(child, pointerEventRegistry),
    ) as Parameters<typeof createRendererElement>[1],
  );
  if (
    isRenderObjectHostType(child.type) &&
    hasRoyalPointerEventHandlers(child.props) &&
    (descriptor.kind === 'mesh' || descriptor.kind === 'gltf')
  ) {
    pointerEventRegistry.hasPointerEventTargets = true;
    pointerEventRegistry.pointerEventTargets.set(descriptor, {
      handlers: royalPointerEventHandlersFrom(child.props),
    });
  }

  return descriptor;
};

const sceneFromContainer = (
  container: RoyalRendererContainer,
): RenderRoot | undefined => {
  const pointerEventRegistry: RoyalPointerEventTargetRegistry = {
    hasPointerEventTargets: false,
    pointerEventTargets: new WeakMap(),
  };
  const sceneChildren = container.children
    .map((child) => toDescriptorChild(child, pointerEventRegistry))
    .filter((child): child is RoyalRendererJsxElement | string => child !== undefined);
  container.hasPointerEventTargets = pointerEventRegistry.hasPointerEventTargets;
  container.pointerEventTargets = pointerEventRegistry.pointerEventTargets;
  if (sceneChildren.length === 0) return undefined;
  if (sceneChildren.length !== 1 || !isRenderRootDescriptor(sceneChildren[0])) {
    throw new Error('Canvas expects exactly one renderer scene child');
  }

  return sceneChildren[0];
};

const commitContainer = (container: RoyalRendererContainer): void => {
  container.latestScene = sceneFromContainer(container);
  container.renderLatest();
};

const createRendererContainer = (): RoyalRendererContainer => {
  const container: RoyalRendererContainer = {
    children: [],
    disabled: false,
    hasPointerEventTargets: false,
    latestScene: undefined,
    pointerEventTargets: new WeakMap(),
    root: null,
    renderLatest: () => {
      if (container.disabled || container.root === null || container.latestScene === undefined) return;

      container.root.render(container.latestScene);
    },
    scheduleRenderLatest: () => {
      if (container.disabled || container.root === null || container.latestScene === undefined) return;

      container.root.invalidate();
    },
  };

  return container;
};

const createHostInstance = (
  type: RoyalHostType,
  props: RoyalHostProps,
  rootContainer: RoyalRendererContainer,
): RoyalHostInstance => {
  const renderObjectInvalidation = isRenderObjectHostType(type)
    ? { suppress: false }
    : null;
  const renderObjectHandle = isRenderObjectHostType(type)
    ? createRenderObjectHandle(resolveRenderObjectTransform(props.transform), () => {
      if (renderObjectInvalidation?.suppress === true) return;

      rootContainer.scheduleRenderLatest();
    })
    : null;
  const renderObjectRef = renderObjectHandle === null
    ? null
    : { current: renderObjectHandle };

  return {
    children: [],
    hidden: false,
    kind: 'host',
    parent: null,
    props,
    renderObjectHandle,
    renderObjectInvalidation,
    renderObjectRef,
    rootContainer,
    type,
  };
};

let currentUpdatePriority = NoEventPriority;

const now = (): number =>
  typeof performance === 'object' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const reportReconcilerError = (error: Error): void => {
  queueMicrotask(() => {
    throw error;
  });
};

const createReconciler = () => ReactReconciler<
  RoyalHostType,
  RoyalHostProps,
  RoyalRendererContainer,
  RoyalHostInstance,
  RoyalTextInstance,
  never,
  never,
  never,
  RoyalPublicInstance,
  RoyalHostContext,
  never,
  ReturnType<typeof setTimeout>,
  -1,
  null
>({
  afterActiveInstanceBlur: () => {},
  appendChild: appendHostChild,
  appendChildToContainer: appendHostChild,
  appendInitialChild: appendHostChild,
  beforeActiveInstanceBlur: () => {},
  cancelTimeout: clearTimeout,
  clearContainer: (container) => {
    for (const child of container.children) {
      child.parent = null;
    }
    container.children = [];
  },
  commitTextUpdate: (textInstance, _oldText, newText) => {
    textInstance.text = newText;
  },
  commitUpdate: (instance, _type, _prevProps, nextProps) => {
    instance.props = nextProps;
    if (instance.renderObjectHandle !== null) {
      const invalidation = instance.renderObjectInvalidation;
      if (invalidation !== null) invalidation.suppress = true;
      try {
        instance.renderObjectHandle.setTransform(resolveRenderObjectTransform(nextProps.transform));
      } finally {
        if (invalidation !== null) invalidation.suppress = false;
      }
    }
  },
  createInstance: (type, props, rootContainer) =>
    createHostInstance(type, props, rootContainer),
  createTextInstance: (text) => ({
    hidden: false,
    kind: 'text',
    parent: null,
    text,
  }),
  detachDeletedInstance: () => {},
  finalizeInitialChildren: () => false,
  getChildHostContext: () => hostContext,
  getCurrentUpdatePriority: () => currentUpdatePriority,
  getInstanceFromNode: () => null,
  getInstanceFromScope: () => null,
  getPublicInstance: (instance) =>
    instance.kind === 'host' && instance.renderObjectHandle !== null
      ? instance.renderObjectHandle
      : instance,
  getRootHostContext: () => hostContext,
  hideInstance: (instance) => {
    instance.hidden = true;
  },
  hideTextInstance: (textInstance) => {
    textInstance.hidden = true;
  },
  HostTransitionContext: createContext(null) as never,
  insertBefore: insertHostChildBefore,
  insertInContainerBefore: insertHostChildBefore,
  isPrimaryRenderer: false,
  maySuspendCommit: () => false,
  noTimeout: -1,
  NotPendingTransition: null,
  prepareForCommit: () => null,
  preparePortalMount: () => {},
  prepareScopeUpdate: () => {},
  preloadInstance: () => true,
  removeChild: removeHostChild,
  removeChildFromContainer: removeHostChild,
  requestPostPaintCallback: (callback) => {
    setTimeout(() => {
      callback(now());
    }, 0);
  },
  resetAfterCommit: commitContainer,
  resetFormInstance: () => {},
  resolveEventTimeStamp: now,
  resolveEventType: () => null,
  resolveUpdatePriority: () =>
    currentUpdatePriority === NoEventPriority
      ? DefaultEventPriority
      : currentUpdatePriority,
  scheduleMicrotask: queueMicrotask,
  scheduleTimeout: setTimeout,
  setCurrentUpdatePriority: (priority) => {
    currentUpdatePriority = priority;
  },
  shouldAttemptEagerTransition: () => false,
  shouldSetTextContent: () => false,
  startSuspendingCommit: () => {},
  supportsHydration: false,
  supportsMicrotasks: true,
  supportsMutation: true,
  supportsPersistence: false,
  suspendInstance: () => {},
  trackSchedulerEvent: () => {},
  unhideInstance: (instance) => {
    instance.hidden = false;
  },
  unhideTextInstance: (textInstance) => {
    textInstance.hidden = false;
  },
  waitForCommitToBeReady: () => null,
});

const reconciler: RoyalReconciler = createReconciler();

export type RoyalRendererTree = {
  dispose(): void;
  hasPointerEventTargets(): boolean;
  pointerEventTarget(node: object): RoyalPointerEventTarget | undefined;
  render(children: ReactNode): void;
  setTarget(root: RoyalRendererRoot | null, disabled: boolean): void;
};

export const createRoyalRendererTree = (): RoyalRendererTree => {
  const container = createRendererContainer();
  const root = reconciler.createContainer(
    container,
    ConcurrentRoot,
    null,
    false,
    null,
    '',
    reportReconcilerError,
    reportReconcilerError,
    reportReconcilerError,
    () => {},
  );

  return {
    dispose: () => {
      reconciler.updateContainerSync(null, root, null, null);
      reconciler.flushSyncWork();
      reconciler.flushPassiveEffects();
      container.root = null;
      container.latestScene = undefined;
      container.hasPointerEventTargets = false;
      container.pointerEventTargets = new WeakMap();
    },
    hasPointerEventTargets: () => container.hasPointerEventTargets,
    pointerEventTarget: (node) => container.pointerEventTargets.get(node),
    render: (children) => {
      reconciler.updateContainerSync(children, root, null, null);
      reconciler.flushSyncWork();
      reconciler.flushPassiveEffects();
    },
    setTarget: (rendererRoot, disabled) => {
      container.root = rendererRoot;
      container.disabled = disabled;
      container.renderLatest();
    },
  };
};
