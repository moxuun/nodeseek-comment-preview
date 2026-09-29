import { qs } from '../core/dom.js';

// NodeSeek SSR 状态读取。只负责读取页面已经提供的 JSON，不访问会话存储。

/** 页面内嵌 JSON 里评论相关字段的最小形状；其余字段按需读取。 */
export interface SsrCommentEntry {
  commentId?: string | number | null;
  floorIndex?: unknown;
  markdown?: unknown;
  upvoteCount?: unknown;
  likeCount?: unknown;
  dislikeCount?: unknown;
  upvoted?: unknown;
  liked?: unknown;
  disliked?: unknown;
}

export interface SsrState {
  postData?: {
    postId?: unknown;
    comments?: SsrCommentEntry[];
    collectionCount?: unknown;
    collected?: unknown;
  };
  user?: Record<string, unknown>;
}

/** DOMParser 产物上由 http.js 挂载 SSR 状态。 */
type DocumentWithState = Document & { __xnsState?: SsrState | null };

/** 官方运行时：页面把 #temp-script 的 JSON 解到这里，hydration 之后只剩它能用。 */
type WindowWithConfig = Window & typeof globalThis & { __config__?: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function normalizeState(data: unknown): SsrState | null {
  if (!isRecord(data)) return null;
  // 列表页通常只有 user，没有 postData.comments；身份服务也需要读取这种状态。
  // 帖子统计仍由调用方检查 postData.comments，不把列表状态当成评论状态使用。
  const postData = data.postData;
  const hasComments = isRecord(postData) && Array.isArray(postData.comments);
  if (data.user === undefined && !hasComments) return null;
  return data as SsrState;
}

interface SsrStateDeps {
  documentObj: Document;
  windowObj: WindowWithConfig;
  qs: (root: ParentNode | null | undefined, selector: string) => Element | null;
}

function createSsrStateService({ documentObj, windowObj, qs }: SsrStateDeps) {
  // 实时文档的 SSR 状态缓存：官方 hydration 后会把 #temp-script 从 DOM 里移除，
  // 而帖子页当前页评论的计数与“已操作”标记是在那之后才读的，必须留下副本。
  let liveState: SsrState | null = null;

  function extractSsrState(doc: Document): SsrState | null {
    try {
      const script = qs(doc, '#temp-script[type="application/json"]');
      const encoded = script?.textContent?.trim();
      if (!encoded) return null;
      return normalizeState(JSON.parse(decodeURIComponent(escape(atob(encoded)))));
    } catch { return null; }
  }

  function readLiveState(): SsrState | null {
    const runtime = normalizeState(windowObj.__config__);
    if (runtime) { liveState = runtime; return runtime; }
    const inline = extractSsrState(documentObj);
    if (inline) { liveState = inline; return inline; }
    return liveState;
  }

  function getDocState(root: Document | null | undefined): SsrState | null {
    return root && root !== documentObj ? (root as DocumentWithState).__xnsState || null : null;
  }

  // http.js 只给 DOMParser 产物挂载 __xnsState；实时文档读官方运行时对象，
  // 再退回内联 JSON 和首次读到的副本。
  function getSsrState(root: Document | null | undefined): SsrState | null {
    if (!root) return null;
    const stored = (root as DocumentWithState).__xnsState;
    if (stored) return stored;
    return root === documentObj ? readLiveState() : extractSsrState(root);
  }

  return Object.freeze({ extractSsrState, getDocState, getSsrState });
}

const xnsSsrStateService = createSsrStateService({ documentObj: document, windowObj: window, qs });
const { extractSsrState, getDocState, getSsrState } = xnsSsrStateService;

export { extractSsrState, getDocState, getSsrState };
