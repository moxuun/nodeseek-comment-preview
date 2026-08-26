// nodeseek楼中楼预览 浏览器回归测试。
// 启动本地 fixture 服务器（随机端口），用无头浏览器驱动真实页面，
// 断言脚本的关键行为。全部通过退出码为 0，任一失败为 1。
//
// 用法：
//   npm install
//   npm test
//
// 需要本机 Chromium / Chrome / Edge；找不到浏览器时用 CHROME_PATH 指定可执行文件。

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixtureServer = path.join(repoRoot, 'work', 'xns-fixture-server.mjs');

// ---------- 基础工具 ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const envPath = process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
  if (envPath) {
    if (fs.existsSync(envPath) && fs.statSync(envPath).isFile()) return envPath;
    for (const name of ['chrome', 'chromium', 'msedge']) {
      const candidate = path.join(envPath, name + (process.platform === 'win32' ? '.exe' : ''));
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  const absolute = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/microsoft-edge',
  ];
  for (const candidate of absolute) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const which = process.platform === 'win32' ? 'where' : 'which';
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable', 'brave-browser', 'chrome']) {
    const result = spawnSync(which, [name], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim().split(/\r?\n/)[0];
  }
  return null;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixtureServer, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('fixture 服务器启动超时'));
    }, 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (/XNS_FIXTURE_READY/.test(output)) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`fixture 服务器提前退出（code ${code}）`));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(page, fn, timeout = 12_000, label = '') {
  const started = Date.now();
  for (;;) {
    const value = await page.evaluate(fn);
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`等待超时：${label || fn.toString().slice(0, 80)}`);
    await sleep(100);
  }
}

// ---------- 场景框架 ----------

const scenarios = [];
const scenario = (name, run) => scenarios.push({ name, run });

function createContext(browser, base) {
  return {
    browser,
    base,
    async newPage() {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      const data = { posts: [], pageErrors: [], dialogs: [] };
      page.on('request', (request) => {
        if (request.method() === 'POST') data.posts.push({ url: request.url(), body: request.postData() || '' });
      });
      page.on('pageerror', (error) => data.pageErrors.push(error.message));
      page.on('dialog', async (dialog) => {
        data.dialogs.push(dialog.message());
        await dialog.accept();
      });
      page.__testData = data;
      return page;
    },
  };
}

const dataOf = (page) => page.__testData;

async function waitPost(page, predicate, timeout = 12_000) {
  const started = Date.now();
  for (;;) {
    const found = dataOf(page).posts.find(predicate);
    if (found) return found;
    if (Date.now() - started > timeout) throw new Error('等待 POST 请求超时');
    await sleep(100);
  }
}

async function openPostPage(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-123-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => /条评论/.test(document.querySelector('.xns-toolbar-status')?.textContent || ''), 15_000, '帖子页楼中楼构建');
  return page;
}

async function openPreviewModal(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-123-1"]');
  await waitFor(page, () => {
    const heading = document.querySelector('.xns-modal .xns-preview-comments h3');
    return heading && /9 条回复/.test(heading.textContent || '');
  }, 15_000, '预览弹窗加载');
  return page;
}

// ---------- 场景 ----------

scenario('帖子页楼中楼构建与跨页来源链接', async (ctx) => {
  const page = await openPostPage(ctx);
  const state = await page.evaluate(() => ({
    toolbar: document.querySelector('.xns-toolbar-status')?.textContent,
    items: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
    replyLists: document.querySelectorAll('.comment-container > ul.comments .xns-reply-list').length,
    noteOwners: [...document.querySelectorAll('.comment-container > ul.comments .xns-remote-note')]
      .map((note) => note.closest('.content-item')?.getAttribute('data-xns-floor')).sort(),
  }));
  assert(state.toolbar === '9 条评论', `工具栏应显示 9 条评论，实际 ${state.toolbar}`);
  assert(state.items === 9, `应有 9 个楼层，实际 ${state.items}`);
  assert(state.replyLists === 2, `应有 2 个嵌套回复列表，实际 ${state.replyLists}`);
  assert(JSON.stringify(state.noteOwners) === JSON.stringify(['4', '5']), `跨页来源链接应只在 #4 #5，实际 ${JSON.stringify(state.noteOwners)}`);
  assert(dataOf(page).pageErrors.length === 0, `页面出现未捕获异常：${dataOf(page).pageErrors.join('; ')}`);
});

