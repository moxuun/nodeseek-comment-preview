// 预览内容增强：ANSI、官方魔法标签页、Markdown 标签页、图片和代码复制。
function createContentFeatures({
  windowObj,
  documentObj,
  navigatorObj,
  qs,
  qsa,
  createElement,
  clearElement,
  installPreviewImageFallback,
  installPreviewVotePanels,
}) {
  const ANSI_COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
  const NodeCtor = windowObj.Node;

  function createAnsiState() {
    return { fg: '', bg: '', bold: false, dim: false, italic: false, underline: false, strike: false, hidden: false, inverse: false };
  }

  function applyAnsiCodes(state, rawCodes) {
    const codes = rawCodes.length ? rawCodes : [0];
    for (let index = 0; index < codes.length; index += 1) {
      const code = Number(codes[index]);
      if (!Number.isFinite(code)) continue;
      if (code === 0) Object.assign(state, createAnsiState());
      else if (code === 1) state.bold = true;
      else if (code === 2) state.dim = true;
      else if (code === 3) state.italic = true;
      else if (code === 4) state.underline = true;
      else if (code === 7) state.inverse = true;
      else if (code === 8) state.hidden = true;
      else if (code === 9) state.strike = true;
      else if (code === 22) { state.bold = false; state.dim = false; }
      else if (code === 23) state.italic = false;
      else if (code === 24) state.underline = false;
      else if (code === 27) state.inverse = false;
      else if (code === 28) state.hidden = false;
      else if (code === 29) state.strike = false;
      else if (code === 39) state.fg = '';
      else if (code === 49) state.bg = '';
      else if (code >= 30 && code <= 37) state.fg = ANSI_COLORS[code - 30];
      else if (code >= 40 && code <= 47) state.bg = ANSI_COLORS[code - 40];
      else if (code >= 90 && code <= 97) state.fg = `bright-${ANSI_COLORS[code - 90]}`;
      else if (code >= 100 && code <= 107) state.bg = `bright-${ANSI_COLORS[code - 100]}`;
      else if (code === 38 || code === 48) {
        const mode = Number(codes[index + 1]);
        index += mode === 5 ? 2 : mode === 2 ? 4 : 0;
      }
    }
  }

  function getAnsiClasses(state) {
    return [
      state.fg && `xns-ansi-fg-${state.fg}`,
      state.bg && `xns-ansi-bg-${state.bg}`,
      state.bold && 'xns-ansi-bold',
      state.dim && 'xns-ansi-dim',
      state.italic && 'xns-ansi-italic',
      state.underline && 'xns-ansi-underline',
      state.strike && 'xns-ansi-strike',
      state.hidden && 'xns-ansi-hidden',
      state.inverse && 'xns-ansi-inverse',
    ].filter(Boolean);
  }

  function appendAnsiText(code, text, state) {
    if (!text) return;
    const classes = getAnsiClasses(state);
    if (!classes.length) {
      code.appendChild(documentObj.createTextNode(text));
      return;
    }
    const span = createElement('span', classes.join(' '));
    span.textContent = text;
    code.appendChild(span);
  }

  function isAnsiCodeBlock(pre) {
    const code = qs(pre, ':scope > code') || qs(pre, 'code');
    const className = `${String(pre.className || '')} ${String(code?.className || '')}`;
    return Boolean(code && /(?:^|\s)(?:language-ansi|lang-ansi|ansi)(?:\s|$)/i.test(className));
  }

  function serializeAnsiNode(node) {
    if (node.nodeType === NodeCtor.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== NodeCtor.ELEMENT_NODE) return '';
    let output = '';
    if (node.matches('span[data-ansicode]')) {
      const code = Number(node.getAttribute('data-ansicode'));
      if (Number.isInteger(code) && code >= 0 && code <= 127) output += String.fromCharCode(code);
    }
    Array.from(node.childNodes).forEach((child) => { output += serializeAnsiNode(child); });
    return output;
  }

  function renderAnsiCodeBlock(pre) {
    if (!isAnsiCodeBlock(pre)) return;
    const code = qs(pre, ':scope > code') || qs(pre, 'code');
    if (!code || code.dataset.xnsAnsiRendered === 'true') return;
    const source = serializeAnsiNode(code)
      .replace(/\u0008/g, '')
      .replace(/\u000d\u000a?/g, '\n')
      .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
    clearElement(code);
    const state = createAnsiState();
    const ansiPattern = /\u001b\[([0-9;]*)m/g;
    let cursor = 0;
    let match;
    while ((match = ansiPattern.exec(source))) {
      appendAnsiText(code, source.slice(cursor, match.index), state);
      applyAnsiCodes(state, match[1].split(';').filter((value) => value !== '').map(Number));
      cursor = ansiPattern.lastIndex;
    }
    appendAnsiText(code, source.slice(cursor), state);
    code.dataset.xnsAnsiRendered = 'true';
  }

  function installPreviewAnsiBlocks(root) {
    qsa(root, '.xns-preview-content pre').forEach(renderAnsiCodeBlock);
  }

  function installPreviewMagicTabs(root) {
    qsa(root, '.xns-preview-content .nsk-magic-tabs').forEach((tabs) => {
      if (tabs.dataset.xnsMagicTabsBound === 'true') return;
      const titles = qsa(tabs, ':scope > .nsk-magic-tab-title');
      const bodies = qsa(tabs, ':scope > .nsk-magic-tab-body');
      if (!titles.length || titles.length !== bodies.length) return;
      const activate = (selected) => {
        titles.forEach((title, index) => {
          const active = index === selected;
          title.classList.toggle('xns-active', active);
          title.setAttribute('aria-selected', active ? 'true' : 'false');
          bodies[index].classList.toggle('xns-active', active);
          bodies[index].setAttribute('aria-hidden', active ? 'false' : 'true');
        });
      };
      titles.forEach((title, index) => {
        title.setAttribute('role', 'tab');
        title.setAttribute('tabindex', '0');
        title.addEventListener('click', () => activate(index));
        title.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate(index);
          }
        });
      });
      bodies.forEach((body) => body.setAttribute('role', 'tabpanel'));
      activate(0);
      tabs.dataset.xnsMagicTabsBound = 'true';
    });
  }

  function getDirectiveText(node) {
    if (!node || node.nodeType !== NodeCtor.ELEMENT_NODE || node.matches('pre, code')) return '';
    return (node.textContent || '').trim().replace(/\s+/g, ' ');
  }

  function getMarkdownTabLabel(text) {
    const match = /^:::\s*tab-item(?:\s+(.+?))?\s*$/i.exec(text);
    return match?.[1]?.trim() || '标签页';
  }

  function installPreviewMarkdownTabs(root) {
    const selector = '.xns-preview-content .post-content, .xns-preview-content article.post-content';
    const contents = [];
    if (root?.matches?.(selector)) contents.push(root);
    contents.push(...qsa(root, selector));
    contents.forEach((content) => {
      if (content.dataset.xnsTabsBound === 'true') return;
      const children = Array.from(content.children);
      const start = children.findIndex((node) => getDirectiveText(node) === ':::: tabs');
      if (start < 0) return;
      const tabs = [];
      const markers = [children[start]];
      let current = null;
      let end = -1;
      for (let index = start + 1; index < children.length; index += 1) {
        const node = children[index];
        const text = getDirectiveText(node);
        const tabMatch = /^:::\s*tab-item(?:\s+(.+?))?\s*$/i.exec(text);
        if (tabMatch) {
          current = { label: getMarkdownTabLabel(text), nodes: [] };
          tabs.push(current);
          markers.push(node);
          continue;
        }
        if (text === ':::') {
          markers.push(node);
          current = null;
          continue;
        }
        if (text === '::::') {
          markers.push(node);
          end = index;
          break;
        }
        if (current) current.nodes.push(node);
      }
      if (end < 0 || !tabs.length) return;
      const wrapper = createElement('section', 'xns-markdown-tabs');
      const nav = createElement('div', 'xns-markdown-tabs-nav');
      nav.setAttribute('role', 'tablist');
      wrapper.appendChild(nav);
      content.insertBefore(wrapper, children[start]);
      tabs.forEach((tab, tabIndex) => {
        const button = createElement('button', 'xns-markdown-tab', tab.label);
        const panel = createElement('div', 'xns-markdown-tab-panel');
        const active = tabIndex === 0;
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', active ? 'true' : 'false');
        panel.setAttribute('role', 'tabpanel');
        if (active) {
          button.classList.add('is-active');
          panel.classList.add('is-active');
        }
        tab.nodes.forEach((node) => panel.appendChild(node));
        button.addEventListener('click', () => {
          Array.from(nav.children).forEach((item, index) => {
            const selected = index === tabIndex;
            item.classList.toggle('is-active', selected);
            item.setAttribute('aria-selected', selected ? 'true' : 'false');
          });
          Array.from(wrapper.querySelectorAll('.xns-markdown-tab-panel')).forEach((item, index) => {
            item.classList.toggle('is-active', index === tabIndex);
          });
        });
        nav.appendChild(button);
        wrapper.appendChild(panel);
      });
      markers.forEach((node) => node.remove());
      content.dataset.xnsTabsBound = 'true';
    });
  }

  function fallbackCopyText(text) {
    const textarea = createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-10000px';
    textarea.style.left = '-10000px';
    textarea.style.opacity = '0';
    documentObj.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let copied = false;
    try { copied = documentObj.execCommand('copy'); } catch { copied = false; }
    textarea.remove();
    return copied;
  }

  function copyText(text) {
    if (navigatorObj.clipboard?.writeText) {
      return navigatorObj.clipboard.writeText(text).catch(() => {
        if (!fallbackCopyText(text)) throw new Error('copy failed');
      });
    }
    return fallbackCopyText(text) ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  function installPreviewCodeBlocks(root) {
    qsa(root, '.xns-preview-content pre').forEach((pre) => {
      if (pre.dataset.xnsCodeBound === 'true') return;
      const code = qs(pre, ':scope > code') || qs(pre, 'code');
      if (!code) return;
      pre.dataset.xnsCodeBound = 'true';
      pre.classList.add('xns-code-block');
      const button = createElement('button', 'xns-code-copy-btn', '复制');
      button.type = 'button';
      button.setAttribute('aria-label', '复制代码');
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const text = code.innerText ?? code.textContent ?? '';
        button.disabled = true;
        void copyText(text).then(() => {
          button.textContent = '已复制';
          button.classList.remove('xns-copy-failed');
        }).catch(() => {
          button.textContent = '复制失败';
          button.classList.add('xns-copy-failed');
        }).finally(() => {
          windowObj.setTimeout(() => {
            if (!button.isConnected) return;
            button.disabled = false;
            button.textContent = '复制';
            button.classList.remove('xns-copy-failed');
          }, 2_000);
        });
      });
      pre.appendChild(button);
    });
  }

  function installPreviewFeatures(root) {
    installPreviewMagicTabs(root);
    installPreviewMarkdownTabs(root);
    installPreviewAnsiBlocks(root);
    installPreviewImageFallback(root);
    installPreviewCodeBlocks(root);
    installPreviewVotePanels(root);
  }

  return Object.freeze({ installPreviewFeatures, installPreviewCodeBlocks });
}

const xnsContentFeatures = createContentFeatures({
  windowObj: window,
  documentObj: document,
  navigatorObj: navigator,
  qs,
  qsa,
  createElement,
  clearElement,
  installPreviewImageFallback,
  installPreviewVotePanels,
});
const installPreviewFeatures = (...args) => xnsContentFeatures.installPreviewFeatures(...args);
const installPreviewCodeBlocks = (...args) => xnsContentFeatures.installPreviewCodeBlocks(...args);
