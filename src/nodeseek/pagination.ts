import { qsa } from '../core/dom.js';
import { getPostInfo, parseSameOriginUrl } from './url.js';

// 从页面链接发现同一帖子的分页。
interface PaginationDeps {
  windowObj: Window;
  qsa: (root: ParentNode | null | undefined, selector: string) => Element[];
  parseSameOriginUrl: (rawUrl: string, base?: string) => URL | null;
  getPostInfo: (rawUrl: string) => { postId: string; page: number } | null;
}

function createPaginationService({ windowObj, qsa, parseSameOriginUrl, getPostInfo }: PaginationDeps) {
  function getPaginationLinks(root: Document): Element[] {
    const preferred = qsa(root, '.nsk-pager a[href], a.pager-pos[href]');
    return preferred.length ? preferred : qsa(root, 'a[href]');
  }

  function getPageNumbers(root: Document, postId: string | number): Set<number> {
    const pages = new Set<number>();
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
const { getPageNumbers } = xnsPaginationService;

export { getPageNumbers };
