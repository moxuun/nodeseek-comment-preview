// 评论动作功能：菜单、点赞/鸡腿/反对/收藏，以及预览中的回复/引用编辑器。
function createCommentActions({
  windowObj,
  documentObj,
  state,
  pageInfo,
  qs,
  qsa,
  createElement,
  getPostInfo,
  parseSameOriginUrl,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  findCommentList,
  postAction,
  loadPreviewModal,
}) {
  const PREVIEW_ACTIONS = [
    ['like', '点赞', '♡', true],
    ['chicken', '加鸡腿', '🍗', true],
    ['dislike', '反对', '♧', true],
    ['favorite', '收藏', '☆', true],
    ['quote', '引用', '❝', false],
    ['reply', '回复', '↩', false],
  ];

  function getDirectCommentMenu(comment) {
    return Array.from(comment?.children || []).find((child) => child.matches?.('.comment-menu, .comment-actions')) || null;
  }

  function getMenuActionKey(menuItem) {
    const values = [
      menuItem?.dataset?.action,
      menuItem?.dataset?.type,
      menuItem?.getAttribute?.('title'),
      menuItem?.getAttribute?.('aria-label'),
      menuItem?.textContent,
    ].filter(Boolean).join(' ').toLowerCase();
    if (/\b(like|upvote)\b|点赞/.test(values)) return 'like';
    if (/\b(chicken|freelike)\b|鸡腿|投喂/.test(values)) return 'chicken';
    if (/\b(dislike|downvote)\b|反对|踩/.test(values)) return 'dislike';
    if (/\b(favorite|favourite|collection)\b|收藏/.test(values)) return 'favorite';
    if (/\bquote\b|引用/.test(values)) return 'quote';
    if (/\breply\b|回复/.test(values)) return 'reply';
    return '';
  }

  function createPreviewMenuItem([key, label, icon, withCount]) {
    const item = createElement('span', 'menu-item');
    item.dataset.xnsAction = key;
    item.title = label;
    item.setAttribute('role', 'button');
    item.tabIndex = 0;
    const iconNode = createElement('span', 'xns-action-icon', icon);
    iconNode.setAttribute('aria-hidden', 'true');
    item.appendChild(iconNode);
    if (withCount) item.appendChild(createElement('span', 'xns-action-count', '0'));
    item.appendChild(createElement('span', 'xns-action-label', label));
    return item;
  }

  function createPreviewMenu(includeFavorite = true) {
    const menu = createElement('div', 'comment-menu xns-preview-menu');
    PREVIEW_ACTIONS
      .filter(([key]) => includeFavorite || key !== 'favorite')
      .forEach((action) => menu.appendChild(createPreviewMenuItem(action)));
    return menu;
  }

  function getMenuCountElement(menuItem) {
    return qsa(menuItem, ':scope > span').find((node) => /^\d+$/.test((node.textContent || '').trim())) || null;
  }

  function ensurePreviewMenu(comment, options = {}) {
    const includeFavorite = options.includeFavorite !== false;
    let menu = getDirectCommentMenu(comment);
    if (!menu) {
      menu = createPreviewMenu(includeFavorite);
      comment.appendChild(menu);
    } else {
      menu.classList.add('comment-menu', 'xns-preview-menu');
      if (!includeFavorite) qsa(menu, ':scope > .menu-item').filter((item) => getMenuActionKey(item) === 'favorite').forEach((item) => item.remove());
      const existingActions = new Set(qsa(menu, ':scope > .menu-item').map(getMenuActionKey).filter(Boolean));
      PREVIEW_ACTIONS
        .filter(([key]) => includeFavorite || key !== 'favorite')
        .filter(([key]) => !existingActions.has(key))
        .forEach((action) => menu.appendChild(createPreviewMenuItem(action)));
    }
    qsa(menu, ':scope > .menu-item').forEach((item) => {
      const action = getMenuActionKey(item);
      if (action) {
        item.dataset.xnsAction = action;
        if (action === 'favorite' && /已收藏|取消收藏/.test(`${item.title} ${item.textContent}`)) item.dataset.xnsFavoriteState = 'added';
      }
      if (!item.hasAttribute('role')) item.setAttribute('role', 'button');
      if (!item.hasAttribute('tabindex')) item.tabIndex = 0;
    });
    const counts = options.counts || null;
    if (counts) {
      qsa(menu, ':scope > .menu-item').forEach((item) => {
        const action = getMenuActionKey(item);
        const value = counts[action];
        const countNode = qs(item, ':scope > .xns-action-count') || getMenuCountElement(item);
        if (countNode && Number.isFinite(value) && value >= 0) countNode.textContent = String(value);
        if (action === 'favorite' && counts.collected && item.dataset.xnsFavoriteState !== 'removed') item.dataset.xnsFavoriteState = 'added';
      });
    }
    return menu;
  }

  function getDisplayFloor(comment) {
    const raw = comment?.getAttribute('data-xns-floor') || comment?.getAttribute('id') || '';
    if (raw === '0') return 0;
    return getFloor(comment);
  }

  function getActionTargetId(comment) {
    const commentId = getCommentId(comment);
    if (commentId !== null) return commentId;
    if (comment?.getAttribute('data-xns-target-type') === 'post') {
      return safePositiveInt(comment.getAttribute('data-xns-post-id') || '') || safePositiveInt(state.modal?.postId || '');
    }
    return null;
  }

  function getPageActionContext() {
    const info = pageInfo || getPostInfo(windowObj.location.href);
    return { modal: null, postId: info?.postId || '', url: parseSameOriginUrl(windowObj.location.href) };
  }

  function getActionContext(menuItem) {
    const modal = menuItem?.closest?.('.xns-overlay') ? state.modal : null;
    if (modal) return { modal, postId: modal.postId, url: modal.url };
    return getPageActionContext();
  }

  function setActionState(menuItem, text, failed = false) {
    menuItem.classList.toggle('xns-action-failed', failed);
    let stateNode = qs(menuItem, ':scope > .xns-action-state');
    if (!stateNode) {
      stateNode = createElement('span', 'xns-action-state');
      menuItem.appendChild(stateNode);
    }
    stateNode.textContent = text;
  }

  function bumpMenuCount(menuItem, delta) {
    const count = getMenuCountElement(menuItem);
    if (!count) return;
    const value = Number(count.textContent || 0);
    count.textContent = String(Math.max(0, value + delta));
  }

  function getPreviewCommentText(comment) {
    const content = getPostContent(comment);
    if (!content) return '';
    const copy = content.cloneNode(true);
    qsa(copy, '.xns-remote-floor-link, .floor-link-wrapper').forEach((node) => node.remove());
    return (copy.innerText || copy.textContent || '').trim().slice(0, 12_000);
  }

  function getPreviewSourceUrl(comment, context = null) {
    const contextUrl = context?.url?.href || state.modal?.url?.href || windowObj.location.href;
    if (!comment) return contextUrl;
    const contextInfo = getPostInfo(contextUrl);
    const modalInfo = context?.postId
      ? { postId: String(context.postId), page: contextInfo?.page || 1 }
      : (contextInfo || (state.modal?.postId ? { postId: state.modal.postId, page: 1 } : null));
    if (!modalInfo) return contextUrl;
    const page = safePositiveInt(comment?.getAttribute('data-xns-source-page')) || modalInfo.page;
    const floor = getDisplayFloor(comment);
    const url = new URL(`/post-${modalInfo.postId}-${page}`, windowObj.location.origin);
    if (floor !== null) url.hash = String(floor);
    return url.href;
  }

  function getDirectComposer(comment) {
    return Array.from(comment?.children || []).find((child) => child.matches?.(':scope.xns-preview-composer')) || null;
  }

  function openPreviewComposer(action, comment, context = null) {
    const modal = context?.modal || state.modal;
    const actionContext = context || {
      modal,
      postId: modal?.postId || pageInfo?.postId || '',
      url: modal?.url || parseSameOriginUrl(windowObj.location.href),
    };
    const host = modal?.body || (comment ? comment : findCommentList());
    if (!host) return;
    const isPostReply = !comment || action === 'post-reply';
    const previousComposer = isPostReply ? (modal?.composer || state.post?.composer) : getDirectComposer(comment);
    previousComposer?.remove();
    const floor = isPostReply ? null : getDisplayFloor(comment);
    const author = isPostReply ? '' : getAuthorName(comment);
    const isReply = action === 'reply' && !isPostReply;
    const composer = createElement('section', 'xns-preview-composer');
    const floorLabel = floor === null ? '' : floor;
    const composerTitle = isPostReply ? '回复帖子' : `${isReply ? '回复' : '引用'} #${floorLabel} · ${author}`;
    composer.appendChild(createElement('h3', 'xns-preview-composer-title', composerTitle));
    const textarea = documentObj.createElement('textarea');
    textarea.setAttribute('aria-label', isPostReply || isReply ? '回复内容' : '引用内容');
    const sourceUrl = isPostReply ? (actionContext.url?.href || windowObj.location.href) : getPreviewSourceUrl(comment, actionContext);
    if (isPostReply) {
      textarea.placeholder = '输入对帖子的回复内容…';
      textarea.value = '';
    } else {
      const replyToken = `@${author} [#${floorLabel}](${sourceUrl})`;
      const quoted = getPreviewCommentText(comment).split(/\r?\n/).slice(0, 80).map((line) => `> ${line}`).join('\n');
      textarea.value = isReply ? `${replyToken} ` : `> ${replyToken}\n${quoted}\n\n`;
    }
    composer.appendChild(textarea);
    const actions = createElement('div', 'xns-preview-composer-actions');
    const submit = createElement('button', '', '发送回复');
    submit.type = 'button';
    const original = createElement('a', '', '打开原帖回复');
    original.href = getPreviewSourceUrl(comment, actionContext);
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const cancel = createElement('button', '', '取消');
    cancel.type = 'button';
    const status = createElement('span', 'xns-preview-composer-status');
    actions.append(submit, original, cancel, status);
    composer.appendChild(actions);
    if (isPostReply && modal?.body) {
      modal.body.appendChild(composer);
      modal.composer = composer;
    } else {
      const menu = qs(comment, '.xns-preview-menu');
      if (menu) menu.insertAdjacentElement('afterend', composer);
      else host.appendChild(composer);
      if (isPostReply && state.post) state.post.composer = composer;
    }
    textarea.focus();
    composer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    cancel.addEventListener('click', () => {
      composer.remove();
      if (modal?.composer === composer) modal.composer = null;
      if (!modal && state.post?.composer === composer) state.post.composer = null;
    });
    submit.addEventListener('click', async () => {
      const content = textarea.value.trim();
      if (!content) {
        status.textContent = '请输入内容。';
        textarea.focus();
        return;
      }
      submit.disabled = true;
      status.textContent = '正在发送…';
      try {
        await postAction('/api/content/new-comment', { content, mode: 'new-comment', postId: Number(actionContext.postId) }, { context: actionContext });
        status.textContent = '回复已发送，正在更新楼中楼…';
        textarea.readOnly = true;
        submit.remove();
        if (actionContext.modal && state.modal === actionContext.modal) {
          if (actionContext.modal.composer === composer) actionContext.modal.composer = null;
          const refreshed = await loadPreviewModal(actionContext.modal, '正在更新回复…', { preserveContent: true });
          if (refreshed) composer.remove();
          else status.textContent = '回复已发送。帖子正在刷新中，楼中楼可能暂未包含新回复，请稍后再点刷新。';
        } else if (state.post) {
          const post = state.post;
          if (post.composer === composer) post.composer = null;
          composer.remove();
          await post.reloadPages({ refreshCurrentPage: true });
        }
      } catch (error) {
        status.textContent = `发送失败：${error.message || '网络错误'}`;
        submit.disabled = false;
      }
    });
  }

  async function runPreviewAction(action, menuItem, comment, context = null) {
    const actionContext = context || getActionContext(menuItem);
    if (action === 'quote' || action === 'reply') {
      openPreviewComposer(action, comment, actionContext);
      return;
    }
    const postId = safePositiveInt(actionContext?.postId || '');
    const targetId = getActionTargetId(comment);
    if ((action !== 'favorite' && targetId === null) || (action === 'favorite' && postId === null)) {
      setActionState(menuItem, action === 'favorite' ? '缺少帖子ID' : '缺少目标ID', true);
      return;
    }
    if (action !== 'favorite' && menuItem.dataset.xnsActionDone === 'true') {
      setActionState(menuItem, '已操作');
      return;
    }
    if (menuItem.classList.contains('xns-action-pending')) return;
    if (action === 'chicken' && !windowObj.confirm('确认给这条评论加鸡腿？NodeSeek 可能会消耗鸡腿。')) return;
    if (action === 'dislike' && !windowObj.confirm('确认反对这条评论？NodeSeek 可能会消耗两个鸡腿。')) return;
    const isFavoriteRemoval = action === 'favorite' && menuItem.dataset.xnsFavoriteState === 'added';
    menuItem.classList.add('xns-action-pending');
    menuItem.classList.remove('xns-action-failed');
    setActionState(menuItem, '处理中…');
    try {
      if (action === 'like') await postAction('/api/statistics/upvote', { commentId: targetId, action: 'add' }, { context: actionContext });
      else if (action === 'chicken') await postAction('/api/statistics/like', { commentId: targetId, action: 'add' }, { context: actionContext });
      else if (action === 'dislike') await postAction('/api/statistics/dislike', { commentId: targetId, action: 'add' }, { context: actionContext });
      else if (action === 'favorite') await postAction('/api/statistics/collection', { action: isFavoriteRemoval ? 'del' : 'add', postId }, { context: actionContext });
      if (action === 'favorite') {
        menuItem.dataset.xnsFavoriteState = isFavoriteRemoval ? 'removed' : 'added';
        bumpMenuCount(menuItem, isFavoriteRemoval ? -1 : 1);
      } else {
        menuItem.dataset.xnsActionDone = 'true';
        bumpMenuCount(menuItem, 1);
      }
      setActionState(menuItem, '✓');
      windowObj.setTimeout(() => {
        if (menuItem.isConnected && !menuItem.classList.contains('xns-action-failed')) qs(menuItem, ':scope > .xns-action-state')?.remove();
      }, 1_800);
    } catch (error) {
      setActionState(menuItem, `失败：${error.message || '操作未完成'}`, true);
    } finally {
      menuItem.classList.remove('xns-action-pending');
    }
  }

  return Object.freeze({
    getDirectCommentMenu,
    getMenuActionKey,
    ensurePreviewMenu,
    getActionContext,
    openPreviewComposer,
    runPreviewAction,
  });
}

const xnsCommentActions = createCommentActions({
  windowObj: window,
  documentObj: document,
  state,
  pageInfo,
  qs,
  qsa,
  createElement,
  getPostInfo,
  parseSameOriginUrl,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  findCommentList,
  postAction,
  loadPreviewModal: (...args) => loadPreviewModal(...args),
});
const getDirectCommentMenu = (...args) => xnsCommentActions.getDirectCommentMenu(...args);
const getMenuActionKey = (...args) => xnsCommentActions.getMenuActionKey(...args);
const ensurePreviewMenu = (...args) => xnsCommentActions.ensurePreviewMenu(...args);
const getActionContext = (...args) => xnsCommentActions.getActionContext(...args);
const openPreviewComposer = (...args) => xnsCommentActions.openPreviewComposer(...args);
const runPreviewAction = (...args) => xnsCommentActions.runPreviewAction(...args);
