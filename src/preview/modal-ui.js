// 预览弹窗 UI 基础设施：锁定页面、滚动控制、关闭操作。
function createPreviewModalUi({ windowObj, documentObj, state, createElement, closeImageLightbox }) {
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

  function createRefreshButton(onClick) {
    const button = createElement('button', 'xns-modal-tool xns-refresh-post');
    button.type = 'button';
    button.title = '刷新帖子';
    button.setAttribute('aria-label', '刷新帖子');
    button.append(createRefreshArrow(), createElement('span', 'xns-modal-tool-label', '刷新'));
    button.addEventListener('click', onClick);
    return button;
  }

  function createMoreMenu({ onHelp, onCopyLink, onSettings }) {
    const wrapper = createElement('div', 'xns-modal-more');
    const toggle = createElement('button', 'xns-modal-tool xns-modal-more-toggle', '更多');
    toggle.type = 'button';
    toggle.title = '更多预览操作';
    toggle.setAttribute('aria-label', '更多预览操作');
    toggle.setAttribute('aria-haspopup', 'menu');
    toggle.setAttribute('aria-expanded', 'false');
    const menu = createElement('div', 'xns-modal-more-menu');
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const help = createElement('button', 'xns-modal-more-item', '帮助与快捷键');
    help.type = 'button';
    help.setAttribute('role', 'menuitem');
    const copy = createElement('button', 'xns-modal-more-item', '复制原帖链接');
    copy.type = 'button';
    copy.setAttribute('role', 'menuitem');
    const settings = createElement('button', 'xns-modal-more-item', '设置');
    settings.type = 'button';
    settings.setAttribute('role', 'menuitem');
    menu.append(help, copy, settings);
    wrapper.append(toggle, menu);

    let open = false;
    const setOpen = (next) => {
      open = Boolean(next);
      menu.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    };
    const close = () => setOpen(false);
    const onDocumentClick = (event) => {
      if (!wrapper.contains(event.target)) close();
    };
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(!open);
    });
    help.addEventListener('click', () => {
      close();
      onHelp?.();
    });
    copy.addEventListener('click', () => {
      close();
      onCopyLink?.({ setLabel: (label) => { copy.textContent = label; } });
    });
    settings.addEventListener('click', () => {
      close();
      onSettings?.();
    });
    documentObj.addEventListener('click', onDocumentClick, true);

    return Object.freeze({
      element: wrapper,
      close,
      setCopyLabel: (label) => { copy.textContent = label; },
      destroy: () => documentObj.removeEventListener('click', onDocumentClick, true),
    });
  }

  function installPreviewScrollButtons(dialog, body) {
    const group = createElement('div', 'xns-preview-scroll-btns');
    group.setAttribute('role', 'toolbar');
    group.setAttribute('aria-label', '阅读导航');
    const top = createElement('button', 'xns-scroll-btn xns-to-top');
    top.type = 'button';
    top.title = '回到顶部';
    top.setAttribute('aria-label', '回到顶部');
    top.setAttribute('data-xns-tip', '回到顶部');
    top.appendChild(createScrollArrow('18 15 12 9 6 15'));
    const bottom = createElement('button', 'xns-scroll-btn xns-to-bottom');
    bottom.type = 'button';
    bottom.title = '回到底部';
    bottom.setAttribute('aria-label', '回到底部');
    bottom.setAttribute('data-xns-tip', '回到底部');
    bottom.appendChild(createScrollArrow('6 9 12 15 18 9'));
    const scrollTo = (edge) => {
      const topPosition = edge === 'bottom' ? Math.max(0, body.scrollHeight - body.clientHeight) : 0;
      body.scrollTo({ top: topPosition, behavior: 'smooth' });
    };
    top.addEventListener('click', () => scrollTo('top'));
    bottom.addEventListener('click', () => scrollTo('bottom'));
    group.append(top, bottom);
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
    state.modal?.requestController?.abort();
    state.modal?.featureCleanup?.();
    state.modal?.moreMenu?.destroy?.();
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
    button.title = '关闭预览（Esc）';
    button.addEventListener('click', onClick);
    return button;
  }

  return Object.freeze({ removeBodyLock, installPreviewScrollButtons, closeModal, createCloseButton, createRefreshButton, createMoreMenu });
}

const xnsPreviewModalUi = createPreviewModalUi({
  windowObj: window,
  documentObj: document,
  state,
  createElement,
  closeImageLightbox,
});
const removeBodyLock = (...args) => xnsPreviewModalUi.removeBodyLock(...args);
const installPreviewScrollButtons = (...args) => xnsPreviewModalUi.installPreviewScrollButtons(...args);
const closeModal = (...args) => xnsPreviewModalUi.closeModal(...args);
const createCloseButton = (...args) => xnsPreviewModalUi.createCloseButton(...args);
const createRefreshButton = (...args) => xnsPreviewModalUi.createRefreshButton(...args);
const createMoreMenu = (...args) => xnsPreviewModalUi.createMoreMenu(...args);
