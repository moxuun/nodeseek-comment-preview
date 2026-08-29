// NodeSeek 楼中楼预览加载基准。
// 对比当前工作树与 HEAD 中的构建产物，使用同一个 fixture 和真实 Chrome。

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const fixtureServer = path.join(repoRoot, 'work', 'xns-fixture-server.mjs');
const outputRelativePath = 'outputs/nodeseek-comment-preview.user.js';
const currentScript = fs.readFileSync(path.join(repoRoot, outputRelativePath), 'utf8');
const baselineResult = spawnSync('git', ['show', `HEAD:${outputRelativePath}`], { cwd: repoRoot, encoding: 'utf8' });
if (baselineResult.status !== 0 || !baselineResult.stdout) {
  throw new Error(`无法读取 HEAD 构建产物：${baselineResult.stderr || 'git show 失败'}`);
}
const baselineScript = baselineResult.stdout;
const runs = Math.max(3, Number(process.env.XNS_BENCH_RUNS || 5));
const scenarioFilter = process.env.XNS_BENCH_FILTER || '';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  const which = process.platform === 'win32' ? 'where' : 'which';
  for (const name of ['chrome', 'chromium', 'google-chrome', 'msedge']) {
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

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function summary(values) {
  return {
    median: Math.round(percentile(values, 0.5)),
    p90: Math.round(percentile(values, 0.9)),
    min: Math.round(Math.min(...values)),
    max: Math.round(Math.max(...values)),
  };
}

function summaryDecimal(values, digits = 2) {
  const scale = 10 ** digits;
  const round = (value) => Math.round(value * scale) / scale;
  return {
    median: round(percentile(values, 0.5)),
    p90: round(percentile(values, 0.9)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

async function waitForPreviewFirst(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const check = () => {
      if (document.querySelector('.xns-preview-post')) resolve(true);
      else requestAnimationFrame(check);
    };
    check();
  }));
}

async function waitForPreviewComplete(page, expected) {
  return page.evaluate((expectedText) => new Promise((resolve) => {
    const check = () => {
      const heading = document.querySelector('.xns-preview-comments h3')?.textContent || '';
      if (heading.includes(expectedText)) resolve(true);
      else requestAnimationFrame(check);
    };
    check();
  }), expected);
}

async function waitForPostCurrent(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const check = () => {
      if (document.querySelector('.xns-post-toolbar .xns-toolbar-status')) resolve(true);
      else requestAnimationFrame(check);
    };
    check();
  }));
}

async function waitForPostComplete(page, expected) {
  return page.evaluate((expectedText) => new Promise((resolve) => {
    const check = () => {
      const status = document.querySelector('.xns-toolbar-status')?.textContent || '';
      if (status.includes(expectedText)) resolve(true);
      else requestAnimationFrame(check);
    };
    check();
  }), expected);
}

