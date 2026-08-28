// 从页面链接发现同一帖子的分页。
function createPaginationService({ windowObj, qsa, parseSameOriginUrl, getPostInfo }) {
  function getPaginationLinks(root) {
    const preferred = qsa(root, '.nsk-pager a[href], a.pager-pos[href]');
    return preferred.length ? preferred : qsa(root, 'a[href]');
  }

  function getPageNumbers(root, postId) {
    const pages = new Set();
    const baseUrl = typeof root?.baseURI === 'string' && /^https?:/.test(root.baseURI) ? root.baseURI : windowObj.location.href;
    getPaginationLinks(root).forEach((link) => {
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
