// 预览渲染辅助：只处理克隆节点的清理和跨页来源楼层链接。
function createPreviewRenderUtils({ qs, qsa, createElement }) {
  function stripRenderArtifacts(item) {
    if (!item?.classList) return;
    qsa(item, '.xns-reply-list, .xns-remote-floor-link').forEach((node) => node.remove());
    item.classList.remove('xns-comment-root', 'xns-comment-child', 'xns-floor-highlight');
    item.removeAttribute('data-xns-floor');
    item.removeAttribute('data-xns-depth');
    item.removeAttribute('data-xns-parent-floor');
    item.removeAttribute('data-xns-remote');
    item.removeAttribute('data-xns-source-page');
    item.style.removeProperty('--xns-indent');
  }

  function setFloorLinkUrl(source, record, postId) {
    if (!source) return;
    source.href = `/post-${postId}-${record.page}#${record.floor}`;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.title = `打开原楼层 #${record.floor}`;
    source.setAttribute('aria-label', `打开原楼层 #${record.floor}`);
  }

  function addRemoteNote(record, postId, remote = record.node?.hasAttribute('data-xns-remote')) {
    if (!record.node) return;
    const floorLinks = qsa(record.node, '.floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link');
    const existing = floorLinks.find((link) => link.closest('.floor-link-wrapper')) || floorLinks[0] || null;
    if (!remote) {
      // 当前页评论保留官方楼号样式，但也必须绑定到原帖页，不能继续使用裸 #N。
      floorLinks.forEach((link) => setFloorLinkUrl(link, record, postId));
      return;
    }
    const meta = qs(record.node, ':scope > .nsk-content-meta-info');
    let source = existing;
    let wrapper = source?.closest('.floor-link-wrapper');
    if (!source) {
      wrapper = createElement('div', 'floor-link-wrapper');
      source = createElement('a', 'floor-link', `#${record.floor}`);
      wrapper.appendChild(source);
      (meta || record.node).appendChild(wrapper);
    } else {
      source.textContent = `#${record.floor}`;
      wrapper = wrapper || (() => {
        const created = createElement('div', 'floor-link-wrapper');
        source.replaceWith(created);
        created.appendChild(source);
        return created;
      })();
    }
    setFloorLinkUrl(source, record, postId);
    qsa(record.node, '.floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link')
      .forEach((link) => setFloorLinkUrl(link, record, postId));
    wrapper?.classList.add('xns-remote-floor-link');
  }

  return Object.freeze({ stripRenderArtifacts, addRemoteNote });
}

const xnsPreviewRenderUtils = createPreviewRenderUtils({ qs, qsa, createElement });
const stripRenderArtifacts = (...args) => xnsPreviewRenderUtils.stripRenderArtifacts(...args);
const addRemoteNote = (...args) => xnsPreviewRenderUtils.addRemoteNote(...args);
