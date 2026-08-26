// ==UserScript==
// @name         星渊 NodeSeek 楼中楼与预览
// @namespace    https://www.nodeseek.com/
// @version      0.5.0
// @description  楼中楼、原版评论布局、ANSI 代码块和标签页渲染、代码块复制、更窄灰色边缘、帖子回复、图片灯箱和 V2Next 式预览刷新/滚动控制。
// @author       Codex
// @license      MIT
// @match        https://www.nodeseek.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const PREFIX = 'xns';
  const REQUEST_TIMEOUT = 8_000;
  const MAX_RESPONSE_BYTES = 2_000_000;
  const MAX_PAGE = 12;
  const PAGE_CONCURRENCY = 4;
  const STYLE_ID = `${PREFIX}-style`;
  const DEFAULT_MODE = 'thread';

  const SELECTORS = Object.freeze({
    commentContainer: '.comment-container',
    commentList: '.comment-container > ul.comments, .comment-container ul.comments',
    commentItem: '.content-item[id], li[id].content-item',
    postContent: 'article.post-content, .post-content',
    postTitle: 'h1.post-title, .post-title, h1',
  });

  const state = {
    post: null,
    modal: null,
    lightbox: null,
    mode: DEFAULT_MODE,
  };

  const pageInfo = getPostInfo(window.location.href);

  function safePositiveInt(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value);
    if (!/^\d{1,15}$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function getPostInfo(rawUrl) {
    try {
      const url = new URL(rawUrl, window.location.href);
      if (url.origin !== window.location.origin) return null;
      const match = /^\/post-(\d+)-(\d+)\/?$/.exec(url.pathname);
      if (!match) return null;
      const postId = safePositiveInt(match[1]);
      const page = safePositiveInt(match[2]);
      if (postId === null || page === null) return null;
      return { postId: String(postId), page };
    } catch {
      return null;
    }
  }

  function parseSameOriginUrl(rawUrl, base = window.location.href) {
    if (typeof rawUrl !== 'string' || rawUrl.length > 2_048) return null;
    try {
      const url = new URL(rawUrl, base);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (url.origin !== window.location.origin || url.username || url.password) return null;
      return url;
    } catch {
      return null;
    }
  }

  function isAllowedPostRequest(url) {
    const info = url instanceof URL ? getPostInfo(url.href) : null;
    return Boolean(info && !url.search && !url.username && !url.password);
  }

  function qs(root, selector) {
    return root?.querySelector(selector) || null;
  }

  function qsa(root, selector) {
    return root ? Array.from(root.querySelectorAll(selector)) : [];
  }

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (typeof text === 'string') element.textContent = text;
    return element;
  }

  function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function findCommentList(root = document) {
    return qs(root, SELECTORS.commentList);
  }

  function getCommentItems(root = document) {
    const list = findCommentList(root);
    if (!list) return [];
    return Array.from(list.children).filter((item) => item.matches?.(SELECTORS.commentItem));
  }

  function getFloor(item) {
    return safePositiveInt(item?.getAttribute('id') || '');
  }

  function getAuthorName(item) {
    const profile = qs(item, ':scope > .nsk-content-meta-info a.author-name, :scope > .nsk-content-meta-info a[href^="/space/"], :scope > .nsk-content-meta-info a[href*="/space/"]');
    const profileName = profile?.textContent?.trim();
    if (profileName) return profileName.slice(0, 80);
    const avatarAlt = qs(item, ':scope > .nsk-content-meta-info img[alt]')?.getAttribute('alt')?.trim();
    return avatarAlt ? avatarAlt.slice(0, 80) : '该用户';
  }

  function getPostContent(item) {
    return qs(item, ':scope > article.post-content, :scope > .post-content') || qs(item, SELECTORS.postContent);
  }

  function getSafeUrlAttribute(name, rawValue) {
    if (typeof rawValue !== 'string' || rawValue.length > 4_096) return null;
    if (name === 'src' && rawValue.startsWith('data:image/')) {
      return rawValue.length <= 262_144 ? rawValue : null;
    }
    try {
      const url = new URL(rawValue, window.location.href);
      if (name === 'href') return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function sanitizeImportedNode(sourceNode, options = {}) {
    if (!sourceNode) return null;
    const imported = document.importNode(sourceNode, true);
    const dangerous = 'script,style,link,meta,base,iframe,object,embed,form,input,textarea,select,option,button';
    qsa(imported, dangerous).forEach((node) => node.remove());
    if (imported.matches?.(dangerous)) imported.remove();

    // 跨页帖子评论默认是只读克隆；预览弹窗会显式接管菜单点击。
    if (!options.keepCommentMenu) qsa(imported, '.comment-menu, .comment-actions').forEach((node) => node.remove());
    qsa(imported, '[id]').forEach((node) => node.removeAttribute('id'));
    // NodeSeek 的评论头部有一个灰色楼层按钮；预览已有自己的来源链接，移除这个无效控件。
    qsa(imported, '.nsk-content-meta-info .floor-link, .nsk-content-meta-info [class*="floor-link"]').forEach((node) => node.remove());
    qsa(imported, '.nsk-content-meta-info a, .nsk-content-meta-info span').forEach((node) => {
      if (/^#\d+$/.test((node.textContent || '').trim())) node.remove();
    });

    const all = [imported, ...qsa(imported, '*')].filter((node) => node.nodeType === Node.ELEMENT_NODE);
    all.forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || ['style', 'srcdoc', 'srcset', 'formaction', 'contenteditable'].includes(name)) {
          node.removeAttribute(attribute.name);
          return;
        }
        if (['href', 'src', 'poster'].includes(name)) {
          const safeValue = getSafeUrlAttribute(name === 'poster' ? 'src' : name, attribute.value);
          if (!safeValue) node.removeAttribute(attribute.name);
          else node.setAttribute(attribute.name, safeValue);
        }
      });
      if (node.localName === 'a' && node.hasAttribute('href')) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
      if (node.localName === 'img') {
        node.setAttribute('loading', 'lazy');
        node.setAttribute('decoding', 'async');
        // 部分图片站会把不带来源的请求判定为直链访问，改为带站点来源的嵌入请求。
        node.setAttribute('referrerpolicy', 'origin');
      }
    });
    return imported;
  }

  function extractReplyMetadata(item, postId) {
    const content = getPostContent(item);
    const firstParagraph = content?.querySelector(':scope > p:first-child');
    const firstText = firstParagraph?.textContent?.trim() || '';
    const match = /^@([^\s]+)\s+#([1-9]\d*)/.exec(firstText);
    if (!match) return null;

    const targetFloor = safePositiveInt(match[2]);
    if (targetFloor === null) return null;
    const floorLink = qsa(firstParagraph, 'a').find((link) => /^#\d+$/.test((link.textContent || '').trim()));
    if (floorLink) {
      const linkedUrl = parseSameOriginUrl(floorLink.getAttribute('href') || '');
      const linkedInfo = linkedUrl ? getPostInfo(linkedUrl.href) : null;
      if (linkedInfo && linkedInfo.postId !== String(postId)) return null;
    }
    return { targetFloor, targetUser: match[1].slice(0, 80) };
  }

  function isPinnedComment(item) {
    return Boolean(qs(item, '.nsk-content-meta-info .hot-badge, .nsk-content-meta-info .pined-comment-badge, .nsk-content-meta-info [title="置顶"], .nsk-content-meta-info [title*="HOT"], .nsk-content-meta-info [class*="hot"]'));
  }

  function getCommentRecord(item, postId, page, index, current, options = {}) {
    const floor = getFloor(item);
    if (floor === null) return null;
    const node = current ? item : sanitizeImportedNode(item, options);
    if (!node) return null;
    return {
      floor,
      page,
      index,
      current,
      pinned: isPinnedComment(item),
      author: getAuthorName(item),
      reply: extractReplyMetadata(item, postId),
      node,
      parent: null,
      children: [],
    };
  }

  function getPageNumbers(root, postId) {
    const pages = new Set();
    const baseUrl = typeof root?.baseURI === 'string' && /^https?:/.test(root.baseURI)
      ? root.baseURI
      : window.location.href;
    qsa(root, 'a[href]').forEach((link) => {
      const url = parseSameOriginUrl(link.getAttribute('href') || '', baseUrl);
      const info = url ? getPostInfo(url.href) : null;
      if (info?.postId === String(postId) && info.page <= MAX_PAGE) pages.add(info.page);
    });
    return pages;
  }

  async function fetchHtml(url, options = {}) {
    if (!isAllowedPostRequest(url)) throw new Error('只允许读取同一站点的帖子页面');
    const noStore = options.noStore === true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(url.href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: noStore ? 'no-store' : 'default',
        redirect: 'error',
        referrerPolicy: 'same-origin',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const responseUrl = parseSameOriginUrl(response.url);
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (!responseUrl || !isAllowedPostRequest(responseUrl) || !contentType.includes('text/html')) throw new Error('响应不是同站帖子页面');
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) throw new Error('响应过大');
      const html = await response.text();
      if (!html || html.length > MAX_RESPONSE_BYTES) throw new Error('响应过大或为空');
      return { html, url: responseUrl };
    } finally {
      window.clearTimeout(timer);
    }
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function installStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .xns-post-toolbar, .xns-post-toolbar * { box-sizing: border-box; }
      .xns-post-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin:10px 0; padding:7px; border:1px solid rgba(100,116,139,.25); border-radius:8px; background:rgba(148,163,184,.08); font:13px/1.3 system-ui,sans-serif; }
      .xns-post-toolbar button { padding:5px 10px; border:1px solid rgba(100,116,139,.28); border-radius:6px; color:inherit; background:transparent; cursor:pointer; font:inherit; }
      .xns-post-toolbar button:hover, .xns-post-toolbar button:focus-visible { border-color:#3b82f6; outline:none; }
      .xns-post-toolbar button[aria-pressed="true"] { color:#2563eb; border-color:#3b82f6; background:rgba(59,130,246,.1); }
      .xns-toolbar-status { margin-left:auto; color:#64748b; font-size:12px; }
      .xns-modal { position:relative; }
      .xns-preview-scroll-btns { position:absolute; top:50%; right:8px; bottom:auto; display:flex; flex-direction:column; gap:6px; z-index:3; transform:translateY(-50%); transition:opacity .3s ease; pointer-events:none; }
      .xns-scroll-btn { box-sizing:border-box !important; width:34px !important; min-width:34px !important; max-width:34px !important; height:34px !important; min-height:34px !important; max-height:34px !important; flex:0 0 34px; padding:0 !important; border:0; border-radius:50%; color:#fff; background:rgba(46,164,79,.8); display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,.2); opacity:.8; line-height:1; transition:all .2s ease; pointer-events:auto; }
      .xns-scroll-btn:hover, .xns-scroll-btn:focus-visible { background:rgba(46,164,79,1); opacity:1; transform:scale(1.05); outline:none; }
      .xns-scroll-btn svg { width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .xns-scroll-btn.hidden { opacity:0; pointer-events:none; }
      .xns-scroll-btn.xns-action-pending { opacity:.45; pointer-events:none; }
      @keyframes xns-spin { to { transform:rotate(360deg); } }
      .xns-refresh-post.xns-action-pending svg { animation:xns-spin .9s linear infinite; }
      .xns-loading, .xns-status { margin:10px 0; padding:7px 10px; border:1px solid rgba(100,116,139,.2); border-radius:7px; color:#64748b; background:rgba(148,163,184,.08); font:13px/1.4 system-ui,sans-serif; }
      .xns-comment-root[data-xns-floor], .xns-comment-child[data-xns-floor] { position:relative; }
      .xns-comment-child { margin-top:7px !important; margin-left:clamp(8px,2vw,28px) !important; padding-left:clamp(8px,1.5vw,18px) !important; border-left:2px solid rgba(59,130,246,.35); }
      .xns-reply-list { margin:6px 0 0 !important; padding:0 !important; list-style:none !important; }
      .xns-remote-note { display:flex; gap:6px; flex-wrap:wrap; margin:5px 0 0; color:#64748b; font-size:11px; }
      .xns-remote-note a { color:#2563eb; }
      .xns-floor-highlight { animation:xns-floor-highlight 1.8s ease both; }
      @keyframes xns-floor-highlight { 0%,100%{box-shadow:none} 20%{box-shadow:0 0 0 4px rgba(59,130,246,.3)} }
      .xns-overlay { position:fixed; z-index:2147483000; inset:0; display:flex; align-items:stretch; justify-content:center; padding:0 clamp(32px,5vw,110px); background:rgba(15,23,42,.55); }
      .xns-modal { display:flex; flex-direction:column; width:min(1040px,100%); height:100vh; max-height:100vh; overflow:hidden; border-radius:0; color:#1f2937; background:#fff; box-shadow:0 18px 55px rgba(15,23,42,.3); }
      .xns-modal-header { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid rgba(100,116,139,.2); }
      .xns-modal-title { flex:1; min-width:0; overflow:hidden; margin:0; font-size:17px; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-header a, .xns-modal-header .xns-modal-reply, .xns-modal-close { padding:5px 8px; border:1px solid rgba(100,116,139,.25); border-radius:6px; color:inherit; background:#f8fafc; cursor:pointer; text-decoration:none; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-header .xns-modal-reply:hover, .xns-modal-header .xns-modal-reply:focus-visible { border-color:#3b82f6; outline:none; }
      .xns-modal-close { font-size:18px; }
      .xns-modal-body { overflow:auto; padding:clamp(10px,2vw,18px); }
      .xns-modal-body img { max-width:100%; height:auto; }
      .xns-preview-content { font-size:14px; line-height:1.45; }
      .xns-preview-content pre { box-sizing:border-box; max-width:100%; overflow:auto; white-space:pre; }
      .xns-preview-content pre.xns-code-block { position:relative !important; padding-top:30px; font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; }
      .xns-preview-content pre.xns-code-block code { font:inherit; }
      .xns-preview-content .xns-code-copy-btn { position:absolute; top:8px; right:8px; z-index:2; padding:2px 8px; border:0; border-radius:3px; color:#fff; background:#4caf50; cursor:pointer; font:12px/1.2 system-ui,sans-serif; opacity:.85; }
      .xns-preview-content .xns-code-copy-btn:hover, .xns-preview-content .xns-code-copy-btn:focus-visible { opacity:1; outline:none; }
      .xns-preview-content .xns-code-copy-btn.xns-copy-failed { background:#dc2626; }
      .xns-preview-content .xns-ansi-fg-black { color:#111827; } .xns-preview-content .xns-ansi-fg-red { color:#dc2626; } .xns-preview-content .xns-ansi-fg-green { color:#16a34a; } .xns-preview-content .xns-ansi-fg-yellow { color:#ca8a04; } .xns-preview-content .xns-ansi-fg-blue { color:#2563eb; } .xns-preview-content .xns-ansi-fg-magenta { color:#c026d3; } .xns-preview-content .xns-ansi-fg-cyan { color:#0891b2; } .xns-preview-content .xns-ansi-fg-white { color:#f8fafc; }
      .xns-preview-content .xns-ansi-fg-bright-black { color:#6b7280; } .xns-preview-content .xns-ansi-fg-bright-red { color:#f87171; } .xns-preview-content .xns-ansi-fg-bright-green { color:#4ade80; } .xns-preview-content .xns-ansi-fg-bright-yellow { color:#fde047; } .xns-preview-content .xns-ansi-fg-bright-blue { color:#60a5fa; } .xns-preview-content .xns-ansi-fg-bright-magenta { color:#f0abfc; } .xns-preview-content .xns-ansi-fg-bright-cyan { color:#67e8f9; } .xns-preview-content .xns-ansi-fg-bright-white { color:#fff; }
      .xns-preview-content .xns-ansi-bg-black { background:#111827; } .xns-preview-content .xns-ansi-bg-red { background:#ef4444; } .xns-preview-content .xns-ansi-bg-green { background:#22c55e; } .xns-preview-content .xns-ansi-bg-yellow { background:#facc15; } .xns-preview-content .xns-ansi-bg-blue { background:#3b82f6; } .xns-preview-content .xns-ansi-bg-magenta { background:#d946ef; } .xns-preview-content .xns-ansi-bg-cyan { background:#06b6d4; } .xns-preview-content .xns-ansi-bg-white { background:#f8fafc; }
      .xns-preview-content .xns-ansi-bg-bright-black { background:#6b7280; } .xns-preview-content .xns-ansi-bg-bright-red { background:#f87171; } .xns-preview-content .xns-ansi-bg-bright-green { background:#4ade80; } .xns-preview-content .xns-ansi-bg-bright-yellow { background:#fde047; } .xns-preview-content .xns-ansi-bg-bright-blue { background:#60a5fa; } .xns-preview-content .xns-ansi-bg-bright-magenta { background:#f0abfc; } .xns-preview-content .xns-ansi-bg-bright-cyan { background:#67e8f9; } .xns-preview-content .xns-ansi-bg-bright-white { background:#fff; }
      .xns-preview-content .xns-ansi-bold { font-weight:700; } .xns-preview-content .xns-ansi-dim { opacity:.72; } .xns-preview-content .xns-ansi-italic { font-style:italic; } .xns-preview-content .xns-ansi-underline { text-decoration:underline; } .xns-preview-content .xns-ansi-strike { text-decoration:line-through; } .xns-preview-content .xns-ansi-hidden { visibility:hidden; } .xns-preview-content .xns-ansi-inverse { filter:invert(1); }
      .xns-preview-content .xns-markdown-tabs { margin:8px 0; overflow:hidden; border:1px solid rgba(100,116,139,.24); border-radius:7px; background:#f8fafc; }
      .xns-preview-content .xns-markdown-tabs-nav { display:flex; align-items:center; flex-wrap:wrap; gap:4px; padding:5px 6px; border-bottom:1px solid rgba(100,116,139,.2); background:rgba(148,163,184,.1); }
      .xns-preview-content .xns-markdown-tab { padding:5px 9px; border:1px solid transparent; border-radius:5px; color:#64748b; background:transparent; cursor:pointer; font:13px/1.25 system-ui,sans-serif; }
      .xns-preview-content .xns-markdown-tab:hover, .xns-preview-content .xns-markdown-tab:focus-visible { color:#2563eb; outline:none; }
      .xns-preview-content .xns-markdown-tab.is-active { border-color:rgba(59,130,246,.28); color:#1d4ed8; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.08); }
      .xns-preview-content .xns-markdown-tab-panel { display:none; padding:8px 10px; }
      .xns-preview-content .xns-markdown-tab-panel.is-active { display:block; }
      .xns-preview-content h1, .xns-preview-content h2, .xns-preview-content h3, .xns-preview-content p { line-height:1.45; }
      .xns-preview-content h1, .xns-preview-content h2, .xns-preview-content h3 { margin-top:0; }
      .xns-preview-content p { margin:3px 0 6px; }
      .xns-preview-post { margin:0 0 10px; padding:8px 10px; border:1px solid rgba(100,116,139,.2); border-radius:7px; background:#f8fafc; }
      .xns-preview-post h1, .xns-preview-post h1.post-title, .xns-preview-post .post-title { margin:0 0 4px; font-size:20px; line-height:1.3; }
      .xns-preview-post h2 { margin:5px 0 3px; font-size:17px; }
      .xns-preview-post .nsk-content-meta-info { display:flex; align-items:center; flex-wrap:wrap; gap:4px 9px; margin:0 0 4px; color:#64748b; font-size:12px; line-height:1.25; }
      .xns-preview-post .post-content, .xns-preview-post article.post-content { margin:0; line-height:1.5; }
      .xns-preview-post .post-content p, .xns-preview-post article.post-content p { margin:2px 0 5px; }
      .xns-preview-post .post-content > :first-child, .xns-preview-post article.post-content > :first-child { margin-top:0; }
      .xns-preview-post .post-content > :last-child, .xns-preview-post article.post-content > :last-child { margin-bottom:0; }
      .xns-preview-comments { margin-top:10px; padding-top:8px; border-top:1px solid rgba(100,116,139,.2); }
      .xns-preview-comments > h3 { margin:0 0 7px; font-size:15px; line-height:1.3; }
      .xns-preview-thread { margin:0; padding:0; list-style:none; }
      .xns-preview-thread > .content-item { margin:4px 0; padding:6px 8px; border:1px solid rgba(100,116,139,.2); border-radius:6px; background:#f8fafc; content-visibility:auto; contain-intrinsic-size:150px; }
      .xns-preview-thread .xns-comment-child { margin-top:3px !important; padding-left:8px !important; }
      .xns-preview-thread .nsk-content-meta-info { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; margin:0 0 2px; color:#64748b; font-size:12px; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .content-info, .xns-preview-content .nsk-content-meta-info .date-created { display:inline-flex; align-items:center; flex-wrap:wrap; gap:5px; margin:0 !important; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .date-created time { display:inline; white-space:nowrap; }
      .xns-preview-content .user-info-display { position:static !important; display:inline-flex !important; align-items:center; transform:none !important; margin:0 !important; padding:0 !important; }
      .xns-preview-thread .xns-remote-note { position:absolute; top:7px; right:9px; z-index:1; display:flex; justify-content:flex-end; max-width:52%; overflow:hidden; margin:0; white-space:nowrap; text-overflow:ellipsis; }
      .xns-preview-thread .xns-remote-note a { overflow:hidden; text-overflow:ellipsis; }
      .xns-preview-thread .post-content, .xns-preview-thread article.post-content { margin:0; line-height:1.45; }
      .xns-preview-thread .post-content p, .xns-preview-thread article.post-content p { margin:2px 0 4px; }
      .xns-preview-thread .post-content > :first-child, .xns-preview-thread article.post-content > :first-child { margin-top:0; }
      .xns-preview-thread .post-content > :last-child, .xns-preview-thread article.post-content > :last-child { margin-bottom:0; }
      .xns-preview-thread .comment-menu, .xns-preview-menu { display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-top:4px; color:#8b95a1; font:12px/1.2 system-ui,sans-serif; }
      .xns-preview-thread .comment-menu > .menu-item, .xns-preview-menu > .menu-item { display:inline-flex; align-items:center; gap:4px; padding:2px 0; border:0; color:inherit; background:transparent; cursor:pointer; text-decoration:none; }
      .xns-preview-thread .comment-menu > .menu-item:hover, .xns-preview-thread .comment-menu > .menu-item:focus-visible, .xns-preview-menu > .menu-item:hover, .xns-preview-menu > .menu-item:focus-visible { color:#2563eb; outline:none; }
      .xns-preview-thread .comment-menu > .menu-item.xns-action-pending, .xns-preview-menu > .menu-item.xns-action-pending { opacity:.55; pointer-events:none; }
      .xns-preview-thread .comment-menu > .menu-item.xns-action-failed, .xns-preview-menu > .menu-item.xns-action-failed { color:#b91c1c; }
      .xns-action-state { font-size:11px; }
      .xns-preview-composer { margin-top:10px; padding-top:8px; border-top:1px solid rgba(100,116,139,.2); }
      .xns-preview-composer-title { margin:0 0 6px; font-size:14px; }
      .xns-preview-composer textarea { display:block; box-sizing:border-box; width:100%; min-height:100px; resize:vertical; padding:8px; border:1px solid rgba(100,116,139,.35); border-radius:6px; color:inherit; background:transparent; font:14px/1.5 system-ui,sans-serif; }
      .xns-preview-composer-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px; }
      .xns-preview-composer button, .xns-preview-composer a { padding:5px 10px; border:1px solid rgba(100,116,139,.3); border-radius:6px; color:inherit; background:transparent; cursor:pointer; text-decoration:none; font:13px/1.2 system-ui,sans-serif; }
      .xns-preview-composer button:hover, .xns-preview-composer button:focus-visible, .xns-preview-composer a:hover, .xns-preview-composer a:focus-visible { border-color:#3b82f6; outline:none; }
      .xns-preview-composer-status { color:#64748b; font-size:12px; }
      .xns-image-error { display:block; margin-top:5px; color:#b91c1c; font:12px/1.4 system-ui,sans-serif; }
      .xns-preview-content img { cursor:zoom-in; }
      .xns-lightbox { position:fixed; z-index:2147483500; inset:0; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(2,6,23,.88); }
      .xns-lightbox-stage { position:relative; display:flex; align-items:center; justify-content:center; width:100%; height:100%; overflow:hidden; cursor:grab; }
      .xns-lightbox-stage.xns-dragging { cursor:grabbing; }
      .xns-lightbox-image { max-width:calc(100vw - 48px); max-height:calc(100vh - 48px); object-fit:contain; user-select:none; -webkit-user-drag:none; transform-origin:center; cursor:grab; }
      .xns-lightbox-stage.xns-dragging .xns-lightbox-image { cursor:grabbing; }
      .xns-lightbox-close, .xns-lightbox-open { position:absolute; z-index:1; padding:6px 10px; border:1px solid rgba(255,255,255,.35); border-radius:6px; color:#fff; background:rgba(15,23,42,.58); cursor:pointer; text-decoration:none; font:13px/1.2 system-ui,sans-serif; }
      .xns-lightbox-close { top:10px; right:10px; font-size:20px; line-height:1; }
      .xns-lightbox-open { left:10px; bottom:10px; }
      .xns-lightbox-close:hover, .xns-lightbox-open:hover, .xns-lightbox-close:focus-visible, .xns-lightbox-open:focus-visible { background:rgba(15,23,42,.9); outline:none; }
      @media (prefers-color-scheme: dark) {
        .xns-modal { color:#e5e7eb; background:#18202b; }
        .xns-modal-header a, .xns-modal-header .xns-modal-reply, .xns-modal-close, .xns-preview-post, .xns-preview-thread > .content-item { color:#e5e7eb; background:#111827; }
        .xns-preview-content pre.xns-code-block { color:#e5e7eb; background:#0b1220; }
        .xns-preview-content .xns-ansi-fg-black { color:#e5e7eb; } .xns-preview-content .xns-ansi-fg-white { color:#111827; }
        .xns-preview-content .xns-markdown-tabs { background:#111827; } .xns-preview-content .xns-markdown-tabs-nav { background:rgba(15,23,42,.65); } .xns-preview-content .xns-markdown-tab.is-active { color:#93c5fd; background:#18202b; }
        .xns-toolbar-status, .xns-loading, .xns-status, .xns-remote-note { color:#9ca3af; }
      }
      @media (max-width:800px) { .xns-preview-scroll-btns { right:6px; } .xns-scroll-btn { width:30px !important; min-width:30px !important; max-width:30px !important; height:30px !important; min-height:30px !important; max-height:30px !important; flex-basis:30px; } .xns-preview-thread .xns-remote-note { max-width:62%; } }
      @media (max-width:640px) { .xns-overlay { padding:0; } .xns-modal { width:100%; max-height:100vh; } .xns-modal-body { padding:9px; } .xns-preview-post { padding:7px 8px; } .xns-preview-post h1, .xns-preview-post h1.post-title, .xns-preview-post .post-title { font-size:18px; } .xns-preview-thread .xns-remote-note { top:5px; right:7px; max-width:70%; } .xns-preview-scroll-btns { right:5px; } .xns-scroll-btn { width:28px !important; min-width:28px !important; max-width:28px !important; height:28px !important; min-height:28px !important; max-height:28px !important; flex-basis:28px; } .xns-lightbox { padding:10px; } .xns-lightbox-image { max-width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .xns-toolbar-status { width:100%; margin-left:0; } }
    `;
    (document.head || document.documentElement || document.body)?.appendChild(style);
  }

  function removeBodyLock() {
    if (!state.modal) document.documentElement.style.removeProperty('overflow');
  }

  function createScrollArrow(points) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points);
    svg.appendChild(polyline);
    return svg;
  }

  function createRefreshArrow() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 11a8 8 0 1 1-2.34-5.66');
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '20 4 20 11 13 11');
    svg.append(path, polyline);
    return svg;
  }

  function installPreviewScrollButtons(dialog, body) {
    const group = createElement('div', 'xns-preview-scroll-btns');
    const refresh = createElement('button', 'xns-scroll-btn xns-refresh-post');
    refresh.type = 'button';
    refresh.title = '刷新帖子';
    refresh.setAttribute('aria-label', '刷新帖子');
    refresh.appendChild(createRefreshArrow());
    const top = createElement('button', 'xns-scroll-btn xns-to-top');
    top.type = 'button';
    top.title = '回到顶部';
    top.setAttribute('aria-label', '回到顶部');
    top.appendChild(createScrollArrow('18 15 12 9 6 15'));
    const bottom = createElement('button', 'xns-scroll-btn xns-to-bottom');
    bottom.type = 'button';
    bottom.title = '回到底部';
    bottom.setAttribute('aria-label', '回到底部');
    bottom.appendChild(createScrollArrow('6 9 12 15 18 9'));
    const scrollTo = (edge) => {
      const topPosition = edge === 'bottom' ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
      body.scrollTo({ top: topPosition, behavior: 'smooth' });
    };
    top.addEventListener('click', () => scrollTo('top'));
    bottom.addEventListener('click', () => scrollTo('bottom'));
    refresh.addEventListener('click', () => { void refreshPreviewModal(); });
    group.append(refresh, top, bottom);
    dialog.appendChild(group);

    const update = () => {
      const distanceFromBottom = body.scrollHeight - (body.scrollTop + body.clientHeight);
      top.classList.toggle('hidden', body.scrollTop <= 300);
      bottom.classList.toggle('hidden', distanceFromBottom <= 300);
    };
    const cleanup = () => {
      body.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      group.remove();
    };
    const mutationObserver = window.MutationObserver ? new MutationObserver(update) : null;
    const resizeObserver = window.ResizeObserver ? new ResizeObserver(update) : null;
    body.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    mutationObserver?.observe(body, { childList: true, subtree: true });
    resizeObserver?.observe(body);
    window.setTimeout(update, 0);
    update();
    return cleanup;
  }

  function closeModal() {
    closeImageLightbox();
    state.modal?.scrollCleanup?.();
    state.modal?.overlay?.remove();
    state.modal = null;
    removeBodyLock();
  }

  function createCloseButton(onClick) {
    const button = createElement('button', 'xns-modal-close', '×');
    button.type = 'button';
    button.setAttribute('aria-label', '关闭');
    button.addEventListener('click', onClick);
    return button;
  }

  function buildReplyTree(records) {
    const byFloor = new Map(records.map((record) => [record.floor, record]));
    records.forEach((record) => {
      record.parent = null;
      record.children = [];
    });
    records.forEach((record) => {
      const target = record.reply?.targetFloor ? byFloor.get(record.reply.targetFloor) : null;
      if (target && target !== record && !record.pinned) {
        record.parent = target;
        target.children.push(record);
      }
    });
    const order = (record) => record.page * 100_000 + record.index;
    records.forEach((record) => record.children.sort((a, b) => order(a) - order(b)));
    return records.filter((record) => !record.parent).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return order(a) - order(b);
    });
  }

  function getPreviewImageSource(image) {
    const link = image?.closest?.('a[href]');
    const candidates = [
      image?.currentSrc,
      image?.getAttribute?.('src'),
      image?.getAttribute?.('data-src'),
      image?.getAttribute?.('data-original'),
      link?.getAttribute?.('href'),
    ];
    for (const candidate of candidates) {
      const safe = getSafeUrlAttribute('src', candidate);
      if (safe) return safe;
    }
    return null;
  }

  function closeImageLightbox() {
    const lightbox = state.lightbox;
    if (!lightbox) return;
    lightbox.cleanup?.();
    lightbox.overlay?.remove();
    state.lightbox = null;
  }

  function openImageLightbox(image) {
    const source = getPreviewImageSource(image);
    if (!source) return;
    closeImageLightbox();

    const overlay = createElement('div', 'xns-lightbox');
    overlay.tabIndex = -1;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '图片预览');
    const stage = createElement('div', 'xns-lightbox-stage');
    const preview = document.createElement('img');
    preview.className = 'xns-lightbox-image';
    preview.src = source;
    preview.alt = image.getAttribute('alt') || '图片预览';
    preview.setAttribute('referrerpolicy', 'origin');
    preview.setAttribute('draggable', 'false');
    const close = createElement('button', 'xns-lightbox-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', '关闭图片预览');
    const original = createElement('a', 'xns-lightbox-open', '打开原图');
    original.href = source;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    stage.appendChild(preview);
    overlay.append(stage, close, original);

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let startOffsetX = 0;
    let startOffsetY = 0;
    const render = () => {
      preview.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
    };
    const onWheel = (event) => {
      event.preventDefault();
      scale = Math.min(4, Math.max(0.5, scale * (event.deltaY < 0 ? 1.12 : 0.89)));
      if (scale <= 1) {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
      }
      render();
    };
    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      dragging = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startOffsetX = offsetX;
      startOffsetY = offsetY;
      stage.classList.add('xns-dragging');
      stage.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      offsetX = startOffsetX + event.clientX - startX;
      offsetY = startOffsetY + event.clientY - startY;
      render();
    };
    const onPointerUp = (event) => {
      if (event.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      stage.classList.remove('xns-dragging');
      stage.releasePointerCapture?.(event.pointerId);
    };
    const cleanup = () => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('click', (event) => { if (event.target === stage) closeImageLightbox(); });
    preview.addEventListener('click', (event) => event.stopPropagation());
    close.addEventListener('click', closeImageLightbox);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeImageLightbox(); });
    document.body.appendChild(overlay);
    state.lightbox = { overlay, cleanup };
    render();
    overlay.focus();
  }

  function installPreviewImageFallback(root) {
    qsa(root, 'img').forEach((image) => {
      if (image.dataset.xnsImageBound === 'true') return;
      image.dataset.xnsImageBound = 'true';
      image.setAttribute('tabindex', '0');
      image.setAttribute('role', 'button');
      image.setAttribute('title', '点击放大图片');
      const open = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openImageLightbox(image);
      };
      image.addEventListener('click', open);
      image.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') open(event);
      });
      image.addEventListener('error', () => {
        if (image.nextElementSibling?.matches('.xns-image-error')) return;
        const message = createElement('span', 'xns-image-error', '图片加载失败：图片站拒绝了当前嵌入来源。仍可点击“打开原图”尝试查看。');
        image.insertAdjacentElement('afterend', message);
      }, { once: true });
    });
  }

  function fallbackCopyText(text) {
    const textarea = createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-10000px';
    textarea.style.left = '-10000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    textarea.remove();
    return copied;
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).catch(() => {
        if (!fallbackCopyText(text)) throw new Error('copy failed');
      });
    }
    return fallbackCopyText(text) ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  function installPreviewCodeBlocks(root) {
    qsa(root, '.xns-preview-content pre').forEach((pre) => {
      if (pre.dataset.xnsCodeBound === 'true') return;
      const code = qs(pre, ':scope > code') || qs(pre, 'code');
      if (!code) return;

      pre.dataset.xnsCodeBound = 'true';
      pre.classList.add('xns-code-block');
      const button = createElement('button', 'xns-code-copy-btn', '复制');
      button.type = 'button';
      button.setAttribute('aria-label', '复制代码');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = code.innerText ?? code.textContent ?? '';
        button.disabled = true;
        void copyText(text).then(() => {
          button.textContent = '已复制';
          button.classList.remove('xns-copy-failed');
        }).catch(() => {
          button.textContent = '复制失败';
          button.classList.add('xns-copy-failed');
        }).finally(() => {
          window.setTimeout(() => {
            if (!button.isConnected) return;
            button.disabled = false;
            button.textContent = '复制';
            button.classList.remove('xns-copy-failed');
          }, 2_000);
        });
      });
      pre.appendChild(button);
    });
  }

  function getDirectCommentMenu(comment) {
    return Array.from(comment?.children || []).find((child) => child.matches?.('.comment-menu, .comment-actions')) || null;
  }

  function getMenuActionKey(menuItem) {
    const values = [
      menuItem?.dataset?.action,
      menuItem?.dataset?.type,
      menuItem?.getAttribute?.('title'),
      menuItem?.getAttribute?.('aria-label'),
      menuItem?.textContent,
    ].filter(Boolean).join(' ').toLowerCase();
    if (/\b(like|upvote)\b|点赞/.test(values)) return 'like';
    if (/\b(chicken|freelike)\b|鸡腿|投喂/.test(values)) return 'chicken';
    if (/\b(dislike|downvote)\b|反对|踩/.test(values)) return 'dislike';
    if (/\b(favorite|favourite|collection)\b|收藏/.test(values)) return 'favorite';
    if (/\bquote\b|引用/.test(values)) return 'quote';
    if (/\breply\b|回复/.test(values)) return 'reply';
    return '';
  }

  function createPreviewMenu(includeFavorite = true) {
    const menu = createElement('div', 'comment-menu xns-preview-menu');
    const actions = [
      ['like', '点赞', '♡', true],
      ['chicken', '加鸡腿', '🍗', true],
      ['dislike', '反对', '♧', true],
      ['favorite', '收藏', '☆', true],
      ['quote', '引用', '❝', false],
      ['reply', '回复', '↩', false],
    ].filter(([key]) => includeFavorite || key !== 'favorite');
    actions.forEach(([key, label, icon, withCount]) => {
      const item = createElement('span', 'menu-item');
      item.dataset.xnsAction = key;
      item.title = label;
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      const iconNode = createElement('span', 'xns-action-icon', icon);
      iconNode.setAttribute('aria-hidden', 'true');
      item.appendChild(iconNode);
      if (withCount) item.appendChild(createElement('span', 'xns-action-count', '0'));
      item.appendChild(createElement('span', 'xns-action-label', label));
      menu.appendChild(item);
    });
    return menu;
  }

  function ensurePreviewMenu(comment, options = {}) {
    const includeFavorite = options.includeFavorite !== false;
    let menu = getDirectCommentMenu(comment);
    if (!menu) {
      menu = createPreviewMenu(includeFavorite);
      comment.appendChild(menu);
    } else {
      menu.classList.add('comment-menu', 'xns-preview-menu');
      if (!includeFavorite) qsa(menu, ':scope > .menu-item').filter((item) => getMenuActionKey(item) === 'favorite').forEach((item) => item.remove());
      const existingActions = new Set(qsa(menu, ':scope > .menu-item').map(getMenuActionKey).filter(Boolean));
      qsa(createPreviewMenu(includeFavorite), ':scope > .menu-item').forEach((item) => {
        const action = item.dataset.xnsAction;
        if (action && !existingActions.has(action)) menu.appendChild(item);
      });
    }
    qsa(menu, ':scope > .menu-item').forEach((item) => {
      const action = getMenuActionKey(item);
      if (action) {
        item.dataset.xnsAction = action;
        if (action === 'favorite' && /已收藏|取消收藏/.test(`${item.title} ${item.textContent}`)) item.dataset.xnsFavoriteState = 'added';
      }
      if (!item.hasAttribute('role')) item.setAttribute('role', 'button');
      if (!item.hasAttribute('tabindex')) item.tabIndex = 0;
    });
    return menu;
  }

  function getCommentId(comment) {
    const value = comment?.getAttribute('data-comment-id') || '';
    return safePositiveInt(value);
  }

  function getDisplayFloor(comment) {
    const raw = comment?.getAttribute('data-xns-floor') || comment?.getAttribute('id') || '';
    if (raw === '0') return 0;
    return getFloor(comment);
  }

  function getActionTargetId(comment) {
    const commentId = getCommentId(comment);
    if (commentId !== null) return commentId;
    if (comment?.getAttribute('data-xns-target-type') === 'post') {
      return safePositiveInt(comment.getAttribute('data-xns-post-id') || '') || safePositiveInt(state.modal?.postId || '');
    }
    return null;
  }

  function randomCsrfToken() {
    const bytes = new Uint8Array(16);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function postAction(path, payload, options = {}) {
    const endpoint = parseSameOriginUrl(path, state.modal?.url?.href || window.location.href);
    const allowed = new Set(['/aics/upvote', '/api/statistics/upvote', '/api/statistics/like', '/api/statistics/dislike', '/api/statistics/collection', '/api/content/new-comment']);
    if (!endpoint || !allowed.has(endpoint.pathname)) throw new Error('操作地址不是 NodeSeek 同源接口');

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(endpoint.href, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrer: state.modal?.url?.href || window.location.href,
        referrerPolicy: 'same-origin',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'csrf-token': randomCsrfToken(),
          ...(options.headers || {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* 某些接口成功时不返回 JSON。 */ }
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const explicitFailure = data && typeof data === 'object' && (
        data.success === false || data.ok === false || data.error === true ||
        (typeof data.status === 'string' && /fail|error|unauthor|denied/i.test(data.status)) ||
        (typeof data.code === 'string' && /fail|error|unauthor|denied/i.test(data.code))
      );
      if (!response.ok || explicitFailure || (!data && /text\/html|<html[\s>]|登录|禁止访问/i.test(`${contentType} ${text.slice(0, 500)}`))) {
        const message = data?.message || data?.msg || text.replace(/<[^>]+>/g, ' ').trim().slice(0, 120);
        throw new Error(message || `HTTP ${response.status}`);
      }
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function setActionState(menuItem, text, failed = false) {
    menuItem.classList.toggle('xns-action-failed', failed);
    let stateNode = qs(menuItem, ':scope > .xns-action-state');
    if (!stateNode) {
      stateNode = createElement('span', 'xns-action-state');
      menuItem.appendChild(stateNode);
    }
    stateNode.textContent = text;
  }

  function getMenuCountElement(menuItem) {
    return qsa(menuItem, ':scope > span').find((node) => /^\d+$/.test((node.textContent || '').trim())) || null;
  }

  function bumpMenuCount(menuItem, delta) {
    const count = getMenuCountElement(menuItem);
    if (!count) return;
    const value = Number(count.textContent || 0);
    count.textContent = String(Math.max(0, value + delta));
  }

  function getPreviewCommentText(comment) {
    const content = getPostContent(comment);
    if (!content) return '';
    const copy = content.cloneNode(true);
    qsa(copy, '.xns-remote-note').forEach((node) => node.remove());
    return (copy.innerText || copy.textContent || '').trim().slice(0, 12_000);
  }

  function getPreviewSourceUrl(comment) {
    const modalInfo = state.modal?.postId ? { postId: state.modal.postId, page: 1 } : null;
    if (!modalInfo) return state.modal?.url?.href || window.location.href;
    const page = safePositiveInt(comment?.getAttribute('data-xns-source-page')) || modalInfo.page;
    const floor = getDisplayFloor(comment);
    const url = new URL(`/post-${modalInfo.postId}-${page}`, window.location.origin);
    if (floor !== null) url.hash = String(floor);
    return url.href;
  }

  function openPreviewComposer(action, comment) {
    const modal = state.modal;
    if (!modal?.body) return;
    modal.composer?.remove();

    const isPostReply = !comment || action === 'post-reply';
    const floor = isPostReply ? null : getDisplayFloor(comment);
    const author = isPostReply ? '' : getAuthorName(comment);
    const isReply = action === 'reply' && !isPostReply;
    const composer = createElement('section', 'xns-preview-composer');
    const floorLabel = floor === null ? '' : floor;
    const composerTitle = isPostReply ? '回复帖子' : `${isReply ? '回复' : '引用'} #${floorLabel} · ${author}`;
    composer.appendChild(createElement('h3', 'xns-preview-composer-title', composerTitle));
    const textarea = document.createElement('textarea');
    textarea.setAttribute('aria-label', isPostReply || isReply ? '回复内容' : '引用内容');
    const sourceUrl = isPostReply ? (modal.url?.href || window.location.href) : getPreviewSourceUrl(comment);
    if (isPostReply) {
      textarea.placeholder = '输入对帖子的回复内容…';
      textarea.value = '';
    } else {
      const replyToken = `@${author} [#${floorLabel}](${sourceUrl})`;
      const quoted = getPreviewCommentText(comment).split(/\r?\n/).slice(0, 80).map((line) => `> ${line}`).join('\n');
      textarea.value = isReply ? `${replyToken} ` : `> ${replyToken}\n${quoted}\n\n`;
    }
    composer.appendChild(textarea);

    const actions = createElement('div', 'xns-preview-composer-actions');
    const submit = createElement('button', '', '发送回复');
    submit.type = 'button';
    const original = createElement('a', '', '打开原帖回复');
    original.href = getPreviewSourceUrl(comment);
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const cancel = createElement('button', '', '取消');
    cancel.type = 'button';
    const status = createElement('span', 'xns-preview-composer-status');
    actions.append(submit, original, cancel, status);
    composer.appendChild(actions);
    modal.body.appendChild(composer);
    modal.composer = composer;
    textarea.focus();
    composer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    cancel.addEventListener('click', () => {
      composer.remove();
      if (modal.composer === composer) modal.composer = null;
    });
    submit.addEventListener('click', async () => {
      const content = textarea.value.trim();
      if (!content) {
        status.textContent = '请输入内容。';
        textarea.focus();
        return;
      }
      submit.disabled = true;
      status.textContent = '正在发送…';
      try {
        await postAction('/api/content/new-comment', {
          content,
          mode: 'new-comment',
          postId: Number(modal.postId),
        });
        status.textContent = '回复已发送。';
        textarea.readOnly = true;
        submit.remove();
      } catch (error) {
        status.textContent = `发送失败：${error.message || '网络错误'}`;
        submit.disabled = false;
      }
    });
  }

  async function runPreviewAction(action, menuItem, comment) {
    if (action === 'quote' || action === 'reply') {
      openPreviewComposer(action, comment);
      return;
    }

    const postId = safePositiveInt(state.modal?.postId || '');
    const targetId = getActionTargetId(comment);
    if ((action !== 'favorite' && targetId === null) || (action === 'favorite' && postId === null)) {
      setActionState(menuItem, action === 'favorite' ? '缺少帖子ID' : '缺少目标ID', true);
      return;
    }
    if (action !== 'favorite' && menuItem.dataset.xnsActionDone === 'true') {
      setActionState(menuItem, '已操作');
      return;
    }
    if (menuItem.classList.contains('xns-action-pending')) return;
    if (action === 'chicken' && !window.confirm('确认给这条评论加鸡腿？NodeSeek 可能会消耗鸡腿。')) return;
    if (action === 'dislike' && !window.confirm('确认反对这条评论？NodeSeek 可能会消耗两个鸡腿。')) return;

    const isFavoriteRemoval = action === 'favorite' && menuItem.dataset.xnsFavoriteState === 'added';
    menuItem.classList.add('xns-action-pending');
    menuItem.classList.remove('xns-action-failed');
    setActionState(menuItem, '处理中…');
    try {
      if (action === 'like') {
        try {
          await postAction('/aics/upvote', { commentId: targetId, action: 'add' });
        } catch {
          await postAction('/api/statistics/upvote', { commentId: targetId, action: 'add' });
        }
      } else if (action === 'chicken') {
        await postAction('/api/statistics/like', { commentId: targetId, action: 'add' });
      } else if (action === 'dislike') {
        await postAction('/api/statistics/dislike', { commentId: targetId, action: 'add' });
      } else if (action === 'favorite') {
        await postAction('/api/statistics/collection', { action: isFavoriteRemoval ? 'del' : 'add', postId });
      }
      if (action === 'favorite') {
        menuItem.dataset.xnsFavoriteState = isFavoriteRemoval ? 'removed' : 'added';
        bumpMenuCount(menuItem, isFavoriteRemoval ? -1 : 1);
      } else {
        menuItem.dataset.xnsActionDone = 'true';
        bumpMenuCount(menuItem, 1);
      }
      setActionState(menuItem, '✓');
      window.setTimeout(() => {
        if (menuItem.isConnected && !menuItem.classList.contains('xns-action-failed')) qs(menuItem, ':scope > .xns-action-state')?.remove();
      }, 1_800);
    } catch (error) {
      setActionState(menuItem, `失败：${error.message || '操作未完成'}`, true);
    } finally {
      menuItem.classList.remove('xns-action-pending');
    }
  }

  function collectPageRecords(info, root, page) {
    return getCommentItems(root).map((item, index) => getCommentRecord(item, info.postId, page, index, false, { keepCommentMenu: true })).filter(Boolean);
  }

  async function loadPreviewRecords(info, firstDocument, options = {}) {
    const noStore = options.noStore === true;
    const pageDocs = new Map([[info.page, firstDocument]]);
    const failedPages = [];
    const pages = new Set([info.page]);
    getPageNumbers(firstDocument, info.postId).forEach((page) => {
      if (page <= MAX_PAGE) pages.add(page);
    });
    const maxSeed = Math.min(MAX_PAGE, Math.max(...pages));
    for (let page = 1; page <= maxSeed; page += 1) pages.add(page);
    pages.delete(info.page);

    const pending = Array.from(pages).sort((a, b) => a - b);
    const worker = async () => {
      while (pending.length) {
        const page = pending.shift();
        if (page === undefined || pageDocs.has(page)) continue;
        const pageUrl = new URL(`/post-${info.postId}-${page}`, window.location.origin);
        try {
          const { html } = await fetchHtml(pageUrl, { noStore });
          const parsed = parseHtml(html);
          pageDocs.set(page, parsed);
          getPageNumbers(parsed, info.postId).forEach((foundPage) => {
            if (foundPage <= MAX_PAGE && !pages.has(foundPage) && foundPage !== info.page) {
              pages.add(foundPage);
              pending.push(foundPage);
            }
          });
        } catch {
          failedPages.push(page);
        }
      }
    };
    const workerCount = Math.min(PAGE_CONCURRENCY, Math.max(1, pending.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const allRecords = [];
    pageDocs.forEach((root, page) => {
      allRecords.push(...collectPageRecords(info, root, page));
    });
    const unique = new Map();
    allRecords.forEach((record) => {
      if (!unique.has(record.floor)) unique.set(record.floor, record);
    });
    return { records: Array.from(unique.values()), loadedPages: pageDocs.size, failedPages };
  }

  function preparePreviewRecord(record, depth) {
    stripRenderArtifacts(record.node);
    record.node.setAttribute('data-xns-floor', String(record.floor));
    record.node.setAttribute('data-xns-remote', 'true');
    record.node.setAttribute('data-xns-source-page', String(record.page));
    record.node.classList.add(depth === 0 ? 'xns-comment-root' : 'xns-comment-child');
    if (depth > 0 && record.parent) record.node.setAttribute('data-xns-parent-floor', String(record.parent.floor));
    ensurePreviewMenu(record.node, { includeFavorite: false });
  }

  function appendPreviewRecord(record, container, depth) {
    preparePreviewRecord(record, depth);
    container.appendChild(record.node);
    if (!record.children.length) return;
    const replyList = createElement('ul', 'xns-reply-list');
    record.children.forEach((child) => appendPreviewRecord(child, replyList, depth + 1));
    record.node.appendChild(replyList);
  }

  function buildPreviewPostNode(parsed, info) {
    const postRoot = qs(parsed, '.nsk-post');
    const source = postRoot?.matches?.('.content-item')
      ? postRoot
      : qs(postRoot, ':scope > .content-item, .content-item') || postRoot || qs(parsed, SELECTORS.postContent);
    let node = sanitizeImportedNode(source, { keepCommentMenu: true });
    if (!node) return null;
    if (node.matches?.('article.post-content')) {
      const wrapper = createElement('div', 'content-item');
      wrapper.appendChild(node);
      node = wrapper;
    }
    node.classList.add('content-item', 'xns-preview-post', 'xns-comment-root');
    node.setAttribute('data-xns-floor', '0');
    node.setAttribute('data-xns-target-type', 'post');
    node.setAttribute('data-xns-post-id', info.postId);
    ensurePreviewMenu(node, { includeFavorite: true });
    return node;
  }

  function renderPreviewRecords(section, info, records, options = {}) {
    const heading = qs(section, ':scope > h3');
    const thread = qs(section, ':scope > .xns-preview-thread');
    if (!heading || !thread) return;
    heading.textContent = `楼中楼预览 · ${records.length} 条回复`;
    clearElement(thread);
    qs(section, ':scope > .xns-preview-empty')?.remove();
    qsa(section, ':scope > .xns-page-loading, :scope > .xns-page-failed').forEach((node) => node.remove());
    if (records.length) {
      buildReplyTree(records).forEach((record) => appendPreviewRecord(record, thread, 0));
      records.forEach((record) => addRemoteNote(record, info.postId));
    } else {
      section.appendChild(createElement('p', 'xns-status xns-preview-empty', '没有读取到评论。'));
    }
    if (options.loading) {
      section.appendChild(createElement('p', 'xns-status xns-page-loading', '正在加载其他分页…'));
    }
    if (options.failedPages?.length) {
      section.appendChild(createElement('p', 'xns-status xns-page-failed', `已读取 ${options.loadedPages} 页，${options.failedPages.length} 页读取失败。`));
    }
  }

  function buildPreviewContent(url, parsed, options = {}) {
    const wrapper = createElement('div', 'xns-preview-content');
    const title = qs(parsed, SELECTORS.postTitle)?.textContent?.trim() || '';
    const info = getPostInfo(url.href);
    const importedPost = info ? buildPreviewPostNode(parsed, info) : null;
    if (importedPost) {
      wrapper.appendChild(importedPost);
    } else {
      const content = qs(parsed, SELECTORS.postContent);
      const importedContent = sanitizeImportedNode(content);
      if (importedContent) wrapper.appendChild(importedContent);
      else wrapper.appendChild(createElement('p', 'xns-status', '没有找到帖子正文。'));
    }
    if (!info) return { title, content: wrapper, hydrate: null };
    const currentRecords = collectPageRecords(info, parsed, info.page);
    const knownPages = getPageNumbers(parsed, info.postId);
    const hasRemotePages = Array.from(knownPages).some((page) => page !== info.page);
    const section = createElement('section', 'xns-preview-comments');
    section.appendChild(createElement('h3', '', '楼中楼预览'));
    const thread = createElement('ul', 'xns-preview-thread');
    section.appendChild(thread);
    renderPreviewRecords(section, info, currentRecords, { loading: hasRemotePages });
    wrapper.appendChild(section);
    const hydrate = loadPreviewRecords(info, parsed, { noStore: options.noStore === true }).then((preview) => {
      if (section.isConnected) renderPreviewRecords(section, info, preview.records, preview);
      return preview;
    });
    return { title, content: wrapper, hydrate };
  }

  function showPreviewLoadError(modal, error) {
    clearElement(modal.body);
    modal.body.appendChild(createElement('p', 'xns-status', `预览加载失败：${error?.message || '网络错误'}`));
    if (modal.fallbackLink) {
      const link = createElement('a', '', '在原页面打开');
      link.href = modal.fallbackLink.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      modal.body.appendChild(link);
    }
  }

  function showPreviewRefreshError(modal, error) {
    const previous = qs(modal.body, '.xns-refresh-status');
    previous?.remove();
    const status = createElement('p', 'xns-status xns-refresh-status', `刷新失败，保留当前内容：${error?.message || '网络错误'}`);
    status.classList.add('xns-refresh-failed');
    modal.body.prepend(status);
    window.setTimeout(() => {
      if (status.isConnected) status.remove();
    }, 4_000);
  }

  async function loadPreviewModal(modal, loadingText, options = {}) {
    if (!modal || modal.loading) return;
    const preserveContent = Boolean(options.preserveContent);
    const previousScrollTop = preserveContent ? modal.body.scrollTop : 0;
    modal.loading = true;
    const generation = (modal.loadGeneration || 0) + 1;
    modal.loadGeneration = generation;
    const refresh = qs(modal.dialog, '.xns-refresh-post');
    refresh?.classList.add('xns-action-pending');
    refresh?.setAttribute('aria-busy', 'true');
    closeImageLightbox();
    if (!preserveContent) {
      modal.body.scrollTop = 0;
      clearElement(modal.body);
      modal.body.appendChild(createElement('p', 'xns-loading', loadingText));
    }
    try {
      const { html } = await fetchHtml(modal.url, { noStore: preserveContent });
      const preview = buildPreviewContent(modal.url, parseHtml(html), { noStore: preserveContent });
      if (state.modal !== modal || modal.loadGeneration !== generation) return;
      modal.title.textContent = preview.title || 'NodeSeek 帖子预览';
      clearElement(modal.body);
      modal.body.appendChild(preview.content);
      installPreviewImageFallback(modal.body);
      installPreviewCodeBlocks(modal.body);
      if (preview.hydrate) await preview.hydrate;
      installPreviewCodeBlocks(modal.body);
      if (preserveContent && state.modal === modal && modal.loadGeneration === generation) {
        const maxScrollTop = Math.max(0, modal.body.scrollHeight - modal.body.clientHeight);
        modal.body.scrollTop = Math.min(previousScrollTop, maxScrollTop);
      }
    } catch (error) {
      if (state.modal === modal && modal.loadGeneration === generation) {
        if (preserveContent) showPreviewRefreshError(modal, error);
        else showPreviewLoadError(modal, error);
      }
    } finally {
      modal.loading = false;
      refresh?.classList.remove('xns-action-pending');
      refresh?.removeAttribute('aria-busy');
    }
  }

  function refreshPreviewModal() {
    const modal = state.modal;
    if (!modal || modal.loading) return;
    void loadPreviewModal(modal, '正在刷新帖子…', { preserveContent: true });
  }

  function openPreviewModal(url, fallbackLink) {
    closeModal();
    const overlay = createElement('div', 'xns-overlay');
    overlay.tabIndex = -1;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(); });

    const dialog = createElement('section', 'xns-modal');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const header = createElement('header', 'xns-modal-header');
    const title = createElement('h2', 'xns-modal-title', '正在加载帖子…');
    const replyPost = createElement('button', 'xns-modal-reply', '回复帖子');
    replyPost.type = 'button';
    replyPost.addEventListener('click', () => openPreviewComposer('post-reply', null));
    const original = createElement('a', '', '新标签打开');
    original.href = url.href;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const close = createCloseButton(closeModal);
    header.append(title, replyPost, original, close);

    const body = createElement('div', 'xns-modal-body');
    body.appendChild(createElement('p', 'xns-loading', '正在读取帖子内容…'));
    dialog.append(header, body);
    const scrollCleanup = installPreviewScrollButtons(dialog, body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    state.modal = { overlay, dialog, body, title, url, fallbackLink, postId: getPostInfo(url.href)?.postId || '', composer: null, scrollCleanup, loading: false, loadGeneration: 0 };
    overlay.focus();
    void loadPreviewModal(state.modal, '正在读取帖子内容…');
  }

  function scrollToFloor(floor) {
    const target = document.querySelector(`[data-xns-floor="${CSS.escape(String(floor))}"]`);
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('xns-floor-highlight');
    window.requestAnimationFrame(() => target.classList.add('xns-floor-highlight'));
    return true;
  }

  function handleFloorClick(event) {
    const link = event.target.closest?.('a[href]');
    if (!link || !link.closest(SELECTORS.commentContainer) || link.closest('.xns-remote-note')) return;
    const rawHref = link.getAttribute('href') || '';
    const directMatch = /^#([1-9]\d*)$/.exec(rawHref);
    const linkedUrl = directMatch ? null : parseSameOriginUrl(rawHref);
    const linkedInfo = linkedUrl ? getPostInfo(linkedUrl.href) : null;
    if (linkedInfo && pageInfo && linkedInfo.postId !== pageInfo.postId) return;
    const match = directMatch || (linkedUrl ? /^#([1-9]\d*)$/.exec(linkedUrl.hash || '') : null);
    if (!match) return;
    const floor = safePositiveInt(match[1]);
    if (floor === null || !scrollToFloor(floor)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleDocumentClick(event) {
    if (event.defaultPrevented) return;
    if (pageInfo) {
      handleFloorClick(event);
      return;
    }
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest?.('.xns-overlay')) return;

    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const url = parseSameOriginUrl(link.getAttribute('href') || '');
    if (!url || !getPostInfo(url.href)) return;

    // 仅拦截列表页普通左键；修饰键、中键、右键完全交给浏览器原生行为。
    event.preventDefault();
    event.stopImmediatePropagation();
    openPreviewModal(url, link);
  }

  function handlePreviewActionClick(event) {
    const menuItem = event.target.closest?.('.xns-overlay .xns-preview-content .comment-menu > .menu-item');
    if (!menuItem || !state.modal) return;
    const comment = menuItem.closest('.content-item');
    const action = menuItem.dataset.xnsAction || getMenuActionKey(menuItem);
    if (!comment || !action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void runPreviewAction(action, menuItem, comment);
  }

  function handleKeydown(event) {
    if (event.key !== 'Escape') return;
    if (state.lightbox) {
      event.preventDefault();
      closeImageLightbox();
    } else if (state.modal) {
      closeModal();
    }
  }

  function stripRenderArtifacts(item) {
    if (!item?.classList) return;
    qsa(item, '.xns-reply-list, .xns-remote-note').forEach((node) => node.remove());
    item.classList.remove('xns-comment-root', 'xns-comment-child', 'xns-floor-highlight');
    item.removeAttribute('data-xns-floor');
    item.removeAttribute('data-xns-parent-floor');
    item.removeAttribute('data-xns-remote');
    item.removeAttribute('data-xns-source-page');
  }

  function addRemoteNote(record, postId) {
    if (!record.node?.hasAttribute('data-xns-remote')) return;
    const content = getPostContent(record.node) || record.node;
    const note = createElement('div', 'xns-remote-note', `来自第 ${record.page} 页 · ${record.author}`);
    const source = createElement('a', '', `打开原楼层 #${record.floor}`);
    source.href = `/post-${postId}-${record.page}#${record.floor}`;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    note.appendChild(source);
    content.appendChild(note);
  }

  class PostEnhancer {
    constructor(info) {
      this.info = info;
      this.list = null;
      this.originalChildren = [];
      this.records = [];
      this.pageDocs = new Map();
      this.failedPages = [];
      this.toolbar = null;
      this.statusNode = null;
      this.loadingNode = null;
      this.generation = 0;
    }

    async init() {
      this.list = await this.waitForCommentList();
      if (!this.list) return;
      this.originalChildren = Array.from(this.list.childNodes);
      this.createToolbar();
      await this.reloadPages();
    }

    waitForCommentList() {
      return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
          const list = findCommentList();
          if (list || Date.now() - started > 12_000) resolve(list);
          else window.setTimeout(check, 80);
        };
        check();
      });
    }

    createToolbar() {
      if (this.toolbar || !this.list) return;
      const toolbar = createElement('nav', 'xns-post-toolbar');
      toolbar.setAttribute('aria-label', '评论布局');
      toolbar.appendChild(createElement('span', '', '评论布局：'));
      [['thread', '楼中楼'], ['original', '原版']].forEach(([mode, text]) => {
        const button = createElement('button', '', text);
        button.type = 'button';
        button.dataset.mode = mode;
        button.addEventListener('click', () => this.setMode(mode));
        toolbar.appendChild(button);
      });
      const status = createElement('span', 'xns-toolbar-status');
      toolbar.appendChild(status);
      this.list.closest(SELECTORS.commentContainer)?.insertAdjacentElement('beforebegin', toolbar);
      this.toolbar = toolbar;
      this.updateToolbar();
    }

    updateToolbar() {
      if (!this.toolbar) return;
      qsa(this.toolbar, '[data-mode]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.mode === state.mode));
      });
      const status = qs(this.toolbar, '.xns-toolbar-status');
      if (status) status.textContent = this.records.length ? `${this.records.length} 条评论` : '读取中…';
    }

    async reloadPages() {
      if (!this.list) return;
      const generation = ++this.generation;
      this.showLoading('正在读取评论分页…');
      try {
        await this.loadPages(generation);
        if (generation !== this.generation) return;
        this.render();
      } catch (error) {
        this.restoreOriginal();
        this.showStatus(`楼中楼读取失败：${error.message || '网络错误'}，已保留原版布局。`);
      } finally {
        if (generation === this.generation) {
          this.loadingNode?.remove();
          this.loadingNode = null;
          this.updateToolbar();
        }
      }
    }

    async loadPages(generation) {
      this.pageDocs.clear();
      this.failedPages = [];
      this.records = [];
      this.pageDocs.set(this.info.page, document);

      const pages = new Set([this.info.page]);
      getPageNumbers(document, this.info.postId).forEach((page) => {
        if (page <= MAX_PAGE) pages.add(page);
      });
      for (let page = 1; page <= Math.min(MAX_PAGE, Math.max(...pages)); page += 1) pages.add(page);
      pages.delete(this.info.page);

      const pending = Array.from(pages).sort((a, b) => a - b);
      const worker = async () => {
        while (pending.length) {
          if (generation !== this.generation) return;
          const page = pending.shift();
          if (page === undefined || this.pageDocs.has(page)) continue;
          const url = new URL(`/post-${this.info.postId}-${page}`, window.location.origin);
          try {
            const { html } = await fetchHtml(url);
            const parsed = parseHtml(html);
            this.pageDocs.set(page, parsed);
            getPageNumbers(parsed, this.info.postId).forEach((foundPage) => {
              if (foundPage <= MAX_PAGE && !pages.has(foundPage) && foundPage !== this.info.page) {
                pages.add(foundPage);
                pending.push(foundPage);
              }
            });
          } catch {
            this.failedPages.push(page);
          }
        }
      };
      await Promise.all([worker(), worker()]);

      const allRecords = [];
      this.pageDocs.forEach((root, page) => {
        getCommentItems(root).forEach((item, index) => {
          const record = getCommentRecord(item, this.info.postId, page, index, root === document);
          if (record) allRecords.push(record);
        });
      });
      const unique = new Map();
      allRecords.forEach((record) => {
        const previous = unique.get(record.floor);
        if (!previous || record.current) unique.set(record.floor, record);
      });
      this.records = Array.from(unique.values());
    }

    setMode(mode) {
      if (!['thread', 'original'].includes(mode)) return;
      state.mode = mode;
      this.updateToolbar();
      if (mode === 'original') this.restoreOriginal();
      else if (this.records.length) this.render();
      else this.reloadPages();
    }

    showLoading(text) {
      this.loadingNode?.remove();
      this.loadingNode = createElement('div', 'xns-loading', text);
      this.list?.closest(SELECTORS.commentContainer)?.insertAdjacentElement('beforebegin', this.loadingNode);
    }

    showStatus(text) {
      this.statusNode?.remove();
      this.statusNode = createElement('div', 'xns-status', text);
      this.list?.closest(SELECTORS.commentContainer)?.insertAdjacentElement('beforebegin', this.statusNode);
    }

    buildTree() {
      const byFloor = new Map(this.records.map((record) => [record.floor, record]));
      this.records.forEach((record) => {
        record.parent = null;
        record.children = [];
      });
      this.records.forEach((record) => {
        const target = record.reply?.targetFloor ? byFloor.get(record.reply.targetFloor) : null;
        if (target && target !== record && !record.pinned) {
          record.parent = target;
          target.children.push(record);
        }
      });
      const order = (record) => record.page * 100_000 + record.index;
      this.records.forEach((record) => record.children.sort((a, b) => order(a) - order(b)));
      return this.records.filter((record) => !record.parent).sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return order(a) - order(b);
      });
    }

    prepareRecord(record, depth) {
      stripRenderArtifacts(record.node);
      record.node.setAttribute('data-xns-floor', String(record.floor));
      record.node.classList.add(depth === 0 ? 'xns-comment-root' : 'xns-comment-child');
      if (!record.current) {
        record.node.setAttribute('data-xns-remote', 'true');
        record.node.setAttribute('data-xns-source-page', String(record.page));
      }
      if (depth > 0 && record.parent) record.node.setAttribute('data-xns-parent-floor', String(record.parent.floor));
    }

    appendRecord(record, container, depth) {
      this.prepareRecord(record, depth);
      container.appendChild(record.node);
      if (!record.children.length) return;
      const replyList = createElement('ul', 'xns-reply-list');
      record.children.forEach((child) => this.appendRecord(child, replyList, depth + 1));
      record.node.appendChild(replyList);
    }

    render() {
      if (!this.list || state.mode !== 'thread') return;
      this.restoreOriginal();
      this.buildTree().forEach((record) => this.appendRecord(record, this.list, 0));
      this.records.filter((record) => record.node.hasAttribute('data-xns-remote')).forEach((record) => addRemoteNote(record, this.info.postId));
      const loadedPages = this.pageDocs.size;
      const status = this.failedPages.length
        ? `楼中楼已整理：读取 ${loadedPages} 页，${this.failedPages.length} 页失败。`
        : `楼中楼已整理：共读取 ${loadedPages} 页。`;
      this.showStatus(status);
      this.updateToolbar();
    }

    restoreOriginal() {
      if (!this.list) return;
      qsa(this.list, '.xns-reply-list, .xns-remote-note').forEach((node) => node.remove());
      this.originalChildren.forEach(stripRenderArtifacts);
      while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
      this.originalChildren.forEach((node) => this.list.appendChild(node));
      this.statusNode?.remove();
      this.statusNode = null;
      this.updateToolbar();
    }
  }

  function start() {
    installStyle();
    document.addEventListener('click', handlePreviewActionClick, true);
    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('keydown', handleKeydown, true);

    const ready = () => {
      if (!pageInfo || state.post) return;
      state.post = new PostEnhancer(pageInfo);
      state.post.init().catch(() => state.post?.restoreOriginal());
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
  }

  start();
})();
