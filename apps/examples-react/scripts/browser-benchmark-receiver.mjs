#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const port = Number.parseInt(process.env.BROWSER_BENCH_PORT ?? '4683', 10);
const outputDir = path.resolve(
  repoRoot,
  process.env.BROWSER_BENCH_OUTPUT_DIR ?? 'research/examples-benchmarks/browser-manual',
);

const safeSegment = (value) =>
  String(value ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80) || 'unknown';

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('error', reject);
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });

const send = (response, status, body, contentType = 'text/plain; charset=utf-8') => {
  response.writeHead(status, {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, OPTIONS, POST',
    'access-control-allow-origin': '*',
    'content-type': contentType,
  });
  response.end(body);
};

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      send(response, 204, '');
      return;
    }

    if (request.method === 'GET') {
      send(response, 200, `Royal browser benchmark receiver\nPOST JSON here; writing to ${outputDir}\n`);
      return;
    }

    if (request.method !== 'POST') {
      send(response, 405, 'method not allowed\n');
      return;
    }

    const raw = await readBody(request);
    const report = JSON.parse(raw);
    const generatedAt = typeof report.generatedAt === 'string' ? report.generatedAt : new Date().toISOString();
    const exampleId = safeSegment(report.example?.id);
    const filename = `${generatedAt.replace(/[:.]/gu, '-')}-${exampleId}.json`;
    await mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, filename);
    await writeFile(filePath, `${JSON.stringify({ receivedAt: new Date().toISOString(), report }, null, 2)}\n`);
    send(response, 200, `${JSON.stringify({ path: filePath })}\n`, 'application/json; charset=utf-8');
    console.log(`wrote ${filePath}`);
  } catch (error) {
    send(response, 400, `${error instanceof Error ? error.message : String(error)}\n`);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Royal browser benchmark receiver listening on http://0.0.0.0:${port}/`);
  console.log(`Writing reports to ${outputDir}`);
});
