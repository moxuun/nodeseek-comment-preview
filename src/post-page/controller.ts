import { flattenReplyTree, mergeCommentRecords } from '../comments/thread.js';
import { MAX_PAGE, SELECTORS, state } from '../core/config.js';
import { createElement, findCommentList, getCommentId, getCommentItems, getFloor, qs, qsa } from '../core/dom.js';
import { getMaxPage, updateSettings } from '../core/preferences.js';
import { fetchPostPages } from '../data/page-loader.js';
import { installPreviewFeatures } from '../features/content.js';
import { getCommentRecord, releaseCommentNode, sanitizeImportedNode } from '../nodeseek/content-parser.js';
import { fetchHtml, parseHtml } from '../nodeseek/http.js';
import { getCurrentUserUid } from '../nodeseek/identity.js';
import { getPageNumbers } from '../nodeseek/pagination.js';
import { getSsrState } from '../nodeseek/ssr-state.js';
import { buildPostUrl } from '../nodeseek/url.js';
import { addRemoteNote, stripRenderArtifacts } from '../preview/render-utils.js';
import { prepareCommentRecord, updateThreadGeometry } from '../preview/renderer.js';
import { createCommentVirtualizer } from '../preview/virtualizer.js';
import { formatPageStatus } from '../ui/status.js';
import type { PageProgress } from '../data/page-loader.js';
import type { CommentRecord } from '../nodeseek/content-parser.js';
import type { PostInfo } from '../nodeseek/url.js';
import type { CommentVirtualizer, VirtualizerHost, VirtualizerSetupOptions } from '../preview/virtualizer.js';

// 帖子详情页控制器。
// 它只管理原始楼层快照、评论布局模式和分页生命周期；预览入口由 preview/entry.ts 管理。

/** 重新读取分页的选项。 */
interface ReloadPagesOptions {
  onlyPages?: unknown[];
  initialChallengePages?: unknown[];
  refreshCurrentPage?: boolean;
  noStore?: boolean;
}

/** 渲染选项：`progressive` 表示这是分页未读完时的阶段性渲染。 */
interface RenderOptions {
  progressive?: boolean;
}

/** 恢复原版布局的选项。 */
interface RestoreOriginalOptions {
  releaseRemote?: boolean;
}

/** sessionStorage 里跨页传递的官方编辑器请求。 */
interface NativeEditRequest {
  postId?: unknown;
  floor?: unknown;
}

/** 控制器依赖：全部由入口注入，测试可替换。 */
interface PostPageControllerDeps {
  documentObj: Document;
  windowObj: Window & typeof globalThis;
  appState: typeof state;
  selectors: typeof SELECTORS;
  maxPage: number;
  findCommentList: typeof findCommentList;
  createElement: typeof createElement;
  qs: typeof qs;
  qsa: typeof qsa;
  fetchHtml: typeof fetchHtml;
  parseHtml: typeof parseHtml;
  getFloor: typeof getFloor;
  getCommentItems: typeof getCommentItems;
  sanitizeImportedNode: typeof sanitizeImportedNode;
  releaseCommentNode: typeof releaseCommentNode;
  getSsrState: typeof getSsrState;
  getCurrentUserUid: typeof getCurrentUserUid;
  getCommentRecord: typeof getCommentRecord;
  fetchPostPages: typeof fetchPostPages;
  flattenReplyTree: typeof flattenReplyTree;
  createCommentVirtualizer: typeof createCommentVirtualizer;
  prepareCommentRecord: typeof prepareCommentRecord;
  updateThreadGeometry: typeof updateThreadGeometry;
  addRemoteNote: typeof addRemoteNote;
  installPreviewFeatures: typeof installPreviewFeatures;
  formatPageStatus: typeof formatPageStatus;
  updateSettings: typeof updateSettings;
  getMaxPage: typeof getMaxPage;
  buildPostUrl: typeof buildPostUrl;
}

