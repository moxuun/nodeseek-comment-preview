// 设置中心 UI；只管理界面偏好，不提供自动写操作开关。
function createSettingsUi({ windowObj, documentObj, state, createElement, getSettings, updateSettings, resetSettings }) {
  function closeSettings() {
    state.settingsPanel?.overlay?.remove();
    state.settingsPanel = null;
  }

  function createField(labelText, control, note = '') {
    const field = createElement('label', 'xns-settings-field');
    field.appendChild(createElement('span', 'xns-settings-label', labelText));
    field.appendChild(control);
    if (note) field.appendChild(createElement('small', 'xns-settings-note', note));
    return field;
  }

  function createSelect(options, value) {
    const select = documentObj.createElement('select');
    options.forEach(([optionValue, label]) => {
      const option = documentObj.createElement('option');
      option.value = optionValue;
      option.textContent = label;
      option.selected = optionValue === String(value);
      select.appendChild(option);
    });
    return select;
  }

  function openSettings() {
    closeSettings();
    const values = getSettings();
    const overlay = createElement('div', 'xns-settings-overlay');
    overlay.tabIndex = -1;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeSettings(); });
    const dialog = createElement('section', 'xns-settings-panel');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'xns-settings-title');
    const header = createElement('header', 'xns-settings-header');
    const title = createElement('h2', '', '预览设置');
    title.id = 'xns-settings-title';
    const close = createElement('button', 'xns-settings-close', '×');
    close.type = 'button';
    close.title = '关闭设置';
    close.setAttribute('aria-label', '关闭设置');
    close.addEventListener('click', closeSettings);
    header.append(title, close);
    const form = createElement('div', 'xns-settings-form');
    const layout = createSelect([['thread', '楼中楼'], ['original', '原版评论']], values.mode);
    const maxPages = createSelect([['10', '10 页'], ['20', '20 页'], ['30', '30 页'], ['50', '50 页']], values.maxPages);
    const density = createSelect([['comfortable', '舒适'], ['compact', '紧凑']], values.density);
    const theme = createSelect([['auto', '跟随 NodeSeek'], ['dark', '深色']], values.theme);
    const prompts = documentObj.createElement('input');
    prompts.type = 'checkbox';
    prompts.checked = values.prompts;
    const promptField = createElement('label', 'xns-settings-check');
    promptField.append(prompts, createElement('span', '', '显示一次性操作提示'));
    form.append(
      createField('默认评论布局', layout, '只影响帖子详情页，切换会立即生效。'),
      createField('自动读取页数', maxPages, '最多 50 页；修改后在下次刷新或打开帖子时生效。'),
      createField('评论密度', density),
      createField('主题', theme),
      promptField,
    );
    const footer = createElement('footer', 'xns-settings-actions');
    const reset = createElement('button', '', '恢复默认');
    reset.type = 'button';
    const done = createElement('button', 'xns-settings-primary', '完成');
    done.type = 'button';
    done.addEventListener('click', closeSettings);
    footer.append(reset, done);
    dialog.append(header, form, footer);
    overlay.appendChild(dialog);
    documentObj.body.appendChild(overlay);
    state.settingsPanel = { overlay, close: closeSettings };

    const apply = () => {
      const previousMode = state.mode;
      const next = updateSettings({
        mode: layout.value,
        maxPages: Number(maxPages.value),
        density: density.value,
        theme: theme.value,
        prompts: prompts.checked,
      });
      if (next.mode !== previousMode) state.post?.setMode?.(next.mode);
    };
    [layout, maxPages, density, theme].forEach((control) => control.addEventListener('change', apply));
    prompts.addEventListener('change', apply);
    reset.addEventListener('click', () => {
      const next = resetSettings();
      layout.value = next.mode;
      maxPages.value = String(next.maxPages);
      density.value = next.density;
      theme.value = next.theme;
      prompts.checked = next.prompts;
      if (next.mode !== state.mode) state.post?.setMode?.(next.mode);
    });
    dialog.querySelector('select, input, button')?.focus();
  }

  return Object.freeze({ openSettings, closeSettings });
}

const xnsSettingsUi = createSettingsUi({
  windowObj: window,
  documentObj: document,
  state,
  createElement,
  getSettings,
  updateSettings,
  resetSettings,
});
const openSettings = (...args) => xnsSettingsUi.openSettings(...args);
const closeSettings = (...args) => xnsSettingsUi.closeSettings(...args);
