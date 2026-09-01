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
    if (Date.now() - started > timeout) {
      const diagnostic = await page.evaluate(() => ({
        readyState: document.readyState,
        status: document.querySelector('.xns-toolbar-status')?.textContent || null,
        title: document.querySelector('.xns-toolbar-status')?.title || null,
        virtualCount: Number(document.querySelector('.comment-container > ul.comments, .xns-preview-thread')?.dataset.xnsVirtualCount || 0),
      })).catch(() => null);
      throw new Error(`等待超时：${label || fn.toString().slice(0, 80)}；当前状态 ${JSON.stringify(diagnostic)}`);
    }
    await sleep(100);
  }
}

// ---------- 场景框架 ----------

const scenarios = [];
const scenario = (name, run) => scenarios.push({ name, run });

function createContext(browser, base) {
  const pages = [];
  return {
    browser,
    base,
    pages,
    async newPage() {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });
      const data = {
        posts: [],
        voteInfoGets: [],
        pageErrors: [],
        consoleIssues: [],
        requestFailures: [],
        badResponses: [],
        dialogs: [],
        expectedResponses: [],
        expectedRequestFailures: [],
        gets: [],
      };
      page.on('request', (request) => {
        const headers = request.headers();
        const record = { url: request.url(), body: request.postData() || '', headers };
        if ('x-dynamic-sign' in headers) record.signature = headers['x-dynamic-sign'];
        if (request.method() === 'POST') data.posts.push(record);
        else {
          data.gets.push(record);
          if (request.url().includes('/api/vote/info')) data.voteInfoGets.push(record);
        }
      });
      page.on('pageerror', (error) => data.pageErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning') {
          data.consoleIssues.push({ type: message.type(), text: message.text() });
        }
      });
      page.on('requestfailed', (request) => {
        data.requestFailures.push({
          method: request.method(),
          url: request.url(),
          error: request.failure()?.errorText || null,
        });
      });
      page.on('response', (response) => {
        if (response.status() >= 400) {
          data.badResponses.push({ status: response.status(), url: response.url() });
        }
      });
      page.on('dialog', async (dialog) => {
        data.dialogs.push(dialog.message());
        await dialog.accept();
      });
      page.__testData = data;
      pages.push(page);
      return page;
    },
  };
}

const dataOf = (page) => page.__testData;

async function materializeFloor(page, floor, listSelector = '.xns-virtual-list') {
  return page.evaluate(({ targetFloor, selector }) => {
    const list = document.querySelector(selector);
    const node = list?.__xnsVirtualizer?.scrollToFloor(targetFloor);
    return Boolean(node && node.isConnected);
  }, { targetFloor: floor, selector: listSelector });
}

function runtimeDiagnostics(pages) {
  return pages.flatMap((page) => {
    const data = dataOf(page);
    const isExpectedResponse = (item) => data.expectedResponses.some((expected) => item.status === expected.status && item.url.includes(expected.url));
    const isExpectedConsole = (item) => data.expectedResponses.some((expected) => item.text.includes(String(expected.status)));
    return [
      ...data.pageErrors.map((message) => `pageerror: ${message}`),
      ...data.consoleIssues.filter((item) => !isExpectedConsole(item)).map((item) => `console.${item.type}: ${item.text}`),
      ...data.requestFailures
        .filter((item) => !data.expectedRequestFailures.some((url) => item.url.includes(url)))
        .map((item) => `requestfailed: ${item.method} ${item.url} (${item.error || 'unknown'})`),
      ...data.badResponses.filter((item) => !isExpectedResponse(item)).map((item) => `HTTP ${item.status}: ${item.url}`),
    ];
  });
}

function assertNoRuntimeDiagnostics(pages) {
  const issues = runtimeDiagnostics(pages);
  assert(issues.length === 0, `运行时出现异常：${issues.join(' | ')}`);
}

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
  await waitFor(page, () => /^9 条回复$/.test(document.querySelector('.xns-toolbar-status')?.textContent || ''), 15_000, '帖子页楼中楼构建');
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

async function installFeatureQueryCounter(page) {
  await page.evaluateOnNewDocument(() => {
    const featureSelectors = new Set([
      '.xns-preview-content .nsk-magic-tabs',
      '.xns-preview-content .post-content, .xns-preview-content article.post-content',
      '.xns-preview-content pre',
      '.xns-preview-content img',
      '.xns-preview-content a[data-href^="nsapp://vote"], .xns-preview-content a[href^="nsapp://vote"]',
    ]);
    const stats = { count: 0, selectors: [] };
    const original = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function patchedQuerySelectorAll(selector) {
      const key = String(selector);
      if (featureSelectors.has(key)) {
        stats.count += 1;
        stats.selectors.push(key);
      }
      return original.call(this, selector);
    };
    window.__xnsFeatureQueryStats = stats;
  });
}

async function installPaginationQueryCounter(page) {
  await page.evaluateOnNewDocument(() => {
    const stats = { broad: 0, targeted: 0 };
    const original = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function patchedQuerySelectorAll(selector) {
      const key = String(selector);
      if (key === 'a[href]') stats.broad += 1;
      if (key === '.nsk-pager a[href], a.pager-pos[href]') stats.targeted += 1;
      return original.call(this, selector);
    };
    window.__xnsPaginationQueryStats = stats;
  });
}

async function installSanitizeQueryCounter(page) {
  await page.evaluateOnNewDocument(() => {
    const stats = { all: 0, dangerous: 0, menus: 0, ids: 0 };
    const original = Element.prototype.querySelectorAll;
    Element.prototype.querySelectorAll = function patchedQuerySelectorAll(selector) {
      const key = String(selector);
      if (key === '*') stats.all += 1;
      if (key === 'script,style,link,meta,base,iframe,object,embed,form,input,textarea,select,option,button') stats.dangerous += 1;
      if (key === '.comment-menu, .comment-actions') stats.menus += 1;
      if (key === '[id]') stats.ids += 1;
      return original.call(this, selector);
    };
    window.__xnsSanitizeQueryStats = stats;
  });
}

async function installLargeArrayFindCounter(page) {
  await page.evaluateOnNewDocument(() => {
    const stats = { count: 0 };
    const original = Array.prototype.find;
    Array.prototype.find = function patchedFind(...args) {
      if (this.length >= 100) stats.count += 1;
      return original.apply(this, args);
    };
    window.__xnsLargeArrayFindStats = stats;
  });
}

async function installParserCounter(page) {
  await page.evaluateOnNewDocument(() => {
    const stats = { count: 0 };
    const original = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function patchedParseFromString(...args) {
      stats.count += 1;
      return original.apply(this, args);
    };
    window.__xnsParserStats = stats;
  });
}

async function installAbortCounter(page) {
  await page.evaluateOnNewDocument(() => {
    const stats = { count: 0 };
    const original = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/post-124-2') && init.signal) {
        init.signal.addEventListener('abort', () => { stats.count += 1; }, { once: true });
      }
      return original(input, init);
    };
    window.__xnsAbortStats = stats;
  });
}

async function installPageRequestTimingCounter(page, postId) {
  await page.evaluateOnNewDocument((targetPostId) => {
    const starts = [];
    const original = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, init = {}) {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes(`/post-${targetPostId}-`)) starts.push({ url, time: performance.now() });
      return original(input, init);
    };
    window.__xnsPageRequestStarts = starts;
  }, postId);
}

// ---------- 场景 ----------

