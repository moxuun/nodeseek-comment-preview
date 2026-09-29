import { state } from '../core/config.js';
import { createElement, findCommentList, getAuthorName, getCommentId, getFloor, getPostContent, qs, qsa, safeCount, safePositiveInt } from '../core/dom.js';
import { pageInfo } from '../core/runtime.js';
import { postAction } from '../nodeseek/action-api.js';
import { buildPostUrl, getPostInfo, parseSameOriginUrl } from '../nodeseek/url.js';
import type { CommentRecord, SsrCommentCounts } from '../nodeseek/content-parser.js';

/** 评论菜单动作键；引用和回复只负责打开编辑器，不记账。 */
type PreviewActionKey = 'like' | 'chicken' | 'dislike' | 'favorite' | 'quote' | 'reply';
/** 会写入互动记账的动作键。 */
type InteractionActionKey = 'like' | 'chicken' | 'dislike' | 'favorite';
/** 菜单项定义：动作、标签、图标、是否带计数。 */
type PreviewActionDefinition = readonly [PreviewActionKey, string, string, boolean];
/** 单条互动记账；`count` 在服务端没有返回计数时为 null。 */
interface InteractionEntry {
  done: boolean;
  count: number | null;
}
/** 记账更新补丁。 */
interface InteractionStatePatch {
  done?: boolean;
  count?: number | null;
}
/** state.modal 里 comment-actions 会用到的字段；完整句柄由 preview controller 写入。 */
interface ActionModalHandle {
  postId?: string | number | null;
  url?: URL | null;
  body?: HTMLElement | null;
  composer?: HTMLElement | null;
  composerHost?: HTMLElement | null;
  /** 弹窗自己提供的重渲染入口（楼层动作不再反向 import preview controller）。 */
  refresh?: () => void;
  /** 弹窗自己提供的回复同步入口。 */
  syncReply?: () => Promise<boolean>;
}
/** state.post 里 comment-actions 会用到的字段；完整句柄由 post-page controller 写入。 */
interface ActionPostHandle {
  composer?: HTMLElement | null;
  reloadPages?: (options: { refreshCurrentPage?: boolean }) => Promise<unknown>;
}
/** 动作上下文：弹窗内动作用弹窗身份，页面动作用页面身份。 */
interface PreviewActionContext {
  modal: ActionModalHandle | null;
  postId?: string | number | null;
  url?: URL | null;
}
/** 预览菜单选项。 */
interface PreviewMenuOptions {
  includeFavorite?: boolean;
  counts?: SsrCommentCounts | null;
}

/** comment-actions 的注入依赖；与模块导入一一对应，便于单独测试。 */
interface CommentActionsDeps {
  windowObj: Window & typeof globalThis;
  documentObj: Document;
  state: typeof state;
  pageInfo: typeof pageInfo;
  qs: typeof qs;
  qsa: typeof qsa;
  createElement: typeof createElement;
  getPostInfo: typeof getPostInfo;
  buildPostUrl: typeof buildPostUrl;
  parseSameOriginUrl: typeof parseSameOriginUrl;
  safeCount: typeof safeCount;
  safePositiveInt: typeof safePositiveInt;
  getFloor: typeof getFloor;
  getCommentId: typeof getCommentId;
  getAuthorName: typeof getAuthorName;
  getPostContent: typeof getPostContent;
  findCommentList: typeof findCommentList;
  postAction: typeof postAction;
}

