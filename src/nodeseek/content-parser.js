// NodeSeek 页面内容解析与安全克隆；输出供预览和帖子页共用的评论记录。
function createContentParser({
  documentObj,
  qs,
  qsa,
  getSafeUrlAttribute,
  parseSameOriginUrl,
  getPostInfo,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  getCurrentUserUid,
}) {
function sanitizeImportedNode(sourceNode, options = {}) {
  if (!sourceNode) return null;
  const imported = documentObj.importNode(sourceNode, true);
  const dangerous = 'script,style,link,meta,base,iframe,object,embed,form,input,textarea,select,option,button';
  qsa(imported, dangerous).forEach((node) => node.remove());
  if (imported.matches?.(dangerous)) imported.remove();
  if (!options.keepCommentMenu) qsa(imported, '.comment-menu, .comment-actions').forEach((node) => node.remove());
  qsa(imported, '[id]').forEach((node) => node.removeAttribute('id'));
  const all = [imported, ...qsa(imported, '*')].filter((node) => node.nodeType === 1);
  all.forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['style', 'srcdoc', 'srcset', 'formaction', 'contenteditable', 'ping'].includes(name)) {
        node.removeAttribute(attribute.name);
        return;
      }
      if (['href', 'src', 'poster', 'xlink:href'].includes(name)) {
        const safeFragment = name === 'xlink:href' && attribute.value.trim().startsWith('#');
        const urlName = name === 'poster' ? 'src' : name === 'xlink:href' ? 'href' : name;
        const safeValue = safeFragment ? attribute.value : getSafeUrlAttribute(urlName, attribute.value);
        if (!safeValue) node.removeAttribute(attribute.name);
        else node.setAttribute(attribute.name, safeValue);
      }
    });
    if (node.localName === 'a' && (node.hasAttribute('href') || node.hasAttribute('xlink:href'))) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
    if (node.localName === 'img') {
      node.setAttribute('loading', 'lazy');
      node.setAttribute('decoding', 'async');
      node.setAttribute('referrerpolicy', 'origin');
    }
  });
  return imported;
}

function extractReplyMetadata(item, postId) {
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

function isPinnedComment(item) {
  return Boolean(qs(item, '.nsk-content-meta-info .hot-badge, .nsk-content-meta-info .pined-comment-badge, .nsk-content-meta-info [title="置顶"], .nsk-content-meta-info [title*="HOT"], .nsk-content-meta-info [class*="hot"]'));
}

function hasOwnEditOption(item) {
  if (!item?.querySelector) return false;
  return qsa(item, ':scope > .comment-menu > .menu-item').some((el) => (el.textContent || '').trim() === '编辑' && !el.dataset?.xnsAction);
}

function getCommentAuthorUid(item) {
  try {
    const author = qs(item, '.nsk-content-meta-info a.author-name, .author-name');
    const match = (author?.getAttribute('href') || '').match(/\/space\/(\d+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

function getCommentRecord(item, postId, page, index, current, options = {}) {
  const floor = getFloor(item);
  if (floor === null) return null;
  const node = current ? item : sanitizeImportedNode(item, options);
  if (!node) return null;
  const commentId = getCommentId(item);
  const currentUserUid = typeof options.getCurrentUserUid === 'function' ? options.getCurrentUserUid() : getCurrentUserUid();
  return {
    floor, page, postId, index, current,
    isMine: hasOwnEditOption(item) || (currentUserUid !== null && getCommentAuthorUid(item) === currentUserUid),
    pinned: isPinnedComment(item),
    author: getAuthorName(item),
    reply: extractReplyMetadata(item, postId),
    counts: commentId !== null && options.state ? getSsrCommentCounts(options.state, commentId) : null,
    node, parent: null, children: [],
  };
}

function getSsrCommentCounts(stateValue, commentId) {
  const comment = stateValue?.postData?.comments?.find((item) => String(item.commentId) === String(commentId));
  if (!comment) return null;
  return {
    like: safeCount(comment.upvoteCount), chicken: safeCount(comment.likeCount), dislike: safeCount(comment.dislikeCount),
    liked: Boolean(comment.upvoted), chickened: Boolean(comment.liked), disliked: Boolean(comment.disliked),
  };
}

  return Object.freeze({
    sanitizeImportedNode,
    extractReplyMetadata,
    isPinnedComment,
    hasOwnEditOption,
    getCommentAuthorUid,
    getCommentRecord,
    getSsrCommentCounts,
  });
}

const xnsContentParser = createContentParser({
  documentObj: document,
  qs,
  qsa,
  getSafeUrlAttribute,
  parseSameOriginUrl,
  getPostInfo,
  safePositiveInt,
  getFloor,
  getCommentId,
  getAuthorName,
  getPostContent,
  getCurrentUserUid,
});
const sanitizeImportedNode = (...args) => xnsContentParser.sanitizeImportedNode(...args);
const extractReplyMetadata = (...args) => xnsContentParser.extractReplyMetadata(...args);
const isPinnedComment = (...args) => xnsContentParser.isPinnedComment(...args);
const hasOwnEditOption = (...args) => xnsContentParser.hasOwnEditOption(...args);
const getCommentAuthorUid = (...args) => xnsContentParser.getCommentAuthorUid(...args);
const getCommentRecord = (...args) => xnsContentParser.getCommentRecord(...args);
const getSsrCommentCounts = (...args) => xnsContentParser.getSsrCommentCounts(...args);
