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

const testPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

// 模拟真实 /api/vote 契约：未投票时 items 不带统计字段（count）；
// 提交后接口才返回 count / voted / voters，脚本据此切换到结果视图。
const voteState = { votedIds: new Set() };

// 模拟帖子页回复契约：提交 /api/content/new-comment 后，当前页重抓（GET）应返回新增楼层。
// 验证 B1——回复后新回复必须出现在楼中楼里，而不是因“当前页永不重抓”而丢失。
const replyState = { addedFloors: [] };

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


// 帖子页回复契约（B1）：回复后重抓当前页必须返回新增楼层。
function post789Page() {
  const extras = replyState.addedFloors.map((floor) => `<li id="${floor.floor}" data-comment-id="${floor.commentId}" class="content-item"><div class="nsk-content-meta-info"><a href="/space/9">新回复者</a></div><article class="post-content"><p>${floor.content}</p></article></li>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Fixture post 789</title></head><body><div class="nsk-post"><div class="content-item" id="0"><h1 class="post-title">回复契约测试帖</h1><article class="post-content"><p>用于验证帖子页回复后新楼层出现在楼中楼。</p></article></div></div><div class="comment-container"><div class="nsk-pager post-top-pager"><a class="pager-pos pager-cur" href="/post-789-1">1</a></div><ul class="comments"><li id="1" data-comment-id="801" class="content-item"><div class="nsk-content-meta-info"><a href="/space/1">楼主</a></div><article class="post-content"><p>主楼内容</p></article><div class="comment-menu"><span class="menu-item" title="点赞" data-action="like">♡ <span>0</span></span><span class="menu-item" title="加鸡腿" data-action="chicken">🍗 <span>0</span></span><span class="menu-item" title="反对" data-action="dislike">♧ <span>0</span></span><span class="menu-item" title="收藏" data-action="favorite">☆ <span>0</span></span><span class="menu-item" title="引用" data-action="quote">❝ 引用</span><span class="menu-item" title="回复" data-action="reply">↩ 回复</span></div></li><li id="2" data-comment-id="802" class="content-item"><div class="nsk-content-meta-info"><a href="/space/2">层主</a></div><article class="post-content"><p>@楼主 <a href="/post-789-1#1">#1</a> 已有回复</p></article></li>${extras}</ul><div class="nsk-pager post-bottom-pager"><a class="pager-pos pager-cur" href="/post-789-1">1</a></div></div><script src="/outputs/nodeseek-comment-preview.user.js"></script></body></html>`;
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
      if (pathname === '/api/content/new-comment' && parsed && Number(parsed.postId) === 789) {
        replyState.addedFloors.push({ floor: 3 + replyState.addedFloors.length, commentId: 900 + replyState.addedFloors.length, content: String(parsed.content || '') });
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
  if (pathname === '/favicon.ico') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
    return;
  }
  if (pathname === '/test.png') {
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.end(testPng);
    return;
  }
  if (pathname === '/post-123-1') return sendFile(res, fixturePath('post-123-1'), 'text/html; charset=utf-8');
  if (pathname === '/post-123-2') return sendFile(res, fixturePath('post-123-2'), 'text/html; charset=utf-8');
  if (pathname === '/post-789-1') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(post789Page());
    return;
  }
  if (pathname === '/list') return sendFile(res, fixturePath('list'), 'text/html; charset=utf-8');
  // 长帖分页截断回归：456 帖共 52 页，每页 1 楼；分页器链接到最后一页，
  // 用于验证 MAX_PAGE 截断时状态栏明示“只读取了前 N 页”，而不是静默丢楼层。
  if (/^\/post-456-(\d+)$/.test(pathname)) {
    const page = Number(/^\/post-456-(\d+)$/.exec(pathname)[1]);
    if (page < 1 || page > 52) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const linkAt = (p) => `<a class="pager-pos${p === page ? ' pager-cur' : ''}" href="/post-456-${p}">${p}</a>`;
    const pager = `${linkAt(1)}${linkAt(2)}${linkAt(3)}${linkAt(52)}`;
    const floor = `<li id="${page}" data-comment-id="${page + 600}" class="content-item"><div class="nsk-content-meta-info"><a href="/space/${page}">U${page}</a></div><article class="post-content"><p>第 ${page} 楼</p></article></li>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Fixture 456 page ${page}</title></head><body><div class="nsk-post"><div class="content-item" id="0"><h1 class="post-title">长帖 Fixture</h1><article class="post-content"><p>长帖正文。</p></article></div></div><div class="comment-container"><div class="nsk-pager post-top-pager">${pager}</div><ul class="comments">${floor}</ul><div class="nsk-pager post-bottom-pager">${pager}</div></div><script src="/outputs/nodeseek-comment-preview.user.js"></script></body></html>`);
    return;
  }

  if (pathname === '/outputs/nodeseek-comment-preview.user.js') return sendFile(res, path.join(outputRoot, 'nodeseek-comment-preview.user.js'), 'application/javascript; charset=utf-8');
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => console.log(`XNS_FIXTURE_READY http://127.0.0.1:${port}`));
