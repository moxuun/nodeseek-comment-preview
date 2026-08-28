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
}) {
  async function fetchHtml(url, options = {}) {
    if (!isAllowedPostRequest(url)) throw new Error('只允许读取同一站点的帖子页面');
    const noStore = options.noStore === true;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const controller = new AbortControllerCtor();
      const timer = windowObj.setTimeout(() => controller.abort(), requestTimeout);
      try {
        const response = await fetchFn(url.href, {
          method: 'GET', credentials: 'same-origin', cache: noStore ? 'no-store' : 'default', redirect: 'error',
          referrerPolicy: 'same-origin', headers: { Accept: 'text/html,application/xhtml+xml' }, signal: controller.signal,
        });
        if (response.status === 429 || response.status >= 500) {
          if (attempt < 3) { await new Promise((resolve) => windowObj.setTimeout(resolve, 600 * attempt)); continue; }
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
        return { html, url: responseUrl };
      } catch (error) {
        if (attempt < 3 && error?.name !== 'AbortError') {
          await new Promise((resolve) => windowObj.setTimeout(resolve, 600 * attempt));
          continue;
        }
        throw error;
      } finally { windowObj.clearTimeout(timer); }
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
  isAllowedPostRequest,
  parseSameOriginUrl,
  extractSsrState,
});
const fetchHtml = (...args) => xnsHttpClient.fetchHtml(...args);
const parseHtml = (...args) => xnsHttpClient.parseHtml(...args);
