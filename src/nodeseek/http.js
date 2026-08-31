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
