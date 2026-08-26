// ==UserScript==
// @name         星渊 NodeSeek 楼中楼与预览
// @namespace    https://www.nodeseek.com/
// @version      0.3.1
// @description  只保留楼中楼、原版评论布局和首页帖子预览。
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
    const profile = qs(item, ':scope > .nsk-content-meta-info a.author-name, :scope > .nsk-content-meta-info a[href^="/space/"]');
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

  function sanitizeImportedNode(sourceNode) {
    if (!sourceNode) return null;
    const imported = document.importNode(sourceNode, true);
    const dangerous = 'script,style,link,meta,base,iframe,object,embed,form,input,textarea,select,option,button';
    qsa(imported, dangerous).forEach((node) => node.remove());
    if (imported.matches?.(dangerous)) imported.remove();

    // 跨页评论是只读克隆，不能保留依赖当前 Vue 状态的原生菜单。
    qsa(imported, '.comment-menu, .comment-actions').forEach((node) => node.remove());
    qsa(imported, '[id]').forEach((node) => node.removeAttribute('id'));

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
        node.setAttribute('referrerpolicy', 'no-referrer');
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

  function getCommentRecord(item, postId, page, index, current) {
    const floor = getFloor(item);
    if (floor === null) return null;
    const node = current ? item : sanitizeImportedNode(item);
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

  async function fetchHtml(url) {
    if (!isAllowedPostRequest(url)) throw new Error('只允许读取同一站点的帖子页面');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    try {
      const response = await fetch(url.href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'force-cache',
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
      .xns-loading, .xns-status { margin:10px 0; padding:7px 10px; border:1px solid rgba(100,116,139,.2); border-radius:7px; color:#64748b; background:rgba(148,163,184,.08); font:13px/1.4 system-ui,sans-serif; }
      .xns-comment-root[data-xns-floor], .xns-comment-child[data-xns-floor] { position:relative; }
      .xns-comment-child { margin-top:7px !important; margin-left:clamp(8px,2vw,28px) !important; padding-left:clamp(8px,1.5vw,18px) !important; border-left:2px solid rgba(59,130,246,.35); }
      .xns-reply-list { margin:6px 0 0 !important; padding:0 !important; list-style:none !important; }
      .xns-remote-note { display:flex; gap:6px; flex-wrap:wrap; margin:5px 0 0; color:#64748b; font-size:11px; }
      .xns-remote-note a { color:#2563eb; }
      .xns-floor-highlight { animation:xns-floor-highlight 1.8s ease both; }
      @keyframes xns-floor-highlight { 0%,100%{box-shadow:none} 20%{box-shadow:0 0 0 4px rgba(59,130,246,.3)} }
      .xns-overlay { position:fixed; z-index:2147483000; inset:0; display:flex; align-items:center; justify-content:center; padding:18px; background:rgba(15,23,42,.55); }
      .xns-modal { display:flex; flex-direction:column; width:min(920px,100%); max-height:90vh; overflow:hidden; border-radius:10px; color:#1f2937; background:#fff; box-shadow:0 18px 55px rgba(15,23,42,.3); }
      .xns-modal-header { display:flex; align-items:center; gap:10px; padding:12px 14px; border-bottom:1px solid rgba(100,116,139,.2); }
      .xns-modal-title { flex:1; min-width:0; overflow:hidden; margin:0; font-size:17px; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-header a, .xns-modal-close { padding:5px 8px; border:1px solid rgba(100,116,139,.25); border-radius:6px; color:inherit; background:#f8fafc; cursor:pointer; text-decoration:none; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-close { font-size:18px; }
      .xns-modal-body { overflow:auto; padding:clamp(14px,3vw,26px); }
      .xns-modal-body img { max-width:100%; height:auto; }
      .xns-preview-comments { margin-top:20px; padding-top:12px; border-top:1px solid rgba(100,116,139,.2); }
      .xns-preview-thread { margin:0; padding:0; list-style:none; }
      .xns-preview-thread > .content-item { margin:8px 0; padding:8px 10px; border:1px solid rgba(100,116,139,.2); border-radius:7px; background:#f8fafc; }
      .xns-preview-thread .xns-comment-child { margin-top:7px !important; padding-left:12px !important; }
      @media (prefers-color-scheme: dark) {
        .xns-modal { color:#e5e7eb; background:#18202b; }
        .xns-modal-header a, .xns-modal-close, .xns-preview-thread > .content-item { color:#e5e7eb; background:#111827; }
        .xns-toolbar-status, .xns-loading, .xns-status, .xns-remote-note { color:#9ca3af; }
      }
      @media (max-width:640px) { .xns-overlay { padding:8px; } .xns-modal { max-height:94vh; } .xns-modal-body { padding:13px; } .xns-toolbar-status { width:100%; margin-left:0; } }
    `;
    (document.head || document.documentElement || document.body)?.appendChild(style);
  }

  function removeBodyLock() {
    if (!state.modal) document.documentElement.style.removeProperty('overflow');
  }

  function closeModal() {
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

  async function loadPreviewRecords(info, firstDocument) {
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
          const { html } = await fetchHtml(pageUrl);
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
    await Promise.all([worker(), worker()]);

    const allRecords = [];
    pageDocs.forEach((root, page) => {
      getCommentItems(root).forEach((item, index) => {
        const record = getCommentRecord(item, info.postId, page, index, false);
        if (record) allRecords.push(record);
      });
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
  }

  function appendPreviewRecord(record, container, depth) {
    preparePreviewRecord(record, depth);
    container.appendChild(record.node);
    if (!record.children.length) return;
    const replyList = createElement('ul', 'xns-reply-list');
    record.children.forEach((child) => appendPreviewRecord(child, replyList, depth + 1));
    record.node.appendChild(replyList);
  }

  async function buildPreviewContent(url, parsed) {
    const wrapper = createElement('div', 'xns-preview-content');
    const title = qs(parsed, SELECTORS.postTitle)?.textContent?.trim() || '';
    const content = qs(parsed, SELECTORS.postContent);
    const importedContent = sanitizeImportedNode(content);
    if (importedContent) wrapper.appendChild(importedContent);
    else wrapper.appendChild(createElement('p', 'xns-status', '没有找到帖子正文。'));

    const info = getPostInfo(url.href);
    if (!info) return { title, content: wrapper };
    const preview = await loadPreviewRecords(info, parsed);
    if (!preview.records.length) {
      wrapper.appendChild(createElement('p', 'xns-status', '没有读取到评论。'));
      return { title, content: wrapper };
    }

    const section = createElement('section', 'xns-preview-comments');
    section.appendChild(createElement('h3', '', `楼中楼预览 · ${preview.records.length} 条回复`));
    const thread = createElement('ul', 'xns-preview-thread');
    buildReplyTree(preview.records).forEach((record) => appendPreviewRecord(record, thread, 0));
    preview.records.forEach((record) => addRemoteNote(record, info.postId));
    section.appendChild(thread);
    if (preview.failedPages.length) {
      section.appendChild(createElement('p', 'xns-status', `已读取 ${preview.loadedPages} 页，${preview.failedPages.length} 页读取失败。`));
    }
    wrapper.appendChild(section);
    return { title, content: wrapper };
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
    const original = createElement('a', '', '新标签打开');
    original.href = url.href;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const close = createCloseButton(closeModal);
    header.append(title, original, close);

    const body = createElement('div', 'xns-modal-body');
    body.appendChild(createElement('p', 'xns-loading', '正在读取帖子内容…'));
    dialog.append(header, body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    state.modal = { overlay };
    overlay.focus();

    fetchHtml(url)
      .then(({ html }) => buildPreviewContent(url, parseHtml(html)))
      .then((preview) => {
        title.textContent = preview.title || 'NodeSeek 帖子预览';
        clearElement(body);
        body.appendChild(preview.content);
      })
      .catch((error) => {
        clearElement(body);
        body.appendChild(createElement('p', 'xns-status', `预览加载失败：${error.message || '网络错误'}`));
        if (fallbackLink) {
          const link = createElement('a', '', '在原页面打开');
          link.href = fallbackLink.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          body.appendChild(link);
        }
      });
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

  function handleKeydown(event) {
    if (event.key === 'Escape' && state.modal) closeModal();
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
