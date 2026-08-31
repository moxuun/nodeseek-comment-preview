// ==UserScript==
// @name         nodeseek楼中楼预览
// @namespace    https://www.nodeseek.com/
// @version      0.5.47
// @description  楼中楼、虚拟楼层流、原版评论布局、ANSI 代码块和标签页渲染、代码块复制、更窄灰色边缘、帖子回复、分页并发加载、图片灯箱和 V2Next 式预览刷新/滚动控制。
// @author       Codex
// @license      MIT
// @match        https://www.nodeseek.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

// 运行时常量与应用状态。这里不放业务逻辑，便于各功能模块明确依赖。
const PREFIX = 'xns';
const REQUEST_TIMEOUT = 8_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_PAGE = 50;
// NodeSeek 对连续分页请求有明显的限流；保留少量并发，避免长帖读取时成批 429。
const PAGE_CONCURRENCY = 2;
// 发生限流后，分页请求之间错开起始时间；正常情况下不人为降低吞吐。
const PAGE_REQUEST_GAP = 150;
const HTML_CACHE_TTL = 30_000;
const HTML_CACHE_MAX_ENTRIES = 16;
const HTML_CACHE_MAX_BYTES = 4_000_000;
const HTML_CACHE_ITEM_MAX_BYTES = 512_000;
const STYLE_ID = `${PREFIX}-style`;
const DEFAULT_MODE = 'thread';

const SELECTORS = Object.freeze({
  commentContainer: '.comment-container',
  commentList: '.comment-container > ul.comments, .comment-container ul.comments',
  commentItem: '.content-item[id], li[id].content-item',
  postContent: 'article.post-content, .post-content',
  postTitle: 'h1.post-title, .post-title, h1',
});

const ANSI_FG_HEX = ['#111827', '#dc2626', '#16a34a', '#ca8a04', '#2563eb', '#c026d3', '#0891b2', '#f8fafc'];
const ANSI_BG_HEX = ['#111827', '#ef4444', '#22c55e', '#facc15', '#3b82f6', '#d946ef', '#06b6d4', '#f8fafc'];
const ANSI_BRIGHT_HEX = ['#6b7280', '#f87171', '#4ade80', '#fde047', '#60a5fa', '#f0abfc', '#67e8f9', '#fff'];
const ANSI_COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

const state = {
  post: null,
  modal: null,
  settingsPanel: null,
  lightbox: null,
  mode: DEFAULT_MODE,
};


// 用户偏好存储；只保存界面设置，不保存帖子内容、登录信息或写操作数据。
function createPreferences({ windowObj, documentObj, state, storageKey, defaultMode, maxPage }) {
  const defaults = Object.freeze({
    mode: defaultMode,
    maxPages: maxPage,
    density: 'comfortable',
    prompts: true,
    theme: 'auto',
  });
  const promptKey = (name) => `${storageKey}:prompt:${name}`;
  let values = { ...defaults };
  let ownsDarkClass = false;

  function normalize(raw = {}) {
    const mode = raw.mode === 'original' ? 'original' : defaultMode;
    const requestedPages = Number(raw.maxPages);
    const maxPages = [10, 20, 30, maxPage].includes(requestedPages) ? requestedPages : maxPage;
    const density = raw.density === 'compact' ? 'compact' : 'comfortable';
    const theme = raw.theme === 'dark' ? 'dark' : 'auto';
    return { mode, maxPages, density, prompts: raw.prompts !== false, theme };
  }

  function read() {
    try {
      const raw = JSON.parse(windowObj.localStorage?.getItem(storageKey) || '{}');
      return normalize(raw);
    } catch {
      return { ...defaults };
    }
  }

  function apply() {
    const root = documentObj.documentElement;
    if (!root) return;
    root.classList.toggle('xns-density-compact', values.density === 'compact');
    if (values.theme === 'dark') {
      if (!root.classList.contains('dark-layout')) {
        root.classList.add('dark-layout');
        ownsDarkClass = true;
      }
    } else if (ownsDarkClass) {
      root.classList.remove('dark-layout');
      ownsDarkClass = false;
    }
  }

  function save() {
    try { windowObj.localStorage?.setItem(storageKey, JSON.stringify(values)); } catch { /* 存储被禁用时仍允许本次使用。 */ }
  }

  function update(patch = {}) {
    values = normalize({ ...values, ...patch });
    state.mode = values.mode;
    save();
    apply();
    return { ...values };
  }

  function hasSeenPrompt(name) {
    try { return windowObj.localStorage?.getItem(promptKey(name)) === '1'; } catch { return false; }
  }

  function markPromptSeen(name) {
    try { windowObj.localStorage?.setItem(promptKey(name), '1'); } catch { /* 存储被禁用时不阻断提示。 */ }
  }

  function reset() {
    const next = update(defaults);
    try { windowObj.localStorage?.removeItem(promptKey('preview-help')); } catch { /* ignore */ }
    return next;
  }

  values = read();
  state.mode = values.mode;
  apply();

  return Object.freeze({
    get: () => ({ ...values }),
    update,
    reset,
    getMaxPage: () => values.maxPages,
    apply,
    hasSeenPrompt,
    markPromptSeen,
  });
}

const xnsPreferences = createPreferences({
  windowObj: window,
  documentObj: document,
  state,
  storageKey: 'xns-comment-preview-settings',
  defaultMode: DEFAULT_MODE,
  maxPage: MAX_PAGE,
});
const getSettings = (...args) => xnsPreferences.get(...args);
const updateSettings = (...args) => xnsPreferences.update(...args);
const resetSettings = (...args) => xnsPreferences.reset(...args);
const getMaxPage = (...args) => xnsPreferences.getMaxPage(...args);
const applySettings = (...args) => xnsPreferences.apply(...args);
const hasSeenPrompt = (...args) => xnsPreferences.hasSeenPrompt(...args);
const markPromptSeen = (...args) => xnsPreferences.markPromptSeen(...args);


// 分页状态文案与语义统一；预览页和帖子页共享同一套用户可见反馈。
function createPageStatusFormatter({ maxPage, getMaxPage }) {
  function format(options = {}) {
    const configuredLimit = Number(options.pageLimit) || Number(getMaxPage?.()) || maxPage;
    const pageLimit = Math.min(maxPage, Math.max(1, configuredLimit));
    const totalPages = Number(options.totalPages) || 0;
    const loadedPages = Math.max(0, Number(options.loadedPages) || 0);
    const failedCount = Array.isArray(options.failedPages) ? options.failedPages.length : 0;
    const targetPages = Math.min(pageLimit, totalPages || loadedPages);
    const pageProgress = targetPages ? `已读取 ${loadedPages}/${targetPages} 页` : '';
    const stage = options.loading
      ? (pageProgress ? `正在读取其他分页 · ${pageProgress}` : '正在读取其他分页…')
      : pageProgress;
    const failed = failedCount ? `${failedCount} 页读取失败` : '';
    const challengeCount = Array.isArray(options.challengePages) ? options.challengePages.length : 0;
    const challenge = challengeCount ? `${challengeCount} 页被 Cloudflare 验证拦截，请完成验证后重试` : '';
    const truncated = options.truncated
      ? `帖子共 ${totalPages || pageLimit} 页，仅读取前 ${pageLimit} 页，后面的内容没有显示`
      : '';
    const detail = [stage, failed, challenge, truncated].filter(Boolean).join(' · ');
    const commentCount = Number.isFinite(options.commentCount) ? `${options.commentCount} 条回复` : '';
    const compact = [commentCount, failedCount ? `${failedCount} 页失败` : '', challengeCount ? `${challengeCount} 页需验证` : ''].filter(Boolean).join(' · ') || detail;
    return {
      targetPages,
      loadedPages,
      failedCount,
      stage,
      failed,
      challenge,
      challengeCount,
      truncated,
      detail,
      compact,
      tone: failedCount ? 'is-failed' : '',
    };
  }

  return Object.freeze({ format });
}

const xnsPageStatusFormatter = createPageStatusFormatter({ maxPage: MAX_PAGE, getMaxPage });
const formatPageStatus = (...args) => xnsPageStatusFormatter.format(...args);


// 通用 DOM 与输入安全工具；不包含 NodeSeek 业务规则。
function createDomTools({ documentObj, windowObj, selectors, URLCtor }) {
  function safePositiveInt(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value);
    if (!/^\d{1,15}$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function safeCount(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function qs(root, selector) { return root?.querySelector(selector) || null; }
  function qsa(root, selector) { return root ? Array.from(root.querySelectorAll(selector)) : []; }

  function createElement(tagName, className, text) {
    const element = documentObj.createElement(tagName);
    if (className) element.className = className;
    if (typeof text === 'string') element.textContent = text;
    return element;
  }

  function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function findCommentList(root = documentObj) { return qs(root, selectors.commentList); }

  function getCommentItems(root = documentObj) {
    const list = findCommentList(root);
    if (!list) return [];
    return Array.from(list.children).filter((item) => item.matches?.(selectors.commentItem));
  }

  function getFloor(item) { return safePositiveInt(item?.getAttribute('id') || ''); }

  function getCommentId(item) { return safePositiveInt(item?.getAttribute('data-comment-id') || ''); }

  function getAuthorName(item) {
    const profile = qs(item, ':scope > .nsk-content-meta-info a.author-name, :scope > .nsk-content-meta-info a[href^="/space/"], :scope > .nsk-content-meta-info a[href*="/space/"]');
    const profileName = profile?.textContent?.trim();
    if (profileName) return profileName.slice(0, 80);
    const avatarAlt = qs(item, ':scope > .nsk-content-meta-info img[alt]')?.getAttribute('alt')?.trim();
    return avatarAlt ? avatarAlt.slice(0, 80) : '该用户';
  }

  function getPostContent(item) {
    return qs(item, ':scope > article.post-content, :scope > .post-content') || qs(item, selectors.postContent);
  }

  function getSafeUrlAttribute(name, rawValue) {
    if (typeof rawValue !== 'string' || rawValue.length > 4_096) return null;
    if (name === 'src' && rawValue.startsWith('data:image/')) return rawValue.length <= 262_144 ? rawValue : null;
    try {
      const url = new URLCtor(rawValue, windowObj.location.href);
      if (name === 'href') return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch { return null; }
  }

  return Object.freeze({
    safePositiveInt,
    safeCount,
    qs,
    qsa,
    createElement,
    clearElement,
    findCommentList,
    getCommentItems,
    getFloor,
    getCommentId,
    getAuthorName,
    getPostContent,
    getSafeUrlAttribute,
  });
}

const xnsDomTools = createDomTools({
  documentObj: document,
  windowObj: window,
  selectors: SELECTORS,
  URLCtor: URL,
});
const safePositiveInt = (...args) => xnsDomTools.safePositiveInt(...args);
const safeCount = (...args) => xnsDomTools.safeCount(...args);
const qs = (...args) => xnsDomTools.qs(...args);
const qsa = (...args) => xnsDomTools.qsa(...args);
const createElement = (...args) => xnsDomTools.createElement(...args);
const clearElement = (...args) => xnsDomTools.clearElement(...args);
const findCommentList = (...args) => xnsDomTools.findCommentList(...args);
const getCommentItems = (...args) => xnsDomTools.getCommentItems(...args);
const getFloor = (...args) => xnsDomTools.getFloor(...args);
const getCommentId = (...args) => xnsDomTools.getCommentId(...args);
const getAuthorName = (...args) => xnsDomTools.getAuthorName(...args);
const getPostContent = (...args) => xnsDomTools.getPostContent(...args);
const getSafeUrlAttribute = (...args) => xnsDomTools.getSafeUrlAttribute(...args);


// 设置中心 UI；只管理界面偏好，不提供自动写操作开关。
function createSettingsUi({ windowObj, documentObj, state, createElement, getSettings, updateSettings, resetSettings }) {
  function closeSettings() {
    state.settingsPanel?.overlay?.remove();
    state.settingsPanel = null;
  }

  function createField(labelText, control, note = '') {
    const field = createElement('label', 'xns-settings-field');
    field.appendChild(createElement('span', 'xns-settings-label', labelText));
    field.appendChild(control);
    if (note) field.appendChild(createElement('small', 'xns-settings-note', note));
    return field;
  }

  function createSelect(options, value) {
    const select = documentObj.createElement('select');
    options.forEach(([optionValue, label]) => {
      const option = documentObj.createElement('option');
      option.value = optionValue;
      option.textContent = label;
      option.selected = optionValue === String(value);
      select.appendChild(option);
    });
    return select;
  }

  function openSettings() {
    closeSettings();
    const values = getSettings();
    const overlay = createElement('div', 'xns-settings-overlay');
    overlay.tabIndex = -1;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeSettings(); });
    const dialog = createElement('section', 'xns-settings-panel');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'xns-settings-title');
    const header = createElement('header', 'xns-settings-header');
    const title = createElement('h2', '', '预览设置');
    title.id = 'xns-settings-title';
    const close = createElement('button', 'xns-settings-close', '×');
    close.type = 'button';
    close.title = '关闭设置';
    close.setAttribute('aria-label', '关闭设置');
    close.addEventListener('click', closeSettings);
    header.append(title, close);
    const form = createElement('div', 'xns-settings-form');
    const layout = createSelect([['thread', '楼中楼'], ['original', '原版评论']], values.mode);
    const maxPages = createSelect([['10', '10 页'], ['20', '20 页'], ['30', '30 页'], ['50', '50 页']], values.maxPages);
    const density = createSelect([['comfortable', '舒适'], ['compact', '紧凑']], values.density);
    const theme = createSelect([['auto', '跟随 NodeSeek'], ['dark', '深色']], values.theme);
    const prompts = documentObj.createElement('input');
    prompts.type = 'checkbox';
    prompts.checked = values.prompts;
    const promptField = createElement('label', 'xns-settings-check');
    promptField.append(prompts, createElement('span', '', '显示一次性操作提示'));
    form.append(
      createField('默认评论布局', layout, '只影响帖子详情页，切换会立即生效。'),
      createField('自动读取页数', maxPages, '最多 50 页；修改后在下次刷新或打开帖子时生效。'),
      createField('评论密度', density),
      createField('主题', theme),
      promptField,
    );
    const footer = createElement('footer', 'xns-settings-actions');
    const reset = createElement('button', '', '恢复默认');
    reset.type = 'button';
    const done = createElement('button', 'xns-settings-primary', '完成');
    done.type = 'button';
    done.addEventListener('click', closeSettings);
    footer.append(reset, done);
    dialog.append(header, form, footer);
    overlay.appendChild(dialog);
    documentObj.body.appendChild(overlay);
    state.settingsPanel = { overlay, close: closeSettings };

    const apply = () => {
      const previousMode = state.mode;
      const next = updateSettings({
        mode: layout.value,
        maxPages: Number(maxPages.value),
        density: density.value,
        theme: theme.value,
        prompts: prompts.checked,
      });
      if (next.mode !== previousMode) state.post?.setMode?.(next.mode);
    };
    [layout, maxPages, density, theme].forEach((control) => control.addEventListener('change', apply));
    prompts.addEventListener('change', apply);
    reset.addEventListener('click', () => {
      const previousMode = state.mode;
      const next = resetSettings();
      layout.value = next.mode;
      maxPages.value = String(next.maxPages);
      density.value = next.density;
      theme.value = next.theme;
      prompts.checked = next.prompts;
      if (next.mode !== previousMode) state.post?.setMode?.(next.mode);
    });
    dialog.querySelector('select, input, button')?.focus();
  }

  return Object.freeze({ openSettings, closeSettings });
}

const xnsSettingsUi = createSettingsUi({
  windowObj: window,
  documentObj: document,
  state,
  createElement,
  getSettings,
  updateSettings,
  resetSettings,
});
const openSettings = (...args) => xnsSettingsUi.openSettings(...args);
const closeSettings = (...args) => xnsSettingsUi.closeSettings(...args);


// 共享视觉 token；组件样式只引用这些语义颜色，避免页面状态各自维护一套颜色。
const XNS_STYLE_TOKENS = `
      :root {
        --xns-text: #1f2937;
        --xns-muted: #64748b;
        --xns-subtle: #94a3b8;
        --xns-surface: #fff;
        --xns-surface-muted: #f8fafc;
        --xns-accent: #2563eb;
        --xns-accent-strong: #1d4ed8;
        --xns-accent-soft: #eff6ff;
        --xns-border: rgba(100,116,139,.25);
        --xns-danger: #b91c1c;
        --xns-success: #16a34a;
      }
      .dark-layout {
        --xns-text: #e5e7eb;
        --xns-muted: #9ca3af;
        --xns-subtle: #6b7280;
        --xns-surface: #111827;
        --xns-surface-muted: #18202b;
        --xns-accent: #93c5fd;
        --xns-accent-strong: #60a5fa;
        --xns-accent-soft: rgba(59,130,246,.18);
        --xns-border: rgba(148,163,184,.35);
        --xns-danger: #fca5a5;
        --xns-success: #4ade80;
      }
`;


// 设置中心的独立样式片段；由总样式安装器统一注入。
const XNS_SETTINGS_STYLES = `
      .xns-settings-overlay { position:fixed; z-index:2147483600; inset:0; display:flex; align-items:center; justify-content:center; padding:18px; background:rgba(15,23,42,.5); }
      .xns-settings-panel { box-sizing:border-box; width:min(500px,100%); max-height:calc(100vh - 36px); overflow:auto; padding:16px; border:1px solid var(--xns-border); border-radius:10px; color:var(--xns-text); background:var(--xns-surface); box-shadow:0 18px 55px rgba(15,23,42,.3); font:13px/1.4 system-ui,sans-serif; }
      .xns-settings-header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
      .xns-settings-header h2 { margin:0; font-size:18px; line-height:1.3; }
      .xns-settings-close { padding:2px 8px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface-muted); cursor:pointer; font-size:20px; line-height:1; }
      .xns-settings-close:hover, .xns-settings-close:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-settings-form { display:grid; gap:11px; }
      .xns-settings-field { display:grid; grid-template-columns:minmax(110px,1fr) minmax(150px,1.5fr); align-items:center; gap:4px 12px; }
      .xns-settings-label { color:var(--xns-muted); font-weight:600; }
      .xns-settings-field select { min-width:0; padding:5px 7px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface); font:inherit; }
      .xns-settings-field select:focus-visible, .xns-settings-check input:focus-visible { outline:2px solid rgba(59,130,246,.45); outline-offset:1px; }
      .xns-settings-note { grid-column:2; color:var(--xns-muted); font-size:11px; }
      .xns-settings-check { display:flex; align-items:center; gap:8px; color:var(--xns-muted); }
      .xns-settings-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; padding-top:12px; border-top:1px solid rgba(100,116,139,.16); }
      .xns-settings-actions button { padding:6px 11px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface); cursor:pointer; font:inherit; }
      .xns-settings-actions button:hover, .xns-settings-actions button:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-settings-actions .xns-settings-primary { color:#fff; border-color:var(--xns-accent-strong); background:var(--xns-accent-strong); }
      .xns-settings-actions .xns-settings-primary:hover, .xns-settings-actions .xns-settings-primary:focus-visible { color:#fff; background:var(--xns-accent); }
      .xns-density-compact .xns-preview-thread > .content-item { padding-top:5px; padding-bottom:4px; }
      .xns-density-compact .xns-preview-thread .xns-comment-child { padding-top:4px !important; padding-bottom:3px !important; }
      .xns-density-compact .xns-post-toolbar { padding:5px; }
      .dark-layout .xns-settings-overlay { background:rgba(2,6,23,.72); }
      @media (max-width:640px) {
        .xns-settings-overlay { padding:10px; }
        .xns-settings-panel { max-height:calc(100vh - 20px); padding:12px; }
        .xns-settings-field { grid-template-columns:1fr; gap:3px; }
        .xns-settings-note { grid-column:1; }
      }
`;


// 预览弹窗壳层样式；评论卡片和内容增强样式继续由总样式管理。
const XNS_PREVIEW_SHELL_STYLES = `
      .xns-modal { position:relative; }
      .xns-preview-scroll-btns { position:absolute; top:50%; right:8px; bottom:auto; display:flex; flex-direction:column; gap:6px; z-index:3; transform:translateY(-50%); transition:opacity .3s ease; pointer-events:none; }
      .xns-scroll-btn { position:relative; box-sizing:border-box !important; width:34px !important; min-width:34px !important; max-width:34px !important; height:34px !important; min-height:34px !important; max-height:34px !important; flex:0 0 34px; padding:0 !important; border:1px solid var(--xns-border); border-radius:50%; color:var(--xns-muted); background:rgba(255,255,255,.96); display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 8px rgba(15,23,42,.14); opacity:.9; line-height:1; transition:all .2s ease; pointer-events:auto; }
      .xns-scroll-btn:hover, .xns-scroll-btn:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); background:var(--xns-surface); opacity:1; transform:scale(1.05); outline:none; }
      .xns-scroll-btn[data-xns-tip]::after { position:absolute; right:calc(100% + 8px); top:50%; padding:4px 7px; border:1px solid var(--xns-border); border-radius:5px; color:var(--xns-text); background:var(--xns-surface); box-shadow:0 3px 10px rgba(15,23,42,.14); content:attr(data-xns-tip); font:12px/1.2 system-ui,sans-serif; opacity:0; pointer-events:none; transform:translateY(-50%) translateX(4px); transition:opacity .15s ease,transform .15s ease; white-space:nowrap; }
      .xns-scroll-btn:hover::after, .xns-scroll-btn:focus-visible::after { opacity:1; transform:translateY(-50%) translateX(0); }
      .xns-scroll-btn svg { width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .xns-scroll-btn.hidden { opacity:0; pointer-events:none; }
      .xns-scroll-btn.xns-action-pending { opacity:.45; pointer-events:none; }
      @keyframes xns-spin { to { transform:rotate(360deg); } }
      .xns-refresh-post.xns-action-pending svg { animation:xns-spin .9s linear infinite; }
      .xns-overlay { position:fixed; z-index:2147483000; inset:0; display:flex; align-items:stretch; justify-content:center; padding:0 clamp(32px,5vw,110px); background:rgba(15,23,42,.55); }
      .xns-modal { display:flex; flex-direction:column; width:min(1040px,100%); height:100vh; max-height:100vh; overflow:hidden; border-radius:0; color:var(--xns-text); background:var(--xns-surface); box-shadow:0 18px 55px rgba(15,23,42,.3); }
      .xns-modal-header { display:flex; align-items:center; gap:16px; padding:11px 16px; border-bottom:1px solid rgba(100,116,139,.2); }
      .xns-modal-heading { flex:1; min-width:0; }
      .xns-modal-eyebrow { display:block; margin-bottom:2px; color:var(--xns-muted); font:11px/1.2 system-ui,sans-serif; letter-spacing:.02em; }
      .xns-modal-title { min-width:0; overflow:hidden; margin:0; font-size:17px; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-meta { display:flex; align-items:center; flex-wrap:wrap; gap:2px 10px; margin-top:3px; color:var(--xns-muted); font:11px/1.25 system-ui,sans-serif; }
      .xns-modal-meta-item { display:inline-flex; align-items:center; gap:3px; min-width:0; }
      .xns-modal-meta-item[hidden] { display:none; }
      .xns-modal-meta-label { color:var(--xns-subtle); }
      .xns-modal-meta-value { max-width:22em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-actions { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
      .xns-modal-actions .xns-modal-tool { margin-left:0; }
      .xns-modal-header a, .xns-modal-header .xns-modal-reply, .xns-modal-close { padding:5px 8px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface-muted); cursor:pointer; text-decoration:none; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-header a:hover, .xns-modal-header a:focus-visible, .xns-modal-header .xns-modal-reply:hover, .xns-modal-header .xns-modal-reply:focus-visible, .xns-modal-close:hover, .xns-modal-close:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-modal-close { font-size:18px; line-height:1; }
      .xns-modal-toolbar { display:flex; align-items:center; gap:8px; min-height:38px; padding:5px 16px; border-bottom:1px solid rgba(100,116,139,.16); color:var(--xns-muted); background:var(--xns-surface-muted); font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-toolbar-label { color:var(--xns-subtle); }
      .xns-modal-mode { padding:4px 8px; border:1px solid rgba(59,130,246,.28); border-radius:5px; color:var(--xns-accent-strong); background:var(--xns-accent-soft); }
      .xns-modal-toolbar-status { display:inline-flex; flex:1 1 auto; align-items:center; min-width:0; gap:6px; overflow:hidden; color:var(--xns-muted); white-space:nowrap; text-overflow:ellipsis; }
      .xns-modal-toolbar-status > span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
      .xns-preview-status.is-loading::before { width:8px; height:8px; flex:0 0 8px; border:2px solid rgba(37,99,235,.22); border-top-color:var(--xns-accent); border-radius:50%; content:""; animation:xns-spin .9s linear infinite; }
      .xns-preview-status.is-failed { color:var(--xns-danger); }
      .xns-preview-status.is-truncated { color:#92400e; }
      .xns-preview-status > span + span::before { margin:0 4px 0 1px; color:var(--xns-subtle); content:"·"; }
      .xns-inline-retry { padding:2px 7px; border:1px solid rgba(185,28,28,.35); border-radius:5px; color:var(--xns-danger); background:var(--xns-surface); cursor:pointer; font:11px/1.2 system-ui,sans-serif; }
      .xns-inline-retry:hover, .xns-inline-retry:focus-visible { border-color:var(--xns-danger); outline:none; }
      .xns-modal-tool { display:inline-flex; align-items:center; gap:5px; margin-left:auto; padding:4px 8px; border:1px solid var(--xns-border); border-radius:6px; color:var(--xns-muted); background:var(--xns-surface); cursor:pointer; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-tool:hover, .xns-modal-tool:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-modal-tool svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .xns-modal-body { overflow:auto; padding:clamp(10px,2vw,18px); color:var(--xns-text); }
      .xns-modal-body img { max-width:100%; height:auto; }
      .dark-layout .xns-modal { color:var(--xns-text); background:var(--xns-surface-muted); }
      .dark-layout .xns-modal-meta { color:var(--xns-muted); }
      .dark-layout .xns-modal-meta-label { color:var(--xns-subtle); }
      .dark-layout .xns-modal-toolbar { color:var(--xns-muted); background:var(--xns-surface); }
      .dark-layout .xns-modal-eyebrow, .dark-layout .xns-modal-toolbar-label { color:var(--xns-muted); }
      .dark-layout .xns-modal-mode { color:var(--xns-accent); border-color:var(--xns-border); background:var(--xns-accent-soft); }
      .dark-layout .xns-scroll-btn { border-color:var(--xns-border); color:var(--xns-muted); background:var(--xns-surface); }
      .dark-layout .xns-scroll-btn:hover, .dark-layout .xns-scroll-btn:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); background:var(--xns-surface-muted); }
      .dark-layout .xns-scroll-btn[data-xns-tip]::after { color:var(--xns-text); background:var(--xns-surface); border-color:var(--xns-border); }
      .dark-layout .xns-inline-retry { color:var(--xns-danger); background:var(--xns-surface); border-color:var(--xns-border); }
      @media (max-width:800px) { .xns-preview-scroll-btns { right:6px; } .xns-scroll-btn { width:30px !important; min-width:30px !important; max-width:30px !important; height:30px !important; min-height:30px !important; max-height:30px !important; flex-basis:30px; } }
      @media (max-width:640px) { .xns-overlay { padding:0; } .xns-modal { width:100%; max-height:100vh; } .xns-modal-header { gap:8px; padding:9px 10px; } .xns-modal-eyebrow { display:none; } .xns-modal-actions { gap:4px; } .xns-modal-header a, .xns-modal-header .xns-modal-reply { padding:5px 6px; } .xns-modal-toolbar { padding:5px 10px; } .xns-modal-body { padding:9px; } .xns-preview-scroll-btns { right:5px; } .xns-scroll-btn { width:28px !important; min-width:28px !important; max-width:28px !important; height:28px !important; min-height:28px !important; max-height:28px !important; flex-basis:28px; } .xns-lightbox { padding:10px; } .xns-lightbox-image { max-width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .xns-toolbar-status { width:100%; max-width:none; margin-left:0; } }
`;