async function measure(browser, base, script, scenario) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.setCacheEnabled(false);
  const requests = [];
  page.on('request', (request) => {
    if (request.method() === 'GET') requests.push(request.url());
    const requestUrl = new URL(request.url());
    if (requestUrl.pathname === `/${outputRelativePath}`) {
      void request.respond({ status: 200, contentType: 'application/javascript; charset=utf-8', body: script });
    } else {
      void request.continue();
    }
  });
  await page.setRequestInterception(true);
  if (scenario.featureQueryCounter) {
    await page.evaluateOnNewDocument(() => {
      const stats = { count: 0 };
      const original = Element.prototype.querySelectorAll;
      Element.prototype.querySelectorAll = function patchedQuerySelectorAll(selector) {
        if (String(selector).includes('.xns-preview-content')) stats.count += 1;
        return original.call(this, selector);
      };
      window.__xnsFeatureBenchStats = stats;
    });
  }
  if (scenario.detachedMenuCounter) {
    await page.evaluateOnNewDocument(() => {
      const stats = { count: 0 };
      const original = Element.prototype.appendChild;
      Element.prototype.appendChild = function patchedAppendChild(child) {
        if (this.matches('.xns-preview-menu') && !this.isConnected && child instanceof Element && child.matches('.menu-item')) stats.count += 1;
        return original.call(this, child);
      };
      window.__xnsDetachedMenuBenchStats = stats;
    });
  }
  if (scenario.menuQueryCounter) {
    await page.evaluateOnNewDocument(() => {
      const stats = { count: 0 };
      const original = Element.prototype.querySelectorAll;
      Element.prototype.querySelectorAll = function patchedMenuQuerySelectorAll(selector) {
        if (String(selector) === ':scope > .menu-item') stats.count += 1;
        return original.call(this, selector);
      };
      window.__xnsMenuQueryBenchStats = stats;
    });
  }
  let started = performance.now();
  let first;
  let complete;
  if (scenario.kind === 'preview') {
    await page.goto(`${base}${scenario.listPath}`, { waitUntil: 'domcontentloaded' });
    if (scenario.warm) {
      await page.click(`a[href="${scenario.postPath}"]`);
      await waitForPreviewComplete(page, scenario.expected);
      await page.click('.xns-modal-close');
      await page.evaluate(() => new Promise((resolve) => {
        const check = () => {
          if (!document.querySelector('.xns-modal')) resolve(true);
          else requestAnimationFrame(check);
        };
        check();
      }));
    }
    started = performance.now();
    await page.click(`a[href="${scenario.postPath}"]`);
    await waitForPreviewFirst(page);
    first = performance.now() - started;
    await waitForPreviewComplete(page, scenario.expected);
    complete = performance.now() - started;
  } else {
    await page.goto(`${base}${scenario.postPath}`, { waitUntil: 'domcontentloaded' });
    await waitForPostCurrent(page);
    first = performance.now() - started;
    await waitForPostComplete(page, scenario.expected);
    complete = performance.now() - started;
    if (scenario.after === 'original') {
      await page.click('.xns-post-toolbar [data-mode="original"]');
      await page.waitForFunction(() => !document.querySelector('.xns-post-toolbar [data-mode="original"]')?.getAttribute('aria-pressed') || document.querySelector('.xns-post-toolbar [data-mode="original"]')?.getAttribute('aria-pressed') === 'true');
    } else if (scenario.after === 'thread-rerender') {
      await page.click('.xns-post-toolbar [data-mode="thread"]');
      await page.waitForFunction(() => document.querySelector('.xns-post-toolbar [data-mode="thread"]')?.getAttribute('aria-pressed') === 'true');
      await waitForPostComplete(page, scenario.expected);
    }
  }
  const result = {
    first: Math.round(first),
    complete: Math.round(complete),
    total: Math.round(performance.now() - started),
    postGets: requests.filter((url) => /\/post-\d+-\d+(?:$|[?#])/.test(new URL(url).pathname)).length,
    voteGets: requests.filter((url) => url.includes('/api/vote/info/')).length,
  };
  await page.evaluate(() => {
    if (typeof window.gc === 'function') window.gc();
  });
  const chromeMetrics = await page.metrics();
  result.jsHeapUsedMB = Math.round((chromeMetrics.JSHeapUsedSize / 1024 / 1024) * 100) / 100;
  result.domNodes = chromeMetrics.Nodes;
  result.documents = chromeMetrics.Documents;
  if (scenario.featureQueryCounter) {
    result.featureQueries = await page.evaluate(() => window.__xnsFeatureBenchStats?.count ?? 0);
  }
  if (scenario.detachedMenuCounter) {
    result.detachedMenuItems = await page.evaluate(() => window.__xnsDetachedMenuBenchStats?.count ?? 0);
  }
  if (scenario.menuQueryCounter) {
    result.menuQueries = await page.evaluate(() => window.__xnsMenuQueryBenchStats?.count ?? 0);
  }
  if (scenario.featureNodeCounter) {
    const featureNodes = await page.evaluate(() => ({
      totalComments: document.querySelectorAll('.content-item').length,
      remoteComments: document.querySelectorAll('.content-item[data-xns-remote]').length,
      totalImages: document.querySelectorAll('img').length,
      totalElements: document.querySelectorAll('*').length,
      bodyHtmlBytes: document.body?.innerHTML.length || 0,
      treeNodes: (() => {
        const walker = document.createTreeWalker(document, NodeFilter.SHOW_ALL);
        let count = 0;
        while (walker.nextNode()) count += 1;
        return count;
      })(),
      remoteCodeButtons: document.querySelectorAll('[data-xns-remote] .xns-code-copy-btn').length,
      totalPre: document.querySelectorAll('pre').length,
      remoteImagesBound: document.querySelectorAll('[data-xns-remote] img[data-xns-image-bound="true"]').length,
      remoteImagesWithSrc: [...document.querySelectorAll('[data-xns-remote] img')].filter((image) => image.getAttribute('src')).length,
      remoteImagesDeferred: document.querySelectorAll('[data-xns-remote] img[data-xns-deferred-src]').length,
    }));
    result.remoteCodeButtons = featureNodes.remoteCodeButtons;
    result.totalComments = featureNodes.totalComments;
    result.remoteComments = featureNodes.remoteComments;
    result.totalImages = featureNodes.totalImages;
    result.totalElements = featureNodes.totalElements;
    result.bodyHtmlBytes = featureNodes.bodyHtmlBytes;
    result.treeNodes = featureNodes.treeNodes;
    result.totalPre = featureNodes.totalPre;
    result.remoteImagesBound = featureNodes.remoteImagesBound;
    result.remoteImagesWithSrc = featureNodes.remoteImagesWithSrc;
    result.remoteImagesDeferred = featureNodes.remoteImagesDeferred;
  }
  await page.close();
  return result;
}

const scenarios = [
  { name: '普通帖子预览', kind: 'preview', listPath: '/list', postPath: '/post-123-1', expected: '9 条回复' },
  { name: '延迟分页帖子预览', kind: 'preview', listPath: '/list-124', postPath: '/post-124-1', expected: '4 条回复' },
  { name: '预览重复打开（热缓存）', kind: 'preview', warm: true, listPath: '/list', postPath: '/post-123-1', expected: '9 条回复' },
  { name: '120 条评论预览', kind: 'preview', listPath: '/list-128', postPath: '/post-128-1', expected: '120 条回复' },
  { name: '120 条评论帖子页', kind: 'post', postPath: '/post-128-1', expected: '120 条评论' },
  { name: '50 页帖子页', kind: 'post', postPath: '/post-456-1', expected: '50 条评论' },
  { name: '50 页帖子页切换原版', kind: 'post', after: 'original', postPath: '/post-456-1', expected: '50 条评论' },
  { name: '50 页帖子页楼中楼重绘', kind: 'post', after: 'thread-rerender', postPath: '/post-456-1', expected: '50 条评论' },
  { name: '500 条富内容帖子页', kind: 'post', featureQueryCounter: true, featureNodeCounter: true, detachedMenuCounter: true, menuQueryCounter: true, postPath: '/post-460-1', expected: '500 条评论' },
  { name: '500 条富内容预览', kind: 'preview', featureQueryCounter: true, featureNodeCounter: true, listPath: '/list-460', postPath: '/post-460-1', expected: '500 条回复' },
  { name: '10 页富内容帖子页虚拟窗口', kind: 'post', featureNodeCounter: true, postPath: '/post-461-1', expected: '100 条评论' },
  { name: '30 页富内容帖子页虚拟窗口', kind: 'post', featureNodeCounter: true, postPath: '/post-463-1', expected: '300 条评论' },
  { name: '50 页富内容帖子页虚拟窗口', kind: 'post', featureNodeCounter: true, postPath: '/post-465-1', expected: '500 条评论' },
  { name: '10 页富内容预览虚拟窗口', kind: 'preview', featureNodeCounter: true, listPath: '/list-461', postPath: '/post-461-1', expected: '100 条回复' },
  { name: '30 页富内容预览虚拟窗口', kind: 'preview', featureNodeCounter: true, listPath: '/list-463', postPath: '/post-463-1', expected: '300 条回复' },
  { name: '50 页富内容预览虚拟窗口', kind: 'preview', featureNodeCounter: true, listPath: '/list-465', postPath: '/post-465-1', expected: '500 条回复' },
];
const selectedScenarios = scenarioFilter ? scenarios.filter((scenario) => scenario.name.includes(scenarioFilter)) : scenarios;
if (!selectedScenarios.length) throw new Error(`没有匹配的 benchmark 场景：${scenarioFilter}`);

const chromePath = findChrome();
if (!chromePath) throw new Error('未找到 Chrome/Chromium，请设置 CHROME_PATH。');
const port = await findFreePort();
const base = `http://127.0.0.1:${port}`;
const server = await startServer(port);
let browser;
try {
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--js-flags=--expose-gc'],
  });
  console.log(`浏览器：${chromePath}`);
  console.log(`重复次数：${runs}`);
  console.log('单位：ms；首屏=脚本接管并显示当前内容，完成=目标内容全部就绪。');
  for (const scenario of selectedScenarios) {
    const rows = { baseline: [], current: [] };
    for (const [label, script] of [['baseline', baselineScript], ['current', currentScript]]) {
      for (let index = 0; index < runs; index += 1) {
        rows[label].push(await measure(browser, base, script, scenario));
        await sleep(80);
      }
    }
    console.log(`\n[${scenario.name}]`);
    for (const label of ['baseline', 'current']) {
      const values = rows[label];
      const featureText = values[0]?.featureQueries === undefined ? '' : ` | 增强查询 ${JSON.stringify(summary(values.map((item) => item.featureQueries)))}`;
      const menuText = values[0]?.detachedMenuItems === undefined ? '' : ` | 脱离文档菜单项 ${JSON.stringify(summary(values.map((item) => item.detachedMenuItems)))}`;
      const menuQueryText = values[0]?.menuQueries === undefined ? '' : ` | 菜单查询 ${JSON.stringify(summary(values.map((item) => item.menuQueries)))}`;
      const nodeText = values[0]?.remoteCodeButtons === undefined ? '' : ` | 评论 ${JSON.stringify(summary(values.map((item) => item.totalComments)))}（远端 ${JSON.stringify(summary(values.map((item) => item.remoteComments)))}） | 图片 ${JSON.stringify(summary(values.map((item) => item.totalImages)))} | pre ${JSON.stringify(summary(values.map((item) => item.totalPre)))} | 元素 ${JSON.stringify(summary(values.map((item) => item.totalElements)))} | DOM遍历节点 ${JSON.stringify(summary(values.map((item) => item.treeNodes)))} | HTML ${JSON.stringify(summary(values.map((item) => item.bodyHtmlBytes)))}字节 | 远端代码按钮 ${JSON.stringify(summary(values.map((item) => item.remoteCodeButtons)))} | 远端图片绑定 ${JSON.stringify(summary(values.map((item) => item.remoteImagesBound)))} | 远端图片有源 ${JSON.stringify(summary(values.map((item) => item.remoteImagesWithSrc)))} | 远端图片待恢复 ${JSON.stringify(summary(values.map((item) => item.remoteImagesDeferred)))}`;
      console.log(`${label.padEnd(8)} 首屏 ${JSON.stringify(summary(values.map((item) => item.first)))} | 完成 ${JSON.stringify(summary(values.map((item) => item.complete)))} | 总计 ${JSON.stringify(summary(values.map((item) => item.total)))} | JS堆 ${JSON.stringify(summaryDecimal(values.map((item) => item.jsHeapUsedMB)))}MB | DOM ${JSON.stringify(summary(values.map((item) => item.domNodes)))} | Document ${JSON.stringify(summary(values.map((item) => item.documents)))}${featureText}${menuText}${menuQueryText}${nodeText} | 请求 ${values.map((item) => `${item.postGets}页/${item.voteGets}投票`).join(', ')}`);
    }
    const before = summary(rows.baseline.map((item) => item.complete)).median;
    const after = summary(rows.current.map((item) => item.complete)).median;
    const delta = before ? ((before - after) / before) * 100 : 0;
    console.log(`完成耗时中位数变化：${before}ms → ${after}ms（${delta >= 0 ? '-' : '+'}${Math.abs(delta).toFixed(1)}%）`);
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  server.kill();
}
