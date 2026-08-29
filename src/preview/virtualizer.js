// 评论虚拟列表：保留完整评论记录，只把视口附近的楼层物化成 DOM。
// 它不读取网络，也不改变楼层关系；帖子页和预览弹窗共用同一套窗口模型。
function createCommentVirtualizer({
  windowObj,
  documentObj,
  createElement,
  estimatedHeight = 150,
  overscanScreens = 2,
} = {}) {
  let host = null;
  let entries = [];
  let renderItem = null;
  let onMount = null;
  let onUnmount = null;
  let isPinned = null;
  let getViewport = null;
  let viewport = null;
  let frame = 0;
  let destroyed = false;
  let forceIndex = null;
  const mounted = new Map();
  const heights = new Map();

  const keyOf = (entry) => {
    const record = entry?.record || entry;
    return `${record?.postId || ''}:${record?.floor ?? ''}`;
  };

  const isWindowViewport = (value) => !value || value === windowObj || value === windowObj.window;

  function getHeight(index) {
    return Math.max(1, Number(heights.get(keyOf(entries[index]))) || Number(estimatedHeight) || 1);
  }

  function sumHeights(start, end) {
    let total = 0;
    for (let index = Math.max(0, start); index < Math.min(entries.length, end); index += 1) total += getHeight(index);
    return total;
  }

  function findIndexAtOffset(offset) {
    const target = Math.max(0, Number(offset) || 0);
    let passed = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const next = passed + getHeight(index);
      if (target < next) return index;
      passed = next;
    }
    return entries.length;
  }

  function resolveViewport() {
    const next = typeof getViewport === 'function' ? getViewport() : viewport;
    return next || windowObj;
  }

  function getViewportMetrics() {
    const nextViewport = resolveViewport();
    if (nextViewport !== viewport) bindViewport(nextViewport);
    if (isWindowViewport(nextViewport)) {
      const scrollTop = Number(windowObj.scrollY) || 0;
      const hostTop = (host?.getBoundingClientRect?.().top || 0) + scrollTop;
      const height = Math.max(1, Number(windowObj.innerHeight) || 800);
      return { start: Math.max(0, scrollTop - hostTop), end: Math.max(0, scrollTop - hostTop) + height, height };
    }
    const height = Math.max(1, Number(nextViewport.clientHeight) || 800);
    const scrollTop = Math.max(0, Number(nextViewport.scrollTop) || 0);
    return { start: scrollTop, end: scrollTop + height, height };
  }

  function createSpacer(height) {
    const spacer = createElement('li', 'xns-virtual-spacer');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.height = `${Math.max(0, Math.round(height))}px`;
    return spacer;
  }

  function defaultPinned(node) {
    if (!node) return false;
    if (node.hasAttribute('data-xns-pinned')) return true;
    if (node.querySelector('.xns-preview-composer, [aria-expanded="true"]')) return true;
    return Array.from(node.querySelectorAll('video')).some((video) => !video.paused);
  }

  function scheduleRender() {
    if (destroyed || frame) return;
    frame = windowObj.requestAnimationFrame(() => {
      frame = 0;
      renderWindow();
    });
  }

  function measureNode(node) {
    if (!node?.getBoundingClientRect) return 0;
    const rect = node.getBoundingClientRect();
    let height = rect.height;
    try {
      const style = windowObj.getComputedStyle(node);
      height += Number.parseFloat(style.marginTop) || 0;
      height += Number.parseFloat(style.marginBottom) || 0;
    } catch {
      // 测试替身可能没有 getComputedStyle；此时使用 border box 高度即可。
    }
    return Math.max(1, height);
  }

  const resizeObserver = typeof windowObj.ResizeObserver === 'function'
    ? new windowObj.ResizeObserver((observations) => {
      let changed = false;
      observations.forEach((observation) => {
        const index = Array.from(mounted.entries()).find(([, node]) => node === observation.target)?.[0];
        if (index === undefined) return;
        const key = keyOf(entries[index]);
        const height = measureNode(observation.target);
        if (Math.abs((heights.get(key) || 0) - height) > 1) {
          heights.set(key, height);
          changed = true;
        }
      });
      if (changed) scheduleRender();
    })
    : null;

  function unmount(index) {
    const node = mounted.get(index);
    if (!node) return;
    resizeObserver?.unobserve(node);
    mounted.delete(index);
    onUnmount?.(node, entries[index], index);
  }

  function renderWindow() {
    if (destroyed || !host) return;
    if (!entries.length) {
      mounted.forEach((_, index) => unmount(index));
      host.replaceChildren();
      return;
    }
    const metrics = getViewportMetrics();
    const overscan = Math.max(metrics.height, metrics.height * Math.max(0, Number(overscanScreens) || 0));
    let start = findIndexAtOffset(metrics.start - overscan);
    let end = findIndexAtOffset(metrics.end + overscan);
    if (start >= entries.length) start = Math.max(0, entries.length - 1);
    end = Math.min(entries.length, Math.max(start + 1, end));
    const pin = typeof isPinned === 'function' ? isPinned : defaultPinned;
    const desired = new Set();
    for (let index = start; index < end; index += 1) desired.add(index);
    // 只额外加入被楼层导航命中的一个目标，不把目标与顶部窗口之间的
    // 所有评论都物化出来。
    if (forceIndex !== null && forceIndex >= 0 && forceIndex < entries.length) desired.add(forceIndex);
    mounted.forEach((node, index) => { if (pin(node, entries[index], index)) desired.add(index); });
    mounted.forEach((_, index) => { if (!desired.has(index)) unmount(index); });

    const newlyMounted = [];
    Array.from(desired).sort((a, b) => a - b).forEach((index) => {
      if (mounted.has(index)) return;
      const node = renderItem?.(entries[index], index);
      if (!node) return;
      mounted.set(index, node);
      newlyMounted.push({ index, node });
    });

    const fragment = documentObj.createDocumentFragment();
    let cursor = 0;
    Array.from(desired).sort((a, b) => a - b).forEach((index) => {
      if (index > cursor) fragment.appendChild(createSpacer(sumHeights(cursor, index)));
      const node = mounted.get(index);
      if (node) fragment.appendChild(node);
      cursor = index + 1;
    });
    if (cursor < entries.length) fragment.appendChild(createSpacer(sumHeights(cursor, entries.length)));
    host.replaceChildren(fragment);

    newlyMounted.forEach(({ index, node }) => {
      resizeObserver?.observe(node);
      onMount?.(node, entries[index], index);
      const height = measureNode(node);
      const key = keyOf(entries[index]);
      if (Math.abs((heights.get(key) || 0) - height) > 1) heights.set(key, height);
    });
  }

  function bindViewport(nextViewport) {
    if (nextViewport === viewport) return;
    if (viewport?.removeEventListener) viewport.removeEventListener('scroll', scheduleRender);
    viewport = nextViewport || windowObj;
    viewport?.addEventListener?.('scroll', scheduleRender, { passive: true });
  }

  function setEntries(nextEntries, options = {}) {
    if (destroyed) return;
    if (typeof options.renderItem === 'function') renderItem = options.renderItem;
    if (typeof options.onMount === 'function') onMount = options.onMount;
    if (typeof options.onUnmount === 'function') onUnmount = options.onUnmount;
    if (typeof options.isPinned === 'function') isPinned = options.isPinned;
    if (typeof options.getViewport === 'function') getViewport = options.getViewport;
    const normalized = Array.isArray(nextEntries) ? nextEntries.map((entry, index) => ({ ...entry, index })) : [];
    const nextKeys = new Set(normalized.map(keyOf));
    mounted.forEach((_, index) => {
      const oldKey = keyOf(entries[index]);
      const nextKey = keyOf(normalized[index]);
      if (!nextKeys.has(oldKey) || oldKey !== nextKey) unmount(index);
    });
    entries = normalized;
    host?.classList.add('xns-virtual-list');
    host?.setAttribute('data-xns-virtual-count', String(entries.length));
    renderWindow();
  }

  function mount(nextHost, options = {}) {
    if (destroyed) return api;
    host = nextHost;
    if (typeof options.renderItem === 'function') renderItem = options.renderItem;
    if (typeof options.onMount === 'function') onMount = options.onMount;
    if (typeof options.onUnmount === 'function') onUnmount = options.onUnmount;
    if (typeof options.isPinned === 'function') isPinned = options.isPinned;
    if (typeof options.getViewport === 'function') getViewport = options.getViewport;
    host?.classList.add('xns-virtual-list');
    host?.setAttribute('data-xns-virtual-count', String(entries.length));
    if (host) host.__xnsVirtualizer = api;
    renderWindow();
    return api;
  }

  function scrollToIndex(index, behavior = 'smooth') {
    if (!host || index < 0 || index >= entries.length) return null;
    forceIndex = index;
    renderWindow();
    const nextViewport = resolveViewport();
    const offset = sumHeights(0, index);
    if (isWindowViewport(nextViewport)) {
      const top = (host.getBoundingClientRect?.().top || 0) + (Number(windowObj.scrollY) || 0) + offset;
      windowObj.scrollTo?.({ top, behavior });
    } else {
      nextViewport.scrollTo?.({ top: offset, behavior });
    }
    forceIndex = null;
    scheduleRender();
    return mounted.get(index) || null;
  }

  function scrollToFloor(floor) {
    const index = entries.findIndex((entry) => String(entry.record?.floor) === String(floor));
    // 先同步定位并物化目标，再由调用方负责高亮；否则平滑滚动尚未改变
    // scrollTop 时，下一帧可能把刚物化的目标误判为屏外节点。
    return index < 0 ? null : scrollToIndex(index, 'auto');
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (frame) windowObj.cancelAnimationFrame(frame);
    if (viewport?.removeEventListener) viewport.removeEventListener('scroll', scheduleRender);
    resizeObserver?.disconnect();
    mounted.forEach((_, index) => unmount(index));
    mounted.clear();
    if (host?.__xnsVirtualizer === api) delete host.__xnsVirtualizer;
    host?.classList.remove('xns-virtual-list');
    host?.removeAttribute('data-xns-virtual-count');
    host?.replaceChildren();
  }

  const api = Object.freeze({ mount, setEntries, scrollToIndex, scrollToFloor, destroy });
  return api;
}
