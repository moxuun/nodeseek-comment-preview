import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, 'xns-fixture');
const outputRoot = path.join(here, '..', 'outputs');
const port = Number(process.argv[2] || 8765);

const fixturePath = (name) => path.join(root, name);
const sendFile = (res, filePath, contentType) => {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(content);
  });
};

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (req.method === 'POST' && ['/aics/upvote', '/api/statistics/upvote', '/api/statistics/like', '/api/statistics/dislike', '/api/statistics/collection', '/api/content/new-comment'].includes(pathname)) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: true, received: body ? JSON.parse(body) : null }));
    });
    return;
  }
  if (pathname === '/post-123-1') return sendFile(res, fixturePath('post-123-1'), 'text/html; charset=utf-8');
  if (pathname === '/post-123-2') return sendFile(res, fixturePath('post-123-2'), 'text/html; charset=utf-8');
  if (pathname === '/list') return sendFile(res, fixturePath('list'), 'text/html; charset=utf-8');
  if (pathname === '/outputs/nodeseek-comment-preview.user.js') return sendFile(res, path.join(outputRoot, 'nodeseek-comment-preview.user.js'), 'application/javascript; charset=utf-8');
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => console.log(`XNS_FIXTURE_READY http://127.0.0.1:${port}`));