scenario('原版/楼中楼切换', async (ctx) => {
  const page = await openPostPage(ctx);
  await page.evaluate(() => {
    [...document.querySelectorAll('.xns-post-toolbar [data-mode]')].find((button) => button.dataset.mode === 'original').click();
  });
  const original = await page.evaluate(() => ({
    children: document.querySelector('.comment-container > ul.comments')?.children.length,
    threaded: !!document.querySelector('.comment-container > ul.comments .xns-comment-root'),
  }));
  assert(original.children === 7, `原版应有 7 个原始评论，实际 ${original.children}`);
  assert(!original.threaded, '原版不应保留楼中楼结构');

  await page.evaluate(() => {
    [...document.querySelectorAll('.xns-post-toolbar [data-mode]')].find((button) => button.dataset.mode === 'thread').click();
  });
  const thread = await page.evaluate(() => ({
    roots: document.querySelectorAll('.comment-container > ul.comments > .xns-comment-root').length,
    replyLists: document.querySelectorAll('.comment-container > ul.comments .xns-reply-list').length,
  }));
  assert(thread.roots === 3, `楼中楼应有 3 个根楼层，实际 ${thread.roots}`);
  assert(thread.replyLists === 2, `楼中楼应有 2 个嵌套回复列表，实际 ${thread.replyLists}`);
});

scenario('点击楼层链接跳转并高亮', async (ctx) => {
  const page = await openPostPage(ctx);
  await page.evaluate(() => {
    const alice = [...document.querySelectorAll('.content-item[data-xns-floor]')].find((node) => node.textContent.includes('第一层回复'));
    alice.querySelector('a[href$="#1"]').click();
  });
  const scrolled = await waitFor(page, () => (window.scrollY > 50 ? window.scrollY : null), 5_000, '楼层平滑滚动');
  const highlighted = await page.evaluate(() => document.querySelector('[data-xns-floor="1"]')?.classList.contains('xns-floor-highlight'));
  assert(scrolled > 0, `点击楼层链接应滚动页面，实际 scrollY=${scrolled}`);
  assert(highlighted, '目标楼层应被高亮');
});

scenario('帖子页回复后重排保留全部楼层（0.5.8 回归）', async (ctx) => {
  const page = await openPostPage(ctx);
  await page.evaluate(() => {
    const bob = [...document.querySelectorAll('.comment-container .content-item[data-xns-floor]')].find((node) => node.textContent.includes('普通评论'));
    [...bob.querySelector(':scope > .comment-menu').children].find((item) => item.dataset.xnsAction === 'reply').click();
    const composer = bob.querySelector(':scope > .xns-preview-composer');
    composer.querySelector('textarea').value = '回归测试回复';
    composer.querySelector('button').click();
  });
  await waitPost(page, (post) => post.url.endsWith('/api/content/new-comment'));
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '9 条评论', 15_000, '回复后重排');
  const state = await page.evaluate(() => ({
    items: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
    roots: document.querySelectorAll('.comment-container > ul.comments > .xns-comment-root').length,
    replyLists: document.querySelectorAll('.comment-container > ul.comments .xns-reply-list').length,
  }));
  assert(state.items === 9, `回复重排后应保留 9 个楼层，实际 ${state.items}`);
  assert(state.roots === 3 && state.replyLists === 2, `嵌套结构应保留（3 根/2 嵌套），实际 ${state.roots}/${state.replyLists}`);
});

