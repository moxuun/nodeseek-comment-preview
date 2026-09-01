// 帖子详情页控制器。
// 它只管理原始楼层快照、评论布局模式和分页生命周期；预览入口由 preview/entry.js 管理。
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
  getDocState,
  getCurrentUserUid,
  getCommentRecord,
  fetchPostPages,
  flattenReplyTree,
  createCommentVirtualizer,
  prepareCommentRecord,
  addRemoteNote,
  installPreviewFeatures,
  formatPageStatus,
  updateSettings,
  getMaxPage,
  buildPostUrl,
}) {
  const NATIVE_EDIT_REQUEST_KEY = 'xns-comment-preview-native-edit';

  return class PostPageController {
    constructor(info) {
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

    consumeNativeEditRequest() {
      try {
        const raw = windowObj.sessionStorage?.getItem(NATIVE_EDIT_REQUEST_KEY);
        windowObj.sessionStorage?.removeItem(NATIVE_EDIT_REQUEST_KEY);
        const request = raw ? JSON.parse(raw) : null;
        if (!request || String(request.postId) !== String(this.info.postId)) return null;
        if (!/^\d{1,15}$/.test(String(request.floor))) return null;
        return String(request.floor);
      } catch {
        return null;
      }
    }

    openNativeEditAfterReload(floor) {
      const started = Date.now();
      const findEdit = () => {
        const comment = Array.from(this.list?.children || [])
          .find((node) => node.nodeType === 1 && String(node.id) === String(floor));
        return Array.from(comment?.querySelectorAll?.(':scope > .comment-menu > .menu-item, :scope > .comment-actions > .menu-item') || [])
          .find((item) => (item.textContent || '').trim() === '编辑');
      };
      const check = () => {
        const edit = findEdit();
        if (edit) {
          edit.click();
          return;
        }
        if (Date.now() - started < 12_000) windowObj.setTimeout(check, 80);
      };
      check();
    }

    async init() {
      this.list = await this.waitForCommentList();
      if (!this.list) return;
      this.originalChildren = Array.from(this.list.childNodes);
      this.createToolbar();
      const nativeEditFloor = this.consumeNativeEditRequest();
      if (nativeEditFloor) {
        appState.mode = 'original';
        this.showStatus('原版评论已恢复。');
        this.openNativeEditAfterReload(nativeEditFloor);
        return;
      }
      await this.reloadPages();
    }

    waitForCommentList() {
      return new Promise((resolve) => {
        const started = Date.now();
        const check = () => {
          const list = findCommentList();
          if (list || Date.now() - started > 12_000) resolve(list);
          else windowObj.setTimeout(check, 80);
        };
        check();
      });
    }

    createToolbar() {
      if (this.toolbar || !this.list) return;
      const toolbar = createElement('nav', 'xns-post-toolbar');
      toolbar.setAttribute('aria-label', '评论布局');
      const modeSwitch = createElement('span', 'xns-post-mode-switch');
      modeSwitch.setAttribute('role', 'group');
      modeSwitch.setAttribute('aria-label', '评论布局');
      [['thread', '楼中楼', '切换到楼中楼布局'], ['original', '原版', '恢复官方评论布局']].forEach(([mode, text, title]) => {
        const button = createElement('button', '', text);
        button.type = 'button';
        button.dataset.mode = mode;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.addEventListener('click', () => this.setMode(mode));
        modeSwitch.appendChild(button);
      });
      toolbar.appendChild(modeSwitch);
      toolbar.appendChild(createElement('span', 'xns-toolbar-status'));
      const refresh = createElement('button', 'xns-post-refresh', '刷新');
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
      const container = this.list.closest(selectors.commentContainer);
      container?.insertBefore(toolbar, this.list);
      this.toolbar = toolbar;
      this.updateToolbar();
    }

    updateToolbar() {
      if (!this.toolbar) return;
      qsa(this.toolbar, '[data-mode]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.mode === appState.mode));
      });
      const refresh = qs(this.toolbar, '.xns-post-refresh');
      if (refresh) {
        refresh.disabled = this.loading;
        refresh.setAttribute('aria-busy', String(this.loading));
        const retrying = !this.loading && this.failedPages.length > 0;
        refresh.textContent = retrying ? '重试' : '刷新';
        refresh.title = retrying ? '重新读取分页' : '重新读取当前页和评论分页';
        refresh.setAttribute('aria-label', retrying ? '重新读取分页' : '重新读取当前页和评论分页');
      }
      const status = qs(this.toolbar, '.xns-toolbar-status');
      if (!status) return;
      const text = this.toolbarStatusText || (this.records.length ? `${this.records.length} 条评论` : '读取中…');
      status.className = `xns-toolbar-status${this.toolbarStatusTone ? ` ${this.toolbarStatusTone}` : ''}`;
      status.textContent = text;
      const detail = this.toolbarStatusDetail || (text.length > 24 ? text : '');
      if (detail && detail !== text) status.title = detail;
      else if (text.length > 24) status.title = text;
      else status.removeAttribute('title');
    }

    async reloadPages(options = {}) {
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
        this.showStatus(`楼中楼读取失败：${error.message || '网络错误'}，已保留原版布局。`);
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

    loadCurrentPage() {
      const state = getDocState(documentObj);
      const records = [];
      this.originalChildren.forEach((item, index) => {
        if (item.nodeType !== 1) return;
        const record = getCommentRecord(item, this.info.postId, this.info.page, index, true, {
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

    async adoptNewReplies(generation, signal) {
      try {
        const response = await fetchHtml(buildPostUrl(this.info.postId, this.info.page), { noStore: true, signal });
        if (generation !== this.generation) return;
        const parsed = parseHtml(response.html, response.url);
        const knownFloors = new Set(this.originalChildren
          .filter((node) => node.nodeType === Node.ELEMENT_NODE)
          .map((node) => getFloor(node))
          .filter((floor) => floor !== null));
        getCommentItems(parsed).forEach((item) => {
          const floor = getFloor(item);
          if (floor === null || knownFloors.has(floor)) return;
          const imported = sanitizeImportedNode(item, { keepCommentMenu: true });
          if (!imported) return;
          knownFloors.add(floor);
          this.list.appendChild(imported);
          this.originalChildren.push(imported);
        });
      } catch {
        // 当前页重抓失败不阻断：楼中楼仍按已有快照渲染。
      }
    }

    async loadPages(generation, options = {}, signal) {
      const retryPages = Array.isArray(options.onlyPages) ? options.onlyPages : [];
      const retryOnly = retryPages.length > 0;
      this.failedPages = retryOnly ? [...retryPages] : [];
      this.challengePages = retryOnly
        ? (options.initialChallengePages || []).filter((page) => retryPages.includes(Number(page))).map(Number)
        : [];
      const remoteRecords = [];
      const updateProgress = (progress) => {
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
          initialChallengePages: (options.initialChallengePages || []).filter((page) => retryPages.includes(Number(page))),
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

    scheduleProgressiveRender(generation) {
      if (generation !== this.generation || appState.mode !== 'thread' || this.progressiveTimer) return;
      const delay = this.progressiveRendered ? 500 : 300;
      this.progressiveTimer = windowObj.setTimeout(() => {
        this.progressiveTimer = 0;
        if (generation !== this.generation || !this.loading || appState.mode !== 'thread') return;
        this.progressiveRendered = true;
        this.render({ progressive: true });
      }, delay);
    }

    clearProgressiveRender() {
      if (this.progressiveTimer) windowObj.clearTimeout(this.progressiveTimer);
      this.progressiveTimer = 0;
    }

    collectRemoteRecords(root, page) {
      const state = getDocState(root);
      return getCommentItems(root)
        .map((item, index) => getCommentRecord(item, this.info.postId, page, index, false, {
          keepCommentMenu: true,
          state,
          getCurrentUserUid,
        }))
        .filter(Boolean);
    }

    setMode(mode) {
      if (!['thread', 'original'].includes(mode)) return;
      appState.mode = mode;
      this.updateToolbar();
      if (mode === 'original') this.restoreOriginal();
      else if (this.records.length) {
        // 原版布局会同时释放远端节点和序列化快照；切回时按正常分页流程重建。
        const needsReload = this.records.some((record) => !record.current && !record.node && !record.html);
        if (needsReload) this.reloadPages();
        else this.render();
      }
      else this.reloadPages();
      updateSettings({ mode });
    }

    prepareNativeEdit(comment) {
      if (!this.virtualizer || !this.originalChildren.includes(comment)) return false;
      const floor = comment.getAttribute('data-xns-floor') || comment.id || '';
      if (!/^\d{1,15}$/.test(String(floor))) return false;
      try {
        windowObj.sessionStorage?.setItem(NATIVE_EDIT_REQUEST_KEY, JSON.stringify({
          postId: this.info.postId,
          floor: String(floor),
        }));
      } catch {
        return false;
      }
      windowObj.location.reload();
      return true;
    }

    showLoading(text) {
      this.loadingNode?.remove();
      this.loadingNode = null;
      this.toolbarStatusText = this.records.length ? `${this.records.length} 条评论` : text;
      this.toolbarStatusTone = 'is-loading';
      this.toolbarStatusDetail = text;
      this.updateToolbar();
    }

    showStatus(text, tone = '', visibleText = '') {
      this.statusNode?.remove();
      this.statusNode = null;
      this.toolbarStatusText = visibleText || (this.records.length ? `${this.records.length} 条评论` : text);
      this.toolbarStatusTone = tone;
      this.toolbarStatusDetail = text;
      this.updateToolbar();
    }

    render(options = {}) {
      if (!this.list || appState.mode !== 'thread') return;
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
        }).mount(this.list, {
          getViewport: () => windowObj,
          renderItem: (entry) => prepareCommentRecord(entry.record, entry.depth),
          onMount: (node, entry) => {
            const record = entry.record;
            if (!record.current) {
              addRemoteNote(record, this.info.postId);
              node.classList.add('xns-preview-content');
              installPreviewFeatures(node);
            }
          },
          onUnmount: (node, entry) => {
            if (!entry.record.current) releaseCommentNode(entry.record);
          },
        });
      }
      this.virtualizer.setEntries(flattenReplyTree(this.records), {
        getViewport: () => windowObj,
        renderItem: (entry) => prepareCommentRecord(entry.record, entry.depth),
        onMount: (node, entry) => {
          const record = entry.record;
          if (!record.current) {
            addRemoteNote(record, this.info.postId);
            node.classList.add('xns-preview-content');
            installPreviewFeatures(node);
          }
        },
        onUnmount: (node, entry) => {
          if (!entry.record.current) releaseCommentNode(entry.record);
        },
      });
      const loadedPages = this.loadedPages;
      const loading = this.loading || options.progressive;
      const pagination = formatPageStatus({
        loadedPages,
        totalPages: this.totalPages,
        failedPages: this.failedPages,
        challengePages: this.challengePages,
        truncated: this.truncated,
        loading: loading && this.hasRemotePages,
        commentCount: this.records.length,
      });
      const detail = pagination.detail || '暂无分页信息';
      this.showStatus(`楼中楼已整理 · ${detail}`, pagination.tone, pagination.compact);
    }

    restoreOriginal(options = {}) {
      if (!this.list) return;
      this.virtualizer?.destroy();
      this.virtualizer = null;
      this.list.classList.remove('xns-preview-thread');
      qsa(this.list, '.xns-reply-list, .xns-remote-note').forEach((node) => node.remove());
      this.originalChildren.forEach(stripRenderArtifacts);
      while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
      this.originalChildren.forEach((node) => this.list.appendChild(node));
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
  getDocState,
  getCurrentUserUid,
  getCommentRecord,
  fetchPostPages,
  flattenReplyTree,
  createCommentVirtualizer,
  prepareCommentRecord,
  addRemoteNote,
  installPreviewFeatures,
  formatPageStatus,
  updateSettings,
  getMaxPage,
  buildPostUrl,
});