scenario('长帖分页截断明示（0.5.13 回归）', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-456-1`, { waitUntil: 'networkidle0' });
  // 456 帖共 52 页、每页 1 楼：MAX_PAGE 之上应截断并在状态栏明示，而不是静默丢楼层。
  await waitFor(page, () => {
    const status = document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '';
    const virtualCount = Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0);
    return /仅读取前 50 页/.test(status) && virtualCount === 50;
  }, 30_000, '截断状态提示');
  const state = await page.evaluate(() => ({
    toolbar: document.querySelector('.xns-toolbar-status')?.textContent,
    status: document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '',
    virtualCount: Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0),
    activeItems: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
  }));
  assert(/帖子共 52 页，仅读取前 50 页/.test(state.status), `状态栏应明示截断，实际 ${state.status}`);
  assert(state.virtualCount === 50, `截断后数据模型应有前 50 楼，实际 ${state.virtualCount}`);
  assert(state.activeItems < state.virtualCount, `截断长帖不应把 50 楼全部物化，实际 ${state.activeItems}/${state.virtualCount}`);
  const threadStyles = await page.evaluate(() => {
    const list = document.querySelector('.comment-container > ul.comments');
    const root = list?.querySelector(':scope > .xns-comment-root');
    return {
      hasPreviewThreadClass: list?.classList.contains('xns-preview-thread') || false,
      rootBorderLeftWidth: root ? getComputedStyle(root).borderLeftWidth : null,
    };
  });
  assert(threadStyles.hasPreviewThreadClass, '帖子详情页评论列表应带预览线程作用域');
  assert(threadStyles.rootBorderLeftWidth === '3px', `根楼层应显示 3px 蓝色左栏，实际 ${JSON.stringify(threadStyles)}`);
  assert(dataOf(page).pageErrors.length === 0, `页面出现未捕获异常：${dataOf(page).pageErrors.join('; ')}`);
  await page.close();
});

scenario('打开上限外页面时进度不计入当前页', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-456-52`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => {
    const status = document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '';
    const virtualCount = Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0);
    return /已读取 50\/50 页/.test(status) && virtualCount === 51;
  }, 30_000, '上限外页面进度');
  const state = await page.evaluate(() => ({
    status: document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '',
    virtualCount: Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0),
  }));
  assert(!/已读取 51\/50 页/.test(state.status), `当前页不应污染分页进度，实际 ${state.status}`);
  assert(state.virtualCount === 51, `应保留当前第 52 页及前 50 页，实际 ${state.virtualCount}`);
  await page.close();
});

scenario('长帖内容增强按可视远端评论执行', async (ctx) => {
  const page = await ctx.newPage();
  await installFeatureQueryCounter(page);
  await page.goto(`${ctx.base}/post-456-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => {
    const status = document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '';
    const virtualCount = Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0);
    return /仅读取前 50 页/.test(status) && virtualCount === 50;
  }, 30_000, '长帖内容增强扫描完成');
  const stats = await page.evaluate(() => window.__xnsFeatureQueryStats);
  assert(stats.count < 6 * 49, `首屏不应一次处理全部 49 个远端评论，实际执行 ${stats.count} 次：${JSON.stringify(stats.selectors)}`);
  await page.close();
});

scenario('长帖分页发现优先扫描分页链接', async (ctx) => {
  const page = await ctx.newPage();
  await installPaginationQueryCounter(page);
  await page.goto(`${ctx.base}/post-456-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => {
    const status = document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '';
    const virtualCount = Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0);
    return /仅读取前 50 页/.test(status) && virtualCount === 50;
  }, 30_000, '分页发现完成');
  const stats = await page.evaluate(() => window.__xnsPaginationQueryStats);
  assert(stats.broad === 0, `标准分页页面不应执行全量 a[href] 扫描，实际 ${stats.broad} 次`);
  assert(stats.targeted >= 50, `应对长帖分页执行定向扫描，实际 ${stats.targeted} 次`);
  await page.close();
});

scenario('无标准分页标记时仍回退发现分页', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-126-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '2 条回复', 5_000, '分页回退加载完成');
  const state = await page.evaluate(() => ({
    items: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
    status: document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '',
  }));
  assert(state.items === 2, `分页回退应读取两页评论，实际 ${state.items}`);
  assert(/已读取 2\/2 页/.test(state.status), `分页回退状态应为 2 页，实际 ${state.status}`);
  await page.close();
});