scenario('帖子页点赞走 NodeSeek 接口', async (ctx) => {
  const page = await openPostPage(ctx);
  await page.evaluate(() => {
    const root = document.querySelector('.comment-container > ul.comments > .xns-comment-root');
    [...root.querySelector(':scope > .comment-menu').children].find((item) => item.dataset.xnsAction === 'like').click();
  });
  const likePost = await waitPost(page, (post) => post.url.endsWith('/aics/upvote'));
  assert(JSON.parse(likePost.body).commentId === 101, '点赞应携带 commentId 101');
  const state = await waitFor(page, () => {
    const text = document.querySelector('.comment-container > ul.comments > .xns-comment-root > .comment-menu .xns-action-state')?.textContent;
    return text === '✓' ? text : null;
  }, 5_000, '点赞状态');
  assert(state === '✓', `点赞成功应显示 ✓，实际 ${state}`);
});

scenario('列表页预览弹窗结构与操作菜单', async (ctx) => {
  const page = await openPreviewModal(ctx);
  const state = await page.evaluate(() => {
    const modal = document.querySelector('.xns-modal');
    const post = modal.querySelector('.xns-preview-post');
    const postActions = [...post.querySelector(':scope > .comment-menu').children].map((item) => item.dataset.xnsAction);
    const root = modal.querySelector('.xns-preview-thread .xns-comment-root');
    const floorActions = [...root.querySelector(':scope > .comment-menu').children].map((item) => item.dataset.xnsAction);
    return {
      title: modal.querySelector('.xns-modal-title')?.textContent,
      postActions,
      floorActions,
      items: modal.querySelectorAll('.xns-preview-thread .content-item[data-xns-floor]').length,
    };
  });
  assert(state.title === 'Fixture NodeSeek 帖子', `弹窗标题应为帖子标题，实际 ${state.title}`);
  assert(JSON.stringify(state.postActions) === JSON.stringify(['like', 'chicken', 'dislike', 'favorite', 'quote', 'reply']), `主帖应有 6 项操作，实际 ${JSON.stringify(state.postActions)}`);
  assert(JSON.stringify(state.floorActions) === JSON.stringify(['like', 'chicken', 'dislike', 'quote', 'reply']), `回复楼层不应有收藏，实际 ${JSON.stringify(state.floorActions)}`);
  assert(state.items === 9, `弹窗应有 9 条回复，实际 ${state.items}`);
});

scenario('弹窗跨页来源链接只出现在跨页评论（0.5.8 回归）', async (ctx) => {
  const page = await openPreviewModal(ctx);
  const state = await page.evaluate(() => {
    const notes = [...document.querySelectorAll('.xns-preview-thread .xns-remote-note')];
    return {
      count: notes.length,
      owners: notes.map((note) => note.closest('.content-item')?.getAttribute('data-xns-floor')).sort(),
    };
  });
  assert(state.count === 2, `弹窗跨页来源链接应为 2 个，实际 ${state.count}`);
  assert(JSON.stringify(state.owners) === JSON.stringify(['4', '5']), `应只出现在 #4 #5，实际 ${JSON.stringify(state.owners)}`);
});

scenario('弹窗点赞与收藏', async (ctx) => {
  const page = await openPreviewModal(ctx);
  await page.evaluate(() => {
    const root = document.querySelector('.xns-preview-thread .xns-comment-root');
    [...root.querySelector(':scope > .comment-menu').children].find((item) => item.dataset.xnsAction === 'like').click();
  });
  await waitPost(page, (post) => post.url.endsWith('/aics/upvote'));
  await page.evaluate(() => {
    const menu = document.querySelector('.xns-preview-post > .comment-menu');
    [...menu.children].find((item) => item.dataset.xnsAction === 'favorite').click();
  });
  const collection = await waitPost(page, (post) => post.url.endsWith('/api/statistics/collection'));
  assert(JSON.parse(collection.body).postId === 123, '收藏应携带 postId 123');
  const favorite = await waitFor(page, () => {
    const item = [...document.querySelectorAll('.xns-preview-post > .comment-menu .menu-item')].find((node) => node.dataset.xnsAction === 'favorite');
    if (item?.dataset.xnsFavoriteState !== 'added') return null;
    return { state: item.dataset.xnsFavoriteState, count: item.querySelector('.xns-action-count')?.textContent };
  }, 5_000, '收藏状态');
  assert(favorite.state === 'added' && favorite.count === '1', `收藏后应 added/1，实际 ${JSON.stringify(favorite)}`);
});

