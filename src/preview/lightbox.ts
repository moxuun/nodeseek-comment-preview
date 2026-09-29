import { state } from '../core/config.js';
import { createElement, getSafeUrlAttribute, qsa } from '../core/dom.js';

/** 灯箱实例；写入 state.lightbox，供 ESC 与全局事件关闭。 */
interface ImageLightbox {
  overlay?: HTMLElement | null;
  cleanup?: () => void;
}

interface PreviewLightboxDeps {
  documentObj: Document;
  state: { lightbox: unknown };
  qsa: typeof qsa;
  createElement: typeof createElement;
  getSafeUrlAttribute: typeof getSafeUrlAttribute;
}

// 预览图片灯箱：只负责图片交互，不负责帖子弹窗或内容渲染。
function createPreviewLightbox({ documentObj, state, qsa, createElement, getSafeUrlAttribute }: PreviewLightboxDeps) {
  function getPreviewImageSource(image: HTMLImageElement | null | undefined): string | null {
    const link = image?.closest('a[href]');
    const candidates = [
      image?.currentSrc,
      image?.getAttribute('src'),
      image?.getAttribute('data-src'),
      image?.getAttribute('data-original'),
      link?.getAttribute('href'),
    ];
    for (const candidate of candidates) {
      const safe = getSafeUrlAttribute('src', candidate);
      if (safe) return safe;
    }
    return null;
  }

  function closeImageLightbox(): void {
    const lightbox = state.lightbox as ImageLightbox | null;
    if (!lightbox) return;
    lightbox.cleanup?.();
    lightbox.overlay?.remove();
    state.lightbox = null;
  }

  function openImageLightbox(image: HTMLImageElement): void {
    const source = getPreviewImageSource(image);
    if (!source) return;
    closeImageLightbox();

    const overlay = createElement('div', 'xns-lightbox');
    overlay.tabIndex = -1;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '图片预览');
    const stage = createElement('div', 'xns-lightbox-stage');
    const preview = documentObj.createElement('img');
    preview.className = 'xns-lightbox-image';
    preview.src = source;
    preview.alt = image.getAttribute('alt') || '图片预览';
    preview.setAttribute('referrerpolicy', 'origin');
    preview.setAttribute('draggable', 'false');
    const close = createElement('button', 'xns-lightbox-close', '×') as HTMLButtonElement;
    close.type = 'button';
    close.setAttribute('aria-label', '关闭图片预览');
    const original = createElement('a', 'xns-lightbox-open', '打开原图') as HTMLAnchorElement;
    original.href = source;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    stage.appendChild(preview);
    overlay.append(stage, close, original);

    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;
    let dragging = false;
    let pointerId: number | null = null;
    let startX = 0;
    let startY = 0;
    let startOffsetX = 0;
    let startOffsetY = 0;
    const render = (): void => {
      preview.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`;
    };
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      scale = Math.min(4, Math.max(0.5, scale * (event.deltaY < 0 ? 1.12 : 0.89)));
      if (scale <= 1) {
        scale = 1;
        offsetX = 0;
        offsetY = 0;
      }
      render();
    };
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return;
      dragging = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      startOffsetX = offsetX;
      startOffsetY = offsetY;
      stage.classList.add('xns-dragging');
      stage.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging || event.pointerId !== pointerId) return;
      offsetX = startOffsetX + event.clientX - startX;
      offsetY = startOffsetY + event.clientY - startY;
      render();
    };
    const onPointerUp = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      stage.classList.remove('xns-dragging');
      stage.releasePointerCapture?.(event.pointerId);
    };
    const cleanup = (): void => {
      stage.removeEventListener('wheel', onWheel);
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerUp);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerUp);
    stage.addEventListener('click', (event) => { if (event.target === stage) closeImageLightbox(); });
    preview.addEventListener('click', (event) => event.stopPropagation());
    close.addEventListener('click', closeImageLightbox);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeImageLightbox(); });
    documentObj.body.appendChild(overlay);
    state.lightbox = { overlay, cleanup };
    render();
    overlay.focus();
  }

  function installPreviewImageFallback(root: Element | null | undefined, options: { skipRemote?: boolean } = {}): void {
    const isPreviewRoot = Boolean(root?.matches('.xns-preview-content') || root?.closest('.xns-preview-content'));
    const selector = isPreviewRoot ? 'img' : '.xns-preview-content img';
    const images: HTMLImageElement[] = [];
    if (root && root.matches('.xns-preview-content img')) images.push(root as HTMLImageElement);
    const owner = root?.matches('.content-item') ? root : null;
    images.push(...qsa<HTMLImageElement>(root, selector));
    images.filter((image) => {
      if (owner && image.closest('.content-item') !== owner) return false;
      if (options.skipRemote && (image.matches('[data-xns-remote]') || image.closest('[data-xns-remote]'))) return false;
      return true;
    }).forEach((image) => {
      const deferredSource = image.getAttribute('data-xns-deferred-src');
      if (deferredSource) {
        if (!image.getAttribute('src')) image.setAttribute('src', deferredSource);
        image.removeAttribute('data-xns-deferred-src');
      }
      if (image.dataset.xnsImageBound === 'true') return;
      image.dataset.xnsImageBound = 'true';
      image.setAttribute('tabindex', '0');
      image.setAttribute('role', 'button');
      image.setAttribute('title', '点击放大图片');
      const open = (event: Event): void => {
        event.preventDefault();
        event.stopPropagation();
        openImageLightbox(image);
      };
      image.addEventListener('click', open);
      image.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') open(event);
      });
      image.addEventListener('error', () => {
        if (image.nextElementSibling?.matches('.xns-image-error')) return;
        const message = createElement('span', 'xns-image-error', '图片加载失败：图片站拒绝了当前嵌入来源。仍可点击“打开原图”尝试查看。');
        image.insertAdjacentElement('afterend', message);
      }, { once: true });
    });
  }

  return Object.freeze({ closeImageLightbox, openImageLightbox, installPreviewImageFallback });
}

const xnsPreviewLightbox = createPreviewLightbox({
  documentObj: document,
  state,
  qsa,
  createElement,
  getSafeUrlAttribute,
});
const closeImageLightbox = (): void => xnsPreviewLightbox.closeImageLightbox();
const installPreviewImageFallback = (root: Element | null | undefined, options?: { skipRemote?: boolean }): void => xnsPreviewLightbox.installPreviewImageFallback(root, options);

export { closeImageLightbox, installPreviewImageFallback };
export type { ImageLightbox };