scenario('长帖安全克隆只做一次全树查询', async (ctx) => {
  const page = await ctx.newPage();
  await installSanitizeQueryCounter(page);
  await page.goto(`${ctx.base}/post-456-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => {
    const status = document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '';
    const virtualCount = Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0);
    return /仅读取前 50 页/.test(status) && virtualCount === 50;
  }, 30_000, '安全克隆完成');
  const stats = await page.evaluate(() => window.__xnsSanitizeQueryStats);
  assert(stats.all >= 49, `长帖远端评论应执行全树节点查询，实际 ${stats.all} 次`);
  assert(stats.dangerous === 0 && stats.menus === 0 && stats.ids === 0, `安全规则不应再重复查询树，实际 ${JSON.stringify(stats)}`);
  await page.close();
});

scenario('远端评论安全克隆规则保持', async (ctx) => {
  const page = await openPostPage(ctx);
  const state = await page.evaluate(() => {
    const remote = document.querySelector('.comment-container [data-xns-remote][data-xns-floor="4"]');
    const dangerousNodes = remote
      ? [...remote.querySelectorAll('script,style,link,meta,base,iframe,object,embed,form,input,textarea,select,option,button')]
        .filter((node) => !node.matches('.xns-code-copy-btn')).length
      : -1;
    return {
      exists: !!remote,
      dangerousNodes,
      unsafeAttributes: remote?.querySelectorAll('[onclick],[style],[srcdoc],[srcset],[formaction],[contenteditable],[ping]').length ?? -1,
      unsafeLinks: [...(remote?.querySelectorAll('a') || [])].filter((link) => /^javascript:/i.test(link.getAttribute('href') || '')).length,
    };
  });
  assert(state.exists, '应找到第 4 楼远端评论');
  assert(state.dangerousNodes === 0, `危险节点应被清理，实际 ${state.dangerousNodes}`);
  assert(state.unsafeAttributes === 0, `危险属性应被清理，实际 ${state.unsafeAttributes}`);
  assert(state.unsafeLinks === 0, `javascript 链接应被清理，实际 ${state.unsafeLinks}`);
  await page.close();
});

scenario('多评论 SSR 统计使用索引避免重复查找', async (ctx) => {
  const page = await ctx.newPage();
  await installLargeArrayFindCounter(page);
  await page.goto(`${ctx.base}/list-128`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-128-1"]');
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '120 条回复', 15_000, '120 条评论预览完成');
  const state = await page.evaluate(() => {
    const comment = document.querySelector('.xns-modal .xns-preview-thread .content-item[data-xns-floor="1"]');
    const like = [...(comment?.querySelector(':scope > .comment-menu')?.children || [])]
      .find((item) => item.dataset.xnsAction === 'like')?.querySelector('.xns-action-count')?.textContent;
    return { findCount: window.__xnsLargeArrayFindStats.count, like };
  });
  assert(state.findCount === 0, `120 条 SSR 评论不应反复执行大数组 find，实际 ${state.findCount} 次`);
  assert(state.like === '1', `SSR 统计索引应保留第 1 条评论点赞数，实际 ${state.like}`);
  await page.close();
});

scenario('预览首屏第一页评论不重复克隆', async (ctx) => {
  const page = await ctx.newPage();
  await installSanitizeQueryCounter(page);
  await page.goto(`${ctx.base}/list`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-123-1"]');
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '9 条回复', 15_000, '预览首屏完成');
  const stats = await page.evaluate(() => window.__xnsSanitizeQueryStats);
  // 帖子根 1 次 + 第一页 7 条评论 + 第二页 2 条评论；第一页不能被后台加载重复克隆。
  assert(stats.all === 10, `预览应只克隆 10 个节点，实际 ${stats.all} 次`);
  await page.close();
});

scenario('预览弹窗操作入口统一', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-123-1"]');
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3'), 15_000, '预览弹窗打开');
  const state = await page.evaluate(() => ({
    eyebrow: document.querySelector('.xns-modal-eyebrow')?.textContent?.trim(),
    original: document.querySelector('.xns-modal-original')?.textContent?.trim(),
    refreshInToolbar: !!document.querySelector('.xns-modal-toolbar .xns-refresh-post'),
    refreshInFloatingRail: !!document.querySelector('.xns-preview-scroll-btns .xns-refresh-post'),
    toolbarLabel: document.querySelector('.xns-modal-toolbar')?.getAttribute('aria-label'),
    navigationLabel: document.querySelector('.xns-preview-scroll-btns')?.getAttribute('aria-label'),
    topTip: document.querySelector('.xns-to-top')?.getAttribute('data-xns-tip'),
    bottomTip: document.querySelector('.xns-to-bottom')?.getAttribute('data-xns-tip'),
    closeTitle: document.querySelector('.xns-modal-close')?.getAttribute('title'),
    modeLabel: document.querySelector('.xns-modal-mode')?.textContent?.trim() || '',
  }));
  assert(!state.eyebrow, `预览不应显示无效的站点提示文案，实际 ${state.eyebrow}`);
  assert(!state.modeLabel, `预览工具栏不应显示重复的布局文案，实际 ${state.modeLabel}`);
  assert(state.original === '打开原帖', `原帖入口文案应明确，实际 ${state.original}`);
  assert(state.refreshInToolbar, '刷新应位于预览工具栏');
  assert(!state.refreshInFloatingRail, '浮动阅读导航不应重复显示刷新');
  assert(state.toolbarLabel === '预览工具', `工具栏应有无障碍标签，实际 ${state.toolbarLabel}`);
  assert(state.navigationLabel === '阅读导航', `阅读导航应有无障碍标签，实际 ${state.navigationLabel}`);
  assert(state.topTip === '回到顶部' && state.bottomTip === '回到底部', '上下导航应提供明确提示');
  assert(state.closeTitle === '关闭预览（Esc）', `关闭按钮应提示 Esc，实际 ${state.closeTitle}`);
  await page.close();
});

scenario('预览顶部分享复制规范帖子链接', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    const link = document.querySelector('a[href="/post-123-1"]');
    link?.setAttribute('href', '/post-123-2');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value) => { window.__xnsCopiedLink = value; } },
    });
  });
  await page.click('a[href="/post-123-2"]');
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3'), 15_000, '分享测试预览弹窗');
  const share = await page.$('.xns-modal-share');
  assert(Boolean(share), '预览顶部应显示分享按钮');
  assert(await page.$eval('.xns-modal-share', (node) => node.getAttribute('aria-label')) === '复制帖子链接', '分享按钮应说明复制帖子链接');
  assert(!(await page.$('.xns-modal-more')), '预览顶部不应再显示更多菜单');
  assert(!(await page.$('.xns-modal-help-toggle, .xns-modal-help, .xns-one-time-prompt')), '预览不应再显示帮助入口或一次性提示');
  await share.click();
  await waitFor(page, () => typeof window.__xnsCopiedLink === 'string', 3_000, '规范帖子链接复制');
  const copiedLink = await page.evaluate(() => window.__xnsCopiedLink);
  assert(copiedLink === `${ctx.base}/post-123-1`, `应复制规范帖子链接，实际 ${copiedLink}`);
  const label = await page.$eval('.xns-modal-share', (node) => node.textContent || '');
  assert(label?.includes('已复制'), `复制成功后应反馈已复制，实际 ${label}`);
  await page.close();
});

scenario('工具栏隐藏冗余上下文标签', async (ctx) => {
  const postPage = await openPostPage(ctx);
  const postToolbar = await postPage.evaluate(() => ({
    visibleLabel: document.querySelector('.xns-post-toolbar-label')?.textContent || '',
    modes: [...document.querySelectorAll('.xns-post-toolbar [data-mode]')].map((node) => node.textContent?.trim()),
    status: document.querySelector('.xns-toolbar-status')?.textContent || '',
  }));
  assert(!postToolbar.visibleLabel, `帖子页不应显示“评论”标签，实际 ${postToolbar.visibleLabel}`);
  assert(JSON.stringify(postToolbar.modes) === JSON.stringify(['楼中楼', '原版']),
    `帖子页模式按钮应保留，实际 ${JSON.stringify(postToolbar.modes)}`);
  await postPage.close();

  const previewPage = await openPreviewModal(ctx);
  const previewToolbar = await previewPage.evaluate(() => ({
    visibleLabel: document.querySelector('.xns-modal-toolbar-label')?.textContent || '',
    mode: document.querySelector('.xns-modal-mode')?.textContent?.trim() || '',
    refresh: Boolean(document.querySelector('.xns-modal-toolbar .xns-refresh-post')),
  }));
  assert(!previewToolbar.visibleLabel, `预览页不应显示“阅读”标签，实际 ${previewToolbar.visibleLabel}`);
  assert(!previewToolbar.mode && previewToolbar.refresh, '预览不应重复显示布局文案，但刷新功能应保留');
  await previewPage.close();
});

scenario('设置入口迁移到油猴菜单', async (ctx) => {
  const page = await ctx.newPage();
  await page.evaluateOnNewDocument(() => {
    const commands = [];
    window.__xnsMenuCommands = commands;
    window.GM_registerMenuCommand = (name, callback) => {
      commands.push({ name });
      window.__xnsSettingsMenuCallback = callback;
      return commands.length;
    };
  });
  await page.goto(`${ctx.base}/post-123-1`, { waitUntil: 'networkidle0' });
  const originalSettings = await page.evaluate(() => localStorage.getItem('xns-comment-preview-settings'));
  try {
    await waitFor(page, () => /^9 条回复$/.test(document.querySelector('.xns-toolbar-status')?.textContent || ''), 15_000, '帖子页设置入口初始化');
    const initial = await page.evaluate(() => ({
      commands: window.__xnsMenuCommands?.map((command) => command.name) || [],
      pageSettingsButton: !!document.querySelector('.xns-post-settings'),
      modeButtons: [...document.querySelectorAll('.xns-post-toolbar [data-mode]')].map((node) => node.textContent?.trim()),
    }));
    assert(initial.commands.length === 1 && initial.commands[0] === 'NodeSeek 评论预览：打开设置',
      `设置应注册到油猴菜单，实际 ${JSON.stringify(initial.commands)}`);
    assert(!initial.pageSettingsButton, '帖子页不应再显示设置按钮');
    assert(JSON.stringify(initial.modeButtons) === JSON.stringify(['楼中楼', '原版']),
      `设置迁移不应影响评论布局切换，实际 ${JSON.stringify(initial.modeButtons)}`);

    await page.evaluate(() => window.__xnsSettingsMenuCallback?.());
    await waitFor(page, () => !!document.querySelector('.xns-settings-panel'), 5_000, '油猴菜单打开设置面板');
    const panel = await page.evaluate(() => ({
      title: document.querySelector('.xns-settings-panel h2')?.textContent?.trim() || '',
      maxPages: document.querySelectorAll('.xns-settings-panel select')[1]?.value || '',
      hasPromptOption: document.body.textContent?.includes('显示一次性操作提示') || false,
      hasDone: !!document.querySelector('.xns-settings-primary'),
    }));
    assert(panel.title === '预览设置', `油猴菜单应打开原有设置面板，实际 ${panel.title}`);
    assert(panel.maxPages === '50', `设置面板默认页数应保持原值，实际 ${panel.maxPages}`);
    assert(!panel.hasPromptOption, '设置面板不应保留已删除的一次性提示选项');
    assert(panel.hasDone, '原有设置面板操作按钮应保留');

    await page.evaluate(() => {
      const maxPages = document.querySelectorAll('.xns-settings-panel select')[1];
      maxPages.value = '20';
      maxPages.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.click('.xns-settings-primary');
    await page.evaluate(() => window.__xnsSettingsMenuCallback?.());
    await waitFor(page, () => document.querySelectorAll('.xns-settings-panel select')[1]?.value === '20', 5_000, '设置从油猴菜单重新打开后保持');
    await page.click('.xns-settings-primary');
  } finally {
    await page.evaluate((raw) => {
      if (raw === null) localStorage.removeItem('xns-comment-preview-settings');
      else localStorage.setItem('xns-comment-preview-settings', raw);
    }, originalSettings);
    await page.close();
  }
});

scenario('短期缓存命中 HTML 但不保留 Document，刷新时重新抓取', async (ctx) => {
  const page = await ctx.newPage();
  await installParserCounter(page);
  await page.goto(`${ctx.base}/list`, { waitUntil: 'networkidle0' });
  const link = page.locator('a[href="/post-123-1"]');
  await link.click();
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '9 条回复', 15_000, '首次解析完成');
  const firstCount = await page.evaluate(() => window.__xnsParserStats.count);
  assert(firstCount === 2, `首次预览应解析两个帖子页面，实际 ${firstCount} 次`);
  await page.locator('.xns-modal-close').click();
  await waitFor(page, () => !document.querySelector('.xns-modal'), 5_000, '关闭预览');
  await link.click();
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '9 条回复', 5_000, '缓存解析完成');
  const cachedCount = await page.evaluate(() => window.__xnsParserStats.count);
  assert(cachedCount >= firstCount + 2, `HTML 缓存命中后仍应释放旧 Document 并重新解析两个页面，实际 ${firstCount} -> ${cachedCount}`);
  await page.locator('.xns-refresh-post').click();
  await waitFor(page, () => !document.querySelector('.xns-refresh-post')?.hasAttribute('aria-busy'), 15_000, '强制刷新解析完成');
  const refreshedCount = await page.evaluate(() => window.__xnsParserStats.count);
  assert(refreshedCount >= cachedCount + 2, `强制刷新应重新解析两个帖子页面，实际 ${cachedCount} -> ${refreshedCount}`);
  await page.close();
});

scenario('投票信息接近视口时才读取', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list-128`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-128-1"]');
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '120 条回复', 15_000, '长帖预览完成');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(dataOf(page).voteInfoGets.length === 0, `底部不可见投票不应在首屏请求，实际 ${dataOf(page).voteInfoGets.length} 次`);
  assert(await materializeFloor(page, 120, '.xns-modal .xns-preview-thread'), '应能从虚拟列表物化底部评论 #120');
  await page.evaluate(() => document.querySelector('.xns-modal .xns-preview-thread [data-xns-floor="120"]')?.scrollIntoView({ block: 'center' }));
  await waitFor(page, () => !!document.querySelector('.xns-modal .xns-vote-panel'), 10_000, '滚动后投票面板');
  assert(dataOf(page).voteInfoGets.length === 1, `滚动到底部后应只请求一次投票信息，实际 ${dataOf(page).voteInfoGets.length} 次`);
  await page.close();
});

