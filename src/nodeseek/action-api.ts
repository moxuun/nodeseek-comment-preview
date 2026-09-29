import { REQUEST_TIMEOUT, state } from '../core/config.js';
import type { ModalHandle } from '../core/config.js';
import { parseSameOriginUrl } from './url.js';

/** 写接口请求选项；context 决定同源基准地址与 referrer。 */
interface ActionRequestOptions {
  context?: { url?: URL | null } | null;
  headers?: Record<string, string>;
}

/** 写接口适配器依赖；测试可注入 fetch / AbortController 替身。 */
interface ActionApiDeps {
  windowObj: Window & typeof globalThis;
  navigatorObj: { userAgent?: string };
  state: { modal: ModalHandle | null };
  requestTimeout: number;
  parseSameOriginUrl: (raw: string, base?: string) => URL | null;
  fetchFn: typeof fetch;
  AbortControllerCtor: typeof AbortController;
}

// NodeSeek 写接口适配器。
// 这里不决定按钮如何渲染，只负责同源校验、签名、CSRF 和响应错误归一化。
function createNodeSeekActionApi({ windowObj, navigatorObj, state, requestTimeout, parseSameOriginUrl, fetchFn, AbortControllerCtor }: ActionApiDeps) {
  const allowedPaths = new Set([
    '/api/statistics/upvote',
    '/api/statistics/like',
    '/api/statistics/dislike',
    '/api/statistics/collection',
    '/api/content/new-comment',
    '/api/content/edit-comment',
    '/api/vote/voteforitem',
  ]);

  async function dynamicSign(method: string, url: string, body: string): Promise<string> {
    const input = `${method}\n\n${url}\n\n${navigatorObj.userAgent || ''}\n\n${body || ''}`;
    try {
      const digest = await windowObj.crypto.subtle.digest('SHA-1', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      return 'a'.repeat(40);
    }
  }

  function randomCsrfToken(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(16);
    if (windowObj.crypto?.getRandomValues) windowObj.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    let token = '';
    bytes.forEach((byte) => { token += alphabet[byte % alphabet.length]; });
    return token;
  }

  /** 弹窗动作的基准地址来自当前预览的帖子；没有弹窗时回落到当前页面。 */
  function modalUrl(): URL | null {
    const modal = state.modal;
    return modal?.url ?? null;
  }

  async function postAction(apiPath: string, payload: unknown, options: ActionRequestOptions = {}): Promise<unknown> {
    const contextUrl = options.context?.url?.href || modalUrl()?.href || windowObj.location.href;
    const endpoint = parseSameOriginUrl(apiPath, contextUrl);
    if (!endpoint || !allowedPaths.has(endpoint.pathname)) throw new Error('操作地址不是 NodeSeek 同源接口');

    const controller = new AbortControllerCtor();
    const timer = windowObj.setTimeout(() => controller.abort(), requestTimeout);
    const bodyText = JSON.stringify(payload);
    const requestHeaders: Record<string, string> = {
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
      let data: Record<string, unknown> | null = null;
      try { data = text ? (JSON.parse(text) as Record<string, unknown>) : null; } catch { /* 某些接口成功时不返回 JSON。 */ }
      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const asText = (value: unknown): string => (typeof value === 'string' ? value : '');
      const explicitFailure = data !== null && (
        data.success === false || data.ok === false || data.error === true
        || /fail|error|unauthor|denied/i.test(asText(data.status))
        || /fail|error|unauthor|denied/i.test(asText(data.code))
      );
      if (!response.ok || explicitFailure || (data === null && /text\/html|<html[\s>]|登录|禁止访问/i.test(`${contentType} ${text.slice(0, 500)}`))) {
        const rawMessage = asText(data?.message) || asText(data?.msg);
        const message = rawMessage || text.replace(/<[^>]+>/g, ' ').trim().slice(0, 120);
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

const dynamicSign = (method: string, url: string, body: string): Promise<string> => xnsNodeSeekActionApi.dynamicSign(method, url, body);
const postAction = (apiPath: string, payload: unknown, options?: ActionRequestOptions): Promise<unknown> => xnsNodeSeekActionApi.postAction(apiPath, payload, options);

export { dynamicSign, postAction };
export type { ActionRequestOptions };