// NodeSeek 帖子 URL 规则与同源请求边界。
function createNodeSeekUrlService({ windowObj, URLCtor, safePositiveInt }) {
  function getPostInfo(rawUrl) {
    try {
      const url = new URLCtor(rawUrl, windowObj.location.href);
      if (url.origin !== windowObj.location.origin) return null;
      const match = /^\/post-(\d+)-(\d+)\/?$/.exec(url.pathname);
      if (!match) return null;
      const postId = safePositiveInt(match[1]);
      const page = safePositiveInt(match[2]);
      if (postId === null || page === null) return null;
      return { postId: String(postId), page };
    } catch { return null; }
  }

  function parseSameOriginUrl(rawUrl, base = windowObj.location.href) {
    if (typeof rawUrl !== 'string' || rawUrl.length > 2_048) return null;
    try {
      const url = new URLCtor(rawUrl, base);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (url.origin !== windowObj.location.origin || url.username || url.password) return null;
      return url;
    } catch { return null; }
  }

  function isAllowedPostRequest(url) {
    const info = url instanceof URLCtor ? getPostInfo(url.href) : null;
    return Boolean(info && !url.search && !url.username && !url.password);
  }

  return Object.freeze({ getPostInfo, parseSameOriginUrl, isAllowedPostRequest });
}

const xnsNodeSeekUrlService = createNodeSeekUrlService({
  windowObj: window,
  URLCtor: URL,
  safePositiveInt,
});
const getPostInfo = (...args) => xnsNodeSeekUrlService.getPostInfo(...args);
const parseSameOriginUrl = (...args) => xnsNodeSeekUrlService.parseSameOriginUrl(...args);
const isAllowedPostRequest = (...args) => xnsNodeSeekUrlService.isAllowedPostRequest(...args);


// 浏览器运行时上下文。它与静态配置分开，集中承接当前页面 URL 等环境依赖。
const pageInfo = getPostInfo(window.location.href);


// NodeSeek SSR 状态读取。只负责读取页面已经提供的 JSON，不访问会话存储。
function createSsrStateService({ documentObj, qs }) {
  function extractSsrState(doc) {
    try {
      const script = qs(doc, '#temp-script[type="application/json"]');
      const encoded = script?.textContent?.trim();
      if (!encoded) return null;
      const json = decodeURIComponent(escape(atob(encoded)));
      const data = JSON.parse(json);
      // 列表页通常只有 user，没有 postData.comments；身份服务也需要读取这种状态。
      // 帖子统计仍由调用方检查 postData.comments，不把列表状态当成评论状态使用。
      return data && typeof data === 'object' && (
        data.user !== undefined
        || (data.postData && Array.isArray(data.postData.comments))
      ) ? data : null;
    } catch { return null; }
  }

  function getDocState(root) { return root && root !== documentObj ? root.__xnsState || null : null; }

  return Object.freeze({ extractSsrState, getDocState });
}

const xnsSsrStateService = createSsrStateService({ documentObj: document, qs });
const extractSsrState = (...args) => xnsSsrStateService.extractSsrState(...args);
const getDocState = (...args) => xnsSsrStateService.getDocState(...args);


// NodeSeek 写接口适配器。
// 这里不决定按钮如何渲染，只负责同源校验、签名、CSRF 和响应错误归一化。
function createNodeSeekActionApi({ windowObj, navigatorObj, state, requestTimeout, parseSameOriginUrl, fetchFn, AbortControllerCtor }) {
  const allowedPaths = new Set([
    '/api/statistics/upvote',
    '/api/statistics/like',
    '/api/statistics/dislike',
    '/api/statistics/collection',
    '/api/content/new-comment',
    '/api/vote/voteforitem',
  ]);

  async function dynamicSign(method, url, body) {
    const input = `${method}\n\n${url}\n\n${navigatorObj.userAgent || ''}\n\n${body || ''}`;
    try {
      const digest = await windowObj.crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      return 'a'.repeat(40);
    }
  }

  function randomCsrfToken() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(16);
    if (windowObj.crypto?.getRandomValues) windowObj.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    let token = '';
    bytes.forEach((byte) => { token += alphabet[byte % alphabet.length]; });
    return token;
  }

  async function postAction(apiPath, payload, options = {}) {
    const contextUrl = options.context?.url?.href || state.modal?.url?.href || windowObj.location.href;
    const endpoint = parseSameOriginUrl(apiPath, contextUrl);
    if (!endpoint || !allowedPaths.has(endpoint.pathname)) throw new Error('操作地址不是 NodeSeek 同源接口');

    const controller = new AbortControllerCtor();
    const timer = windowObj.setTimeout(() => controller.abort(), requestTimeout);
    const bodyText = JSON.stringify(payload);
    const requestHeaders = {
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'csrf-token': randomCsrfToken(),
      ...(options.headers || {}),
    };
    if (windowObj.crypto?.subtle) requestHeaders['x-dynamic-sign'] = await dynamicSign('POST', endpoint.href, bodyText);
    try {
      const response = await fetchFn(endpoint.href, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        referrer: contextUrl,
        referrerPolicy: 'same-origin',
        headers: requestHeaders,
        body: bodyText,
        signal: controller.signal,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { /* 某些接口成功时不返回 JSON。 */ }
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const explicitFailure = data && typeof data === 'object' && (
        data.success === false || data.ok === false || data.error === true
        || (typeof data.status === 'string' && /fail|error|unauthor|denied/i.test(data.status))
        || (typeof data.code === 'string' && /fail|error|unauthor|denied/i.test(data.code))
      );
      if (!response.ok || explicitFailure || (!data && /text\/html|<html[\s>]|登录|禁止访问/i.test(`${contentType} ${text.slice(0, 500)}`))) {
        const message = data?.message || data?.msg || text.replace(/<[^>]+>/g, ' ').trim().slice(0, 120);
        throw new Error(message || `HTTP ${response.status}`);
      }
      return data;
    } finally {
      windowObj.clearTimeout(timer);
    }
  }

  return Object.freeze({ dynamicSign, randomCsrfToken, postAction });
}

const xnsNodeSeekActionApi = createNodeSeekActionApi({
  windowObj: window,
  navigatorObj: navigator,
  state,
  requestTimeout: REQUEST_TIMEOUT,
  parseSameOriginUrl,
  fetchFn: window.fetch.bind(window),
  AbortControllerCtor: window.AbortController,
});
const dynamicSign = (...args) => xnsNodeSeekActionApi.dynamicSign(...args);
const randomCsrfToken = (...args) => xnsNodeSeekActionApi.randomCsrfToken(...args);
const postAction = (...args) => xnsNodeSeekActionApi.postAction(...args);


// 当前用户身份读取服务。
// 只读取页面已经提供的 SSR 状态或用户菜单，不读取 Cookie、Storage 或浏览器会话。
function createIdentityService({ documentObj, extractSsrState }) {
  let resolved = false;
  let uid = null;

  function uidFromHref(href) {
    const match = String(href || '').match(/\/space\/(\d+)/);
    return match ? String(match[1]) : null;
  }

  function fromPageState() {
    const user = extractSsrState(documentObj)?.user;
    const value = user && (user.id ?? user.uid ?? user.userId ?? user.memberId ?? user.member_id);
    return value === undefined || value === null ? null : String(value);
  }

  function fromUserMenu() {
    const selectors = [
      '[data-user-id]',
      '.user-menu a[href^="/space/"]',
      '.user-profile a[href^="/space/"]',
      '.member-profile a[href^="/space/"]',
      'header a[href^="/space/"][title]',
      'aside a[href^="/space/"][title]',
    ];
    for (const selector of selectors) {
      const nodes = documentObj.querySelectorAll(selector);
      for (const node of nodes) {
        const value = node.getAttribute('data-user-id') || node.getAttribute('href');
        const result = uidFromHref(value) || (/^\d+$/.test(value || '') ? String(value) : null);
        if (result) return result;
      }
    }
    return null;
  }

  function currentUserUid() {
    if (resolved) return uid;
    resolved = true;
    uid = fromPageState() || fromUserMenu();
    return uid;
  }

  return Object.freeze({ currentUserUid });
}

const xnsIdentityService = createIdentityService({
  documentObj: document,
  extractSsrState,
});
const getCurrentUserUid = () => xnsIdentityService.currentUserUid();


// NodeSeek 页面内容解析与安全克隆；输出供预览和帖子页共用的评论记录。
function createContentParser({
  documentObj,
  qs,
  qsa,
  getSafeUrlAttribute,
  parseSameOriginUrl,
  getPostInfo,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  getCurrentUserUid,
}) {
const DANGEROUS_IMPORTED_SELECTOR = 'script,style,link,meta,base,iframe,object,embed,form,input,textarea,select,option,button';
const COMMENT_MENU_SELECTOR = '.comment-menu, .comment-actions';
const ssrCommentIndexes = new WeakMap();

function sanitizeImportedNode(sourceNode, options = {}) {
  if (!sourceNode) return null;
  const imported = documentObj.importNode(sourceNode, true);
  if (imported.matches?.(DANGEROUS_IMPORTED_SELECTOR)) return null;
  const all = [imported, ...qsa(imported, '*')].filter((node) => node.nodeType === 1);
  all.forEach((node) => {
    if (node !== imported && node.matches?.(DANGEROUS_IMPORTED_SELECTOR)) {
      node.remove();
      return;
    }
    if (node !== imported && !options.keepCommentMenu && node.matches?.(COMMENT_MENU_SELECTOR)) {
      node.remove();
      return;
    }
    // 保留克隆根节点的楼层 id；旧实现的 [id] 查询只覆盖后代节点，
    // 预览和帖子页回复流程依赖根 id 继续识别楼层。
    if (node !== imported && node.hasAttribute('id')) node.removeAttribute('id');
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['style', 'srcdoc', 'srcset', 'formaction', 'contenteditable', 'ping'].includes(name)) {
        node.removeAttribute(attribute.name);
        return;
      }
      if (['href', 'src', 'poster', 'xlink:href'].includes(name)) {
        const safeFragment = name === 'xlink:href' && attribute.value.trim().startsWith('#');
        const urlName = name === 'poster' ? 'src' : name === 'xlink:href' ? 'href' : name;
        const safeValue = safeFragment ? attribute.value : getSafeUrlAttribute(urlName, attribute.value);
        if (!safeValue) node.removeAttribute(attribute.name);
        else if (options.deferImages && node.localName === 'img' && name === 'src') {
          node.setAttribute('data-xns-deferred-src', safeValue);
          node.removeAttribute(attribute.name);
        } else node.setAttribute(attribute.name, safeValue);
      }
    });
    if (node.localName === 'a' && (node.hasAttribute('href') || node.hasAttribute('xlink:href'))) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (node.localName === 'img') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
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

function hasOwnEditOption(item) {
  if (!item?.querySelector) return false;
  return qsa(item, ':scope > .comment-menu > .menu-item, :scope > .comment-actions > .menu-item')
    .some((el) => (el.textContent || '').trim() === '编辑' && !el.dataset?.xnsAction);
}

function getCommentAuthorUid(item) {
  try {
    const author = qs(item, '.nsk-content-meta-info a[href*="/space/"], .author-name, a[href*="/space/"]');
    const match = (author?.getAttribute('href') || '').match(/\/space\/(\d+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

function getStateUserUid(state) {
  const user = state?.user;
  const value = user && (user.id ?? user.uid ?? user.userId ?? user.memberId ?? user.member_id);
  return value === undefined || value === null ? null : String(value);
}

function getCommentRecord(item, postId, page, index, current, options = {}) {
  const floor = getFloor(item);
  if (floor === null) return null;
  const node = current ? item : sanitizeImportedNode(item, { ...options, deferImages: true });
  if (!node) return null;
  const commentId = getCommentId(item);
  const currentUserUid = (typeof options.getCurrentUserUid === 'function' ? options.getCurrentUserUid() : getCurrentUserUid())
    || getStateUserUid(options.state);
  return {
    floor, page, postId, index, current,
    isMine: hasOwnEditOption(item) || (currentUserUid !== null && getCommentAuthorUid(item) === currentUserUid),
    pinned: isPinnedComment(item),
    author: getAuthorName(item),
    reply: extractReplyMetadata(item, postId),
    counts: commentId !== null && options.state ? getSsrCommentCounts(options.state, commentId) : null,
    // 跨页评论在原版布局下不会展示；虚拟楼层流只保留经过清洗的 HTML，
    // 需要进入活动窗口时再物化成节点。
    node: current ? node : null,
    html: current ? null : node.outerHTML,
    parent: null, children: [],
  };
}

function materializeCommentNode(record) {
  if (record?.node) return record.node;
  if (typeof record?.html !== 'string' || !record.html) return null;
  const template = documentObj.createElement('template');
  template.innerHTML = record.html;
  record.node = template.content.firstElementChild || null;
  restoreDeferredImageSources(record.node);
  return record.node;
}

// 远端评论进入活动窗口时必须先恢复图片源地址，再交给图片灯箱/内容增强绑定事件。
// 否则节点虽然已经物化，浏览器仍会把 data-xns-deferred-src 当作没有 src，显示破图占位。
function restoreDeferredImageSources(root) {
  const images = [];
  if (root?.localName === 'img') images.push(root);
  images.push(...qsa(root, 'img[data-xns-deferred-src]'));
  images.forEach((image) => {
    const source = image.getAttribute('data-xns-deferred-src');
    if (source && !image.getAttribute('src')) image.setAttribute('src', source);
    image.removeAttribute('data-xns-deferred-src');
  });
}

function releaseCommentNode(record) {
  if (record && !record.current) record.node = null;
}

function releaseCommentHtml(record) {
  if (record && !record.current && record.node) record.html = null;
}

function getSsrCommentCounts(stateValue, commentId) {
  if (!stateValue || typeof stateValue !== 'object') return null;
  let index = ssrCommentIndexes.get(stateValue);
  if (!index) {
    index = new Map();
    const comments = stateValue?.postData?.comments;
    if (Array.isArray(comments)) {
      comments.forEach((item) => {
        if (item?.commentId !== undefined && item?.commentId !== null && !index.has(String(item.commentId))) {
          index.set(String(item.commentId), item);
        }
      });
    }
    ssrCommentIndexes.set(stateValue, index);
  }
  const comment = index.get(String(commentId));
  if (!comment) return null;
  return {
    like: safeCount(comment.upvoteCount), chicken: safeCount(comment.likeCount), dislike: safeCount(comment.dislikeCount),
    liked: Boolean(comment.upvoted), chickened: Boolean(comment.liked), disliked: Boolean(comment.disliked),
  };
}

  return Object.freeze({
    sanitizeImportedNode,
    extractReplyMetadata,
    isPinnedComment,
    hasOwnEditOption,
    getCommentAuthorUid,
    getCommentRecord,
    materializeCommentNode,
    releaseCommentNode,
    releaseCommentHtml,
    getSsrCommentCounts,
  });
}

const xnsContentParser = createContentParser({
  documentObj: document,
  qs,
  qsa,
  getSafeUrlAttribute,
  parseSameOriginUrl,
  getPostInfo,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  getCurrentUserUid,
});
const sanitizeImportedNode = (...args) => xnsContentParser.sanitizeImportedNode(...args);
const extractReplyMetadata = (...args) => xnsContentParser.extractReplyMetadata(...args);
const isPinnedComment = (...args) => xnsContentParser.isPinnedComment(...args);
const hasOwnEditOption = (...args) => xnsContentParser.hasOwnEditOption(...args);
const getCommentAuthorUid = (...args) => xnsContentParser.getCommentAuthorUid(...args);
const getCommentRecord = (...args) => xnsContentParser.getCommentRecord(...args);
const materializeCommentNode = (...args) => xnsContentParser.materializeCommentNode(...args);
const releaseCommentNode = (...args) => xnsContentParser.releaseCommentNode(...args);
const releaseCommentHtml = (...args) => xnsContentParser.releaseCommentHtml(...args);
const getSsrCommentCounts = (...args) => xnsContentParser.getSsrCommentCounts(...args);


// 从页面链接发现同一帖子的分页。
function createPaginationService({ windowObj, qsa, parseSameOriginUrl, getPostInfo }) {
  function getPaginationLinks(root) {
    const preferred = qsa(root, '.nsk-pager a[href], a.pager-pos[href]');
    return preferred.length ? preferred : qsa(root, 'a[href]');
  }

  function getPageNumbers(root, postId) {
    const pages = new Set();
    const baseUrl = typeof root?.baseURI === 'string' && /^https?:/.test(root.baseURI) ? root.baseURI : windowObj.location.href;
    getPaginationLinks(root).forEach((link) => {
      const url = parseSameOriginUrl(link.getAttribute('href') || '', baseUrl);
      const info = url ? getPostInfo(url.href) : null;
      if (info?.postId === String(postId)) pages.add(info.page);
    });
    return pages;
  }

  return Object.freeze({ getPageNumbers });
}

const xnsPaginationService = createPaginationService({
  windowObj: window,
  qsa,
  parseSameOriginUrl,
  getPostInfo,
});
const getPageNumbers = (...args) => xnsPaginationService.getPageNumbers(...args);


// NodeSeek 同源帖子读取与 HTML -> Document 转换。
function createHttpClient({
  windowObj,
  fetchFn,
  AbortControllerCtor,
  DOMParserCtor,
  requestTimeout,
  maxResponseBytes,
  isAllowedPostRequest,
  parseSameOriginUrl,
  extractSsrState,
  cacheTtl,
  cacheMaxEntries,
  cacheMaxBytes,
  cacheItemMaxBytes,
}) {
  const htmlCache = new Map();
  let htmlCacheBytes = 0;

  function removeCacheEntry(key) {
    const entry = htmlCache.get(key);
    if (!entry) return;
    htmlCacheBytes -= entry.bytes;
    htmlCache.delete(key);
  }

  function postIdFromUrl(url) {
    return /^\/post-(\d+)-\d+(?:\/)?$/.exec(url.pathname)?.[1] || '';
  }

  function invalidatePostCache(url) {
    const postId = postIdFromUrl(url);
    if (!postId) {
      removeCacheEntry(url.href);
      return;
    }
    Array.from(htmlCache.entries()).forEach(([key, entry]) => {
      if (entry.postId === postId) removeCacheEntry(key);
    });
  }

  function readCachedHtml(url) {
    const entry = htmlCache.get(url.href);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > cacheTtl) {
      removeCacheEntry(url.href);
      return null;
    }
    htmlCache.delete(url.href);
    htmlCache.set(url.href, entry);
    return { html: entry.html, url: parseSameOriginUrl(entry.url) };
  }

  function writeCachedHtml(url, html) {
    const bytes = html.length;
    if (bytes > cacheItemMaxBytes) return;
    removeCacheEntry(url.href);
    while (htmlCache.size >= cacheMaxEntries || htmlCacheBytes + bytes > cacheMaxBytes) {
      const oldest = htmlCache.keys().next().value;
      if (oldest === undefined) break;
      removeCacheEntry(oldest);
    }
    // 只缓存原始 HTML；不要把解析后的 Document 放进缓存。
    // Document 会持有整棵 DOM 树和 SSR 状态，原始 HTML 的字节上限无法反映
    // 它实际占用的渲染器内存，长帖重复打开时尤其容易放大占用。
    htmlCache.set(url.href, { html, url: url.href, postId: postIdFromUrl(url), createdAt: Date.now(), bytes });
    htmlCacheBytes += bytes;
  }

  function getRetryDelay(response, fallback) {
    const value = response.headers?.get?.('retry-after')?.trim() || '';
    if (!value) return fallback;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, seconds * 1_000);
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return Math.min(10_000, Math.max(0, timestamp - Date.now()));
    return fallback;
  }

  function isCloudflareChallenge(response) {
    return response.headers?.get?.('cf-mitigated')?.trim().toLowerCase() === 'challenge';
  }

  function createHttpError(message, code, status) {
    const error = new Error(message);
    error.code = code;
    if (Number.isFinite(status)) error.status = status;
    return error;
  }

  function abortError() {
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    return error;
  }

  function wait(delay, signal) {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const timer = windowObj.setTimeout(() => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      }, delay);
      const cancel = () => {
        windowObj.clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        reject(abortError());
      };
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
  }

  async function fetchHtml(url, options = {}) {
    if (!isAllowedPostRequest(url)) throw new Error('只允许读取同一站点的帖子页面');
    const noStore = options.noStore === true;
    const allowCache = options.allowCache === true && !noStore;
    if (noStore) invalidatePostCache(url);
    if (allowCache) {
      const cached = readCachedHtml(url);
      if (cached) return cached;
    }
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      throwIfAborted(options.signal);
      if (typeof options.beforeRequest === 'function') await options.beforeRequest();
      throwIfAborted(options.signal);
      const controller = new AbortControllerCtor();
      const abortExternal = () => controller.abort();
      options.signal?.addEventListener('abort', abortExternal, { once: true });
      const timer = windowObj.setTimeout(() => controller.abort(), requestTimeout);
      try {
        const response = await fetchFn(url.href, {
          method: 'GET', credentials: 'same-origin', cache: noStore ? 'no-store' : 'default', redirect: 'error',
          referrerPolicy: 'same-origin', headers: { Accept: 'text/html,application/xhtml+xml' }, signal: controller.signal,
        });
        if (typeof options.onResponse === 'function') options.onResponse(response.status);
        if (isCloudflareChallenge(response)) {
          throw createHttpError('NodeSeek 的 Cloudflare 验证拦截了此分页，请完成验证后再点重试', 'CLOUDFLARE_CHALLENGE', response.status);
        }
        if (response.status === 429 || response.status >= 500) {
          if (attempt < 3) {
            await wait(getRetryDelay(response, 600 * attempt), options.signal);
            continue;
          }
          throw new Error(`HTTP ${response.status}`);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const responseUrl = parseSameOriginUrl(response.url);
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (!responseUrl || !isAllowedPostRequest(responseUrl) || !contentType.includes('text/html')) throw new Error('响应不是同站帖子页面');
        if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) throw new Error('响应过大');
        const html = await response.text();
        if (!html || html.length > maxResponseBytes) throw new Error('响应过大或为空');
        if (allowCache) writeCachedHtml(responseUrl, html);
        return { html, url: responseUrl };
      } catch (error) {
        if (error?.code === 'CLOUDFLARE_CHALLENGE') throw error;
        if (attempt < 3 && error?.name !== 'AbortError') {
          await new Promise((resolve) => windowObj.setTimeout(resolve, 600 * attempt));
          continue;
        }
        throw error;
      } finally {
        windowObj.clearTimeout(timer);
        options.signal?.removeEventListener('abort', abortExternal);
      }
    }
    throw new Error('抓取失败');
  }

  function parseHtml(html) {
    const doc = new DOMParserCtor().parseFromString(html, 'text/html');
    doc.__xnsState = extractSsrState(doc);
    return doc;
  }

  return Object.freeze({ fetchHtml, parseHtml });
}