scenario('关闭预览会取消未完成的远端分页请求', async (ctx) => {
  const page = await ctx.newPage();
  await installAbortCounter(page);
  dataOf(page).expectedRequestFailures.push('/post-124-2');
  await page.goto(`${ctx.base}/list-124`, { waitUntil: 'networkidle0' });
  const remoteRequest = page.waitForRequest((request) => request.url().endsWith('/post-124-2'), { timeout: 5_000 });
  await page.click('a[href="/post-124-1"]');
  await remoteRequest;
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '2 条回复', 5_000, '当前页预览完成');
  await page.click('.xns-modal-close');
  await waitFor(page, () => !document.querySelector('.xns-modal'), 5_000, '预览关闭');
  await new Promise((resolve) => setTimeout(resolve, 100));
  const aborted = await page.evaluate(() => window.__xnsAbortStats.count);
  assert(aborted >= 1, `关闭预览应 abort 未完成分页请求，实际 ${aborted} 次`);
  await page.close();
});

scenario('帖子页远端内容增强功能保留', async (ctx) => {
  const page = await openPostPage(ctx);
  await waitFor(page, () => document.querySelector('.comment-container [data-xns-remote] pre'), 5_000, '远端代码块出现');
  await page.evaluate(() => document.querySelector('.comment-container [data-xns-remote] pre')?.scrollIntoView({ block: 'center' }));
  await waitFor(page, () => document.querySelectorAll('.comment-container [data-xns-remote] .xns-code-copy-btn').length === 1, 5_000, '远端代码块增强');
  const state = await page.evaluate(() => ({
    remoteCodeBlocks: document.querySelectorAll('.comment-container [data-xns-remote] pre').length,
    remoteCopyButtons: document.querySelectorAll('.comment-container [data-xns-remote] .xns-code-copy-btn').length,
  }));
  assert(state.remoteCodeBlocks === 1, `远端评论应保留 1 个代码块，实际 ${state.remoteCodeBlocks}`);
  assert(state.remoteCopyButtons === 1, `远端代码块应保留 1 个复制按钮，实际 ${state.remoteCopyButtons}`);
  await page.close();
});

scenario('远端评论图片进入视口后才恢复源地址（0.5.22 回归）', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-460-1`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '500 条回复', 30_000, '富内容长帖加载完成');
  const before = await page.evaluate(() => {
    const images = [...document.querySelectorAll('.comment-container [data-xns-remote] img')];
    return {
      total: images.length,
      withSrc: images.filter((image) => image.getAttribute('src')).length,
      deferred: images.filter((image) => image.getAttribute('data-xns-deferred-src')).length,
      activeItems: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
      virtualCount: Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0),
    };
  });
  assert(before.total > 0, `远端评论应包含图片，实际 ${JSON.stringify(before)}`);
  assert(before.withSrc === before.total && before.deferred === 0 && before.activeItems < before.virtualCount,
    `评论物化后图片应恢复 src，同时不应物化全部评论：${JSON.stringify(before)}`);
  assert(await materializeFloor(page, 500, '.comment-container > ul.comments'), '应能从虚拟列表物化底部评论 #500');
  await page.evaluate(() => document.querySelector('.comment-container [data-xns-remote][data-xns-floor="500"]')?.scrollIntoView({ block: 'center' }));
  await waitFor(page, () => {
    const image = document.querySelector('.comment-container [data-xns-remote][data-xns-floor="500"] img');
    return Boolean(image?.getAttribute('src') && image.dataset.xnsImageBound === 'true');
  }, 5_000, '远端图片进入视口后恢复');
  await page.close();
});

scenario('富内容远端评论滚动后仍能增强根节点', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-460-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '500 条回复', 30_000, '富内容长帖加载完成');
  const before = await page.evaluate(() => ({
    remoteCodeBlocks: document.querySelectorAll('.comment-container [data-xns-remote] pre').length,
    remoteCopyButtons: document.querySelectorAll('.comment-container [data-xns-remote] .xns-code-copy-btn').length,
  }));
  assert(before.remoteCodeBlocks > 0, `富内容长帖应包含远端代码块，实际 ${JSON.stringify(before)}`);
  assert(await materializeFloor(page, 496, '.comment-container > ul.comments'), '应能从虚拟列表物化含代码块的远端评论 #496');
  await page.evaluate(() => document.querySelector('.comment-container [data-xns-remote][data-xns-floor="496"]')?.scrollIntoView({ block: 'center' }));
  await waitFor(page, () => Boolean(document.querySelector('.comment-container [data-xns-remote][data-xns-floor="496"] pre .xns-code-copy-btn')), 5_000, '滚动后增强远端根评论');
  const after = await page.evaluate(() => ({
    remoteCodeBlocks: document.querySelectorAll('.comment-container [data-xns-remote] pre').length,
    remoteCopyButtons: document.querySelectorAll('.comment-container [data-xns-remote] .xns-code-copy-btn').length,
    remoteImagesBound: document.querySelectorAll('.comment-container [data-xns-remote] img[data-xns-image-bound="true"]').length,
    targetCopyButton: Boolean(document.querySelector('.comment-container [data-xns-remote][data-xns-floor="496"] pre .xns-code-copy-btn')),
  }));
  assert(after.remoteCopyButtons >= before.remoteCopyButtons && after.targetCopyButton,
    `滚动后应增强远端根评论代码块：${JSON.stringify({ before, after })}`);
  assert(after.remoteImagesBound > 0, `滚动后应增强远端根评论图片：${JSON.stringify(after)}`);
  await page.close();
});

scenario('预览弹窗远端内容滚动后才增强', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list-460`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-460-1"]');
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '500 条回复', 30_000, '富内容预览加载完成');
  const before = await page.evaluate(() => ({
    remoteCodeBlocks: document.querySelectorAll('.xns-modal [data-xns-remote] pre').length,
    remoteCopyButtons: document.querySelectorAll('.xns-modal [data-xns-remote] .xns-code-copy-btn').length,
  }));
  assert(before.remoteCodeBlocks > 0, `富内容预览应包含远端代码块，实际 ${JSON.stringify(before)}`);
  assert(before.remoteCopyButtons < before.remoteCodeBlocks, `预览首屏不应增强全部远端代码块：${JSON.stringify(before)}`);
  assert(await materializeFloor(page, 496, '.xns-modal .xns-preview-thread'), '应能从虚拟列表物化含代码块的底部评论 #496');
  await page.evaluate(() => document.querySelector('.xns-modal [data-xns-remote][data-xns-floor="496"]')?.scrollIntoView({ block: 'center' }));
  await waitFor(page, () => {
    return Boolean(document.querySelector('.xns-modal [data-xns-remote][data-xns-floor="496"] pre .xns-code-copy-btn'));
  }, 5_000, '预览滚动后增强远端评论');
  const after = await page.evaluate(() => ({
    remoteCopyButtons: document.querySelectorAll('.xns-modal [data-xns-remote] .xns-code-copy-btn').length,
    remoteImagesBound: document.querySelectorAll('.xns-modal [data-xns-remote] img[data-xns-image-bound="true"]').length,
  }));
  assert(after.remoteCopyButtons > before.remoteCopyButtons, `预览滚动后应增强远端代码块：${JSON.stringify({ before, after })}`);
  assert(after.remoteImagesBound > 0, `预览滚动后应增强远端图片：${JSON.stringify(after)}`);
  await page.close();
});

