// 评论虚拟列表：保留完整评论记录，只把视口附近的楼层物化成 DOM。
// 它不读取网络，也不改变楼层关系；帖子页和预览弹窗共用同一套窗口模型。

import type { ThreadLines } from '../comments/thread.js';

/** 楼层记录或楼层记录中虚拟列表关心的字段。 */
interface VirtualEntryRecord {
  postId?: string | number | null;
  floor?: number | string | null;
}

/** 虚拟列表条目：`{ record, depth }`，`index` 由 `setEntries` 写入；`thread` 是 flattenReplyTree 附带的楼层关系线几何。 */
interface CommentVirtualEntry extends VirtualEntryRecord {
  record?: VirtualEntryRecord | null;
  depth?: number;
  thread?: ThreadLines | null;
  index?: number;
}

type VirtualizerViewport = Element | Window;

type RenderItem = (entry: CommentVirtualEntry, index: number) => HTMLElement | null;
type MountHook = (node: HTMLElement, entry: CommentVirtualEntry, index: number) => void;
type PinnedHook = (node: HTMLElement, entry: CommentVirtualEntry, index: number) => boolean;
type GetViewport = () => VirtualizerViewport | null;

/** 挂载了虚拟列表实例的宿主元素。 */
type VirtualizerHost = HTMLElement & { __xnsVirtualizer?: CommentVirtualizer };

type CreateElement = (tagName: string, className?: string, text?: string) => HTMLElement;

/** 允许注入测试替身的最小 window 契约。 */
interface VirtualizerWindow extends Window {
  ResizeObserver?: typeof ResizeObserver;
}

interface VirtualizerOptions {
  windowObj: VirtualizerWindow;
  documentObj: Document;
  createElement: CreateElement;
  estimatedHeight?: number;
  overscanScreens?: number;
}

interface VirtualizerSetupOptions {
  renderItem?: RenderItem;
  onMount?: MountHook;
  onUnmount?: MountHook;
  isPinned?: PinnedHook;
  getViewport?: GetViewport;
}

interface CommentVirtualizer {
  mount(host: VirtualizerHost, options?: VirtualizerSetupOptions): CommentVirtualizer;
  setEntries(entries: CommentVirtualEntry[] | null | undefined, options?: VirtualizerSetupOptions): void;
  scrollToIndex(index: number, behavior?: ScrollBehavior): HTMLElement | null;
  scrollToFloor(floor: number | string): HTMLElement | null;
  destroy(): void;
}