const xnsHttpClient = createHttpClient({
  windowObj: window,
  fetchFn: window.fetch.bind(window),
  AbortControllerCtor: window.AbortController,
  DOMParserCtor: window.DOMParser,
  requestTimeout: REQUEST_TIMEOUT,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  cacheTtl: HTML_CACHE_TTL,
  cacheMaxEntries: HTML_CACHE_MAX_ENTRIES,
  cacheMaxBytes: HTML_CACHE_MAX_BYTES,
  cacheItemMaxBytes: HTML_CACHE_ITEM_MAX_BYTES,
  isAllowedPostRequest,
  parseSameOriginUrl,
  extractSsrState,
});
const fetchHtml = (...args) => xnsHttpClient.fetchHtml(...args);
const parseHtml = (...args) => xnsHttpClient.parseHtml(...args);


// 纯评论关系模型：不访问 DOM、不发请求，只根据楼层引用建立树。
function createCommentThreadModel() {
  function build(records) {
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

  return Object.freeze({ build });
}

const xnsCommentThreadModel = createCommentThreadModel();
const buildReplyTree = (records) => xnsCommentThreadModel.build(records);

function flattenReplyTreeModel(records) {
  const flat = [];
  const roots = buildReplyTree(records);
  const stack = roots.slice().reverse().map((record) => ({ record, depth: 0 }));
  while (stack.length) {
    const entry = stack.pop();
    flat.push(entry);
    entry.record.children.slice().reverse().forEach((child) => stack.push({ record: child, depth: entry.depth + 1 }));
  }
  return flat;
}

const flattenReplyTree = (records) => flattenReplyTreeModel(records);


// 评论虚拟列表：保留完整评论记录，只把视口附近的楼层物化成 DOM。
// 它不读取网络，也不改变楼层关系；帖子页和预览弹窗共用同一套窗口模型。
function createCommentVirtualizer({
  windowObj,
  documentObj,
  createElement,
  estimatedHeight = 150,
  overscanScreens = 2,
} = {}) {
  let host = null;
  let entries = [];
  let renderItem = null;
  let onMount = null;
  let onUnmount = null;
  let isPinned = null;
  let getViewport = null;
  let viewport = null;
  let frame = 0;
  let destroyed = false;
  let forceIndex = null;
  const mounted = new Map();
  const heights = new Map();

  const keyOf = (entry) => {
    const record = entry?.record || entry;
    return `${record?.postId || ''}:${record?.floor ?? ''}`;
  };

  const isWindowViewport = (value) => !value || value === windowObj || value === windowObj.window;

  function getHeight(index) {
    return Math.max(1, Number(heights.get(keyOf(entries[index]))) || Number(estimatedHeight) || 1);
  }

  function sumHeights(start, end) {
    let total = 0;
    for (let index = Math.max(0, start); index < Math.min(entries.length, end); index += 1) total += getHeight(index);
    return total;
  }

  function findIndexAtOffset(offset) {
    const target = Math.max(0, Number(offset) || 0);
    let passed = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const next = passed + getHeight(index);
      if (target < next) return index;
      passed = next;
    }
    return entries.length;
  }

  function resolveViewport() {
    const next = typeof getViewport === 'function' ? getViewport() : viewport;
    return next || windowObj;
  }

  function getHostOffset(nextViewport) {
    if (isWindowViewport(nextViewport)) {
      return (host?.getBoundingClientRect?.().top || 0) + (Number(windowObj.scrollY) || 0);
    }
    const scrollTop = Math.max(0, Number(nextViewport.scrollTop) || 0);
    const hostRect = host?.getBoundingClientRect?.();
    const viewportRect = nextViewport.getBoundingClientRect?.();
    if (!hostRect || !viewportRect) return Math.max(0, Number(host?.offsetTop) || 0);
    return Math.max(0, hostRect.top - viewportRect.top - (Number(nextViewport.clientTop) || 0) + scrollTop);
  }

  function getViewportMetrics() {
    const nextViewport = resolveViewport();
    if (nextViewport !== viewport) bindViewport(nextViewport);
    if (isWindowViewport(nextViewport)) {
      const scrollTop = Number(windowObj.scrollY) || 0;
      const hostTop = getHostOffset(nextViewport);
      const height = Math.max(1, Number(windowObj.innerHeight) || 800);
      return { start: Math.max(0, scrollTop - hostTop), end: Math.max(0, scrollTop - hostTop) + height, height };
    }
    const height = Math.max(1, Number(nextViewport.clientHeight) || 800);
    const scrollTop = Math.max(0, Number(nextViewport.scrollTop) || 0);
    const start = Math.max(0, scrollTop - getHostOffset(nextViewport));
    return { start, end: start + height, height };
  }

  function createSpacer(height) {
    const spacer = createElement('li', 'xns-virtual-spacer');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.height = `${Math.max(0, Math.round(height))}px`;
    return spacer;
  }

  function defaultPinned(node) {
    if (!node) return false;
    if (node.hasAttribute('data-xns-pinned')) return true;
    if (node.querySelector('.xns-preview-composer, [aria-expanded="true"]')) return true;
    return Array.from(node.querySelectorAll('video')).some((video) => !video.paused);
  }

  function scheduleRender() {
    if (destroyed || frame) return;
    frame = windowObj.requestAnimationFrame(() => {
      frame = 0;
      renderWindow();
    });
  }

  function measureNode(node) {
    if (!node?.getBoundingClientRect) return 0;
    const rect = node.getBoundingClientRect();
    let height = rect.height;
    try {
      const style = windowObj.getComputedStyle(node);
      height += Number.parseFloat(style.marginTop) || 0;
      height += Number.parseFloat(style.marginBottom) || 0;
    } catch {
      // 测试替身可能没有 getComputedStyle；此时使用 border box 高度即可。
    }
    return Math.max(1, height);
  }

  const resizeObserver = typeof windowObj.ResizeObserver === 'function'
    ? new windowObj.ResizeObserver((observations) => {
      let changed = false;
      observations.forEach((observation) => {
        const index = Array.from(mounted.entries()).find(([, node]) => node === observation.target)?.[0];
        if (index === undefined) return;
        const key = keyOf(entries[index]);
        const height = measureNode(observation.target);
        if (Math.abs((heights.get(key) || 0) - height) > 1) {
          heights.set(key, height);
          changed = true;
        }
      });
      if (changed) scheduleRender();
    })
    : null;

  function unmount(index) {
    const node = mounted.get(index);
    if (!node) return;
    resizeObserver?.unobserve(node);
    mounted.delete(index);
    onUnmount?.(node, entries[index], index);
  }

  function renderWindow() {
    if (destroyed || !host) return;
    if (!entries.length) {
      mounted.forEach((_, index) => unmount(index));
      host.replaceChildren();
      return;
    }
    const metrics = getViewportMetrics();
    const overscan = Math.max(metrics.height, metrics.height * Math.max(0, Number(overscanScreens) || 0));
    let start = findIndexAtOffset(metrics.start - overscan);
    let end = findIndexAtOffset(metrics.end + overscan);
    if (start >= entries.length) start = Math.max(0, entries.length - 1);
    end = Math.min(entries.length, Math.max(start + 1, end));
    const pin = typeof isPinned === 'function' ? isPinned : defaultPinned;
    const desired = new Set();
    for (let index = start; index < end; index += 1) desired.add(index);
    // 只额外加入被楼层导航命中的一个目标，不把目标与顶部窗口之间的
    // 所有评论都物化出来。
    if (forceIndex !== null && forceIndex >= 0 && forceIndex < entries.length) desired.add(forceIndex);
    mounted.forEach((node, index) => { if (pin(node, entries[index], index)) desired.add(index); });
    mounted.forEach((_, index) => { if (!desired.has(index)) unmount(index); });

    const newlyMounted = [];
    Array.from(desired).sort((a, b) => a - b).forEach((index) => {
      if (mounted.has(index)) return;
      const node = renderItem?.(entries[index], index);
      if (!node) return;
      mounted.set(index, node);
      newlyMounted.push({ index, node });
    });

    const fragment = documentObj.createDocumentFragment();
    let cursor = 0;
    Array.from(desired).sort((a, b) => a - b).forEach((index) => {
      if (index > cursor) fragment.appendChild(createSpacer(sumHeights(cursor, index)));
      const node = mounted.get(index);
      if (node) fragment.appendChild(node);
      cursor = index + 1;
    });
    if (cursor < entries.length) fragment.appendChild(createSpacer(sumHeights(cursor, entries.length)));
    host.replaceChildren(fragment);

    newlyMounted.forEach(({ index, node }) => {
      resizeObserver?.observe(node);
      onMount?.(node, entries[index], index);
      const height = measureNode(node);
      const key = keyOf(entries[index]);
      if (Math.abs((heights.get(key) || 0) - height) > 1) heights.set(key, height);
    });
  }

  function bindViewport(nextViewport) {
    if (nextViewport === viewport) return;
    if (viewport?.removeEventListener) {
      viewport.removeEventListener('scroll', scheduleRender);
      viewport.removeEventListener('load', scheduleRender, true);
      viewport.removeEventListener('error', scheduleRender, true);
    }
    viewport = nextViewport || windowObj;
    viewport?.addEventListener?.('scroll', scheduleRender, { passive: true });
    // 预览正文位于虚拟列表之前。长图完成加载后列表的内容坐标会变化，
    // load/error 不冒泡，因此使用捕获阶段重新计算活动窗口。
    viewport?.addEventListener?.('load', scheduleRender, true);
    viewport?.addEventListener?.('error', scheduleRender, true);
  }

  function setEntries(nextEntries, options = {}) {
    if (destroyed) return;
    if (typeof options.renderItem === 'function') renderItem = options.renderItem;
    if (typeof options.onMount === 'function') onMount = options.onMount;
    if (typeof options.onUnmount === 'function') onUnmount = options.onUnmount;
    if (typeof options.isPinned === 'function') isPinned = options.isPinned;
    if (typeof options.getViewport === 'function') getViewport = options.getViewport;
    const normalized = Array.isArray(nextEntries) ? nextEntries.map((entry, index) => ({ ...entry, index })) : [];
    const nextKeys = new Set(normalized.map(keyOf));
    mounted.forEach((_, index) => {
      const oldKey = keyOf(entries[index]);
      const nextKey = keyOf(normalized[index]);
      if (!nextKeys.has(oldKey) || oldKey !== nextKey) unmount(index);
    });
    entries = normalized;
    host?.classList.add('xns-virtual-list');
    host?.setAttribute('data-xns-virtual-count', String(entries.length));
    renderWindow();
  }

  function mount(nextHost, options = {}) {
    if (destroyed) return api;
    host = nextHost;
    if (typeof options.renderItem === 'function') renderItem = options.renderItem;
    if (typeof options.onMount === 'function') onMount = options.onMount;
    if (typeof options.onUnmount === 'function') onUnmount = options.onUnmount;
    if (typeof options.isPinned === 'function') isPinned = options.isPinned;
    if (typeof options.getViewport === 'function') getViewport = options.getViewport;
    host?.classList.add('xns-virtual-list');
    host?.setAttribute('data-xns-virtual-count', String(entries.length));
    if (host) host.__xnsVirtualizer = api;
    renderWindow();
    return api;
  }

  function scrollToIndex(index, behavior = 'smooth') {
    if (!host || index < 0 || index >= entries.length) return null;
    forceIndex = index;
    renderWindow();
    const nextViewport = resolveViewport();
    const offset = sumHeights(0, index);
    if (isWindowViewport(nextViewport)) {
      const top = getHostOffset(nextViewport) + offset;
      windowObj.scrollTo?.({ top, behavior });
    } else {
      nextViewport.scrollTo?.({ top: getHostOffset(nextViewport) + offset, behavior });
    }
    forceIndex = null;
    scheduleRender();
    return mounted.get(index) || null;
  }

  function scrollToFloor(floor) {
    const index = entries.findIndex((entry) => String(entry.record?.floor) === String(floor));
    // 先同步定位并物化目标，再由调用方负责高亮；否则平滑滚动尚未改变
    // scrollTop 时，下一帧可能把刚物化的目标误判为屏外节点。
    return index < 0 ? null : scrollToIndex(index, 'auto');
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (frame) windowObj.cancelAnimationFrame(frame);
    if (viewport?.removeEventListener) {
      viewport.removeEventListener('scroll', scheduleRender);
      viewport.removeEventListener('load', scheduleRender, true);
      viewport.removeEventListener('error', scheduleRender, true);
    }
    resizeObserver?.disconnect();
    mounted.forEach((_, index) => unmount(index));
    mounted.clear();
    if (host?.__xnsVirtualizer === api) delete host.__xnsVirtualizer;
    host?.classList.remove('xns-virtual-list');
    host?.removeAttribute('data-xns-virtual-count');
    host?.replaceChildren();
  }

  const api = Object.freeze({ mount, setEntries, scrollToIndex, scrollToFloor, destroy });
  return api;
}