scenario('预览正文长图加载后虚拟楼层坐标不偏移（0.5.23 回归）', async (ctx) => {
  const page = await openPreviewModal(ctx);
  await page.evaluate(async () => {
    const content = document.querySelector('.xns-modal .xns-preview-post .post-content');
    const image = document.createElement('img');
    image.alt = '长图坐标回归测试';
    const loaded = new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    });
    content.appendChild(image);
    image.src = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="2400"><rect width="640" height="2400" fill="#ddd"/></svg>')}`;
    await loaded;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const body = document.querySelector('.xns-modal-body');
    const thread = document.querySelector('.xns-modal .xns-preview-thread');
    const threadTop = thread.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
    body.scrollTo({ top: threadTop, behavior: 'auto' });
  });
  await waitFor(page, () => Boolean(document.querySelector('.xns-modal .xns-preview-thread > .content-item[data-xns-floor="1"]')), 5_000, '长图后的首层评论物化');
  const atThreadTop = await page.evaluate(() => {
    const thread = document.querySelector('.xns-modal .xns-preview-thread');
    const first = thread.firstElementChild;
    return {
      firstFloor: first?.getAttribute('data-xns-floor') || null,
      leadingSpacer: first?.classList.contains('xns-virtual-spacer') ? first.getBoundingClientRect().height : 0,
    };
  });
  assert(atThreadTop.firstFloor === '1' && atThreadTop.leadingSpacer === 0,
    `滚到长图后的评论区顶部应从 #1 开始，实际 ${JSON.stringify(atThreadTop)}`);

  assert(await materializeFloor(page, 9, '.xns-modal .xns-preview-thread'), '长图后应能定位并物化 #9');
  await waitFor(page, () => {
    const body = document.querySelector('.xns-modal-body');
    const target = document.querySelector('.xns-modal .xns-preview-thread > .content-item[data-xns-floor="9"]');
    if (!body || !target) return false;
    const bodyRect = body.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    return targetRect.bottom > bodyRect.top && targetRect.top < bodyRect.bottom;
  }, 5_000, '长图后的楼层导航进入视口');
  await page.close();
});

scenario('预览楼层显示蓝色左侧标识（0.5.23 回归）', async (ctx) => {
  const page = await openPreviewModal(ctx);
  const style = await page.evaluate(() => {
    const floor = document.querySelector('.xns-modal .xns-preview-thread > .content-item[data-xns-floor]');
    const computed = floor && getComputedStyle(floor);
    return computed ? {
      width: Number.parseFloat(computed.borderLeftWidth),
      style: computed.borderLeftStyle,
      color: computed.borderLeftColor,
    } : null;
  });
  assert(style?.width >= 3 && style.style === 'solid' && /37,\s*99,\s*235/.test(style.color),
    `预览楼层应显示蓝色左侧长条，实际 ${JSON.stringify(style)}`);
  await page.close();
});

scenario('预览分页完成一页就立即显示（0.5.24 回归）', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list-127`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-127-1"]');
  await waitFor(page, () => {
    const heading = document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent || '';
    const status = document.querySelector('.xns-modal .xns-page-loading')?.textContent || '';
    return heading === '4 条回复' && /已读取 2\/4 页/.test(status);
  }, 1_200, '预览第 2 页渐进显示');
  const partial = await page.evaluate(() => ({
    heading: document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent || '',
    loading: document.querySelector('.xns-modal .xns-page-loading')?.textContent || '',
    virtualCount: Number(document.querySelector('.xns-modal .xns-preview-thread')?.dataset.xnsVirtualCount || 0),
  }));
  assert(partial.virtualCount === 4 && /正在读取其他分页/.test(partial.loading),
    `第 2 页返回时应先显示 4 条并继续后台加载，实际 ${JSON.stringify(partial)}`);
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '8 条回复', 6_000, '预览剩余分页完成');
  await page.close();
});

scenario('预览分页失败保留内容并在工具栏提示', async (ctx) => {
  const page = await ctx.newPage();
  dataOf(page).expectedResponses.push({ status: 503, url: '/post-129-2' });
  await page.goto(`${ctx.base}/list-129`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-129-1"]');
  await waitFor(page, () => document.querySelector('.xns-modal .xns-page-failed'), 8_000, '预览分页失败提示');
  const state = await page.evaluate(() => ({
    heading: document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent || '',
    status: document.querySelector('.xns-modal .xns-modal-toolbar-status')?.textContent || '',
    virtualCount: Number(document.querySelector('.xns-modal .xns-preview-thread')?.dataset.xnsVirtualCount || 0),
    bodyStatuses: document.querySelectorAll('.xns-modal .xns-preview-comments > .xns-preview-status').length,
  }));
  assert(state.heading === '2 条回复', `分页失败时已读内容应保留，实际 ${state.heading}`);
  assert(state.virtualCount === 2, `分页失败时虚拟数据应保留 2 条，实际 ${state.virtualCount}`);
  assert(/1 页读取失败/.test(state.status), `工具栏应提示失败页数，实际 ${state.status}`);
  assert(state.bodyStatuses === 0, `分页状态不应重复插入评论列表底部，实际 ${state.bodyStatuses} 个`);
  await page.close();
});

scenario('帖子页重试只读取失败分页', async (ctx) => {
  const page = await ctx.newPage();
  dataOf(page).expectedResponses.push({ status: 503, url: '/post-129-2' });
  await page.goto(`${ctx.base}/post-129-1`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '2 条回复', 8_000, '帖子页失败分页提示');
  const before = dataOf(page).gets.length;
  await page.click('.xns-post-refresh');
  await waitFor(page, () => document.querySelector('.xns-post-refresh')?.getAttribute('aria-busy') !== 'true', 15_000, '帖子页失败分页重试完成');
  const retriedPostReads = dataOf(page).gets.slice(before)
    .map(({ url }) => new URL(url).pathname)
    .filter((pathname) => /^\/post-129-\d+$/.test(pathname));
  assert(retriedPostReads.length >= 1, `重试应再次读取失败页，实际 ${JSON.stringify(retriedPostReads)}`);
  assert(retriedPostReads.every((pathname) => pathname === '/post-129-2'),
    `重试不应重新读取成功页，实际 ${JSON.stringify(retriedPostReads)}`);
  await page.close();
});

scenario('帖子页当前页优先渲染，远端分页后台加载', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-124-1`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => {
    const toolbar = document.querySelector('.xns-toolbar-status')?.textContent || '';
    const status = document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '';
    const items = document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length;
    return toolbar === '2 条回复' && /正在读取其他分页/.test(status) && items === 2;
  }, 1_000, '当前页优先渲染');
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '4 条回复', 5_000, '远端分页完成');
  const state = await page.evaluate(() => ({
    items: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
    status: document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '',
  }));
  assert(state.items === 4, `后台分页完成后应有 4 个楼层，实际 ${state.items}`);
  assert(/已读取 2\/2 页/.test(state.status), `后台分页完成后状态应为 2 页，实际 ${state.status}`);
  assert(dataOf(page).pageErrors.length === 0, `页面出现未捕获异常：${dataOf(page).pageErrors.join('; ')}`);
  await page.close();
});
scenario('分页 429 按 Retry-After 重试后继续加载', async (ctx) => {
  const page = await ctx.newPage();
  dataOf(page).expectedResponses.push({ status: 429, url: '/post-125-2' });
  await page.goto(`${ctx.base}/post-125-1`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '4 条回复', 5_000, '429 重试后的分页完成');
  const retryState = await page.evaluate(() => fetch('/test/retry-state', { cache: 'no-store' }).then((response) => response.json()));
  assert(retryState.post125Page2 === 2, `第 2 页应首次 429 后重试一次，实际请求 ${retryState.post125Page2} 次`);
  assert(dataOf(page).pageErrors.length === 0, `页面出现未捕获异常：${dataOf(page).pageErrors.join('; ')}`);
  await page.close();
});

scenario('Cloudflare challenge 不自动重复请求且可手动重试', async (ctx) => {
  const page = await ctx.newPage();
  dataOf(page).expectedResponses.push({ status: 429, url: '/post-130-2' });
  await page.goto(`${ctx.base}/post-130-1`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent?.includes('需验证'), 5_000, 'Cloudflare 验证提示');
  const firstReads = dataOf(page).gets
    .map(({ url }) => new URL(url).pathname)
    .filter((pathname) => pathname === '/post-130-2');
  assert(firstReads.length === 1, `Cloudflare challenge 不应自动重试，实际请求 ${firstReads.length} 次`);
  const statusBeforeRetry = await page.$eval('.xns-toolbar-status', (node) => node.textContent || '');
  assert(statusBeforeRetry.includes('需验证'), `工具栏应说明需要完成验证，实际文案：${statusBeforeRetry}`);

  await page.click('.xns-post-refresh');
  await waitFor(page, () => document.querySelector('.xns-post-refresh')?.getAttribute('aria-busy') !== 'true'
    && document.querySelector('.xns-toolbar-status')?.textContent === '4 条回复', 8_000, 'Cloudflare 验证后手动重试');
  const secondReads = dataOf(page).gets
    .map(({ url }) => new URL(url).pathname)
    .filter((pathname) => pathname === '/post-130-2');
  assert(secondReads.length === 2, `手动重试应再次读取 challenge 页，实际请求 ${secondReads.length} 次`);
  assert(!(await page.$eval('.xns-toolbar-status', (node) => node.textContent || '')).includes('需验证'), '成功重试后不应保留验证提示');
  await page.close();
});

