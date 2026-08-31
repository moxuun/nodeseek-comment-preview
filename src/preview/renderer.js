// 预览内容渲染服务。
// 这里仅负责把已加载的帖子记录转换成官方风格的楼层节点；网络读取由 page-loader 负责。
function createPreviewRenderer({
  document,
  windowObj,
  pageInfo,
  selectors,
  maxPage,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  getDocState,
  getCommentId,
  getSsrCommentCounts,
  safeCount,
  sanitizeImportedNode,
  materializeCommentNode,
  getDirectCommentMenu,
  ensurePreviewMenu,
  stripRenderArtifacts,
  buildReplyTree,
  flattenReplyTree,
  createCommentVirtualizer,
  addRemoteNote,
  formatPageStatus,
}) {
  function ensurePreviewEditOption(node, record) {
    if (!node || !record?.isMine) return;
    const menu = getDirectCommentMenu(node);
    if (!menu) return;
    let item = qsa(menu, ':scope > .menu-item').find((el) => (el.textContent || '').trim() === '编辑' && !el.dataset?.xnsAction);
    // 帖子详情页已有 NodeSeek/Vue 原生编辑项时直接保留。它带有官方事件
    // 处理器，由官方在楼层下方展开编辑器；脚本不能覆盖成打开新标签。
    // 如果原生项没有渲染出来，仍要先补回可见入口；后面不接管当前页的点击，
    // 避免把“修复显示”又回归成跳转行为。
    if (record.current && item) {
      item.setAttribute('aria-label', '编辑');
      return;
    }
    if (!item) {
      item = createElement('span', 'menu-item');
      item.setAttribute('role', 'button');
      item.tabIndex = 0;
      item.innerHTML = '<svg class="iconpark-icon" aria-hidden="true"><use href="#edit"></use></svg><span>编辑</span>';
      menu.appendChild(item);
    }
    item.setAttribute('aria-label', '编辑');
    if (record.current) return;
    if (item.dataset.xnsEditBound === 'true') return;
    item.dataset.xnsEditBound = 'true';
    item.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const postId = record.postId || pageInfo?.postId || getPostInfo(windowObj.location.href)?.postId || '';
      const floor = record.floor;
      const url = `/post-${postId}-${record.page || 1}${floor >= 0 ? `#${floor}` : ''}`;
      windowObj.open(url, '_blank', 'noopener');
    });
  }

  function prepareCommentRecord(record, depth) {
    const node = materializeCommentNode(record);
    if (!node) return null;
    stripRenderArtifacts(record.node);
    node.setAttribute('data-xns-floor', String(record.floor));
    if (!record.current) {
      node.setAttribute('data-xns-remote', 'true');
      node.setAttribute('data-xns-source-page', String(record.page));
    }
    node.setAttribute('data-xns-depth', String(depth));
    node.style.setProperty('--xns-indent', `${Math.min(8, Math.max(0, depth)) * 18}px`);
    node.classList.add(depth === 0 ? 'xns-comment-root' : 'xns-comment-child');
    if (depth > 0 && record.parent) node.setAttribute('data-xns-parent-floor', String(record.parent.floor));
    ensurePreviewMenu(node, { includeFavorite: false, counts: record.counts || undefined });
    ensurePreviewEditOption(node, record);
    return node;
  }

  function appendNestedRecord(record, container, depth) {
    const node = prepareCommentRecord(record, depth);
    if (!node) return;
    container.appendChild(node);
    if (!record.children.length) return;
    const replyList = createElement('ul', 'xns-reply-list');
    record.children.forEach((child) => appendNestedRecord(child, replyList, depth + 1));
    node.appendChild(replyList);
  }

  function buildPreviewPostNode(parsed, info) {
    const postRoot = qs(parsed, '.nsk-post');
    const source = postRoot?.matches?.('.content-item')
      ? postRoot
      : qs(postRoot, ':scope > .content-item, .content-item') || postRoot || qs(parsed, selectors.postContent);
    let node = sanitizeImportedNode(source, { keepCommentMenu: true });
    if (!node) return null;
    if (node.matches?.('article.post-content')) {
      const wrapper = createElement('div', 'content-item');
      wrapper.appendChild(node);
      node = wrapper;
    }
    node.classList.add('content-item', 'xns-preview-post', 'xns-comment-root');
    node.setAttribute('data-xns-floor', '0');
    node.setAttribute('data-xns-target-type', 'post');
    node.setAttribute('data-xns-post-id', info.postId);
    const postState = getDocState(parsed);
    const postCommentId = getCommentId(node);
    const counts = postCommentId !== null && postState ? getSsrCommentCounts(postState, postCommentId) : null;
    if (counts) {
      const collectionCount = safeCount(postState?.postData?.collectionCount);
      if (collectionCount !== null) counts.favorite = collectionCount;
      if (postState?.postData?.collected) counts.collected = true;
    }
    ensurePreviewMenu(node, { includeFavorite: true, counts });
    return node;
  }

  function renderPreviewStatus(section, options = {}) {
    const status = formatPageStatus(options);
    const statusNode = options.statusNode || qs(section, ':scope > .xns-preview-status') || createElement('div', 'xns-preview-status');
    if (!statusNode.parentNode) section.insertBefore(statusNode, qs(section, ':scope > .xns-preview-thread'));
    clearElement(statusNode);
    statusNode.className = options.statusNode ? 'xns-modal-toolbar-status xns-preview-status' : 'xns-preview-status';
    statusNode.removeAttribute('title');
    statusNode.setAttribute('role', 'status');
    statusNode.setAttribute('aria-live', 'polite');
    if (options.loading) {
      statusNode.classList.add('is-loading');
      statusNode.appendChild(createElement('span', 'xns-page-loading', status.stage));
    } else if (status.stage) {
      statusNode.appendChild(createElement('span', 'xns-page-complete', status.stage));
    }
    if (status.failed) {
      statusNode.classList.add('is-failed');
      statusNode.appendChild(createElement('span', 'xns-page-failed', status.failed));
      if (typeof options.onRetry === 'function') {
        const retry = createElement('button', 'xns-inline-retry', '重试');
        retry.type = 'button';
        retry.title = '重新读取失败分页';
        retry.setAttribute('aria-label', '重新读取失败分页');
        retry.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          options.onRetry();
        });
        statusNode.appendChild(retry);
      }
    }
    if (status.challenge) {
      statusNode.classList.add('is-failed');
      statusNode.appendChild(createElement('span', 'xns-page-challenge', status.challenge));
    }
    if (status.truncated) {
      statusNode.classList.add('is-truncated');
      statusNode.appendChild(createElement('span', 'xns-page-truncated', status.truncated));
    }
    statusNode.hidden = !statusNode.childNodes.length;
    return statusNode;
  }

  function renderPreviewRecords(section, info, records, options = {}) {
    const heading = qs(section, ':scope > h3');
    const thread = qs(section, ':scope > .xns-preview-thread');
    if (!heading || !thread) return;
    heading.textContent = `${records.length} 条回复`;
    qs(section, ':scope > .xns-preview-empty')?.remove();
    if (records.length) {
      const onNodeMounted = (node, entry) => {
        const record = entry.record;
        if (record.page !== info.page) addRemoteNote(record, info.postId);
        options.onNodeMounted?.(node, record);
      };
      const onNodeUnmounted = (node, entry) => {
        if (!entry.record.current) entry.record.node = null;
        options.onNodeUnmounted?.(node, entry.record);
      };
      const renderItem = (entry) => prepareCommentRecord(entry.record, entry.depth);
      const virtualizer = section.__xnsVirtualizer || createCommentVirtualizer({
        windowObj,
        documentObj: document,
        createElement,
        estimatedHeight: 135,
        overscanScreens: 2,
      }).mount(thread, {
        getViewport: () => thread.closest('.xns-modal-body') || windowObj,
        renderItem,
        onMount: onNodeMounted,
        onUnmount: onNodeUnmounted,
      });
      section.__xnsVirtualizer = virtualizer;
      virtualizer.setEntries(flattenReplyTree(records), {
        getViewport: () => thread.closest('.xns-modal-body') || windowObj,
        renderItem,
        onMount: onNodeMounted,
        onUnmount: onNodeUnmounted,
      });
    } else {
      section.__xnsVirtualizer?.destroy();
      delete section.__xnsVirtualizer;
      clearElement(thread);
      section.appendChild(createElement('p', 'xns-status xns-preview-empty', '没有读取到评论。'));
    }
    renderPreviewStatus(section, options);
  }

  return Object.freeze({
    ensurePreviewEditOption,
    prepareCommentRecord,
    appendNestedRecord,
    buildPreviewPostNode,
    renderPreviewStatus,
    renderPreviewRecords,
  });
}

const xnsPreviewRenderer = createPreviewRenderer({
  document,
  windowObj: window,
  pageInfo,
  selectors: SELECTORS,
  maxPage: MAX_PAGE,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  getDocState,
  getCommentId,
  getSsrCommentCounts,
  safeCount,
  sanitizeImportedNode,
  materializeCommentNode,
  getDirectCommentMenu,
  ensurePreviewMenu,
  stripRenderArtifacts,
  buildReplyTree,
  flattenReplyTree,
  createCommentVirtualizer,
  addRemoteNote,
  formatPageStatus,
});

const ensurePreviewEditOption = (...args) => xnsPreviewRenderer.ensurePreviewEditOption(...args);
const prepareCommentRecord = (...args) => xnsPreviewRenderer.prepareCommentRecord(...args);
const appendNestedRecord = (...args) => xnsPreviewRenderer.appendNestedRecord(...args);
const buildPreviewPostNode = (...args) => xnsPreviewRenderer.buildPreviewPostNode(...args);
const renderPreviewStatus = (...args) => xnsPreviewRenderer.renderPreviewStatus(...args);
const renderPreviewRecords = (...args) => xnsPreviewRenderer.renderPreviewRecords(...args);