// 帖子分页读取服务。
// 只负责“读哪些页、如何并发、如何合并”，不创建 DOM，也不决定如何展示失败。
function createPageLoader({ windowObj, maxPage, getMaxPage, concurrency, requestGapMs, fetchHtml, parseHtml, getPageNumbers, getCommentItems, getCommentRecord, getDocState, getCurrentUserUid }) {
  function createRequestGate(gapMs) {
    const cooldownGap = Number.isFinite(Number(gapMs)) ? Math.max(0, Number(gapMs)) : 0;
    let currentGap = cooldownGap;
    let successStreak = 0;
    let queue = Promise.resolve();
    let nextStartAt = 0;
    async function waitForRequestSlot() {
      const previous = queue;
      let release;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      const delay = Math.max(0, nextStartAt - Date.now());
      if (delay) await new Promise((resolve) => windowObj.setTimeout(resolve, delay));
      nextStartAt = Date.now() + currentGap;
      release();
    }
    function observeResponse(status) {
      if (status === 429 || status >= 500) {
        currentGap = Math.min(1_000, Math.max(cooldownGap, currentGap ? currentGap * 2 : cooldownGap));
        successStreak = 0;
        return;
      }
      if (status >= 200 && status < 300) {
        successStreak += 1;
        if (successStreak >= 8 && currentGap > 0) {
          currentGap = Math.max(cooldownGap, currentGap - 25);
          successStreak = 0;
        }
      }
    }
    return Object.freeze({ waitForRequestSlot, observeResponse });
  }

  function collectPageRecords(info, root, page) {
    const state = getDocState(root);
    return getCommentItems(root)
      .map((item, index) => getCommentRecord(item, info.postId, page, index, false, { keepCommentMenu: true, state, getCurrentUserUid }))
      .filter(Boolean);
  }

  async function fetchPostPages(info, firstDocument, options = {}) {
    const pageLimit = Math.min(maxPage, Math.max(1, Number(options.pageLimit) || Number(getMaxPage?.()) || maxPage));
    const noStore = options.noStore !== false;
    const retainDocuments = options.retainDocuments !== false;
    const pageDocs = retainDocuments ? new Map([[info.page, firstDocument]]) : null;
    const normalizePages = (values) => Array.from(new Set((Array.isArray(values) ? values : [])
      .map((page) => Number(page))
      .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageLimit)));
    const onlyPages = Array.isArray(options.onlyPages) ? normalizePages(options.onlyPages) : null;
    const loadedPages = new Set([info.page, ...normalizePages(options.initialLoadedPages)]);
    const failedPages = new Set(normalizePages(options.initialFailedPages));
    const challengePages = new Set(normalizePages(options.initialChallengePages));
    // 当前打开页即使超过读取上限也要保留，但不能计入“前 N 页”的进度。
    const countedLoadedPages = () => Array.from(loadedPages).filter((page) => page >= 1 && page <= pageLimit).length;
    const pages = new Set([info.page]);
    const discovered = getPageNumbers(firstDocument, info.postId);
    const totalPages = discovered.size ? Math.max(...discovered, info.page) : info.page;
    const truncated = totalPages > pageLimit;

    if (onlyPages) {
      onlyPages.forEach((page) => pages.add(page));
    } else {
      discovered.forEach((page) => {
        if (page <= pageLimit) pages.add(page);
      });
      const maxSeed = truncated ? pageLimit : Math.min(pageLimit, Math.max(...pages));
      for (let page = 1; page <= maxSeed; page += 1) pages.add(page);
    }
    pages.delete(info.page);
    const progressState = () => ({
      loadedPages: countedLoadedPages(),
      failedPages: [...failedPages].sort((a, b) => a - b),
      challengePages: [...challengePages].sort((a, b) => a - b),
      truncated,
      totalPages,
      pageLimit,
    });

    const pending = Array.from(pages).sort((a, b) => a - b);
    const requestGate = createRequestGate(options.requestGapMs ?? requestGapMs);
    options.onPageLoaded?.(info.page, firstDocument, progressState());
    const worker = async () => {
      while (pending.length) {
        if (options.isAborted?.()) return;
        const page = pending.shift();
        if (page === undefined || loadedPages.has(page)) continue;
        try {
          const response = await fetchHtml(new URL(`/post-${info.postId}-${page}`, windowObj.location.origin), {
            noStore,
            allowCache: options.allowCache === true,
            signal: options.signal,
            beforeRequest: requestGate.waitForRequestSlot,
            onResponse: requestGate.observeResponse,
          });
          const parsed = parseHtml(response.html, response.url);
          loadedPages.add(page);
          failedPages.delete(page);
          challengePages.delete(page);
          if (pageDocs) pageDocs.set(page, parsed);
          options.onPageLoaded?.(page, parsed, progressState());
          if (!onlyPages) {
            getPageNumbers(parsed, info.postId).forEach((foundPage) => {
              if (foundPage <= pageLimit && !pages.has(foundPage) && foundPage !== info.page) {
                pages.add(foundPage);
                pending.push(foundPage);
              }
            });
          }
        } catch (error) {
          failedPages.add(page);
          if (error?.code === 'CLOUDFLARE_CHALLENGE') challengePages.add(page);
          else challengePages.delete(page);
          options.onPageFailed?.(page, progressState());
        }
      }
    };

    const workerCount = Math.min(concurrency, Math.max(1, pending.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return {
      pageDocs,
      loadedPages: countedLoadedPages(),
      failedPages: [...failedPages].sort((a, b) => a - b),
      challengePages: [...challengePages].sort((a, b) => a - b),
      truncated,
      totalPages,
      pageLimit,
    };
  }

  async function loadPreviewRecords(info, firstDocument, options = {}) {
    const initialRecords = Array.isArray(options.initialRecords) ? options.initialRecords : null;
    const unique = new Map();
    const mergeRecords = (records) => records.forEach((record) => {
      const previous = unique.get(record.floor);
      if (!previous || record.current) unique.set(record.floor, record);
    });
    if (initialRecords) mergeRecords(initialRecords);
    const { loadedPages, failedPages, challengePages, truncated, totalPages, pageLimit } = await fetchPostPages(info, firstDocument, {
      ...options,
      retainDocuments: false,
      onPageLoaded: (page, root, progress) => {
        if (initialRecords && page === info.page) return;
        mergeRecords(collectPageRecords(info, root, page));
        options.onRecordsLoaded?.({
          records: Array.from(unique.values()),
          ...progress,
          page,
          loading: true,
        });
      },
      onPageFailed: (page, progress) => {
        options.onPageFailed?.(page, progress);
        options.onRecordsLoaded?.({
          records: Array.from(unique.values()),
          ...progress,
          page,
          loading: true,
        });
      },
    });
    return {
      records: Array.from(unique.values()),
      loadedPages,
      failedPages,
      challengePages,
      truncated,
      totalPages,
      pageLimit,
    };
  }

  return Object.freeze({ collectPageRecords, fetchPostPages, loadPreviewRecords });
}

const xnsPageLoader = createPageLoader({
  windowObj: window,
  maxPage: MAX_PAGE,
  getMaxPage,
  concurrency: PAGE_CONCURRENCY,
  requestGapMs: PAGE_REQUEST_GAP,
  fetchHtml,
  parseHtml,
  getPageNumbers,
  getCommentItems,
  getCommentRecord,
  getDocState,
  getCurrentUserUid,
});
const collectPageRecords = (...args) => xnsPageLoader.collectPageRecords(...args);
const fetchPostPages = (...args) => xnsPageLoader.fetchPostPages(...args);
const loadPreviewRecords = (...args) => xnsPageLoader.loadPreviewRecords(...args);


// 预览入口只负责识别“列表里的帖子标题”。
// 它不处理请求、弹窗内容或任何写操作，便于单独验证拦截范围。
function createPreviewEntryController({ document, location, parseSameOriginUrl, getPostInfo, openPreviewModal }) {
  const titleSelectors = [
    'h3 a[href]',
    '.post-item > a[href]',
    '.post-item h3 a[href]',
    '.post-list-item > a[href]',
    '.post-list-item h3 a[href]',
    '.post-list-item .post-title a[href]',
    '.topic-item h3 a[href]',
    '.topic-title a[href]',
  ];

  function isListTitle(link) {
    if (!link?.matches?.(titleSelectors.join(', '))) return false;
    return Boolean(link.closest('main, .post-list, .post-item, .post-list-item, .topic-item, .topic-title, h3'));
  }

  function handle(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (getPostInfo(location.href) || event.target.closest?.('.xns-overlay')) return;

    const link = event.target.closest?.('a[href]');
    if (!link || !isListTitle(link)) return;
    const url = parseSameOriginUrl(link.getAttribute('href') || '');
    if (!url || !getPostInfo(url.href)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openPreviewModal(url, link);
  }

  return Object.freeze({ handle, isListTitle });
}

function createFloorNavigationController({ enabled, handleFloorClick }) {
  function handle(event) {
    if (!enabled || event.defaultPrevented) return;
    handleFloorClick(event);
  }

  return Object.freeze({ handle });
}


// 楼层导航：只拦截当前帖子的楼层链接，并负责滚动与高亮。
function createFloorNavigation({ windowObj, documentObj, selectors, enabled, parseSameOriginUrl, getPostInfo, safePositiveInt }) {
  function scrollToFloor(floor) {
    let target = documentObj.querySelector(`[data-xns-floor="${CSS.escape(String(floor))}"]`);
    if (!target) {
      const virtualLists = Array.from(documentObj.querySelectorAll('.xns-virtual-list'));
      for (const list of virtualLists) {
        target = list.__xnsVirtualizer?.scrollToFloor(floor) || null;
        if (target) break;
      }
    }
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('xns-floor-highlight');
    windowObj.requestAnimationFrame(() => target.classList.add('xns-floor-highlight'));
    return true;
  }

  function handleFloorClick(event) {
    const link = event.target.closest?.('a[href]');
    if (!link || !link.closest(selectors.commentContainer) || link.closest('.xns-remote-floor-link')) return;
    const rawHref = link.getAttribute('href') || '';
    const directMatch = /^#([1-9]\d*)$/.exec(rawHref);
    const linkedUrl = directMatch ? null : parseSameOriginUrl(rawHref);
    const linkedInfo = linkedUrl ? getPostInfo(linkedUrl.href) : null;
    if (linkedInfo && enabled && linkedInfo.postId !== getPostInfo(windowObj.location.href)?.postId) return;
    const match = directMatch || (linkedUrl ? /^#([1-9]\d*)$/.exec(linkedUrl.hash || '') : null);
    if (!match) return;
    const floor = safePositiveInt(match[1]);
    if (floor === null || !scrollToFloor(floor)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  return Object.freeze({ scrollToFloor, handleFloorClick });
}

function createFloorNavigationFeature(options) {
  const navigation = createFloorNavigation(options);
  return { handle: navigation.handleFloorClick };
}

const xnsFloorNavigation = createFloorNavigationFeature({
  windowObj: window,
  documentObj: document,
  selectors: SELECTORS,
  enabled: Boolean(pageInfo),
  parseSameOriginUrl,
  getPostInfo,
  safePositiveInt,
});
const handleFloorClick = (...args) => xnsFloorNavigation.handle(...args);


// 评论动作功能：菜单、点赞/鸡腿/反对/收藏，以及预览中的回复/引用编辑器。
function createCommentActions({
  windowObj,
  documentObj,
  state,
  pageInfo,
  qs,
  qsa,
  createElement,
  getPostInfo,
  parseSameOriginUrl,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  findCommentList,
  postAction,
  loadPreviewModal,
}) {
  const PREVIEW_ACTIONS = [
    ['like', '点赞', '♡', true],
    ['chicken', '加鸡腿', '🍗', true],
    ['dislike', '反对', '♧', true],
    ['favorite', '收藏', '☆', true],
    ['quote', '引用', '❝', false],
    ['reply', '回复', '↩', false],
  ];
  const MENU_ITEMS_SELECTOR = ':scope > .menu-item';

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

  function createPreviewMenuItem([key, label, icon, withCount]) {
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
    item.setAttribute('aria-label', label);
    return item;
  }

  function createPreviewMenu(includeFavorite = true) {
    const menu = createElement('div', 'comment-menu xns-preview-menu');
    PREVIEW_ACTIONS
      .filter(([key]) => includeFavorite || key !== 'favorite')
      .forEach((action) => menu.appendChild(createPreviewMenuItem(action)));
    return menu;
  }

  function getMenuCountElement(menuItem) {
    return qsa(menuItem, ':scope > span').find((node) => /^\d+$/.test((node.textContent || '').trim())) || null;
  }

  function ensurePreviewMenu(comment, options = {}) {
    const includeFavorite = options.includeFavorite !== false;
    let menu = getDirectCommentMenu(comment);
    if (!menu) {
      menu = createPreviewMenu(includeFavorite);
      comment.appendChild(menu);
    }
    menu.classList.add('comment-menu', 'xns-preview-menu');
    let menuItems = qsa(menu, MENU_ITEMS_SELECTOR);
    if (!includeFavorite) {
      menuItems = menuItems.filter((item) => {
        if (getMenuActionKey(item) === 'favorite') {
          item.remove();
          return false;
        }
        return true;
      });
    }
    const existingActions = new Set(menuItems.map(getMenuActionKey).filter(Boolean));
    PREVIEW_ACTIONS
      .filter(([key]) => includeFavorite || key !== 'favorite')
      .filter(([key]) => !existingActions.has(key))
      .forEach((action) => {
        const item = createPreviewMenuItem(action);
        menu.appendChild(item);
        menuItems.push(item);
      });
    menuItems.forEach((item) => {
      const action = getMenuActionKey(item);
      if (action) {
        item.dataset.xnsAction = action;
        const actionMeta = PREVIEW_ACTIONS.find(([key]) => key === action);
        if (!item.hasAttribute('aria-label')) item.setAttribute('aria-label', actionMeta?.[1] || action);
        if (action === 'favorite' && /已收藏|取消收藏/.test(`${item.title} ${item.textContent}`)) item.dataset.xnsFavoriteState = 'added';
      }
      if (!item.hasAttribute('role')) item.setAttribute('role', 'button');
      if (!item.hasAttribute('tabindex')) item.tabIndex = 0;
    });
    const counts = options.counts || null;
    if (counts) {
      menuItems.forEach((item) => {
        const action = getMenuActionKey(item);
        const value = counts[action];
        const countNode = qs(item, ':scope > .xns-action-count') || getMenuCountElement(item);
        if (countNode && Number.isFinite(value) && value >= 0) countNode.textContent = String(value);
        if (action === 'favorite' && counts.collected && item.dataset.xnsFavoriteState !== 'removed') item.dataset.xnsFavoriteState = 'added';
      });
    }
    return menu;
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

  function getPageActionContext() {
    const info = pageInfo || getPostInfo(windowObj.location.href);
    return { modal: null, postId: info?.postId || '', url: parseSameOriginUrl(windowObj.location.href) };
  }

  function getActionContext(menuItem) {
    const modal = menuItem?.closest?.('.xns-overlay') ? state.modal : null;
    if (modal) return { modal, postId: modal.postId, url: modal.url };
    return getPageActionContext();
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
    qsa(copy, '.xns-remote-floor-link, .floor-link-wrapper').forEach((node) => node.remove());
    return (copy.innerText || copy.textContent || '').trim().slice(0, 12_000);
  }

  function getPreviewSourceUrl(comment, context = null) {
    const contextUrl = context?.url?.href || state.modal?.url?.href || windowObj.location.href;
    if (!comment) return contextUrl;
    const contextInfo = getPostInfo(contextUrl);
    const modalInfo = context?.postId
      ? { postId: String(context.postId), page: contextInfo?.page || 1 }
      : (contextInfo || (state.modal?.postId ? { postId: state.modal.postId, page: 1 } : null));
    if (!modalInfo) return contextUrl;
    const page = safePositiveInt(comment?.getAttribute('data-xns-source-page')) || modalInfo.page;
    const floor = getDisplayFloor(comment);
    const url = new URL(`/post-${modalInfo.postId}-${page}`, windowObj.location.origin);
    if (floor !== null) url.hash = String(floor);
    return url.href;
  }

  function getDirectComposer(comment) {
    return Array.from(comment?.children || []).find((child) => child.matches?.(':scope.xns-preview-composer')) || null;
  }

  function openPreviewComposer(action, comment, context = null) {
    const modal = context?.modal || state.modal;
    const actionContext = context || {
      modal,
      postId: modal?.postId || pageInfo?.postId || '',
      url: modal?.url || parseSameOriginUrl(windowObj.location.href),
    };
    const host = modal?.body || (comment ? comment : findCommentList());
    if (!host) return;
    const isPostReply = !comment || action === 'post-reply';
    const previousComposer = isPostReply ? (modal?.composer || state.post?.composer) : getDirectComposer(comment);
    previousComposer?.remove();
    const floor = isPostReply ? null : getDisplayFloor(comment);
    const author = isPostReply ? '' : getAuthorName(comment);
    const isReply = action === 'reply' && !isPostReply;
    const composer = createElement('section', 'xns-preview-composer');
    const floorLabel = floor === null ? '' : floor;
    const composerTitle = isPostReply ? '回复帖子' : `${isReply ? '回复' : '引用'} #${floorLabel} · ${author}`;
    composer.appendChild(createElement('h3', 'xns-preview-composer-title', composerTitle));
    const textarea = documentObj.createElement('textarea');
    textarea.setAttribute('aria-label', isPostReply || isReply ? '回复内容' : '引用内容');
    const sourceUrl = isPostReply ? (actionContext.url?.href || windowObj.location.href) : getPreviewSourceUrl(comment, actionContext);
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
    original.href = getPreviewSourceUrl(comment, actionContext);
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const cancel = createElement('button', '', '取消');
    cancel.type = 'button';
    const status = createElement('span', 'xns-preview-composer-status');
    actions.append(submit, original, cancel, status);
    composer.appendChild(actions);
    if (isPostReply && modal?.body) {
      modal.body.appendChild(composer);
      modal.composer = composer;
    } else {
      const menu = qs(comment, '.xns-preview-menu');
      if (menu) menu.insertAdjacentElement('afterend', composer);
      else host.appendChild(composer);
      if (isPostReply && state.post) state.post.composer = composer;
    }
    textarea.focus();
    composer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    cancel.addEventListener('click', () => {
      composer.remove();
      if (modal?.composer === composer) modal.composer = null;
      if (!modal && state.post?.composer === composer) state.post.composer = null;
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
        await postAction('/api/content/new-comment', { content, mode: 'new-comment', postId: Number(actionContext.postId) }, { context: actionContext });
        status.textContent = '回复已发送，正在更新楼中楼…';
        textarea.readOnly = true;
        submit.remove();
        if (actionContext.modal && state.modal === actionContext.modal) {
          if (actionContext.modal.composer === composer) actionContext.modal.composer = null;
          const refreshed = await loadPreviewModal(actionContext.modal, '正在更新回复…', { preserveContent: true });
          if (refreshed) composer.remove();
          else status.textContent = '回复已发送。帖子正在刷新中，楼中楼可能暂未包含新回复，请稍后再点刷新。';
        } else if (state.post) {
          const post = state.post;
          if (post.composer === composer) post.composer = null;
          composer.remove();
          await post.reloadPages({ refreshCurrentPage: true });
        }
      } catch (error) {
        status.textContent = `发送失败：${error.message || '网络错误'}`;
        submit.disabled = false;
      }
    });
  }

  async function runPreviewAction(action, menuItem, comment, context = null) {
    const actionContext = context || getActionContext(menuItem);
    if (action === 'quote' || action === 'reply') {
      openPreviewComposer(action, comment, actionContext);
      return;
    }
    const postId = safePositiveInt(actionContext?.postId || '');
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
    if (action === 'chicken' && !windowObj.confirm('确认给这条评论加鸡腿？NodeSeek 可能会消耗鸡腿。')) return;
    if (action === 'dislike' && !windowObj.confirm('确认反对这条评论？NodeSeek 可能会消耗两个鸡腿。')) return;
    const isFavoriteRemoval = action === 'favorite' && menuItem.dataset.xnsFavoriteState === 'added';
    menuItem.classList.add('xns-action-pending');
    menuItem.classList.remove('xns-action-failed');
    setActionState(menuItem, '处理中…');
    try {
      if (action === 'like') await postAction('/api/statistics/upvote', { commentId: targetId, action: 'add' }, { context: actionContext });
      else if (action === 'chicken') await postAction('/api/statistics/like', { commentId: targetId, action: 'add' }, { context: actionContext });
      else if (action === 'dislike') await postAction('/api/statistics/dislike', { commentId: targetId, action: 'add' }, { context: actionContext });
      else if (action === 'favorite') await postAction('/api/statistics/collection', { action: isFavoriteRemoval ? 'del' : 'add', postId }, { context: actionContext });
      if (action === 'favorite') {
        menuItem.dataset.xnsFavoriteState = isFavoriteRemoval ? 'removed' : 'added';
        bumpMenuCount(menuItem, isFavoriteRemoval ? -1 : 1);
      } else {
        menuItem.dataset.xnsActionDone = 'true';
        bumpMenuCount(menuItem, 1);
      }
      setActionState(menuItem, '✓');
      windowObj.setTimeout(() => {
        if (menuItem.isConnected && !menuItem.classList.contains('xns-action-failed')) qs(menuItem, ':scope > .xns-action-state')?.remove();
      }, 1_800);
    } catch (error) {
      setActionState(menuItem, `失败：${error.message || '操作未完成'}`, true);
    } finally {
      menuItem.classList.remove('xns-action-pending');
    }
  }

  return Object.freeze({
    getDirectCommentMenu,
    getMenuActionKey,
    ensurePreviewMenu,
    getActionContext,
    openPreviewComposer,
    runPreviewAction,
  });
}

const xnsCommentActions = createCommentActions({
  windowObj: window,
  documentObj: document,
  state,
  pageInfo,
  qs,
  qsa,
  createElement,
  getPostInfo,
  parseSameOriginUrl,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  findCommentList,
  postAction,
  loadPreviewModal: (...args) => loadPreviewModal(...args),
});
const getDirectCommentMenu = (...args) => xnsCommentActions.getDirectCommentMenu(...args);
const getMenuActionKey = (...args) => xnsCommentActions.getMenuActionKey(...args);
const ensurePreviewMenu = (...args) => xnsCommentActions.ensurePreviewMenu(...args);
const getActionContext = (...args) => xnsCommentActions.getActionContext(...args);
const openPreviewComposer = (...args) => xnsCommentActions.openPreviewComposer(...args);
const runPreviewAction = (...args) => xnsCommentActions.runPreviewAction(...args);


// 预览渲染辅助：只处理克隆节点的清理和跨页来源楼层链接。
function createPreviewRenderUtils({ qs, qsa, createElement }) {
  function stripRenderArtifacts(item) {
    if (!item?.classList) return;
    qsa(item, '.xns-reply-list, .xns-remote-floor-link').forEach((node) => node.remove());
    item.classList.remove('xns-comment-root', 'xns-comment-child', 'xns-floor-highlight');
    item.removeAttribute('data-xns-floor');
    item.removeAttribute('data-xns-depth');
    item.removeAttribute('data-xns-parent-floor');
    item.removeAttribute('data-xns-remote');
    item.removeAttribute('data-xns-source-page');
    item.style.removeProperty('--xns-indent');
  }

  function addRemoteNote(record, postId) {
    if (!record.node?.hasAttribute('data-xns-remote')) return;
    const meta = qs(record.node, ':scope > .nsk-content-meta-info');
    let source = qs(record.node, '.floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link');
    let wrapper = source?.closest('.floor-link-wrapper');
    if (!source) {
      wrapper = createElement('div', 'floor-link-wrapper');
      source = createElement('a', 'floor-link', `#${record.floor}`);
      wrapper.appendChild(source);
      (meta || record.node).appendChild(wrapper);
    } else {
      source.textContent = `#${record.floor}`;
      wrapper = wrapper || (() => {
        const created = createElement('div', 'floor-link-wrapper');
        source.replaceWith(created);
        created.appendChild(source);
        return created;
      })();
    }
    source.href = `/post-${postId}-${record.page}#${record.floor}`;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.title = `打开原楼层 #${record.floor}`;
    source.setAttribute('aria-label', `打开原楼层 #${record.floor}`);
    wrapper?.classList.add('xns-remote-floor-link');
  }

  return Object.freeze({ stripRenderArtifacts, addRemoteNote });
}

const xnsPreviewRenderUtils = createPreviewRenderUtils({ qs, qsa, createElement });
const stripRenderArtifacts = (...args) => xnsPreviewRenderUtils.stripRenderArtifacts(...args);
const addRemoteNote = (...args) => xnsPreviewRenderUtils.addRemoteNote(...args);


// 预览内容渲染服务。
// 这里仅负责把已加载的帖子记录转换成官方风格的楼层节点；网络读取由 page-loader 负责。
function createPreviewRenderer({
  document,
  windowObj,
  pageInfo,
  selectors,
  maxPage,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  getDocState,
  getCommentId,
  getSsrCommentCounts,
  safeCount,
  sanitizeImportedNode,
  materializeCommentNode,
  getDirectCommentMenu,
  ensurePreviewMenu,
  stripRenderArtifacts,
  buildReplyTree,
  flattenReplyTree,
  createCommentVirtualizer,
  addRemoteNote,
  formatPageStatus,
}) {
  function ensurePreviewEditOption(node, record) {
    if (!node || !record?.isMine) return;
    const menu = getDirectCommentMenu(node);
    if (!menu) return;
    let item = qsa(menu, ':scope > .menu-item').find((el) => (el.textContent || '').trim() === '编辑' && !el.dataset?.xnsAction);
    // 帖子详情页已有 NodeSeek/Vue 原生编辑项时直接保留。它带有官方事件
    // 处理器，由官方在楼层下方展开编辑器；脚本不能覆盖成打开新标签。
    // 如果原生项没有渲染出来，仍要先补回可见入口；后面不接管当前页的点击，
    // 避免把“修复显示”又回归成跳转行为。
    if (record.current && item) {
      item.setAttribute('aria-label', '编辑');
      return;
    }
    if (!item) {
      item = createElement('span', 'menu-item');
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.innerHTML = '<svg class="iconpark-icon" aria-hidden="true"><use href="#edit"></use></svg><span>编辑</span>';
      menu.appendChild(item);
    }
    item.setAttribute('aria-label', '编辑');
    if (record.current) return;
    if (item.dataset.xnsEditBound === 'true') return;
    item.dataset.xnsEditBound = 'true';
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const postId = record.postId || pageInfo?.postId || getPostInfo(windowObj.location.href)?.postId || '';
      const floor = record.floor;
      const url = `/post-${postId}-${record.page || 1}${floor >= 0 ? `#${floor}` : ''}`;
      windowObj.open(url, '_blank', 'noopener');
    });
  }

  function prepareCommentRecord(record, depth) {
    const node = materializeCommentNode(record);
    if (!node) return null;
    stripRenderArtifacts(record.node);
    node.setAttribute('data-xns-floor', String(record.floor));
    if (!record.current) {
      node.setAttribute('data-xns-remote', 'true');
      node.setAttribute('data-xns-source-page', String(record.page));
    }
    node.setAttribute('data-xns-depth', String(depth));
    node.style.setProperty('--xns-indent', `${Math.min(8, Math.max(0, depth)) * 18}px`);
    node.classList.add(depth === 0 ? 'xns-comment-root' : 'xns-comment-child');
    if (depth > 0 && record.parent) node.setAttribute('data-xns-parent-floor', String(record.parent.floor));
    ensurePreviewMenu(node, { includeFavorite: false, counts: record.counts || undefined });
    ensurePreviewEditOption(node, record);
    return node;
  }

  function appendNestedRecord(record, container, depth) {
    const node = prepareCommentRecord(record, depth);
    if (!node) return;
    container.appendChild(node);
    if (!record.children.length) return;
    const replyList = createElement('ul', 'xns-reply-list');
    record.children.forEach((child) => appendNestedRecord(child, replyList, depth + 1));
    node.appendChild(replyList);
  }

  function buildPreviewPostNode(parsed, info) {
    const postRoot = qs(parsed, '.nsk-post');
    const source = postRoot?.matches?.('.content-item')
      ? postRoot
      : qs(postRoot, ':scope > .content-item, .content-item') || postRoot || qs(parsed, selectors.postContent);
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
    const postState = getDocState(parsed);
    const postCommentId = getCommentId(node);
    const counts = postCommentId !== null && postState ? getSsrCommentCounts(postState, postCommentId) : null;
    if (counts) {
      const collectionCount = safeCount(postState?.postData?.collectionCount);
      if (collectionCount !== null) counts.favorite = collectionCount;
      if (postState?.postData?.collected) counts.collected = true;
    }
    ensurePreviewMenu(node, { includeFavorite: true, counts });
    return node;
  }

  function renderPreviewStatus(section, options = {}) {
    const status = formatPageStatus(options);
    const statusNode = options.statusNode || qs(section, ':scope > .xns-preview-status') || createElement('div', 'xns-preview-status');
    if (!statusNode.parentNode) section.insertBefore(statusNode, qs(section, ':scope > .xns-preview-thread'));
    clearElement(statusNode);
    statusNode.className = options.statusNode ? 'xns-modal-toolbar-status xns-preview-status' : 'xns-preview-status';
    statusNode.removeAttribute('title');
    statusNode.setAttribute('role', 'status');
    statusNode.setAttribute('aria-live', 'polite');
    if (options.loading) {
      statusNode.classList.add('is-loading');
      statusNode.appendChild(createElement('span', 'xns-page-loading', status.stage));
    } else if (status.stage) {
      statusNode.appendChild(createElement('span', 'xns-page-complete', status.stage));
    }
    if (status.failed) {
      statusNode.classList.add('is-failed');
      statusNode.appendChild(createElement('span', 'xns-page-failed', status.failed));
      if (typeof options.onRetry === 'function') {
        const retry = createElement('button', 'xns-inline-retry', '重试');
        retry.type = 'button';
        retry.title = '重新读取失败分页';
        retry.setAttribute('aria-label', '重新读取失败分页');
        retry.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          options.onRetry();
        });
        statusNode.appendChild(retry);
      }
    }
    if (status.challenge) {
      statusNode.classList.add('is-failed');
      statusNode.appendChild(createElement('span', 'xns-page-challenge', status.challenge));
    }
    if (status.truncated) {
      statusNode.classList.add('is-truncated');
      statusNode.appendChild(createElement('span', 'xns-page-truncated', status.truncated));
    }
    statusNode.hidden = !statusNode.childNodes.length;
    return statusNode;
  }

  function renderPreviewRecords(section, info, records, options = {}) {
    const heading = qs(section, ':scope > h3');
    const thread = qs(section, ':scope > .xns-preview-thread');
    if (!heading || !thread) return;
    heading.textContent = `楼中楼预览 · ${records.length} 条回复`;
    qs(section, ':scope > .xns-preview-empty')?.remove();
    if (records.length) {
      const onNodeMounted = (node, entry) => {
        const record = entry.record;
        if (record.page !== info.page) addRemoteNote(record, info.postId);
        options.onNodeMounted?.(node, record);
      };
      const onNodeUnmounted = (node, entry) => {
        if (!entry.record.current) entry.record.node = null;
        options.onNodeUnmounted?.(node, entry.record);
      };
      const renderItem = (entry) => prepareCommentRecord(entry.record, entry.depth);
      const virtualizer = section.__xnsVirtualizer || createCommentVirtualizer({
        windowObj,
        documentObj: document,
        createElement,
        estimatedHeight: 135,
        overscanScreens: 2,
      }).mount(thread, {
        getViewport: () => thread.closest('.xns-modal-body') || windowObj,
        renderItem,
        onMount: onNodeMounted,
        onUnmount: onNodeUnmounted,
      });
      section.__xnsVirtualizer = virtualizer;
      virtualizer.setEntries(flattenReplyTree(records), {
        getViewport: () => thread.closest('.xns-modal-body') || windowObj,
        renderItem,
        onMount: onNodeMounted,
        onUnmount: onNodeUnmounted,
      });
    } else {
      section.__xnsVirtualizer?.destroy();
      delete section.__xnsVirtualizer;
      clearElement(thread);
      section.appendChild(createElement('p', 'xns-status xns-preview-empty', '没有读取到评论。'));
    }
    renderPreviewStatus(section, options);
  }

  return Object.freeze({
    ensurePreviewEditOption,
    prepareCommentRecord,
    appendNestedRecord,
    buildPreviewPostNode,
    renderPreviewStatus,
    renderPreviewRecords,
  });
}

const xnsPreviewRenderer = createPreviewRenderer({
  document,
  windowObj: window,
  pageInfo,
  selectors: SELECTORS,
  maxPage: MAX_PAGE,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  getDocState,
  getCommentId,
  getSsrCommentCounts,
  safeCount,
  sanitizeImportedNode,
  materializeCommentNode,
  getDirectCommentMenu,
  ensurePreviewMenu,
  stripRenderArtifacts,
  buildReplyTree,
  flattenReplyTree,
  createCommentVirtualizer,
  addRemoteNote,
  formatPageStatus,
});

const ensurePreviewEditOption = (...args) => xnsPreviewRenderer.ensurePreviewEditOption(...args);
const prepareCommentRecord = (...args) => xnsPreviewRenderer.prepareCommentRecord(...args);
const appendNestedRecord = (...args) => xnsPreviewRenderer.appendNestedRecord(...args);
const buildPreviewPostNode = (...args) => xnsPreviewRenderer.buildPreviewPostNode(...args);
const renderPreviewStatus = (...args) => xnsPreviewRenderer.renderPreviewStatus(...args);
const renderPreviewRecords = (...args) => xnsPreviewRenderer.renderPreviewRecords(...args);


// 投票功能模块。
// 投票的读取、选择态、结果态和提交由这里管理；普通评论 reaction 不与它共享 UI 状态。
function createVoteFeature({
  windowObj,
  documentObj,
  qs,
  qsa,
  createElement,
  parseSameOriginUrl,
  safePositiveInt,
  dynamicSign,
  postAction,
  getActionContext,
  fetchFn,
}) {
  function getVoteIdFromLink(link) {
    const href = link.getAttribute('data-href') || link.getAttribute('href') || '';
    const match = /nsapp:\/\/vote\?id=(\d+)/.exec(href);
    return match ? safePositiveInt(match[1]) : null;
  }

  async function fetchVoteInfo(voteId) {
    const endpoint = parseSameOriginUrl(`/api/vote/info/${voteId}`);
    if (!endpoint) throw new Error('投票地址非法');
    const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (windowObj.crypto?.subtle) headers['x-dynamic-sign'] = await dynamicSign('GET', endpoint.href, '');
    const response = await fetchFn(endpoint.href, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'same-origin',
      headers,
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
    if (!response.ok || !data || data.success === false) throw new Error(data?.message || `HTTP ${response.status}`);
    return data;
  }

  function hasVoteResults(vote) {
    return (vote.items || []).some((item) => typeof item.count === 'number');
  }

  function buildVoteResults(vote) {
    const items = vote.items || [];
    const total = items.reduce((sum, item) => sum + (typeof item.count === 'number' ? item.count : 0), 0);
    const box = createElement('div', 'xns-vote-results');
    items.forEach((item) => {
      const count = typeof item.count === 'number' ? item.count : 0;
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      const row = createElement('div', `xns-vote-result${item.voted ? ' xns-vote-mine' : ''}`);
      row.appendChild(createElement('div', 'vote-item-text', item.text || ''));
      const barWrap = createElement('div', 'xns-vote-bar-wrap');
      const bar = createElement('div', 'xns-vote-bar');
      bar.style.width = `${percent}%`;
      bar.appendChild(documentObj.createTextNode(`${percent}%`));
      barWrap.appendChild(bar);
      row.appendChild(barWrap);
      row.appendChild(createElement('div', 'xns-vote-result-meta', `${count} 票${item.voted ? '（已选）' : ''}`));
      box.appendChild(row);
    });
    box.appendChild(createElement('div', 'xns-vote-total', `共 ${total} 票${vote.locked ? ' · 已结束' : ''}`));
    return box;
  }

  function buildVotePanel(vote) {
    const panel = createElement('div', 'vote-panel xns-vote-panel');
    panel.dataset.xnsVoteId = String(vote.id);
    const title = createElement('h2', 'xns-vote-title', vote.title || '投票');
    title.style.textAlign = 'center';
    title.style.fontSize = '1.2rem';
    panel.appendChild(title);
    if (hasVoteResults(vote)) {
      panel.appendChild(buildVoteResults(vote));
      panel.appendChild(createElement('div', 'xns-vote-note', `nsapp://vote?id=${vote.id}${vote.isPublic ? ' (公开投票)' : ''}${vote.locked ? ' · 已结束' : ''}`));
      return panel;
    }
    const single = vote.multiple !== true;
    const wrapper = createElement('fieldset', 'vote-stat-wrapper');
    (vote.items || []).forEach((item) => {
      const stat = createElement('div', `vote-stat${item.voted ? ' voted' : ' not-voted'}`);
      const input = documentObj.createElement('input');
      input.type = single ? 'radio' : 'checkbox';
      input.name = 'vote-item';
      input.value = String(item.vote_item_id);
      if (item.voted) input.checked = true;
      const label = createElement('label', 'pure-checkbox');
      label.appendChild(input);
      label.appendChild(createElement('div', 'vote-item-text', item.text || ''));
      stat.appendChild(label);
      wrapper.appendChild(stat);
    });
    panel.appendChild(wrapper);
    const buttons = createElement('fieldset', 'op-buttons');
    const submit = createElement('button', 'pure-button pure-button-primary add-margin', vote.locked ? '已结束' : '投票');
    submit.type = 'button';
    if (vote.locked) submit.setAttribute('disabled', '');
    buttons.appendChild(submit);
    panel.appendChild(buttons);
    panel.appendChild(createElement('div', 'xns-vote-note', `nsapp://vote?id=${vote.id}${vote.isPublic ? ' (公开投票)' : ''}`));
    return panel;
  }

  function mountVotePanel(link, data) {
    if (!link.isConnected) return;
    const vote = data?.vote;
    if (!vote || !Array.isArray(vote.items)) return;
    link.replaceWith(buildVotePanel(vote));
  }

  function scheduleVoteInfo(link, voteId) {
    const load = () => {
      if (!link.isConnected) return;
      void fetchVoteInfo(voteId)
        .then((data) => mountVotePanel(link, data))
        .catch(() => {
          if (link.isConnected) link.textContent = link.textContent || `投票 #${voteId}（需登录）`;
        });
    };
    if (typeof windowObj.IntersectionObserver === 'function') {
      let observer;
      observer = new windowObj.IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        load();
      }, { rootMargin: '600px 0px' });
      observer.observe(link);
      return;
    }
    if (typeof windowObj.requestIdleCallback === 'function') windowObj.requestIdleCallback(load, { timeout: 1_000 });
    else windowObj.setTimeout(load, 0);
  }

  function installPreviewVotePanels(root, options = {}) {
    const selector = '.xns-preview-content a[data-href^="nsapp://vote"], .xns-preview-content a[href^="nsapp://vote"]';
    const isPreviewRoot = root?.matches?.('.xns-preview-content') || root?.closest?.('.xns-preview-content');
    const relativeSelector = isPreviewRoot
      ? 'a[data-href^="nsapp://vote"], a[href^="nsapp://vote"]'
      : selector;
    const owner = root?.matches?.('.content-item') ? root : null;
    const links = [];
    if (root?.matches?.(selector)) links.push(root);
    links.push(...qsa(root, relativeSelector));
    links.filter((link) => {
      if (owner && link.closest?.('.content-item') !== owner) return false;
      if (options.skipRemote && (link.matches?.('[data-xns-remote]') || link.closest?.('[data-xns-remote]'))) return false;
      return true;
    }).forEach((link) => {
      if (link.dataset.xnsVoteBound === 'true') return;
      const voteId = getVoteIdFromLink(link);
      if (voteId === null) return;
      link.dataset.xnsVoteBound = 'true';
      scheduleVoteInfo(link, voteId);
    });
  }

  function getVoteStatus(panel) {
    let status = qs(panel, '.xns-vote-status');
    if (!status) {
      status = createElement('div', 'xns-vote-status');
      panel.appendChild(status);
    }
    return status;
  }

  function handleVoteClick(event) {
    const button = event.target.closest?.('.xns-vote-panel button');
    if (!button || button.disabled) return;
    const panel = button.closest('.xns-vote-panel');
    if (!panel || panel.dataset.xnsVotePending === 'true') return;
    const inPreview = Boolean(panel.closest('.xns-overlay .xns-preview-content'));
    const inRemote = Boolean(panel.closest('[data-xns-remote]'));
    if (!inPreview && !inRemote) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selected = qsa(panel, 'input[name="vote-item"]:checked').map((input) => input.value);
    const status = getVoteStatus(panel);
    if (!selected.length) {
      status.textContent = '请先选择选项。';
      return;
    }
    panel.dataset.xnsVotePending = 'true';
    button.setAttribute('disabled', '');
    status.textContent = '正在投票…';
    const voteId = safePositiveInt(panel.dataset.xnsVoteId || '');
    void postAction('/api/vote/voteforitem', { ids: selected.map((value) => Number(value)) }, { context: getActionContext(button) })
      .then(async () => {
        let refreshed = null;
        if (voteId !== null) {
          try { refreshed = await fetchVoteInfo(voteId); } catch { /* 保留成功提示 */ }
        }
        if (!panel.isConnected) return;
        if (refreshed?.vote) {
          panel.replaceWith(buildVotePanel(refreshed.vote));
        } else {
          status.textContent = '投票成功，感谢参与。';
          button.textContent = '已投票';
        }
      })
      .catch((error) => {
        status.textContent = `投票失败：${error.message || '网络错误'}`;
        button.removeAttribute('disabled');
        panel.dataset.xnsVotePending = '';
      });
  }

  return Object.freeze({ installPreviewVotePanels, handleVoteClick, fetchVoteInfo });
}

