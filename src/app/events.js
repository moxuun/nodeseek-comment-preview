// 全局事件边界：把站点原生点击与脚本接管的预览动作分开。
function createAppEvents({ state, qsa, getMenuActionKey, getActionContext, runPreviewAction, closeImageLightbox, closeModal }) {
  function handlePreviewActionClick(event) {
    const menuItem = event.target.closest?.('.xns-preview-menu > .menu-item');
    if (!menuItem) return;
    const inPreview = Boolean(menuItem.closest('.xns-overlay .xns-preview-content'));
    const inPost = Boolean(menuItem.closest('.comment-container'));
    if (!inPreview && !inPost) return;
    const comment = menuItem.closest('.content-item');
    const action = menuItem.dataset.xnsAction || getMenuActionKey(menuItem);
    if (!comment) return;
    // 官方帖子页的“编辑”由 NodeSeek/Vue 处理。虚拟列表裁掉同级楼层后，
    // Vue 的事件状态可能失效；先恢复官方列表，再重新触发一次原生入口。
    if (inPost && !action && (menuItem.textContent || '').trim() === '编辑') {
      if (state.post?.prepareNativeEdit?.(comment)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void runPreviewAction(action, menuItem, comment, getActionContext(menuItem));
  }

  function handleKeydown(event) {
    const menuItem = event.target.closest?.('.xns-preview-menu > .menu-item');
    if (menuItem && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      menuItem.click();
      return;
    }
    const inEditor = event.target.closest?.('textarea, input, [contenteditable="true"]');
    if (event.key !== 'Escape') return;
    if (inEditor) return;
    if (state.settingsPanel) {
      event.preventDefault();
      state.settingsPanel.close?.();
      return;
    }
    if (state.lightbox) {
      event.preventDefault();
      closeImageLightbox();
    } else if (state.modal) {
      closeModal();
    }
  }

  return Object.freeze({ handlePreviewActionClick, handleKeydown });
}

const xnsAppEvents = createAppEvents({
  state,
  qsa,
  getMenuActionKey,
  getActionContext,
  runPreviewAction,
  closeImageLightbox,
  closeModal,
});
const handlePreviewActionClick = (...args) => xnsAppEvents.handlePreviewActionClick(...args);
const handleKeydown = (...args) => xnsAppEvents.handleKeydown(...args);
