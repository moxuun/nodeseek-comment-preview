import { mergeCommentRecords } from '../comments/thread.js';
import { MAX_PAGE, PAGE_CONCURRENCY, PAGE_REQUEST_GAP } from '../core/config.js';
import { getCommentItems } from '../core/dom.js';
import { getMaxPage } from '../core/preferences.js';
import { getCommentRecord } from '../nodeseek/content-parser.js';
import type { CommentRecord, CommentRecordOptions, SsrState } from '../nodeseek/content-parser.js';
import { fetchHtml, parseHtml } from '../nodeseek/http.js';
import { getCurrentUserUid } from '../nodeseek/identity.js';
import { getPageNumbers } from '../nodeseek/pagination.js';
import { getDocState } from '../nodeseek/ssr-state.js';
import { buildPostUrl } from '../nodeseek/url.js';

// 帖子分页读取服务。
// 只负责“读哪些页、如何并发、如何合并”，不创建 DOM，也不决定如何展示失败。

interface PostInfo {
  postId: string;
  page: number;
}

interface PageProgress {
  loadedPages: number;
  failedPages: number[];
  challengePages: number[];
  truncated: boolean;
  totalPages: number;
  pageLimit: number;
}

interface FetchHtmlOptions {
  noStore?: boolean;
  allowCache?: boolean;
  signal?: AbortSignal;
  beforeRequest?: () => unknown;
  onResponse?: (status: number) => void;
}

interface FetchPostPagesOptions {
  pageLimit?: number;
  noStore?: boolean;
  retainDocuments?: boolean;
  onlyPages?: number[];
  initialLoadedPages?: number[];
  initialFailedPages?: number[];
  initialChallengePages?: number[];
  requestGapMs?: number;
  allowCache?: boolean;
  signal?: AbortSignal;
  isAborted?: () => boolean;
  onPageLoaded?: (page: number, doc: Document, progress: PageProgress) => void;
  onPageFailed?: (page: number, progress: PageProgress) => void;
}

interface FetchPostPagesResult extends PageProgress {
  pageDocs: Map<number, Document> | null;
}

interface RecordsLoadedPayload extends PageProgress {
  records: CommentRecord[];
  page: number;
  loading: true;
}

interface LoadPreviewOptions extends FetchPostPagesOptions {
  initialRecords?: CommentRecord[] | null;
  onRecordsLoaded?: (payload: RecordsLoadedPayload) => void;
}

interface LoadPreviewResult extends PageProgress {
  records: CommentRecord[];
}

interface PageLoaderDeps {
  windowObj: Window;
  maxPage: number;
  getMaxPage: () => number;
  concurrency: number;
  requestGapMs: number;
  fetchHtml: (url: URL | null, options?: FetchHtmlOptions) => Promise<{ html: string; url: URL | null }>;
  parseHtml: (html: string, url: URL | null) => Document;
  getPageNumbers: (root: Document, postId: string) => Set<number>;
  getCommentItems: (root: Document) => Element[];
  getCommentRecord: (
    item: Element,
    postId: string,
    page: number,
    index: number,
    current: boolean,
    options: CommentRecordOptions,
  ) => CommentRecord | null;
  getDocState: (root: Document) => SsrState | null;
  getCurrentUserUid: () => string | null;
  buildPostUrl: (postId: string, page?: number, floor?: number | null) => URL | null;
}

