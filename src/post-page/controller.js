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
  getDocState,
  getCurrentUserUid,
  getCommentRecord,
  fetchPostPages,
  buildReplyTree,
  appendNestedRecord,
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
      this.pageDocs = new Map();
      this.failedPages = [];
      this.truncated = false;
      this.totalPages = null;
      this.toolbar = null;
      this.statusNode = null;
      this.loadingNode = null;
      this.generation = 0;
      this.composer = null;
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
      this.showLoading('正在读取评论分页…');
      try {
        if (options.refreshCurrentPage) await this.adoptNewReplies(generation);
        await this.loadPages(generation, options);
        if (generation !== this.generation) return;
        this.render();
      } catch (error) {
        if (generation !== this.generation) return;
        this.restoreOriginal();
        this.showStatus(`楼中楼读取失败：${error.message || '网络错误'}，已保留原版布局。`);
      } finally {
        if (generation === this.generation) {
          this.loadingNode?.remove();
          this.loadingNode = null;
          this.updateToolbar();
        }
      }
    }

    async adoptNewReplies(generation) {
      try {
        const { html } = await fetchHtml(new URL(`/post-${this.info.postId}-${this.info.page}`, windowObj.location.origin), { noStore: true });
        if (generation !== this.generation) return;
        const parsed = parseHtml(html);
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

    async loadPages(generation, options = {}) {
      this.records = [];
      this.failedPages = [];
      const { pageDocs, failedPages, truncated, totalPages } = await fetchPostPages(this.info, documentObj, {
        noStore: options.noStore !== false,
        isAborted: () => generation !== this.generation,
      });
      if (generation !== this.generation) return;
      this.pageDocs = pageDocs;
      this.failedPages = failedPages;
      this.truncated = truncated;
      this.totalPages = totalPages;

      const allRecords = [];
      this.pageDocs.forEach((root, page) => {
        const state = getDocState(root);
        if (root === documentObj && this.originalChildren.length) {
          this.originalChildren.forEach((item, index) => {
            if (item.nodeType !== 1) return;
            const record = getCommentRecord(item, this.info.postId, page, index, true, { keepCommentMenu: true, state, getCurrentUserUid });
            if (record) allRecords.push(record);
          });
          return;
        }
        getCommentItems(root).forEach((item, index) => {
          const record = getCommentRecord(item, this.info.postId, page, index, root === documentObj, { keepCommentMenu: true, state, getCurrentUserUid });
          if (record) allRecords.push(record);
        });
      });
      const unique = new Map();
      allRecords.forEach((record) => {
        const previous = unique.get(record.floor);
        if (!previous || record.current) unique.set(record.floor, record);
      });
      this.records = Array.from(unique.values());
    }

    setMode(mode) {
      if (!['thread', 'original'].includes(mode)) return;
      appState.mode = mode;
      this.updateToolbar();
      if (mode === 'original') this.restoreOriginal();
      else if (this.records.length) this.render();
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

    render() {
      if (!this.list || appState.mode !== 'thread') return;
      this.restoreOriginal();
      buildReplyTree(this.records).forEach((record) => appendNestedRecord(record, this.list, 0));
      this.records.filter((record) => record.node.hasAttribute('data-xns-remote')).forEach((record) => {
        addRemoteNote(record, this.info.postId);
        record.node.classList.add('xns-preview-content');
        installPreviewFeatures(record.node);
      });
      const loadedPages = this.pageDocs.size;
      let status = this.failedPages.length
        ? `楼中楼已整理：读取 ${loadedPages} 页，${this.failedPages.length} 页失败。`
        : `楼中楼已整理：共读取 ${loadedPages} 页。`;
      if (this.truncated) status += ` 帖子共 ${this.totalPages} 页，只读取了前 ${maxPage} 页，后面页的楼层没有显示。`;
      this.showStatus(status);
      this.updateToolbar();
    }

    restoreOriginal() {
      if (!this.list) return;
      qsa(this.list, '.xns-reply-list, .xns-remote-note').forEach((node) => node.remove());
      this.originalChildren.forEach(stripRenderArtifacts);
      while (this.list.firstChild) this.list.removeChild(this.list.firstChild);
      this.originalChildren.forEach((node) => this.list.appendChild(node));
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
  getDocState,
  getCurrentUserUid,
  getCommentRecord,
  fetchPostPages,
  buildReplyTree,
  appendNestedRecord,
  prepareCommentRecord,
  addRemoteNote,
  installPreviewFeatures,
});
