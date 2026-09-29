import { getAuthorName, getCommentId, getFloor, getPostContent, qs, qsa, safeCount, safePositiveInt } from '../core/dom.js';
import { getCurrentUserUid } from './identity.js';
import { sanitizeImportedNode } from './sanitize';
import type { SsrCommentEntry, SsrState } from './ssr-state.js';
import { getPostInfo, parseSameOriginUrl } from './url.js';

// NodeSeek 页面内容解析与安全克隆；输出供预览和帖子页共用的评论记录。

interface ReplyMetadata {
  targetFloor: number;
  targetUser: string;
}

interface SsrCommentCounts {
  like: number | null;
  chicken: number | null;
  dislike: number | null;
  liked: boolean;
  chickened: boolean;
  disliked: boolean;
  /** 收藏只存在于帖子级 SSR 数据，由内容解析后的调用方补写。 */
  favorite?: number | null;
  collected?: boolean;
}

export interface CommentRecord {
  floor: number;
  page: number;
  postId: string;
  index: number;
  current: boolean;
  isMine: boolean;
  pinned: boolean;
  author: string;
  reply: ReplyMetadata | null;
  counts: SsrCommentCounts | null;
  /** SSR 里保存的原始 markdown，供脚本内联编辑回填。 */
  markdown: string | null;
  node: Element | null;
  html: string | null;
  parent: CommentRecord | null;
  children: CommentRecord[];
}

export interface CommentRecordOptions {
  keepCommentMenu?: boolean;
  state?: SsrState | null;
  getCurrentUserUid?: () => string | null;
}

interface ContentParserDeps {
  documentObj: Document;
  qs: (root: ParentNode | null | undefined, selector: string) => Element | null;
  qsa: (root: ParentNode | null | undefined, selector: string) => Element[];
  parseSameOriginUrl: (rawUrl: string, base?: string) => URL | null;
  getPostInfo: (rawUrl: string) => { postId: string; page: number } | null;
  safePositiveInt: (value: unknown) => number | null;
  getFloor: (item: Element | null | undefined) => number | null;
  getCommentId: (item: Element | null | undefined) => number | null;
  getAuthorName: (item: Element) => string;
  getPostContent: (item: Element) => Element | null;
  getCurrentUserUid: () => string | null;
}

