import { SELECTORS } from './config.js';

// 通用 DOM 与输入安全工具；不包含 NodeSeek 业务规则。
interface DomToolsDeps {
  documentObj: Document;
  windowObj: Window;
  selectors: typeof SELECTORS;
  URLCtor: typeof URL;
}

function createDomTools({ documentObj, windowObj, selectors, URLCtor }: DomToolsDeps) {
  function safePositiveInt(value: unknown): number | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    const text = String(value);
    if (!/^\d{1,15}$/.test(text)) return null;
    const number = Number(text);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function safeCount(value: unknown): number | null {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
  }

  function qs<T extends Element = Element>(root: ParentNode | null | undefined, selector: string): T | null {
    return root?.querySelector<T>(selector) || null;
  }

  function qsa<T extends Element = Element>(root: ParentNode | null | undefined, selector: string): T[] {
    return root ? Array.from(root.querySelectorAll<T>(selector)) : [];
  }

  function createElement(tagName: string, className?: string, text?: string): HTMLElement {
    const element = documentObj.createElement(tagName);
    if (className) element.className = className;
    if (typeof text === 'string') element.textContent = text;
    return element;
  }

  function clearElement(element: Element): void {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function findCommentList(root: ParentNode = documentObj): Element | null {
    return qs(root, selectors.commentList);
  }

  function getCommentItems(root: ParentNode = documentObj): Element[] {
    const list = findCommentList(root);
    if (!list) return [];
    return Array.from(list.children).filter((item) => item.matches?.(selectors.commentItem));
  }

  function getFloor(item: Element | null | undefined): number | null {
    return safePositiveInt(item?.getAttribute('id') || '');
  }

  function getCommentId(item: Element | null | undefined): number | null {
    return safePositiveInt(item?.getAttribute('data-comment-id') || '');
  }

  function getAuthorName(item: Element | null | undefined): string {
    const profile = qs(item, ':scope > .nsk-content-meta-info a.author-name, :scope > .nsk-content-meta-info a[href^="/space/"], :scope > .nsk-content-meta-info a[href*="/space/"]');
    const profileName = profile?.textContent?.trim();
    if (profileName) return profileName.slice(0, 80);
    const avatarAlt = qs(item, ':scope > .nsk-content-meta-info img[alt]')?.getAttribute('alt')?.trim();
    return avatarAlt ? avatarAlt.slice(0, 80) : '该用户';
  }

  function getPostContent(item: Element | null | undefined): Element | null {
    return qs(item, ':scope > article.post-content, :scope > .post-content') || qs(item, selectors.postContent);
  }

  function getSafeUrlAttribute(name: string, rawValue: unknown): string | null {
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
const {
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
} = xnsDomTools;

export { clearElement, createElement, findCommentList, getAuthorName, getCommentId, getCommentItems, getFloor, getPostContent, getSafeUrlAttribute, qs, qsa, safeCount, safePositiveInt };
