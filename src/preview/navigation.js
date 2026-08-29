// 楼层导航：只拦截当前帖子的楼层链接，并负责滚动与高亮。
function createFloorNavigation({ windowObj, documentObj, selectors, enabled, parseSameOriginUrl, getPostInfo, safePositiveInt }) {
  function scrollToFloor(floor) {
    let target = documentObj.querySelector(`[data-xns-floor="${CSS.escape(String(floor))}"]`);
    if (!target) {
      const virtualLists = Array.from(documentObj.querySelectorAll('.xns-virtual-list'));
      for (const list of virtualLists) {
        target = list.__xnsVirtualizer?.scrollToFloor(floor) || null;
        if (target) break;
      }
    }
    if (!target) return false;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.remove('xns-floor-highlight');
    windowObj.requestAnimationFrame(() => target.classList.add('xns-floor-highlight'));
    return true;
  }

  function handleFloorClick(event) {
    const link = event.target.closest?.('a[href]');
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

function createFloorNavigationFeature(options) {
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
const handleFloorClick = (...args) => xnsFloorNavigation.handle(...args);
