// NodeSeek 帖子 URL 规则与同源请求边界。
function createNodeSeekUrlService({ windowObj, URLCtor, safePositiveInt }) {
  function getPostInfo(rawUrl) {
    try {
      const url = new URLCtor(rawUrl, windowObj.location.href);
      if (url.origin !== windowObj.location.origin) return null;
      const match = /^\/post-(\d+)-(\d+)\/?$/.exec(url.pathname);
      if (!match) return null;
      const postId = safePositiveInt(match[1]);
      const page = safePositiveInt(match[2]);
      if (postId === null || page === null) return null;
      return { postId: String(postId), page };
    } catch { return null; }
  }

  function parseSameOriginUrl(rawUrl, base = windowObj.location.href) {
    if (typeof rawUrl !== 'string' || rawUrl.length > 2_048) return null;
    try {
      const url = new URLCtor(rawUrl, base);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      if (url.origin !== windowObj.location.origin || url.username || url.password) return null;
      return url;
    } catch { return null; }
  }

  function isAllowedPostRequest(url) {
    const info = url instanceof URLCtor ? getPostInfo(url.href) : null;
    return Boolean(info && !url.search && !url.username && !url.password);
  }

  return Object.freeze({ getPostInfo, parseSameOriginUrl, isAllowedPostRequest });
}

const xnsNodeSeekUrlService = createNodeSeekUrlService({
  windowObj: window,
  URLCtor: URL,
  safePositiveInt,
});
const getPostInfo = (...args) => xnsNodeSeekUrlService.getPostInfo(...args);
const parseSameOriginUrl = (...args) => xnsNodeSeekUrlService.parseSameOriginUrl(...args);
const isAllowedPostRequest = (...args) => xnsNodeSeekUrlService.isAllowedPostRequest(...args);
