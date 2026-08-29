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
}) {
  return class PostPageController {
    constructor(info) {
      this.info = info;
      this.list = null;
      this.originalChildren = [];
      this.records = [];
      this.loadedPages = 0;
      this.failedPages = [];
      this.truncated = false;
      this.totalPages = null;
      this.toolbar = null;
      this.statusNode = null;
      this.loadingNode = null;
      this.loading = false;
      this.hasRemotePages = false;
      this.virtualizer = null;
      this.generation = 0;
      this.composer = null;
      this.requestController = null;
    }

    async init() {
      this.list = await this.waitForCommentList();
      if (!this.list) return;
      this.originalChildren = Array.from(this.list.childNodes);
      this.createToolbar();
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
      toolbar.appendChild(createElement('span', '', '评论布局：'));
      [['thread', '楼中楼'], ['original', '原版']].forEach(([mode, text]) => {
        const button = createElement('button', '', text);
        button.type = 'button';
        button.dataset.mode = mode;
        button.addEventListener('click', () => this.setMode(mode));
        toolbar.appendChild(button);
      });
      toolbar.appendChild(createElement('span', 'xns-toolbar-status'));
      this.list.closest(selectors.commentContainer)?.insertAdjacentElement('beforebegin', toolbar);
      this.toolbar = toolbar;
      this.updateToolbar();
    }

    updateToolbar() {
      if (!this.toolbar) return;
      qsa(this.toolbar, '[data-mode]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.mode === appState.mode));
      });
      const status = qs(this.toolbar, '.xns-toolbar-status');
      if (status) status.textContent = this.records.length ? `${this.records.length} 条评论` : '读取中…';
    }

    async reloadPages(options = {}) {
      if (!this.list) return;
      const generation = ++this.generation;
      this.requestController?.abort();
      const requestController = windowObj.AbortController ? new windowObj.AbortController() : null;
      this.requestController = requestController;
      this.loading = true;
      this.showLoading('正在读取评论分页…');
      try {
        if (options.refreshCurrentPage) await this.adoptNewReplies(generation, requestController?.signal);
        if (generation !== this.generation) return;
        this.loadCurrentPage();
        if (appState.mode === 'thread') this.render({ progressive: true });
        await this.loadPages(generation, options, requestController?.signal);
        if (generation !== this.generation) return;
        this.loading = false;
        this.render();
      } catch (error) {
        if (generation !== this.generation) return;
        this.restoreOriginal();
        this.showStatus(`楼中楼读取失败：${error.message || '网络错误'}，已保留原版布局。`);
      } finally {
        if (this.requestController === requestController) this.requestController = null;
        if (generation === this.generation) {
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
      const discovered = getPageNumbers(documentObj, this.info.postId);
      this.totalPages = discovered.size ? Math.max(...discovered, this.info.page) : this.info.page;
      this.truncated = this.totalPages > maxPage;
      this.hasRemotePages = this.totalPages > 1 || this.info.page > 1;
    }

    async adoptNewReplies(generation, signal) {
      try {
        const response = await fetchHtml(new URL(`/post-${this.info.postId}-${this.info.page}`, windowObj.location.origin), { noStore: true, signal });
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
      this.failedPages = [];
      const remoteRecords = [];
      const fresh = options.noStore === true || options.refreshCurrentPage === true;
      const { loadedPages, failedPages, truncated, totalPages } = await fetchPostPages(this.info, documentObj, {
        noStore: fresh,
        allowCache: !fresh,
        retainDocuments: false,
        signal,
        onPageLoaded: (page, root) => {
          if (page !== this.info.page) remoteRecords.push(...this.collectRemoteRecords(root, page));
        },
        isAborted: () => generation !== this.generation,
      });
      if (generation !== this.generation) return;
      this.loadedPages = loadedPages;
      this.failedPages = failedPages;
      this.truncated = truncated;
      this.totalPages = totalPages;

      const allRecords = [...this.records, ...remoteRecords];
      const unique = new Map();
      allRecords.forEach((record) => {
        const previous = unique.get(record.floor);
        if (!previous || record.current) unique.set(record.floor, record);
      });
      this.records = Array.from(unique.values());
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
    }

    showLoading(text) {
      this.loadingNode?.remove();
      this.loadingNode = createElement('div', 'xns-loading', text);
      this.list?.closest(selectors.commentContainer)?.insertAdjacentElement('beforebegin', this.loadingNode);
    }

    showStatus(text) {
      this.statusNode?.remove();
      this.statusNode = createElement('div', 'xns-status', text);
      this.list?.closest(selectors.commentContainer)?.insertAdjacentElement('beforebegin', this.statusNode);
    }

    render(options = {}) {
      if (!this.list || appState.mode !== 'thread') return;
      if (!this.virtualizer) {
        this.restoreOriginal({ releaseRemote: false });
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
      let status = this.failedPages.length
        ? `楼中楼已整理：读取 ${loadedPages} 页，${this.failedPages.length} 页失败。`
        : loading && this.hasRemotePages
          ? `楼中楼已整理：已读取 ${loadedPages} 页，正在读取其他分页…`
        : `楼中楼已整理：共读取 ${loadedPages} 页。`;
      if (this.truncated) status += ` 帖子共 ${this.totalPages} 页，只读取了前 ${maxPage} 页，后面页的楼层没有显示。`;
      this.showStatus(status);
      this.updateToolbar();
    }

    restoreOriginal(options = {}) {
      if (!this.list) return;
      this.virtualizer?.destroy();
      this.virtualizer = null;
      qsa(this.list, '.xns-reply-list, .xns-remote-note').forEach((node) => node.remove());
      this.originalChildren.forEach(stripRenderArtifacts);
      while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
      this.originalChildren.forEach((node) => this.list.appendChild(node));
      if (options.releaseRemote !== false) this.records.forEach(releaseCommentNode);
      this.statusNode?.remove();
      this.statusNode = null;
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
});