scenario('楼层回复编辑器与帖子级回复编辑器', async (ctx) => {
  const page = await openPreviewModal(ctx);
  const state = await page.evaluate(() => {
    const bob = [...document.querySelectorAll('.xns-preview-thread .xns-comment-root')][1];
    [...bob.querySelector(':scope > .comment-menu').children].find((item) => item.dataset.xnsAction === 'reply').click();
    const floorComposer = bob.querySelector(':scope > .xns-preview-composer');
    const floorInfo = floorComposer ? {
      title: floorComposer.querySelector('.xns-preview-composer-title')?.textContent,
      hasToken: /@Bob \[#3\]/.test(floorComposer.querySelector('textarea')?.value || ''),
      sourceUrl: floorComposer.querySelector('a')?.getAttribute('href'),
    } : null;
    document.querySelector('.xns-modal-reply').click();
    const postComposer = document.querySelector('.xns-modal-body > .xns-preview-composer');
    return {
      floorInfo,
      postTitle: postComposer?.querySelector('.xns-preview-composer-title')?.textContent,
      totalComposers: document.querySelectorAll('.xns-preview-composer').length,
    };
  });
  assert(state.floorInfo?.title === '回复 #3 · Bob', `楼层编辑器标题应为“回复 #3 · Bob”，实际 ${state.floorInfo?.title}`);
  assert(state.floorInfo?.hasToken, '楼层回复应携带 @Bob [#3] 令牌');
  assert(state.floorInfo?.sourceUrl === `${ctx.base}/post-123-1#3`, `楼层来源链接应为 /post-123-1#3，实际 ${state.floorInfo?.sourceUrl}`);
  assert(state.postTitle === '回复帖子', '帖子级编辑器标题应为“回复帖子”');
  assert(state.totalComposers === 2, `应同时存在楼层与帖子级编辑器，实际 ${state.totalComposers}`);
});

scenario('预览刷新保留滚动位置', async (ctx) => {
  const page = await openPreviewModal(ctx);
  await page.evaluate(() => { document.querySelector('.xns-modal-body').scrollTop = 300; });
  await page.click('.xns-refresh-post');
  await waitFor(page, () => !document.querySelector('.xns-refresh-post')?.classList.contains('xns-action-pending'), 15_000, '刷新完成');
  const state = await page.evaluate(() => ({
    scrollTop: document.querySelector('.xns-modal-body').scrollTop,
    heading: document.querySelector('.xns-preview-comments h3')?.textContent,
  }));
  assert(state.scrollTop >= 250, `刷新后滚动位置应保留，实际 ${state.scrollTop}`);
  assert(/9 条回复/.test(state.heading), '刷新后仍应显示 9 条回复');
});

scenario('弹窗发送回复后重排', async (ctx) => {
  const page = await openPreviewModal(ctx);
  await page.evaluate(() => {
    document.querySelector('.xns-modal-reply').click();
    const composer = document.querySelector('.xns-modal-body > .xns-preview-composer');
    composer.querySelector('textarea').value = '弹窗回归回复';
    composer.querySelector('button').click();
  });
  await waitPost(page, (post) => post.url.endsWith('/api/content/new-comment'));
  await waitFor(page, () => {
    const heading = document.querySelector('.xns-preview-comments h3');
    const pending = document.querySelector('.xns-refresh-post')?.classList.contains('xns-action-pending');
    return heading && /9 条回复/.test(heading.textContent || '') && !pending;
  }, 15_000, '弹窗回复后重排完成');
  const state = await page.evaluate(() => ({
    items: document.querySelectorAll('.xns-preview-thread .content-item[data-xns-floor]').length,
    notes: document.querySelectorAll('.xns-preview-thread .xns-remote-note').length,
  }));
  assert(state.items === 9, `回复后应保持 9 条回复，实际 ${state.items}`);
  assert(state.notes === 2, `回复后跨页来源链接应保持 2 个，实际 ${state.notes}`);
});

scenario('内容特性：标签页/ANSI/复制按钮', async (ctx) => {
  const page = await openPreviewModal(ctx);
  const state = await page.evaluate(() => {
    const tabs = document.querySelector('.xns-preview-post .nsk-magic-tabs');
    const titles = [...tabs.querySelectorAll('.nsk-magic-tab-title')].map((title) => title.textContent.trim());
    const active = tabs.querySelector('.nsk-magic-tab-title.xns-active')?.textContent?.trim();
    tabs.querySelectorAll('.nsk-magic-tab-title')[1].click();
    const after = {
      activeTitle: tabs.querySelector('.nsk-magic-tab-title.xns-active')?.textContent?.trim(),
      activeBody: tabs.querySelector('.nsk-magic-tab-body.xns-active')?.textContent?.trim(),
    };
    return {
      titles,
      active,
      after,
      ansiBold: !!document.querySelector('.xns-preview-post .xns-ansi-bold'),
      ansiGreen: !!document.querySelector('.xns-preview-post .xns-ansi-fg-green'),
      copyButtons: document.querySelectorAll('.xns-code-copy-btn').length,
    };
  });
  assert(JSON.stringify(state.titles) === JSON.stringify(['💻基本信息', '🎬IP质量', '🌐网络质量', '📍回程路由']), `应有 4 个标签页，实际 ${JSON.stringify(state.titles)}`);
  assert(state.active === '💻基本信息', '默认应激活第一个标签页');
  assert(state.after.activeTitle === '🎬IP质量' && state.after.activeBody === 'IP 质量内容', '点击第二个标签页应切换内容');
  assert(state.ansiBold && state.ansiGreen, 'ANSI 粗体与绿色应被渲染');
  assert(state.copyButtons === 3, `应有 3 个代码复制按钮，实际 ${state.copyButtons}`);
});

// ---------- 主流程 ----------

const chromePath = findChrome();
if (!chromePath) {
  console.error('未找到 Chromium/Chrome/Edge。请安装浏览器或设置 CHROME_PATH 指向浏览器可执行文件。');
  process.exit(1);
}
console.log(`浏览器：${chromePath}`);

const port = await findFreePort();
const base = `http://127.0.0.1:${port}`;
const server = await startServer(port);
console.log(`fixture 服务器：${base}`);

let browser;
const reports = [];
try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = createContext(browser, base);
  for (const { name, run } of scenarios) {
    const started = Date.now();
    try {
      await run(ctx);
      reports.push({ name, pass: true, ms: Date.now() - started });
    } catch (error) {
      reports.push({ name, pass: false, ms: Date.now() - started, error: error.message });
    }
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}

console.log('\n== 回归测试结果 ==');
let failed = 0;
for (const report of reports) {
  if (report.pass) {
    console.log(`✓ ${report.name} (${report.ms}ms)`);
  } else {
    failed += 1;
    console.log(`✗ ${report.name}: ${report.error} (${report.ms}ms)`);
  }
}
console.log(`\n${reports.length - failed}/${reports.length} 通过${failed ? `，${failed} 失败` : ''}`);
process.exit(failed ? 1 : 0);
