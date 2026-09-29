import { HTML_CACHE_ITEM_MAX_BYTES, HTML_CACHE_MAX_BYTES, HTML_CACHE_MAX_ENTRIES, HTML_CACHE_TTL, MAX_RESPONSE_BYTES, REQUEST_TIMEOUT } from '../core/config.js';
import { extractSsrState } from './ssr-state.js';
import type { SsrState } from './ssr-state.js';
import { isAllowedPostRequest, parseSameOriginUrl } from './url.js';

/** fetchHtml 可选参数。 */
interface FetchHtmlOptions {
  noStore?: boolean;
  allowCache?: boolean;
  signal?: AbortSignal;
  beforeRequest?: () => unknown;
  onResponse?: (status: number) => void;
}

/** 带错误码与 HTTP 状态的请求错误。 */
interface HttpError extends Error {
  code?: string;
  status?: number;
}

interface HtmlCacheEntry {
  html: string;
  url: string;
  postId: string;
  createdAt: number;
  bytes: number;
}

interface HttpClientDeps {
  windowObj: Window;
  fetchFn: typeof fetch;
  AbortControllerCtor: typeof AbortController;
  DOMParserCtor: typeof DOMParser;
  requestTimeout: number;
  maxResponseBytes: number;
  isAllowedPostRequest: typeof isAllowedPostRequest;
  parseSameOriginUrl: typeof parseSameOriginUrl;
  extractSsrState: typeof extractSsrState;
  cacheTtl: number;
  cacheMaxEntries: number;
  cacheMaxBytes: number;
  cacheItemMaxBytes: number;
}

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
}: HttpClientDeps) {
  const htmlCache = new Map<string, HtmlCacheEntry>();
  let htmlCacheBytes = 0;

  function removeCacheEntry(key: string): void {
    const entry = htmlCache.get(key);
    if (!entry) return;
    htmlCacheBytes -= entry.bytes;
    htmlCache.delete(key);
  }

  function postIdFromUrl(url: URL): string {
    return /^\/post-(\d+)-\d+(?:\/)?$/.exec(url.pathname)?.[1] || '';
  }

  function invalidatePostCache(url: URL): void {
    const postId = postIdFromUrl(url);
    if (!postId) {
      removeCacheEntry(url.href);
      return;
    }
    invalidatePostCacheForPost(postId);
  }

  /**
   * 按帖子号丢弃短期缓存：投票、收藏、回复、编辑等会改变帖子 HTML 的操作成功后调用，
   * 否则重新打开帖子会命中旧 HTML（计数、已操作状态都停在操作前）。
   */
  function invalidatePostCacheForPost(postId: string | number): void {
    const key = String(postId ?? '');
    if (!key) return;
    Array.from(htmlCache.entries()).forEach(([entryKey, entry]) => {
      if (entry.postId === key) removeCacheEntry(entryKey);
    });
  }

  function readCachedHtml(url: URL): { html: string; url: URL | null } | null {
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

  function writeCachedHtml(url: URL, html: string): void {
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

  function getRetryDelay(response: Response, fallback: number): number {
    const value = response.headers?.get?.('retry-after')?.trim() || '';
    if (!value) return fallback;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, seconds * 1_000);
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return Math.min(10_000, Math.max(0, timestamp - Date.now()));
    return fallback;
  }

  function isCloudflareChallenge(response: Response): boolean {
    return response.headers?.get?.('cf-mitigated')?.trim().toLowerCase() === 'challenge';
  }

  function createHttpError(message: string, code: string, status?: number): HttpError {
    const error: HttpError = new Error(message);
    error.code = code;
    if (Number.isFinite(status)) error.status = status;
    return error;
  }

  function abortError(): Error {
    const error = new Error('请求已取消');
    error.name = 'AbortError';
    return error;
  }

  /** 请求超时：与调用方取消区分开，超时可以重试，也要能把原因提示给用户。 */
  function createTimeoutError(): HttpError {
    const error: HttpError = new Error(`请求超时（超过 ${Math.round(requestTimeout / 1000)} 秒）`);
    error.name = 'TimeoutError';
    return error;
  }

  function wait(delay: number, signal?: AbortSignal | null): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<void>((resolve, reject) => {
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

  function throwIfAborted(signal?: AbortSignal | null): void {
    if (signal?.aborted) throw abortError();
  }

  async function fetchHtml(url: URL | null, options: FetchHtmlOptions = {}): Promise<{ html: string; url: URL | null }> {
    if (!url || !isAllowedPostRequest(url)) throw new Error('只允许读取同一站点的帖子页面');
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
      // 超时和调用方取消都会让 fetch 抛 AbortError；用 timedOut 分开，超时按可重试处理。
      let timedOut = false;
      const timer = windowObj.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, requestTimeout);
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
        let failure = error as HttpError;
        if (failure.code === 'CLOUDFLARE_CHALLENGE') throw failure;
        // 调用方主动取消（关窗、切楼层、重新加载）：原样抛出，由调用方静默处理。
        if (options.signal?.aborted) throw failure;
        // 超时：换成可重试、可提示的错误，否则会被当成取消而默默丢弃。
        if (timedOut && failure.name === 'AbortError') failure = createTimeoutError();
        if (attempt < 3 && failure.name !== 'AbortError') {
          await new Promise((resolve) => windowObj.setTimeout(resolve, 600 * attempt));
          continue;
        }
        throw failure;
      } finally {
        windowObj.clearTimeout(timer);
        options.signal?.removeEventListener('abort', abortExternal);
      }
    }
    throw new Error('抓取失败');
  }

  function parseHtml(html: string): Document {
    const doc = new DOMParserCtor().parseFromString(html, 'text/html');
    (doc as Document & { __xnsState?: SsrState | null }).__xnsState = extractSsrState(doc);
    return doc;
  }

  return Object.freeze({ fetchHtml, invalidatePostCacheForPost, parseHtml });
}

/** 调用方主动取消（关窗、切楼层、重新加载）产生的错误：不要当失败提示给用户。 */
function isAbortError(error: unknown): boolean {
  return (error as Error | null | undefined)?.name === 'AbortError';
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
const fetchHtml = (url: URL | null, options?: FetchHtmlOptions): Promise<{ html: string; url: URL | null }> => xnsHttpClient.fetchHtml(url, options);
const invalidatePostCacheForPost = (postId: string | number): void => xnsHttpClient.invalidatePostCacheForPost(postId);
const parseHtml = (html: string): Document => xnsHttpClient.parseHtml(html);

export { fetchHtml, invalidatePostCacheForPost, isAbortError, parseHtml };
export type { FetchHtmlOptions, HttpError };
