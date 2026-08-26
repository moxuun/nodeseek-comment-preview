// ==UserScript==
// @name         星渊 NodeSeek 增强
// @namespace    https://www.nodeseek.com/
// @version      0.1.0
// @description  为 NodeSeek 提供楼中楼、跨页评论、列表预览、图片灯箱和主题适配。
// @author       Codex
// @license      MIT
// @match        https://www.nodeseek.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NAME = '星渊 NodeSeek 增强';
  const VERSION = '0.1.0';
  const PREFIX = 'xns';
  const STORAGE_KEY = `${PREFIX}:settings:v1`;
  const STYLE_ID = `${PREFIX}-style`;
  const BOOT_STYLE_ID = `${PREFIX}-boot-style`;
  const BOOT_CLASS = `${PREFIX}-booting`;
  const MAX_PAGE = 12;
  const MAX_RESPONSE_BYTES = 2_000_000;
  const REQUEST_TIMEOUT = 8_000;
  const DEFAULT_VISIBLE_REPLIES = 3;

  const DEFAULT_SETTINGS = Object.freeze({
    nestedReplies: true,
    listModal: true,
    listExcerpt: true,
    imageLightbox: true,
    visibleReplies: DEFAULT_VISIBLE_REPLIES,
    maxPages: MAX_PAGE,
  });

  const SELECTORS = Object.freeze({
    commentContainer: '.comment-container',
    commentList: '.comment-container > ul.comments, .comment-container ul.comments',
    commentItem: '.content-item[id], li[id].content-item',
    postContent: 'article.post-content, .post-content',
    postTitle: 'h1.post-title, .post-title, h1',
    listPostLink: 'a[href*="/post-"]',
    listCard: '.post-item, .topic-item, .post-list-item, .content-item, li, tr',
  });

  const state = {
    settings: loadSettings(),
    post: null,
    modal: null,
    lightbox: null,
    settingsPanel: null,
    styleReady: false,
    globalReady: false,
    previewCache: new Map(),
    previewPending: new Map(),
    themeObserver: null,
  };

  const pageInfo = getPostInfo(window.location.href);

  function loadSettings() {
    const settings = { ...DEFAULT_SETTINGS };
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.nestedReplies === 'boolean') settings.nestedReplies = parsed.nestedReplies;
          if (typeof parsed.listModal === 'boolean') settings.listModal = parsed.listModal;
          if (typeof parsed.listExcerpt === 'boolean') settings.listExcerpt = parsed.listExcerpt;
          if (typeof parsed.imageLightbox === 'boolean') settings.imageLightbox = parsed.imageLightbox;
          settings.visibleReplies = clampInt(parsed.visibleReplies, 1, 10, DEFAULT_VISIBLE_REPLIES);
          settings.maxPages = clampInt(parsed.maxPages, 1, MAX_PAGE, MAX_PAGE);
        }
      }
    } catch {
      // 隐私模式或禁用存储时使用默认设置，不影响脚本运行。
    }
    return settings;
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
    } catch {
      // 存储不可用时只保持当前页面的设置。
    }
  }

  function clampInt(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function safePositiveInt(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const textValue = String(value);
    if (!/^\d{1,15}$/.test(textValue)) return null;
    const number = Number(textValue);
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
    return root ? root.querySelector(selector) : null;
  }

  function qsa(root, selector) {
    return root ? Array.from(root.querySelectorAll(selector)) : [];
  }

  function createElement(tagName, className, content) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (typeof content === 'string') element.textContent = content;
    return element;
  }

  function appendText(parent, content) {
    parent.appendChild(document.createTextNode(content));
  }

  function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function isElement(value) {
    return Boolean(value && value.nodeType === Node.ELEMENT_NODE);
  }

  function findCommentList(root = document) {
    return qs(root, SELECTORS.commentList);
  }

  function getCommentItems(root = document) {
    const list = findCommentList(root);
    if (!list) return [];
    return Array.from(list.children).filter((item) => isElement(item) && item.matches(SELECTORS.commentItem));
  }

  function getFloor(item) {
    return safePositiveInt(item?.getAttribute('id') || '');
  }

  function getAuthorName(item) {
    const profile = qs(item, ':scope > .nsk-content-meta-info a[href^="/space/"]');
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
      if (name === 'href') {
        return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
      }
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function sanitizeImportedNode(sourceNode, options = {}) {
    if (!sourceNode) return null;
    const imported = document.importNode(sourceNode, true);
    const dangerous = options.keepButtons
      ? 'script,style,link,meta,base,iframe,object,embed,form,input,textarea,select,option'
      : 'script,style,link,meta,base,iframe,object,embed,form,input,textarea,select,option,button';

    qsa(imported, dangerous).forEach((node) => node.remove());
    if (isElement(imported) && imported.matches(dangerous)) imported.remove();

    qsa(imported, '[id]').forEach((node) => node.removeAttribute('id'));
    const all = [imported, ...qsa(imported, '*')].filter(isElement);
    all.forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (
          name.startsWith('on')
          || ['style', 'srcdoc', 'srcset', 'formaction', 'contenteditable'].includes(name)
        ) {
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

  function insertStyle(cssText, id = STYLE_ID) {
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = cssText;
    (document.head || document.documentElement || document.body)?.appendChild(style);
    state.styleReady = id === STYLE_ID || state.styleReady;
  }

  const STYLE_TEXT = `
    :root {
      --xns-accent: #3b82f6;
      --xns-accent-strong: #2563eb;
      --xns-surface: #ffffff;
      --xns-surface-muted: #f5f7fb;
      --xns-text: #1f2937;
      --xns-text-muted: #64748b;
      --xns-border: rgba(100, 116, 139, .22);
      --xns-shadow: 0 18px 55px rgba(15, 23, 42, .22);
    }

    html[data-xns-theme="dark"] {
      --xns-accent: #60a5fa;
      --xns-accent-strong: #93c5fd;
      --xns-surface: #18202b;
      --xns-surface-muted: #111827;
      --xns-text: #e5e7eb;
      --xns-text-muted: #9ca3af;
      --xns-border: rgba(148, 163, 184, .25);
      --xns-shadow: 0 18px 55px rgba(0, 0, 0, .46);
    }

    html.${BOOT_CLASS} .comment-container { visibility: hidden !important; }

    .xns-ui,
    .xns-ui * { box-sizing: border-box; }

    .xns-floating-button {
      position: fixed;
      z-index: 2147483000;
      right: 18px;
      bottom: 18px;
      border: 1px solid var(--xns-border);
      border-radius: 999px;
      padding: 8px 14px;
      color: var(--xns-text);
      background: var(--xns-surface);
      box-shadow: 0 8px 24px rgba(15, 23, 42, .15);
      cursor: pointer;
      font: 600 13px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;
    }

    .xns-floating-button:hover,
    .xns-floating-button:focus-visible {
      border-color: var(--xns-accent);
      box-shadow: 0 10px 28px rgba(37, 99, 235, .24);
      transform: translateY(-1px);
      outline: none;
    }

    .xns-settings-panel {
      position: fixed;
      z-index: 2147483001;
      right: 18px;
      bottom: 62px;
      width: min(340px, calc(100vw - 28px));
      padding: 16px;
      border: 1px solid var(--xns-border);
      border-radius: 14px;
      color: var(--xns-text);
      background: var(--xns-surface);
      box-shadow: var(--xns-shadow);
      font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .xns-settings-panel[hidden] { display: none; }
    .xns-settings-title { margin: 0 0 4px; font-size: 16px; }
    .xns-settings-subtitle { margin: 0 0 12px; color: var(--xns-text-muted); font-size: 12px; }
    .xns-settings-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; }
    .xns-settings-row label { flex: 1; cursor: pointer; }
    .xns-settings-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--xns-accent); }
    .xns-settings-row select,
    .xns-settings-panel button { border: 1px solid var(--xns-border); border-radius: 8px; color: var(--xns-text); background: var(--xns-surface-muted); }
    .xns-settings-row select { padding: 5px 8px; }
    .xns-settings-footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--xns-border); }
    .xns-settings-footer button { padding: 6px 9px; cursor: pointer; }
    .xns-settings-footer button:hover { border-color: var(--xns-accent); }

    .xns-loading,
    .xns-status {
      margin: 10px 0;
      padding: 8px 12px;
      border: 1px solid var(--xns-border);
      border-radius: 8px;
      color: var(--xns-text-muted);
      background: var(--xns-surface-muted);
      font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .xns-comment-root[data-xns-floor],
    .xns-comment-child[data-xns-floor] { position: relative; }

    .xns-comment-child {
      margin-top: 8px !important;
      margin-left: clamp(8px, 2.2vw, 28px) !important;
      padding-left: clamp(8px, 1.5vw, 18px) !important;
      border-left: 2px solid color-mix(in srgb, var(--xns-accent) 35%, transparent);
    }

    .xns-reply-list {
      margin: 6px 0 0 !important;
      padding: 0 !important;
      list-style: none !important;
    }

    .xns-reply-hidden { display: none !important; }

    .xns-child-toggle {
      display: inline-flex;
      margin: 6px 0 0 clamp(8px, 2.2vw, 28px);
      padding: 4px 8px;
      border: 1px solid var(--xns-border);
      border-radius: 7px;
      color: var(--xns-accent-strong);
      background: var(--xns-surface-muted);
      cursor: pointer;
      font: 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .xns-child-toggle:hover,
    .xns-child-toggle:focus-visible { border-color: var(--xns-accent); outline: none; }

    .xns-remote-note {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 6px;
      margin: 6px 0 0;
      color: var(--xns-text-muted);
      font-size: 11px;
    }

    .xns-remote-note a,
    .xns-list-excerpt a { color: var(--xns-accent-strong); }

    .xns-floor-highlight { animation: xns-floor-highlight 1.8s ease both; }
    @keyframes xns-floor-highlight { 0%, 100% { box-shadow: none; } 20% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--xns-accent) 30%, transparent); } }

    .xns-list-excerpt {
      max-height: 78px;
      overflow: hidden;
      margin: 5px 0 2px;
      padding: 6px 9px;
      border-left: 3px solid color-mix(in srgb, var(--xns-accent) 60%, transparent);
      color: var(--xns-text-muted);
      background: var(--xns-surface-muted);
      border-radius: 0 7px 7px 0;
      font-size: 12px;
      line-height: 1.5;
    }

    .xns-overlay {
      position: fixed;
      z-index: 2147483002;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(15, 23, 42, .56);
      backdrop-filter: blur(3px);
    }

    .xns-modal {
      display: flex;
      flex-direction: column;
      width: min(920px, 100%);
      max-height: min(88vh, 960px);
      overflow: hidden;
      border: 1px solid var(--xns-border);
      border-radius: 15px;
      color: var(--xns-text);
      background: var(--xns-surface);
      box-shadow: var(--xns-shadow);
    }

    .xns-modal-header { display: flex; align-items: center; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--xns-border); }
    .xns-modal-title { flex: 1; min-width: 0; overflow: hidden; margin: 0; font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
    .xns-modal-header a,
    .xns-modal-close,
    .xns-lightbox-close,
    .xns-lightbox-control { border: 1px solid var(--xns-border); border-radius: 8px; color: var(--xns-text); background: var(--xns-surface-muted); cursor: pointer; }
    .xns-modal-header a { padding: 5px 8px; text-decoration: none; font-size: 12px; }
    .xns-modal-close { padding: 4px 9px; font-size: 18px; line-height: 1; }
    .xns-modal-body { overflow: auto; padding: clamp(14px, 3vw, 26px); }
    .xns-modal-body .xns-preview-content { max-width: 100%; overflow-wrap: anywhere; }
    .xns-modal-body .xns-preview-comments { margin-top: 22px; padding-top: 14px; border-top: 1px solid var(--xns-border); }
    .xns-modal-body .xns-preview-comment { margin: 8px 0; padding: 9px 11px; border: 1px solid var(--xns-border); border-radius: 9px; background: var(--xns-surface-muted); }
    .xns-modal-body img { max-width: 100%; height: auto; }

    .xns-lightbox-stage { position: relative; display: flex; align-items: center; justify-content: center; width: min(96vw, 1400px); height: min(88vh, 900px); overflow: hidden; }
    .xns-lightbox-image { max-width: 92vw; max-height: 82vh; user-select: none; cursor: grab; transform-origin: center; }
    .xns-lightbox-image.xns-dragging { cursor: grabbing; }
    .xns-lightbox-close { position: fixed; top: 18px; right: 18px; padding: 6px 11px; color: #fff; background: rgba(15, 23, 42, .75); font-size: 20px; }
    .xns-lightbox-toolbar { position: fixed; bottom: 18px; left: 50%; display: flex; align-items: center; gap: 8px; transform: translateX(-50%); color: #fff; font: 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .xns-lightbox-control { padding: 6px 9px; color: #fff; background: rgba(15, 23, 42, .75); }

    @media (max-width: 640px) {
      .xns-floating-button { right: 10px; bottom: 10px; padding: 7px 11px; }
      .xns-settings-panel { right: 10px; bottom: 52px; }
      .xns-overlay { padding: 8px; }
      .xns-modal { max-height: 94vh; border-radius: 11px; }
      .xns-modal-header { padding: 10px 11px; }
      .xns-modal-title { font-size: 15px; }
      .xns-modal-body { padding: 13px; }
    }
  `;

  function installThemeWatcher() {
    syncTheme();
    if (state.themeObserver || !document.documentElement) return;
    state.themeObserver = new MutationObserver(syncTheme);
    state.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-mode'] });
    if (document.body) state.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-mode'] });
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', syncTheme);
  }

  function syncTheme() {
    const html = document.documentElement;
    if (!html) return;
    const body = document.body;
    const siteDark = html.classList.contains('dark')
      || body?.classList.contains('dark')
      || html.dataset.theme === 'dark'
      || body?.dataset.theme === 'dark'
      || html.dataset.colorMode === 'dark';
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    html.dataset.xnsTheme = siteDark || prefersDark ? 'dark' : 'light';
  }

  function ensureGlobalUi() {
    if (state.globalReady || !document.body) return;
    state.globalReady = true;
    const ui = createElement('div', 'xns-ui');
    ui.id = `${PREFIX}-ui`;

    const button = createElement('button', 'xns-floating-button', '星渊');
    button.type = 'button';
    button.title = `${SCRIPT_NAME}设置`;
    button.setAttribute('aria-label', `${SCRIPT_NAME}设置`);

    const panel = createSettingsPanel();
    panel.hidden = true;
    button.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) panel.querySelector('input, select, button')?.focus();
    });

    ui.append(panel, button);
    document.body.appendChild(ui);
    state.settingsPanel = panel;
  }

  function createSettingsPanel() {
    const panel = createElement('section', 'xns-settings-panel');
    panel.setAttribute('aria-label', `${SCRIPT_NAME}设置`);

    const title = createElement('h2', 'xns-settings-title', SCRIPT_NAME);
    const subtitle = createElement('p', 'xns-settings-subtitle', `v${VERSION} · 只做展示增强，不自动执行账号操作`);
    panel.append(title, subtitle);

    const addCheckbox = (key, labelText) => {
      const row = createElement('div', 'xns-settings-row');
      const label = createElement('label', '', labelText);
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = Boolean(state.settings[key]);
      input.addEventListener('change', () => {
        state.settings[key] = input.checked;
        saveSettings();
        state.post?.refreshFromSettings();
        refreshListExcerptVisibility();
      });
      label.htmlFor = `${PREFIX}-${key}`;
      input.id = `${PREFIX}-${key}`;
      row.append(label, input);
      panel.appendChild(row);
    };

    addCheckbox('nestedReplies', '整理楼中楼');
    addCheckbox('listModal', '点击帖子标题打开弹窗');
    addCheckbox('listExcerpt', '列表中显示内容摘要');
    addCheckbox('imageLightbox', '点击图片放大');

    const visibleRow = createElement('div', 'xns-settings-row');
    const visibleLabel = createElement('label', '', '每组默认显示回复');
    const visibleSelect = document.createElement('select');
    visibleSelect.id = `${PREFIX}-visible-replies`;
    [1, 2, 3, 5, 8, 10].forEach((value) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value} 条`;
      option.selected = state.settings.visibleReplies === value;
      visibleSelect.appendChild(option);
    });
    visibleSelect.addEventListener('change', () => {
      state.settings.visibleReplies = clampInt(visibleSelect.value, 1, 10, DEFAULT_VISIBLE_REPLIES);
      saveSettings();
      state.post?.refreshFromSettings();
    });
    visibleRow.append(visibleLabel, visibleSelect);
    panel.appendChild(visibleRow);

    const pagesRow = createElement('div', 'xns-settings-row');
    const pagesLabel = createElement('label', '', '最多读取评论页数');
    const pagesSelect = document.createElement('select');
    pagesSelect.id = `${PREFIX}-max-pages`;
    [3, 6, 12].forEach((value) => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = `${value} 页`;
      option.selected = state.settings.maxPages === value;
      pagesSelect.appendChild(option);
    });
    pagesSelect.addEventListener('change', () => {
      state.settings.maxPages = clampInt(pagesSelect.value, 1, MAX_PAGE, MAX_PAGE);
      saveSettings();
      state.post?.reloadPages();
    });
    pagesRow.append(pagesLabel, pagesSelect);
    panel.appendChild(pagesRow);

    const footer = createElement('div', 'xns-settings-footer');
    const reset = createElement('button', '', '恢复默认');
    reset.type = 'button';
    reset.addEventListener('click', () => {
      state.settings = { ...DEFAULT_SETTINGS };
      saveSettings();
      panel.remove();
      state.settingsPanel = null;
      ensureGlobalUi();
      state.post?.refreshFromSettings();
      refreshListExcerptVisibility();
    });
    const close = createElement('button', '', '关闭');
    close.type = 'button';
    close.addEventListener('click', () => { panel.hidden = true; });
    footer.append(reset, close);
    panel.appendChild(footer);

    return panel;
  }

  function refreshListExcerptVisibility() {
    qsa(document, '.xns-list-excerpt').forEach((excerpt) => {
      excerpt.hidden = !state.settings.listExcerpt;
    });
  }

  function createOverlay(className) {
    const overlay = createElement('div', `xns-ui xns-overlay ${className || ''}`.trim());
    overlay.tabIndex = -1;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeOverlay(overlay);
    });
    return overlay;
  }

  function closeOverlay(overlay) {
    if (overlay?.isConnected) overlay.remove();
    if (state.modal?.overlay === overlay) state.modal = null;
    if (state.lightbox?.overlay === overlay) state.lightbox = null;
  }

  function makeCloseButton(label, onClick, className = 'xns-modal-close') {
    const button = createElement('button', className, label);
    button.type = 'button';
    button.setAttribute('aria-label', '关闭');
    button.addEventListener('click', onClick);
    return button;
  }

  async function fetchHtml(url, options = {}) {
    if (!isAllowedPostRequest(url)) throw new Error('只允许读取同一站点的帖子页面');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT);
    try {
      const response = await fetch(url.href, {
        method: 'GET',
        credentials: 'same-origin',
        cache: options.cache || 'force-cache',
        redirect: 'error',
        referrerPolicy: 'same-origin',
        headers: { Accept: 'text/html,application/xhtml+xml' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const responseUrl = parseSameOriginUrl(response.url);
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const contentLength = Number(response.headers.get('content-length') || 0);
      if (!responseUrl || !isAllowedPostRequest(responseUrl) || !contentType.includes('text/html')) {
        throw new Error('响应不是同站帖子页面');
      }
      if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
        throw new Error('响应过大');
      }
      const html = await response.text();
      if (!html || html.length > MAX_RESPONSE_BYTES) throw new Error('响应过大或为空');
      return { html, url: responseUrl };
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function parseHtml(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  function getPageNumbers(root, postId) {
    const result = new Set();
    qsa(root, 'a[href]').forEach((link) => {
      const url = parseSameOriginUrl(link.getAttribute('href') || '', root.baseURI || window.location.href);
      const info = url ? getPostInfo(url.href) : null;
      if (info?.postId === String(postId) && info.page <= MAX_PAGE) result.add(info.page);
    });
    return result;
  }

  function extractReplyMetadata(item, postId) {
    const content = getPostContent(item);
    const firstParagraph = content?.querySelector(':scope > p:first-child');
    const candidateAnchors = firstParagraph ? qsa(firstParagraph, 'a') : [];

    for (const floorAnchor of candidateAnchors) {
      const match = /^#([1-9]\d*)$/.exec((floorAnchor.textContent || '').trim());
      if (!match) continue;
      const targetFloor = safePositiveInt(match[1]);
      const targetUrl = parseSameOriginUrl(floorAnchor.getAttribute('href') || '', window.location.href);
      const previous = floorAnchor.previousElementSibling;
      const mentionText = previous?.textContent?.trim() || '';
      if (
        targetFloor !== null
        && targetUrl
        && getPostInfo(targetUrl.href)?.postId === String(postId)
        && targetUrl.hash === `#${targetFloor}`
        && mentionText.startsWith('@')
      ) {
        return {
          targetFloor,
          targetUser: mentionText.replace(/^@/, '').trim().slice(0, 80) || `楼层 ${targetFloor}`,
        };
      }
    }

    const firstText = firstParagraph?.textContent?.trim() || '';
    const textMatch = /^@([^\s]+)\s+#([1-9]\d*)/.exec(firstText);
    if (textMatch) {
      const targetFloor = safePositiveInt(textMatch[2]);
      if (targetFloor !== null) return { targetFloor, targetUser: textMatch[1].slice(0, 80) };
    }
    return null;
  }

  function isPinnedComment(item) {
    return Boolean(qs(item, ':scope > .nsk-content-meta-info .hot-badge, :scope > .nsk-content-meta-info .pined-comment-badge, :scope > .nsk-content-meta-info [title="置顶"]'));
  }

  function getCommentRecord(item, postId, page, index, current) {
    const floor = getFloor(item);
    if (floor === null) return null;
    const sourceNode = current ? item : sanitizeImportedNode(item);
    if (!sourceNode) return null;
    sourceNode.setAttribute('data-xns-floor', String(floor));
    if (!current) {
      sourceNode.setAttribute('data-xns-remote', 'true');
      sourceNode.setAttribute('data-xns-source-page', String(page));
    }
    return {
      floor,
      page,
      index,
      current,
      pinned: current && isPinnedComment(item),
      node: sourceNode,
      author: getAuthorName(item),
      reply: extractReplyMetadata(item, postId),
      children: [],
      parent: null,
    };
  }

  function addRemoteNote(record, postId) {
    if (!record.node || !record.node.hasAttribute('data-xns-remote')) return;
    const content = getPostContent(record.node) || record.node;
    const note = createElement('div', 'xns-remote-note');
    appendText(note, `来自第 ${record.page} 页 · ${record.author}`);
    const source = createElement('a', '', `打开原楼层 #${record.floor}`);
    source.href = `/post-${postId}-${record.page}#${record.floor}`;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    note.appendChild(source);
    content.appendChild(note);
  }

  function stripRenderArtifacts(item) {
    if (!isElement(item)) return;
    qsa(item, '.xns-reply-list, .xns-child-toggle, .xns-remote-note').forEach((node) => node.remove());
    item.classList.remove('xns-comment-root', 'xns-comment-child', 'xns-floor-highlight');
    item.removeAttribute('data-xns-floor');
    item.removeAttribute('data-xns-parent-floor');
    item.removeAttribute('data-xns-remote');
    item.removeAttribute('data-xns-source-page');
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
    const link = event.target.closest?.('a[href^="#"]');
    if (!link || !link.closest('.comment-container')) return;
    const match = /^#([1-9]\d*)$/.exec(link.getAttribute('href') || '');
    if (!match) return;
    const floor = safePositiveInt(match[1]);
    if (floor === null || !scrollToFloor(floor)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function removeBodyScrollLock() {
    if (!state.modal && !state.lightbox) document.documentElement.style.removeProperty('overflow');
  }

  function openPreviewModal(url, fallbackLink) {
    closeOverlay(state.modal?.overlay);
    const overlay = createOverlay('xns-preview-overlay');
    const dialog = createElement('section', 'xns-modal');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const header = createElement('header', 'xns-modal-header');
    const title = createElement('h2', 'xns-modal-title', '正在加载帖子…');
    const openLink = createElement('a', '', '新标签打开');
    openLink.href = url.href;
    openLink.target = '_blank';
    openLink.rel = 'noopener noreferrer';
    const close = makeCloseButton('×', () => closeOverlay(overlay));
    header.append(title, openLink, close);
    const body = createElement('div', 'xns-modal-body');
    body.appendChild(createElement('p', 'xns-loading', '正在读取当前帖子内容…'));
    dialog.append(header, body);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    state.modal = { overlay, url };
    overlay.focus();

    fetchHtml(url, { cache: 'no-store' })
      .then(({ html }) => {
        const parsed = parseHtml(html);
        const preview = buildPreviewContent(parsed);
        title.textContent = preview.title || 'NodeSeek 帖子预览';
        clearElement(body);
        body.appendChild(preview.content);
      })
      .catch((error) => {
        clearElement(body);
        const message = createElement('p', 'xns-status', `加载失败：${error.message || '网络错误'}`);
        body.appendChild(message);
        if (fallbackLink) {
          const link = createElement('a', '', '在原页面打开');
          link.href = fallbackLink.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          body.appendChild(link);
        }
      });
  }

  function buildPreviewContent(parsed) {
    const wrapper = createElement('div', 'xns-preview-content');
    const titleNode = qs(parsed, SELECTORS.postTitle);
    const title = titleNode?.textContent?.trim() || '';
    const contentNode = qs(parsed, SELECTORS.postContent);
    if (contentNode) {
      const imported = sanitizeImportedNode(contentNode);
      if (imported) wrapper.appendChild(imported);
    } else {
      wrapper.appendChild(createElement('p', 'xns-status', '没有找到帖子正文。'));
    }

    const comments = getCommentItems(parsed).slice(0, 5);
    if (comments.length) {
      const commentSection = createElement('section', 'xns-preview-comments');
      commentSection.appendChild(createElement('h3', '', `前 ${comments.length} 条回复`));
      comments.forEach((comment) => {
        const item = createElement('div', 'xns-preview-comment');
        const author = createElement('strong', '', getAuthorName(comment));
        const textNode = getPostContent(comment);
        item.append(author);
        if (textNode) {
          const imported = sanitizeImportedNode(textNode);
          if (imported) item.appendChild(imported);
        }
        commentSection.appendChild(item);
      });
      wrapper.appendChild(commentSection);
    }
    return { title, content: wrapper };
  }

  function getListCard(link) {
    const card = link.closest(SELECTORS.listCard);
    if (!card || card.closest('.comment-container')) return null;
    return card;
  }

  function getExcerptText(parsed) {
    const content = qs(parsed, SELECTORS.postContent);
    if (!content) return '';
    return (content.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  function installListExcerpt(link, card, url) {
    if (!state.settings.listExcerpt || card.dataset.xnsExcerptBound === 'true') return;
    card.dataset.xnsExcerptBound = 'true';
    let timer = null;
    const load = () => {
      if (!state.settings.listExcerpt || card.querySelector('.xns-list-excerpt')) return;
      const cached = state.previewCache.get(url.href);
      if (cached !== undefined) {
        appendExcerpt(card, cached);
        return;
      }
      if (state.previewPending.has(url.href)) {
        state.previewPending.get(url.href).then((text) => appendExcerpt(card, text));
        return;
      }
      const pending = fetchHtml(url)
        .then(({ html }) => getExcerptText(parseHtml(html)))
        .catch(() => '')
        .then((text) => {
          state.previewCache.set(url.href, text);
          state.previewPending.delete(url.href);
          return text;
        });
      state.previewPending.set(url.href, pending);
      pending.then((text) => appendExcerpt(card, text));
    };
    const onEnter = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 260);
    };
    const onLeave = () => window.clearTimeout(timer);
    link.addEventListener('pointerenter', onEnter, { passive: true });
    link.addEventListener('pointerleave', onLeave, { passive: true });
  }

  function appendExcerpt(card, text) {
    if (!text || !state.settings.listExcerpt || card.querySelector('.xns-list-excerpt')) return;
    const excerpt = createElement('div', 'xns-list-excerpt', text);
    excerpt.title = text;
    card.appendChild(excerpt);
  }

  function scanListFeatures() {
    if (pageInfo) return;
    qsa(document, SELECTORS.listPostLink).forEach((link) => {
      const url = parseSameOriginUrl(link.getAttribute('href') || '');
      if (!url || !getPostInfo(url.href)) return;
      const card = getListCard(link);
      if (card) installListExcerpt(link, card, url);
    });
  }

  function handleDocumentClick(event) {
    handleFloorClick(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.target.closest?.('.xns-ui, .xns-overlay')) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.closest('.comment-container')) return;
    const url = parseSameOriginUrl(link.getAttribute('href') || '');
    if (!url || !getPostInfo(url.href) || !state.settings.listModal || pageInfo) return;
    if (link.target && link.target !== '_self') return;
    event.preventDefault();
    event.stopPropagation();
    openPreviewModal(url, link);
  }

  function isLightboxImage(image) {
    if (!image || image.localName !== 'img') return false;
    if (!image.closest('.post-content, .comment-container, .xns-preview-content')) return false;
    return !image.matches('.avatar, .avatar-normal, .emoji, [aria-hidden="true"]');
  }

  function openLightbox(image) {
    const rawSrc = image.currentSrc || image.src || image.getAttribute('src');
    const src = getSafeUrlAttribute('src', rawSrc || '');
    if (!src) return;
    closeOverlay(state.lightbox?.overlay);
    const overlay = createOverlay('xns-lightbox-overlay');
    const stage = createElement('div', 'xns-lightbox-stage');
    const lightboxImage = document.createElement('img');
    lightboxImage.className = 'xns-lightbox-image';
    lightboxImage.src = src;
    lightboxImage.alt = image.alt || '放大图片';
    lightboxImage.draggable = false;
    const close = makeCloseButton('×', () => closeOverlay(overlay), 'xns-lightbox-close');
    const toolbar = createElement('div', 'xns-lightbox-toolbar');
    const zoomOut = createElement('button', 'xns-lightbox-control', '−');
    const zoomLabel = createElement('span', '', '100%');
    const zoomIn = createElement('button', 'xns-lightbox-control', '+');
    [zoomOut, zoomIn].forEach((button) => { button.type = 'button'; });
    toolbar.append(zoomOut, zoomLabel, zoomIn);
    stage.appendChild(lightboxImage);
    overlay.append(stage, close, toolbar);
    document.body.appendChild(overlay);
    document.documentElement.style.overflow = 'hidden';
    state.lightbox = { overlay, image: lightboxImage, scale: 1, x: 0, y: 0 };

    const update = () => {
      const current = state.lightbox;
      if (!current) return;
      current.image.style.transform = `translate(${current.x}px, ${current.y}px) scale(${current.scale})`;
      zoomLabel.textContent = `${Math.round(current.scale * 100)}%`;
    };
    const changeScale = (delta) => {
      if (!state.lightbox) return;
      state.lightbox.scale = Math.min(5, Math.max(.25, state.lightbox.scale + delta));
      update();
    };
    zoomOut.addEventListener('click', () => changeScale(-.25));
    zoomIn.addEventListener('click', () => changeScale(.25));
    stage.addEventListener('wheel', (event) => { event.preventDefault(); changeScale(event.deltaY < 0 ? .15 : -.15); }, { passive: false });

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;
    lightboxImage.addEventListener('pointerdown', (event) => {
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      originX = state.lightbox?.x || 0;
      originY = state.lightbox?.y || 0;
      lightboxImage.classList.add('xns-dragging');
      lightboxImage.setPointerCapture?.(event.pointerId);
    });
    lightboxImage.addEventListener('pointermove', (event) => {
      if (!dragging || !state.lightbox) return;
      state.lightbox.x = originX + event.clientX - startX;
      state.lightbox.y = originY + event.clientY - startY;
      update();
    });
    const stopDrag = () => { dragging = false; lightboxImage.classList.remove('xns-dragging'); };
    lightboxImage.addEventListener('pointerup', stopDrag);
    lightboxImage.addEventListener('pointercancel', stopDrag);
    overlay.focus();
  }

  function handleImageClick(event) {
    if (!state.settings.imageLightbox || event.defaultPrevented) return;
    const image = event.target.closest?.('img');
    if (!isLightboxImage(image) || event.target.closest('.xns-ui')) return;
    event.preventDefault();
    event.stopPropagation();
    openLightbox(image);
  }

  function handleEscape(event) {
    if (event.key !== 'Escape') return;
    if (state.lightbox) closeOverlay(state.lightbox.overlay);
    else if (state.modal) closeOverlay(state.modal.overlay);
    removeBodyScrollLock();
  }

  class PostEnhancer {
    constructor(info) {
      this.info = info;
      this.list = null;
      this.originalChildren = [];
      this.records = [];
      this.pageDocs = new Map();
      this.failedPages = [];
      this.loadingNode = null;
      this.statusNode = null;
      this.rendered = false;
      this.loadGeneration = 0;
    }

    async init() {
      const list = await this.waitForCommentList();
      if (!list) {
        revealPost();
        return;
      }
      this.list = list;
      this.originalChildren = Array.from(list.childNodes);
      if (!state.settings.nestedReplies) {
        revealPost();
        return;
      }
      await this.reloadPages();
    }

    waitForCommentList() {
      return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
          const list = findCommentList();
          if (list || Date.now() - started > 12_000) {
            resolve(list);
            return;
          }
          window.setTimeout(check, 80);
        };
        check();
      });
    }

    async reloadPages() {
      if (!this.list) return;
      const generation = ++this.loadGeneration;
      this.showLoading('正在整理楼中楼并读取其他分页…');
      try {
        await this.loadPages(generation);
        if (generation !== this.loadGeneration) return;
        this.render();
      } catch (error) {
        this.showStatus(`楼中楼整理失败：${error.message || '未知错误'}，已恢复原始布局。`, true);
        this.restoreOriginal();
      } finally {
        if (generation === this.loadGeneration) {
          this.removeLoading();
          revealPost();
        }
      }
    }

    async loadPages(generation) {
      this.pageDocs.clear();
      this.failedPages = [];
      this.records = [];
      this.pageDocs.set(this.info.page, document);

      const currentPages = getPageNumbers(document, this.info.postId);
      let maxSeed = this.info.page;
      currentPages.forEach((page) => { maxSeed = Math.max(maxSeed, page); });
      maxSeed = Math.min(Math.max(maxSeed, 1), state.settings.maxPages);

      const pages = new Set();
      for (let page = 1; page <= maxSeed; page += 1) pages.add(page);
      currentPages.forEach((page) => { if (page <= state.settings.maxPages) pages.add(page); });
      pages.delete(this.info.page);

      const pending = Array.from(pages).sort((a, b) => a - b);
      for (const page of pending) {
        if (generation !== this.loadGeneration) return;
        const url = new URL(`/post-${this.info.postId}-${page}`, window.location.origin);
        try {
          const { html } = await fetchHtml(url);
          const parsed = parseHtml(html);
          this.pageDocs.set(page, parsed);
          getPageNumbers(parsed, this.info.postId).forEach((foundPage) => {
            if (foundPage <= state.settings.maxPages && !pages.has(foundPage) && foundPage !== this.info.page) {
              pages.add(foundPage);
              pending.push(foundPage);
            }
          });
        } catch {
          this.failedPages.push(page);
        }
      }

      const records = [];
      this.pageDocs.forEach((root, page) => {
        getCommentItems(root).forEach((item, index) => {
          const record = getCommentRecord(item, this.info.postId, page, index, root === document);
          if (record) records.push(record);
        });
      });
      const unique = new Map();
      records.forEach((record) => {
        const previous = unique.get(record.floor);
        if (!previous || record.current) unique.set(record.floor, record);
      });
      this.records = Array.from(unique.values());
    }

    refreshFromSettings() {
      if (!this.list) return;
      if (state.settings.nestedReplies) this.render();
      else this.restoreOriginal();
      if (state.settings.nestedReplies) revealPost();
    }

    showLoading(message) {
      this.removeLoading();
      this.loadingNode = createElement('div', 'xns-loading', message);
      this.list?.closest('.comment-container')?.insertAdjacentElement('beforebegin', this.loadingNode);
    }

    removeLoading() {
      this.loadingNode?.remove();
      this.loadingNode = null;
    }

    showStatus(message, isError = false) {
      this.statusNode?.remove();
      this.statusNode = createElement('div', `xns-status${isError ? ' xns-status-error' : ''}`, message);
      this.list?.closest('.comment-container')?.insertAdjacentElement('beforebegin', this.statusNode);
    }

    buildTree() {
      const byFloor = new Map(this.records.map((record) => [record.floor, record]));
      this.records.forEach((record) => {
        record.parent = null;
        record.children = [];
        const target = record.reply?.targetFloor ? byFloor.get(record.reply.targetFloor) : null;
        if (target && target.floor !== record.floor) {
          record.parent = target;
          target.children.push(record);
        }
      });
      const orderValue = (record) => {
        if (record.current) return record.index;
        return 100_000 + record.page * 1_000 + record.index;
      };
      this.records.forEach((record) => record.children.sort((a, b) => orderValue(a) - orderValue(b)));
      return this.records
        .filter((record) => !record.parent)
        .sort((a, b) => {
          if (a.current && b.current) return a.index - b.index;
          if (a.current !== b.current) return a.current ? -1 : 1;
          return orderValue(a) - orderValue(b);
        });
    }

    render() {
      if (!this.list || !state.settings.nestedReplies) return;
      this.restoreOriginal();
      const roots = this.buildTree();
      roots.forEach((record) => this.appendRecord(record, this.list, 0));
      this.records.filter((record) => record.node.hasAttribute('data-xns-remote')).forEach((record) => addRemoteNote(record, this.info.postId));
      this.rendered = true;
      const loadedPages = this.pageDocs.size;
      const status = this.failedPages.length
        ? `楼中楼已整理：读取 ${loadedPages} 页，${this.failedPages.length} 页失败。`
        : `楼中楼已整理：共读取 ${loadedPages} 页。`;
      this.showStatus(status, this.failedPages.length > 0);
    }

    appendRecord(record, container, depth) {
      stripRenderArtifacts(record.node);
      record.node.setAttribute('data-xns-floor', String(record.floor));
      record.node.classList.add(depth === 0 ? 'xns-comment-root' : 'xns-comment-child');
      if (depth > 0 && record.parent) record.node.setAttribute('data-xns-parent-floor', String(record.parent.floor));
      container.appendChild(record.node);

      if (!record.children.length) return;
      const replyList = createElement('ul', 'xns-reply-list');
      const visible = state.settings.visibleReplies;
      record.children.forEach((child, index) => {
        if (index >= visible) child.node.classList.add('xns-reply-hidden');
        this.appendRecord(child, replyList, depth + 1);
      });
      record.node.appendChild(replyList);

      if (record.children.length > visible) {
        const toggle = createElement('button', 'xns-child-toggle', `展开其余 ${record.children.length - visible} 条回复`);
        toggle.type = 'button';
        toggle.dataset.expanded = 'false';
        toggle.addEventListener('click', () => {
          const expanded = toggle.dataset.expanded === 'true';
          toggle.dataset.expanded = expanded ? 'false' : 'true';
          qsa(replyList, ':scope > .xns-comment-child').forEach((child, index) => {
            if (index >= visible) child.classList.toggle('xns-reply-hidden', expanded);
          });
          toggle.textContent = expanded
            ? `展开其余 ${record.children.length - visible} 条回复`
            : '收起多余回复';
        });
        record.node.appendChild(toggle);
      }
    }

    restoreOriginal() {
      if (!this.list) return;
      qsa(this.list, '.xns-reply-list, .xns-child-toggle, .xns-remote-note').forEach((node) => node.remove());
      this.originalChildren.forEach(stripRenderArtifacts);
      while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
      this.originalChildren.forEach((node) => this.list.appendChild(node));
      this.rendered = false;
      this.statusNode?.remove();
      this.statusNode = null;
    }
  }

  function beginPostMask() {
    if (!pageInfo || !state.settings.nestedReplies || !document.documentElement) return;
    document.documentElement.classList.add(BOOT_CLASS);
    insertStyle(`html.${BOOT_CLASS} .comment-container { visibility: hidden !important; }`, BOOT_STYLE_ID);
  }

  function revealPost() {
    document.documentElement?.classList.remove(BOOT_CLASS);
    document.getElementById(BOOT_STYLE_ID)?.remove();
  }

  function start() {
    insertStyle(STYLE_TEXT);
    installThemeWatcher();
    document.addEventListener('click', handleDocumentClick, true);
    document.addEventListener('click', handleImageClick, true);
    document.addEventListener('keydown', handleEscape, true);

    const runWhenReady = () => {
      ensureGlobalUi();
      scanListFeatures();
      if (pageInfo && !state.post) {
        state.post = new PostEnhancer(pageInfo);
        state.post.init().catch(() => revealPost());
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runWhenReady, { once: true });
    } else {
      runWhenReady();
    }

    const observer = new MutationObserver(() => {
      ensureGlobalUi();
      scanListFeatures();
    });
    const observe = () => {
      if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    };
    if (document.body) observe();
    else document.addEventListener('DOMContentLoaded', observe, { once: true });
  }

  beginPostMask();
  start();
})();
