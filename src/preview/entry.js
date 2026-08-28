// 预览入口只负责识别“列表里的帖子标题”。
// 它不处理请求、弹窗内容或任何写操作，便于单独验证拦截范围。
function createPreviewEntryController({ document, location, parseSameOriginUrl, getPostInfo, openPreviewModal }) {
  const titleSelectors = [
    'h3 a[href]',
    '.post-item > a[href]',
    '.post-item h3 a[href]',
    '.post-list-item > a[href]',
    '.post-list-item h3 a[href]',
    '.post-list-item .post-title a[href]',
    '.topic-item h3 a[href]',
    '.topic-title a[href]',
  ];

  function isListTitle(link) {
    if (!link?.matches?.(titleSelectors.join(', '))) return false;
    return Boolean(link.closest('main, .post-list, .post-item, .post-list-item, .topic-item, .topic-title, h3'));
  }

  function handle(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (getPostInfo(location.href) || event.target.closest?.('.xns-overlay')) return;

    const link = event.target.closest?.('a[href]');
    if (!link || !isListTitle(link)) return;
    const url = parseSameOriginUrl(link.getAttribute('href') || '');
    if (!url || !getPostInfo(url.href)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openPreviewModal(url, link);
  }

  return Object.freeze({ handle, isListTitle });
}

function createFloorNavigationController({ enabled, handleFloorClick }) {
  function handle(event) {
    if (!enabled || event.defaultPrevented) return;
    handleFloorClick(event);
  }

  return Object.freeze({ handle });
}