function createCommentVirtualizer({
  windowObj,
  documentObj,
  createElement,
  estimatedHeight = 150,
  overscanScreens = 2,
}: VirtualizerOptions): CommentVirtualizer {
  let host: VirtualizerHost | null = null;
  let entries: CommentVirtualEntry[] = [];
  let renderItem: RenderItem | null = null;
  let onMount: MountHook | null = null;
  let onUnmount: MountHook | null = null;
  let isPinned: PinnedHook | null = null;
  let getViewport: GetViewport | null = null;
  let viewport: VirtualizerViewport | null = null;
  let frame = 0;
  let destroyed = false;
  let forceIndex: number | null = null;
  const mounted = new Map<number, HTMLElement>();
  const heights = new Map<string, number>();

  const keyOf = (entry: CommentVirtualEntry | null | undefined): string => {
    const record = entry?.record || entry;
    return `${record?.postId || ''}:${record?.floor ?? ''}`;
  };

  const isWindowViewport = (value: VirtualizerViewport | null | undefined): value is Window =>
    !value || value === windowObj || value === windowObj.window;

  function getHeight(index: number): number {
    return Math.max(1, Number(heights.get(keyOf(entries[index]))) || Number(estimatedHeight) || 1);
  }

  function sumHeights(start: number, end: number): number {
    let total = 0;
    for (let index = Math.max(0, start); index < Math.min(entries.length, end); index += 1) total += getHeight(index);
    return total;
  }

  function findIndexAtOffset(offset: number): number {
    const target = Math.max(0, Number(offset) || 0);
    let passed = 0;
    for (let index = 0; index < entries.length; index += 1) {
      const next = passed + getHeight(index);
      if (target < next) return index;
      passed = next;
    }
    return entries.length;
  }

  function resolveViewport(): VirtualizerViewport {
    const next = typeof getViewport === 'function' ? getViewport() : viewport;
    return next || windowObj;
  }

  function getHostOffset(nextViewport: VirtualizerViewport): number {
    if (isWindowViewport(nextViewport)) {
      return (host?.getBoundingClientRect?.().top || 0) + (Number(windowObj.scrollY) || 0);
    }
    const scrollTop = Math.max(0, Number(nextViewport.scrollTop) || 0);
    const hostRect = host?.getBoundingClientRect?.();
    const viewportRect = nextViewport.getBoundingClientRect?.();
    if (!hostRect || !viewportRect) return Math.max(0, Number(host?.offsetTop) || 0);
    return Math.max(0, hostRect.top - viewportRect.top - (Number(nextViewport.clientTop) || 0) + scrollTop);
  }

  function getViewportMetrics(): { start: number; end: number; height: number } {
    const nextViewport = resolveViewport();
    if (nextViewport !== viewport) bindViewport(nextViewport);
    if (isWindowViewport(nextViewport)) {
      const scrollTop = Number(windowObj.scrollY) || 0;
      const hostTop = getHostOffset(nextViewport);
      const height = Math.max(1, Number(windowObj.innerHeight) || 800);
      return { start: Math.max(0, scrollTop - hostTop), end: Math.max(0, scrollTop - hostTop) + height, height };
    }
    const height = Math.max(1, Number(nextViewport.clientHeight) || 800);
    const scrollTop = Math.max(0, Number(nextViewport.scrollTop) || 0);
    const start = Math.max(0, scrollTop - getHostOffset(nextViewport));
    return { start, end: start + height, height };
  }

  function createSpacer(height: number): HTMLElement {
    const spacer = createElement('li', 'xns-virtual-spacer');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.style.height = `${Math.max(0, Math.round(height))}px`;
    return spacer;
  }

  function defaultPinned(node: HTMLElement | null): boolean {
    if (!node) return false;
    if (node.hasAttribute('data-xns-pinned')) return true;
    if (node.querySelector('.xns-preview-composer, [aria-expanded="true"]')) return true;
    return Array.from(node.querySelectorAll('video')).some((video) => !video.paused);
  }

  function scheduleRender(): void {
    if (destroyed || frame) return;
    frame = windowObj.requestAnimationFrame(() => {
      frame = 0;
      renderWindow();
    });
  }

  function measureNode(node: HTMLElement | null): number {
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

  const resizeObserver: ResizeObserver | null = typeof windowObj.ResizeObserver === 'function'
    ? new windowObj.ResizeObserver((observations) => {
      let changed = false;
      observations.forEach((observation) => {
        const index = Array.from(mounted.entries()).find(([, node]) => node === observation.target)?.[0];
        if (index === undefined) return;
        const key = keyOf(entries[index]);
        const height = measureNode(observation.target as HTMLElement);
        if (Math.abs((heights.get(key) || 0) - height) > 1) {
          heights.set(key, height);
          changed = true;
        }
      });
      if (changed) scheduleRender();
    })
    : null;

  function unmount(index: number): void {
    const node = mounted.get(index);
    if (!node) return;
    resizeObserver?.unobserve(node);
    mounted.delete(index);
    onUnmount?.(node, entries[index], index);
  }

  function renderWindow(): void {
    if (destroyed || !host) return;
    if (!entries.length) {
      mounted.forEach((_, index) => unmount(index));
      host.replaceChildren();
      return;
    }
    const metrics = getViewportMetrics();
    const overscan = Math.max(metrics.height, metrics.height * Math.max(0, Number(overscanScreens) || 0));
    let start = findIndexAtOffset(metrics.start - overscan);
    let end = findIndexAtOffset(metrics.end + overscan) + 1;
    if (start >= entries.length) start = Math.max(0, entries.length - 1);
    end = Math.min(entries.length, Math.max(start + 1, end));
    const pin = typeof isPinned === 'function' ? isPinned : defaultPinned;
    const desired = new Set<number>();
    for (let index = start; index < end; index += 1) desired.add(index);
    // 只额外加入被楼层导航命中的一个目标，不把目标与顶部窗口之间的
    // 所有评论都物化出来。
    if (forceIndex !== null && forceIndex >= 0 && forceIndex < entries.length) desired.add(forceIndex);
    mounted.forEach((node, index) => { if (pin(node, entries[index], index)) desired.add(index); });
    mounted.forEach((_, index) => { if (!desired.has(index)) unmount(index); });

    const newlyMounted: Array<{ index: number; node: HTMLElement }> = [];
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

  function bindViewport(nextViewport: VirtualizerViewport): void {
    if (nextViewport === viewport) return;
    if (viewport?.removeEventListener) {
      viewport.removeEventListener('scroll', scheduleRender);
      viewport.removeEventListener('load', scheduleRender, true);
      viewport.removeEventListener('error', scheduleRender, true);
    }
    viewport = nextViewport || windowObj;
    viewport?.addEventListener?.('scroll', scheduleRender, { passive: true });
    // 预览正文位于虚拟列表之前。长图完成加载后列表的内容坐标会变化，
    // load/error 不冒泡，因此使用捕获阶段重新计算活动窗口。
    viewport?.addEventListener?.('load', scheduleRender, true);
    viewport?.addEventListener?.('error', scheduleRender, true);
  }

  function setEntries(nextEntries: CommentVirtualEntry[] | null | undefined, options: VirtualizerSetupOptions = {}): void {
    if (destroyed) return;
    if (typeof options.renderItem === 'function') renderItem = options.renderItem;
    if (typeof options.onMount === 'function') onMount = options.onMount;
    if (typeof options.onUnmount === 'function') onUnmount = options.onUnmount;
    if (typeof options.isPinned === 'function') isPinned = options.isPinned;
    if (typeof options.getViewport === 'function') getViewport = options.getViewport;
    const normalized: CommentVirtualEntry[] = Array.isArray(nextEntries)
      ? nextEntries.map((entry, index) => ({ ...entry, index }))
      : [];
    const nextKeys = new Set(normalized.map((entry) => keyOf(entry)));
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

  function mount(nextHost: VirtualizerHost, options: VirtualizerSetupOptions = {}): CommentVirtualizer {
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

  function scrollToIndex(index: number, behavior: ScrollBehavior = 'smooth'): HTMLElement | null {
    if (!host || index < 0 || index >= entries.length) return null;
    forceIndex = index;
    renderWindow();
    const nextViewport = resolveViewport();
    const offset = sumHeights(0, index);
    if (isWindowViewport(nextViewport)) {
      const top = getHostOffset(nextViewport) + offset;
      windowObj.scrollTo?.({ top, behavior });
    } else {
      nextViewport.scrollTo?.({ top: getHostOffset(nextViewport) + offset, behavior });
    }
    forceIndex = null;
    scheduleRender();
    return mounted.get(index) || null;
  }

  function scrollToFloor(floor: number | string): HTMLElement | null {
    const index = entries.findIndex((entry) => String(entry.record?.floor) === String(floor));
    // 先同步定位并物化目标，再由调用方负责高亮；否则平滑滚动尚未改变
    // scrollTop 时，下一帧可能把刚物化的目标误判为屏外节点。
    return index < 0 ? null : scrollToIndex(index, 'auto');
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    if (frame) windowObj.cancelAnimationFrame(frame);
    if (viewport?.removeEventListener) {
      viewport.removeEventListener('scroll', scheduleRender);
      viewport.removeEventListener('load', scheduleRender, true);
      viewport.removeEventListener('error', scheduleRender, true);
    }
    resizeObserver?.disconnect();
    mounted.forEach((_, index) => unmount(index));
    mounted.clear();
    if (host?.__xnsVirtualizer === api) delete host.__xnsVirtualizer;
    host?.classList.remove('xns-virtual-list');
    host?.removeAttribute('data-xns-virtual-count');
    host?.replaceChildren();
  }

  const api: CommentVirtualizer = Object.freeze({ mount, setEntries, scrollToIndex, scrollToFloor, destroy });
  return api;
}

/**
 * 销毁 root 里仍在运行的虚拟列表。
 * 虚拟列表把实例写在自己的挂载目标上（目标带 .xns-virtual-list 类），正文整体换新或弹窗关闭时
 * 必须调用一次：它的 scroll/load/error 监听挂在长期存在的视口容器上，ResizeObserver 也还盯着旧节点，
 * 不销毁就会随每次刷新累积，之后每次滚动都白白重排一份已经脱离文档的列表。
 */
function destroyVirtualLists(root: ParentNode | null | undefined): void {
  if (!root) return;
  root.querySelectorAll<VirtualizerHost>('.xns-virtual-list').forEach((host) => {
    host.__xnsVirtualizer?.destroy();
  });
}

export { createCommentVirtualizer, destroyVirtualLists };
export type { CommentVirtualEntry, CommentVirtualizer, VirtualizerSetupOptions, VirtualizerViewport };
