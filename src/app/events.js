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
    if (!comment || !action) return;
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
    if (event.key === '?' && state.modal && !inEditor) {
      event.preventDefault();
      state.modal.toggleHelp?.();
      return;
    }
    if (event.key !== 'Escape') return;
    if (inEditor) return;
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