scenario('分页请求从首个请求开始遵守基础间隔', async (ctx) => {
  const page = await ctx.newPage();
  await installPageRequestTimingCounter(page, 460);
  await page.goto(`${ctx.base}/post-460-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => {
    const status = document.querySelector('.xns-toolbar-status')?.title || document.querySelector('.xns-toolbar-status')?.textContent || '';
    return /已读取 50\/50 页/.test(status);
  }, 30_000, '分页基础间隔');
  const starts = await page.evaluate(() => window.__xnsPageRequestStarts || []);
  assert(starts.length >= 2, `应至少记录两个分页请求，实际 ${JSON.stringify(starts)}`);
  const firstGap = starts[1].time - starts[0].time;
  assert(firstGap >= 100, `前两个分页请求不应同时发出，实际间隔 ${firstGap.toFixed(1)}ms`);
  await page.close();
});

scenario('帖子页楼中楼构建与跨页来源链接', async (ctx) => {
  const page = await openPostPage(ctx);
  for (const floor of [4, 5]) {
    assert(await materializeFloor(page, floor, '.comment-container > ul.comments'), `应能从虚拟列表物化跨页评论 #${floor}`);
    const source = await page.evaluate((targetFloor) => {
      const node = document.querySelector(`.comment-container > ul.comments [data-xns-floor="${targetFloor}"]`);
      return {
        hasSource: Boolean(node?.querySelector('.xns-remote-floor-link')),
        floors: [...document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]')].map((item) => item.getAttribute('data-xns-floor')),
      };
    }, floor);
    assert(source.hasSource, `跨页评论 #${floor} 应显示来源楼层链接，实际 ${JSON.stringify(source)}`);
  }
  const state = await page.evaluate(() => ({
    toolbar: document.querySelector('.xns-toolbar-status')?.textContent,
    virtualCount: Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0),
    activeItems: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
    depths: [...document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-depth]')]
      .map((node) => `${node.getAttribute('data-xns-floor')}:${node.getAttribute('data-xns-depth')}`),
    noteOwners: [...document.querySelectorAll('.comment-container > ul.comments .xns-remote-floor-link')]
      .map((note) => note.closest('.content-item')?.getAttribute('data-xns-floor')).sort(),
    // 当前页原始节点自带官方楼号，楼中楼里应原样显示（7 层当前页 + 2 层跨页改造 = 9 个楼号链接）。
    floorLinks: document.querySelectorAll('.comment-container > ul.comments .floor-link-wrapper > .floor-link').length,
  }));
  assert(state.toolbar === '9 条回复', `工具栏应显示 9 条回复，实际 ${state.toolbar}`);
  assert(state.virtualCount === 9, `数据模型应有 9 个楼层，实际 ${state.virtualCount}`);
  assert(state.activeItems > 0 && state.activeItems <= state.virtualCount, `已物化楼层数量应在数据模型范围内，实际 ${state.activeItems}/${state.virtualCount}`);
  assert(state.depths.some((value) => value.endsWith(':1')), `应保留楼中楼 depth 信息，实际 ${JSON.stringify(state.depths)}`);
  assert(state.noteOwners.every((floor) => ['4', '5'].includes(floor)), `跨页来源链接不应出现在其他楼层，实际 ${JSON.stringify(state.noteOwners)}`);
  assert(state.floorLinks > 0, `已物化楼层应显示官方楼号，实际 ${state.floorLinks}`);
  assert(dataOf(page).pageErrors.length === 0, `页面出现未捕获异常：${dataOf(page).pageErrors.join('; ')}`);
});

scenario('跨页评论点赞/鸡腿/反对计数来自 SSR 状态（0.5.9 回归）', async (ctx) => {
  const page = await openPostPage(ctx);
  assert(await materializeFloor(page, 4, '.comment-container > ul.comments'), '应能从虚拟列表物化跨页评论 #4');
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
    remote: document.querySelectorAll('.comment-container > ul.comments [data-xns-remote]').length,
  }));
  assert(original.children === 7, `原版应有 7 个原始评论，实际 ${original.children}`);
  assert(!original.threaded, '原版不应保留楼中楼结构');
  assert(original.remote === 0, `原版不应保留跨页评论节点，实际 ${original.remote}`);

  await page.evaluate(() => {
    [...document.querySelectorAll('.xns-post-toolbar [data-mode]')].find((button) => button.dataset.mode === 'thread').click();
  });
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '9 条回复', 15_000, '释放远端快照后重新构建楼中楼');
  const thread = await page.evaluate(() => ({
    roots: document.querySelectorAll('.comment-container > ul.comments > .xns-comment-root').length,
    items: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
    virtualCount: Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0),
    children: document.querySelectorAll('.comment-container > ul.comments > .xns-comment-child[data-xns-parent-floor]').length,
  }));
  assert(thread.virtualCount === 9, `切回楼中楼后数据模型应恢复 9 个楼层，实际 ${thread.virtualCount}`);
  assert(thread.children > 0, `切回楼中楼后应保留父子关系，实际 ${thread.children}`);
  assert(thread.items > 0 && thread.items <= thread.virtualCount, `切回楼中楼后活动楼层数量应在数据模型范围内，实际 ${thread.items}/${thread.virtualCount}`);
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

