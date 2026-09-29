import { SELECTORS } from '../core/config.js';
import { safePositiveInt } from '../core/dom.js';
import { pageInfo } from '../core/runtime.js';
import { getPostInfo, parseSameOriginUrl } from '../nodeseek/url.js';
import type { CommentVirtualizer } from './virtualizer.js';

/** 虚拟列表容器上挂着分页渲染器实例。 */
type VirtualListHost = HTMLElement & { __xnsVirtualizer?: CommentVirtualizer };

/** 楼层导航依赖；测试可注入替身。 */
interface FloorNavigationDeps {
  windowObj: Window & typeof globalThis;
  documentObj: Document;
  selectors: typeof SELECTORS;
  enabled: boolean;
  parseSameOriginUrl: typeof parseSameOriginUrl;
  getPostInfo: typeof getPostInfo;
  safePositiveInt: typeof safePositiveInt;
}

// 楼层导航：只拦截当前帖子的楼层链接，并负责滚动与高亮。
function createFloorNavigation({ windowObj, documentObj, selectors, enabled, parseSameOriginUrl, getPostInfo, safePositiveInt }: FloorNavigationDeps) {
  function scrollToFloor(floor: number | string): boolean {
    let target: Element | null = documentObj.querySelector(`[data-xns-floor="${CSS.escape(String(floor))}"]`);
    if (!target) {
      const virtualLists = Array.from(documentObj.querySelectorAll<VirtualListHost>('.xns-virtual-list'));
      for (const list of virtualLists) {
        target = list.__xnsVirtualizer?.scrollToFloor(floor) || null;
        if (target) break;
      }
    }
    if (!target) return false;
    const element = target;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.remove('xns-floor-highlight');
    windowObj.requestAnimationFrame(() => element.classList.add('xns-floor-highlight'));
    return true;
  }

  function handleFloorClick(event: Event): void {
    const eventTarget = event.target as Partial<Element> | null;
    const link = (eventTarget?.closest?.('a[href]') as HTMLAnchorElement | undefined) || null;
    if (!link || !link.closest(selectors.commentContainer) || link.closest('.xns-remote-floor-link')) return;
    const rawHref = link.getAttribute('href') || '';
    const directMatch = /^#([1-9]\d*)$/.exec(rawHref);
    const linkedUrl = directMatch ? null : parseSameOriginUrl(rawHref);
    const linkedInfo = linkedUrl ? getPostInfo(linkedUrl.href) : null;
    if (linkedInfo && enabled && linkedInfo.postId !== getPostInfo(windowObj.location.href)?.postId) return;
    const match = directMatch || (linkedUrl ? /^#([1-9]\d*)$/.exec(linkedUrl.hash || '') : null);
    if (!match) return;
    const floor = safePositiveInt(match[1]);
    if (floor === null || !scrollToFloor(floor)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  return Object.freeze({ scrollToFloor, handleFloorClick });
}

function createFloorNavigationFeature(options: FloorNavigationDeps) {
  const navigation = createFloorNavigation(options);
  return { handle: navigation.handleFloorClick };
}

const xnsFloorNavigation = createFloorNavigationFeature({
  windowObj: window,
  documentObj: document,
  selectors: SELECTORS,
  enabled: Boolean(pageInfo),
  parseSameOriginUrl,
  getPostInfo,
  safePositiveInt,
});

const handleFloorClick = (event: Event): void => xnsFloorNavigation.handle(event);

export { handleFloorClick };
