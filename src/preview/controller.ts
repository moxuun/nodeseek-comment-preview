import { mergeCommentRecords } from '../comments/thread.js';
import { MAX_PAGE, SELECTORS, state } from '../core/config.js';
import { clearElement, createElement, qs, qsa } from '../core/dom.js';
import { collectPageRecords, loadPreviewRecords } from '../data/page-loader.js';
import { openPreviewComposer } from '../features/comment-actions.js';
import { installPreviewFeatures } from '../features/content.js';
import { sanitizeImportedNode } from '../nodeseek/content-parser.js';
import { fetchHtml, parseHtml } from '../nodeseek/http.js';
import { getPageNumbers } from '../nodeseek/pagination.js';
import { buildPostUrl, getPostInfo } from '../nodeseek/url.js';
import { closeImageLightbox } from './lightbox.js';
import { closeModal, createCloseButton, createRefreshButton, createShareButton, installPreviewScrollButtons } from './modal-ui.js';
import { buildPreviewPostNode, renderPreviewRecords } from './renderer.js';
import type { LoadPreviewResult, PageProgress } from '../data/page-loader.js';
import type { CommentRecord } from '../nodeseek/content-parser.js';
import type { RenderRecordsOptions } from './renderer.js';

// 预览控制器：负责弹窗生命周期、刷新和滚动位置恢复。

/** 弹窗头部元信息字段。 */
interface PreviewHeaderFields {
  node?: string;
  author?: string;
  time?: string;
  replyCount?: number | null;
}

/** 弹窗头部元信息 DOM 项。 */
interface PreviewHeaderMetaItem {
  item: HTMLElement;
  value: Element;
}

/** 弹窗状态（写入 state.modal，其他模块按需取字段）。 */
interface PreviewModalState {
  overlay: HTMLElement;
  dialog: HTMLElement;
  body: HTMLElement;
  composerHost: HTMLElement;
  title: HTMLElement;
  url: URL;
  fallbackLink: Element | null;
  postId: string;
  composer: HTMLElement | null;
  scrollCleanup: (() => void) | null;
  featureCleanup: (() => void) | null;
  headerMeta: Record<string, PreviewHeaderMetaItem>;
  loading: boolean;
  loadGeneration: number;
  requestController: { abort: () => void } | null;
  replySyncController: { abort: () => void } | null;
  replySyncPromise: Promise<boolean> | null;
  replySyncing: boolean;
  pendingReplySync: boolean;
  toolbarStatus: HTMLElement | null;
  previewSeed: Document | null;
  previewRecords: CommentRecord[];
  loadedPages: number;
  failedPages: number[];
  challengePages: number[];
  truncated: boolean;
  totalPages: number | null;
  pageLimit: number;
  refreshScrollCleanup?: (() => void) | null;
}

/** 渐进渲染回调的载荷：分页进度 + 当前记录。 */
type ProgressiveRecords = PageProgress & { records: CommentRecord[] };

/** 滚动锚点：一条可见块级元素的定位信息。 */
interface PreviewScrollAnchor {
  isPost: boolean;
  commentId: string;
  floor: string;
  path: number[];
  tagName: string;
  offset: number;
}

/** 滚动快照：弹窗内容在重排前的位置。 */
interface PreviewScrollSnapshot {
  scrollTop: number;
  maxScrollTop: number;
  ratio: number;
  atTop: boolean;
  atBottom: boolean;
  anchor: PreviewScrollAnchor | null;
}

/** 预览控制器依赖；测试可注入替身。 */
interface PreviewControllerDeps {
  windowObj: Window & typeof globalThis;
  documentObj: Document;
  state: typeof state;
  selectors: typeof SELECTORS;
  maxPage: number;
  qs: typeof qs;
  qsa: typeof qsa;
  createElement: typeof createElement;
  clearElement: typeof clearElement;
  getPostInfo: typeof getPostInfo;
  buildPostUrl: typeof buildPostUrl;
  sanitizeImportedNode: typeof sanitizeImportedNode;
  parseHtml: typeof parseHtml;
  fetchHtml: typeof fetchHtml;
  getPageNumbers: typeof getPageNumbers;
  collectPageRecords: typeof collectPageRecords;
  loadPreviewRecords: typeof loadPreviewRecords;
  buildPreviewPostNode: typeof buildPreviewPostNode;
  renderPreviewRecords: typeof renderPreviewRecords;
  installPreviewFeatures: typeof installPreviewFeatures;
  installPreviewScrollButtons: typeof installPreviewScrollButtons;
  closeImageLightbox: typeof closeImageLightbox;
  closeModal: typeof closeModal;
  createCloseButton: typeof createCloseButton;
  createRefreshButton: typeof createRefreshButton;
  createShareButton: typeof createShareButton;
  openPreviewComposer: typeof openPreviewComposer;
}