/** `action` 是否属于会记账的互动动作。 */
function isInteractionAction(action: PreviewActionKey | ''): action is InteractionActionKey {
  return action === 'like' || action === 'chicken' || action === 'dislike' || action === 'favorite';
}

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
  buildPostUrl,
  parseSameOriginUrl,
  safeCount,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  findCommentList,
  postAction,
}: CommentActionsDeps) {
  const PREVIEW_ACTIONS: readonly PreviewActionDefinition[] = [
    ['like', '点赞', '♡', true],
    ['chicken', '加鸡腿', '🍗', true],
    ['dislike', '反对', '♧', true],
    ['favorite', '收藏', '☆', true],
    ['quote', '引用', '❝', false],
    ['reply', '回复', '↩', false],
  ];
  const MENU_ITEMS_SELECTOR = ':scope > .menu-item';
  // 互动结果不能只存在 DOM 上：虚拟列表会重建楼层节点，状态会随节点一起丢失。
  // 这里按评论/帖子维度记账，节点重建后重新套用到菜单上。
  const ACTION_FLAGS: Record<InteractionActionKey, 'liked' | 'chickened' | 'disliked' | 'collected'> = { like: 'liked', chicken: 'chickened', dislike: 'disliked', favorite: 'collected' };
  const ACTION_COUNTS: Record<InteractionActionKey, 'like' | 'chicken' | 'dislike' | 'favorite'> = { like: 'like', chicken: 'chicken', dislike: 'dislike', favorite: 'favorite' };
  const interactionStates = new Map<string, InteractionEntry>();

  function getInteractionKey(action: InteractionActionKey, comment?: Element | null): string | null {
    if (action === 'favorite') {
      const modal = state.modal as ActionModalHandle | null;
      const postId = safePositiveInt(comment?.getAttribute?.('data-xns-post-id') || '')
        || safePositiveInt(modal?.postId || '')
        || safePositiveInt(pageInfo?.postId || '');
      return postId === null ? null : `post:${postId}`;
    }
    const commentId = comment ? getCommentId(comment) : null;
    return commentId === null ? null : `comment:${commentId}:${action}`;
  }

  // 首次遇到某个目标时用 SSR 数据播种（官方就是用 SSR 里的 upvoted/liked/disliked/collected 高亮）；
  // 之后一律以操作结果为准，避免 SSR 的旧快照把已经操作过的状态盖回去。
  function getInteractionState(action: InteractionActionKey, comment?: Element | null, counts: SsrCommentCounts | null = null): InteractionEntry | null {
    const key = getInteractionKey(action, comment);
    if (!key) return null;
    let entry = interactionStates.get(key);
    if (!entry) {
      entry = {
        done: Boolean(counts?.[ACTION_FLAGS[action]]),
        count: safeCount(counts ? counts[ACTION_COUNTS[action]] : null),
      };
      interactionStates.set(key, entry);
    }
    return entry;
  }

  function updateInteractionState(action: InteractionActionKey, comment?: Element | null, patch: InteractionStatePatch = {}): InteractionEntry | null {
    const entry = getInteractionState(action, comment);
    if (!entry) return null;
    if (typeof patch.done === 'boolean') entry.done = patch.done;
    const nextCount = safeCount(patch.count);
    if (nextCount !== null) entry.count = nextCount;
    return entry;
  }

  function applyInteractionState(menuItem: Element, entry: InteractionEntry | null): void {
    menuItem.classList.toggle('xns-action-done', Boolean(entry?.done));
    const countNode = qs(menuItem, ':scope > .xns-action-count') || getMenuCountElement(menuItem);
    const count = entry && typeof entry.count === 'number' && Number.isFinite(entry.count) && entry.count >= 0 ? entry.count : null;
    if (countNode && count !== null) countNode.textContent = String(count);
  }

  function getDirectCommentMenu(comment?: Element | null): Element | null {
    return Array.from(comment?.children || []).find((child) => child.matches?.('.comment-menu, .comment-actions')) || null;
  }

  function getMenuActionKey(menuItem?: Element | null): PreviewActionKey | '' {
    const node = menuItem as HTMLElement | null | undefined;
    const values = [
      node?.dataset?.action,
      node?.dataset?.type,
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

  function createPreviewMenuItem([key, label, icon, withCount]: PreviewActionDefinition): HTMLElement {
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
    item.setAttribute('aria-label', label);
    return item;
  }

  function createPreviewMenu(includeFavorite = true): HTMLElement {
    const menu = createElement('div', 'comment-menu xns-preview-menu');
    PREVIEW_ACTIONS
      .filter(([key]) => includeFavorite || key !== 'favorite')
      .forEach((action) => menu.appendChild(createPreviewMenuItem(action)));
    return menu;
  }

  function getMenuCountElement(menuItem: Element): Element | null {
    return qsa(menuItem, ':scope > span').find((node) => /^\d+$/.test((node.textContent || '').trim())) || null;
  }

  function ensurePreviewMenu(comment: Element, options: PreviewMenuOptions = {}): Element | null {
    const includeFavorite = options.includeFavorite !== false;
    let menu = getDirectCommentMenu(comment);
    if (!menu) {
      menu = createPreviewMenu(includeFavorite);
      comment.appendChild(menu);
    }
    menu.classList.add('comment-menu', 'xns-preview-menu');
    let menuItems = qsa(menu, MENU_ITEMS_SELECTOR);
    if (!includeFavorite) {
      menuItems = menuItems.filter((item) => {
        if (getMenuActionKey(item) === 'favorite') {
          item.remove();
          return false;
        }
        return true;
      });
    }
    const existingActions = new Set(menuItems.map(getMenuActionKey).filter(Boolean));
    PREVIEW_ACTIONS
      .filter(([key]) => includeFavorite || key !== 'favorite')
      .filter(([key]) => !existingActions.has(key))
      .forEach((action) => {
        const item = createPreviewMenuItem(action);
        menu.appendChild(item);
        menuItems.push(item);
      });
    menuItems.forEach((item) => {
      const action = getMenuActionKey(item);
      if (action) {
        (item as HTMLElement).dataset.xnsAction = action;
        const actionMeta = PREVIEW_ACTIONS.find(([key]) => key === action);
        if (!item.hasAttribute('aria-label')) item.setAttribute('aria-label', actionMeta?.[1] || action);
      }
      if (!item.hasAttribute('role')) item.setAttribute('role', 'button');
      if (!item.hasAttribute('tabindex')) (item as HTMLElement).tabIndex = 0;
    });
    const counts = options.counts || null;
    menuItems.forEach((item) => {
      const action = getMenuActionKey(item);
      if (!action || !isInteractionAction(action)) return;
      applyInteractionState(item, getInteractionState(action, comment, counts));
    });
    return menu;
  }

  function getDisplayFloor(comment?: Element | null): number | null {
    const raw = comment?.getAttribute('data-xns-floor') || comment?.getAttribute('id') || '';
    if (raw === '0') return 0;
    return getFloor(comment);
  }

  function getActionTargetId(comment?: Element | null): number | null {
    const modal = state.modal as ActionModalHandle | null;
    const commentId = getCommentId(comment);
    if (commentId !== null) return commentId;
    if (comment?.getAttribute('data-xns-target-type') === 'post') {
      return safePositiveInt(comment.getAttribute('data-xns-post-id') || '') || safePositiveInt(modal?.postId || '');
    }
    return null;
  }

  function getPageActionContext(): PreviewActionContext {
    const info = pageInfo || getPostInfo(windowObj.location.href);
    return { modal: null, postId: info?.postId || '', url: parseSameOriginUrl(windowObj.location.href) };
  }

  function getActionContext(menuItem?: Element | null): PreviewActionContext {
    const modal = (menuItem?.closest?.('.xns-overlay') ? state.modal : null) as ActionModalHandle | null;
    if (modal) return { modal, postId: modal.postId, url: modal.url };
    return getPageActionContext();
  }

  function setActionState(menuItem: Element, text: string, failed = false): void {
    menuItem.classList.toggle('xns-action-failed', failed);
    let stateNode = qs(menuItem, ':scope > .xns-action-state');
    if (!stateNode) {
      stateNode = createElement('span', 'xns-action-state');
      menuItem.appendChild(stateNode);
    }
    stateNode.textContent = text;
  }

  function getPreviewCommentText(comment: Element | null): string {
    const content = getPostContent(comment);
    if (!content) return '';
    const copy = content.cloneNode(true) as HTMLElement;
    qsa(copy, '.xns-remote-floor-link, .floor-link-wrapper').forEach((node) => node.remove());
    return (copy.innerText || copy.textContent || '').trim().slice(0, 12_000);
  }

  function getPreviewSourceUrl(comment: Element | null, context: PreviewActionContext | null = null): string {
    const modal = state.modal as ActionModalHandle | null;
    const contextUrl = context?.url?.href || modal?.url?.href || windowObj.location.href;
    if (!comment) return contextUrl;
    const contextInfo = getPostInfo(contextUrl);
    const modalInfo = context?.postId
      ? { postId: String(context.postId), page: contextInfo?.page || 1 }
      : (contextInfo || (modal?.postId ? { postId: modal.postId, page: 1 } : null));
    if (!modalInfo) return contextUrl;
    const page = safePositiveInt(comment?.getAttribute('data-xns-source-page')) || modalInfo.page;
    const floor = getDisplayFloor(comment);
    return buildPostUrl(modalInfo.postId, page, floor)?.href || contextUrl;
  }

  function getDirectComposer(comment?: Element | null): Element | null {
    return Array.from(comment?.children || []).find((child) => child.matches?.(':scope.xns-preview-composer')) || null;
  }

  // 弹窗里的评论来自跨页读取，拿不到官方编辑器，所以就地展开一个编辑框，
  // 保存后走官方的 /api/content/edit-comment 并刷新弹窗内容。
  function openPreviewEditor(comment: Element | null, record: CommentRecord | null, context: PreviewActionContext | null = null): void {
    if (!comment || !record) return;
    const commentId = getCommentId(comment);
    if (commentId === null) return;
    const actionContext = context || {
      modal: state.modal as ActionModalHandle | null,
      postId: pageInfo?.postId || '',
      url: (state.modal as ActionModalHandle | null)?.url,
    };
    getDirectComposer(comment)?.remove();
    const composer = createElement('section', 'xns-preview-composer xns-preview-editor');
    composer.appendChild(createElement('h3', 'xns-preview-composer-title', `编辑 #${getDisplayFloor(comment)} · ${getAuthorName(comment)}`));
    const textarea = documentObj.createElement('textarea');
    textarea.setAttribute('aria-label', '编辑评论内容');
    textarea.value = typeof record.markdown === 'string' ? record.markdown : '';
    composer.appendChild(textarea);
    const actions = createElement('div', 'xns-preview-composer-actions');
    const submit = createElement('button', '', '保存修改') as HTMLButtonElement;
    submit.type = 'button';
    const cancel = createElement('button', '', '取消') as HTMLButtonElement;
    cancel.type = 'button';
    const status = createElement('span', 'xns-preview-composer-status');
    actions.append(submit, cancel, status);
    composer.appendChild(actions);
    const menu = qs(comment, ':scope > .xns-preview-menu') || getDirectCommentMenu(comment);
    if (menu) menu.insertAdjacentElement('afterend', composer);
    else comment.appendChild(composer);
    textarea.focus();
    composer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    cancel.addEventListener('click', () => composer.remove());
    submit.addEventListener('click', async () => {
      const content = textarea.value.trim();
      if (!content) {
        status.textContent = '请输入内容。';
        textarea.focus();
        return;
      }
      if (content === (record.markdown || '').trim()) {
        status.textContent = '内容没有变化。';
        return;
      }
      submit.disabled = true;
      status.textContent = '正在保存…';
      try {
        await postAction('/api/content/edit-comment', { content, commentId }, { context: actionContext });
        record.markdown = content;
        status.textContent = '已保存，正在刷新…';
        textarea.readOnly = true;
        submit.remove();
        if (actionContext.modal && state.modal === actionContext.modal) actionContext.modal.refresh?.();
        else composer.remove();
      } catch (error) {
        status.textContent = `保存失败：${(error as Error).message || '网络错误'}`;
        submit.disabled = false;
      }
    });
  }

  function openPreviewComposer(action: string, comment: Element | null, context: PreviewActionContext | null = null): void {
    const modal = (context?.modal || (state.modal as ActionModalHandle | null)) || null;
    const actionContext = context || {
      modal,
      postId: modal?.postId || pageInfo?.postId || '',
      url: modal?.url || parseSameOriginUrl(windowObj.location.href),
    };
    const isPostReply = !comment || action === 'post-reply';
    const host = isPostReply
      ? (modal?.composerHost || modal?.body || findCommentList())
      : (comment || findCommentList());
    if (!host) return;
    const post = state.post as ActionPostHandle | null;
    const previousComposer = isPostReply ? (modal?.composer || post?.composer) : getDirectComposer(comment);
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
    const submit = createElement('button', '', '发送回复') as HTMLButtonElement;
    submit.type = 'button';
    const original = createElement('a', '', '打开原帖回复') as HTMLAnchorElement;
    original.href = getPreviewSourceUrl(comment, actionContext);
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    const cancel = createElement('button', '', '取消') as HTMLButtonElement;
    cancel.type = 'button';
    const status = createElement('span', 'xns-preview-composer-status');
    actions.append(submit, original, cancel, status);
    composer.appendChild(actions);
    if (isPostReply && modal?.composerHost) {
      modal.composerHost.hidden = false;
      modal.composerHost.classList.add('is-open');
      modal.composerHost.appendChild(composer);
      modal.composer = composer;
    } else {
      const menu = qs(comment, '.xns-preview-menu');
      if (menu) menu.insertAdjacentElement('afterend', composer);
      else host.appendChild(composer);
      const postHandle = state.post as ActionPostHandle | null;
      if (isPostReply && postHandle) postHandle.composer = composer;
    }
    textarea.focus();
    if (!isPostReply || !modal?.composerHost) composer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    cancel.addEventListener('click', () => {
      composer.remove();
      if (modal?.composer === composer) {
        modal.composer = null;
        modal.composerHost?.classList.remove('is-open');
        if (modal.composerHost) modal.composerHost.hidden = true;
      }
      const postHandle = state.post as ActionPostHandle | null;
      if (!modal && postHandle?.composer === composer) postHandle.composer = null;
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
          const postModal = actionContext.modal;
          if (postModal.composer === composer) {
            postModal.composer = null;
            postModal.composerHost?.classList.remove('is-open');
            if (postModal.composerHost) postModal.composerHost.hidden = true;
          }
          composer.remove();
          void postModal?.syncReply?.();
        } else if (state.post) {
          const postHandle = state.post as ActionPostHandle;
          if (postHandle.composer === composer) postHandle.composer = null;
          composer.remove();
          await postHandle.reloadPages?.({ refreshCurrentPage: true });
        }
      } catch (error) {
        status.textContent = `发送失败：${(error as Error).message || '网络错误'}`;
        submit.disabled = false;
      }
    });
  }

  async function runPreviewAction(action: PreviewActionKey, menuItem: Element, comment: Element | null, context: PreviewActionContext | null = null): Promise<void> {
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
    // 官方语义：点赞重复点会重复提交，鸡腿/反对在已操作时只提示，收藏是唯一可逆的 add/remove。
    const stateEntry = getInteractionState(action, comment);
    if (action !== 'favorite' && stateEntry?.done) {
      setActionState(menuItem, '已操作');
      return;
    }
    if (menuItem.classList.contains('xns-action-pending')) return;
    if (action === 'chicken' && !windowObj.confirm('确认给这条评论加鸡腿？NodeSeek 可能会消耗鸡腿。')) return;
    if (action === 'dislike' && !windowObj.confirm('确认反对这条评论？NodeSeek 可能会消耗两个鸡腿。')) return;
    const isFavoriteRemoval = action === 'favorite' && Boolean(stateEntry?.done);
    menuItem.classList.add('xns-action-pending');
    menuItem.classList.remove('xns-action-failed');
    setActionState(menuItem, '处理中…');
    try {
      let response: unknown = null;
      if (action === 'like') response = await postAction('/api/statistics/upvote', { commentId: targetId, action: 'add' }, { context: actionContext });
      else if (action === 'chicken') response = await postAction('/api/statistics/like', { commentId: targetId, action: 'add' }, { context: actionContext });
      else if (action === 'dislike') response = await postAction('/api/statistics/dislike', { commentId: targetId, action: 'add' }, { context: actionContext });
      // 取消收藏的官方参数是 action: 'remove'（不是 'del'）。
      else if (action === 'favorite') response = await postAction('/api/statistics/collection', { postId, action: isFavoriteRemoval ? 'remove' : 'add' }, { context: actionContext });
      const payload = response as { postCollectionCount?: unknown; current?: unknown } | null;
      const previousCount = stateEntry?.count ?? null;
      const fallbackCount = Number.isFinite(previousCount) && previousCount !== null
        ? previousCount + (isFavoriteRemoval ? -1 : 1)
        : null;
      const responseCount = safeCount(action === 'favorite' ? payload?.postCollectionCount : payload?.current);
      updateInteractionState(action, comment, {
        done: !isFavoriteRemoval,
        count: responseCount === null ? fallbackCount : responseCount,
      });
      applyInteractionState(menuItem, getInteractionState(action, comment));
      setActionState(menuItem, '✓');
      windowObj.setTimeout(() => {
        if (menuItem.isConnected && !menuItem.classList.contains('xns-action-failed')) qs(menuItem, ':scope > .xns-action-state')?.remove();
      }, 1_800);
    } catch (error) {
      setActionState(menuItem, `失败：${(error as Error).message || '操作未完成'}`, true);
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
    openPreviewEditor,
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
  buildPostUrl,
  parseSameOriginUrl,
  safeCount,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  findCommentList,
  postAction,
});
function getDirectCommentMenu(comment?: Element | null): Element | null { return xnsCommentActions.getDirectCommentMenu(comment); }
function getMenuActionKey(menuItem?: Element | null): PreviewActionKey | '' { return xnsCommentActions.getMenuActionKey(menuItem); }
function ensurePreviewMenu(comment: Element, options: PreviewMenuOptions = {}): Element | null { return xnsCommentActions.ensurePreviewMenu(comment, options); }
function getActionContext(menuItem?: Element | null): PreviewActionContext { return xnsCommentActions.getActionContext(menuItem); }
function openPreviewComposer(action: string, comment: Element | null, context?: PreviewActionContext | null): void { return xnsCommentActions.openPreviewComposer(action, comment, context); }
function openPreviewEditor(comment: Element | null, record: CommentRecord | null, context?: PreviewActionContext | null): void { return xnsCommentActions.openPreviewEditor(comment, record, context); }
function runPreviewAction(action: PreviewActionKey, menuItem: Element, comment: Element | null, context?: PreviewActionContext | null): Promise<void> { return xnsCommentActions.runPreviewAction(action, menuItem, comment, context); }

export { ensurePreviewMenu, getActionContext, getDirectCommentMenu, getMenuActionKey, openPreviewComposer, openPreviewEditor, runPreviewAction };
export type { InteractionEntry, PreviewActionContext, PreviewActionKey, PreviewMenuOptions };
