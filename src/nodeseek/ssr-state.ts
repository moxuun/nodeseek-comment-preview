import { qs } from '../core/dom.js';

// NodeSeek SSR 状态读取。只负责读取页面已经提供的 JSON，不访问会话存储。

/** 页面内嵌 JSON 里评论相关字段的最小形状；其余字段按需读取。 */
export interface SsrCommentEntry {
  commentId?: string | number | null;
  upvoteCount?: unknown;
  likeCount?: unknown;
  dislikeCount?: unknown;
  upvoted?: unknown;
  liked?: unknown;
  disliked?: unknown;
}

export interface SsrState {
  postData?: { comments?: SsrCommentEntry[] };
  user?: Record<string, unknown>;
}

/** DOMParser 产物上由 http.js 挂载 SSR 状态。 */
type DocumentWithState = Document & { __xnsState?: SsrState | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

interface SsrStateDeps {
  documentObj: Document;
  qs: (root: ParentNode | null | undefined, selector: string) => Element | null;
}

function createSsrStateService({ documentObj, qs }: SsrStateDeps) {
  function extractSsrState(doc: Document): SsrState | null {
    try {
      const script = qs(doc, '#temp-script[type="application/json"]');
      const encoded = script?.textContent?.trim();
      if (!encoded) return null;
      const json = decodeURIComponent(escape(atob(encoded)));
      const data: unknown = JSON.parse(json);
      if (!isRecord(data)) return null;
      // 列表页通常只有 user，没有 postData.comments；身份服务也需要读取这种状态。
      // 帖子统计仍由调用方检查 postData.comments，不把列表状态当成评论状态使用。
      const postData = data.postData;
      const hasComments = isRecord(postData) && Array.isArray(postData.comments);
      if (data.user === undefined && !hasComments) return null;
      return data as SsrState;
    } catch { return null; }
  }

  function getDocState(root: Document | null | undefined): SsrState | null {
    return root && root !== documentObj ? (root as DocumentWithState).__xnsState || null : null;
  }

  return Object.freeze({ extractSsrState, getDocState });
}

const xnsSsrStateService = createSsrStateService({ documentObj: document, qs });
const { extractSsrState, getDocState } = xnsSsrStateService;

export { extractSsrState, getDocState };
