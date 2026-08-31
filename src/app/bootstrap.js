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
}) {
  function start() {
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

    const ready = () => {
      if (!pageInfo || state.post) return;
      state.post = new PostEnhancer(pageInfo);
      state.post.init().catch(() => state.post?.restoreOriginal());
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
