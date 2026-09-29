import { handleKeydown, handlePreviewActionClick } from './events.js';
import { state } from '../core/config.js';
import type { PostHandle } from '../core/config.js';
import { pageInfo } from '../core/runtime.js';
import { handleVoteClick } from '../features/vote.js';
import { getPostInfo, parseSameOriginUrl } from '../nodeseek/url.js';
import { PostEnhancer } from '../post-page/controller.js';
import { openPreviewModal } from '../preview/controller.js';
import { createFloorNavigationController, createPreviewEntryController } from '../preview/entry.js';
import { handleFloorClick } from '../preview/navigation.js';
import { registerSettingsMenu } from '../ui/settings.js';
import { installStyle } from '../ui/style.js';

/**
 * 帖子页增强器对外使用的方法（实现仍在 post-page controller 里）；
 * 它同时就是写进 `state.post` 的那个句柄，因此直接扩展共享契约。
 */
interface PostEnhancerLike extends PostHandle {
  init: () => Promise<unknown>;
  restoreOriginal: () => void;
}

/** 启动依赖：全部由入口注入，测试可替换。 */
interface AppBootstrapDeps {
  documentObj: Document;
  windowObj: Window & typeof globalThis;
  pageInfo: typeof pageInfo;
  state: { post: PostHandle | null };
  installStyle: () => void;
  registerSettingsMenu: () => void;
  createPreviewEntryController: (options: {
    document: Document;
    location: Location;
    parseSameOriginUrl: typeof parseSameOriginUrl;
    getPostInfo: typeof getPostInfo;
    openPreviewModal: (url: URL, link: Element) => void;
  }) => { handle: (event: MouseEvent) => void };
  createFloorNavigationController: (options: {
    enabled: boolean;
    handleFloorClick: (event: Event) => void;
  }) => { handle: (event: Event) => void };
  parseSameOriginUrl: typeof parseSameOriginUrl;
  getPostInfo: typeof getPostInfo;
  openPreviewModal: (url: URL, link: Element) => void;
  handleFloorClick: (event: Event) => void;
  handlePreviewActionClick: (event: Event) => void;
  handleVoteClick: (event: Event) => void;
  handleKeydown: (event: KeyboardEvent) => void;
  PostEnhancer: new (options: NonNullable<typeof pageInfo>) => PostEnhancerLike;
}

// 应用启动：集中注册事件并在 DOM ready 后初始化帖子页增强。
function createAppBootstrap({
  documentObj,
  windowObj,
  pageInfo,
  state,
  installStyle,
  registerSettingsMenu,
  createPreviewEntryController,
  createFloorNavigationController,
  parseSameOriginUrl,
  getPostInfo,
  openPreviewModal,
  handleFloorClick,
  handlePreviewActionClick,
  handleVoteClick,
  handleKeydown,
  PostEnhancer,
}: AppBootstrapDeps) {
  function start(): void {
    installStyle();
    registerSettingsMenu();
    const previewEntry = createPreviewEntryController({
      document: documentObj,
      location: windowObj.location,
      parseSameOriginUrl,
      getPostInfo,
      openPreviewModal,
    });
    const floorNavigation = createFloorNavigationController({
      enabled: Boolean(pageInfo),
      handleFloorClick,
    });
    documentObj.addEventListener('click', handlePreviewActionClick, true);
    documentObj.addEventListener('click', handleVoteClick, true);
    documentObj.addEventListener('click', previewEntry.handle, true);
    documentObj.addEventListener('click', floorNavigation.handle, true);
    documentObj.addEventListener('keydown', handleKeydown, true);

    const ready = (): void => {
      if (!pageInfo || state.post) return;
      const enhancer = new PostEnhancer(pageInfo);
      state.post = enhancer;
      void enhancer.init().catch(() => enhancer.restoreOriginal());
    };
    if (documentObj.readyState === 'loading') documentObj.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
  }

  return Object.freeze({ start });
}

const xnsAppBootstrap = createAppBootstrap({
  documentObj: document,
  windowObj: window,
  pageInfo,
  state,
  installStyle,
  registerSettingsMenu,
  createPreviewEntryController,
  createFloorNavigationController,
  parseSameOriginUrl,
  getPostInfo,
  openPreviewModal,
  handleFloorClick,
  handlePreviewActionClick,
  handleVoteClick,
  handleKeydown,
  PostEnhancer,
});
xnsAppBootstrap.start();
