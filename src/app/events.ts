import { state } from '../core/config.js';
import { qsa } from '../core/dom.js';
import { getActionContext, getMenuActionKey, runPreviewAction } from '../features/comment-actions.js';
import type { PreviewActionContext, PreviewActionKey } from '../features/comment-actions.js';
import { closeImageLightbox } from '../preview/lightbox.js';
import { closeModal } from '../preview/modal-ui.js';

/** 全局事件边界依赖；写操作状态槽的具体类型由各自写入方决定。 */
interface AppEventsDeps {
  state: {
    post: unknown;
    modal: unknown;
    settingsPanel: unknown;
    lightbox: unknown;
  };
  qsa: typeof qsa;
  getMenuActionKey: (menuItem: Element) => PreviewActionKey | '';
  getActionContext: (menuItem: Element | null) => PreviewActionContext;
  runPreviewAction: (action: PreviewActionKey, menuItem: Element, comment: Element | null, context: PreviewActionContext | null) => unknown;
  closeImageLightbox: () => void;
  closeModal: () => void;
}

// 全局事件边界：把站点原生点击与脚本接管的预览动作分开。
function createAppEvents({ state, qsa, getMenuActionKey, getActionContext, runPreviewAction, closeImageLightbox, closeModal }: AppEventsDeps) {
  function handlePreviewActionClick(event: Event): void {
    const eventTarget = event.target as Partial<Element> | null;
    const menuItem = (eventTarget?.closest?.('.xns-preview-menu > .menu-item') as HTMLElement | undefined) || null;
    if (!menuItem) return;
    const inPreview = Boolean(menuItem.closest('.xns-overlay .xns-preview-content'));
    const inPost = Boolean(menuItem.closest('.comment-container'));
    if (!inPreview && !inPost) return;
    const comment = menuItem.closest('.content-item');
    const action = (menuItem.dataset.xnsAction || getMenuActionKey(menuItem)) as PreviewActionKey | '';
    if (!comment) return;
    // 官方帖子页的“编辑”由 NodeSeek/Vue 处理。虚拟列表裁掉同级楼层后，
    // Vue 的事件状态可能失效；先恢复官方列表，再重新触发一次原生入口。
    if (inPost && !action && (menuItem.textContent || '').trim() === '编辑') {
      const post = state.post as { prepareNativeEdit?: (comment: Element) => boolean } | null;
      if (post?.prepareNativeEdit?.(comment)) {
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

  function handleKeydown(event: KeyboardEvent): void {
    const eventTarget = event.target as Partial<Element> | null;
    const menuItem = (eventTarget?.closest?.('.xns-preview-menu > .menu-item') as HTMLElement | undefined) || null;
    if (menuItem && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      menuItem.click();
      return;
    }
    const inEditor = eventTarget?.closest?.('textarea, input, [contenteditable="true"]');
    if (event.key !== 'Escape') return;
    if (inEditor) return;
    if (state.settingsPanel) {
      event.preventDefault();
      const panel = state.settingsPanel as { close?: () => void };
      panel.close?.();
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

const handlePreviewActionClick = (event: Event): void => xnsAppEvents.handlePreviewActionClick(event);
const handleKeydown = (event: KeyboardEvent): void => xnsAppEvents.handleKeydown(event);

export { handleKeydown, handlePreviewActionClick };
