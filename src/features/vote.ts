import { createElement, qs, qsa, safePositiveInt } from '../core/dom.js';
import { getActionContext } from './comment-actions.js';
import { dynamicSign, postAction } from '../nodeseek/action-api.js';
import { parseSameOriginUrl } from '../nodeseek/url.js';

/** 投票选项；`count` 只在已结束/已公开的投票里出现。 */
interface VoteItem {
  count?: number;
  voted?: boolean;
  text?: string;
  vote_item_id?: number | string;
}

/** 投票主体。 */
interface VoteInfo {
  id: number | string;
  title?: string;
  multiple?: boolean;
  locked?: boolean;
  isPublic?: boolean;
  items?: VoteItem[];
}

/** `/api/vote/info/:id` 的响应。 */
interface VoteInfoResponse {
  success?: boolean;
  message?: string;
  vote?: VoteInfo;
}

/** 投票模块依赖；测试可注入替身。 */
interface VoteFeatureDeps {
  windowObj: Window & typeof globalThis;
  documentObj: Document;
  qs: typeof qs;
  qsa: typeof qsa;
  createElement: typeof createElement;
  parseSameOriginUrl: typeof parseSameOriginUrl;
  safePositiveInt: typeof safePositiveInt;
  dynamicSign: typeof dynamicSign;
  postAction: typeof postAction;
  getActionContext: typeof getActionContext;
  fetchFn: typeof fetch;
}

