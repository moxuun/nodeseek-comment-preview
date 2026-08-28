// NodeSeek SSR 状态读取。只负责读取页面已经提供的 JSON，不访问会话存储。
function createSsrStateService({ documentObj, qs }) {
  function extractSsrState(doc) {
    try {
      const script = qs(doc, '#temp-script[type="application/json"]');
      const encoded = script?.textContent?.trim();
      if (!encoded) return null;
      const json = decodeURIComponent(escape(atob(encoded)));
      const data = JSON.parse(json);
      return data && data.postData && Array.isArray(data.postData.comments) ? data : null;
    } catch { return null; }
  }

  function getDocState(root) { return root && root !== documentObj ? root.__xnsState || null : null; }

  return Object.freeze({ extractSsrState, getDocState });
}

const xnsSsrStateService = createSsrStateService({ documentObj: document, qs });
const extractSsrState = (...args) => xnsSsrStateService.extractSsrState(...args);
const getDocState = (...args) => xnsSsrStateService.getDocState(...args);
