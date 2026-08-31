// NodeSeek 真实环境只读冒烟测试。
//
// 该脚本不会读取 Cookie、Storage 或页面私密数据，也不会提交点赞、回复、编辑等操作。
// 它只连接用户明确提供的 Chrome CDP 地址，检查已经打开的 NodeSeek 标签页。
//
// 用法：
//   PowerShell:
//     $env:XNS_CDP_URL='http://127.0.0.1:9222'; npm run test:live
//   需要触发一次预览入口时：
//     $env:XNS_LIVE_INTERACTION='1'; npm run test:live

import puppeteer from 'puppeteer-core';

const cdpUrl = process.env.XNS_CDP_URL || process.env.PUPPETEER_WS_ENDPOINT;
const targetOrigin = (process.env.XNS_LIVE_URL || 'https://www.nodeseek.com/').replace(/\/$/, '');
const interactive = process.argv.includes('--interactive') || process.env.XNS_LIVE_INTERACTION === '1';

function fail(message) {
  console.error(`真实环境基线失败：${message}`);
  process.exitCode = 1;
}

if (!cdpUrl) {
  fail('未提供 XNS_CDP_URL。请将它设置为已打开 NodeSeek 且已加载油猴脚本的 Chrome CDP 地址。');
} else {
  let browser;
  try {
    const connectOptions = cdpUrl.startsWith('ws:') || cdpUrl.startsWith('wss:')
      ? { browserWSEndpoint: cdpUrl }
      : { browserURL: cdpUrl };
    browser = await puppeteer.connect(connectOptions);
    const pages = await browser.pages();
    const candidates = pages.filter((candidate) => candidate.url().startsWith(targetOrigin));
    let page = null;
    for (const candidate of candidates) {
      try {
        if (await candidate.evaluate(() => Boolean(document.querySelector('#xns-style')))) {
          page = candidate;
          break;
        }
      } catch {
        // 页面可能正在导航；继续检查其他已打开的 NodeSeek 标签页。
      }
    }
    page ||= candidates[0];
    if (!page) {
      throw new Error(`没有找到已打开的 NodeSeek 标签页：${targetOrigin}`);
    }

    const diagnostics = { pageErrors: [], consoleIssues: [], requestFailures: [], badResponses: [] };
    page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        diagnostics.consoleIssues.push({ type: message.type(), text: message.text() });
      }
    });
    page.on('requestfailed', (request) => diagnostics.requestFailures.push({
      method: request.method(),
      url: request.url(),
      error: request.failure()?.errorText || null,
    }));
    page.on('response', (response) => {
      if (response.status() >= 400) diagnostics.badResponses.push({ status: response.status(), url: response.url() });
    });

    const baseline = await page.evaluate(() => {
      const postLinks = [...document.querySelectorAll('a[href]')]
        .map((link) => link.getAttribute('href') || '')
        .filter((href) => /^\/post-\d+-\d+(?:#.*)?$/.test(href));
      const bodyText = document.body?.innerText || '';
      return {
        url: location.href,
        title: document.title,
        hasXnsStyle: !!document.querySelector('#xns-style'),
        postLinkCount: postLinks.length,
        firstPostHref: postLinks[0] || null,
        looksLikeChallenge: /just a moment|checking your browser|cf-chl-/i.test(bodyText),
        hasCommentContainer: !!document.querySelector('.comment-container'),
      };
    });

    console.log(JSON.stringify({
      mode: interactive ? 'interactive-read-only' : 'structural-read-only',
      selectedPage: page.url(),
      candidateCount: candidates.length,
      baseline,
    }, null, 2));
    if (baseline.looksLikeChallenge) throw new Error('页面仍停留在 Cloudflare/浏览器挑战页');
    if (!baseline.hasXnsStyle) throw new Error('未发现 #xns-style，当前 NodeSeek 标签页可能没有加载最新版用户脚本');

    if (interactive) {
      const beforeUrl = page.url();
      const existingModal = await page.$('.xns-modal');
      let openedByTest = false;
      if (!existingModal) {
        const postLink = await page.$('h3 a[href^="/post-"], .post-list a[href^="/post-"], a[href^="/post-"]');
        if (!postLink) throw new Error('没有找到可用于预览入口验证的帖子标题链接');
        await postLink.click();
        openedByTest = true;
        await page.waitForSelector('.xns-modal', { timeout: 15_000 });
      }
      const preview = await page.evaluate(() => ({
        url: location.href,
        title: document.querySelector('.xns-modal-title')?.textContent?.trim() || null,
        commentCount: document.querySelectorAll('.xns-modal .content-item').length,
        hasCloseButton: !!document.querySelector('.xns-modal-close'),
      }));
      console.log(JSON.stringify({ preview }, null, 2));
      if (preview.url !== beforeUrl) throw new Error(`预览入口改变了 URL：${preview.url}`);
      if (!preview.title || preview.commentCount < 1) throw new Error('预览弹窗没有形成有效的帖子内容');
      if (openedByTest && preview.hasCloseButton) await page.click('.xns-modal-close');
    }

    const issueCount = diagnostics.pageErrors.length
      + diagnostics.consoleIssues.length
      + diagnostics.requestFailures.length
      + diagnostics.badResponses.length;
    if (issueCount > 0) {
      throw new Error(`真实页面运行时诊断异常：${JSON.stringify(diagnostics)}`);
    }
    console.log('真实环境基线通过。');
  } catch (error) {
    fail(error.message);
  } finally {
    browser?.disconnect();
  }
}