function createPageLoader({
  windowObj,
  maxPage,
  getMaxPage,
  concurrency,
  requestGapMs,
  fetchHtml,
  parseHtml,
  getPageNumbers,
  getCommentItems,
  getCommentRecord,
  getDocState,
  getCurrentUserUid,
  buildPostUrl,
}: PageLoaderDeps) {
  function createRequestGate(gapMs: number) {
    const cooldownGap = Number.isFinite(Number(gapMs)) ? Math.max(0, Number(gapMs)) : 0;
    let currentGap = cooldownGap;
    let successStreak = 0;
    let queue: Promise<void> = Promise.resolve();
    let nextStartAt = 0;
    async function waitForRequestSlot(): Promise<void> {
      const previous = queue;
      let release: (() => void) | undefined;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const delay = Math.max(0, nextStartAt - Date.now());
      if (delay) await new Promise<void>((resolve) => windowObj.setTimeout(resolve, delay));
      nextStartAt = Date.now() + currentGap;
      release?.();
    }
    function observeResponse(status: number): void {
      if (status === 429 || status >= 500) {
        currentGap = Math.min(1_000, Math.max(cooldownGap, currentGap ? currentGap * 2 : cooldownGap));
        successStreak = 0;
        return;
      }
      if (status >= 200 && status < 300) {
        successStreak += 1;
        if (successStreak >= 8 && currentGap > 0) {
          currentGap = Math.max(cooldownGap, currentGap - 25);
          successStreak = 0;
        }
      }
    }
    return Object.freeze({ waitForRequestSlot, observeResponse });
  }

  function collectPageRecords(info: PostInfo, root: Document, page: number): CommentRecord[] {
    const state = getDocState(root);
    return getCommentItems(root)
      .map((item, index) => getCommentRecord(item, info.postId, page, index, false, { keepCommentMenu: true, state, getCurrentUserUid }))
      .filter((record): record is CommentRecord => record !== null);
  }

  async function fetchPostPages(info: PostInfo, firstDocument: Document, options: FetchPostPagesOptions = {}): Promise<FetchPostPagesResult> {
    const pageLimit = Math.min(maxPage, Math.max(1, Number(options.pageLimit) || Number(getMaxPage?.()) || maxPage));
    const noStore = options.noStore !== false;
    const retainDocuments = options.retainDocuments !== false;
    const pageDocs = retainDocuments ? new Map<number, Document>([[info.page, firstDocument]]) : null;
    const normalizePages = (values: unknown): number[] => Array.from(new Set((Array.isArray(values) ? values : [])
      .map((page) => Number(page))
      .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageLimit)));
    const onlyPages = Array.isArray(options.onlyPages) ? normalizePages(options.onlyPages) : null;
    const loadedPages = new Set<number>([info.page, ...normalizePages(options.initialLoadedPages)]);
    const failedPages = new Set<number>(normalizePages(options.initialFailedPages));
    const challengePages = new Set<number>(normalizePages(options.initialChallengePages));
    // 当前打开页即使超过读取上限也要保留，但不能计入“前 N 页”的进度。
    const countedLoadedPages = (): number => Array.from(loadedPages).filter((page) => page >= 1 && page <= pageLimit).length;
    const pages = new Set<number>([info.page]);
    const discovered = getPageNumbers(firstDocument, info.postId);
    const totalPages = discovered.size ? Math.max(...discovered, info.page) : info.page;
    const truncated = totalPages > pageLimit;

    if (onlyPages) {
      onlyPages.forEach((page) => pages.add(page));
    } else {
      discovered.forEach((page) => {
        if (page <= pageLimit) pages.add(page);
      });
      const maxSeed = truncated ? pageLimit : Math.min(pageLimit, Math.max(...pages));
      for (let page = 1; page <= maxSeed; page += 1) pages.add(page);
    }
    pages.delete(info.page);
    const progressState = (): PageProgress => ({
      loadedPages: countedLoadedPages(),
      failedPages: [...failedPages].sort((a, b) => a - b),
      challengePages: [...challengePages].sort((a, b) => a - b),
      truncated,
      totalPages,
      pageLimit,
    });

    const pending = Array.from(pages).sort((a, b) => a - b);
    const requestGate = createRequestGate(options.requestGapMs ?? requestGapMs);
    options.onPageLoaded?.(info.page, firstDocument, progressState());
    const worker = async (): Promise<void> => {
      while (pending.length) {
        if (options.isAborted?.()) return;
        const page = pending.shift();
        if (page === undefined || loadedPages.has(page)) continue;
        try {
          const response = await fetchHtml(buildPostUrl(info.postId, page), {
            noStore,
            allowCache: options.allowCache === true,
            signal: options.signal,
            beforeRequest: requestGate.waitForRequestSlot,
            onResponse: requestGate.observeResponse,
          });
          const parsed = parseHtml(response.html, response.url);
          loadedPages.add(page);
          failedPages.delete(page);
          challengePages.delete(page);
          if (pageDocs) pageDocs.set(page, parsed);
          options.onPageLoaded?.(page, parsed, progressState());
          if (!onlyPages) {
            getPageNumbers(parsed, info.postId).forEach((foundPage) => {
              if (foundPage <= pageLimit && !pages.has(foundPage) && foundPage !== info.page) {
                pages.add(foundPage);
                pending.push(foundPage);
              }
            });
          }
        } catch (error) {
          const code = (error as { code?: unknown } | null)?.code;
          failedPages.add(page);
          if (code === 'CLOUDFLARE_CHALLENGE') challengePages.add(page);
          else challengePages.delete(page);
          options.onPageFailed?.(page, progressState());
        }
      }
    };

    const workerCount = Math.min(concurrency, Math.max(1, pending.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return {
      pageDocs,
      loadedPages: countedLoadedPages(),
      failedPages: [...failedPages].sort((a, b) => a - b),
      challengePages: [...challengePages].sort((a, b) => a - b),
      truncated,
      totalPages,
      pageLimit,
    };
  }

  async function loadPreviewRecords(info: PostInfo, firstDocument: Document, options: LoadPreviewOptions = {}): Promise<LoadPreviewResult> {
    const initialRecords = Array.isArray(options.initialRecords) ? options.initialRecords : null;
    let records: CommentRecord[] = mergeCommentRecords(initialRecords);
    const { loadedPages, failedPages, challengePages, truncated, totalPages, pageLimit } = await fetchPostPages(info, firstDocument, {
      ...options,
      retainDocuments: false,
      onPageLoaded: (page, root, progress) => {
        if (initialRecords && page === info.page) return;
        records = mergeCommentRecords(records, collectPageRecords(info, root, page));
        options.onRecordsLoaded?.({
          records,
          ...progress,
          page,
          loading: true,
        });
      },
      onPageFailed: (page, progress) => {
        options.onPageFailed?.(page, progress);
        options.onRecordsLoaded?.({
          records,
          ...progress,
          page,
          loading: true,
        });
      },
    });
    return {
      records,
      loadedPages,
      failedPages,
      challengePages,
      truncated,
      totalPages,
      pageLimit,
    };
  }

  return Object.freeze({ collectPageRecords, fetchPostPages, loadPreviewRecords });
}

const xnsPageLoader = createPageLoader({
  windowObj: window,
  maxPage: MAX_PAGE,
  getMaxPage,
  concurrency: PAGE_CONCURRENCY,
  requestGapMs: PAGE_REQUEST_GAP,
  fetchHtml,
  parseHtml,
  getPageNumbers,
  getCommentItems,
  getCommentRecord,
  getDocState,
  getCurrentUserUid,
  buildPostUrl,
});
const { collectPageRecords, fetchPostPages, loadPreviewRecords } = xnsPageLoader;

export { collectPageRecords, fetchPostPages, loadPreviewRecords };
export type { PageProgress, FetchPostPagesOptions, FetchPostPagesResult, LoadPreviewOptions, LoadPreviewResult };
