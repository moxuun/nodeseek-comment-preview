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
}) {
  function getVoteIdFromLink(link) {
    const href = link.getAttribute('data-href') || link.getAttribute('href') || '';
    const match = /nsapp:\/\/vote\?id=(\d+)/.exec(href);
    return match ? safePositiveInt(match[1]) : null;
  }

  async function fetchVoteInfo(voteId) {
    const endpoint = parseSameOriginUrl(`/api/vote/info/${voteId}`);
    if (!endpoint) throw new Error('投票地址非法');
    const headers = { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
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
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
    if (!response.ok || !data || data.success === false) throw new Error(data?.message || `HTTP ${response.status}`);
    return data;
  }

  function hasVoteResults(vote) {
    return (vote.items || []).some((item) => typeof item.count === 'number');
  }

  function buildVoteResults(vote) {
    const items = vote.items || [];
    const total = items.reduce((sum, item) => sum + (typeof item.count === 'number' ? item.count : 0), 0);
    const box = createElement('div', 'xns-vote-results');
    items.forEach((item) => {
      const count = typeof item.count === 'number' ? item.count : 0;
      const percent = total > 0 ? Math.round((count / total) * 100) : 0;
      const row = createElement('div', `xns-vote-result${item.voted ? ' xns-vote-mine' : ''}`);
      row.appendChild(createElement('div', 'vote-item-text', item.text || ''));
      const barWrap = createElement('div', 'xns-vote-bar-wrap');
      const bar = createElement('div', 'xns-vote-bar');
      bar.style.width = `${percent}%`;
      bar.appendChild(documentObj.createTextNode(`${percent}%`));
      barWrap.appendChild(bar);
      row.appendChild(barWrap);
      row.appendChild(createElement('div', 'xns-vote-result-meta', `${count} 票${item.voted ? '（已选）' : ''}`));
      box.appendChild(row);
    });
    box.appendChild(createElement('div', 'xns-vote-total', `共 ${total} 票${vote.locked ? ' · 已结束' : ''}`));
    return box;
  }

  function buildVotePanel(vote) {
    const panel = createElement('div', 'vote-panel xns-vote-panel');
    panel.dataset.xnsVoteId = String(vote.id);
    const title = createElement('h2', 'xns-vote-title', vote.title || '投票');
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
    const submit = createElement('button', 'pure-button pure-button-primary add-margin', vote.locked ? '已结束' : '投票');
    submit.type = 'button';
    if (vote.locked) submit.setAttribute('disabled', '');
    buttons.appendChild(submit);
    panel.appendChild(buttons);
    panel.appendChild(createElement('div', 'xns-vote-note', `nsapp://vote?id=${vote.id}${vote.isPublic ? ' (公开投票)' : ''}`));
    return panel;
  }

  function mountVotePanel(link, data) {
    if (!link.isConnected) return;
    const vote = data?.vote;
    if (!vote || !Array.isArray(vote.items)) return;
    link.replaceWith(buildVotePanel(vote));
  }

  function installPreviewVotePanels(root) {
    qsa(root, 'a[data-href^="nsapp://vote"], a[href^="nsapp://vote"]').forEach((link) => {
      if (link.dataset.xnsVoteBound === 'true') return;
      const voteId = getVoteIdFromLink(link);
      if (voteId === null) return;
      link.dataset.xnsVoteBound = 'true';
      void fetchVoteInfo(voteId)
        .then((data) => mountVotePanel(link, data))
        .catch(() => {
          if (link.isConnected) link.textContent = link.textContent || `投票 #${voteId}（需登录）`;
        });
    });
  }

  function getVoteStatus(panel) {
    let status = qs(panel, '.xns-vote-status');
    if (!status) {
      status = createElement('div', 'xns-vote-status');
      panel.appendChild(status);
    }
    return status;
  }

  function handleVoteClick(event) {
    const button = event.target.closest?.('.xns-vote-panel button');
    if (!button || button.disabled) return;
    const panel = button.closest('.xns-vote-panel');
    if (!panel || panel.dataset.xnsVotePending === 'true') return;
    const inPreview = Boolean(panel.closest('.xns-overlay .xns-preview-content'));
    const inRemote = Boolean(panel.closest('[data-xns-remote]'));
    if (!inPreview && !inRemote) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selected = qsa(panel, 'input[name="vote-item"]:checked').map((input) => input.value);
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
        let refreshed = null;
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
      .catch((error) => {
        status.textContent = `投票失败：${error.message || '网络错误'}`;
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
const installPreviewVotePanels = (...args) => xnsVoteFeature.installPreviewVotePanels(...args);
const handleVoteClick = (...args) => xnsVoteFeature.handleVoteClick(...args);
const fetchVoteInfo = (...args) => xnsVoteFeature.fetchVoteInfo(...args);