scenario('虚拟楼层流滚动回收并恢复远端楼层', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-460-1`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '500 条回复', 30_000, '虚拟楼层流加载完成');
  const top = await page.evaluate(() => {
    const list = document.querySelector('.comment-container > ul.comments');
    return {
      virtualCount: Number(list?.dataset.xnsVirtualCount || 0),
      activeItems: list?.querySelectorAll('.content-item[data-xns-floor]').length || 0,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
  assert(top.virtualCount === 500, `虚拟数据模型应保留 500 条评论，实际 ${JSON.stringify(top)}`);
  assert(top.activeItems < top.virtualCount, `顶部不应物化全部评论，实际 ${JSON.stringify(top)}`);
  assert(top.scrollHeight > 2_000, `占位高度应保留长帖滚动空间，实际 ${top.scrollHeight}`);

  assert(await materializeFloor(page, 500, '.comment-container > ul.comments'), '滚动到底部时应能重新物化 #500');
  await waitFor(page, () => Boolean(document.querySelector('.comment-container > ul.comments [data-xns-floor="500"]')), 5_000, '底部楼层物化');
  const bottom = await page.evaluate(() => ({
    hasFloor500: Boolean(document.querySelector('.comment-container > ul.comments [data-xns-floor="500"]')),
    activeItems: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
    virtualCount: Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0),
  }));
  assert(bottom.hasFloor500 && bottom.activeItems < bottom.virtualCount, `底部应只保留活动窗口并包含 #500，实际 ${JSON.stringify(bottom)}`);

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'auto' }));
  await waitFor(page, () => Boolean(document.querySelector('.comment-container > ul.comments [data-xns-floor="1"]')), 5_000, '回到顶部楼层恢复');
  const restored = await page.evaluate(() => ({
    hasFloor1: Boolean(document.querySelector('.comment-container > ul.comments [data-xns-floor="1"]')),
    hasFloor500: Boolean(document.querySelector('.comment-container > ul.comments [data-xns-floor="500"]')),
    activeItems: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
  }));
  assert(restored.hasFloor1 && !restored.hasFloor500, `回到顶部后应回收底部楼层，实际 ${JSON.stringify(restored)}`);
  await page.close();
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
  await waitFor(page, () => document.querySelector('.xns-toolbar-status')?.textContent === '9 条回复', 15_000, '回复后重排');
  const state = await page.evaluate(() => ({
    items: document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor]').length,
    roots: document.querySelectorAll('.comment-container > ul.comments > .xns-comment-root').length,
    virtualCount: Number(document.querySelector('.comment-container > ul.comments')?.dataset.xnsVirtualCount || 0),
    children: document.querySelectorAll('.comment-container > ul.comments > .xns-comment-child[data-xns-parent-floor]').length,
  }));
  assert(state.virtualCount === 9, `回复重排后数据模型应保留 9 个楼层，实际 ${state.virtualCount}`);
  assert(state.children > 0, `回复重排后父子关系应保留，实际 ${state.children}`);
  assert(state.items > 0 && state.items <= state.virtualCount, `回复重排后活动楼层数量应在数据模型范围内，实际 ${state.items}/${state.virtualCount}`);
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
    const postFloorLink = post.querySelector('.floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link');
    const postActions = [...post.querySelector(':scope > .comment-menu').children].map((item) => item.dataset.xnsAction);
    const root = modal.querySelector('.xns-preview-thread .xns-comment-root');
    const floorActions = [...root.querySelector(':scope > .comment-menu').children].map((item) => item.dataset.xnsAction);
    const floorHints = [...root.querySelectorAll(':scope > .comment-menu > .menu-item')].map((item) => item.getAttribute('aria-label'));
    const remoteFloorLink = modal.querySelector('.xns-preview-thread .xns-remote-floor-link > .floor-link');
    return {
      title: modal.querySelector('.xns-modal-title')?.textContent,
      postFloorHref: postFloorLink?.href || '',
      postActions,
      floorActions,
      floorHints,
      rootClass: root.className,
      remoteFloorLabel: remoteFloorLink?.getAttribute('aria-label') || '',
      virtualCount: Number(modal.querySelector('.xns-preview-thread')?.dataset.xnsVirtualCount || 0),
    };
  });
  assert(state.title === 'Fixture NodeSeek 帖子', `弹窗标题应为帖子标题，实际 ${state.title}`);
  assert(state.postFloorHref === `${ctx.base}/post-123-1#0`, `主帖 #0 应指向原帖，实际 ${state.postFloorHref}`);
  assert(JSON.stringify(state.postActions) === JSON.stringify(['like', 'chicken', 'dislike', 'favorite', 'quote', 'reply']), `主帖应有 6 项操作，实际 ${JSON.stringify(state.postActions)}`);
  assert(JSON.stringify(state.floorActions.slice(0, 5)) === JSON.stringify(['like', 'chicken', 'dislike', 'quote', 'reply']), `回复楼层应有 5 项标准操作（不含收藏），实际 ${JSON.stringify(state.floorActions.slice(0, 5))}`);
  assert(state.floorActions[5] === null, `回复楼层第 6 项应为官方编辑项（null），实际 ${JSON.stringify(state.floorActions[5])}`);
  assert(state.rootClass.includes('xns-comment-root'), `一级楼层应带根楼层标识，实际 ${state.rootClass}`);
  assert(state.floorHints.every(Boolean), `评论操作应有无障碍提示，实际 ${JSON.stringify(state.floorHints)}`);
  assert(state.remoteFloorLabel === '打开原楼层 #4', `跨页楼层应有明确来源提示，实际 ${state.remoteFloorLabel}`);
  assert(state.virtualCount === 9, `弹窗数据模型应有 9 条回复，实际 ${state.virtualCount}`);
});

scenario('预览菜单键盘操作使用全局事件代理', async (ctx) => {
  const page = await openPreviewModal(ctx);
  await page.evaluate(() => document.querySelector('.xns-modal .xns-preview-menu > .menu-item[data-xns-action="quote"]')?.focus());
  await page.keyboard.press('Enter');
  await waitFor(page, () => Boolean(document.querySelector('.xns-modal .xns-preview-composer')), 5_000, '键盘打开引用编辑器');
  const state = await page.evaluate(() => ({
    composer: Boolean(document.querySelector('.xns-modal .xns-preview-composer')),
    focusedAction: document.activeElement?.dataset?.xnsAction || '',
  }));
  assert(state.composer, `键盘 Enter 应打开引用编辑器：${JSON.stringify(state)}`);
  await page.close();
});

scenario('楼中楼重绘复用远端评论节点', async (ctx) => {
  const page = await openPostPage(ctx);
  await page.evaluate(() => {
    const remote = document.querySelector('.comment-container .content-item[data-xns-remote][data-xns-floor="4"]');
    remote?.setAttribute('data-xns-reuse-marker', 'true');
  });
  await page.click('.xns-post-toolbar [data-mode="thread"]');
  await waitFor(page, () => Boolean(document.querySelector('.comment-container .content-item[data-xns-reuse-marker="true"]')), 5_000, '复用远端评论节点');
  await page.close();
});

scenario('同一页面重复打开帖子命中短期缓存，手动刷新强制重抓', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list`, { waitUntil: 'networkidle0' });
  const link = page.locator('a[href="/post-123-1"]');
  const postReads = () => dataOf(page).gets.filter(({ url }) => {
    const pathname = new URL(url).pathname;
    return ['/post-123-1', '/post-123-2'].includes(pathname);
  }).length;
  await link.click();
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '9 条回复', 15_000, '首次预览完成');
  const firstReads = postReads();
  assert(firstReads === 2, `首次预览应读取 2 个帖子页面，实际 ${firstReads}`);
  await page.locator('.xns-modal-close').click();
  await waitFor(page, () => !document.querySelector('.xns-modal'), 5_000, '关闭首次预览');
  await link.click();
  await waitFor(page, () => document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent === '9 条回复', 5_000, '缓存预览完成');
  const cachedReads = postReads();
  assert(cachedReads === firstReads, `第二次预览应命中缓存，不应新增请求，实际 ${firstReads} -> ${cachedReads}`);
  await page.locator('.xns-refresh-post').click();
  await waitFor(page, () => !document.querySelector('.xns-refresh-post')?.hasAttribute('aria-busy'), 15_000, '手动刷新完成');
  const refreshedReads = postReads();
  assert(refreshedReads >= cachedReads + 2, `手动刷新应重新读取两个帖子页面，实际 ${cachedReads} -> ${refreshedReads}`);
  assert(dataOf(page).pageErrors.length === 0, `页面出现未捕获异常：${dataOf(page).pageErrors.join('; ')}`);
  await page.close();
});

scenario('列表外帖子链接保持原生跳转', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list`, { waitUntil: 'networkidle0' });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
    page.click('.post-link-notification'),
  ]);
  assert(page.url() === `${ctx.base}/post-123-1`, `列表外链接应原生跳转，实际 ${page.url()}`);
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
          return { floor, text: link.textContent.trim(), href: link.href };
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
  assert(currentPageLinks.every((l) => l.href === `${ctx.base}/post-123-1#${l.floor}`), `所有当前页楼号都应指向原帖楼层，实际 ${JSON.stringify(currentPageLinks)}`);
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
    const postComposer = document.querySelector('.xns-preview-composer-host > .xns-preview-composer');
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

