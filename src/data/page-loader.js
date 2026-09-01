// 帖子分页读取服务。
// 只负责“读哪些页、如何并发、如何合并”，不创建 DOM，也不决定如何展示失败。
function createPageLoader({ windowObj, maxPage, getMaxPage, concurrency, requestGapMs, fetchHtml, parseHtml, getPageNumbers, getCommentItems, getCommentRecord, getDocState, getCurrentUserUid, buildPostUrl }) {
  function createRequestGate(gapMs) {
    const cooldownGap = Number.isFinite(Number(gapMs)) ? Math.max(0, Number(gapMs)) : 0;
    let currentGap = cooldownGap;
    let successStreak = 0;
    let queue = Promise.resolve();
    let nextStartAt = 0;
    async function waitForRequestSlot() {
      const previous = queue;
      let release;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      const delay = Math.max(0, nextStartAt - Date.now());
      if (delay) await new Promise((resolve) => windowObj.setTimeout(resolve, delay));
      nextStartAt = Date.now() + currentGap;
      release();
    }
    function observeResponse(status) {
      if (status === 429 || status >= 500) {
        currentGap = Math.min(1_000, Math.max(cooldownGap, currentGap ? currentGap * 2 : cooldownGap));
        successStreak = 0;
        return;
      }
      if (status >= 200 && status < 300) {
        successStreak += 1;
        if (successStreak >= 8 && currentGap > 0) {
          currentGap = Math.max(cooldownGap, currentGap - 25);
          successStreak = 0;
        }
      }
    }
    return Object.freeze({ waitForRequestSlot, observeResponse });
  }

  function collectPageRecords(info, root, page) {
    const state = getDocState(root);
    return getCommentItems(root)
      .map((item, index) => getCommentRecord(item, info.postId, page, index, false, { keepCommentMenu: true, state, getCurrentUserUid }))
      .filter(Boolean);
  }

  async function fetchPostPages(info, firstDocument, options = {}) {
    const pageLimit = Math.min(maxPage, Math.max(1, Number(options.pageLimit) || Number(getMaxPage?.()) || maxPage));
    const noStore = options.noStore !== false;
    const retainDocuments = options.retainDocuments !== false;
    const pageDocs = retainDocuments ? new Map([[info.page, firstDocument]]) : null;
    const normalizePages = (values) => Array.from(new Set((Array.isArray(values) ? values : [])
      .map((page) => Number(page))
      .filter((page) => Number.isInteger(page) && page >= 1 && page <= pageLimit)));
    const onlyPages = Array.isArray(options.onlyPages) ? normalizePages(options.onlyPages) : null;
    const loadedPages = new Set([info.page, ...normalizePages(options.initialLoadedPages)]);
    const failedPages = new Set(normalizePages(options.initialFailedPages));
    const challengePages = new Set(normalizePages(options.initialChallengePages));
    // 当前打开页即使超过读取上限也要保留，但不能计入“前 N 页”的进度。
    const countedLoadedPages = () => Array.from(loadedPages).filter((page) => page >= 1 && page <= pageLimit).length;
    const pages = new Set([info.page]);
    const discovered = getPageNumbers(firstDocument, info.postId);
    const totalPages = discovered.size ? Math.max(...discovered, info.page) : info.page;
    const truncated = totalPages > pageLimit;

    if (onlyPages) {
      onlyPages.forEach((page) => pages.add(page));
    } else {
      discovered.forEach((page) => {
        if (page <= pageLimit) pages.add(page);
      });
      const maxSeed = truncated ? pageLimit : Math.min(pageLimit, Math.max(...pages));
      for (let page = 1; page <= maxSeed; page += 1) pages.add(page);
    }
    pages.delete(info.page);
    const progressState = () => ({
      loadedPages: countedLoadedPages(),
      failedPages: [...failedPages].sort((a, b) => a - b),
      challengePages: [...challengePages].sort((a, b) => a - b),
      truncated,
      totalPages,
      pageLimit,
    });

    const pending = Array.from(pages).sort((a, b) => a - b);
    const requestGate = createRequestGate(options.requestGapMs ?? requestGapMs);
    options.onPageLoaded?.(info.page, firstDocument, progressState());
    const worker = async () => {
      while (pending.length) {
        if (options.isAborted?.()) return;
        const page = pending.shift();
        if (page === undefined || loadedPages.has(page)) continue;
        try {
          const response = await fetchHtml(buildPostUrl(info.postId, page), {
            noStore,
            allowCache: options.allowCache === true,
            signal: options.signal,
            beforeRequest: requestGate.waitForRequestSlot,
            onResponse: requestGate.observeResponse,
          });
          const parsed = parseHtml(response.html, response.url);
          loadedPages.add(page);
          failedPages.delete(page);
          challengePages.delete(page);
          if (pageDocs) pageDocs.set(page, parsed);
          options.onPageLoaded?.(page, parsed, progressState());
          if (!onlyPages) {
            getPageNumbers(parsed, info.postId).forEach((foundPage) => {
              if (foundPage <= pageLimit && !pages.has(foundPage) && foundPage !== info.page) {
                pages.add(foundPage);
                pending.push(foundPage);
              }
            });
          }
        } catch (error) {
          failedPages.add(page);
          if (error?.code === 'CLOUDFLARE_CHALLENGE') challengePages.add(page);
          else challengePages.delete(page);
          options.onPageFailed?.(page, progressState());
        }
      }
    };

    const workerCount = Math.min(concurrency, Math.max(1, pending.length));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return {
      pageDocs,
      loadedPages: countedLoadedPages(),
      failedPages: [...failedPages].sort((a, b) => a - b),
      challengePages: [...challengePages].sort((a, b) => a - b),
      truncated,
      totalPages,
      pageLimit,
    };
  }

  async function loadPreviewRecords(info, firstDocument, options = {}) {
    const initialRecords = Array.isArray(options.initialRecords) ? options.initialRecords : null;
    const unique = new Map();
    const mergeRecords = (records) => records.forEach((record) => {
      const previous = unique.get(record.floor);
      if (!previous || record.current) unique.set(record.floor, record);
    });
    if (initialRecords) mergeRecords(initialRecords);
    const { loadedPages, failedPages, challengePages, truncated, totalPages, pageLimit } = await fetchPostPages(info, firstDocument, {
      ...options,
      retainDocuments: false,
      onPageLoaded: (page, root, progress) => {
        if (initialRecords && page === info.page) return;
        mergeRecords(collectPageRecords(info, root, page));
        options.onRecordsLoaded?.({
          records: Array.from(unique.values()),
          ...progress,
          page,
          loading: true,
        });
      },
      onPageFailed: (page, progress) => {
        options.onPageFailed?.(page, progress);
        options.onRecordsLoaded?.({
          records: Array.from(unique.values()),
          ...progress,
          page,
          loading: true,
        });
      },
    });
    return {
      records: Array.from(unique.values()),
      loadedPages,
      failedPages,
      challengePages,
      truncated,
      totalPages,
      pageLimit,
    };
  }

  return Object.freeze({ collectPageRecords, fetchPostPages, loadPreviewRecords });
}

const xnsPageLoader = createPageLoader({
  windowObj: window,
  maxPage: MAX_PAGE,
  getMaxPage,
  concurrency: PAGE_CONCURRENCY,
  requestGapMs: PAGE_REQUEST_GAP,
  fetchHtml,
  parseHtml,
  getPageNumbers,
  getCommentItems,
  getCommentRecord,
  getDocState,
  getCurrentUserUid,
  buildPostUrl,
});
const collectPageRecords = (...args) => xnsPageLoader.collectPageRecords(...args);
const fetchPostPages = (...args) => xnsPageLoader.fetchPostPages(...args);
const loadPreviewRecords = (...args) => xnsPageLoader.loadPreviewRecords(...args);
