import { safePositiveInt } from '../core/dom.js';

// NodeSeek 帖子 URL 规则与同源请求边界。

/** 同源帖子页信息。 */
interface PostInfo {
  postId: string;
  page: number;
}

interface UrlServiceDeps {
  windowObj: Window;
  URLCtor: typeof URL;
  safePositiveInt: (value: unknown) => number | null;
}

function createNodeSeekUrlService({ windowObj, URLCtor, safePositiveInt }: UrlServiceDeps) {
  function getPostInfo(rawUrl: string): PostInfo | null {
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

  function buildPostUrl(postId: unknown, page: unknown = 1, floor: number | string | null = null): URL | null {
    const normalizedPostId = safePositiveInt(postId);
    const normalizedPage = safePositiveInt(page);
    if (normalizedPostId === null || normalizedPage === null) return null;
    const url = new URLCtor(`/post-${normalizedPostId}-${normalizedPage}`, windowObj.location.origin);
    if (floor !== null && floor !== undefined && /^\d{1,15}$/.test(String(floor))) {
      const normalizedFloor = Number(floor);
      if (Number.isSafeInteger(normalizedFloor)) url.hash = String(normalizedFloor);
    }
    return url;
  }

  function parseSameOriginUrl(rawUrl: unknown, base: string = windowObj.location.href): URL | null {
    if (typeof rawUrl !== 'string' || rawUrl.length > 2_048) return null;
    try {
      const url = new URLCtor(rawUrl, base);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (url.origin !== windowObj.location.origin || url.username || url.password) return null;
      return url;
    } catch { return null; }
  }

  // 显式类型谓词：TS 无法从构造器变量推导 instanceof 的实例类型。
  const isUrl = (value: unknown): value is URL => value instanceof URLCtor;

  function isAllowedPostRequest(url: unknown): boolean {
    if (!isUrl(url)) return false;
    const info = getPostInfo(url.href);
    return Boolean(info && !url.search && !url.username && !url.password);
  }

  return Object.freeze({ buildPostUrl, getPostInfo, parseSameOriginUrl, isAllowedPostRequest });
}

const xnsNodeSeekUrlService = createNodeSeekUrlService({
  windowObj: window,
  URLCtor: URL,
  safePositiveInt,
});
const { buildPostUrl, getPostInfo, parseSameOriginUrl, isAllowedPostRequest } = xnsNodeSeekUrlService;

export { buildPostUrl, getPostInfo, isAllowedPostRequest, parseSameOriginUrl };
export type { PostInfo };