scenario('分页未完成时可立即打开帖子级回复编辑器', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list-124`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-124-1"]');
  await waitFor(page, () => Boolean(document.querySelector('.xns-modal .xns-modal-reply')), 5_000, '预览回复入口出现');
  await page.click('.xns-modal-reply');
  await page.evaluate(() => {
    document.querySelector('.xns-preview-composer-host textarea').value = '分页加载期间的草稿';
  });
  const state = await page.evaluate(() => ({
    composer: Boolean(document.querySelector('.xns-preview-composer-host > .xns-preview-composer')),
    hostOpen: !document.querySelector('.xns-preview-composer-host')?.hidden,
    bodyScrollTop: document.querySelector('.xns-modal-body')?.scrollTop || 0,
  }));
  assert(state.composer && state.hostOpen, `分页未完成时应立即打开独立回复区：${JSON.stringify(state)}`);
  assert(state.bodyScrollTop === 0, `打开帖子级回复不应滚动评论区，实际 ${state.bodyScrollTop}`);
  await waitFor(page, () => document.querySelector('.xns-preview-comments h3')?.textContent === '4 条回复', 5_000, '延迟分页完成');
  const afterPagination = await page.evaluate(() => ({
    composer: Boolean(document.querySelector('.xns-preview-composer-host > .xns-preview-composer')),
    draft: document.querySelector('.xns-preview-composer-host textarea')?.value,
  }));
  assert(afterPagination.composer && afterPagination.draft === '分页加载期间的草稿', `分页重绘不应移除或清空回复草稿：${JSON.stringify(afterPagination)}`);
  await page.close();
});

scenario('分页未完成时可立即发送帖子级回复', async (ctx) => {
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list-124`, { waitUntil: 'networkidle0' });
  await page.click('a[href="/post-124-1"]');
  await waitFor(page, () => Boolean(document.querySelector('.xns-modal .xns-modal-reply')), 5_000, '预览回复入口出现');
  const startedAt = Date.now();
  await page.click('.xns-modal-reply');
  await page.evaluate(() => {
    document.querySelector('.xns-preview-composer-host textarea').value = '分页未完成时发送的回复';
  });
  await page.click('.xns-preview-composer-host button');
  await waitPost(page, (post) => post.url.endsWith('/api/content/new-comment'));
  await waitFor(page, () => !document.querySelector('.xns-preview-composer-host > .xns-preview-composer'), 1_000, '回复响应完成后编辑器移除');
  assert(Date.now() - startedAt < 1_200, '帖子级回复 POST 不应等待延迟分页返回');
  const state = await page.evaluate(() => ({
    composer: Boolean(document.querySelector('.xns-preview-composer-host > .xns-preview-composer')),
    pageLoading: document.querySelector('.xns-preview-status')?.classList.contains('is-loading') || false,
  }));
  assert(!state.composer, `发送成功后应立即移除帖子级编辑器：${JSON.stringify(state)}`);
  await page.close();
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
    const composer = document.querySelector('.xns-preview-composer-host > .xns-preview-composer');
    composer.querySelector('textarea').value = '弹窗回归回复';
    composer.querySelector('button').click();
  });
  await waitPost(page, (post) => post.url.endsWith('/api/content/new-comment'));
  await waitFor(page, () => {
    const heading = document.querySelector('.xns-preview-comments h3');
    const pending = document.querySelector('.xns-refresh-post')?.classList.contains('xns-action-pending');
    return heading && /9 条回复/.test(heading.textContent || '') && !pending;
  }, 15_000, '弹窗回复后重排完成');
  await waitFor(page, () => !document.querySelector('.xns-preview-composer'), 15_000, '回复成功后编辑器移除');
  const state = await page.evaluate(() => ({
    items: document.querySelectorAll('.xns-preview-thread .content-item[data-xns-floor]').length,
    virtualCount: Number(document.querySelector('.xns-preview-thread')?.dataset.xnsVirtualCount || 0),
    notes: document.querySelectorAll('.xns-preview-thread .xns-remote-floor-link').length,
    composers: document.querySelectorAll('.xns-preview-composer').length,
    statusText: document.querySelector('.xns-preview-composer-status')?.textContent || null,
    bodyTail: document.querySelector('.xns-modal-body')?.textContent?.slice(-120) || null,
  }));
  assert(state.virtualCount === 9, `回复后数据模型应保持 9 条回复，实际 ${state.virtualCount}`);
  assert(state.notes === 2, `回复后跨页来源链接应保持 2 个，实际 ${state.notes}`);
  assert(state.composers === 0, `回复成功后编辑器应移除，实际残留 ${state.composers} 个`);
  assert(state.statusText === null, `回复成功后状态提示应消失，实际残留 “${state.statusText}”`);
});

scenario('楼中楼显示自己的评论编辑入口并保留官方编辑器（0.5.19 回归）', async (ctx) => {
  // 自己的评论：官方只在 isMine 渲染“编辑”菜单项；楼中楼重排后仍应保留
  // 这个原生入口，点击后由官方在楼层下方展开编辑器，不能被脚本改成跳转。
  const page = await openPostPage(ctx);
  await waitFor(page, () => {
    const menu = document.querySelector('.comment-container > ul.comments .content-item[data-xns-floor="1"] > .comment-menu');
    return menu && Array.from(menu.children).some((el) => (el.textContent || '' ).trim() === '编辑');
  }, 15_000, '楼中楼里自己的评论显示编辑入口');
  await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('.comment-container > ul.comments .content-item[data-xns-floor="1"] .menu-item')).find((el) => (el.textContent || '').trim() === '编辑');
    const comment = item.closest('.content-item');
    const list = comment.closest('.comments');
    const spacer = document.createElement('li');
    spacer.className = 'xns-virtual-spacer';
    spacer.style.height = '900px';
    list.replaceChildren(spacer, comment);
  });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }),
    page.click('.comment-container > ul.comments > li[id="1"] .menu-item[aria-label="编辑"]'),
  ]);
  await waitFor(page, () => Boolean(document.querySelector('.content-item[id="1"] .official-edit-composer')), 15_000, '刷新后打开官方楼层编辑器');
  const state = await page.evaluate(() => ({
    href: location.href,
    hasEditor: !!document.querySelector('.content-item[id="1"] .official-edit-composer'),
    originalMode: document.querySelector('.xns-post-toolbar [data-mode="original"]')?.getAttribute('aria-pressed') === 'true',
    status: document.querySelector('.xns-toolbar-status')?.textContent || '',
    pendingRequest: sessionStorage.getItem('xns-comment-preview-native-edit'),
  }));
  assert(state.href === `${ctx.base}/post-123-1`, `帖子页编辑不应改变 URL，实际 ${state.href}`);
  assert(state.hasEditor, '点击帖子页编辑应保留官方楼层下方编辑器');
  assert(state.originalMode, '官方编辑兜底页应保持原版评论布局');
  assert(state.status === '原版评论已恢复。', `官方编辑兜底页状态应明确，实际 “${state.status}”`);
  assert(state.pendingRequest === null, '官方编辑请求消费后不应残留 sessionStorage 标记');
});
11

scenario('弹窗预览自己的评论出现编辑入口（0.5.20 回归）', async (ctx) => {
  // 预览弹窗的评论走 SSR 克隆；fixture 的官方“编辑”项模拟原版节点，
  // 脚本须识别为 isMine 并接管（菜单保留单个编辑项）。
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/list`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => {
    // 真实列表页可能没有可直接解析的用户菜单，只在 SSR 状态中提供当前用户。
    document.querySelector('.user-menu')?.remove();
    const state = { user: { member_id: 1 } };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    const script = document.createElement('script');
    script.id = 'temp-script';
    script.type = 'application/json';
    script.textContent = encoded;
    document.body.appendChild(script);
  });
  await page.click('a[href="/post-123-1"]');
  await waitFor(page, () => {
    const heading = document.querySelector('.xns-modal .xns-preview-comments h3');
    return heading && /9 条回复/.test(heading.textContent || '');
  },15_000, '预览弹窗加载');
  const state = await page.evaluate(() => {
    const menu = document.querySelector('.xns-modal .xns-preview-thread .xns-comment-root > .comment-menu');
    const kids = menu ? Array.from(menu.children) : [];
    const items = kids.map(function (el) { return (el.textContent || '' ).trim(); });
    return { hasEdit: items.includes('编辑'), count: items.length };
  });
  assert(state.hasEdit, '预览弹窗里自己的评论应显示编辑入口');
  assert(state.count === 6, `预览编辑菜单应有 6 项（5 标准 + 编辑），实际 ${state.count}`);
});

scenario('帖子页回复后新楼层出现在楼中楼（0.5.14 回归）', async (ctx) => {
  // 验证 B1：当前页在分页抓取里永不重抓，回复后若不重抓当前页，刚发的回复看不到。
  const page = await ctx.newPage();
  await page.goto(`${ctx.base}/post-789-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => /条回复/.test(document.querySelector('.xns-toolbar-status')?.textContent || ''), 15_000, '帖子页楼中楼构建');
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
  await waitFor(page, () => (document.querySelector('.xns-toolbar-status')?.textContent || '').includes('3 条回复'), 15_000, '回复后楼中楼含 3 条');
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
  await page.evaluate(() => {
    document.querySelector('.xns-modal [data-xns-remote] pre')?.scrollIntoView({ block: 'center' });
  });
  await waitFor(page, () => document.querySelectorAll('.xns-code-copy-btn').length === 3, 5_000, '预览远端代码增强');
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
  await waitFor(postPage, () => /条回复/.test(document.querySelector('.xns-toolbar-status')?.textContent || ''), 15_000, '帖子页楼中楼构建');
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
  const selectedScenarios = process.env.XNS_TEST_FILTER
    ? scenarios.filter(({ name }) => name.includes(process.env.XNS_TEST_FILTER))
    : scenarios;
  if (selectedScenarios.length === 0) throw new Error(`没有匹配的测试场景：${process.env.XNS_TEST_FILTER}`);
  for (const { name, run } of selectedScenarios) {
    const started = Date.now();
    const pageStart = ctx.pages.length;
    try {
      await run(ctx);
      assertNoRuntimeDiagnostics(ctx.pages.slice(pageStart));
      reports.push({ name, pass: true, ms: Date.now() - started });
    } catch (error) {
      const issues = runtimeDiagnostics(ctx.pages.slice(pageStart));
      const detail = issues.length ? `${error.message}；${issues.join(' | ')}` : error.message;
      reports.push({ name, pass: false, ms: Date.now() - started, error: detail });
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
