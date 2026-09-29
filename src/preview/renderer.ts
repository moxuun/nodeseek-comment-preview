import { flattenReplyTree } from '../comments/thread.js';
import type { FlatEntry, ThreadLines } from '../comments/thread.js';
import { SELECTORS, state } from '../core/config.js';
import { clearElement, createElement, getCommentId, qs, qsa, safeCount } from '../core/dom.js';
import { pageInfo } from '../core/runtime.js';
import { ensurePreviewMenu, getDirectCommentMenu, openPreviewEditor } from '../features/comment-actions.js';
import { getSsrCommentCounts, materializeCommentNode, sanitizeImportedNode } from '../nodeseek/content-parser.js';
import type { SsrCommentCounts } from '../nodeseek/content-parser.js';
import { getDocState } from '../nodeseek/ssr-state.js';
import { buildPostUrl, getPostInfo } from '../nodeseek/url.js';
import { formatPageStatus } from '../ui/status.js';
import { addRemoteNote, stripRenderArtifacts } from './render-utils.js';
import { createCommentVirtualizer } from './virtualizer.js';
import type { CommentRecord } from '../nodeseek/content-parser.js';
import type { PageStatusOptions } from '../ui/status.js';
import type { CommentVirtualEntry, CommentVirtualizer, VirtualizerSetupOptions } from './virtualizer.js';

/** 帖子信息中渲染需要的字段。 */
interface RenderPostInfo {
  postId: string;
  page?: number;
}

/** 状态行渲染选项。 */
interface RenderStatusOptions extends PageStatusOptions {
  statusNode?: HTMLElement | null;
  onRetry?: () => void;
}

/** 楼层列表渲染选项。 */
interface RenderRecordsOptions extends RenderStatusOptions {
  onNodeMounted?: (node: HTMLElement, record: CommentRecord) => void;
  onNodeUnmounted?: (node: HTMLElement, record: CommentRecord) => void;
}

/** 挂载了虚拟列表实例的渲染容器。 */
type RenderHost = HTMLElement & { __xnsVirtualizer?: CommentVirtualizer };

/** 关系线的缩进步长、竖线宽度与最大层级（与 ui/style.ts 里的 --xns-indent 保持一致）。 */
const THREAD_STEP = 18;
const THREAD_LINE_WIDTH = 3;
const THREAD_LEVEL_LIMIT = 8;

