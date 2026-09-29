import type { getPostInfo, parseSameOriginUrl } from '../nodeseek/url.js';

/** 预览入口依赖；DOM、URL 解析和弹窗打开都由外部注入，便于单独验证拦截范围。 */
interface PreviewEntryDeps {
  document: Document;
  location: Location;
  parseSameOriginUrl: typeof parseSameOriginUrl;
  getPostInfo: typeof getPostInfo;
  openPreviewModal: (url: URL, link: Element) => void;
}

/** 楼层跳转控制器依赖；`enabled` 只在帖子页为真。 */
interface FloorNavigationControllerDeps {
  enabled: boolean;
  handleFloorClick: (event: Event) => void;
}

// 预览入口只负责识别“列表里的帖子标题”。
// 它不处理请求、弹窗内容或任何写操作，便于单独验证拦截范围。
function createPreviewEntryController({ document, location, parseSameOriginUrl, getPostInfo, openPreviewModal }: PreviewEntryDeps) {
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

  function isListTitle(link: Element | null | undefined): boolean {
    if (!link?.matches?.(titleSelectors.join(', '))) return false;
    return Boolean(link.closest('main, .post-list, .post-item, .post-list-item, .topic-item, .topic-title, h3'));
  }

  function handle(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target as Element | null;
    if (getPostInfo(location.href) || target?.closest?.('.xns-overlay')) return;

    const link = target?.closest?.('a[href]') || null;
    if (!link || !isListTitle(link)) return;
    const url = parseSameOriginUrl(link.getAttribute('href') || '');
    if (!url || !getPostInfo(url.href)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openPreviewModal(url, link);
  }

  return Object.freeze({ handle, isListTitle });
}

function createFloorNavigationController({ enabled, handleFloorClick }: FloorNavigationControllerDeps) {
  function handle(event: Event): void {
    if (!enabled || event.defaultPrevented) return;
    handleFloorClick(event);
  }

  return Object.freeze({ handle });
}

export { createFloorNavigationController, createPreviewEntryController };
