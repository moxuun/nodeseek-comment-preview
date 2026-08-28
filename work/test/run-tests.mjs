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
      const data = { posts: [], voteInfoGets: [], pageErrors: [], dialogs: [] };
      page.on('request', (request) => {
        const headers = request.headers();
        const record = { url: request.url(), body: request.postData() || '', headers };
        if ('x-dynamic-sign' in headers) record.signature = headers['x-dynamic-sign'];
        if (request.method() === 'POST') data.posts.push(record);
        else if (request.url().includes('/api/vote/info')) data.voteInfoGets.push(record);
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

scenario('长帖分页截断明示（0.5.13 回归）', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-456-1`, { waitUntil: 'networkidle0' });
  // 456 帖共 52 页、每页 1 楼：MAX_PAGE 之上应截断并在状态栏明示，而不是静默丢楼层。
  await waitFor(page, () => {
    const status = document.querySelector('.xns-status')?.textContent || '';
    return /只读取了前/.test(status);
  }, 30_000, '截断状态提示');
  const state = await page.evaluate(() => ({
    toolbar: document.querySelector('.xns-toolbar-status')?.textContent,
    status: document.querySelector('.xns-status')?.textContent || '',
    items: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
  }));
  assert(/帖子共 52 页，只读取了前 50 页/.test(state.status), `状态栏应明示截断，实际 ${state.status}`);
  assert(state.items === 50, `截断后应只有前 50 楼，实际 ${state.items}`);
  assert(dataOf(page).pageErrors.length === 0, `页面出现未捕获异常：${dataOf(page).pageErrors.join('; ')}`);
  await page.close();
});
scenario('帖子页楼中楼构建与跨页来源链接', async (ctx) => {
  const page = await openPostPage(ctx);
  const state = await page.evaluate(() => ({
    toolbar: document.querySelector('.xns-toolbar-status')?.textContent,
    items: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
    replyLists: document.querySelectorAll('.comment-container > ul.comments .xns-reply-list').length,
    noteOwners: [...document.querySelectorAll('.comment-container > ul.comments .xns-remote-floor-link')]
      .map((note) => note.closest('.content-item')?.getAttribute('data-xns-floor')).sort(),
    // 当前页原始节点自带官方楼号，楼中楼里应原样显示（7 层当前页 + 2 层跨页改造 = 9 个楼号链接）。
    floorLinks: document.querySelectorAll('.comment-container > ul.comments .floor-link-wrapper > .floor-link').length,
  }));
  assert(state.toolbar === '9 条评论', `工具栏应显示 9 条评论，实际 ${state.toolbar}`);
  assert(state.items === 9, `应有 9 个楼层，实际 ${state.items}`);
  assert(state.replyLists === 2, `应有 2 个嵌套回复列表，实际 ${state.replyLists}`);
  assert(JSON.stringify(state.noteOwners) === JSON.stringify(['4', '5']), `跨页来源链接应只在 #4 #5，实际 ${JSON.stringify(state.noteOwners)}`);
  assert(state.floorLinks === 9, `楼中楼里 9 层评论都应显示楼号，实际 ${state.floorLinks}`);
  assert(dataOf(page).pageErrors.length === 0, `页面出现未捕获异常：${dataOf(page).pageErrors.join('; ')}`);
});

scenario('跨页评论点赞/鸡腿/反对计数来自 SSR 状态（0.5.9 回归）', async (ctx) => {
  const page = await openPostPage(ctx);
  const state = await page.evaluate(() => {
    const countOf = (menu, action) => {
      const item = [...menu.children].find((node) => (node.dataset.xnsAction || node.title) === action);
      const span = item && [...item.children].find((node) => /^\d+$/.test((node.textContent || '').trim()));
      return span ? span.textContent.trim() : null;
    };
    const carol = document.querySelector('.comment-container > ul.comments .content-item[data-xns-floor="4"]');
    const menu = carol?.querySelector(':scope > .comment-menu');
    return {
      floor: carol?.getAttribute('data-xns-floor'),
      like: countOf(menu, 'like'),
      chicken: countOf(menu, 'chicken'),
      dislike: countOf(menu, 'dislike'),
    };
  });
  assert(state.floor === '4', '应找到跨页评论 #4');
  assert(state.like === '3' && state.chicken === '2' && state.dislike === '1',
    `#4 计数应为 点赞3/鸡腿2/反对1，实际 ${state.like}/${state.chicken}/${state.dislike}`);
});

scenario('原版/楼中楼切换', async (ctx) => {
  const page = await openPostPage(ctx);
  const toolbarStyle = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector('.xns-post-toolbar'));
    return { position: style.position, right: style.right, bottom: style.bottom };
  });
  assert(toolbarStyle.position === 'fixed', `评论布局切换应悬浮固定，实际 ${toolbarStyle.position}`);
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
  const likePost = await waitPost(page, (post) => post.url.endsWith('/api/statistics/upvote'));
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
scenario('弹窗点赞/鸡腿/反对/收藏计数来自 SSR 状态（0.5.9 回归）', async (ctx) => {
  const page = await openPreviewModal(ctx);
  const state = await page.evaluate(() => {
    const countOf = (menu, action) => {
      const item = [...menu.children].find((node) => (node.dataset.xnsAction || node.title) === action);
      const span = item && [...item.children].find((node) => /^\d+$/.test((node.textContent || '').trim()));
      return span ? span.textContent.trim() : null;
    };
    const modal = document.querySelector('.xns-modal');
    const postMenu = modal.querySelector('.xns-preview-post > .comment-menu');
    const bob = [...modal.querySelectorAll('.xns-preview-thread .content-item[data-xns-floor]')].find((node) => node.textContent.includes('普通评论'));
    const root = modal.querySelector('.xns-preview-thread .content-item[data-xns-floor="1"]');
    return {
      post: { like: countOf(postMenu, 'like'), chicken: countOf(postMenu, 'chicken'), dislike: countOf(postMenu, 'dislike'), favorite: countOf(postMenu, 'favorite') },
      bob: { like: countOf(bob?.querySelector(':scope > .comment-menu'), 'like'), chicken: countOf(bob?.querySelector(':scope > .comment-menu'), 'chicken'), dislike: countOf(bob?.querySelector(':scope > .comment-menu'), 'dislike') },
      root: { like: countOf(root?.querySelector(':scope > .comment-menu'), 'like'), chicken: countOf(root?.querySelector(':scope > .comment-menu'), 'chicken') },
    };
  });
  assert(state.post.like === '5' && state.post.chicken === '3' && state.post.dislike === '1' && state.post.favorite === '7',
    `主帖计数应为 点赞5/鸡腿3/反对1/收藏7，实际 ${state.post.like}/${state.post.chicken}/${state.post.dislike}/${state.post.favorite}`);
  assert(state.bob.like === '1' && state.bob.chicken === '4' && state.bob.dislike === '1',
    `#3 计数应为 点赞1/鸡腿4/反对1，实际 ${state.bob.like}/${state.bob.chicken}/${state.bob.dislike}`);
  assert(state.root.like === '2' && state.root.chicken === '2',
    `#1 计数应为 点赞2/鸡腿2，实际 ${state.root.like}/${state.root.chicken}`);
});