const xnsVoteFeature = createVoteFeature({
  windowObj: window,
  documentObj: document,
  qs,
  qsa,
  createElement,
  parseSameOriginUrl,
  safePositiveInt,
  dynamicSign,
  postAction,
  getActionContext,
  fetchFn: window.fetch.bind(window),
});
const installPreviewVotePanels = (...args) => xnsVoteFeature.installPreviewVotePanels(...args);
const handleVoteClick = (...args) => xnsVoteFeature.handleVoteClick(...args);
const fetchVoteInfo = (...args) => xnsVoteFeature.fetchVoteInfo(...args);


// 预览图片灯箱：只负责图片交互，不负责帖子弹窗或内容渲染。
function createPreviewLightbox({ windowObj, documentObj, state, qs, qsa, createElement, getSafeUrlAttribute }) {
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
    const preview = documentObj.createElement('img');
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
    documentObj.body.appendChild(overlay);
    state.lightbox = { overlay, cleanup };
    render();
    overlay.focus();
  }

  function installPreviewImageFallback(root, options = {}) {
    const isPreviewRoot = root?.matches?.('.xns-preview-content') || root?.closest?.('.xns-preview-content');
    const selector = isPreviewRoot ? 'img' : '.xns-preview-content img';
    const images = [];
    if (root?.matches?.('.xns-preview-content img')) images.push(root);
    const owner = root?.matches?.('.content-item') ? root : null;
    images.push(...qsa(root, selector));
    images.filter((image) => {
      if (owner && image.closest?.('.content-item') !== owner) return false;
      if (options.skipRemote && (image.matches?.('[data-xns-remote]') || image.closest?.('[data-xns-remote]'))) return false;
      return true;
    }).forEach((image) => {
      const deferredSource = image.getAttribute('data-xns-deferred-src');
      if (deferredSource) {
        if (!image.getAttribute('src')) image.setAttribute('src', deferredSource);
        image.removeAttribute('data-xns-deferred-src');
      }
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

  return Object.freeze({ closeImageLightbox, openImageLightbox, installPreviewImageFallback });
}

const xnsPreviewLightbox = createPreviewLightbox({
  windowObj: window,
  documentObj: document,
  state,
  qs,
  qsa,
  createElement,
  getSafeUrlAttribute,
});
const closeImageLightbox = (...args) => xnsPreviewLightbox.closeImageLightbox(...args);
const openImageLightbox = (...args) => xnsPreviewLightbox.openImageLightbox(...args);
const installPreviewImageFallback = (...args) => xnsPreviewLightbox.installPreviewImageFallback(...args);


// 预览弹窗 UI 基础设施：锁定页面、滚动控制、关闭操作。
function createPreviewModalUi({ windowObj, documentObj, state, createElement, closeImageLightbox }) {
  function removeBodyLock() {
    if (!state.modal) documentObj.documentElement.style.removeProperty('overflow');
  }

  function createScrollArrow(points) {
    const svg = documentObj.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const polyline = documentObj.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points);
    svg.appendChild(polyline);
    return svg;
  }

  function createRefreshArrow() {
    const svg = documentObj.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = documentObj.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 11a8 8 0 1 1-2.34-5.66');
    const polyline = documentObj.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '20 4 20 11 13 11');
    svg.append(path, polyline);
    return svg;
  }

  function createRefreshButton(onClick) {
    const button = createElement('button', 'xns-modal-tool xns-refresh-post');
    button.type = 'button';
    button.title = '刷新帖子';
    button.setAttribute('aria-label', '刷新帖子');
    button.append(createRefreshArrow(), createElement('span', 'xns-modal-tool-label', '刷新'));
    button.addEventListener('click', onClick);
    return button;
  }

  function createShareButton(onClick) {
    const button = createElement('button', 'xns-modal-tool xns-modal-share');
    button.type = 'button';
    button.title = '复制帖子链接';
    button.setAttribute('aria-label', '复制帖子链接');
    const label = createElement('span', 'xns-modal-tool-label', '分享');
    button.append(createCopyIcon(), label);
    button.addEventListener('click', () => {
      onClick?.({ setLabel: (value) => { label.textContent = value; } });
    });
    return button;
  }

  function createCopyIcon() {
    const svg = documentObj.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const back = documentObj.createElementNS('http://www.w3.org/2000/svg', 'rect');
    back.setAttribute('x', '5');
    back.setAttribute('y', '5');
    back.setAttribute('width', '11');
    back.setAttribute('height', '13');
    back.setAttribute('rx', '2');
    const front = documentObj.createElementNS('http://www.w3.org/2000/svg', 'path');
    front.setAttribute('d', 'M9 5V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2');
    svg.append(back, front);
    return svg;
  }

  function installPreviewScrollButtons(dialog, body) {
    const group = createElement('div', 'xns-preview-scroll-btns');
    group.setAttribute('role', 'toolbar');
    group.setAttribute('aria-label', '阅读导航');
    const top = createElement('button', 'xns-scroll-btn xns-to-top');
    top.type = 'button';
    top.title = '回到顶部';
    top.setAttribute('aria-label', '回到顶部');
    top.setAttribute('data-xns-tip', '回到顶部');
    top.appendChild(createScrollArrow('18 15 12 9 6 15'));
    const bottom = createElement('button', 'xns-scroll-btn xns-to-bottom');
    bottom.type = 'button';
    bottom.title = '回到底部';
    bottom.setAttribute('aria-label', '回到底部');
    bottom.setAttribute('data-xns-tip', '回到底部');
    bottom.appendChild(createScrollArrow('6 9 12 15 18 9'));
    const scrollTo = (edge) => {
      const topPosition = edge === 'bottom' ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
      body.scrollTo({ top: topPosition, behavior: 'smooth' });
    };
    top.addEventListener('click', () => scrollTo('top'));
    bottom.addEventListener('click', () => scrollTo('bottom'));
    group.append(top, bottom);
    dialog.appendChild(group);
    const update = () => {
      const distanceFromBottom = body.scrollHeight - (body.scrollTop + body.clientHeight);
      top.classList.toggle('hidden', body.scrollTop <= 300);
      bottom.classList.toggle('hidden', distanceFromBottom <= 300);
    };
    const cleanup = () => {
      body.removeEventListener('scroll', update);
      windowObj.removeEventListener('resize', update);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      group.remove();
    };
    const mutationObserver = windowObj.MutationObserver ? new windowObj.MutationObserver(update) : null;
    const resizeObserver = windowObj.ResizeObserver ? new windowObj.ResizeObserver(update) : null;
    body.addEventListener('scroll', update, { passive: true });
    windowObj.addEventListener('resize', update, { passive: true });
    mutationObserver?.observe(body, { childList: true, subtree: true });
    resizeObserver?.observe(body);
    windowObj.setTimeout(update, 0);
    update();
    return cleanup;
  }

  function closeModal() {
    closeImageLightbox();
    state.modal?.requestController?.abort();
    state.modal?.featureCleanup?.();
    state.modal?.refreshScrollCleanup?.();
    state.modal?.scrollCleanup?.();
    state.modal?.overlay?.remove();
    state.modal = null;
    removeBodyLock();
  }

  function createCloseButton(onClick) {
    const button = createElement('button', 'xns-modal-close', '×');
    button.type = 'button';
    button.setAttribute('aria-label', '关闭');
    button.title = '关闭预览（Esc）';
    button.addEventListener('click', onClick);
    return button;
  }

  return Object.freeze({ removeBodyLock, installPreviewScrollButtons, closeModal, createCloseButton, createRefreshButton, createShareButton });
}

const xnsPreviewModalUi = createPreviewModalUi({
  windowObj: window,
  documentObj: document,
  state,
  createElement,
  closeImageLightbox,
});
const removeBodyLock = (...args) => xnsPreviewModalUi.removeBodyLock(...args);
const installPreviewScrollButtons = (...args) => xnsPreviewModalUi.installPreviewScrollButtons(...args);
const closeModal = (...args) => xnsPreviewModalUi.closeModal(...args);
const createCloseButton = (...args) => xnsPreviewModalUi.createCloseButton(...args);
const createRefreshButton = (...args) => xnsPreviewModalUi.createRefreshButton(...args);
const createShareButton = (...args) => xnsPreviewModalUi.createShareButton(...args);


