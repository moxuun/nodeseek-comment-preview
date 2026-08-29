// NodeSeek SSR 状态读取。只负责读取页面已经提供的 JSON，不访问会话存储。
function createSsrStateService({ documentObj, qs }) {
  function extractSsrState(doc) {
    try {
      const script = qs(doc, '#temp-script[type="application/json"]');
      const encoded = script?.textContent?.trim();
      if (!encoded) return null;
      const json = decodeURIComponent(escape(atob(encoded)));
      const data = JSON.parse(json);
      // 列表页通常只有 user，没有 postData.comments；身份服务也需要读取这种状态。
      // 帖子统计仍由调用方检查 postData.comments，不把列表状态当成评论状态使用。
      return data && typeof data === 'object' && (
        data.user !== undefined
        || (data.postData && Array.isArray(data.postData.comments))
      ) ? data : null;
    } catch { return null; }
  }

  function getDocState(root) { return root && root !== documentObj ? root.__xnsState || null : null; }

  return Object.freeze({ extractSsrState, getDocState });
}

const xnsSsrStateService = createSsrStateService({ documentObj: document, qs });
const extractSsrState = (...args) => xnsSsrStateService.extractSsrState(...args);
const getDocState = (...args) => xnsSsrStateService.getDocState(...args);
