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
  openPreviewComposer,
}) {
  function buildPreviewContent(url, parsed, options = {}) {
    const wrapper = createElement('div', 'xns-preview-content');
    const title = qs(parsed, selectors.postTitle)?.textContent?.trim() || '';
    const info = getPostInfo(url.href);
    const importedPost = info ? buildPreviewPostNode(parsed, info) : null;
    if (importedPost) wrapper.appendChild(importedPost);
    else {
      const content = qs(parsed, selectors.postContent);
      const importedContent = sanitizeImportedNode(content);
      if (importedContent) wrapper.appendChild(importedContent);
      else wrapper.appendChild(createElement('p', 'xns-status', '没有找到帖子正文。'));
    }
    if (!info) return { title, content: wrapper, hydrate: null };
    const currentRecords = collectPageRecords(info, parsed, info.page);
    const knownPages = getPageNumbers(parsed, info.postId);
    const hasRemotePages = Array.from(knownPages).some((page) => page !== info.page);
    const section = createElement('section', 'xns-preview-comments');
    section.appendChild(createElement('h3', '', '楼中楼预览'));
    const thread = createElement('ul', 'xns-preview-thread');
    section.appendChild(thread);
    renderPreviewRecords(section, info, currentRecords, { loading: hasRemotePages });
    wrapper.appendChild(section);
    const hydrate = loadPreviewRecords(info, parsed, {
      noStore: options.noStore === true,
      allowCache: options.allowCache === true,
      initialRecords: currentRecords,
      signal: options.signal,
    }).then((preview) => {
      if (section.isConnected || options.renderDetached === true) renderPreviewRecords(section, info, preview.records, preview);
      return preview;
    });
    return { title, content: wrapper, hydrate };
  }

  function schedulePreviewFeatures(modal) {
    modal.featureCleanup?.();
    modal.featureCleanup = null;
    const body = modal.body;
    const localRoots = [
      qs(body, '.xns-preview-post'),
      ...qsa(body, '.xns-preview-thread .content-item:not([data-xns-remote])'),
    ].filter(Boolean);
    localRoots.forEach((root) => installPreviewFeatures(root));
    const remoteItems = qsa(body, '.xns-preview-thread .content-item[data-xns-remote]');
    if (!remoteItems.length) return;
    if (typeof windowObj.IntersectionObserver !== 'function') {
      installPreviewFeatures(body);
      return;
    }
    const pending = new Set(remoteItems);
    let observer = null;
    const cleanup = () => {
      observer?.disconnect();
      if (modal.featureCleanup === cleanup) modal.featureCleanup = null;
    };
    observer = new windowObj.IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting || !pending.has(entry.target)) return;
        pending.delete(entry.target);
        observer.unobserve(entry.target);
        installPreviewFeatures(entry.target);
      });
      if (!pending.size) cleanup();
    }, { root: body, rootMargin: '0px' });
    remoteItems.forEach((item) => observer.observe(item));
    modal.featureCleanup = cleanup;
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
    qs(modal.body, '.xns-refresh-status')?.remove();
    const status = createElement('p', 'xns-status xns-refresh-status', `刷新失败，保留当前内容：${error?.message || '网络错误'}`);
    status.classList.add('xns-refresh-failed');
    modal.body.prepend(status);
    windowObj.setTimeout(() => { if (status.isConnected) status.remove(); }, 4_000);
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
    refresh?.classList.add('xns-action-pending');
    refresh?.setAttribute('aria-busy', 'true');
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
      });
      if (preserveContent && preview.hydrate) await preview.hydrate;
      if (state.modal !== modal || modal.loadGeneration !== generation) return false;
      const scrollSnapshot = preserveContent ? capturePreviewScroll(modal.body) : null;
      modal.title.textContent = preview.title || 'NodeSeek 帖子预览';
      clearElement(modal.body);
      modal.body.appendChild(preview.content);
      if (modal.composer && !modal.composer.isConnected) modal.body.appendChild(modal.composer);
      schedulePreviewFeatures(modal);
      if (!preserveContent && preview.hydrate) {
        await preview.hydrate;
        if (state.modal !== modal || modal.loadGeneration !== generation) return false;
        schedulePreviewFeatures(modal);
      }
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
    const title = createElement('h2', 'xns-modal-title', '正在加载帖子…');
    const replyPost = createElement('button', 'xns-modal-reply', '回复帖子');
    replyPost.type = 'button';
    replyPost.addEventListener('click', () => openPreviewComposer('post-reply', null));
    const original = createElement('a', '', '新标签打开');
    original.href = url.href;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const close = createCloseButton(closeModal);
    header.append(title, replyPost, original, close);
    const body = createElement('div', 'xns-modal-body');
    body.appendChild(createElement('p', 'xns-loading', '正在读取帖子内容…'));
    dialog.append(header, body);
    const scrollCleanup = installPreviewScrollButtons(dialog, body);
    overlay.appendChild(dialog);
    documentObj.body.appendChild(overlay);
    documentObj.documentElement.style.overflow = 'hidden';
    state.modal = { overlay, dialog, body, title, url: fetchUrl, fallbackLink, postId: getPostInfo(fetchUrl.href)?.postId || '', composer: null, scrollCleanup, featureCleanup: null, loading: false, loadGeneration: 0, requestController: null };
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
  openPreviewComposer: (...args) => openPreviewComposer(...args),
});
const buildPreviewContent = (...args) => xnsPreviewController.buildPreviewContent(...args);
const loadPreviewModal = (...args) => xnsPreviewController.loadPreviewModal(...args);
const refreshPreviewModal = (...args) => xnsPreviewController.refreshPreviewModal(...args);
const openPreviewModal = (...args) => xnsPreviewController.openPreviewModal(...args);