scenario('弹窗跨页来源链接只出现在跨页评论（0.5.8 回归）', async (ctx) => {
  const page = await openPreviewModal(ctx);
  const state = await page.evaluate(() => {
    const notes = [...document.querySelectorAll('.xns-preview-thread .xns-remote-floor-link')];
    return {
      count: notes.length,
      owners: notes.map((note) => note.closest('.content-item')?.getAttribute('data-xns-floor')).sort(),
      // 当前页评论应保留官方灰色楼号 #N（右上角），不能因消毒丢失。
      floorLinks: [...document.querySelectorAll('.xns-preview-thread .floor-link-wrapper > .floor-link')]
        .map((link) => {
          const floor = link.closest('.content-item')?.getAttribute('data-xns-floor');
          return { floor, text: link.textContent.trim(), href: link.getAttribute('href') };
        }),
    };
  });
  assert(state.count === 2, `弹窗跨页来源链接应为 2 个，实际 ${state.count}`);
  assert(JSON.stringify(state.owners) === JSON.stringify(['4', '5']), `应只出现在 #4 #5，实际 ${JSON.stringify(state.owners)}`);
  const currentPageLinks = state.floorLinks.filter((l) => l.floor !== '4' && l.floor !== '5');
  assert(currentPageLinks.length === 7, `当前页 7 层评论都应显示官方楼号，实际 ${currentPageLinks.length}：${JSON.stringify(state.floorLinks)}`);
  // 楼号必须 absolute 悬浮在卡片右上角（与官方一致），不能退化为 meta 行内联文本。
  const pos = await page.evaluate(() => {
    const w = document.querySelector('.xns-preview-thread .content-item .floor-link-wrapper');
    const s = w ? getComputedStyle(w) : null;
    return s ? { position: s.position, top: s.top, right: s.right } : null;
  });
  assert(pos && pos.position === 'absolute', `楼号 wrapper 应为 absolute 定位（官方右上角样式），实际 ${JSON.stringify(pos)}`);
  assert(currentPageLinks.every((l) => /^#\d+$/.test(l.text)), `楼号文本应为官方 #N 格式，实际 ${JSON.stringify(currentPageLinks.map((l) => l.text))}`);
  assert(currentPageLinks.every((l) => l.href === `#${l.floor}` || l.href.endsWith(`#${l.floor}`)), `当前页楼号 href 应为官方 #N，实际 ${JSON.stringify(currentPageLinks.map((l) => l.href))}`);
});

scenario('弹窗点赞与收藏', async (ctx) => {
  const page = await openPreviewModal(ctx);
  await page.evaluate(() => {
    const root = document.querySelector('.xns-preview-thread .xns-comment-root');
    [...root.querySelector(':scope > .comment-menu').children].find((item) => item.dataset.xnsAction === 'like').click();
  });
  await waitPost(page, (post) => post.url.endsWith('/api/statistics/upvote'));
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
  assert(favorite.state === 'added' && favorite.count === '8', `收藏应从 SSR 基数 7 递增到 8，实际 ${JSON.stringify(favorite)}`);
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
    notes: document.querySelectorAll('.xns-preview-thread .xns-remote-floor-link').length,
  }));
  assert(state.items === 9, `回复后应保持 9 条回复，实际 ${state.items}`);
  assert(state.notes === 2, `回复后跨页来源链接应保持 2 个，实际 ${state.notes}`);
});

