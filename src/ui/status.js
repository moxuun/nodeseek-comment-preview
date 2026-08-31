// 分页状态文案与语义统一；预览页和帖子页共享同一套用户可见反馈。
function createPageStatusFormatter({ maxPage, getMaxPage }) {
  function format(options = {}) {
    const configuredLimit = Number(options.pageLimit) || Number(getMaxPage?.()) || maxPage;
    const pageLimit = Math.min(maxPage, Math.max(1, configuredLimit));
    const totalPages = Number(options.totalPages) || 0;
    const loadedPages = Math.max(0, Number(options.loadedPages) || 0);
    const failedCount = Array.isArray(options.failedPages) ? options.failedPages.length : 0;
    const targetPages = Math.min(pageLimit, totalPages || loadedPages);
    const pageProgress = targetPages ? `已读取 ${loadedPages}/${targetPages} 页` : '';
    const stage = options.loading
      ? (pageProgress ? `正在读取其他分页 · ${pageProgress}` : '正在读取其他分页…')
      : pageProgress;
    const failed = failedCount ? `${failedCount} 页读取失败` : '';
    const truncated = options.truncated
      ? `帖子共 ${totalPages || pageLimit} 页，仅读取前 ${pageLimit} 页，后面的内容没有显示`
      : '';
    const detail = [stage, failed, truncated].filter(Boolean).join(' · ');
    const commentCount = Number.isFinite(options.commentCount) ? `${options.commentCount} 条回复` : '';
    const compact = [commentCount, failedCount ? `${failedCount} 页失败` : ''].filter(Boolean).join(' · ') || detail;
    return {
      targetPages,
      loadedPages,
      failedCount,
      stage,
      failed,
      truncated,
      detail,
      compact,
      tone: failedCount ? 'is-failed' : '',
    };
  }

  return Object.freeze({ format });
}

const xnsPageStatusFormatter = createPageStatusFormatter({ maxPage: MAX_PAGE, getMaxPage });
const formatPageStatus = (...args) => xnsPageStatusFormatter.format(...args);