// 预览内容增强：ANSI、官方魔法标签页、Markdown 标签页、图片和代码复制。
function createContentFeatures({
  windowObj,
  documentObj,
  navigatorObj,
  qs,
  qsa,
  createElement,
  clearElement,
  installPreviewImageFallback,
  installPreviewVotePanels,
}) {
  const ANSI_COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  const NodeCtor = windowObj.Node;

  function createAnsiState() {
    return { fg: '', bg: '', bold: false, dim: false, italic: false, underline: false, strike: false, hidden: false, inverse: false };
  }

  function applyAnsiCodes(state, rawCodes) {
    const codes = rawCodes.length ? rawCodes : [0];
    for (let index = 0; index < codes.length; index += 1) {
      const code = Number(codes[index]);
      if (!Number.isFinite(code)) continue;
      if (code === 0) Object.assign(state, createAnsiState());
      else if (code === 1) state.bold = true;
      else if (code === 2) state.dim = true;
      else if (code === 3) state.italic = true;
      else if (code === 4) state.underline = true;
      else if (code === 7) state.inverse = true;
      else if (code === 8) state.hidden = true;
      else if (code === 9) state.strike = true;
      else if (code === 22) { state.bold = false; state.dim = false; }
      else if (code === 23) state.italic = false;
      else if (code === 24) state.underline = false;
      else if (code === 27) state.inverse = false;
      else if (code === 28) state.hidden = false;
      else if (code === 29) state.strike = false;
      else if (code === 39) state.fg = '';
      else if (code === 49) state.bg = '';
      else if (code >= 30 && code <= 37) state.fg = ANSI_COLORS[code - 30];
      else if (code >= 40 && code <= 47) state.bg = ANSI_COLORS[code - 40];
      else if (code >= 90 && code <= 97) state.fg = `bright-${ANSI_COLORS[code - 90]}`;
      else if (code >= 100 && code <= 107) state.bg = `bright-${ANSI_COLORS[code - 100]}`;
      else if (code === 38 || code === 48) {
        const mode = Number(codes[index + 1]);
        index += mode === 5 ? 2 : mode === 2 ? 4 : 0;
      }
    }
  }

  function getAnsiClasses(state) {
    return [
      state.fg && `xns-ansi-fg-${state.fg}`,
      state.bg && `xns-ansi-bg-${state.bg}`,
      state.bold && 'xns-ansi-bold',
      state.dim && 'xns-ansi-dim',
      state.italic && 'xns-ansi-italic',
      state.underline && 'xns-ansi-underline',
      state.strike && 'xns-ansi-strike',
      state.hidden && 'xns-ansi-hidden',
      state.inverse && 'xns-ansi-inverse',
    ].filter(Boolean);
  }

  function appendAnsiText(code, text, state) {
    if (!text) return;
    const classes = getAnsiClasses(state);
    if (!classes.length) {
      code.appendChild(documentObj.createTextNode(text));
      return;
    }
    const span = createElement('span', classes.join(' '));
    span.textContent = text;
    code.appendChild(span);
  }

  function isAnsiCodeBlock(pre) {
    const code = qs(pre, ':scope > code') || qs(pre, 'code');
    const className = `${String(pre.className || '')} ${String(code?.className || '')}`;
    return Boolean(code && /(?:^|\s)(?:language-ansi|lang-ansi|ansi)(?:\s|$)/i.test(className));
  }

  function serializeAnsiNode(node) {
    if (node.nodeType === NodeCtor.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== NodeCtor.ELEMENT_NODE) return '';
    let output = '';
    if (node.matches('span[data-ansicode]')) {
      const code = Number(node.getAttribute('data-ansicode'));
      if (Number.isInteger(code) && code >= 0 && code <= 127) output += String.fromCharCode(code);
    }
    Array.from(node.childNodes).forEach((child) => { output += serializeAnsiNode(child); });
    return output;
  }

  function renderAnsiCodeBlock(pre) {
    if (!isAnsiCodeBlock(pre)) return;
    const code = qs(pre, ':scope > code') || qs(pre, 'code');
    if (!code || code.dataset.xnsAnsiRendered === 'true') return;
    const source = serializeAnsiNode(code)
      .replace(/\u0008/g, '')
      .replace(/\u000d\u000a?/g, '\n')
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
    clearElement(code);
    const state = createAnsiState();
    const ansiPattern = /\u001b\[([0-9;]*)m/g;
    let cursor = 0;
    let match;
    while ((match = ansiPattern.exec(source))) {
      appendAnsiText(code, source.slice(cursor, match.index), state);
      applyAnsiCodes(state, match[1].split(';').filter((value) => value !== '').map(Number));
      cursor = ansiPattern.lastIndex;
    }
    appendAnsiText(code, source.slice(cursor), state);
    code.dataset.xnsAnsiRendered = 'true';
  }

  function queryPreviewContent(root, selector, options = {}) {
    if (!root) return [];
    const isPreviewRoot = root.matches?.('.xns-preview-content') || root.closest?.('.xns-preview-content');
    let querySelector = selector;
    if (isPreviewRoot) {
      querySelector = selector
        .split(',')
        .map((part) => part.trim().replace(/^\.xns-preview-content\s+/, ''))
        .join(', ');
    }
    const matches = [];
    if (root.matches?.(selector)) matches.push(root);
    matches.push(...qsa(root, querySelector));
    const owner = root.matches?.('.content-item') ? root : null;
    return matches.filter((node) => {
      if (owner && node.closest?.('.content-item') !== owner) return false;
      if (options.skipRemote && (node.matches?.('[data-xns-remote]') || node.closest?.('[data-xns-remote]'))) return false;
      return true;
    });
  }

  function installPreviewAnsiBlocks(root, options = {}) {
    queryPreviewContent(root, '.xns-preview-content pre', options).forEach(renderAnsiCodeBlock);
  }

  function installPreviewMagicTabs(root, options = {}) {
    queryPreviewContent(root, '.xns-preview-content .nsk-magic-tabs', options).forEach((tabs) => {
      if (tabs.dataset.xnsMagicTabsBound === 'true') return;
      const titles = qsa(tabs, ':scope > .nsk-magic-tab-title');
      const bodies = qsa(tabs, ':scope > .nsk-magic-tab-body');
      if (!titles.length || titles.length !== bodies.length) return;
      const activate = (selected) => {
        titles.forEach((title, index) => {
          const active = index === selected;
          title.classList.toggle('xns-active', active);
          title.setAttribute('aria-selected', active ? 'true' : 'false');
          bodies[index].classList.toggle('xns-active', active);
          bodies[index].setAttribute('aria-hidden', active ? 'false' : 'true');
        });
      };
      titles.forEach((title, index) => {
        title.setAttribute('role', 'tab');
        title.setAttribute('tabindex', '0');
        title.addEventListener('click', () => activate(index));
        title.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate(index);
          }
        });
      });
      bodies.forEach((body) => body.setAttribute('role', 'tabpanel'));
      activate(0);
      tabs.dataset.xnsMagicTabsBound = 'true';
    });
  }

  function getDirectiveText(node) {
    if (!node || node.nodeType !== NodeCtor.ELEMENT_NODE || node.matches('pre, code')) return '';
    return (node.textContent || '').trim().replace(/\s+/g, ' ');
  }

  function getMarkdownTabLabel(text) {
    const match = /^:::\s*tab-item(?:\s+(.+?))?\s*$/i.exec(text);
    return match?.[1]?.trim() || '标签页';
  }

  function installPreviewMarkdownTabs(root, options = {}) {
    const selector = '.xns-preview-content .post-content, .xns-preview-content article.post-content';
    const contents = queryPreviewContent(root, selector, options);
    contents.forEach((content) => {
      if (content.dataset.xnsTabsBound === 'true') return;
      const children = Array.from(content.children);
      const start = children.findIndex((node) => getDirectiveText(node) === ':::: tabs');
      if (start < 0) return;
      const tabs = [];
      const markers = [children[start]];
      let current = null;
      let end = -1;
      for (let index = start + 1; index < children.length; index += 1) {
        const node = children[index];
        const text = getDirectiveText(node);
        const tabMatch = /^:::\s*tab-item(?:\s+(.+?))?\s*$/i.exec(text);
        if (tabMatch) {
          current = { label: getMarkdownTabLabel(text), nodes: [] };
          tabs.push(current);
          markers.push(node);
          continue;
        }
        if (text === ':::') {
          markers.push(node);
          current = null;
          continue;
        }
        if (text === '::::') {
          markers.push(node);
          end = index;
          break;
        }
        if (current) current.nodes.push(node);
      }
      if (end < 0 || !tabs.length) return;
      const wrapper = createElement('section', 'xns-markdown-tabs');
      const nav = createElement('div', 'xns-markdown-tabs-nav');
      nav.setAttribute('role', 'tablist');
      wrapper.appendChild(nav);
      content.insertBefore(wrapper, children[start]);
      tabs.forEach((tab, tabIndex) => {
        const button = createElement('button', 'xns-markdown-tab', tab.label);
        const panel = createElement('div', 'xns-markdown-tab-panel');
        const active = tabIndex === 0;
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        panel.setAttribute('role', 'tabpanel');
        if (active) {
          button.classList.add('is-active');
          panel.classList.add('is-active');
        }
        tab.nodes.forEach((node) => panel.appendChild(node));
        button.addEventListener('click', () => {
          Array.from(nav.children).forEach((item, index) => {
            const selected = index === tabIndex;
            item.classList.toggle('is-active', selected);
            item.setAttribute('aria-selected', selected ? 'true' : 'false');
          });
          Array.from(wrapper.querySelectorAll('.xns-markdown-tab-panel')).forEach((item, index) => {
            item.classList.toggle('is-active', index === tabIndex);
          });
        });
        nav.appendChild(button);
        wrapper.appendChild(panel);
      });
      markers.forEach((node) => node.remove());
      content.dataset.xnsTabsBound = 'true';
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
    documentObj.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let copied = false;
    try { copied = documentObj.execCommand('copy'); } catch { copied = false; }
    textarea.remove();
    return copied;
  }

  function copyText(text) {
    if (navigatorObj.clipboard?.writeText) {
      return navigatorObj.clipboard.writeText(text).catch(() => {
        if (!fallbackCopyText(text)) throw new Error('copy failed');
      });
    }
    return fallbackCopyText(text) ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  function installPreviewCodeBlocks(root, options = {}) {
    queryPreviewContent(root, '.xns-preview-content pre', options).forEach((pre) => {
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
          windowObj.setTimeout(() => {
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

  function installPreviewFeatures(root, options = {}) {
    installPreviewMagicTabs(root, options);
    installPreviewMarkdownTabs(root, options);
    installPreviewAnsiBlocks(root, options);
    installPreviewImageFallback(root, options);
    installPreviewCodeBlocks(root, options);
    installPreviewVotePanels(root, options);
  }

  return Object.freeze({ installPreviewFeatures, installPreviewCodeBlocks });
}

const xnsContentFeatures = createContentFeatures({
  windowObj: window,
  documentObj: document,
  navigatorObj: navigator,
  qs,
  qsa,
  createElement,
  clearElement,
  installPreviewImageFallback,
  installPreviewVotePanels,
});
const installPreviewFeatures = (...args) => xnsContentFeatures.installPreviewFeatures(...args);
const installPreviewCodeBlocks = (...args) => xnsContentFeatures.installPreviewCodeBlocks(...args);


// 预览控制器：负责弹窗生命周期、刷新和滚动位置恢复。
function createPreviewController({
  windowObj,
  documentObj,
  state,
  selectors,
  maxPage,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  sanitizeImportedNode,
  parseHtml,
  fetchHtml,
  getPageNumbers,
  collectPageRecords,
  loadPreviewRecords,
  buildPreviewPostNode,
  renderPreviewRecords,
  installPreviewFeatures,
  installPreviewScrollButtons,
  closeImageLightbox,
  closeModal,
  createCloseButton,
  createRefreshButton,
  createShareButton,
  openPreviewComposer,
}) {
  async function copyPreviewLink(url, setLabel) {
    const text = url?.href || '';
    if (!text) throw new Error('原帖链接不可用');
    if (windowObj.navigator?.clipboard?.writeText) {
      await windowObj.navigator.clipboard.writeText(text);
    } else {
      const input = documentObj.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      documentObj.body.appendChild(input);
      input.select();
      const copied = documentObj.execCommand?.('copy');
      input.remove();
      if (!copied) throw new Error('浏览器拒绝复制');
    }
    setLabel?.('已复制');
    windowObj.setTimeout(() => setLabel?.('分享'), 1_800);
  }

  function getCanonicalPostUrl(url) {
    const info = getPostInfo(url?.href || '');
    if (!info) return url;
    const canonical = new URL(url.href);
    canonical.pathname = `/post-${info.postId}-1`;
    canonical.search = '';
    canonical.hash = '';
    return canonical;
  }

  function getPreviewHeaderMeta(parsed) {
    const textOf = (node) => node?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || '';
    const post = qs(parsed, '.nsk-post') || parsed;
    const nodeName = textOf(qs(post, '[data-node-name], .node-name, .node-title, .category-name'))
      || textOf(qsa(post, 'a[href*="/node/"], a[href*="/category/"]').find((link) => textOf(link)));
    const author = textOf(qs(post, '.nsk-content-meta-info a.author-name, .nsk-content-meta-info a[href*="/space/"], a.author-name'));
    const time = textOf(qs(post, '.nsk-content-meta-info time, .nsk-content-meta-info [datetime], time[datetime]'));
    return { node: nodeName, author, time, replyCount: null };
  }

  function updatePreviewHeaderMeta(modal, meta) {
    if (!modal?.headerMeta) return;
    const values = {
      node: meta?.node || '',
      author: meta?.author || '',
      time: meta?.time || '',
      replies: Number.isFinite(meta?.replyCount) ? `${meta.replyCount} 条回复` : '',
    };
    Object.entries(values).forEach(([key, value]) => {
      const item = modal.headerMeta[key];
      if (!item) return;
      item.value.textContent = value;
      item.item.hidden = !value;
    });
  }

  function createPreviewHeaderMeta() {
    const root = createElement('div', 'xns-modal-meta');
    const items = {};
    [['node', '节点'], ['author', '作者'], ['time', '时间'], ['replies', '回复']].forEach(([key, label]) => {
      const item = createElement('span', 'xns-modal-meta-item');
      item.hidden = true;
      item.append(createElement('span', 'xns-modal-meta-label', label), createElement('span', 'xns-modal-meta-value'));
      root.appendChild(item);
      items[key] = { item, value: item.lastElementChild };
    });
    return { root, items };
  }

  function buildPreviewContent(url, parsed, options = {}) {
    const wrapper = createElement('div', 'xns-preview-content');
    const title = qs(parsed, selectors.postTitle)?.textContent?.trim() || '';
    const headerMeta = getPreviewHeaderMeta(parsed);
    const info = getPostInfo(url.href);
    const importedPost = info ? buildPreviewPostNode(parsed, info) : null;
    if (importedPost) wrapper.appendChild(importedPost);
    else {
      const content = qs(parsed, selectors.postContent);
      const importedContent = sanitizeImportedNode(content);
      if (importedContent) wrapper.appendChild(importedContent);
      else wrapper.appendChild(createElement('p', 'xns-status', '没有找到帖子正文。'));
    }
    if (!info) return { title, headerMeta, content: wrapper, hydrate: null };
    const currentRecords = collectPageRecords(info, parsed, info.page);
    headerMeta.replyCount = currentRecords.length;
    const knownPages = getPageNumbers(parsed, info.postId);
    const hasRemotePages = Array.from(knownPages).some((page) => page !== info.page);
    const section = createElement('section', 'xns-preview-comments');
    section.appendChild(createElement('h3', '', '楼中楼预览'));
    const thread = createElement('ul', 'xns-preview-thread');
    section.appendChild(thread);
      renderPreviewRecords(section, info, currentRecords, {
        loading: hasRemotePages,
        statusNode: options.statusNode,
        onRetry: options.onRetry,
        onNodeMounted: (node) => installPreviewFeatures(node),
    });
    wrapper.appendChild(section);
    let progressiveTimer = 0;
    let pendingProgress = null;
    let renderedProgress = false;
    const renderProgress = (progress) => {
      if (!progress || !section.isConnected) return false;
      renderPreviewRecords(section, info, progress.records, {
        ...progress,
        statusNode: options.statusNode,
        onRetry: options.onRetry,
        onNodeMounted: (node) => installPreviewFeatures(node),
      });
      return true;
    };
    const scheduleProgressiveRender = (progress) => {
      if (options.renderDetached === true) return;
      pendingProgress = progress;
      if (progressiveTimer) return;
      // 第 2 页进入很短的合并窗口，后续页面按 500ms 合并，避免 50 页触发
      // 49 次完整树重排。全部请求很快完成时，定时批次会被最终渲染取消。
      progressiveTimer = windowObj.setTimeout(() => {
        progressiveTimer = 0;
        const next = pendingProgress;
        pendingProgress = null;
        if (renderProgress(next)) renderedProgress = true;
      }, renderedProgress ? 500 : 300);
    };
    const hydrate = loadPreviewRecords(info, parsed, {
      noStore: options.noStore === true,
      allowCache: options.allowCache === true,
      initialRecords: currentRecords,
      signal: options.signal,
      onRecordsLoaded: scheduleProgressiveRender,
    }).then((preview) => {
      if (progressiveTimer) windowObj.clearTimeout(progressiveTimer);
      progressiveTimer = 0;
      pendingProgress = null;
      if (section.isConnected || options.renderDetached === true) {
        renderPreviewRecords(section, info, preview.records, {
          ...preview,
          statusNode: options.statusNode,
          onRetry: options.onRetry,
          onNodeMounted: (node) => installPreviewFeatures(node),
        });
      }
      return preview;
    });
    return { title, headerMeta, content: wrapper, hydrate };
  }

  function getPreviewScrollOwners(body) {
    return qsa(body, '.xns-preview-post, .xns-preview-thread .content-item[data-comment-id], .xns-preview-thread .content-item[data-xns-floor]');
  }

  function getPreviewScrollOwner(node) {
    return node?.closest?.('.xns-preview-post, .xns-preview-thread .content-item[data-comment-id], .xns-preview-thread .content-item[data-xns-floor]') || null;
  }

  function getPreviewScrollCandidates(body) {
    const seen = new Set();
    const candidates = [];
    getPreviewScrollOwners(body).forEach((owner) => {
      const blocks = [owner, ...qsa(owner, ':scope > .post-title, :scope > .nsk-content-meta-info, :scope > article.post-content > *, :scope > .post-content > *')];
      blocks.forEach((node) => {
        if (!node || seen.has(node) || getPreviewScrollOwner(node) !== owner) return;
        seen.add(node);
        candidates.push(node);
      });
    });
    return candidates;
  }

  function getPreviewChildPath(owner, node) {
    const path = [];
    let current = node;
    while (current && current !== owner) {
      const parent = current.parentElement;
      if (!parent) return [];
      const index = Array.prototype.indexOf.call(parent.children, current);
      if (index < 0) return [];
      path.unshift(index);
      current = parent;
    }
    return current === owner ? path : [];
  }

  function capturePreviewScroll(body) {
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const snapshot = {
      scrollTop: body.scrollTop,
      maxScrollTop,
      ratio: maxScrollTop > 0 ? body.scrollTop / maxScrollTop : 0,
      atTop: body.scrollTop <= 3,
      atBottom: maxScrollTop - body.scrollTop <= 24,
      anchor: null,
    };
    if (snapshot.atTop || snapshot.atBottom || maxScrollTop === 0) return snapshot;
    const bodyRect = body.getBoundingClientRect();
    const anchorLine = bodyRect.top + Math.min(12, Math.max(2, body.clientHeight * 0.03));
    const rows = getPreviewScrollCandidates(body).map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 0 && rect.bottom > bodyRect.top && rect.top < bodyRect.bottom);
    const crossing = rows.filter(({ rect }) => rect.top <= anchorLine && rect.bottom > anchorLine);
    const chosen = crossing.reduce((best, row) => (!best || row.rect.top > best.rect.top ? row : best), null)
      || rows.filter(({ rect }) => rect.top > anchorLine).sort((left, right) => left.rect.top - right.rect.top)[0] || null;
    if (!chosen) return snapshot;
    const owner = getPreviewScrollOwner(chosen.node);
    if (!owner) return snapshot;
    const isPost = owner.matches('.xns-preview-post, [data-xns-target-type="post"]');
    snapshot.anchor = {
      isPost,
      commentId: isPost ? '' : (owner.getAttribute('data-comment-id') || ''),
      floor: owner.getAttribute('data-xns-floor') || '',
      path: getPreviewChildPath(owner, chosen.node),
      tagName: chosen.node.tagName,
      offset: chosen.rect.top - bodyRect.top,
    };
    return snapshot;
  }

  function findPreviewScrollOwner(body, anchor) {
    if (anchor.isPost) return qs(body, '.xns-preview-post, [data-xns-target-type="post"]');
    if (anchor.commentId) {
      const byCommentId = qs(body, `.xns-preview-thread .content-item[data-comment-id="${CSS.escape(anchor.commentId)}"]`);
      if (byCommentId) return byCommentId;
    }
    if (anchor.floor) return qs(body, `.xns-preview-thread .content-item[data-xns-floor="${CSS.escape(anchor.floor)}"]`);
    return null;
  }

  function resolvePreviewScrollAnchor(body, anchor) {
    const owner = findPreviewScrollOwner(body, anchor);
    if (!owner) return null;
    let node = owner;
    for (const index of anchor.path || []) {
      node = node?.children?.[index] || null;
      if (!node) return owner;
    }
    return !anchor.tagName || node.tagName === anchor.tagName ? node : owner;
  }

  function restorePreviewScroll(body, snapshot) {
    if (!snapshot) return;
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    if (snapshot.atTop) { body.scrollTop = 0; return; }
    if (snapshot.atBottom) { body.scrollTop = maxScrollTop; return; }
    const anchor = snapshot.anchor ? resolvePreviewScrollAnchor(body, snapshot.anchor) : null;
    if (anchor) {
      const currentOffset = anchor.getBoundingClientRect().top - body.getBoundingClientRect().top;
      const targetScrollTop = body.scrollTop + currentOffset - snapshot.anchor.offset;
      body.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
      return;
    }
    const proportional = Number.isFinite(snapshot.ratio) ? snapshot.ratio * maxScrollTop : snapshot.scrollTop;
    body.scrollTop = Math.max(0, Math.min(proportional, maxScrollTop));
  }

  function stabilizePreviewScroll(modal, snapshot, generation) {
    modal.refreshScrollCleanup?.();
    const body = modal.body;
    let active = true;
    let frame = 0;
    const timers = [];
    const imageHandlers = [];
    const apply = () => {
      frame = 0;
      if (!active || state.modal !== modal || modal.loadGeneration !== generation) return;
      restorePreviewScroll(body, snapshot);
    };
    const schedule = () => {
      if (!active || frame) return;
      frame = windowObj.requestAnimationFrame(apply);
    };
    const cleanup = () => {
      if (!active) return;
      active = false;
      if (frame) windowObj.cancelAnimationFrame(frame);
      timers.forEach((timer) => windowObj.clearTimeout(timer));
      resizeObserver?.disconnect();
      imageHandlers.forEach(({ image, done }) => {
        image.removeEventListener('load', done);
        image.removeEventListener('error', done);
      });
      ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((name) => modal.overlay.removeEventListener(name, cleanup, true));
      if (modal.refreshScrollCleanup === cleanup) modal.refreshScrollCleanup = null;
    };
    const resizeObserver = windowObj.ResizeObserver ? new windowObj.ResizeObserver(schedule) : null;
    resizeObserver?.observe(body.firstElementChild || body);
    qsa(body, 'img').forEach((image) => {
      if (image.complete) return;
      const done = () => schedule();
      imageHandlers.push({ image, done });
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
    });
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((name) => modal.overlay.addEventListener(name, cleanup, { capture: true, passive: true }));
    [0, 60, 180, 420, 900, 1_400].forEach((delay) => timers.push(windowObj.setTimeout(schedule, delay)));
    timers.push(windowObj.setTimeout(cleanup, 1_800));
    modal.refreshScrollCleanup = cleanup;
    restorePreviewScroll(body, snapshot);
  }

  function showPreviewLoadError(modal, error) {
    clearElement(modal.body);
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status');
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status is-failed';
      toolbarStatus.hidden = false;
      const detail = error?.message || '网络错误';
      toolbarStatus.textContent = '预览加载失败';
      toolbarStatus.title = detail;
    }
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
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status');
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status xns-refresh-status is-failed';
      toolbarStatus.hidden = false;
      const detail = error?.message || '网络错误';
      toolbarStatus.textContent = `刷新失败，保留当前内容 · ${detail}`;
      toolbarStatus.title = detail;
    }
  }

  function getPreviewFailedPages(modal) {
    return Array.from(new Set((Array.isArray(modal?.failedPages) ? modal.failedPages : [])
      .map((page) => Number(page))
      .filter((page) => Number.isInteger(page) && page >= 1)))
      .sort((a, b) => a - b);
  }

  async function retryPreviewPages(modal) {
    if (!modal || modal.loading) return false;
    const retryPages = getPreviewFailedPages(modal);
    const info = getPostInfo(modal.url?.href || '');
    const section = qs(modal.body, '.xns-preview-comments');
    if (!retryPages.length || !info || !section || !modal.previewSeed) return false;

    const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
    modal.requestController?.abort();
    modal.requestController = requestController;
    modal.loading = true;
    const refresh = qs(modal.dialog, '.xns-refresh-post');
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status');
    refresh?.classList.add('xns-action-pending');
    refresh?.setAttribute('aria-busy', 'true');
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status is-loading';
      toolbarStatus.hidden = false;
      toolbarStatus.removeAttribute('title');
      toolbarStatus.textContent = `正在重试 ${retryPages.length} 个失败分页…`;
    }

    const pageLimit = Math.min(maxPage, Math.max(1, Number(modal.pageLimit) || maxPage));
    const totalPages = Math.max(1, Number(modal.totalPages) || pageLimit);
    const targetPages = Math.min(pageLimit, totalPages);
    const loadedPages = Array.from({ length: targetPages }, (_, index) => index + 1)
      .filter((page) => !retryPages.includes(page));
    const retryAgain = () => {
      if (state.modal === modal && !modal.loading) void retryPreviewPages(modal);
    };
    const renderProgress = (progress, loading) => {
      if (state.modal !== modal || !progress) return;
      modal.failedPages = [...(progress.failedPages || [])];
      modal.totalPages = progress.totalPages || modal.totalPages;
      modal.pageLimit = progress.pageLimit || modal.pageLimit;
      const currentLimit = Math.min(maxPage, Math.max(1, Number(modal.pageLimit) || maxPage));
      const currentTotal = Math.max(1, Number(modal.totalPages) || currentLimit);
      modal.loadedPages = Math.max(0, Math.min(currentLimit, currentTotal) - modal.failedPages.length);
      modal.challengePages = [...(progress.challengePages || [])];
      renderPreviewRecords(section, info, progress.records, {
        ...progress,
        loadedPages: modal.loadedPages,
        statusNode: toolbarStatus,
        loading,
        onRetry: retryAgain,
        onNodeMounted: (node) => installPreviewFeatures(node),
      });
    };

    try {
      const preview = await loadPreviewRecords(info, modal.previewSeed, {
        noStore: true,
        allowCache: false,
        // 重试必须沿用本次预览的分页边界；设置面板可以在弹窗打开后被修改，
        // 但不能因此把当前失败页从重试目标中静默过滤掉。
        pageLimit,
        initialRecords: modal.previewRecords || [],
        onlyPages: retryPages,
        initialLoadedPages: loadedPages,
        initialFailedPages: retryPages,
        initialChallengePages: (modal.challengePages || []).filter((page) => retryPages.includes(Number(page))),
        signal: requestController?.signal,
        onRecordsLoaded: (progress) => renderProgress(progress, true),
      });
      if (state.modal !== modal) return false;
      modal.previewRecords = preview.records;
      modal.loadedPages = preview.loadedPages;
      modal.failedPages = preview.failedPages;
      modal.challengePages = preview.challengePages || [];
      modal.truncated = preview.truncated;
      modal.totalPages = preview.totalPages;
      modal.pageLimit = preview.pageLimit;
      renderProgress({ ...preview, records: preview.records }, false);
      updatePreviewHeaderMeta(modal, {
        node: modal.headerMeta?.node?.value?.textContent || '',
        author: modal.headerMeta?.author?.value?.textContent || '',
        time: modal.headerMeta?.time?.value?.textContent || '',
        replyCount: preview.records.length,
      });
      return true;
    } catch (error) {
      if (state.modal === modal) showPreviewRefreshError(modal, error);
      return false;
    } finally {
      if (modal.requestController === requestController) modal.requestController = null;
      modal.loading = false;
      refresh?.classList.remove('xns-action-pending');
      refresh?.removeAttribute('aria-busy');
    }
  }

  async function loadPreviewModal(modal, loadingText, options = {}) {
    if (!modal || modal.loading) return false;
    const preserveContent = Boolean(options.preserveContent);
    const fresh = preserveContent || options.noStore === true;
    const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
    modal.requestController?.abort();
    modal.requestController = requestController;
    modal.refreshScrollCleanup?.();
    modal.featureCleanup?.();
    modal.featureCleanup = null;
    modal.loading = true;
    const generation = (modal.loadGeneration || 0) + 1;
    modal.loadGeneration = generation;
    const refresh = qs(modal.dialog, '.xns-refresh-post');
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status');
    refresh?.classList.add('xns-action-pending');
    refresh?.setAttribute('aria-busy', 'true');
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status is-loading';
      toolbarStatus.hidden = false;
      toolbarStatus.removeAttribute('title');
      toolbarStatus.textContent = preserveContent ? '正在刷新…' : '正在读取…';
    }
    closeImageLightbox();
    if (!preserveContent) {
      modal.body.scrollTop = 0;
      clearElement(modal.body);
      modal.body.appendChild(createElement('p', 'xns-loading', loadingText));
    }
    try {
      const response = await fetchHtml(modal.url, { noStore: fresh, allowCache: !fresh, signal: requestController?.signal });
      const parsed = parseHtml(response.html, response.url);
      const preview = buildPreviewContent(modal.url, parsed, {
        noStore: fresh,
        allowCache: !fresh,
        renderDetached: preserveContent,
        signal: requestController?.signal,
        statusNode: toolbarStatus,
        onRetry: () => {
          if (state.modal === modal && !modal.loading) void retryPreviewPages(modal);
        },
      });
      let hydratedPreview = null;
      if (preserveContent && preview.hydrate) hydratedPreview = await preview.hydrate;
      if (state.modal !== modal || modal.loadGeneration !== generation) return false;
      const scrollSnapshot = preserveContent ? capturePreviewScroll(modal.body) : null;
      modal.title.textContent = preview.title || 'NodeSeek 帖子预览';
      updatePreviewHeaderMeta(modal, preview.headerMeta);
      clearElement(modal.body);
      modal.body.appendChild(preview.content);
      if (modal.composer && !modal.composer.isConnected) modal.body.appendChild(modal.composer);
      const previewPost = qs(modal.body, '.xns-preview-post');
      if (previewPost) installPreviewFeatures(previewPost);
      if (!preserveContent && preview.hydrate) {
        hydratedPreview = await preview.hydrate;
        if (state.modal !== modal || modal.loadGeneration !== generation) return false;
      }
      updatePreviewHeaderMeta(modal, {
        ...preview.headerMeta,
        replyCount: hydratedPreview?.records?.length ?? preview.headerMeta?.replyCount,
      });
      if (hydratedPreview) {
        modal.previewSeed = parsed;
        modal.previewRecords = hydratedPreview.records;
        modal.loadedPages = hydratedPreview.loadedPages;
        modal.failedPages = hydratedPreview.failedPages;
        modal.challengePages = hydratedPreview.challengePages || [];
        modal.truncated = hydratedPreview.truncated;
        modal.totalPages = hydratedPreview.totalPages;
        modal.pageLimit = hydratedPreview.pageLimit;
      }
      if (preserveContent) stabilizePreviewScroll(modal, scrollSnapshot, generation);
    } catch (error) {
      if (state.modal === modal && modal.loadGeneration === generation) {
        if (preserveContent) showPreviewRefreshError(modal, error);
        else showPreviewLoadError(modal, error);
      }
    } finally {
      if (modal.requestController === requestController) modal.requestController = null;
      modal.loading = false;
      refresh?.classList.remove('xns-action-pending');
      refresh?.removeAttribute('aria-busy');
    }
    return true;
  }

  function refreshPreviewModal() {
    const modal = state.modal;
    if (!modal || modal.loading) return;
    void loadPreviewModal(modal, '正在刷新帖子…', { preserveContent: true });
  }

  function openPreviewModal(url, fallbackLink) {
    closeModal();
    const fetchUrl = url.search || url.hash ? new URL(url.pathname, url.origin) : url;
    const shareUrl = getCanonicalPostUrl(fetchUrl);
    const overlay = createElement('div', 'xns-overlay');
    overlay.tabIndex = -1;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(); });
    const dialog = createElement('section', 'xns-modal');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const header = createElement('header', 'xns-modal-header');
    const heading = createElement('div', 'xns-modal-heading');
    heading.appendChild(createElement('span', 'xns-modal-eyebrow', 'NodeSeek 主题预览'));
    const title = createElement('h2', 'xns-modal-title', '正在加载帖子…');
    const headerMeta = createPreviewHeaderMeta();
    heading.append(title, headerMeta.root);
    const actions = createElement('div', 'xns-modal-actions');
    const replyPost = createElement('button', 'xns-modal-reply', '回复帖子');
    replyPost.type = 'button';
    replyPost.title = '回复帖子';
    replyPost.addEventListener('click', () => openPreviewComposer('post-reply', null));
    const original = createElement('a', 'xns-modal-original', '打开原帖');
    original.href = url.href;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    original.title = '在新标签打开原帖';
    const share = createShareButton(({ setLabel }) => {
      void copyPreviewLink(shareUrl, setLabel).catch(() => {
        setLabel('复制失败');
        windowObj.setTimeout(() => setLabel('分享'), 1_800);
      });
    });
    const close = createCloseButton(closeModal);
    actions.append(replyPost, original, share, close);
    header.append(heading, actions);
    const toolbar = createElement('div', 'xns-modal-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '预览工具');
    const toolbarStatus = createElement('span', 'xns-modal-toolbar-status xns-preview-status', '准备读取…');
    toolbar.append(
      createElement('span', 'xns-modal-toolbar-label', '阅读'),
      createElement('span', 'xns-modal-mode', '楼中楼'),
      toolbarStatus,
      createRefreshButton(() => { void refreshPreviewModal(); }),
    );
    const body = createElement('div', 'xns-modal-body');
    body.appendChild(createElement('p', 'xns-loading', '正在读取帖子内容…'));
    dialog.append(header, toolbar);
    dialog.appendChild(body);
    const scrollCleanup = installPreviewScrollButtons(dialog, body);
    overlay.appendChild(dialog);
    documentObj.body.appendChild(overlay);
    documentObj.documentElement.style.overflow = 'hidden';
    state.modal = { overlay, dialog, body, title, url: fetchUrl, fallbackLink, postId: getPostInfo(fetchUrl.href)?.postId || '', composer: null, scrollCleanup, featureCleanup: null, headerMeta: headerMeta.items, loading: false, loadGeneration: 0, requestController: null, toolbarStatus, previewSeed: null, previewRecords: [], loadedPages: 0, failedPages: [], challengePages: [], truncated: false, totalPages: null, pageLimit: maxPage };
    overlay.focus();
    void loadPreviewModal(state.modal, '正在读取帖子内容…');
  }

  return Object.freeze({ buildPreviewContent, loadPreviewModal, refreshPreviewModal, openPreviewModal });
}

const xnsPreviewController = createPreviewController({
  windowObj: window,
  documentObj: document,
  state,
  selectors: SELECTORS,
  maxPage: MAX_PAGE,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  sanitizeImportedNode,
  parseHtml,
  fetchHtml,
  getPageNumbers,
  collectPageRecords,
  loadPreviewRecords,
  buildPreviewPostNode,
  renderPreviewRecords,
  installPreviewFeatures,
  installPreviewScrollButtons,
  closeImageLightbox,
  closeModal,
  createCloseButton,
  createRefreshButton,
  createShareButton,
  openPreviewComposer: (...args) => openPreviewComposer(...args),
});
const buildPreviewContent = (...args) => xnsPreviewController.buildPreviewContent(...args);
const loadPreviewModal = (...args) => xnsPreviewController.loadPreviewModal(...args);
const refreshPreviewModal = (...args) => xnsPreviewController.refreshPreviewModal(...args);
const openPreviewModal = (...args) => xnsPreviewController.openPreviewModal(...args);


// 全局事件边界：把站点原生点击与脚本接管的预览动作分开。
function createAppEvents({ state, qsa, getMenuActionKey, getActionContext, runPreviewAction, closeImageLightbox, closeModal }) {
  function handlePreviewActionClick(event) {
    const menuItem = event.target.closest?.('.xns-preview-menu > .menu-item');
    if (!menuItem) return;
    const inPreview = Boolean(menuItem.closest('.xns-overlay .xns-preview-content'));
    const inPost = Boolean(menuItem.closest('.comment-container'));
    if (!inPreview && !inPost) return;
    const comment = menuItem.closest('.content-item');
    const action = menuItem.dataset.xnsAction || getMenuActionKey(menuItem);
    if (!comment) return;
    // 官方帖子页的“编辑”由 NodeSeek/Vue 处理。虚拟列表裁掉同级楼层后，
    // Vue 的事件状态可能失效；先恢复官方列表，再重新触发一次原生入口。
    if (inPost && !action && (menuItem.textContent || '').trim() === '编辑') {
      if (state.post?.prepareNativeEdit?.(comment)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void runPreviewAction(action, menuItem, comment, getActionContext(menuItem));
  }

  function handleKeydown(event) {
    const menuItem = event.target.closest?.('.xns-preview-menu > .menu-item');
    if (menuItem && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      menuItem.click();
      return;
    }
    const inEditor = event.target.closest?.('textarea, input, [contenteditable="true"]');
    if (event.key !== 'Escape') return;
    if (inEditor) return;
    if (state.settingsPanel) {
      event.preventDefault();
      state.settingsPanel.close?.();
      return;
    }
    if (state.lightbox) {
      event.preventDefault();
      closeImageLightbox();
    } else if (state.modal) {
      closeModal();
    }
  }

  return Object.freeze({ handlePreviewActionClick, handleKeydown });
}

const xnsAppEvents = createAppEvents({
  state,
  qsa,
  getMenuActionKey,
  getActionContext,
  runPreviewAction,
  closeImageLightbox,
  closeModal,
});
const handlePreviewActionClick = (...args) => xnsAppEvents.handlePreviewActionClick(...args);
const handleKeydown = (...args) => xnsAppEvents.handleKeydown(...args);


// 帖子详情页控制器。
// 它只管理原始楼层快照、评论布局模式和分页生命周期；预览入口由 preview/entry.js 管理。
function createPostPageController({
  documentObj,
  windowObj,
  appState,
  selectors,
  maxPage,
  findCommentList,
  createElement,
  qs,
  qsa,
  fetchHtml,
  parseHtml,
  getFloor,
  getCommentItems,
  sanitizeImportedNode,
  releaseCommentNode,
  getDocState,
  getCurrentUserUid,
  getCommentRecord,
  fetchPostPages,
  flattenReplyTree,
  createCommentVirtualizer,
  prepareCommentRecord,
  addRemoteNote,
  installPreviewFeatures,
  formatPageStatus,
  openSettings,
  updateSettings,
  getMaxPage,
}) {
  const NATIVE_EDIT_REQUEST_KEY = 'xns-comment-preview-native-edit';

  return class PostPageController {
    constructor(info) {
      this.info = info;
      this.list = null;
      this.originalChildren = [];
      this.records = [];
      this.loadedPages = 0;
      this.failedPages = [];
      this.challengePages = [];
      this.truncated = false;
      this.totalPages = null;
      this.toolbar = null;
      this.statusNode = null;
      this.loadingNode = null;
      this.toolbarStatusText = '';
      this.toolbarStatusTone = '';
      this.toolbarStatusDetail = '';
      this.loading = false;
      this.hasRemotePages = false;
      this.virtualizer = null;
      this.generation = 0;
      this.progressiveTimer = 0;
      this.progressiveRendered = false;
      this.composer = null;
      this.requestController = null;
    }

    consumeNativeEditRequest() {
      try {
        const raw = windowObj.sessionStorage?.getItem(NATIVE_EDIT_REQUEST_KEY);
        windowObj.sessionStorage?.removeItem(NATIVE_EDIT_REQUEST_KEY);
        const request = raw ? JSON.parse(raw) : null;
        if (!request || String(request.postId) !== String(this.info.postId)) return null;
        if (!/^\d{1,15}$/.test(String(request.floor))) return null;
        return String(request.floor);
      } catch {
        return null;
      }
    }

    openNativeEditAfterReload(floor) {
      const started = Date.now();
      const findEdit = () => {
        const comment = Array.from(this.list?.children || [])
          .find((node) => node.nodeType === 1 && String(node.id) === String(floor));
        return Array.from(comment?.querySelectorAll?.(':scope > .comment-menu > .menu-item, :scope > .comment-actions > .menu-item') || [])
          .find((item) => (item.textContent || '').trim() === '编辑');
      };
      const check = () => {
        const edit = findEdit();
        if (edit) {
          edit.click();
          return;
        }
        if (Date.now() - started < 12_000) windowObj.setTimeout(check, 80);
      };
      check();
    }

    async init() {
      this.list = await this.waitForCommentList();
      if (!this.list) return;
      this.originalChildren = Array.from(this.list.childNodes);
      this.createToolbar();
      const nativeEditFloor = this.consumeNativeEditRequest();
      if (nativeEditFloor) {
        appState.mode = 'original';
        this.showStatus('原版评论已恢复。');
        this.openNativeEditAfterReload(nativeEditFloor);
        return;
      }
      await this.reloadPages();
    }

    waitForCommentList() {
      return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
          const list = findCommentList();
          if (list || Date.now() - started > 12_000) resolve(list);
          else windowObj.setTimeout(check, 80);
        };
        check();
      });
    }

    createToolbar() {
      if (this.toolbar || !this.list) return;
      const toolbar = createElement('nav', 'xns-post-toolbar');
      toolbar.setAttribute('aria-label', '评论布局');
      toolbar.appendChild(createElement('span', 'xns-post-toolbar-label', '评论'));
      const modeSwitch = createElement('span', 'xns-post-mode-switch');
      modeSwitch.setAttribute('role', 'group');
      modeSwitch.setAttribute('aria-label', '评论布局');
      [['thread', '楼中楼', '切换到楼中楼布局'], ['original', '原版', '恢复官方评论布局']].forEach(([mode, text, title]) => {
        const button = createElement('button', '', text);
        button.type = 'button';
        button.dataset.mode = mode;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.addEventListener('click', () => this.setMode(mode));
        modeSwitch.appendChild(button);
      });
      toolbar.appendChild(modeSwitch);
      toolbar.appendChild(createElement('span', 'xns-toolbar-status'));
      const settings = createElement('button', 'xns-post-settings', '设置');
      settings.type = 'button';
      settings.title = '打开预览设置';
      settings.setAttribute('aria-label', '打开预览设置');
      settings.addEventListener('click', openSettings);
      toolbar.appendChild(settings);
      const refresh = createElement('button', 'xns-post-refresh', '刷新');
      refresh.type = 'button';
      refresh.title = '重新读取当前页和评论分页';
      refresh.setAttribute('aria-label', '重新读取当前页和评论分页');
      refresh.addEventListener('click', () => {
        if (this.loading) return;
        if (this.failedPages.length) void this.reloadPages({
          onlyPages: [...this.failedPages],
          initialChallengePages: [...this.challengePages],
        });
        else void this.reloadPages({ refreshCurrentPage: true });
      });
      toolbar.appendChild(refresh);
      const container = this.list.closest(selectors.commentContainer);
      container?.insertBefore(toolbar, this.list);
      this.toolbar = toolbar;
      this.updateToolbar();
    }

    updateToolbar() {
      if (!this.toolbar) return;
      qsa(this.toolbar, '[data-mode]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.mode === appState.mode));
      });
      const refresh = qs(this.toolbar, '.xns-post-refresh');
      if (refresh) {
        refresh.disabled = this.loading;
        refresh.setAttribute('aria-busy', String(this.loading));
        const retrying = !this.loading && this.failedPages.length > 0;
        refresh.textContent = retrying ? '重试' : '刷新';
        refresh.title = retrying ? '重新读取分页' : '重新读取当前页和评论分页';
        refresh.setAttribute('aria-label', retrying ? '重新读取分页' : '重新读取当前页和评论分页');
      }
      const status = qs(this.toolbar, '.xns-toolbar-status');
      if (!status) return;
      const text = this.toolbarStatusText || (this.records.length ? `${this.records.length} 条评论` : '读取中…');
      status.className = `xns-toolbar-status${this.toolbarStatusTone ? ` ${this.toolbarStatusTone}` : ''}`;
      status.textContent = text;
      const detail = this.toolbarStatusDetail || (text.length > 24 ? text : '');
      if (detail && detail !== text) status.title = detail;
      else if (text.length > 24) status.title = text;
      else status.removeAttribute('title');
    }

    async reloadPages(options = {}) {
      if (!this.list) return;
      const pageLimit = Math.min(maxPage, Math.max(1, Number(getMaxPage?.()) || maxPage));
      const retryPages = Array.isArray(options.onlyPages)
        ? [...new Set(options.onlyPages.map((page) => Number(page)).filter((page) => Number.isInteger(page) && page >= 1 && page <= pageLimit))]
        : [];
      const retryOnly = retryPages.length > 0;
      const generation = ++this.generation;
      this.clearProgressiveRender();
      this.progressiveRendered = false;
      this.requestController?.abort();
      const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
      this.requestController = requestController;
      this.loading = true;
      this.showLoading(retryOnly ? `正在重试 ${retryPages.length} 个失败分页…` : '正在读取评论分页…');
      try {
        if (options.refreshCurrentPage) await this.adoptNewReplies(generation, requestController?.signal);
        if (generation !== this.generation) return;
        if (!retryOnly) this.loadCurrentPage();
        if (appState.mode === 'thread') this.render({ progressive: true });
        await this.loadPages(generation, { ...options, onlyPages: retryOnly ? retryPages : undefined }, requestController?.signal);
        if (generation !== this.generation) return;
        this.clearProgressiveRender();
        this.loading = false;
        if (appState.mode === 'thread') this.render();
        else this.showStatus('原版评论已刷新。');
      } catch (error) {
        if (generation !== this.generation) return;
        this.restoreOriginal();
        this.showStatus(`楼中楼读取失败：${error.message || '网络错误'}，已保留原版布局。`);
      } finally {
        if (this.requestController === requestController) this.requestController = null;
        if (generation === this.generation) {
          this.clearProgressiveRender();
          this.loading = false;
          this.loadingNode?.remove();
          this.loadingNode = null;
          this.updateToolbar();
        }
      }
    }

    loadCurrentPage() {
      const state = getDocState(documentObj);
      const records = [];
      this.originalChildren.forEach((item, index) => {
        if (item.nodeType !== 1) return;
        const record = getCommentRecord(item, this.info.postId, this.info.page, index, true, {
          keepCommentMenu: true,
          state,
          getCurrentUserUid,
        });
        if (record) records.push(record);
      });
      this.records = records;
      this.loadedPages = 1;
      this.failedPages = [];
      this.challengePages = [];
      const discovered = getPageNumbers(documentObj, this.info.postId);
      this.totalPages = discovered.size ? Math.max(...discovered, this.info.page) : this.info.page;
      this.truncated = this.totalPages > getMaxPage();
      this.hasRemotePages = this.totalPages > 1 || this.info.page > 1;
    }

    async adoptNewReplies(generation, signal) {
      try {
        const response = await fetchHtml(new URL(`/post-${this.info.postId}-${this.info.page}`, windowObj.location.origin), { noStore: true, signal });
        if (generation !== this.generation) return;
        const parsed = parseHtml(response.html, response.url);
        const knownFloors = new Set(this.originalChildren
          .filter((node) => node.nodeType === Node.ELEMENT_NODE)
          .map((node) => getFloor(node))
          .filter((floor) => floor !== null));
        getCommentItems(parsed).forEach((item) => {
          const floor = getFloor(item);
          if (floor === null || knownFloors.has(floor)) return;
          const imported = sanitizeImportedNode(item, { keepCommentMenu: true });
          if (!imported) return;
          knownFloors.add(floor);
          this.list.appendChild(imported);
          this.originalChildren.push(imported);
        });
      } catch {
        // 当前页重抓失败不阻断：楼中楼仍按已有快照渲染。
      }
    }

    async loadPages(generation, options = {}, signal) {
      const retryPages = Array.isArray(options.onlyPages) ? options.onlyPages : [];
      const retryOnly = retryPages.length > 0;
      this.failedPages = retryOnly ? [...retryPages] : [];
      this.challengePages = retryOnly
        ? (options.initialChallengePages || []).filter((page) => retryPages.includes(Number(page))).map(Number)
        : [];
      const remoteRecords = [];
      const updateProgress = (progress) => {
        if (!progress || generation !== this.generation) return;
        this.loadedPages = progress.loadedPages;
        this.failedPages = [...progress.failedPages];
        this.challengePages = [...(progress.challengePages || [])];
        this.truncated = progress.truncated;
        this.totalPages = progress.totalPages;
        const unique = new Map();
        [...this.records, ...remoteRecords].forEach((record) => {
          const previous = unique.get(record.floor);
          if (!previous || record.current) unique.set(record.floor, record);
        });
        this.records = Array.from(unique.values());
        this.scheduleProgressiveRender(generation);
      };
      const fresh = options.noStore === true || options.refreshCurrentPage === true;
      const pageLimit = Math.min(maxPage, Math.max(1, Number(getMaxPage?.()) || maxPage));
      const knownTotalPages = Math.max(1, Number(this.totalPages) || pageLimit);
      const initialLoadedPages = retryOnly
        ? Array.from({ length: Math.min(pageLimit, knownTotalPages) }, (_, index) => index + 1)
          .filter((page) => !retryPages.includes(page))
        : undefined;
      const { loadedPages, failedPages, challengePages, truncated, totalPages } = await fetchPostPages(this.info, documentObj, {
        noStore: fresh,
        allowCache: !fresh,
        retainDocuments: false,
        ...(retryOnly ? {
          onlyPages: retryPages,
          initialLoadedPages,
          initialFailedPages: retryPages,
          initialChallengePages: (options.initialChallengePages || []).filter((page) => retryPages.includes(Number(page))),
        } : {}),
        signal,
        onPageLoaded: (page, root, progress) => {
          if (page !== this.info.page) {
            remoteRecords.push(...this.collectRemoteRecords(root, page));
            updateProgress(progress);
          }
        },
        onPageFailed: (_page, progress) => updateProgress(progress),
        isAborted: () => generation !== this.generation,
      });
      if (generation !== this.generation) return;
      this.loadedPages = loadedPages;
      this.failedPages = failedPages;
      this.challengePages = challengePages;
      this.truncated = truncated;
      this.totalPages = totalPages;

      const allRecords = [...this.records, ...remoteRecords];
      const unique = new Map();
      allRecords.forEach((record) => {
        const previous = unique.get(record.floor);
        if (!previous || record.current) unique.set(record.floor, record);
      });
      this.records = Array.from(unique.values());
    }

    scheduleProgressiveRender(generation) {
      if (generation !== this.generation || appState.mode !== 'thread' || this.progressiveTimer) return;
      const delay = this.progressiveRendered ? 500 : 300;
      this.progressiveTimer = windowObj.setTimeout(() => {
        this.progressiveTimer = 0;
        if (generation !== this.generation || !this.loading || appState.mode !== 'thread') return;
        this.progressiveRendered = true;
        this.render({ progressive: true });
      }, delay);
    }

    clearProgressiveRender() {
      if (this.progressiveTimer) windowObj.clearTimeout(this.progressiveTimer);
      this.progressiveTimer = 0;
    }

    collectRemoteRecords(root, page) {
      const state = getDocState(root);
      return getCommentItems(root)
        .map((item, index) => getCommentRecord(item, this.info.postId, page, index, false, {
          keepCommentMenu: true,
          state,
          getCurrentUserUid,
        }))
        .filter(Boolean);
    }

    setMode(mode) {
      if (!['thread', 'original'].includes(mode)) return;
      appState.mode = mode;
      this.updateToolbar();
      if (mode === 'original') this.restoreOriginal();
      else if (this.records.length) {
        // 原版布局会同时释放远端节点和序列化快照；切回时按正常分页流程重建。
        const needsReload = this.records.some((record) => !record.current && !record.node && !record.html);
        if (needsReload) this.reloadPages();
        else this.render();
      }
      else this.reloadPages();
      updateSettings({ mode });
    }

    prepareNativeEdit(comment) {
      if (!this.virtualizer || !this.originalChildren.includes(comment)) return false;
      const floor = comment.getAttribute('data-xns-floor') || comment.id || '';
      if (!/^\d{1,15}$/.test(String(floor))) return false;
      try {
        windowObj.sessionStorage?.setItem(NATIVE_EDIT_REQUEST_KEY, JSON.stringify({
          postId: this.info.postId,
          floor: String(floor),
        }));
      } catch {
        return false;
      }
      windowObj.location.reload();
      return true;
    }

    showLoading(text) {
      this.loadingNode?.remove();
      this.loadingNode = null;
      this.toolbarStatusText = this.records.length ? `${this.records.length} 条评论` : text;
      this.toolbarStatusTone = 'is-loading';
      this.toolbarStatusDetail = text;
      this.updateToolbar();
    }

    showStatus(text, tone = '', visibleText = '') {
      this.statusNode?.remove();
      this.statusNode = null;
      this.toolbarStatusText = visibleText || (this.records.length ? `${this.records.length} 条评论` : text);
      this.toolbarStatusTone = tone;
      this.toolbarStatusDetail = text;
      this.updateToolbar();
    }

    render(options = {}) {
      if (!this.list || appState.mode !== 'thread') return;
      if (!this.virtualizer) {
        this.restoreOriginal({ releaseRemote: false });
        // 帖子详情页复用官方的 ul.comments；补上预览线程作用域，
        // 让根楼层蓝栏、楼号和其他预览样式与弹窗预览保持一致。
        this.list.classList.add('xns-preview-thread');
        this.virtualizer = createCommentVirtualizer({
          windowObj,
          documentObj,
          createElement,
          estimatedHeight: 135,
          overscanScreens: 2,
        }).mount(this.list, {
          getViewport: () => windowObj,
          renderItem: (entry) => prepareCommentRecord(entry.record, entry.depth),
          onMount: (node, entry) => {
            const record = entry.record;
            if (!record.current) {
              addRemoteNote(record, this.info.postId);
              node.classList.add('xns-preview-content');
              installPreviewFeatures(node);
            }
          },
          onUnmount: (node, entry) => {
            if (!entry.record.current) releaseCommentNode(entry.record);
          },
        });
      }
      this.virtualizer.setEntries(flattenReplyTree(this.records), {
        getViewport: () => windowObj,
        renderItem: (entry) => prepareCommentRecord(entry.record, entry.depth),
        onMount: (node, entry) => {
          const record = entry.record;
          if (!record.current) {
            addRemoteNote(record, this.info.postId);
            node.classList.add('xns-preview-content');
            installPreviewFeatures(node);
          }
        },
        onUnmount: (node, entry) => {
          if (!entry.record.current) releaseCommentNode(entry.record);
        },
      });
      const loadedPages = this.loadedPages;
      const loading = this.loading || options.progressive;
      const pagination = formatPageStatus({
        loadedPages,
        totalPages: this.totalPages,
        failedPages: this.failedPages,
        challengePages: this.challengePages,
        truncated: this.truncated,
        loading: loading && this.hasRemotePages,
        commentCount: this.records.length,
      });
      const detail = pagination.detail || '暂无分页信息';
      this.showStatus(`楼中楼已整理 · ${detail}`, pagination.tone, pagination.compact);
    }

    restoreOriginal(options = {}) {
      if (!this.list) return;
      this.virtualizer?.destroy();
      this.virtualizer = null;
      this.list.classList.remove('xns-preview-thread');
      qsa(this.list, '.xns-reply-list, .xns-remote-note').forEach((node) => node.remove());
      this.originalChildren.forEach(stripRenderArtifacts);
      while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
      this.originalChildren.forEach((node) => this.list.appendChild(node));
      if (options.releaseRemote !== false) this.records.forEach(releaseCommentNode);
      this.statusNode?.remove();
      this.statusNode = null;
      this.loadingNode?.remove();
      this.loadingNode = null;
      if (appState.mode === 'original') {
        this.toolbarStatusText = '原版评论';
        this.toolbarStatusTone = '';
        this.toolbarStatusDetail = '';
      } else {
        this.toolbarStatusText = '';
        this.toolbarStatusTone = '';
        this.toolbarStatusDetail = '';
      }
      this.updateToolbar();
    }
  };
}

