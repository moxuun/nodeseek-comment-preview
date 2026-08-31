// 预览控制器：负责弹窗生命周期、刷新和滚动位置恢复。
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
  createMoreMenu,
  openPreviewComposer,
}) {
  function createPreviewHelpPanel() {
    const panel = createElement('aside', 'xns-modal-help');
    panel.hidden = true;
    panel.setAttribute('aria-label', '预览帮助');
    panel.appendChild(createElement('strong', '', '预览提示'));
    const list = createElement('ul', 'xns-modal-help-list');
    [
      ['Esc', '关闭预览；打开图片时先关闭图片查看器。'],
      ['右侧 ↑ ↓', '快速回到顶部或底部，滚动位置会在刷新后尽量保留。'],
      ['楼层号', '打开原帖对应页，并定位到该楼层。'],
      ['回复 / 编辑', '使用 NodeSeek 原生接口；失败时会保留当前内容并显示原因。'],
    ].forEach(([key, description]) => {
      const item = createElement('li', 'xns-modal-help-item');
      item.append(createElement('kbd', '', key), createElement('span', '', description));
      list.appendChild(item);
    });
    panel.appendChild(list);
    return panel;
  }

  async function copyPreviewLink(url, setLabel) {
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
    windowObj.setTimeout(() => setLabel?.('复制原帖链接'), 1_800);
  }

  function getPreviewHeaderMeta(parsed) {
    const textOf = (node) => node?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || '';
    const post = qs(parsed, '.nsk-post') || parsed;
    const nodeName = textOf(qs(post, '[data-node-name], .node-name, .node-title, .category-name'))
      || textOf(qsa(post, 'a[href*="/node/"], a[href*="/category/"]').find((link) => textOf(link)));
    const author = textOf(qs(post, '.nsk-content-meta-info a.author-name, .nsk-content-meta-info a[href*="/space/"], a.author-name'));
    const time = textOf(qs(post, '.nsk-content-meta-info time, .nsk-content-meta-info [datetime], time[datetime]'));
    return { node: nodeName, author, time, replyCount: null };
  }

  function updatePreviewHeaderMeta(modal, meta) {
    if (!modal?.headerMeta) return;
    const values = {
      node: meta?.node || '',
      author: meta?.author || '',
      time: meta?.time || '',
      replies: Number.isFinite(meta?.replyCount) ? `${meta.replyCount} 条回复` : '',
    };
    Object.entries(values).forEach(([key, value]) => {
      const item = modal.headerMeta[key];
      if (!item) return;
      item.value.textContent = value;
      item.item.hidden = !value;
    });
  }

  function createPreviewHeaderMeta() {
    const root = createElement('div', 'xns-modal-meta');
    const items = {};
    [['node', '节点'], ['author', '作者'], ['time', '时间'], ['replies', '回复']].forEach(([key, label]) => {
      const item = createElement('span', 'xns-modal-meta-item');
      item.hidden = true;
      item.append(createElement('span', 'xns-modal-meta-label', label), createElement('span', 'xns-modal-meta-value'));
      root.appendChild(item);
      items[key] = { item, value: item.lastElementChild };
    });
    return { root, items };
  }

  function buildPreviewContent(url, parsed, options = {}) {
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
    section.appendChild(createElement('h3', '', '楼中楼预览'));
    const thread = createElement('ul', 'xns-preview-thread');
    section.appendChild(thread);
      renderPreviewRecords(section, info, currentRecords, {
        loading: hasRemotePages,
        statusNode: options.statusNode,
        onNodeMounted: (node) => installPreviewFeatures(node),
    });
    wrapper.appendChild(section);
    let progressiveTimer = 0;
    let pendingProgress = null;
    let renderedProgress = false;
    const renderProgress = (progress) => {
      if (!progress || !section.isConnected) return false;
      renderPreviewRecords(section, info, progress.records, {
        ...progress,
        statusNode: options.statusNode,
        onNodeMounted: (node) => installPreviewFeatures(node),
      });
      return true;
    };
    const scheduleProgressiveRender = (progress) => {
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
        renderPreviewRecords(section, info, preview.records, {
          ...preview,
          statusNode: options.statusNode,
          onNodeMounted: (node) => installPreviewFeatures(node),
        });
      }
      return preview;
    });
    return { title, headerMeta, content: wrapper, hydrate };
  }

  function getPreviewScrollOwners(body) {
    return qsa(body, '.xns-preview-post, .xns-preview-thread .content-item[data-comment-id], .xns-preview-thread .content-item[data-xns-floor]');
  }

  function getPreviewScrollOwner(node) {
    return node?.closest?.('.xns-preview-post, .xns-preview-thread .content-item[data-comment-id], .xns-preview-thread .content-item[data-xns-floor]') || null;
  }

  function getPreviewScrollCandidates(body) {
    const seen = new Set();
    const candidates = [];
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

  function getPreviewChildPath(owner, node) {
    const path = [];
    let current = node;
    while (current && current !== owner) {
      const parent = current.parentElement;
      if (!parent) return [];
      const index = Array.prototype.indexOf.call(parent.children, current);
      if (index < 0) return [];
      path.unshift(index);
      current = parent;
    }
    return current === owner ? path : [];
  }

  function capturePreviewScroll(body) {
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    const snapshot = {
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
    const chosen = crossing.reduce((best, row) => (!best || row.rect.top > best.rect.top ? row : best), null)
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

  function findPreviewScrollOwner(body, anchor) {
    if (anchor.isPost) return qs(body, '.xns-preview-post, [data-xns-target-type="post"]');
    if (anchor.commentId) {
      const byCommentId = qs(body, `.xns-preview-thread .content-item[data-comment-id="${CSS.escape(anchor.commentId)}"]`);
      if (byCommentId) return byCommentId;
    }
    if (anchor.floor) return qs(body, `.xns-preview-thread .content-item[data-xns-floor="${CSS.escape(anchor.floor)}"]`);
    return null;
  }

  function resolvePreviewScrollAnchor(body, anchor) {
    const owner = findPreviewScrollOwner(body, anchor);
    if (!owner) return null;
    let node = owner;
    for (const index of anchor.path || []) {
      node = node?.children?.[index] || null;
      if (!node) return owner;
    }
    return !anchor.tagName || node.tagName === anchor.tagName ? node : owner;
  }

  function restorePreviewScroll(body, snapshot) {
    if (!snapshot) return;
    const maxScrollTop = Math.max(0, body.scrollHeight - body.clientHeight);
    if (snapshot.atTop) { body.scrollTop = 0; return; }
    if (snapshot.atBottom) { body.scrollTop = maxScrollTop; return; }
    const anchor = snapshot.anchor ? resolvePreviewScrollAnchor(body, snapshot.anchor) : null;
    if (anchor) {
      const currentOffset = anchor.getBoundingClientRect().top - body.getBoundingClientRect().top;
      const targetScrollTop = body.scrollTop + currentOffset - snapshot.anchor.offset;
      body.scrollTop = Math.max(0, Math.min(targetScrollTop, maxScrollTop));
      return;
    }
    const proportional = Number.isFinite(snapshot.ratio) ? snapshot.ratio * maxScrollTop : snapshot.scrollTop;
    body.scrollTop = Math.max(0, Math.min(proportional, maxScrollTop));
  }

  function stabilizePreviewScroll(modal, snapshot, generation) {
    modal.refreshScrollCleanup?.();
    const body = modal.body;
    let active = true;
    let frame = 0;
    const timers = [];
    const imageHandlers = [];
    const apply = () => {
      frame = 0;
      if (!active || state.modal !== modal || modal.loadGeneration !== generation) return;
      restorePreviewScroll(body, snapshot);
    };
    const schedule = () => {
      if (!active || frame) return;
      frame = windowObj.requestAnimationFrame(apply);
    };
    const cleanup = () => {
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
      if (image.complete) return;
      const done = () => schedule();
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

  function showPreviewLoadError(modal, error) {
    clearElement(modal.body);
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status');
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status is-failed';
      toolbarStatus.hidden = false;
      const detail = error?.message || '网络错误';
      toolbarStatus.textContent = '预览加载失败';
      toolbarStatus.title = detail;
    }
    modal.body.appendChild(createElement('p', 'xns-status', `预览加载失败：${error?.message || '网络错误'}`));
    if (modal.fallbackLink) {
      const link = createElement('a', '', '在原页面打开');
      link.href = modal.fallbackLink.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      modal.body.appendChild(link);
    }
  }

  function showPreviewRefreshError(modal, error) {
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status');
    if (toolbarStatus) {
      toolbarStatus.className = 'xns-modal-toolbar-status xns-preview-status xns-refresh-status is-failed';
      toolbarStatus.hidden = false;
      const detail = error?.message || '网络错误';
      toolbarStatus.textContent = `刷新失败，保留当前内容 · ${detail}`;
      toolbarStatus.title = detail;
    }
  }

  async function loadPreviewModal(modal, loadingText, options = {}) {
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
    const toolbarStatus = qs(modal.dialog, '.xns-modal-toolbar-status');
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
      const preview = buildPreviewContent(modal.url, parseHtml(response.html, response.url), {
        noStore: fresh,
        allowCache: !fresh,
        renderDetached: preserveContent,
        signal: requestController?.signal,
        statusNode: toolbarStatus,
      });
      let hydratedPreview = null;
      if (preserveContent && preview.hydrate) hydratedPreview = await preview.hydrate;
      if (state.modal !== modal || modal.loadGeneration !== generation) return false;
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
        if (state.modal !== modal || modal.loadGeneration !== generation) return false;
      }
      updatePreviewHeaderMeta(modal, {
        ...preview.headerMeta,
        replyCount: hydratedPreview?.records?.length ?? preview.headerMeta?.replyCount,
      });
      if (preserveContent) stabilizePreviewScroll(modal, scrollSnapshot, generation);
    } catch (error) {
      if (state.modal === modal && modal.loadGeneration === generation) {
        if (preserveContent) showPreviewRefreshError(modal, error);
        else showPreviewLoadError(modal, error);
      }
    } finally {
      if (modal.requestController === requestController) modal.requestController = null;
      modal.loading = false;
      refresh?.classList.remove('xns-action-pending');
      refresh?.removeAttribute('aria-busy');
    }
    return true;
  }

  function refreshPreviewModal() {
    const modal = state.modal;
    if (!modal || modal.loading) return;
    void loadPreviewModal(modal, '正在刷新帖子…', { preserveContent: true });
  }

  function openPreviewModal(url, fallbackLink) {
    closeModal();
    const fetchUrl = url.search || url.hash ? new URL(url.pathname, url.origin) : url;
    const overlay = createElement('div', 'xns-overlay');
    overlay.tabIndex = -1;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(); });
    const dialog = createElement('section', 'xns-modal');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const header = createElement('header', 'xns-modal-header');
    const heading = createElement('div', 'xns-modal-heading');
    heading.appendChild(createElement('span', 'xns-modal-eyebrow', 'NodeSeek 主题预览'));
    const title = createElement('h2', 'xns-modal-title', '正在加载帖子…');
    const headerMeta = createPreviewHeaderMeta();
    heading.append(title, headerMeta.root);
    const actions = createElement('div', 'xns-modal-actions');
    const replyPost = createElement('button', 'xns-modal-reply', '回复帖子');
    replyPost.type = 'button';
    replyPost.title = '回复帖子';
    replyPost.addEventListener('click', () => openPreviewComposer('post-reply', null));
    const original = createElement('a', 'xns-modal-original', '打开原帖');
    original.href = url.href;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    original.title = '在新标签打开原帖';
    const helpPanel = createPreviewHelpPanel();
    const moreMenu = createMoreMenu({
      onHelp: () => {
        const modal = state.modal;
        if (!modal) return;
        helpPanel.hidden = !helpPanel.hidden;
        if (!helpPanel.hidden) helpPanel.scrollIntoView?.({ block: 'nearest' });
      },
      onCopyLink: ({ setLabel }) => {
        void copyPreviewLink(url, setLabel).catch(() => setLabel('复制失败'));
      },
    });
    const close = createCloseButton(closeModal);
    actions.append(replyPost, original, moreMenu.element, close);
    header.append(heading, actions);
    const toolbar = createElement('div', 'xns-modal-toolbar');
    toolbar.setAttribute('role', 'toolbar');
    toolbar.setAttribute('aria-label', '预览工具');
    const toolbarStatus = createElement('span', 'xns-modal-toolbar-status xns-preview-status', '准备读取…');
    toolbar.append(
      createElement('span', 'xns-modal-toolbar-label', '阅读'),
      createElement('span', 'xns-modal-mode', '楼中楼'),
      toolbarStatus,
      createRefreshButton(() => { void refreshPreviewModal(); }),
    );
    const body = createElement('div', 'xns-modal-body');
    body.appendChild(createElement('p', 'xns-loading', '正在读取帖子内容…'));
    dialog.append(header, toolbar, helpPanel, body);
    const scrollCleanup = installPreviewScrollButtons(dialog, body);
    overlay.appendChild(dialog);
    documentObj.body.appendChild(overlay);
    documentObj.documentElement.style.overflow = 'hidden';
    state.modal = { overlay, dialog, body, title, url: fetchUrl, fallbackLink, postId: getPostInfo(fetchUrl.href)?.postId || '', composer: null, scrollCleanup, featureCleanup: null, moreMenu, helpPanel, headerMeta: headerMeta.items, loading: false, loadGeneration: 0, requestController: null, toolbarStatus };
    overlay.focus();
    void loadPreviewModal(state.modal, '正在读取帖子内容…');
  }

  return Object.freeze({ buildPreviewContent, loadPreviewModal, refreshPreviewModal, openPreviewModal });
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
  createMoreMenu,
  openPreviewComposer: (...args) => openPreviewComposer(...args),
});
const buildPreviewContent = (...args) => xnsPreviewController.buildPreviewContent(...args);
const loadPreviewModal = (...args) => xnsPreviewController.loadPreviewModal(...args);
const refreshPreviewModal = (...args) => xnsPreviewController.refreshPreviewModal(...args);
const openPreviewModal = (...args) => xnsPreviewController.openPreviewModal(...args);