function createContentParser({
  documentObj,
  qs,
  qsa,
  parseSameOriginUrl,
  getPostInfo,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  getCurrentUserUid,
}: ContentParserDeps) {
const ssrCommentIndexes = new WeakMap<object, Map<string, SsrCommentEntry>>();

function extractReplyMetadata(item: Element, postId: string): ReplyMetadata | null {
  const content = getPostContent(item);
  const firstParagraph = content?.querySelector(':scope > p:first-child');
  const firstText = firstParagraph?.textContent?.trim() || '';
  const match = /^@([^\s]+)\s+#([1-9]\d*)/.exec(firstText);
  if (!match) return null;
  const targetFloor = safePositiveInt(match[2]);
  if (targetFloor === null) return null;
  const floorLink = qsa(firstParagraph, 'a').find((link) => /^#\d+$/.test((link.textContent || '').trim()));
  if (floorLink) {
    const linkedUrl = parseSameOriginUrl(floorLink.getAttribute('href') || '');
    const linkedInfo = linkedUrl ? getPostInfo(linkedUrl.href) : null;
    if (linkedInfo && linkedInfo.postId !== String(postId)) return null;
  }
  return { targetFloor, targetUser: match[1].slice(0, 80) };
}

function isPinnedComment(item: Element): boolean {
  return Boolean(qs(item, '.nsk-content-meta-info .hot-badge, .nsk-content-meta-info .pined-comment-badge, .nsk-content-meta-info [title="置顶"], .nsk-content-meta-info [title*="HOT"], .nsk-content-meta-info [class*="hot"]'));
}

function hasOwnEditOption(item: Element | null | undefined): boolean {
  if (!item?.querySelector) return false;
  return qsa(item, ':scope > .comment-menu > .menu-item, :scope > .comment-actions > .menu-item')
    .some((el) => (el.textContent || '').trim() === '编辑' && !el.getAttribute('data-xns-action'));
}

function getCommentAuthorUid(item: Element): string | null {
  try {
    const author = qs(item, '.nsk-content-meta-info a[href*="/space/"], .author-name, a[href*="/space/"]');
    const match = (author?.getAttribute('href') || '').match(/\/space\/(\d+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

function getStateUserUid(state: SsrState | null | undefined): string | null {
  const user = state?.user;
  const value = user && (user.id ?? user.uid ?? user.userId ?? user.memberId ?? user.member_id);
  return value === undefined || value === null ? null : String(value);
}

function getCommentRecord(item: Element, postId: string, page: number, index: number, current: boolean, options: CommentRecordOptions = {}): CommentRecord | null {
  const floor = getFloor(item);
  if (floor === null) return null;
  const node = current ? item : sanitizeImportedNode(item, { keepCommentMenu: options.keepCommentMenu, deferImages: true });
  if (!node) return null;
  const commentId = getCommentId(item);
  const currentUserUid = (typeof options.getCurrentUserUid === 'function' ? options.getCurrentUserUid() : getCurrentUserUid())
    || getStateUserUid(options.state);
  return {
    floor, page, postId, index, current,
    isMine: hasOwnEditOption(item) || (currentUserUid !== null && getCommentAuthorUid(item) === currentUserUid),
    pinned: isPinnedComment(item),
    author: getAuthorName(item),
    reply: extractReplyMetadata(item, postId),
    counts: commentId !== null && options.state ? getSsrCommentCounts(options.state, commentId) : null,
    markdown: commentId !== null && options.state ? getSsrCommentMarkdown(options.state, commentId) : null,
    // 跨页评论在原版布局下不会展示；虚拟楼层流只保留经过清洗的 HTML，
    // 需要进入活动窗口时再物化成节点。
    node: current ? node : null,
    html: current ? null : node.outerHTML,
    parent: null, children: [],
  };
}

function materializeCommentNode(record: CommentRecord | null | undefined): Element | null {
  if (record?.node) return record.node;
  if (typeof record?.html !== 'string' || !record.html) return null;
  const template = documentObj.createElement('template');
  template.innerHTML = record.html;
  record.node = template.content.firstElementChild || null;
  restoreDeferredImageSources(record.node);
  return record.node;
}

// 远端评论进入活动窗口时必须先恢复图片源地址，再交给图片灯箱/内容增强绑定事件。
// 否则节点虽然已经物化，浏览器仍会把 data-xns-deferred-src 当作没有 src，显示破图占位。
function restoreDeferredImageSources(root: Element | null): void {
  const images: Element[] = [];
  if (root?.localName === 'img') images.push(root);
  images.push(...qsa(root, 'img[data-xns-deferred-src]'));
  images.forEach((image) => {
    const source = image.getAttribute('data-xns-deferred-src');
    if (source && !image.getAttribute('src')) image.setAttribute('src', source);
    image.removeAttribute('data-xns-deferred-src');
  });
}

function releaseCommentNode(record: CommentRecord | null | undefined): void {
  if (record && !record.current) record.node = null;
}

function releaseCommentHtml(record: CommentRecord | null | undefined): void {
  if (record && !record.current && record.node) record.html = null;
}

function getSsrCommentEntry(stateValue: SsrState | null | undefined, commentId: number): SsrCommentEntry | null {
  if (!stateValue || typeof stateValue !== 'object') return null;
  let index = ssrCommentIndexes.get(stateValue);
  if (!index) {
    const built = new Map<string, SsrCommentEntry>();
    const comments = stateValue?.postData?.comments;
    if (Array.isArray(comments)) {
      comments.forEach((item) => {
        if (item?.commentId !== undefined && item?.commentId !== null && !built.has(String(item.commentId))) {
          built.set(String(item.commentId), item);
        }
      });
    }
    index = built;
    ssrCommentIndexes.set(stateValue, index);
  }
  return index.get(String(commentId)) || null;
}

function getSsrCommentCounts(stateValue: SsrState | null | undefined, commentId: number): SsrCommentCounts | null {
  const comment = getSsrCommentEntry(stateValue, commentId);
  if (!comment) return null;
  return {
    like: safeCount(comment.upvoteCount), chicken: safeCount(comment.likeCount), dislike: safeCount(comment.dislikeCount),
    liked: Boolean(comment.upvoted), chickened: Boolean(comment.liked), disliked: Boolean(comment.disliked),
  };
}

function getSsrCommentMarkdown(stateValue: SsrState | null | undefined, commentId: number): string | null {
  const comment = getSsrCommentEntry(stateValue, commentId);
  return typeof comment?.markdown === 'string' ? comment.markdown : null;
}

  return Object.freeze({
    sanitizeImportedNode,
    extractReplyMetadata,
    isPinnedComment,
    hasOwnEditOption,
    getCommentAuthorUid,
    getCommentRecord,
    materializeCommentNode,
    releaseCommentNode,
    releaseCommentHtml,
    getSsrCommentCounts,
  });
}

const xnsContentParser = createContentParser({
  documentObj: document,
  qs,
  qsa,
  parseSameOriginUrl,
  getPostInfo,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  getCurrentUserUid,
});
const { getCommentRecord, getSsrCommentCounts, materializeCommentNode, releaseCommentNode } = xnsContentParser;

export { getCommentRecord, getSsrCommentCounts, materializeCommentNode, releaseCommentNode, sanitizeImportedNode };
export type { SsrCommentEntry, SsrState };
