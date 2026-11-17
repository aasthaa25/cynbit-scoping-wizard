// Zero-dependency local dev server: serves the static site and routes
// /api/inquiry to the same handler Vercel runs in production.
// Usage: node server.js   (then open http://localhost:3000)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as inquiry from './api/inquiry.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT) || 3000;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/inquiry') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const handler = inquiry[req.method] || (() => new Response(null, { status: 405 }));
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  const rel = normalize(decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)).replace(/^([/\\])+/, '');
  if (rel.startsWith('..') || /(^|[/\\])(api|test|node_modules)([/\\]|$)|server\.js$/.test(rel)) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'Content-Type': `${types[extname(rel)] || 'application/octet-stream'}; charset=utf-8` });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Scoping wizard running at http://localhost:${port}`));
