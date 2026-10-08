#!/usr/bin/env node
/**
 * Serves the web build on this computer and relays WebDAV requests for it.
 *
 *   npm run web:build      # once, or after pulling changes
 *   npm run web:serve      # then open http://localhost:8787
 *
 * Why the relay: browsers refuse cross-origin requests unless the server allows them
 * (CORS), and most WebDAV servers don't. The page sends its WebDAV requests to
 * /__dav on this same origin instead, and this script forwards them.
 *
 * Safety: it listens on 127.0.0.1 only, and every relay request must carry the
 * X-BWYA-Relay header. Other websites can't add that header without a CORS
 * preflight, which this server never approves, so they can't use it as a proxy.
 * Set DAV_ALLOW=cloud.example.com to restrict which host it may forward to.
 *
 * Options (environment): PORT (8787), HOST (127.0.0.1), DIST (./dist), DAV_ALLOW.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const DIST = resolve(process.env.DIST ?? join(process.cwd(), 'dist'));
const ALLOW = (process.env.DAV_ALLOW ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json',
};
const FORWARD = ['authorization', 'content-type', 'if-match', 'if-none-match', 'depth'];
const MAX_BODY = 20 * 1024 * 1024;

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function serveStatic(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
  // Single-page app: unknown paths get index.html, so /becoming works on reload.
  const target = isFile(file) ? file : join(DIST, 'index.html');
  if (!isFile(target)) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`No web build in ${DIST}. Run: npm run web:build\n`);
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(res);
}

async function relay(req, res) {
  if (req.headers['x-bwya-relay'] !== '1') { res.writeHead(403).end(); return; }
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__dav/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }

  let target;
  try { target = new URL(url.searchParams.get('url') ?? ''); } catch { res.writeHead(400).end('bad url'); return; }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') { res.writeHead(400).end('bad url'); return; }
  if (ALLOW.length && !ALLOW.includes(target.hostname.toLowerCase())) { res.writeHead(403).end('host not allowed'); return; }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) { res.writeHead(413).end(); return; }
    chunks.push(chunk);
  }
  const headers = {};
  for (const h of FORWARD) if (req.headers[h]) headers[h] = req.headers[h];
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      redirect: 'manual',
    });
    const out = { 'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store' };
    const etag = upstream.headers.get('etag');
    if (etag) out.ETag = etag;
    res.writeHead(upstream.status, out).end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'text/plain' }).end(`Couldn't reach ${target.host}: ${e.message}`);
  }
}

createServer((req, res) => {
  if (req.url.startsWith('/__dav')) { relay(req, res); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  serveStatic(req, res);
}).listen(PORT, HOST, () => {
  console.log(`Become Who You Are: http://${HOST === '127.0.0.1' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Serving ${DIST}${ALLOW.length ? `; WebDAV relay limited to ${ALLOW.join(', ')}` : ''}`);
});