const PostEnhancer = createPostPageController({
  documentObj: document,
  windowObj: window,
  appState: state,
  selectors: SELECTORS,
  maxPage: MAX_PAGE,
  findCommentList,
  createElement,
  qs,
  qsa,
  fetchHtml,
  parseHtml,
  getFloor,
  getCommentItems,
  sanitizeImportedNode,
  releaseCommentNode,
  getDocState,
  getCurrentUserUid,
  getCommentRecord,
  fetchPostPages,
  flattenReplyTree,
  createCommentVirtualizer,
  prepareCommentRecord,
  addRemoteNote,
  installPreviewFeatures,
  formatPageStatus,
  openSettings,
  updateSettings,
  getMaxPage,
});


// 全局样式注入。样式是构建期静态资源，运行时只负责一次性安装。
function createStyleInstaller({ documentObj, styleId, ansiColors, ansiFgHex, ansiBgHex, ansiBrightHex, styleTokens, settingsStyles, previewShellStyles }) {
function ansiRulesFor(prefix, property, hexes) {
  return ansiColors.map((name, index) => `.xns-preview-content .xns-ansi-${prefix}-${name} { ${property}:${hexes[index]}; }`).join(' ');
}

function installStyle() {
  if (documentObj.getElementById(styleId)) return;
  const style = documentObj.createElement('style');
  style.id = styleId;
  style.textContent = `
      ${styleTokens}
      ${settingsStyles}
      ${previewShellStyles}
      .xns-post-toolbar, .xns-post-toolbar * { box-sizing: border-box; }
      .xns-post-toolbar { position:fixed; right:42px; bottom:166px; z-index:1000; display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin:0; padding:7px; border:1px solid var(--xns-border); border-radius:8px; color:var(--xns-text); background:rgba(248,250,252,.96); font:13px/1.3 system-ui,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.25); }
      .xns-post-toolbar button { padding:5px 10px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:transparent; cursor:pointer; font:inherit; }
      .xns-post-toolbar button:hover, .xns-post-toolbar button:focus-visible { border-color:var(--xns-accent-strong); outline:none; }
      .xns-post-toolbar button[aria-pressed="true"] { color:var(--xns-accent); border-color:var(--xns-accent-strong); background:var(--xns-accent-soft); }
      .xns-post-settings { margin-left:0 !important; }
      .xns-post-toolbar-label { color:var(--xns-muted); font-size:12px; }
      .xns-post-mode-switch { display:inline-flex; padding:2px; border:1px solid rgba(100,116,139,.25); border-radius:6px; background:rgba(148,163,184,.08); }
      .xns-post-mode-switch button { padding:4px 8px; border:0; border-radius:4px; background:transparent; }
      .xns-post-mode-switch button:hover, .xns-post-mode-switch button:focus-visible { border-color:transparent; color:#2563eb; background:#eff6ff; }
      .xns-post-mode-switch button[aria-pressed="true"] { border-color:transparent; color:#1d4ed8; background:#fff; box-shadow:0 1px 3px rgba(15,23,42,.12); }
      .xns-toolbar-status { display:inline-flex; align-items:center; gap:6px; max-width:min(62vw,720px); min-width:0; margin-left:auto; overflow:hidden; color:#64748b; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
      .xns-toolbar-status.is-loading::before { width:8px; height:8px; flex:0 0 8px; border:2px solid rgba(37,99,235,.22); border-top-color:#2563eb; border-radius:50%; content:""; animation:xns-spin .9s linear infinite; }
      .xns-toolbar-status.is-failed { color:var(--xns-danger); }
      .xns-loading, .xns-status { margin:10px 0; padding:7px 10px; border:1px solid rgba(100,116,139,.2); border-radius:7px; color:#64748b; background:rgba(148,163,184,.08); font:13px/1.4 system-ui,sans-serif; }
      .xns-comment-root[data-xns-floor], .xns-comment-child[data-xns-floor] { position:relative; }
      .xns-preview-thread .floor-link-wrapper, .xns-preview-content .floor-link-wrapper { position:absolute; top:9px; right:10px; }
      .xns-preview-thread .floor-link-wrapper .floor-link, .xns-preview-content .floor-link-wrapper .floor-link { padding:2px 5px; border-radius:4px; color:#c5c5c5; background:rgba(148,163,184,.1); font-size:13px; font-weight:400; line-height:19.5px; text-decoration:none; cursor:pointer; }
      .xns-preview-thread .floor-link-wrapper .floor-link:hover, .xns-preview-thread .floor-link-wrapper .floor-link:focus-visible, .xns-preview-content .floor-link-wrapper .floor-link:hover, .xns-preview-content .floor-link-wrapper .floor-link:focus-visible { color:#2563eb; background:#eff6ff; outline:none; }
      .xns-comment-child { margin-top:7px !important; margin-left:clamp(8px,2vw,28px) !important; padding-left:clamp(8px,1.5vw,18px) !important; border-left:2px solid rgba(59,130,246,.35); }
      .xns-reply-list { margin:6px 0 0 !important; padding:0 !important; list-style:none !important; }
      .xns-floor-highlight { animation:xns-floor-highlight 1.8s ease both; }
      @keyframes xns-floor-highlight { 0%,100%{box-shadow:none} 20%{box-shadow:0 0 0 4px rgba(59,130,246,.3)} }
      .xns-preview-content { font-size:14px; line-height:1.45; }
      .xns-preview-content pre { box-sizing:border-box; max-width:100%; overflow:auto; white-space:pre; }
      .xns-preview-content pre.xns-code-block { position:relative !important; padding-top:30px; font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; }
      .xns-preview-content pre.xns-code-block code { font:inherit; }
      .xns-preview-content .xns-code-copy-btn { position:absolute; top:8px; right:8px; z-index:2; padding:2px 8px; border:0; border-radius:3px; color:#fff; background:#4caf50; cursor:pointer; font:12px/1.2 system-ui,sans-serif; opacity:.85; }
      .xns-preview-content .xns-code-copy-btn:hover, .xns-preview-content .xns-code-copy-btn:focus-visible { opacity:1; outline:none; }
      .xns-preview-content .xns-code-copy-btn.xns-copy-failed { background:#dc2626; }
      ${ansiRulesFor('fg', 'color', ansiFgHex)}
      ${ansiRulesFor('fg-bright', 'color', ansiBrightHex)}
      ${ansiRulesFor('bg', 'background', ansiBgHex)}
      ${ansiRulesFor('bg-bright', 'background', ansiBrightHex)}
      .xns-preview-content .xns-ansi-bold { font-weight:700; } .xns-preview-content .xns-ansi-dim { opacity:.72; } .xns-preview-content .xns-ansi-italic { font-style:italic; } .xns-preview-content .xns-ansi-underline { text-decoration:underline; } .xns-preview-content .xns-ansi-strike { text-decoration:line-through; } .xns-preview-content .xns-ansi-hidden { visibility:hidden; } .xns-preview-content .xns-ansi-inverse { filter:invert(1); }
      .xns-preview-content .xns-markdown-tabs { margin:8px 0; overflow:hidden; border:1px solid rgba(100,116,139,.24); border-radius:7px; background:#f8fafc; }
      .xns-preview-content .xns-markdown-tabs-nav { display:flex; align-items:center; flex-wrap:wrap; gap:4px; padding:5px 6px; border-bottom:1px solid rgba(100,116,139,.2); background:rgba(148,163,184,.1); }
      .xns-preview-content .xns-markdown-tab { padding:5px 9px; border:1px solid transparent; border-radius:5px; color:#64748b; background:transparent; cursor:pointer; font:13px/1.25 system-ui,sans-serif; }
      .xns-preview-content .xns-markdown-tab:hover, .xns-preview-content .xns-markdown-tab:focus-visible { color:#2563eb; outline:none; }
      .xns-preview-content .xns-markdown-tab.is-active { border-color:rgba(59,130,246,.28); color:#1d4ed8; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.08); }
      .xns-preview-content .xns-markdown-tab-panel { display:none; padding:8px 10px; }
      .xns-preview-content .xns-markdown-tab-panel.is-active { display:block; }
      .xns-preview-content .nsk-magic-tabs { margin:8px 0; overflow:hidden; border:1px solid rgba(100,116,139,.24); border-radius:7px; background:#f8fafc; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title { display:inline-block; box-sizing:border-box; margin:0; padding:8px 12px; border:1px solid transparent; border-bottom:0; color:#64748b; background:transparent; cursor:pointer; font-size:14px; line-height:1.3; vertical-align:bottom; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title:hover, .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title:focus-visible { color:#2563eb; outline:none; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title.xns-active { border-color:rgba(100,116,139,.24); border-radius:7px 7px 0 0; color:#1d4ed8; background:#fff; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-body { display:none; clear:both; box-sizing:border-box; padding:8px 10px; border-top:1px solid rgba(100,116,139,.24); }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-body.xns-active { display:block; }
      .xns-preview-content h1, .xns-preview-content h2, .xns-preview-content h3, .xns-preview-content p { line-height:1.45; }
      .xns-preview-content h1, .xns-preview-content h2, .xns-preview-content h3 { margin-top:0; }
      .xns-preview-content p { margin:3px 0 6px; }
      .xns-preview-post { margin:0 0 10px; padding:8px 10px; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface-muted); }
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
      .xns-virtual-list > .xns-virtual-spacer { display:block !important; height:0; margin:0 !important; padding:0 !important; border:0 !important; list-style:none !important; pointer-events:none; }
      .xns-virtual-list > .content-item[data-xns-depth] { margin-left:var(--xns-indent,0px) !important; }
      .xns-preview-thread > .content-item { margin:4px 0; padding:8px 10px 7px; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface-muted); content-visibility:auto; contain-intrinsic-size:150px; }
      .xns-preview-thread > .content-item[data-xns-floor] { border-left:3px solid rgba(37,99,235,.72); }
      .xns-preview-thread .xns-comment-child { margin:3px 0 0 14px !important; padding:7px 8px 6px 10px !important; border:0 !important; border-left:2px solid rgba(59,130,246,.4) !important; border-radius:0 !important; background:transparent !important; }
      .xns-preview-thread .nsk-content-meta-info { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; margin:0 0 3px; color:#64748b; font-size:12px; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .content-info, .xns-preview-content .nsk-content-meta-info .date-created { display:inline-flex; align-items:center; flex-wrap:wrap; gap:5px; margin:0 !important; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .date-created time { display:inline; white-space:nowrap; }
      .xns-preview-content .user-info-display { position:static !important; display:inline-flex !important; align-items:center; transform:none !important; margin:0 !important; padding:0 !important; }
      .xns-preview-thread .post-content, .xns-preview-thread article.post-content { margin:0; line-height:1.45; }
      .xns-preview-thread .post-content p, .xns-preview-thread article.post-content p { margin:2px 0 4px; }
      .xns-preview-thread .post-content > :first-child, .xns-preview-thread article.post-content > :first-child { margin-top:0; }
      .xns-preview-thread .post-content > :last-child, .xns-preview-thread article.post-content > :last-child { margin-bottom:0; }
      .xns-preview-thread .comment-menu, .xns-preview-menu { display:flex; align-items:center; flex-wrap:wrap; gap:2px 5px; margin-top:7px; padding-top:5px; border-top:1px solid rgba(100,116,139,.13); color:#8b95a1; font:12px/1.2 system-ui,sans-serif; }
      .xns-preview-thread .comment-menu > .menu-item, .xns-preview-menu > .menu-item { display:inline-flex; align-items:center; gap:4px; min-height:22px; padding:2px 5px; border:0; border-radius:4px; color:inherit; background:transparent; cursor:pointer; text-decoration:none; }
      .xns-preview-thread .comment-menu > .menu-item:hover, .xns-preview-thread .comment-menu > .menu-item:focus-visible, .xns-preview-menu > .menu-item:hover, .xns-preview-menu > .menu-item:focus-visible { color:#2563eb; background:#eff6ff; outline:none; }
      .xns-preview-thread .comment-menu > .menu-item[data-xns-action="quote"], .xns-preview-thread .comment-menu > .menu-item[data-xns-action="reply"], .xns-preview-menu > .menu-item[data-xns-action="quote"], .xns-preview-menu > .menu-item[data-xns-action="reply"] { margin-left:4px; }
      .xns-preview-thread .xns-action-icon, .xns-preview-menu .xns-action-icon { display:inline-flex; min-width:14px; justify-content:center; color:inherit; font-size:14px; line-height:1; }
      .xns-preview-thread .xns-action-count, .xns-preview-menu .xns-action-count { font-variant-numeric:tabular-nums; }
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
      .xns-preview-content .vote-panel { margin:8px 0; }
      .xns-preview-content .vote-panel .pure-form { padding:2px 0; }
      .xns-preview-content .vote-panel form { background:#fbfbfb; border:1px solid rgba(100,116,139,.2); border-radius:7px; padding:8px 10px; }
      .xns-preview-content .vote-panel .vote-stat { display:flex; align-items:flex-start; gap:6px; margin:4px 0; }
      .xns-preview-content .vote-panel input[type="radio"] { margin-top:3px; flex:0 0 auto; }
      .xns-preview-content .vote-panel button { margin-top:8px; padding:4px 14px; border:1px solid rgba(0,120,231,.4); border-radius:6px; color:#0078e7; background:transparent; cursor:pointer; font:13px/1.3 system-ui,sans-serif; }
      .xns-preview-content .vote-panel button:disabled { opacity:.55; cursor:not-allowed; }
      .xns-vote-status { margin-top:6px; color:#64748b; font-size:12px; }
      .xns-vote-status:empty { display:none; }
      .xns-vote-results { display:flex; flex-direction:column; gap:6px; margin:4px 0 6px; }
      .xns-vote-results .xns-vote-result { display:flex; flex-direction:column; gap:2px; }
      .xns-vote-results .vote-item-text { font-size:13px; line-height:1.3; }
      .xns-vote-results .xns-vote-bar-wrap { height:16px; border:1px solid rgba(100,116,139,.25); border-radius:4px; background:rgba(148,163,184,.12); overflow:hidden; }
      .xns-vote-results .xns-vote-bar { box-sizing:border-box; min-width:26px; height:100%; padding:0 6px; display:flex; align-items:center; justify-content:flex-end; color:#fff; background:#3b82f6; font:11px/16px system-ui,sans-serif; border-radius:3px 0 0 3px; }
      .xns-vote-results .xns-vote-mine .vote-item-text { color:#1d4ed8; font-weight:600; }
      .xns-vote-results .xns-vote-result-meta { color:#64748b; font-size:12px; }
      .xns-vote-total { margin-top:4px; color:#64748b; font-size:12px; }
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
      .dark-layout .xns-preview-post, .dark-layout .xns-preview-thread > .content-item { color:#e5e7eb; background:#111827; }
      .dark-layout .xns-preview-thread > .content-item[data-xns-floor] { border-left-color:#60a5fa; }
      .dark-layout .xns-preview-thread .xns-comment-child { border-left-color:rgba(96,165,250,.6) !important; }
      .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link { background:rgba(148,163,184,.14); }
      .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link:hover, .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link:focus-visible, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link:hover, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link:focus-visible { color:#93c5fd; background:rgba(59,130,246,.18); }
      .dark-layout .xns-preview-thread .comment-menu > .menu-item:hover, .dark-layout .xns-preview-thread .comment-menu > .menu-item:focus-visible, .dark-layout .xns-preview-menu > .menu-item:hover, .dark-layout .xns-preview-menu > .menu-item:focus-visible { color:#93c5fd; background:rgba(59,130,246,.18); }
      .dark-layout .xns-preview-content pre.xns-code-block { color:#e5e7eb; background:#0b1220; }
      .dark-layout .xns-preview-content .xns-ansi-fg-black { color:#e5e7eb; } .dark-layout .xns-preview-content .xns-ansi-fg-white { color:#111827; }
      .dark-layout .xns-preview-content .xns-markdown-tabs { background:#111827; } .dark-layout .xns-preview-content .xns-markdown-tabs-nav { background:rgba(15,23,42,.65); } .dark-layout .xns-preview-content .xns-markdown-tab.is-active { color:#93c5fd; background:#18202b; }
      .dark-layout .xns-preview-content .nsk-magic-tabs { background:#111827; } .dark-layout .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title.xns-active { color:#93c5fd; background:#18202b; }
      .dark-layout .xns-post-toolbar { color:#e5e7eb; background:#1e293b; border-color:rgba(148,163,184,.3); }
      .dark-layout .xns-post-toolbar button { color:#e5e7eb; border-color:rgba(148,163,184,.35); }
      .dark-layout .xns-post-toolbar button[aria-pressed="true"] { color:#93c5fd; border-color:#3b82f6; background:rgba(59,130,246,.22); }
      .dark-layout .xns-post-toolbar-label { color:#9ca3af; }
      .dark-layout .xns-post-mode-switch { border-color:rgba(148,163,184,.35); background:rgba(15,23,42,.35); }
      .dark-layout .xns-post-mode-switch button { border-color:transparent; }
      .dark-layout .xns-post-mode-switch button:hover, .dark-layout .xns-post-mode-switch button:focus-visible { color:#93c5fd; background:rgba(59,130,246,.18); }
      .dark-layout .xns-post-mode-switch button[aria-pressed="true"] { color:#93c5fd; background:#111827; box-shadow:0 1px 3px rgba(0,0,0,.3); }
      .dark-layout .xns-preview-composer textarea { color:#e5e7eb; }
      .dark-layout .xns-preview-composer button, .dark-layout .xns-preview-composer a { color:#e5e7eb; border-color:rgba(148,163,184,.35); }
      .dark-layout .xns-preview-content .vote-panel form { color:#e5e7eb; background:#111827; border-color:rgba(148,163,184,.25); }
      .dark-layout .xns-preview-content .vote-panel button { color:#93c5fd; border-color:rgba(59,130,246,.5); }
      .dark-layout .xns-vote-results .xns-vote-bar { color:#0b1220; background:#60a5fa; }
      .dark-layout .xns-vote-results .xns-vote-mine .vote-item-text { color:#93c5fd; }
      .dark-layout .xns-toolbar-status, .dark-layout .xns-preview-status, .dark-layout .xns-loading, .dark-layout .xns-status, .dark-layout .xns-vote-status { color:#9ca3af; }
      .dark-layout .xns-toolbar-status.is-failed { color:#fca5a5; }
      .dark-layout .xns-preview-status.is-failed { color:#fca5a5; }
      .dark-layout .xns-preview-status.is-truncated { color:#fcd34d; }
      .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link { color:#6b7280; }
      @media (max-width:640px) { .xns-preview-post { padding:7px 8px; } .xns-preview-post h1, .xns-preview-post h1.post-title, .xns-preview-post .post-title { font-size:18px; } .xns-lightbox { padding:10px; } .xns-lightbox-image { max-width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .xns-toolbar-status { width:100%; max-width:none; margin-left:0; } }
    `;
  (documentObj.head || documentObj.documentElement || documentObj.body)?.appendChild(style);
}

  return Object.freeze({ ansiRulesFor, installStyle });
}