function createPostPageController({
  documentObj,
  windowObj,
  appState,
  selectors,
  maxPage,
  findCommentList,
  createElement,
  qs,
  qsa,
  fetchHtml,
  parseHtml,
  getFloor,
  getCommentItems,
  sanitizeImportedNode,
  releaseCommentNode,
  getSsrState,
  getCurrentUserUid,
  getCommentRecord,
  fetchPostPages,
  flattenReplyTree,
  createCommentVirtualizer,
  prepareCommentRecord,
  updateThreadGeometry,
  addRemoteNote,
  installPreviewFeatures,
  formatPageStatus,
  updateSettings,
  getMaxPage,
  buildPostUrl,
}: PostPageControllerDeps) {
  const NATIVE_EDIT_REQUEST_KEY = 'xns-comment-preview-native-edit';

  return class PostPageController {
    info: PostInfo;
    list: Element | null;
    originalChildren: Node[];
    records: CommentRecord[];
    loadedPages: number;
    failedPages: number[];
    challengePages: number[];
    truncated: boolean;
    totalPages: number | null;
    toolbar: HTMLElement | null;
    statusNode: Element | null;
    loadingNode: Element | null;
    toolbarStatusText: string;
    toolbarStatusTone: string;
    toolbarStatusDetail: string;
    loading: boolean;
    hasRemotePages: boolean;
    virtualizer: CommentVirtualizer | null;
    generation: number;
    progressiveTimer: number;
    progressiveRendered: boolean;
    composer: HTMLElement | null;
    requestController: AbortController | null;

    constructor(info: PostInfo) {
      this.info = info;
      this.list = null;
      this.originalChildren = [];
      this.records = [];
      this.loadedPages = 0;
      this.failedPages = [];
      this.challengePages = [];
      this.truncated = false;
      this.totalPages = null;
      this.toolbar = null;
      this.statusNode = null;
      this.loadingNode = null;
      this.toolbarStatusText = '';
      this.toolbarStatusTone = '';
      this.toolbarStatusDetail = '';
      this.loading = false;
      this.hasRemotePages = false;
      this.virtualizer = null;
      this.generation = 0;
      this.progressiveTimer = 0;
      this.progressiveRendered = false;
      this.composer = null;
      this.requestController = null;
    }

    consumeNativeEditRequest(): string | null {
      try {
        const raw = windowObj.sessionStorage?.getItem(NATIVE_EDIT_REQUEST_KEY);
        windowObj.sessionStorage?.removeItem(NATIVE_EDIT_REQUEST_KEY);
        const request = (raw ? JSON.parse(raw) : null) as NativeEditRequest | null;
        if (!request || String(request.postId) !== String(this.info.postId)) return null;
        if (!/^\d{1,15}$/.test(String(request.floor))) return null;
        return String(request.floor);
      } catch {
        return null;
      }
    }

    openNativeEditAfterReload(floor: string): void {
      if (this.applyNativeEdit(this.getSsrCommentIndex(null, floor))) return;
      const started = Date.now();
      const findEdit = (): Element | undefined => {
        const comment = Array.from(this.list?.children || [])
          .find((node) => node.nodeType === 1 && String(node.id) === String(floor));
        return Array.from(comment?.querySelectorAll?.(':scope > .comment-menu > .menu-item, :scope > .comment-actions > .menu-item') || [])
          .find((item) => (item.textContent || '').trim() === '编辑');
      };
      const check = (): void => {
        const edit = findEdit();
        if (edit) {
          (edit as HTMLElement).click();
          return;
        }
        if (Date.now() - started < 12_000) windowObj.setTimeout(check, 80);
      };
      check();
    }

    rememberNativeEditRequest(floor: number | string): boolean {
      try {
        windowObj.sessionStorage?.setItem(NATIVE_EDIT_REQUEST_KEY, JSON.stringify({
          postId: this.info.postId,
          floor: String(floor),
        }));
        return true;
      } catch {
        return false;
      }
    }

    // 官方编辑器只接受 __config__.postData.comments 的下标，先用 commentId 定位，
    // 拿不到 commentId 时退回楼层号。
    getSsrCommentIndex(commentId: number | string | null, floor: number | string | null): number {
      const comments = getSsrState(documentObj)?.postData?.comments;
      if (!Array.isArray(comments)) return -1;
      if (commentId !== null && commentId !== undefined) {
        const byCommentId = comments.findIndex((item) => String(item?.commentId) === String(commentId));
        if (byCommentId >= 0) return byCommentId;
      }
      if (floor === null || floor === undefined) return -1;
      return comments.findIndex((item) => String(item?.floorIndex) === String(floor));
    }

    // 直接调用官方编辑器入口：就地展开编辑器，不再整页刷新、不再退回原版列表。
    applyNativeEdit(index: number): boolean {
      if (!Number.isInteger(index) || index < 0) return false;
      const editor = (windowObj as unknown as { editor?: { edit?: (index: number) => void } }).editor;
      if (typeof editor?.edit !== 'function') return false;
      editor.edit(index);
      return true;
    }

    async init(): Promise<void> {
      this.list = await this.waitForCommentList();
      if (!this.list) return;
      this.originalChildren = Array.from(this.list.childNodes);
      this.createToolbar();
      const nativeEditFloor = this.consumeNativeEditRequest();
      if (nativeEditFloor) {
        await this.reloadPages();
        this.openNativeEditAfterReload(nativeEditFloor);
        return;
      }
      await this.reloadPages();
    }

    waitForCommentList(): Promise<Element | null> {
      return new Promise((resolve) => {
        const started = Date.now();
        const check = (): void => {
          const list = findCommentList();
          if (list || Date.now() - started > 12_000) resolve(list);
          else windowObj.setTimeout(check, 80);
        };
        check();
      });
    }

    createToolbar(): void {
      if (this.toolbar || !this.list) return;
      const list = this.list;
      const toolbar = createElement('nav', 'xns-post-toolbar');
      toolbar.setAttribute('aria-label', '评论布局');
      const modeSwitch = createElement('span', 'xns-post-mode-switch');
      modeSwitch.setAttribute('role', 'group');
      modeSwitch.setAttribute('aria-label', '评论布局');
      [['thread', '楼中楼', '切换到楼中楼布局'], ['original', '原版', '恢复官方评论布局']].forEach(([mode, text, title]) => {
        const button = createElement('button', '', text) as HTMLButtonElement;
        button.type = 'button';
        button.dataset.mode = mode;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.addEventListener('click', () => this.setMode(mode));
        modeSwitch.appendChild(button);
      });
      toolbar.appendChild(modeSwitch);
      toolbar.appendChild(createElement('span', 'xns-toolbar-status'));
      const refresh = createElement('button', 'xns-post-refresh', '刷新') as HTMLButtonElement;
      refresh.type = 'button';
      refresh.title = '重新读取当前页和评论分页';
      refresh.setAttribute('aria-label', '重新读取当前页和评论分页');
      refresh.addEventListener('click', () => {
        if (this.loading) return;
        if (this.failedPages.length) void this.reloadPages({
          onlyPages: [...this.failedPages],
          initialChallengePages: [...this.challengePages],
        });
        else void this.reloadPages({ refreshCurrentPage: true });
      });
      toolbar.appendChild(refresh);
      const container = list.closest(selectors.commentContainer);
      container?.insertBefore(toolbar, list);
      this.toolbar = toolbar;
      this.updateToolbar();
    }

    updateToolbar(): void {
      const toolbar = this.toolbar;
      if (!toolbar) return;
      qsa(toolbar, '[data-mode]').forEach((button) => {
        button.setAttribute('aria-pressed', String((button as HTMLElement).dataset.mode === appState.mode));
      });
      const refresh = qs(toolbar, '.xns-post-refresh') as HTMLButtonElement | null;
      if (refresh) {
        refresh.disabled = this.loading;
        refresh.setAttribute('aria-busy', String(this.loading));
        const retrying = !this.loading && this.failedPages.length > 0;
        refresh.textContent = retrying ? '重试' : '刷新';
        refresh.title = retrying ? '重新读取分页' : '重新读取当前页和评论分页';
        refresh.setAttribute('aria-label', retrying ? '重新读取分页' : '重新读取当前页和评论分页');
      }
      const status = qs(toolbar, '.xns-toolbar-status') as HTMLElement | null;
      if (!status) return;
      const text = this.toolbarStatusText || (this.records.length ? `${this.records.length} 条评论` : '读取中…');
      status.className = `xns-toolbar-status${this.toolbarStatusTone ? ` ${this.toolbarStatusTone}` : ''}`;
      status.textContent = text;
      const detail = this.toolbarStatusDetail || (text.length > 24 ? text : '');
      if (detail && detail !== text) status.title = detail;
      else if (text.length > 24) status.title = text;
      else status.removeAttribute('title');
    }

    async reloadPages(options: ReloadPagesOptions = {}): Promise<void> {
      if (!this.list) return;
      const pageLimit = Math.min(maxPage, Math.max(1, Number(getMaxPage?.()) || maxPage));
      const retryPages = Array.isArray(options.onlyPages)
        ? [...new Set(options.onlyPages.map((page) => Number(page)).filter((page) => Number.isInteger(page) && page >= 1 && page <= pageLimit))]
        : [];
      const retryOnly = retryPages.length > 0;
      const generation = ++this.generation;
      this.clearProgressiveRender();
      this.progressiveRendered = false;
      this.requestController?.abort();
      const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
      this.requestController = requestController;
      this.loading = true;
      this.showLoading(retryOnly ? `正在重试 ${retryPages.length} 个失败分页…` : '正在读取评论分页…');
      try {
        if (options.refreshCurrentPage) await this.adoptNewReplies(generation, requestController?.signal);
        if (generation !== this.generation) return;
        if (!retryOnly) this.loadCurrentPage();
        if (appState.mode === 'thread') this.render({ progressive: true });
        await this.loadPages(generation, { ...options, onlyPages: retryOnly ? retryPages : undefined }, requestController?.signal);
        if (generation !== this.generation) return;
        this.clearProgressiveRender();
        this.loading = false;
        if (appState.mode === 'thread') this.render();
        else this.showStatus('原版评论已刷新。');
      } catch (error) {
        if (generation !== this.generation) return;
        this.restoreOriginal();
        this.showStatus(`楼中楼读取失败：${(error as Error).message || '网络错误'}，已保留原版布局。`);
      } finally {
        if (this.requestController === requestController) this.requestController = null;
        if (generation === this.generation) {
          this.clearProgressiveRender();
          this.loading = false;
          this.loadingNode?.remove();
          this.loadingNode = null;
          this.updateToolbar();
        }
      }
    }

    loadCurrentPage(): void {
      const state = getSsrState(documentObj);
      const records: CommentRecord[] = [];
      this.originalChildren.forEach((item, index) => {
        if (item.nodeType !== 1) return;
        const record = getCommentRecord(item as Element, this.info.postId, this.info.page, index, true, {
          keepCommentMenu: true,
          state,
          getCurrentUserUid,
        });
        if (record) records.push(record);
      });
      this.records = records;
      this.loadedPages = 1;
      this.failedPages = [];
      this.challengePages = [];
      const discovered = getPageNumbers(documentObj, this.info.postId);
      this.totalPages = discovered.size ? Math.max(...discovered, this.info.page) : this.info.page;
      this.truncated = this.totalPages > getMaxPage();
      this.hasRemotePages = this.totalPages > 1 || this.info.page > 1;
    }

    async adoptNewReplies(generation: number, signal?: AbortSignal): Promise<void> {
      const list = this.list;
      if (!list) return;
      try {
        const response = await fetchHtml(buildPostUrl(this.info.postId, this.info.page), { noStore: true, signal });
        if (generation !== this.generation) return;
        const parsed = parseHtml(response.html);
        const knownFloors = new Set(this.originalChildren
          .filter((node) => node.nodeType === Node.ELEMENT_NODE)
          .map((node) => getFloor(node as Element))
          .filter((floor) => floor !== null));
        getCommentItems(parsed).forEach((item) => {
          const floor = getFloor(item);
          if (floor === null || knownFloors.has(floor)) return;
          const imported = sanitizeImportedNode(item, { keepCommentMenu: true });
          if (!imported) return;
          knownFloors.add(floor);
          list.appendChild(imported);
          this.originalChildren.push(imported);
        });
      } catch {
        // 当前页重抓失败不阻断：楼中楼仍按已有快照渲染。
      }
    }

    async loadPages(generation: number, options: ReloadPagesOptions = {}, signal?: AbortSignal): Promise<void> {
      const retryPages: number[] = Array.isArray(options.onlyPages) ? (options.onlyPages as number[]) : [];
      const retryOnly = retryPages.length > 0;
      this.failedPages = retryOnly ? [...retryPages] : [];
      this.challengePages = retryOnly
        ? (options.initialChallengePages || []).filter((page) => retryPages.includes(Number(page))).map(Number)
        : [];
      const remoteRecords: CommentRecord[] = [];
      const updateProgress = (progress: PageProgress): void => {
        if (!progress || generation !== this.generation) return;
        this.loadedPages = progress.loadedPages;
        this.failedPages = [...progress.failedPages];
        this.challengePages = [...(progress.challengePages || [])];
        this.truncated = progress.truncated;
        this.totalPages = progress.totalPages;
        this.records = mergeCommentRecords(this.records, remoteRecords);
        this.scheduleProgressiveRender(generation);
      };
      const fresh = options.noStore === true || options.refreshCurrentPage === true;
      const pageLimit = Math.min(maxPage, Math.max(1, Number(getMaxPage?.()) || maxPage));
      const knownTotalPages = Math.max(1, Number(this.totalPages) || pageLimit);
      const initialLoadedPages = retryOnly
        ? Array.from({ length: Math.min(pageLimit, knownTotalPages) }, (_, index) => index + 1)
          .filter((page) => !retryPages.includes(page))
        : undefined;
      const { loadedPages, failedPages, challengePages, truncated, totalPages } = await fetchPostPages(this.info, documentObj, {
        noStore: fresh,
        allowCache: !fresh,
        retainDocuments: false,
        ...(retryOnly ? {
          onlyPages: retryPages,
          initialLoadedPages,
          initialFailedPages: retryPages,
          initialChallengePages: (options.initialChallengePages || []).filter((page) => retryPages.includes(Number(page))) as number[],
        } : {}),
        signal,
        onPageLoaded: (page, root, progress) => {
          if (page !== this.info.page) {
            remoteRecords.push(...this.collectRemoteRecords(root, page));
            updateProgress(progress);
          }
        },
        onPageFailed: (_page, progress) => updateProgress(progress),
        isAborted: () => generation !== this.generation,
      });
      if (generation !== this.generation) return;
      this.loadedPages = loadedPages;
      this.failedPages = failedPages;
      this.challengePages = challengePages;
      this.truncated = truncated;
      this.totalPages = totalPages;

      this.records = mergeCommentRecords(this.records, remoteRecords);
    }

    scheduleProgressiveRender(generation: number): void {
      if (generation !== this.generation || appState.mode !== 'thread' || this.progressiveTimer) return;
      const delay = this.progressiveRendered ? 500 : 300;
      this.progressiveTimer = windowObj.setTimeout(() => {
        this.progressiveTimer = 0;
        if (generation !== this.generation || !this.loading || appState.mode !== 'thread') return;
        this.progressiveRendered = true;
        this.render({ progressive: true });
      }, delay);
    }

    clearProgressiveRender(): void {
      if (this.progressiveTimer) windowObj.clearTimeout(this.progressiveTimer);
      this.progressiveTimer = 0;
    }

    collectRemoteRecords(root: Document, page: number): CommentRecord[] {
      const state = getSsrState(root);
      return getCommentItems(root)
        .map((item, index) => getCommentRecord(item, this.info.postId, page, index, false, {
          keepCommentMenu: true,
          state,
          getCurrentUserUid,
        }))
        .filter((record): record is CommentRecord => Boolean(record));
    }

    setMode(mode: string): void {
      if (!['thread', 'original'].includes(mode)) return;
      appState.mode = mode;
      this.updateToolbar();
      if (mode === 'original') this.restoreOriginal();
      else if (this.records.length) {
        // 原版布局会同时释放远端节点和序列化快照；切回时按正常分页流程重建。
        const needsReload = this.records.some((record) => !record.current && !record.node && !record.html);
        if (needsReload) void this.reloadPages();
        else this.render();
      }
      else void this.reloadPages();
      updateSettings({ mode: mode as 'thread' | 'original' });
    }

    prepareNativeEdit(comment: Element): boolean {
      if (!this.virtualizer || !this.originalChildren.includes(comment)) return false;
      const floor = Number(comment.getAttribute('data-xns-floor') ?? comment.id);
      const index = this.getSsrCommentIndex(getCommentId(comment), Number.isInteger(floor) ? floor : null);
      if (this.applyNativeEdit(index)) return true;
      // 兜底：SSR 数据里还没有这条评论（例如刚发出、还没重载的回复）。
      if (!Number.isInteger(floor) || floor < 0 || !this.rememberNativeEditRequest(floor)) return false;
      windowObj.location.reload();
      return true;
    }

    // 跨页楼层：记录请求并跳到它所在的页面，重载后由 openNativeEditAfterReload 接手。
    requestNativeEdit(record: CommentRecord): boolean {
      const floor = Number(record?.floor);
      const page = Number(record?.page) || 1;
      if (!Number.isInteger(floor) || floor < 0 || !this.rememberNativeEditRequest(floor)) return false;
      const url = buildPostUrl(this.info.postId, page, floor);
      if (!url) return false;
      windowObj.location.assign(url.href);
      return true;
    }

    showLoading(text: string): void {
      this.loadingNode?.remove();
      this.loadingNode = null;
      this.toolbarStatusText = this.records.length ? `${this.records.length} 条评论` : text;
      this.toolbarStatusTone = 'is-loading';
      this.toolbarStatusDetail = text;
      this.updateToolbar();
    }

    showStatus(text: string, tone = '', visibleText = ''): void {
      this.statusNode?.remove();
      this.statusNode = null;
      this.toolbarStatusText = visibleText || (this.records.length ? `${this.records.length} 条评论` : text);
      this.toolbarStatusTone = tone;
      this.toolbarStatusDetail = text;
      this.updateToolbar();
    }

    render(options: RenderOptions = {}): void {
      if (!this.list || appState.mode !== 'thread') return;
      const virtualizerOptions: VirtualizerSetupOptions = {
        getViewport: () => windowObj,
        renderItem: (entry) => (entry.record
          ? prepareCommentRecord(entry.record, entry.depth ?? 0, entry.thread)
          : null),
        onMount: (node, entry) => {
          const record = entry.record;
          if (!record || record.current) return;
          addRemoteNote(record, this.info.postId);
          node.classList.add('xns-preview-content');
          installPreviewFeatures(node);
        },
        onUnmount: (node, entry) => {
          const record = entry.record;
          if (record && !record.current) releaseCommentNode(record);
        },
        // 跨页补全后被复用的节点不会重跑 renderItem，布局刷新交给渲染层的入口。
        onUpdate: updateThreadGeometry,
      };
      if (!this.virtualizer) {
        this.restoreOriginal({ releaseRemote: false });
        // 帖子详情页复用官方的 ul.comments；补上预览线程作用域，
        // 让根楼层蓝栏、楼号和其他预览样式与弹窗预览保持一致。
        this.list.classList.add('xns-preview-thread');
        this.virtualizer = createCommentVirtualizer({
          windowObj,
          documentObj,
          createElement,
          estimatedHeight: 135,
          overscanScreens: 2,
        }).mount(this.list as VirtualizerHost, virtualizerOptions);
      }
      this.virtualizer.setEntries(flattenReplyTree(this.records), virtualizerOptions);
      const loadedPages = this.loadedPages;
      const loading = this.loading || options.progressive;
      const pagination = formatPageStatus({
        loadedPages,
        totalPages: this.totalPages,
        failedPages: this.failedPages,
        challengePages: this.challengePages,
        truncated: this.truncated,
        loading: Boolean(loading) && this.hasRemotePages,
        commentCount: this.records.length,
      });
      const detail = pagination.detail || '暂无分页信息';
      this.showStatus(`楼中楼已整理 · ${detail}`, pagination.tone, pagination.compact);
    }

    restoreOriginal(options: RestoreOriginalOptions = {}): void {
      const list = this.list;
      if (!list) return;
      this.virtualizer?.destroy();
      this.virtualizer = null;
      list.classList.remove('xns-preview-thread');
      qsa(list, '.xns-reply-list, .xns-remote-note').forEach((node) => node.remove());
      this.originalChildren.forEach((node) => stripRenderArtifacts(node as Element));
      while (list.firstChild) list.removeChild(list.firstChild);
      this.originalChildren.forEach((node) => list.appendChild(node));
      if (options.releaseRemote !== false) this.records.forEach(releaseCommentNode);
      this.statusNode?.remove();
      this.statusNode = null;
      this.loadingNode?.remove();
      this.loadingNode = null;
      if (appState.mode === 'original') {
        this.toolbarStatusText = '原版评论';
        this.toolbarStatusTone = '';
        this.toolbarStatusDetail = '';
      } else {
        this.toolbarStatusText = '';
        this.toolbarStatusTone = '';
        this.toolbarStatusDetail = '';
      }
      this.updateToolbar();
    }
  };
}

const PostEnhancer = createPostPageController({
  documentObj: document,
  windowObj: window,
  appState: state,
  selectors: SELECTORS,
  maxPage: MAX_PAGE,
  findCommentList,
  createElement,
  qs,
  qsa,
  fetchHtml,
  parseHtml,
  getFloor,
  getCommentItems,
  sanitizeImportedNode,
  releaseCommentNode,
  getSsrState,
  getCurrentUserUid,
  getCommentRecord,
  fetchPostPages,
  flattenReplyTree,
  createCommentVirtualizer,
  prepareCommentRecord,
  updateThreadGeometry,
  addRemoteNote,
  installPreviewFeatures,
  formatPageStatus,
  updateSettings,
  getMaxPage,
  buildPostUrl,
});

export { PostEnhancer };
