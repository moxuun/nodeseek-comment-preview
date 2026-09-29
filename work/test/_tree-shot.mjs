// 临时探针：截图楼中楼关系线（linux tree 风格）的实际渲染，验证后删除。
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const findFreePort = async () => {
  // Chrome 会拒绝部分端口（ERR_UNSAFE_PORT），在安全区间里找一个空闲端口。
  for (let candidate = 4810; candidate < 4860; candidate += 1) {
    const free = await new Promise((resolve) => {
      const server = net.createServer();
      server.on('error', () => resolve(false));
      server.listen(candidate, '127.0.0.1', () => server.close(() => resolve(true)));
    });
    if (free) return candidate;
  }
  throw new Error('没有可用端口');
};

const startServer = (port) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(repoRoot, 'work', 'xns-fixture-server.mjs'), String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const timer = setTimeout(() => { child.kill(); reject(new Error('fixture 超时')); }, 10_000);
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (/XNS_FIXTURE_READY/.test(output)) { clearTimeout(timer); resolve(child); }
  });
});

async function waitFor(page, predicate, label, timeout = 15_000) {
  const started = Date.now();
  for (;;) {
    if (await page.evaluate(predicate)) return;
    if (Date.now() - started > timeout) throw new Error(`等待超时：${label}`);
    await sleep(100);
  }
}

const port = await findFreePort();
const base = `http://127.0.0.1:${port}`;
const server = await startServer(port);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const out = path.resolve(repoRoot, 'work', 'test', '_tree-shot');
fs.mkdirSync(out, { recursive: true });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
  await page.goto(`${base}/post-123-1`, { waitUntil: 'networkidle0' });
  await waitFor(page, () => !!document.querySelector('.xns-virtual-list .xns-comment-child'), '帖子页楼中楼');

  // 逐条展开：把虚拟列表里所有条目都滚出来，再整段截图。
  const geometry = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.xns-virtual-list .content-item[data-xns-depth]')];
    return rows.map((row) => {
      const computed = getComputedStyle(row);
      const rect = row.getBoundingClientRect();
      const meta = row.querySelector('.nsk-content-meta-info');
      const avatar = row.querySelector('.avatar, img.avatar, .user-info-display');
      const metaRect = meta?.getBoundingClientRect();
      const avatarRect = avatar?.getBoundingClientRect();
      return {
        floor: row.getAttribute('data-xns-floor'),
        depth: Number(row.getAttribute('data-xns-depth')),
        indent: row.style.getPropertyValue('--xns-indent'),
        top: Math.round(rect.top), height: Math.round(rect.height), left: Math.round(rect.left),
        contentLeft: Math.round(metaRect?.left ?? 0) - Math.round(rect.left),
        metaCenterY: metaRect ? Math.round(metaRect.top - rect.top + metaRect.height / 2) : null,
        avatarBox: avatarRect ? `${Math.round(avatarRect.width)}x${Math.round(avatarRect.height)}@${Math.round(avatarRect.top - rect.top)}` : null,
        columns: computed.backgroundSize.split(',')[0],
        connector: computed.backgroundPosition.split(',')[1],
      };
    });
  });
  console.log(JSON.stringify(geometry, null, 1));

  const clip = await page.evaluate(() => {
    const list = document.querySelector('.xns-virtual-list');
    const rect = list.getBoundingClientRect();
    return { x: Math.max(0, rect.left - 8), y: Math.max(0, rect.top - 8), width: Math.min(900, rect.width + 40), height: Math.min(880, rect.height + 16) };
  });
  await page.screenshot({ path: path.join(out, 'post-thread.png'), clip });

  // 预览弹窗里的同一段楼中楼
  const modal = await browser.newPage();
  await modal.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
  await modal.goto(`${base}/list`, { waitUntil: 'networkidle0' });
  await modal.click('a[href="/post-123-1"]');
  await waitFor(modal, () => /9 条回复/.test(document.querySelector('.xns-modal .xns-preview-comments h3')?.textContent || ''), '预览弹窗');
  await modal.evaluate(() => document.querySelector('.__xnsVirtualizer')?.scrollToFloor?.(10));
  await sleep(300);
  const modalClip = await modal.evaluate(() => {
    const body = document.querySelector('.xns-modal-body');
    const rect = body.getBoundingClientRect();
    return { x: Math.max(0, rect.left - 4), y: Math.max(0, rect.top - 4), width: Math.min(1000, rect.width + 8), height: Math.min(700, rect.height + 8) };
  });
  await modal.screenshot({ path: path.join(out, 'modal-thread.png'), clip: modalClip });
  console.log(`截图：${out}`);
} finally {
  await browser.close().catch(() => {});
  server.kill();
}
