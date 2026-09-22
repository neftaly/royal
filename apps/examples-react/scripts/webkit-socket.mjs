/** Message transport for WebKit's target envelopes; framing belongs to Node. */
export const websocketConnect = (url, { timeoutMs = 30_000 } = {}) => {
  const socket = new WebSocket(url);
  const waiters = new Set();
  const events = [];
  const listeners = new Set();
  let failure;
  let resolveOpen;
  let rejectOpen;
  const opened = new Promise((resolve, reject) => { resolveOpen = resolve; rejectOpen = reject; });
  const fail = (error) => {
    if (failure !== undefined) return;
    failure = error instanceof Error ? error : new Error('WebKit socket handler failed', { cause: error });
    clearTimeout(openTimeout);
    rejectOpen(failure);
    for (const waiter of waiters) { clearTimeout(waiter.timeout); waiter.reject(failure); }
    waiters.clear();
    events.length = 0;
    listeners.clear();
  };
  const openTimeout = setTimeout(() => {
    fail(new Error(`Timed out opening WebKit socket after ${timeoutMs}ms`));
    socket.close();
  }, timeoutMs);
  socket.addEventListener('open', () => { clearTimeout(openTimeout); resolveOpen(); });
  socket.addEventListener('close', () => fail(new Error('WebKit socket closed')));
  socket.addEventListener('error', () => fail(new Error('WebKit socket error')));
  socket.addEventListener('message', ({ data }) => {
    if (failure !== undefined) return;
    let message;
    try { message = JSON.parse(data); }
    catch { fail(new Error('WebKit socket returned invalid JSON')); socket.close(); return; }
    try {
      for (const listener of listeners) {
        listener(message);
        if (failure !== undefined) return;
      }
      for (const waiter of waiters) {
        const matches = waiter.match(message);
        if (failure !== undefined) return;
        if (!matches) continue;
        waiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
        return;
      }
      events.push(message);
    } catch (error) {
      fail(error);
      socket.close();
    }
  });
  return {
    opened,
    close: () => { fail(new Error('WebKit socket closed')); socket.close(); },
    onMessage: (listener) => {
      if (failure === undefined) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send: (message) => {
      if (failure !== undefined) throw failure;
      socket.send(JSON.stringify(message));
    },
    waitFor: async (match, waitMs = timeoutMs) => {
      if (failure !== undefined) return Promise.reject(failure);
      const index = events.findIndex(match);
      if (failure !== undefined) throw failure;
      if (index >= 0) return Promise.resolve(events.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve, reject, timeout: undefined };
        waiter.timeout = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`Timed out waiting for WebKit response after ${waitMs}ms`));
        }, waitMs);
        waiters.add(waiter);
      });
    },
  };
};
