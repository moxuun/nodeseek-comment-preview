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

// 模拟真实 /api/vote 契约：未投票时 items 不带统计字段（count）；
// 提交后接口才返回 count / voted / voters，脚本据此切换到结果视图。
const voteState = { votedIds: new Set() };

function votePayload() {
  const items = [
    { vote_item_id: 13788, text: '选项 A' },
    { vote_item_id: 13789, text: '选项 B' },
  ];
  if (voteState.votedIds.size > 0) {
    items.forEach((item) => {
      item.count = voteState.votedIds.has(item.vote_item_id) ? 2 : 1;
      item.voted = voteState.votedIds.has(item.vote_item_id);
      item.voters = [41560];
    });
  }
  return {
    success: true,
    vote: { id: 123, title: '测试投票', multiple: false, isPublic: true, locked: false, items },
  };
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (req.method === 'POST' && ['/aics/upvote', '/api/statistics/upvote', '/api/statistics/like', '/api/statistics/dislike', '/api/statistics/collection', '/api/content/new-comment', '/api/vote/voteforitem'].includes(pathname)) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : null;
      if (pathname === '/api/vote/voteforitem' && parsed && Array.isArray(parsed.ids)) {
        parsed.ids.forEach((id) => voteState.votedIds.add(Number(id)));
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ success: true, received: parsed }));
    });
    return;
  }
  if (pathname === '/api/vote/info/123') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(votePayload()));
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
