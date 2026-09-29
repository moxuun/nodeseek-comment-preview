import { createElement, qs, qsa } from '../core/dom.js';
import { buildPostUrl } from '../nodeseek/url.js';
import type { CommentRecord } from '../nodeseek/content-parser.js';

/** 预览渲染辅助依赖；测试可注入替身。 */
interface PreviewRenderUtilsDeps {
  qs: typeof qs;
  qsa: typeof qsa;
  createElement: typeof createElement;
  buildPostUrl: typeof buildPostUrl;
}

// 预览渲染辅助：只处理克隆节点的清理和跨页来源楼层链接。
function createPreviewRenderUtils({ qs, qsa, createElement, buildPostUrl }: PreviewRenderUtilsDeps) {
  function stripRenderArtifacts(item: Element | null | undefined): void {
    if (!item?.classList) return;
    qsa(item, '.xns-reply-list, .xns-remote-floor-link').forEach((node) => node.remove());
    item.classList.remove('xns-comment-root', 'xns-comment-child', 'xns-floor-highlight');
    item.removeAttribute('data-xns-floor');
    item.removeAttribute('data-xns-depth');
    item.removeAttribute('data-xns-parent-floor');
    item.removeAttribute('data-xns-remote');
    item.removeAttribute('data-xns-source-page');
    (item as HTMLElement).style.removeProperty('--xns-indent');
  }

  function setFloorLinkUrl(source: HTMLAnchorElement | null, record: CommentRecord, postId: string): void {
    if (!source) return;
    const url = buildPostUrl(postId, record.page, record.floor);
    if (!url) return;
    source.href = url.href;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.title = `打开原楼层 #${record.floor}`;
    source.setAttribute('aria-label', `打开原楼层 #${record.floor}`);
  }

  function addRemoteNote(record: CommentRecord, postId: string, remote: boolean = record.node?.hasAttribute('data-xns-remote') === true): void {
    const node = record.node;
    if (!node) return;
    const floorLinks = qsa<HTMLAnchorElement>(node, '.floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link');
    const existing = floorLinks.find((link) => link.closest('.floor-link-wrapper')) || floorLinks[0] || null;
    if (!remote) {
      // 当前页评论保留官方楼号样式，但也必须绑定到原帖页，不能继续使用裸 #N。
      floorLinks.forEach((link) => setFloorLinkUrl(link, record, postId));
      return;
    }
    const meta = qs(node, ':scope > .nsk-content-meta-info');
    let source: HTMLAnchorElement | null = existing;
    let wrapper: Element | null = source?.closest('.floor-link-wrapper') ?? null;
    if (!source) {
      wrapper = createElement('div', 'floor-link-wrapper');
      source = createElement('a', 'floor-link', `#${record.floor}`) as HTMLAnchorElement;
      wrapper.appendChild(source);
      (meta || node).appendChild(wrapper);
    } else {
      source.textContent = `#${record.floor}`;
      wrapper = wrapper || (() => {
        const created = createElement('div', 'floor-link-wrapper');
        source?.replaceWith(created);
        created.appendChild(source as HTMLAnchorElement);
        return created;
      })();
    }
    setFloorLinkUrl(source, record, postId);
    qsa<HTMLAnchorElement>(node, '.floor-link-wrapper > .floor-link, .nsk-content-meta-info .floor-link')
      .forEach((link) => setFloorLinkUrl(link, record, postId));
    wrapper?.classList.add('xns-remote-floor-link');
  }

  return Object.freeze({ stripRenderArtifacts, addRemoteNote });
}

const xnsPreviewRenderUtils = createPreviewRenderUtils({ qs, qsa, createElement, buildPostUrl });

const stripRenderArtifacts = (item: Element | null | undefined): void => xnsPreviewRenderUtils.stripRenderArtifacts(item);
const addRemoteNote = (record: CommentRecord, postId: string, remote?: boolean): void => xnsPreviewRenderUtils.addRemoteNote(record, postId, remote);

export { addRemoteNote, stripRenderArtifacts };
