/** Installs a browser-only semantic oracle around each real WebGL2 context. */
export const vaoOwnershipProbeSource = `
(() => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const patchedContexts = new WeakSet();
  const contexts = [];
  HTMLCanvasElement.prototype.getContext = function(kind, ...options) {
    const context = originalGetContext.call(this, kind, ...options);
    if (kind !== 'webgl2' || context === null || patchedContexts.has(context)) return context;
    patchedContexts.add(context);

    let currentVertexArray = null;
    let elementArrayBuffers = new Map([[null, null]]);
    let submittedVertexArrays = new Set();
    let vertexArrayExplicitlyBound = false;
    let indexedDraws = 0;
    let maximumInstanceCount = 0;
    const violations = [];
    const operations = [];
    const recordOperation = (operation) => {
      operations.push(operation);
      if (operations.length > 40) operations.shift();
    };
    const vertexArrayIds = new WeakMap();
    const bufferIds = new WeakMap();
    const bufferTargets = new WeakMap();
    let nextVertexArrayId = 1;
    let nextBufferId = 1;
    const vertexArrayId = (value) => {
      if (value === null) return 'default';
      let id = vertexArrayIds.get(value);
      if (id === undefined) {
        id = nextVertexArrayId++;
        vertexArrayIds.set(value, id);
      }
      return id;
    };
    const bufferId = (value) => {
      if (value === null) return null;
      let id = bufferIds.get(value);
      if (id === undefined) {
        id = nextBufferId++;
        bufferIds.set(value, id);
      }
      return id;
    };

    const bindVertexArray = context.bindVertexArray.bind(context);
    context.bindVertexArray = (vertexArray) => {
      const result = bindVertexArray(vertexArray);
      currentVertexArray = vertexArray;
      vertexArrayExplicitlyBound = true;
      if (!elementArrayBuffers.has(vertexArray)) elementArrayBuffers.set(vertexArray, null);
      recordOperation({ kind: 'bind-vertex-array', vertexArray: vertexArrayId(vertexArray) });
      return result;
    };
    const bindBuffer = context.bindBuffer.bind(context);
    context.bindBuffer = (target, buffer) => {
      if (
        buffer !== null
        && (target === context.ARRAY_BUFFER || target === context.ELEMENT_ARRAY_BUFFER)
      ) {
        const previousTarget = bufferTargets.get(buffer);
        if (previousTarget !== undefined && previousTarget !== target) {
          violations.push({
            afterTarget: target,
            beforeTarget: previousTarget,
            buffer: bufferId(buffer),
            kind: 'buffer-target-mutation',
          });
        }
        bufferTargets.set(buffer, target);
      }
      const result = bindBuffer(target, buffer);
      if (target !== context.ELEMENT_ARRAY_BUFFER) return result;
      const before = elementArrayBuffers.get(currentVertexArray) ?? null;
      if (
        submittedVertexArrays.has(currentVertexArray)
        && !vertexArrayExplicitlyBound
        && before !== buffer
      ) {
        violations.push({
          afterBuffer: bufferId(buffer),
          beforeBuffer: bufferId(before),
          kind: 'implicit-element-array-mutation',
          vertexArray: vertexArrayId(currentVertexArray),
        });
      }
      elementArrayBuffers.set(currentVertexArray, buffer);
      recordOperation({
        buffer: bufferId(buffer),
        kind: 'bind-element-array-buffer',
        vertexArray: vertexArrayId(currentVertexArray),
      });
      return result;
    };
    const deleteBuffer = context.deleteBuffer.bind(context);
    context.deleteBuffer = (buffer) => {
      const result = deleteBuffer(buffer);
      for (const [vertexArray, elementArrayBuffer] of elementArrayBuffers) {
        if (elementArrayBuffer !== buffer) continue;
        elementArrayBuffers.set(vertexArray, null);
      }
      recordOperation({ buffer: bufferId(buffer), kind: 'delete-buffer' });
      return result;
    };
    const recordSubmission = () => {
      submittedVertexArrays.add(currentVertexArray);
      vertexArrayExplicitlyBound = false;
    };
    const recordIndexedDraw = (instanceCount, drawCount = 1) => {
      const elementArrayBuffer = elementArrayBuffers.get(currentVertexArray) ?? null;
      const actualElementArrayBuffer = context.getParameter(
        context.ELEMENT_ARRAY_BUFFER_BINDING,
      );
      if (
        currentVertexArray === null
        || elementArrayBuffer === null
        || actualElementArrayBuffer !== elementArrayBuffer
      ) {
        violations.push({
          actualElementArrayBuffer: bufferId(actualElementArrayBuffer),
          elementArrayBuffer: bufferId(elementArrayBuffer),
          kind: 'indexed-draw-without-owned-index-buffer',
          vertexArray: vertexArrayId(currentVertexArray),
        });
      }
      indexedDraws += drawCount;
      maximumInstanceCount = Math.max(maximumInstanceCount, instanceCount);
      recordOperation({
        elementArrayBuffer: bufferId(elementArrayBuffer),
        instanceCount,
        kind: 'indexed-draw',
        vertexArray: vertexArrayId(currentVertexArray),
      });
      recordSubmission();
    };
    const drawArrays = context.drawArrays.bind(context);
    context.drawArrays = (...arguments_) => {
      recordSubmission();
      return drawArrays(...arguments_);
    };
    const drawArraysInstanced = context.drawArraysInstanced.bind(context);
    context.drawArraysInstanced = (...arguments_) => {
      recordSubmission();
      return drawArraysInstanced(...arguments_);
    };
    const drawElements = context.drawElements.bind(context);
    context.drawElements = (...arguments_) => {
      recordIndexedDraw(1);
      return drawElements(...arguments_);
    };
    const drawElementsInstanced = context.drawElementsInstanced.bind(context);
    context.drawElementsInstanced = (...arguments_) => {
      recordIndexedDraw(arguments_[4]);
      return drawElementsInstanced(...arguments_);
    };
    const drawRangeElements = context.drawRangeElements.bind(context);
    context.drawRangeElements = (...arguments_) => {
      recordIndexedDraw(1);
      return drawRangeElements(...arguments_);
    };
    const getExtension = context.getExtension.bind(context);
    const patchedMultiDrawExtensions = new WeakSet();
    context.getExtension = (name) => {
      const extension = getExtension(name);
      if (
        name !== 'WEBGL_multi_draw'
        || extension === null
        || patchedMultiDrawExtensions.has(extension)
      ) return extension;
      patchedMultiDrawExtensions.add(extension);
      const multiDrawElements = extension.multiDrawElementsWEBGL.bind(extension);
      try {
        extension.multiDrawElementsWEBGL = (...arguments_) => {
          const drawCount = Math.max(0, Number(arguments_[6]) || 0);
          if (drawCount > 0) recordIndexedDraw(1, drawCount);
          return multiDrawElements(...arguments_);
        };
      } catch (error) {
        violations.push({
          kind: 'multi-draw-oracle-installation-failed',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      return extension;
    };
    const deleteVertexArray = context.deleteVertexArray.bind(context);
    context.deleteVertexArray = (vertexArray) => {
      const result = deleteVertexArray(vertexArray);
      elementArrayBuffers.delete(vertexArray);
      submittedVertexArrays.delete(vertexArray);
      if (currentVertexArray === vertexArray) {
        currentVertexArray = null;
        vertexArrayExplicitlyBound = false;
      }
      recordOperation({ kind: 'delete-vertex-array', vertexArray: vertexArrayId(vertexArray) });
      return result;
    };
    const reset = () => {
      currentVertexArray = null;
      elementArrayBuffers = new Map([[null, null]]);
      submittedVertexArrays = new Set();
      vertexArrayExplicitlyBound = false;
    };
    this.addEventListener('webglcontextlost', reset);
    this.addEventListener('webglcontextrestored', reset);
    contexts.push({
      snapshot: () => ({
        indexedDraws,
        maximumInstanceCount,
        operations: [...operations],
        violations: [...violations],
      }),
    });
    return context;
  };
  globalThis.__royalVaoOwnershipSnapshot = () => contexts.reduce((combined, context) => {
    const snapshot = context.snapshot();
    combined.indexedDraws += snapshot.indexedDraws;
    combined.maximumInstanceCount = Math.max(
      combined.maximumInstanceCount,
      snapshot.maximumInstanceCount,
    );
    combined.operations.push(...snapshot.operations);
    if (combined.operations.length > 40) {
      combined.operations.splice(0, combined.operations.length - 40);
    }
    combined.violations.push(...snapshot.violations);
    return combined;
  }, {
    contexts: contexts.length,
    indexedDraws: 0,
    maximumInstanceCount: 0,
    operations: [],
    violations: [],
  });
})();
`;
