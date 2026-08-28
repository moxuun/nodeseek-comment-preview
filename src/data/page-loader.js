// 帖子分页读取服务。
// 只负责“读哪些页、如何并发、如何合并”，不创建 DOM，也不决定如何展示失败。
function createPageLoader({ windowObj, maxPage, concurrency, fetchHtml, parseHtml, getPageNumbers, getCommentItems, getCommentRecord, getDocState, getCurrentUserUid }) {
  function collectPageRecords(info, root, page) {
    const state = getDocState(root);
    return getCommentItems(root)
      .map((item, index) => getCommentRecord(item, info.postId, page, index, false, { keepCommentMenu: true, state, getCurrentUserUid }))
      .filter(Boolean);
  }

  async function fetchPostPages(info, firstDocument, options = {}) {
    const noStore = options.noStore !== false;
    const pageDocs = new Map([[info.page, firstDocument]]);
    const failedPages = [];
    const pages = new Set([info.page]);
    const discovered = getPageNumbers(firstDocument, info.postId);
    const totalPages = discovered.size ? Math.max(...discovered, info.page) : info.page;
    const truncated = totalPages > maxPage;

    discovered.forEach((page) => {
      if (page <= maxPage) pages.add(page);
    });
    const maxSeed = truncated ? maxPage : Math.min(maxPage, Math.max(...pages));
    for (let page = 1; page <= maxSeed; page += 1) pages.add(page);
    pages.delete(info.page);

    const pending = Array.from(pages).sort((a, b) => a - b);
    const worker = async () => {
      while (pending.length) {
        if (options.isAborted?.()) return;
        const page = pending.shift();
        if (page === undefined || pageDocs.has(page)) continue;
        try {
          const { html } = await fetchHtml(new URL(`/post-${info.postId}-${page}`, windowObj.location.origin), { noStore });
          const parsed = parseHtml(html);
          pageDocs.set(page, parsed);
          getPageNumbers(parsed, info.postId).forEach((foundPage) => {
            if (foundPage <= maxPage && !pages.has(foundPage) && foundPage !== info.page) {
              pages.add(foundPage);
              pending.push(foundPage);
            }
          });
        } catch {
          failedPages.push(page);
        }
      }
    };

    const workerCount = Math.min(concurrency, Math.max(1, pending.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return { pageDocs, failedPages, truncated, totalPages };
  }

  async function loadPreviewRecords(info, firstDocument, options = {}) {
    const { pageDocs, failedPages, truncated, totalPages } = await fetchPostPages(info, firstDocument, options);
    const allRecords = [];
    pageDocs.forEach((root, page) => allRecords.push(...collectPageRecords(info, root, page)));
    const unique = new Map();
    allRecords.forEach((record) => {
      if (!unique.has(record.floor)) unique.set(record.floor, record);
    });
    return {
      records: Array.from(unique.values()),
      loadedPages: pageDocs.size,
      failedPages,
      truncated,
      totalPages,
    };
  }

  return Object.freeze({ collectPageRecords, fetchPostPages, loadPreviewRecords });
}

const xnsPageLoader = createPageLoader({
  windowObj: window,
  maxPage: MAX_PAGE,
  concurrency: PAGE_CONCURRENCY,
  fetchHtml,
  parseHtml,
  getPageNumbers,
  getCommentItems,
  getCommentRecord,
  getDocState,
  getCurrentUserUid,
});
const collectPageRecords = (...args) => xnsPageLoader.collectPageRecords(...args);
const fetchPostPages = (...args) => xnsPageLoader.fetchPostPages(...args);
const loadPreviewRecords = (...args) => xnsPageLoader.loadPreviewRecords(...args);