function createPreviewController({
  windowObj,
  documentObj,
  state,
  selectors,
  maxPage,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  buildPostUrl,
  sanitizeImportedNode,
  parseHtml,
  fetchHtml,
  getPageNumbers,
  collectPageRecords,
  loadPreviewRecords,
  buildPreviewPostNode,
  renderPreviewRecords,
  installPreviewFeatures,
  installPreviewScrollButtons,
  closeImageLightbox,
  closeModal,
  createCloseButton,
  createRefreshButton,
  createShareButton,
  openPreviewComposer,
}: PreviewControllerDeps) {
  /** state.modal 目前是 unknown，读取时统一在控制器里收窄。 */
  function currentModal(): PreviewModalState | null {
    return (state.modal || null) as PreviewModalState | null;
  }

  async function copyPreviewLink(url: URL | null | undefined, setLabel?: ((value: string) => void) | null): Promise<void> {
    const text = url?.href || '';
    if (!text) throw new Error('原帖链接不可用');
    if (windowObj.navigator?.clipboard?.writeText) {
      await windowObj.navigator.clipboard.writeText(text);
    } else {
      const input = documentObj.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      documentObj.body.appendChild(input);
      input.select();
      const copied = documentObj.execCommand?.('copy');
      input.remove();
      if (!copied) throw new Error('浏览器拒绝复制');
    }
    setLabel?.('已复制');
    windowObj.setTimeout(() => setLabel?.('分享'), 1_800);
  }

  function getCanonicalPostUrl(url: URL | null | undefined): URL | null | undefined {
    const info = getPostInfo(url?.href || '');
    if (!info) return url;
    return buildPostUrl(info.postId, 1) || url;
  }

  function getPreviewHeaderMeta(parsed: Document): PreviewHeaderFields {
    const textOf = (node: Element | null | undefined): string => node?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || '';
    const post = qs(parsed, '.nsk-post') || parsed;
    const nodeName = textOf(qs(post, '[data-node-name], .node-name, .node-title, .category-name'))
      || textOf(qsa(post, 'a[href*="/node/"], a[href*="/category/"]').find((link) => textOf(link)));
    const author = textOf(qs(post, '.nsk-content-meta-info a.author-name, .nsk-content-meta-info a[href*="/space/"], a.author-name'));
    const time = textOf(qs(post, '.nsk-content-meta-info time, .nsk-content-meta-info [datetime], time[datetime]'));
    return { node: nodeName, author, time, replyCount: null };
  }

  function updatePreviewHeaderMeta(modal: PreviewModalState | null | undefined, meta?: PreviewHeaderFields | null): void {
    if (!modal?.headerMeta) return;
    const values: Record<string, string> = {
      node: meta?.node || '',
      author: meta?.author || '',
      time: meta?.time || '',
      replies: Number.isFinite(meta?.replyCount) ? `${meta?.replyCount} 条回复` : '',
    };
    Object.entries(values).forEach(([key, value]) => {
      const item = modal.headerMeta[key];
      if (!item) return;
      item.value.textContent = value;
      item.item.hidden = !value;
    });
  }

  function renderPreviewSection(
    section: Element,
    info: Parameters<typeof renderPreviewRecords>[1],
    records: CommentRecord[],
    options: RenderRecordsOptions = {},
  ): void {
    const onNodeMounted = options.onNodeMounted;
    renderPreviewRecords(section, info, records, {
      ...options,
      onNodeMounted: (node, record) => {
        installPreviewFeatures(node);
        onNodeMounted?.(node, record);
      },
    });
  }

  function applyPreviewResult(modal: PreviewModalState | null | undefined, result: LoadPreviewResult | null | undefined): void {
    if (!modal || !result) return;
    modal.previewRecords = Array.isArray(result.records) ? result.records : [];
    modal.loadedPages = result.loadedPages;
    modal.failedPages = Array.isArray(result.failedPages) ? result.failedPages : [];
    modal.challengePages = Array.isArray(result.challengePages) ? result.challengePages : [];
    modal.truncated = Boolean(result.truncated);
    modal.totalPages = result.totalPages;
    modal.pageLimit = result.pageLimit;
  }

  function createPreviewHeaderMeta(): { root: HTMLElement; items: Record<string, PreviewHeaderMetaItem> } {
    const root = createElement('div', 'xns-modal-meta');
    const items: Record<string, PreviewHeaderMetaItem> = {};
    [['node', '节点'], ['author', '作者'], ['time', '时间'], ['replies', '回复']].forEach(([key, label]) => {
      const item = createElement('span', 'xns-modal-meta-item');
      item.hidden = true;
      item.append(createElement('span', 'xns-modal-meta-label', label), createElement('span', 'xns-modal-meta-value'));
      root.appendChild(item);
      items[key] = { item, value: item.lastElementChild as Element };
    });
    return { root, items };
  }

  function buildPreviewContent(
    url: URL,
    parsed: Document,
    options: {
      noStore?: boolean;
      allowCache?: boolean;
      renderDetached?: boolean;
      signal?: AbortSignal;
      statusNode?: HTMLElement | null;
      onRetry?: () => void;
    } = {},
  ) {
    const wrapper = createElement('div', 'xns-preview-content');
    const title = qs(parsed, selectors.postTitle)?.textContent?.trim() || '';
    const headerMeta = getPreviewHeaderMeta(parsed);
    const info = getPostInfo(url.href);
    const importedPost = info ? buildPreviewPostNode(parsed, info) : null;
    if (importedPost) wrapper.appendChild(importedPost);
    else {
      const content = qs(parsed, selectors.postContent);
      const importedContent = sanitizeImportedNode(content);
      if (importedContent) wrapper.appendChild(importedContent);
      else wrapper.appendChild(createElement('p', 'xns-status', '没有找到帖子正文。'));
    }
    if (!info) return { title, headerMeta, content: wrapper, hydrate: null };
    const currentRecords = collectPageRecords(info, parsed, info.page);
    headerMeta.replyCount = currentRecords.length;
    const knownPages = getPageNumbers(parsed, info.postId);
    const hasRemotePages = Array.from(knownPages).some((page) => page !== info.page);
    const section = createElement('section', 'xns-preview-comments');
    section.appendChild(createElement('h3'));
    const thread = createElement('ul', 'xns-preview-thread');
    section.appendChild(thread);
    renderPreviewSection(section, info, currentRecords, {
      loading: hasRemotePages,
      statusNode: options.statusNode,
      onRetry: options.onRetry,
    });
    wrapper.appendChild(section);
    let progressiveTimer = 0;
    let pendingProgress: ProgressiveRecords | null = null;
    let renderedProgress = false;
    const renderProgress = (progress: ProgressiveRecords | null): boolean => {
      if (!progress || !section.isConnected) return false;
      renderPreviewSection(section, info, progress.records, {
        ...progress,
        statusNode: options.statusNode,
        onRetry: options.onRetry,
      });
      return true;
    };
    const scheduleProgressiveRender = (progress: ProgressiveRecords): void => {
      if (options.renderDetached === true) return;
      pendingProgress = progress;
      if (progressiveTimer) return;
      // 第 2 页进入很短的合并窗口，后续页面按 500ms 合并，避免 50 页触发
      // 49 次完整树重排。全部请求很快完成时，定时批次会被最终渲染取消。
      progressiveTimer = windowObj.setTimeout(() => {
        progressiveTimer = 0;
        const next = pendingProgress;
        pendingProgress = null;
        if (renderProgress(next)) renderedProgress = true;
      }, renderedProgress ? 500 : 300);
    };
    const hydrate = loadPreviewRecords(info, parsed, {
      noStore: options.noStore === true,
      allowCache: options.allowCache === true,
      initialRecords: currentRecords,
      signal: options.signal,
      onRecordsLoaded: scheduleProgressiveRender,
    }).then((preview) => {
      if (progressiveTimer) windowObj.clearTimeout(progressiveTimer);
      progressiveTimer = 0;
      pendingProgress = null;
      if (section.isConnected || options.renderDetached === true) {
        renderPreviewSection(section, info, preview.records, {
          ...preview,
          statusNode: options.statusNode,
          onRetry: options.onRetry,
        });
      }
      return preview;
    });
    return { title, headerMeta, content: wrapper, hydrate };
  }

  function getPreviewScrollOwners(body: Element): Element[] {
    return qsa(body, '.xns-preview-post, .xns-preview-thread .content-item[data-comment-id], .xns-preview-thread .content-item[data-xns-floor]');
  }

  function getPreviewScrollOwner(node: Element | null | undefined): Element | null {
    return node?.closest?.('.xns-preview-post, .xns-preview-thread .content-item[data-comment-id], .xns-preview-thread .content-item[data-xns-floor]') || null;
  }

  function getPreviewScrollCandidates(body: Element): Element[] {
    const seen = new Set<Element>();
    const candidates: Element[] = [];
    getPreviewScrollOwners(body).forEach((owner) => {
      const blocks = [owner, ...qsa(owner, ':scope > .post-title, :scope > .nsk-content-meta-info, :scope > article.post-content > *, :scope > .post-content > *')];
      blocks.forEach((node) => {
        if (!node || seen.has(node) || getPreviewScrollOwner(node) !== owner) return;
        seen.add(node);
        candidates.push(node);
      });
    });
    return candidates;
  }

  function getPreviewChildPath(owner: Element, node: Element): number[] {
    const path: number[] = [];
    let current: Element | null = node;
    while (current && current !== owner) {
      const parent: Element | null = current.parentElement;
      if (!parent) return [];
      const index = Array.from(parent.children).indexOf(current);
      if (index < 0) return [];
      path.unshift(index);
      current = parent;
    }
    return current === owner ? path : [];
  }

  function capturePreviewScroll(body: HTMLElement): PreviewScrollSnapshot {
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const snapshot: PreviewScrollSnapshot = {
      scrollTop: body.scrollTop,
      maxScrollTop,
      ratio: maxScrollTop > 0 ? body.scrollTop / maxScrollTop : 0,
      atTop: body.scrollTop <= 3,
      atBottom: maxScrollTop - body.scrollTop <= 24,
      anchor: null,
    };
    if (snapshot.atTop || snapshot.atBottom || maxScrollTop === 0) return snapshot;
    const bodyRect = body.getBoundingClientRect();
    const anchorLine = bodyRect.top + Math.min(12, Math.max(2, body.clientHeight * 0.03));
    const rows = getPreviewScrollCandidates(body).map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.height > 0 && rect.bottom > bodyRect.top && rect.top < bodyRect.bottom);
    const crossing = rows.filter(({ rect }) => rect.top <= anchorLine && rect.bottom > anchorLine);
    const chosen = crossing.reduce<{ node: Element; rect: DOMRect } | null>((best, row) => (!best || row.rect.top > best.rect.top ? row : best), null)
      || rows.filter(({ rect }) => rect.top > anchorLine).sort((left, right) => left.rect.top - right.rect.top)[0] || null;
    if (!chosen) return snapshot;
    const owner = getPreviewScrollOwner(chosen.node);
    if (!owner) return snapshot;
    const isPost = owner.matches('.xns-preview-post, [data-xns-target-type="post"]');
    snapshot.anchor = {
      isPost,
      commentId: isPost ? '' : (owner.getAttribute('data-comment-id') || ''),
      floor: owner.getAttribute('data-xns-floor') || '',
      path: getPreviewChildPath(owner, chosen.node),
      tagName: chosen.node.tagName,
      offset: chosen.rect.top - bodyRect.top,
    };
    return snapshot;
  }

  function findPreviewScrollOwner(body: Element, anchor: PreviewScrollAnchor): Element | null {
    if (anchor.isPost) return qs(body, '.xns-preview-post, [data-xns-target-type="post"]');
    if (anchor.commentId) {
      const byCommentId = qs(body, `.xns-preview-thread .content-item[data-comment-id="${CSS.escape(anchor.commentId)}"]`);
      if (byCommentId) return byCommentId;
    }
    if (anchor.floor) return qs(body, `.xns-preview-thread .content-item[data-xns-floor="${CSS.escape(anchor.floor)}"]`);
    return null;
  }

  function resolvePreviewScrollAnchor(body: Element, anchor: PreviewScrollAnchor): Element | null {
    const owner = findPreviewScrollOwner(body, anchor);
    if (!owner) return null;
    let node: Element | null = owner;
    for (const index of anchor.path || []) {
      node = node?.children?.[index] || null;
      if (!node) return owner;
    }
    return !anchor.tagName || node.tagName === anchor.tagName ? node : owner;
  }

  function restorePreviewScroll(body: HTMLElement, snapshot: PreviewScrollSnapshot | null): void {
    if (!snapshot) return;
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    if (snapshot.atTop) { body.scrollTop = 0; return; }
    if (snapshot.atBottom) { body.scrollTop = maxScrollTop; return; }
    const anchorInfo = snapshot.anchor;
    const anchor = anchorInfo ? resolvePreviewScrollAnchor(body, anchorInfo) : null;
    if (anchor && anchorInfo) {
      const currentOffset = anchor.getBoundingClientRect().top - body.getBoundingClientRect().top;
      const targetScrollTop = body.scrollTop + currentOffset - anchorInfo.offset;
      body.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
      return;
    }
    const proportional = Number.isFinite(snapshot.ratio) ? snapshot.ratio * maxScrollTop : snapshot.scrollTop;
    body.scrollTop = Math.max(0, Math.min(proportional, maxScrollTop));
  }

  function stabilizePreviewScroll(modal: PreviewModalState, snapshot: PreviewScrollSnapshot | null, generation: number): void {
    modal.refreshScrollCleanup?.();
    const body = modal.body;
    let active = true;
    let frame = 0;
    const timers: number[] = [];
    const imageHandlers: { image: Element; done: () => void }[] = [];
    const apply = (): void => {
      frame = 0;
      if (!active || currentModal() !== modal || modal.loadGeneration !== generation) return;
      restorePreviewScroll(body, snapshot);
    };
    const schedule = (): void => {
      if (!active || frame) return;
      frame = windowObj.requestAnimationFrame(apply);
    };
    const cleanup = (): void => {
      if (!active) return;
      active = false;
      if (frame) windowObj.cancelAnimationFrame(frame);
      timers.forEach((timer) => windowObj.clearTimeout(timer));
      resizeObserver?.disconnect();
      imageHandlers.forEach(({ image, done }) => {
        image.removeEventListener('load', done);
        image.removeEventListener('error', done);
      });
      ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((name) => modal.overlay.removeEventListener(name, cleanup, true));
      if (modal.refreshScrollCleanup === cleanup) modal.refreshScrollCleanup = null;
    };
    const resizeObserver = windowObj.ResizeObserver ? new windowObj.ResizeObserver(schedule) : null;
    resizeObserver?.observe(body.firstElementChild || body);
    qsa(body, 'img').forEach((image) => {
      if ((image as HTMLImageElement).complete) return;
      const done = (): void => schedule();
      imageHandlers.push({ image, done });
      image.addEventListener('load', done, { once: true });
      image.addEventListener('error', done, { once: true });
    });
    ['wheel', 'touchstart', 'pointerdown', 'keydown'].forEach((name) => modal.overlay.addEventListener(name, cleanup, { capture: true, passive: true }));
    [0, 60, 180, 420, 900, 1_400].forEach((delay) => timers.push(windowObj.setTimeout(schedule, delay)));
    timers.push(windowObj.setTimeout(cleanup, 1_800));
    modal.refreshScrollCleanup = cleanup;
    restorePreviewScroll(body, snapshot);
  }

  function showPreviewLoadError(modal: PreviewModalState, error: unknown): void {
    clearElement(modal.body);
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status') as HTMLElement | null;
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status is-failed';
      toolbarStatus.hidden = false;
      const detail = (error as Error | null | undefined)?.message || '网络错误';
      toolbarStatus.textContent = '预览加载失败';
      toolbarStatus.title = detail;
    }
    modal.body.appendChild(createElement('p', 'xns-status', `预览加载失败：${(error as Error | null | undefined)?.message || '网络错误'}`));
    if (modal.fallbackLink) {
      const link = createElement('a', '', '在原页面打开') as HTMLAnchorElement;
      link.href = (modal.fallbackLink as HTMLAnchorElement).href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      modal.body.appendChild(link);
    }
  }

  function showPreviewRefreshError(modal: PreviewModalState, error: unknown): void {
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status') as HTMLElement | null;
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status xns-refresh-status is-failed';
      toolbarStatus.hidden = false;
      const detail = (error as Error | null | undefined)?.message || '网络错误';
      toolbarStatus.textContent = `刷新失败，保留当前内容 · ${detail}`;
      toolbarStatus.title = detail;
    }
  }

  async function syncPreviewReply(modal: PreviewModalState | null): Promise<boolean> {
    if (!modal || currentModal() !== modal) return false;
    if (modal.loading) {
      modal.pendingReplySync = true;
      return false;
    }
    if (modal.replySyncPromise) return modal.replySyncPromise;
    const info = getPostInfo(modal.url?.href || '');
    const seed = modal.previewSeed;
    if (!info || !seed) return false;

    const knownPages = getPageNumbers(seed, info.postId);
    const discoveredLastPage = knownPages.size ? Math.max(...knownPages) : info.page;
    const lastPage = Math.max(1, Number(modal.totalPages) || discoveredLastPage || info.page || 1);
    const pages = Array.from(new Set([lastPage, lastPage + 1]));
    const controller = windowObj.AbortController ? new windowObj.AbortController() : null;
    modal.replySyncController = controller;
    modal.replySyncing = true;
    const promise = (async (): Promise<boolean> => {
      const additions: CommentRecord[] = [];
      let successfulReads = 0;
      for (const page of pages) {
        if (currentModal() !== modal) return false;
        try {
          const response = await fetchHtml(buildPostUrl(info.postId, page), {
            noStore: true,
            allowCache: false,
            signal: controller?.signal,
          });
          const parsed = parseHtml(response.html);
          additions.push(...collectPageRecords(info, parsed, page));
          successfulReads += 1;
        } catch {
          // 新回复可能还没生成下一页；已成功发送不应因同步探测失败而变成失败。
        }
      }
      if (currentModal() !== modal) return false;
      if (successfulReads === 0) return false;
      modal.previewRecords = mergeCommentRecords(modal.previewRecords, additions);
      const section = qs(modal.body, '.xns-preview-comments');
      if (section) {
        renderPreviewSection(section, info, modal.previewRecords, {
          loadedPages: modal.loadedPages,
          failedPages: modal.failedPages,
          challengePages: modal.challengePages,
          truncated: modal.truncated,
          totalPages: modal.totalPages,
          pageLimit: modal.pageLimit,
          statusNode: modal.toolbarStatus,
          loading: false,
          onRetry: () => {
            if (currentModal() === modal && !modal.loading) void retryPreviewPages(modal);
          },
        });
      }
      updatePreviewHeaderMeta(modal, {
        node: modal.headerMeta?.node?.value?.textContent || '',
        author: modal.headerMeta?.author?.value?.textContent || '',
        time: modal.headerMeta?.time?.value?.textContent || '',
        replyCount: modal.previewRecords.length,
      });
      return true;
    })().catch(() => false);
    modal.replySyncPromise = promise;
    try {
      return await promise;
    } finally {
      if (modal.replySyncPromise === promise) modal.replySyncPromise = null;
      if (modal.replySyncController === controller) modal.replySyncController = null;
      modal.replySyncing = false;
    }
  }

  function getPreviewFailedPages(modal: PreviewModalState | null | undefined): number[] {
    return Array.from(new Set((Array.isArray(modal?.failedPages) ? modal.failedPages : [])
      .map((page) => Number(page))
      .filter((page) => Number.isInteger(page) && page >= 1)))
      .sort((a, b) => a - b);
  }

  async function retryPreviewPages(modal: PreviewModalState | null): Promise<boolean> {
    if (!modal || modal.loading) return false;
    const retryPages = getPreviewFailedPages(modal);
    const info = getPostInfo(modal.url?.href || '');
    const section = qs(modal.body, '.xns-preview-comments');
    if (!retryPages.length || !info || !section || !modal.previewSeed) return false;

    const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
    modal.requestController?.abort();
    modal.requestController = requestController;
    modal.loading = true;
    const refresh = qs(modal.dialog, '.xns-refresh-post');
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status') as HTMLElement | null;
    refresh?.classList.add('xns-action-pending');
    refresh?.setAttribute('aria-busy', 'true');
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status is-loading';
      toolbarStatus.hidden = false;
      toolbarStatus.removeAttribute('title');
      toolbarStatus.textContent = `正在重试 ${retryPages.length} 个失败分页…`;
    }

    const pageLimit = Math.min(maxPage, Math.max(1, Number(modal.pageLimit) || maxPage));
    const totalPages = Math.max(1, Number(modal.totalPages) || pageLimit);
    const targetPages = Math.min(pageLimit, totalPages);
    const loadedPages = Array.from({ length: targetPages }, (_, index) => index + 1)
      .filter((page) => !retryPages.includes(page));
    const retryAgain = (): void => {
      if (currentModal() === modal && !modal.loading) void retryPreviewPages(modal);
    };
    const renderProgress = (progress: PageProgress & { records: CommentRecord[] }, loading: boolean): void => {
      if (currentModal() !== modal || !progress) return;
      modal.failedPages = [...(progress.failedPages || [])];
      modal.totalPages = progress.totalPages || modal.totalPages;
      modal.pageLimit = progress.pageLimit || modal.pageLimit;
      const currentLimit = Math.min(maxPage, Math.max(1, Number(modal.pageLimit) || maxPage));
      const currentTotal = Math.max(1, Number(modal.totalPages) || currentLimit);
      modal.loadedPages = Math.max(0, Math.min(currentLimit, currentTotal) - modal.failedPages.length);
      modal.challengePages = [...(progress.challengePages || [])];
      renderPreviewSection(section, info, progress.records, {
        ...progress,
        loadedPages: modal.loadedPages,
        statusNode: toolbarStatus,
        loading,
        onRetry: retryAgain,
      });
    };

    try {
      const preview = await loadPreviewRecords(info, modal.previewSeed, {
        noStore: true,
        allowCache: false,
        // 重试必须沿用本次预览的分页边界；设置面板可以在弹窗打开后被修改，
        // 但不能因此把当前失败页从重试目标中静默过滤掉。
        pageLimit,
        initialRecords: modal.previewRecords || [],
        onlyPages: retryPages,
        initialLoadedPages: loadedPages,
        initialFailedPages: retryPages,
        initialChallengePages: (modal.challengePages || []).filter((page) => retryPages.includes(Number(page))),
        signal: requestController?.signal,
        onRecordsLoaded: (progress) => renderProgress(progress, true),
      });
      if (currentModal() !== modal) return false;
      applyPreviewResult(modal, preview);
      renderProgress({ ...preview, records: preview.records }, false);
      updatePreviewHeaderMeta(modal, {
        node: modal.headerMeta?.node?.value?.textContent || '',
        author: modal.headerMeta?.author?.value?.textContent || '',
        time: modal.headerMeta?.time?.value?.textContent || '',
        replyCount: preview.records.length,
      });
      return true;
    } catch (error) {
      if (currentModal() === modal) showPreviewRefreshError(modal, error);
      return false;
    } finally {
      if (modal.requestController === requestController) modal.requestController = null;
      modal.loading = false;
      refresh?.classList.remove('xns-action-pending');
      refresh?.removeAttribute('aria-busy');
    }
  }

  async function loadPreviewModal(
    modal: PreviewModalState | null,
    loadingText: string,
    options: { preserveContent?: boolean; noStore?: boolean } = {},
  ): Promise<boolean> {
    if (!modal || modal.loading) return false;
    const preserveContent = Boolean(options.preserveContent);
    const fresh = preserveContent || options.noStore === true;
    const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
    modal.requestController?.abort();
    modal.requestController = requestController;
    modal.refreshScrollCleanup?.();
    modal.featureCleanup?.();
    modal.featureCleanup = null;
    modal.loading = true;
    const generation = (modal.loadGeneration || 0) + 1;
    modal.loadGeneration = generation;
    const refresh = qs(modal.dialog, '.xns-refresh-post');
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status') as HTMLElement | null;
    refresh?.classList.add('xns-action-pending');
    refresh?.setAttribute('aria-busy', 'true');
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status is-loading';
      toolbarStatus.hidden = false;
      toolbarStatus.removeAttribute('title');
      toolbarStatus.textContent = preserveContent ? '正在刷新…' : '正在读取…';
    }
    closeImageLightbox();
    if (!preserveContent) {
      modal.body.scrollTop = 0;
      clearElement(modal.body);
      modal.body.appendChild(createElement('p', 'xns-loading', loadingText));
    }
    try {
      const response = await fetchHtml(modal.url, { noStore: fresh, allowCache: !fresh, signal: requestController?.signal });
      const parsed = parseHtml(response.html);
      modal.previewSeed = parsed;
      const preview = buildPreviewContent(modal.url, parsed, {
        noStore: fresh,
        allowCache: !fresh,
        renderDetached: preserveContent,
        signal: requestController?.signal,
        statusNode: toolbarStatus,
        onRetry: () => {
          if (currentModal() === modal && !modal.loading) void retryPreviewPages(modal);
        },
      });
      let hydratedPreview: LoadPreviewResult | null = null;
      if (preserveContent && preview.hydrate) hydratedPreview = await preview.hydrate;
      if (currentModal() !== modal || modal.loadGeneration !== generation) return false;
      const scrollSnapshot = preserveContent ? capturePreviewScroll(modal.body) : null;
      modal.title.textContent = preview.title || 'NodeSeek 帖子预览';
      updatePreviewHeaderMeta(modal, preview.headerMeta);
      clearElement(modal.body);
      modal.body.appendChild(preview.content);
      if (modal.composer && !modal.composer.isConnected) modal.body.appendChild(modal.composer);
      const previewPost = qs(modal.body, '.xns-preview-post');
      if (previewPost) installPreviewFeatures(previewPost);
      if (!preserveContent && preview.hydrate) {
        hydratedPreview = await preview.hydrate;
        if (currentModal() !== modal || modal.loadGeneration !== generation) return false;
      }
      updatePreviewHeaderMeta(modal, {
        ...preview.headerMeta,
        replyCount: hydratedPreview?.records?.length ?? preview.headerMeta?.replyCount,
      });
      if (hydratedPreview) {
        modal.previewSeed = parsed;
        applyPreviewResult(modal, hydratedPreview);
      }
      if (preserveContent) stabilizePreviewScroll(modal, scrollSnapshot, generation);
    } catch (error) {
      if (currentModal() === modal && modal.loadGeneration === generation) {
        if (preserveContent) showPreviewRefreshError(modal, error);
        else showPreviewLoadError(modal, error);
      }
    } finally {
      if (modal.requestController === requestController) modal.requestController = null;
      modal.loading = false;
      refresh?.classList.remove('xns-action-pending');
      refresh?.removeAttribute('aria-busy');
      if (modal.pendingReplySync && currentModal() === modal) {
        modal.pendingReplySync = false;
        windowObj.setTimeout(() => { void syncPreviewReply(modal); }, 0);
      }
    }
    return true;
  }

  function refreshPreviewModal(): void {
    const modal = currentModal();
    if (!modal || modal.loading || modal.replySyncing) return;
    void loadPreviewModal(modal, '正在刷新帖子…', { preserveContent: true });
  }

  function openPreviewModal(url: URL, fallbackLink?: Element | null): void {
    closeModal();
    const fetchUrl = url.search || url.hash ? new URL(url.pathname, url.origin) : url;
    const shareUrl = getCanonicalPostUrl(fetchUrl);
    const overlay = createElement('div', 'xns-overlay');
    overlay.tabIndex = -1;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(); });
    const dialog = createElement('section', 'xns-modal');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const header = createElement('header', 'xns-modal-header');
    const heading = createElement('div', 'xns-modal-heading');
    const title = createElement('h2', 'xns-modal-title', '正在加载帖子…');
    const headerMeta = createPreviewHeaderMeta();
    heading.append(title, headerMeta.root);
    const actions = createElement('div', 'xns-modal-actions');
    const replyPost = createElement('button', 'xns-modal-reply', '回复帖子') as HTMLButtonElement;
    replyPost.type = 'button';
    replyPost.title = '回复帖子';
    replyPost.addEventListener('click', () => openPreviewComposer('post-reply', null));
    const original = createElement('a', 'xns-modal-original', '打开原帖') as HTMLAnchorElement;
    original.href = url.href;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    original.title = '在新标签打开原帖';
    const share = createShareButton(({ setLabel }) => {
      void copyPreviewLink(shareUrl, setLabel).catch(() => {
        setLabel('复制失败');
        windowObj.setTimeout(() => setLabel('分享'), 1_800);
      });
    });
    const close = createCloseButton(closeModal);
    actions.append(replyPost, original, share, close);
    header.append(heading, actions);
    const toolbar = createElement('div', 'xns-modal-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '预览工具');
    const toolbarStatus = createElement('span', 'xns-modal-toolbar-status xns-preview-status', '准备读取…');
    toolbar.append(
      toolbarStatus,
      createRefreshButton(() => { void refreshPreviewModal(); }),
    );
    const composerHost = createElement('div', 'xns-preview-composer-host');
    composerHost.hidden = true;
    const body = createElement('div', 'xns-modal-body');
    body.appendChild(createElement('p', 'xns-loading', '正在读取帖子内容…'));
    dialog.append(header, toolbar, composerHost);
    dialog.appendChild(body);
    const scrollCleanup = installPreviewScrollButtons(dialog, body);
    overlay.appendChild(dialog);
    documentObj.body.appendChild(overlay);
    documentObj.documentElement.style.overflow = 'hidden';
    state.modal = {
      overlay, dialog, body, composerHost, title, url: fetchUrl, fallbackLink: fallbackLink || null,
      postId: getPostInfo(fetchUrl.href)?.postId || '', composer: null, scrollCleanup, featureCleanup: null,
      headerMeta: headerMeta.items, loading: false, loadGeneration: 0, requestController: null,
      replySyncController: null, replySyncPromise: null, replySyncing: false, pendingReplySync: false,
      toolbarStatus, previewSeed: null, previewRecords: [], loadedPages: 0, failedPages: [],
      challengePages: [], truncated: false, totalPages: null, pageLimit: maxPage,
    };
    overlay.focus();
    void loadPreviewModal(currentModal(), '正在读取帖子内容…');
  }

  return Object.freeze({ buildPreviewContent, loadPreviewModal, refreshPreviewModal, syncPreviewReply, openPreviewModal });
}

