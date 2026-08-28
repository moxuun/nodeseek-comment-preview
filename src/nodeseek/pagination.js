// 从页面链接发现同一帖子的分页。
function createPaginationService({ windowObj, qsa, parseSameOriginUrl, getPostInfo }) {
  function getPageNumbers(root, postId) {
    const pages = new Set();
    const baseUrl = typeof root?.baseURI === 'string' && /^https?:/.test(root.baseURI) ? root.baseURI : windowObj.location.href;
    qsa(root, 'a[href]').forEach((link) => {
      const url = parseSameOriginUrl(link.getAttribute('href') || '', baseUrl);
      const info = url ? getPostInfo(url.href) : null;
      if (info?.postId === String(postId)) pages.add(info.page);
    });
    return pages;
  }

  return Object.freeze({ getPageNumbers });
}

const xnsPaginationService = createPaginationService({
  windowObj: window,
  qsa,
  parseSameOriginUrl,
  getPostInfo,
});
const getPageNumbers = (...args) => xnsPaginationService.getPageNumbers(...args);