scenario('帖子页回复后新楼层出现在楼中楼（0.5.14 回归）', async (ctx) => {
  // 验证 B1：当前页在分页抓取里永不重抓，回复后若不重抓当前页，刚发的回复看不到。
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-789-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => /条评论/.test(document.querySelector('.xns-toolbar-status')?.textContent || ''), 15_000, '帖子页楼中楼构建');
  await page.evaluate(() => {
    const root = document.querySelector('.comment-container > ul.comments > .xns-comment-root');
    [...root.querySelector(':scope > .comment-menu').children].find((item) => item.dataset.xnsAction === 'reply').click();
    const composer = root.querySelector(':scope > .xns-preview-composer');
    composer.querySelector('textarea').value = '帖子页新回复';
    composer.querySelector('button').click();
  });
  const replyPost = await waitPost(page, (post) => post.url.endsWith('/api/content/new-comment'));
  assert(JSON.parse(replyPost.body).postId === 789, `回复应携带 postId 789，实际 ${replyPost.body}`);
  assert(/^[A-Za-z0-9]{16}$/.test(replyPost.headers['csrf-token'] || ''), `回复请求应带 16 位 csrf-token，实际 ${JSON.stringify(replyPost.headers)}`);
  await waitFor(page, () => (document.querySelector('.xns-toolbar-status')?.textContent || '').includes('3 条评论'), 15_000, '回复后楼中楼含 3 条');
  const state = await page.evaluate(() => ({
    floors: [...document.querySelectorAll('.comment-container > ul.comments [data-xns-floor]')].map((node) => node.getAttribute('data-xns-floor')),
    hasNewReply: document.querySelector('.comment-container')?.textContent?.includes('帖子页新回复') || false,
  }));
  assert(state.floors.includes('3'), `新回复应出现在楼中楼，实际楼层 ${JSON.stringify(state.floors)}`);
  assert(state.hasNewReply, '楼中楼应包含新回复内容');
  await page.close();
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

scenario('弹窗保留投票面板并提交，投后切换结果视图（0.5.12 回归）', async (ctx) => {
  const page = await openPreviewModal(ctx);
  // 等待 fetch /api/vote/info/123 完成、脚本自建投票面板。
  // 未投票时接口不返回统计：面板必须是可投的选项，而不是结果视图。
  await waitFor(page, () => {
    const panel = document.querySelector('.xns-preview-post .xns-vote-panel');
    return panel && panel.querySelectorAll('input[name="vote-item"]').length === 2;
  }, 10_000, '投票面板渲染');
  const state = await page.evaluate(() => {
    const panel = document.querySelector('.xns-preview-post .xns-vote-panel');
    const radios = [...panel.querySelectorAll('input[name="vote-item"]')].map((input) => input.value);
    return {
      panelExists: !!panel,
      radioCount: radios.length,
      radios,
      title: panel.querySelector('.xns-vote-title')?.textContent?.trim() || null,
      buttonText: panel.querySelector('button')?.textContent?.trim() || null,
      hasResults: !!panel.querySelector('.xns-vote-results'),
      nsappLinkGone: !document.querySelector('.xns-preview-post a[data-href*="nsapp"]'),
    };
  });
  assert(state.panelExists, '预览弹窗应渲染投票面板');
  assert(!state.hasResults, '未投票时不应显示结果视图');
  assert(state.radioCount === 2 && JSON.stringify(state.radios) === JSON.stringify(['13788', '13789']), `应有 2 个选项，实际 ${JSON.stringify(state.radios)}`);
  assert(state.title === '测试投票', `应有投票标题，实际 ${state.title}`);
  assert(state.buttonText === '投票', `应有投票按钮，实际 ${state.buttonText}`);
  assert(state.nsappLinkGone, 'nsapp 链接应被替换为投票面板');

  await page.evaluate(() => {
    const input = document.querySelector('.xns-preview-post .xns-vote-panel input[value="13788"]');
    input.click();
    document.querySelector('.xns-preview-post .xns-vote-panel button').click();
  });
  const post = await waitPost(page, (p) => p.url.endsWith('/api/vote/voteforitem'));
  const payload = JSON.parse(post.body);
  assert(payload.ids.length === 1 && payload.ids[0] === 13788, `应提交数字选项 id，实际 ${post.body}`);
  const get = dataOf(page).voteInfoGets.find((r) => r.url.endsWith('/api/vote/info/123'));
  assert(get && /^[0-9a-f]{40}$/.test(get.signature || ''), `GET 投票信息应带 x-dynamic-sign，实际 ${get?.signature || '缺失'}`);
  assert(/^[0-9a-f]{40}$/.test(post.signature || ''), `POST 投票应带 x-dynamic-sign，实际 ${post.signature || '缺失'}`);
  // 提交成功后脚本重新拉取并切换到结果视图：百分比条 + 总票数 + 所选项标记。
  await waitFor(page, () => document.querySelector('.xns-preview-post .xns-vote-panel .xns-vote-results'), 5_000, '投票后结果视图');
  const results = await page.evaluate(() => {
    const panel = document.querySelector('.xns-preview-post .xns-vote-panel');
    return {
      rows: panel.querySelectorAll('.xns-vote-result').length,
      total: panel.querySelector('.xns-vote-total')?.textContent?.trim() || null,
      mine: !!panel.querySelector('.xns-vote-mine'),
      inputsLeft: panel.querySelectorAll('input[name="vote-item"]').length,
    };
  });
  assert(results.rows === 2, `结果视图应有 2 行，实际 ${results.rows}`);
  assert(results.total === '共 3 票', `应显示总票数，实际 ${results.total}`);
  assert(results.mine, '所选项应有已选标记');
  assert(results.inputsLeft === 0, '投票后不应再有可点击选项');
});

scenario('暗色模式跟随网站 dark-layout（0.5.12 回归）', async (ctx) => {
  // 系统偏好为暗色、网站亮色：预览组件必须保持亮色（不再跟随系统）。
  const postPage = await ctx.newPage();
  await postPage.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await postPage.goto(`${ctx.base}/post-123-1`, { waitUntil: 'networkidle0' });
  await waitFor(postPage, () => /条评论/.test(document.querySelector('.xns-toolbar-status')?.textContent || ''), 15_000, '帖子页楼中楼构建');
  const lightToolbar = await postPage.evaluate(() => getComputedStyle(document.querySelector('.xns-post-toolbar')).backgroundColor);
  assert(lightToolbar.includes('248, 250, 252'), `网站亮色时工具栏应保持亮色，实际 ${lightToolbar}`);
  // 网站切到暗色（body.dark-layout）：预览组件跟随变暗。
  const darkToolbar = await postPage.evaluate(() => {
    document.body.classList.add('dark-layout');
    return getComputedStyle(document.querySelector('.xns-post-toolbar')).backgroundColor;
  });
  assert(darkToolbar === 'rgb(30, 41, 59)', `网站暗色时工具栏应变暗，实际 ${darkToolbar}`);
  await postPage.close();

  const modal = await openPreviewModal(ctx);
  await waitFor(modal, () => !!document.querySelector('.xns-modal'), 5_000, '预览弹窗打开');
  const lightModal = await modal.evaluate(() => getComputedStyle(document.querySelector('.xns-modal')).backgroundColor);
  assert(lightModal === 'rgb(255, 255, 255)', `网站亮色时弹窗应保持亮色，实际 ${lightModal}`);
  const darkModal = await modal.evaluate(() => {
    document.body.classList.add('dark-layout');
    return getComputedStyle(document.querySelector('.xns-modal')).backgroundColor;
  });
  assert(darkModal === 'rgb(24, 32, 43)', `网站暗色时弹窗应变暗，实际 ${darkModal}`);
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