const xnsPreviewController = createPreviewController({
  windowObj: window,
  documentObj: document,
  state,
  selectors: SELECTORS,
  maxPage: MAX_PAGE,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  buildPostUrl,
  sanitizeImportedNode,
  parseHtml,
  fetchHtml,
  getPageNumbers,
  collectPageRecords,
  loadPreviewRecords,
  buildPreviewPostNode,
  renderPreviewRecords,
  installPreviewFeatures,
  installPreviewScrollButtons,
  closeImageLightbox,
  closeModal,
  createCloseButton,
  createRefreshButton,
  createShareButton,
  openPreviewComposer,
});
function buildPreviewContent(...args: Parameters<typeof xnsPreviewController.buildPreviewContent>) { return xnsPreviewController.buildPreviewContent(...args); }
function loadPreviewModal(...args: Parameters<typeof xnsPreviewController.loadPreviewModal>) { return xnsPreviewController.loadPreviewModal(...args); }
function syncPreviewReply(modal: unknown): Promise<boolean> {
  return xnsPreviewController.syncPreviewReply(modal as PreviewModalState | null);
}
function refreshPreviewModal(...args: Parameters<typeof xnsPreviewController.refreshPreviewModal>) { return xnsPreviewController.refreshPreviewModal(...args); }
function openPreviewModal(...args: Parameters<typeof xnsPreviewController.openPreviewModal>) { return xnsPreviewController.openPreviewModal(...args); }

export { openPreviewModal, refreshPreviewModal, syncPreviewReply };
