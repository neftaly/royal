/** Serve built Royal packages and the self-contained stress probe. */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const token = randomBytes(24).toString('hex');
const root = new URL('../../', import.meta.url);
const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Royal VT soak</title>
<style>body{margin:0;background:#222}canvas{width:768px;height:768px;max-width:100vw}pre{color:white}</style>
<script type="importmap">{"imports":{"@royal/renderer-core":"/renderer-core/index.js","@royal/renderer-core/render-object":"/renderer-core/render-object.js","@royal/renderer-webgl":"/renderer-webgl/index.js"}}</script>
<canvas></canvas><pre>Starting</pre><script type="module">
import * as renderer from '@royal/renderer-webgl';import * as core from '@royal/renderer-core';import {runVtSoak} from '/probe.mjs';
const q=new URLSearchParams(location.search);runVtSoak(renderer,core,{cycles:Number(q.get('cycles')??3),dwellMs:Number(q.get('dwell')??6000),budgetMiB:Number(q.get('budget')??16),sharedPool:q.has('shared')});
</script>`;
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    if (url.pathname === '/' && url.searchParams.get('token') === token) {
      res.setHeader('Set-Cookie', `royal_soak=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
    } else if (!(req.headers.cookie ?? '').split(';').some(value => value.trim() === `royal_soak=${token}`)) {
      res.writeHead(403).end(); return;
    }
    let data;
    if (url.pathname === '/') data = html;
    else if (url.pathname === '/probe.mjs') data = await readFile(new URL('./soak-probe.mjs', import.meta.url));
    else {
      const match = /^\/(renderer-core|renderer-webgl)\/([a-zA-Z0-9_.-]+\.js)$/.exec(url.pathname);
      if (!match) { res.writeHead(404).end(); return; }
      data = await readFile(new URL(`packages/${match[1]}/dist/${match[2]}`, root));
    }
    res.writeHead(200, { 'Content-Type': url.pathname === '/' ? 'text/html' : 'text/javascript', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
}).listen(3096, process.env.ROYAL_SOAK_HOST ?? '127.0.0.1', () => {
  console.log(`http://${process.env.ROYAL_SOAK_HOST ?? '127.0.0.1'}:3096/?token=${token}`);
});