// 投票功能模块。
// 投票的读取、选择态、结果态和提交由这里管理；普通评论 reaction 不与它共享 UI 状态。
function createVoteFeature({
  windowObj,
  documentObj,
  qs,
  qsa,
  createElement,
  parseSameOriginUrl,
  safePositiveInt,
  dynamicSign,
  postAction,
  getActionContext,
  fetchFn,
}: VoteFeatureDeps) {
  function getVoteIdFromLink(link: Element): number | null {
    const href = link.getAttribute('data-href') || link.getAttribute('href') || '';
    const match = /nsapp:\/\/vote\?id=(\d+)/.exec(href);
    return match ? safePositiveInt(match[1]) : null;
  }

  async function fetchVoteInfo(voteId: number): Promise<VoteInfoResponse> {
    const endpoint = parseSameOriginUrl(`/api/vote/info/${voteId}`);
    if (!endpoint) throw new Error('投票地址非法');
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
    if (windowObj.crypto?.subtle) headers['x-dynamic-sign'] = await dynamicSign('GET', endpoint.href, '');
    const response = await fetchFn(endpoint.href, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'same-origin',
      headers,
    });
    const text = await response.text();
    let data: VoteInfoResponse | null = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
    if (!response.ok || !data || data.success === false) throw new Error(data?.message || `HTTP ${response.status}`);
    return data;
  }

  function hasVoteResults(vote: VoteInfo): boolean {
    return (vote.items || []).some((item) => typeof item.count === 'number');
  }

  function buildVoteResults(vote: VoteInfo): HTMLElement {
    const items = vote.items || [];
    const total = items.reduce((sum, item) => sum + (typeof item.count === 'number' ? item.count : 0), 0);
    const box = createElement('div', 'xns-vote-results');
    items.forEach((item) => {
      const count = typeof item.count === 'number' ? item.count : 0;
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      const row = createElement('div', `xns-vote-result${item.voted ? ' xns-vote-mine' : ''}`);
      // 选项描述和票数同一行（票数跟着描述，不再单独占一行），下面才是占比条。
      const head = createElement('div', 'xns-vote-result-head');
      head.appendChild(createElement('div', 'vote-item-text', item.text || ''));
      head.appendChild(createElement('div', 'xns-vote-result-meta', `${count} 票${item.voted ? '（已选）' : ''}`));
      row.appendChild(head);
      const barWrap = createElement('div', 'xns-vote-bar-wrap');
      const bar = createElement('div', `xns-vote-bar${count > 0 ? '' : ' xns-vote-bar-empty'}`) as HTMLElement;
      bar.style.width = `${percent}%`;
      // 0 票的条不画绿色也不写“0%”（否则 0 票看起来像有人投过），票数在上面那行已经写了。
      if (count > 0) bar.appendChild(documentObj.createTextNode(`${percent}%`));
      barWrap.appendChild(bar);
      row.appendChild(barWrap);
      box.appendChild(row);
    });
    box.appendChild(createElement('div', 'xns-vote-total', `共 ${total} 票${vote.locked ? ' · 已结束' : ''}`));
    return box;
  }

  function buildVotePanel(vote: VoteInfo): HTMLElement {
    const panel = createElement('div', 'vote-panel xns-vote-panel') as HTMLElement;
    panel.dataset.xnsVoteId = String(vote.id);
    const title = createElement('h2', 'xns-vote-title', vote.title || '投票') as HTMLElement;
    title.style.textAlign = 'center';
    title.style.fontSize = '1.2rem';
    panel.appendChild(title);
    if (hasVoteResults(vote)) {
      panel.appendChild(buildVoteResults(vote));
      panel.appendChild(createElement('div', 'xns-vote-note', `nsapp://vote?id=${vote.id}${vote.isPublic ? ' (公开投票)' : ''}${vote.locked ? ' · 已结束' : ''}`));
      return panel;
    }
    const single = vote.multiple !== true;
    const wrapper = createElement('fieldset', 'vote-stat-wrapper');
    (vote.items || []).forEach((item) => {
      const stat = createElement('div', `vote-stat${item.voted ? ' voted' : ' not-voted'}`);
      const input = documentObj.createElement('input');
      input.type = single ? 'radio' : 'checkbox';
      input.name = 'vote-item';
      input.value = String(item.vote_item_id);
      if (item.voted) input.checked = true;
      const label = createElement('label', 'pure-checkbox');
      label.appendChild(input);
      label.appendChild(createElement('div', 'vote-item-text', item.text || ''));
      stat.appendChild(label);
      wrapper.appendChild(stat);
    });
    panel.appendChild(wrapper);
    const buttons = createElement('fieldset', 'op-buttons');
    const submit = createElement('button', 'pure-button pure-button-primary add-margin', vote.locked ? '已结束' : '投票') as HTMLButtonElement;
    submit.type = 'button';
    if (vote.locked) submit.setAttribute('disabled', '');
    buttons.appendChild(submit);
    panel.appendChild(buttons);
    panel.appendChild(createElement('div', 'xns-vote-note', `nsapp://vote?id=${vote.id}${vote.isPublic ? ' (公开投票)' : ''}`));
    return panel;
  }

  function mountVotePanel(link: Element, data: VoteInfoResponse | null): void {
    if (!link.isConnected) return;
    const vote = data?.vote;
    if (!vote || !Array.isArray(vote.items)) return;
    link.replaceWith(buildVotePanel(vote));
  }

  function scheduleVoteInfo(link: Element, voteId: number): void {
    const load = (): void => {
      if (!link.isConnected) return;
      void fetchVoteInfo(voteId)
        .then((data) => mountVotePanel(link, data))
        .catch(() => {
          if (link.isConnected) link.textContent = link.textContent || `投票 #${voteId}（需登录）`;
        });
    };
    if (typeof windowObj.IntersectionObserver === 'function') {
      let observer: IntersectionObserver | null = null;
      observer = new windowObj.IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        load();
      }, { rootMargin: '600px 0px' });
      observer.observe(link);
      return;
    }
    if (typeof windowObj.requestIdleCallback === 'function') windowObj.requestIdleCallback(load, { timeout: 1_000 });
    else windowObj.setTimeout(load, 0);
  }

  function installPreviewVotePanels(root: Element | null | undefined, options: { skipRemote?: boolean } = {}): void {
    const selector = '.xns-preview-content a[data-href^="nsapp://vote"], .xns-preview-content a[href^="nsapp://vote"]';
    const isPreviewRoot = root?.matches?.('.xns-preview-content') || root?.closest?.('.xns-preview-content');
    const relativeSelector = isPreviewRoot
      ? 'a[data-href^="nsapp://vote"], a[href^="nsapp://vote"]'
      : selector;
    const owner = root?.matches?.('.content-item') ? root : null;
    const links: HTMLElement[] = [];
    if (root?.matches?.(selector)) links.push(root as HTMLElement);
    links.push(...qsa<HTMLAnchorElement>(root, relativeSelector));
    links.filter((link) => {
      if (owner && link.closest?.('.content-item') !== owner) return false;
      if (options.skipRemote && (link.matches?.('[data-xns-remote]') || link.closest?.('[data-xns-remote]'))) return false;
      return true;
    }).forEach((link) => {
      if (link.dataset.xnsVoteBound === 'true') return;
      const voteId = getVoteIdFromLink(link);
      if (voteId === null) return;
      link.dataset.xnsVoteBound = 'true';
      scheduleVoteInfo(link, voteId);
    });
  }

  function getVoteStatus(panel: Element): HTMLElement {
    let status: HTMLElement | null = qs(panel, '.xns-vote-status');
    if (!status) {
      status = createElement('div', 'xns-vote-status');
      panel.appendChild(status);
    }
    return status;
  }

  function handleVoteClick(event: Event): void {
    const eventTarget = event.target as Partial<Element> | null;
    const button = (eventTarget?.closest?.('.xns-vote-panel button') as HTMLButtonElement | undefined) || null;
    if (!button || button.disabled) return;
    const panel = button.closest('.xns-vote-panel') as HTMLElement | null;
    if (!panel || panel.dataset.xnsVotePending === 'true') return;
    const inPreview = Boolean(panel.closest('.xns-overlay .xns-preview-content'));
    const inRemote = Boolean(panel.closest('[data-xns-remote]'));
    if (!inPreview && !inRemote) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selected = qsa<HTMLInputElement>(panel, 'input[name="vote-item"]:checked').map((input) => input.value);
    const status = getVoteStatus(panel);
    if (!selected.length) {
      status.textContent = '请先选择选项。';
      return;
    }
    panel.dataset.xnsVotePending = 'true';
    button.setAttribute('disabled', '');
    status.textContent = '正在投票…';
    const voteId = safePositiveInt(panel.dataset.xnsVoteId || '');
    void postAction('/api/vote/voteforitem', { ids: selected.map((value) => Number(value)) }, { context: getActionContext(button) })
      .then(async () => {
        let refreshed: VoteInfoResponse | null = null;
        if (voteId !== null) {
          try { refreshed = await fetchVoteInfo(voteId); } catch { /* 保留成功提示 */ }
        }
        if (!panel.isConnected) return;
        if (refreshed?.vote) {
          panel.replaceWith(buildVotePanel(refreshed.vote));
        } else {
          status.textContent = '投票成功，感谢参与。';
          button.textContent = '已投票';
        }
      })
      .catch((error: unknown) => {
        status.textContent = `投票失败：${(error as Error)?.message || '网络错误'}`;
        button.removeAttribute('disabled');
        panel.dataset.xnsVotePending = '';
      });
  }

  return Object.freeze({ installPreviewVotePanels, handleVoteClick, fetchVoteInfo });
}

const xnsVoteFeature = createVoteFeature({
  windowObj: window,
  documentObj: document,
  qs,
  qsa,
  createElement,
  parseSameOriginUrl,
  safePositiveInt,
  dynamicSign,
  postAction,
  getActionContext,
  fetchFn: window.fetch.bind(window),
});
const installPreviewVotePanels = (root: Element | null | undefined, options?: { skipRemote?: boolean }): void => xnsVoteFeature.installPreviewVotePanels(root, options);
const handleVoteClick = (event: Event): void => xnsVoteFeature.handleVoteClick(event);

export { handleVoteClick, installPreviewVotePanels };
export type { VoteInfo, VoteItem, VoteInfoResponse };