/** 生成各层竖线的背景图：只画指定层级（x = 18k + 6，宽 3px），其余保持透明。 */
function threadColumnImage(levels: number[]): string {
  const unique = Array.from(new Set(levels.filter((level) => level >= 0 && level <= THREAD_LEVEL_LIMIT))).sort((a, b) => a - b);
  if (!unique.length) return 'none';
  const stops: string[] = [];
  unique.forEach((level) => {
    const x = level * THREAD_STEP + 6;
    stops.push(`transparent ${x}px`, `var(--xns-thread-line) ${x}px`, `var(--xns-thread-line) ${x + THREAD_LINE_WIDTH}px`, `transparent ${x + THREAD_LINE_WIDTH}px`);
  });
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** 渲染器依赖；测试可注入替身。 */
interface PreviewRendererDeps {
  document: Document;
  windowObj: Window & typeof globalThis;
  state: typeof state;
  pageInfo: typeof pageInfo;
  selectors: typeof SELECTORS;
  qs: typeof qs;
  qsa: typeof qsa;
  createElement: typeof createElement;
  clearElement: typeof clearElement;
  getPostInfo: typeof getPostInfo;
  buildPostUrl: typeof buildPostUrl;
  getDocState: typeof getDocState;
  getCommentId: typeof getCommentId;
  getSsrCommentCounts: typeof getSsrCommentCounts;
  safeCount: typeof safeCount;
  sanitizeImportedNode: typeof sanitizeImportedNode;
  materializeCommentNode: typeof materializeCommentNode;
  getDirectCommentMenu: (node: Element) => Element | null;
  ensurePreviewMenu: (node: Element, options: { includeFavorite: boolean; counts?: SsrCommentCounts | null }) => void;
  stripRenderArtifacts: typeof stripRenderArtifacts;
  flattenReplyTree: typeof flattenReplyTree;
  createCommentVirtualizer: typeof createCommentVirtualizer;
  addRemoteNote: typeof addRemoteNote;
  formatPageStatus: typeof formatPageStatus;
  openPreviewEditor: (node: Element, record: CommentRecord) => unknown;
}

// 预览内容渲染服务。
// 这里仅负责把已加载的帖子记录转换成官方风格的楼层节点；网络读取由 page-loader 负责。
function createPreviewRenderer({
  document,
  windowObj,
  state,
  pageInfo,
  selectors,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  buildPostUrl,
  getDocState,
  getCommentId,
  getSsrCommentCounts,
  safeCount,
  sanitizeImportedNode,
  materializeCommentNode,
  getDirectCommentMenu,
  ensurePreviewMenu,
  stripRenderArtifacts,
  flattenReplyTree,
  createCommentVirtualizer,
  addRemoteNote,
  formatPageStatus,
  openPreviewEditor,
}: PreviewRendererDeps) {
  function ensurePreviewEditOption(node: Element | null, record: CommentRecord | null | undefined): void {
    if (!node || !record?.isMine) return;
    const menu = getDirectCommentMenu(node);
    if (!menu) return;
    let item = qsa(menu, ':scope > .menu-item').find((el) => (el.textContent || '').trim() === '编辑' && !(el as HTMLElement).dataset?.xnsAction) as HTMLElement | undefined;
    // 帖子详情页已有 NodeSeek/Vue 原生编辑项时直接保留。它带有官方事件
    // 处理器，由官方在楼层下方展开编辑器；脚本不能覆盖成打开新标签。
    // 如果原生项没有渲染出来，仍要先补回可见入口；后面不接管当前页的点击，
    // 避免把“修复显示”又回归成跳转行为。
    if (record.current && item) {
      item.setAttribute('aria-label', '编辑');
      return;
    }
    if (!item) {
      item = createElement('span', 'menu-item') as HTMLElement;
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
      // 弹窗里的楼层来自跨页读取，没有官方编辑器可接管：就地展开脚本的编辑框。
      if (node.closest('.xns-overlay')) {
        openPreviewEditor(node, record);
        return;
      }
      // 帖子页沿用官方编辑器：能直接定位就就地展开，否则先跳到该评论所在的页。
      const post = state.post as { requestNativeEdit?: (target: CommentRecord) => boolean } | null | undefined;
      if (post?.requestNativeEdit?.(record)) return;
      const postId = record.postId || pageInfo?.postId || getPostInfo(windowObj.location.href)?.postId || '';
      const floor = record.floor;
      const url = buildPostUrl(postId, record.page || 1, floor >= 0 ? floor : null);
      if (url) windowObj.open(url.href, '_blank', 'noopener');
    });
  }

  /**
   * 把层级相关的几何状态写到条目上：缩进、根/子/叶子标记和关系线的竖线层（见 style.ts 的楼层关系线）。
   * `thread` 来自 flattenReplyTree；缺少时（非虚拟列表路径）退回“所有祖先层都贯穿”，随后同步纠正。
   */
  function applyThreadGeometry(node: HTMLElement, record: CommentRecord, depth: number, thread?: ThreadLines | null): void {
    const level = Math.min(THREAD_LEVEL_LIMIT, Math.max(0, depth));
    node.setAttribute('data-xns-depth', String(level));
    node.style.setProperty('--xns-indent', `${level * THREAD_STEP}px`);
    node.classList.toggle('xns-comment-root', level === 0);
    node.classList.toggle('xns-comment-child', level > 0);
    // 没有子楼层的嵌套条目只画“本层分支”的短横线；若也画本层竖线，相邻兄弟条目的
    // 竖线会首尾相接，看上去像上一条目还有后代。
    node.classList.toggle('xns-comment-leaf', level > 0 && !record.children?.length);
    // 竖线分层：祖先里还有后续兄弟的层级贯穿整行，本层有子楼层时本层竖线也贯穿整行。
    const full = thread ? thread.full : Array.from({ length: level }, (_, index) => index);
    node.style.setProperty('--xns-thread-columns', threadColumnImage(record.children?.length ? full.concat(level) : full));
    // 本条是父层最后一条子楼层：父层竖线不贯穿本行，只在横线处收口，否则没有后续兄弟也会垂出一条长线。
    const stop = thread ? thread.stop : -1;
    node.style.setProperty('--xns-thread-stop-x', `${(stop >= 0 ? stop : 0) * THREAD_STEP + 6}px`);
    node.style.setProperty('--xns-thread-stop-width', stop >= 0 ? `${THREAD_LINE_WIDTH}px` : '0px');
  }

  /**
   * 虚拟列表按 key 复用已挂载的节点，不会重跑 renderItem；跨页补全子楼层后，
   * 已挂载条目的缩进和“无子楼层”标记会过期，必须按最新树同步一次。
   */
  function syncThreadEntries(thread: Element, entries: FlatEntry[]): void {
    if (!entries.length) return;
    const byFloor = new Map(entries.map((entry) => [String(entry.record.floor), entry]));
    qsa(thread, '.content-item[data-xns-depth]').forEach((row) => {
      const entry = byFloor.get(row.getAttribute('data-xns-floor') || '');
      if (!entry) return;
      applyThreadGeometry(row as HTMLElement, entry.record, entry.depth ?? 0, entry.thread);
    });
  }

  function prepareCommentRecord(record: CommentRecord, depth: number, thread?: ThreadLines | null): HTMLElement | null {
    const node = materializeCommentNode(record) as HTMLElement | null;
    if (!node) return null;
    stripRenderArtifacts(record.node);
    node.setAttribute('data-xns-floor', String(record.floor));
    if (!record.current) {
      node.setAttribute('data-xns-remote', 'true');
      node.setAttribute('data-xns-source-page', String(record.page));
    }
    applyThreadGeometry(node, record, depth, thread);
    if (depth > 0 && record.parent) node.setAttribute('data-xns-parent-floor', String(record.parent.floor));
    ensurePreviewMenu(node, { includeFavorite: false, counts: record.counts || undefined });
    ensurePreviewEditOption(node, record);
    return node;
  }

  function appendNestedRecord(record: CommentRecord, container: Element, depth: number, thread?: ThreadLines | null): void {
    const node = prepareCommentRecord(record, depth, thread);
    if (!node) return;
    container.appendChild(node);
    if (!record.children.length) return;
    const replyList = createElement('ul', 'xns-reply-list');
    const full = thread ? thread.full : Array.from({ length: depth }, (_, index) => index);
    record.children.forEach((child, index) => {
      const isLastChild = index === record.children.length - 1;
      appendNestedRecord(child, replyList, depth + 1, {
        full: isLastChild ? full : full.concat(depth),
        stop: isLastChild ? depth : -1,
      });
    });
    node.appendChild(replyList);
  }

  function buildPreviewPostNode(parsed: Document | Element, info: RenderPostInfo): Element | null {
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
    const floorLink = qs(node, '.floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link') as HTMLAnchorElement | null;
    const floorUrl = buildPostUrl(info.postId, 1, 0);
    if (floorLink && floorUrl) {
      floorLink.href = floorUrl.href;
      floorLink.target = '_blank';
      floorLink.rel = 'noopener noreferrer';
      floorLink.title = '打开原帖 #0';
      floorLink.setAttribute('aria-label', '打开原帖 #0');
    }
    const postState = getDocState(parsed as Document);
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

  function renderPreviewStatus(section: Element, options: RenderStatusOptions = {}): HTMLElement {
    const status = formatPageStatus(options);
    const statusNode = (options.statusNode || qs(section, ':scope > .xns-preview-status') || createElement('div', 'xns-preview-status')) as HTMLElement;
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
        const retry = createElement('button', 'xns-inline-retry', '重试') as HTMLButtonElement;
        retry.type = 'button';
        retry.title = '重新读取失败分页';
        retry.setAttribute('aria-label', '重新读取失败分页');
        retry.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          options.onRetry?.();
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

  function renderPreviewRecords(section: Element, info: RenderPostInfo, records: CommentRecord[], options: RenderRecordsOptions = {}): void {
    const heading = qs(section, ':scope > h3');
    const thread = qs(section, ':scope > .xns-preview-thread');
    if (!heading || !thread) return;
    const host = section as RenderHost;
    heading.textContent = `${records.length} 条回复`;
    qs(section, ':scope > .xns-preview-empty')?.remove();
    if (records.length) {
      const onNodeMounted = (node: HTMLElement, entry: CommentVirtualEntry): void => {
        const record = entry.record as unknown as CommentRecord;
        addRemoteNote(record, info.postId, record.page !== info.page);
        options.onNodeMounted?.(node, record);
      };
      const onNodeUnmounted = (node: HTMLElement, entry: CommentVirtualEntry): void => {
        const record = entry.record as unknown as CommentRecord;
        if (!record.current) record.node = null;
        options.onNodeUnmounted?.(node, record);
      };
      const renderItem = (entry: CommentVirtualEntry): HTMLElement | null => prepareCommentRecord(entry.record as unknown as CommentRecord, entry.depth ?? 0, entry.thread);
      const virtualizerOptions: VirtualizerSetupOptions = {
        getViewport: () => thread.closest('.xns-modal-body') || windowObj,
        renderItem,
        onMount: onNodeMounted,
        onUnmount: onNodeUnmounted,
      };
      const flatEntries = flattenReplyTree(records);
      const virtualizer = host.__xnsVirtualizer || createCommentVirtualizer({
        windowObj,
        documentObj: document,
        createElement,
        estimatedHeight: 135,
        overscanScreens: 2,
      }).mount(thread as RenderHost, virtualizerOptions);
      host.__xnsVirtualizer = virtualizer;
      virtualizer.setEntries(flatEntries, virtualizerOptions);
      syncThreadEntries(thread, flatEntries);
    } else {
      host.__xnsVirtualizer?.destroy();
      delete host.__xnsVirtualizer;
      clearElement(thread);
      section.appendChild(createElement('p', 'xns-status xns-preview-empty', '没有读取到评论。'));
    }
    renderPreviewStatus(section, options);
  }

  return Object.freeze({
    ensurePreviewEditOption,
    prepareCommentRecord,
    syncThreadEntries,
    appendNestedRecord,
    buildPreviewPostNode,
    renderPreviewStatus,
    renderPreviewRecords,
  });
}

const xnsPreviewRenderer = createPreviewRenderer({
  document,
  windowObj: window,
  state,
  pageInfo,
  selectors: SELECTORS,
  qs,
  qsa,
  createElement,
  clearElement,
  getPostInfo,
  buildPostUrl,
  getDocState,
  getCommentId,
  getSsrCommentCounts,
  safeCount,
  sanitizeImportedNode,
  materializeCommentNode,
  getDirectCommentMenu,
  ensurePreviewMenu,
  stripRenderArtifacts,
  flattenReplyTree,
  createCommentVirtualizer,
  addRemoteNote,
  formatPageStatus,
  openPreviewEditor,
});

const buildPreviewPostNode = (parsed: Document | Element, info: RenderPostInfo): Element | null => xnsPreviewRenderer.buildPreviewPostNode(parsed, info);
const prepareCommentRecord = (record: CommentRecord, depth: number, thread?: ThreadLines | null): HTMLElement | null => xnsPreviewRenderer.prepareCommentRecord(record, depth, thread);
const syncThreadEntries = (thread: Element, entries: FlatEntry[]): void => xnsPreviewRenderer.syncThreadEntries(thread, entries);
const renderPreviewRecords = (section: Element, info: RenderPostInfo, records: CommentRecord[], options?: RenderRecordsOptions): void => xnsPreviewRenderer.renderPreviewRecords(section, info, records, options);

export { buildPreviewPostNode, prepareCommentRecord, renderPreviewRecords, syncThreadEntries };
export type { RenderPostInfo, RenderRecordsOptions, RenderStatusOptions };
