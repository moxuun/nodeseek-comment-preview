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
