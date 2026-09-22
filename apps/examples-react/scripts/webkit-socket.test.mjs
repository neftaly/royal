import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';
import { websocketConnect } from './webkit-socket.mjs';

const withServer = async (run) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const connected = once(server, 'connection');
  const client = websocketConnect(`ws://127.0.0.1:${server.address().port}`, { timeoutMs: 1000 });
  try {
    await client.opened;
    const [peer] = await connected;
    await run(client, peer);
  } finally {
    client.close();
    for (const peer of server.clients) peer.terminate();
    await new Promise(resolve => server.close(resolve));
  }
};

describe('native WebKit socket transport', () => {
  it('reassembles fragmented JSON, handles ping and sends large messages', async () => {
    await withServer(async (client, peer) => {
      const pong = once(peer, 'pong');
      peer.ping('probe');
      const reply = client.waitFor(message => message.id === 7);
      peer.send('{"id":', { fin: false });
      peer.send('7,"result":true}', { fin: true });
      await expect(reply).resolves.toEqual({ id: 7, result: true });
      await pong;
      const received = once(peer, 'message');
      const message = { payload: 'x'.repeat(100_000) };
      client.send(message);
      expect(JSON.parse((await received)[0].toString())).toEqual(message);
    });
  });
  it('rejects pending and future waits on disconnect', async () => {
    await withServer(async (client, peer) => {
      const pending = expect(client.waitFor(() => true)).rejects.toThrow('closed');
      peer.close();
      await pending;
      await expect(client.waitFor(() => true)).rejects.toThrow('closed');
      expect(() => client.send({})).toThrow('closed');
    });
  });
  it('routes unmatched messages and rejects malformed JSON', async () => {
    await withServer(async (client, peer) => {
      const seen = [];
      const observed = new Promise(resolve => client.onMessage(message => { seen.push(message); resolve(); }));
      peer.send('{"event":true}');
      await observed;
      await expect(client.waitFor(message => message.event)).resolves.toEqual({ event: true });
      expect(seen).toHaveLength(1);
      const rejected = expect(client.waitFor(() => true)).rejects.toThrow('invalid JSON');
      peer.send('broken');
      await rejected;
    });
  });
});

it('removes timed-out waits without closing the connection or consuming later replies', async () => {
  await withServer(async (client, peer) => {
    await expect(client.waitFor(message => message.id === 1, 10)).rejects.toThrow('Timed out waiting');
    const reply = client.waitFor(message => message.id === 1);
    peer.send('{"id":1}');
    await expect(reply).resolves.toEqual({ id: 1 });
  });
});

it('rejects waits when a message listener fails instead of throwing outside the request', async () => {
  await withServer(async (client, peer) => {
    client.onMessage(() => { throw new Error('invalid nested envelope'); });
    const reply = expect(client.waitFor(() => true)).rejects.toThrow('invalid nested envelope');
    peer.send('{"id":1}');
    await reply;
    await expect(client.waitFor(() => true)).rejects.toThrow('invalid nested envelope');
  });
});

it('rejects throwing predicates for both arriving and buffered messages', async () => {
  await withServer(async (client, peer) => {
    const observed = new Promise(resolve => client.onMessage(resolve));
    peer.send('{"id":1}');
    await observed;
    await expect(client.waitFor(() => { throw new Error('buffered predicate'); })).rejects.toThrow('buffered predicate');
    const reply = expect(client.waitFor(message => {
      if (message.id === 2) throw new Error('live predicate');
      return false;
    })).rejects.toThrow('live predicate');
    peer.send('{"id":2}');
    await reply;
  });
});


it('bounds stalled opening handshakes and rejects subsequent operations', async () => {
  const server = createServer();
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = websocketConnect(`ws://127.0.0.1:${server.address().port}`, { timeoutMs: 100 });
  try {
    await expect(client.opened).rejects.toThrow('Timed out opening');
    await expect(client.waitFor(() => true)).rejects.toThrow('Timed out opening');
    expect(() => client.send({})).toThrow('Timed out opening');
  } finally {
    client.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
});

it('preserves terminal failure when a listener throws a non-Error value', async () => {
  await withServer(async (client, peer) => {
    client.onMessage(() => { throw undefined; });
    const pending = expect(client.waitFor(() => true)).rejects.toThrow('WebKit socket handler failed');
    peer.send('{"id":1}');
    await pending;
    await expect(client.waitFor(() => true)).rejects.toThrow('WebKit socket handler failed');
    expect(() => client.send({})).toThrow('WebKit socket handler failed');
  });
});

it('rejects immediately when a buffered predicate closes the client', async () => {
  await withServer(async (client, peer) => {
    const observed = new Promise(resolve => client.onMessage(resolve));
    peer.send('{"id":1}');
    await observed;
    await expect(client.waitFor(() => { client.close(); return false; }, 20)).rejects.toThrow('WebKit socket closed');
  });
});
