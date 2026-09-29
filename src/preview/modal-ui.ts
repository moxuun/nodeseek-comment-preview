import { state } from '../core/config.js';
import { createElement } from '../core/dom.js';
import { closeImageLightbox } from './lightbox.js';
import { destroyVirtualLists } from './virtualizer.js';

/** 弹窗句柄；由 preview controller 写入 state.modal，关闭路径与全局事件读取。 */
interface PreviewModalHandle {
  requestController?: { abort: () => void } | null;
  replySyncController?: { abort: () => void } | null;
  featureCleanup?: () => void;
  refreshScrollCleanup?: () => void;
  scrollCleanup?: () => void;
  overlay?: Element | null;
  body?: Element | null;
}

/** 分享按钮的点击回调，回调里可以改按钮文案。 */
type ShareClickHandler = (helpers: { setLabel: (value: string) => void }) => void;

interface PreviewModalUiDeps {
  windowObj: Window & typeof globalThis;
  documentObj: Document;
  state: { modal: unknown };
  createElement: typeof createElement;
  closeImageLightbox: () => void;
}

// 预览弹窗 UI 基础设施：锁定页面、滚动控制、关闭操作。
function createPreviewModalUi({ windowObj, documentObj, state, createElement, closeImageLightbox }: PreviewModalUiDeps) {
  function removeBodyLock(): void {
    if (!state.modal) documentObj.documentElement.style.removeProperty('overflow');
  }

  function createScrollArrow(points: string): SVGElement {
    const svg = documentObj.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const polyline = documentObj.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points);
    svg.appendChild(polyline);
    return svg;
  }

  function createRefreshArrow(): SVGElement {
    const svg = documentObj.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = documentObj.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M20 11a8 8 0 1 1-2.34-5.66');
    const polyline = documentObj.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', '20 4 20 11 13 11');
    svg.append(path, polyline);
    return svg;
  }

  function createRefreshButton(onClick: () => void): HTMLButtonElement {
    const button = createElement('button', 'xns-modal-tool xns-refresh-post') as HTMLButtonElement;
    button.type = 'button';
    button.title = '刷新帖子';
    button.setAttribute('aria-label', '刷新帖子');
    button.append(createRefreshArrow(), createElement('span', 'xns-modal-tool-label', '刷新'));
    button.addEventListener('click', onClick);
    return button;
  }

  function createShareButton(onClick?: ShareClickHandler): HTMLButtonElement {
    const button = createElement('button', 'xns-modal-tool xns-modal-share') as HTMLButtonElement;
    button.type = 'button';
    button.title = '复制帖子链接';
    button.setAttribute('aria-label', '复制帖子链接');
    const label = createElement('span', 'xns-modal-tool-label', '分享');
    button.append(createCopyIcon(), label);
    button.addEventListener('click', () => {
      onClick?.({ setLabel: (value) => { label.textContent = value; } });
    });
    return button;
  }

  function createCopyIcon(): SVGElement {
    const svg = documentObj.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const back = documentObj.createElementNS('http://www.w3.org/2000/svg', 'rect');
    back.setAttribute('x', '5');
    back.setAttribute('y', '5');
    back.setAttribute('width', '11');
    back.setAttribute('height', '13');
    back.setAttribute('rx', '2');
    const front = documentObj.createElementNS('http://www.w3.org/2000/svg', 'path');
    front.setAttribute('d', 'M9 5V4a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2');
    svg.append(back, front);
    return svg;
  }

  function installPreviewScrollButtons(dialog: Element, body: Element): () => void {
    const group = createElement('div', 'xns-preview-scroll-btns');
    group.setAttribute('role', 'toolbar');
    group.setAttribute('aria-label', '阅读导航');
    const top = createElement('button', 'xns-scroll-btn xns-to-top') as HTMLButtonElement;
    top.type = 'button';
    top.title = '回到顶部';
    top.setAttribute('aria-label', '回到顶部');
    top.setAttribute('data-xns-tip', '回到顶部');
    top.appendChild(createScrollArrow('18 15 12 9 6 15'));
    const bottom = createElement('button', 'xns-scroll-btn xns-to-bottom') as HTMLButtonElement;
    bottom.type = 'button';
    bottom.title = '回到底部';
    bottom.setAttribute('aria-label', '回到底部');
    bottom.setAttribute('data-xns-tip', '回到底部');
    bottom.appendChild(createScrollArrow('6 9 12 15 18 9'));
    const scrollTo = (edge: 'top' | 'bottom'): void => {
      const topPosition = edge === 'bottom' ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
      body.scrollTo({ top: topPosition, behavior: 'smooth' });
    };
    top.addEventListener('click', () => scrollTo('top'));
    bottom.addEventListener('click', () => scrollTo('bottom'));
    group.append(top, bottom);
    dialog.appendChild(group);
    const update = (): void => {
      const distanceFromBottom = body.scrollHeight - (body.scrollTop + body.clientHeight);
      top.classList.toggle('hidden', body.scrollTop <= 300);
      bottom.classList.toggle('hidden', distanceFromBottom <= 300);
    };
    const cleanup = (): void => {
      body.removeEventListener('scroll', update);
      windowObj.removeEventListener('resize', update);
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      group.remove();
    };
    const mutationObserver = windowObj.MutationObserver ? new windowObj.MutationObserver(update) : null;
    const resizeObserver = windowObj.ResizeObserver ? new windowObj.ResizeObserver(update) : null;
    body.addEventListener('scroll', update, { passive: true });
    windowObj.addEventListener('resize', update, { passive: true });
    mutationObserver?.observe(body, { childList: true, subtree: true });
    resizeObserver?.observe(body);
    windowObj.setTimeout(update, 0);
    update();
    return cleanup;
  }

  function closeModal(): void {
    closeImageLightbox();
    const modal = state.modal as PreviewModalHandle | null;
    modal?.requestController?.abort();
    modal?.replySyncController?.abort();
    modal?.featureCleanup?.();
    modal?.refreshScrollCleanup?.();
    modal?.scrollCleanup?.();
    // 关闭前显式销毁还在跑的虚拟列表：它取消待执行的 rAF 并断开 ResizeObserver。
    if (modal?.body) destroyVirtualLists(modal.body);
    modal?.overlay?.remove();
    state.modal = null;
    removeBodyLock();
  }

  function createCloseButton(onClick: () => void): HTMLButtonElement {
    const button = createElement('button', 'xns-modal-close', '×') as HTMLButtonElement;
    button.type = 'button';
    button.setAttribute('aria-label', '关闭');
    button.title = '关闭预览（Esc）';
    button.addEventListener('click', onClick);
    return button;
  }

  return Object.freeze({ removeBodyLock, installPreviewScrollButtons, closeModal, createCloseButton, createRefreshButton, createShareButton });
}

const xnsPreviewModalUi = createPreviewModalUi({
  windowObj: window,
  documentObj: document,
  state,
  createElement,
  closeImageLightbox,
});
const closeModal = (): void => xnsPreviewModalUi.closeModal();
const createCloseButton = (onClick: () => void): HTMLButtonElement => xnsPreviewModalUi.createCloseButton(onClick);
const createRefreshButton = (onClick: () => void): HTMLButtonElement => xnsPreviewModalUi.createRefreshButton(onClick);
const createShareButton = (onClick?: ShareClickHandler): HTMLButtonElement => xnsPreviewModalUi.createShareButton(onClick);
const installPreviewScrollButtons = (dialog: Element, body: Element): (() => void) => xnsPreviewModalUi.installPreviewScrollButtons(dialog, body);

export { closeModal, createCloseButton, createRefreshButton, createShareButton, installPreviewScrollButtons };
export type { PreviewModalHandle };
