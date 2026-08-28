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
