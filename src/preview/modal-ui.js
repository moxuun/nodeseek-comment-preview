// 预览弹窗 UI 基础设施：锁定页面、滚动控制、关闭操作。
function createPreviewModalUi({ windowObj, documentObj, state, createElement, closeImageLightbox, refreshPreviewModal }) {
  function removeBodyLock() {
    if (!state.modal) documentObj.documentElement.style.removeProperty('overflow');
  }

  function createScrollArrow(points) {
    const svg = documentObj.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const polyline = documentObj.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', points);
    svg.appendChild(polyline);
    return svg;
  }

  function createRefreshArrow() {
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

  function installPreviewScrollButtons(dialog, body) {
    const group = createElement('div', 'xns-preview-scroll-btns');
    const refresh = createElement('button', 'xns-scroll-btn xns-refresh-post');
    refresh.type = 'button';
    refresh.title = '刷新帖子';
    refresh.setAttribute('aria-label', '刷新帖子');
    refresh.appendChild(createRefreshArrow());
    const top = createElement('button', 'xns-scroll-btn xns-to-top');
    top.type = 'button';
    top.title = '回到顶部';
    top.setAttribute('aria-label', '回到顶部');
    top.appendChild(createScrollArrow('18 15 12 9 6 15'));
    const bottom = createElement('button', 'xns-scroll-btn xns-to-bottom');
    bottom.type = 'button';
    bottom.title = '回到底部';
    bottom.setAttribute('aria-label', '回到底部');
    bottom.appendChild(createScrollArrow('6 9 12 15 18 9'));
    const scrollTo = (edge) => {
      const topPosition = edge === 'bottom' ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
      body.scrollTo({ top: topPosition, behavior: 'smooth' });
    };
    top.addEventListener('click', () => scrollTo('top'));
    bottom.addEventListener('click', () => scrollTo('bottom'));
    refresh.addEventListener('click', () => { void refreshPreviewModal(); });
    group.append(refresh, top, bottom);
    dialog.appendChild(group);
    const update = () => {
      const distanceFromBottom = body.scrollHeight - (body.scrollTop + body.clientHeight);
      top.classList.toggle('hidden', body.scrollTop <= 300);
      bottom.classList.toggle('hidden', distanceFromBottom <= 300);
    };
    const cleanup = () => {
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

  function closeModal() {
    closeImageLightbox();
    state.modal?.refreshScrollCleanup?.();
    state.modal?.scrollCleanup?.();
    state.modal?.overlay?.remove();
    state.modal = null;
    removeBodyLock();
  }

  function createCloseButton(onClick) {
    const button = createElement('button', 'xns-modal-close', '×');
    button.type = 'button';
    button.setAttribute('aria-label', '关闭');
    button.addEventListener('click', onClick);
    return button;
  }

  return Object.freeze({ removeBodyLock, installPreviewScrollButtons, closeModal, createCloseButton });
}

const xnsPreviewModalUi = createPreviewModalUi({
  windowObj: window,
  documentObj: document,
  state,
  createElement,
  closeImageLightbox,
  refreshPreviewModal: (...args) => refreshPreviewModal(...args),
});
const removeBodyLock = (...args) => xnsPreviewModalUi.removeBodyLock(...args);
const installPreviewScrollButtons = (...args) => xnsPreviewModalUi.installPreviewScrollButtons(...args);
const closeModal = (...args) => xnsPreviewModalUi.closeModal(...args);
const createCloseButton = (...args) => xnsPreviewModalUi.createCloseButton(...args);