const xnsStyleInstaller = createStyleInstaller({
  documentObj: document,
  styleId: STYLE_ID,
  ansiColors: ANSI_COLORS,
  ansiFgHex: ANSI_FG_HEX,
  ansiBgHex: ANSI_BG_HEX,
  ansiBrightHex: ANSI_BRIGHT_HEX,
  styleTokens: XNS_STYLE_TOKENS,
  settingsStyles: XNS_SETTINGS_STYLES,
  previewShellStyles: XNS_PREVIEW_SHELL_STYLES,
});
const ansiRulesFor = (...args) => xnsStyleInstaller.ansiRulesFor(...args);
const installStyle = (...args) => xnsStyleInstaller.installStyle(...args);


// 应用启动：集中注册事件并在 DOM ready 后初始化帖子页增强。
function createAppBootstrap({
  documentObj,
  windowObj,
  pageInfo,
  state,
  installStyle,
  createPreviewEntryController,
  createFloorNavigationController,
  parseSameOriginUrl,
  getPostInfo,
  openPreviewModal,
  handleFloorClick,
  handlePreviewActionClick,
  handleVoteClick,
  handleKeydown,
  PostEnhancer,
}) {
  function start() {
    installStyle();
    const previewEntry = createPreviewEntryController({
      document: documentObj,
      location: windowObj.location,
      parseSameOriginUrl,
      getPostInfo,
      openPreviewModal,
    });
    const floorNavigation = createFloorNavigationController({
      enabled: Boolean(pageInfo),
      handleFloorClick,
    });
    documentObj.addEventListener('click', handlePreviewActionClick, true);
    documentObj.addEventListener('click', handleVoteClick, true);
    documentObj.addEventListener('click', previewEntry.handle, true);
    documentObj.addEventListener('click', floorNavigation.handle, true);
    documentObj.addEventListener('keydown', handleKeydown, true);

    const ready = () => {
      if (!pageInfo || state.post) return;
      state.post = new PostEnhancer(pageInfo);
      state.post.init().catch(() => state.post?.restoreOriginal());
    };
    if (documentObj.readyState === 'loading') documentObj.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
  }

  return Object.freeze({ start });
}

const xnsAppBootstrap = createAppBootstrap({
  documentObj: document,
  windowObj: window,
  pageInfo,
  state,
  installStyle,
  createPreviewEntryController,
  createFloorNavigationController,
  parseSameOriginUrl,
  getPostInfo,
  openPreviewModal,
  handleFloorClick,
  handlePreviewActionClick,
  handleVoteClick,
  handleKeydown,
  PostEnhancer,
});
xnsAppBootstrap.start();

})();
