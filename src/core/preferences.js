// 用户偏好存储；只保存界面设置，不保存帖子内容、登录信息或写操作数据。
function createPreferences({ windowObj, documentObj, state, storageKey, defaultMode, maxPage }) {
  const defaults = Object.freeze({
    mode: defaultMode,
    maxPages: maxPage,
    density: 'comfortable',
    theme: 'auto',
  });
  let values = { ...defaults };
  let ownsDarkClass = false;

  function normalize(raw = {}) {
    const mode = raw.mode === 'original' ? 'original' : defaultMode;
    const requestedPages = Number(raw.maxPages);
    const maxPages = [10, 20, 30, maxPage].includes(requestedPages) ? requestedPages : maxPage;
    const density = raw.density === 'compact' ? 'compact' : 'comfortable';
    const theme = raw.theme === 'dark' ? 'dark' : 'auto';
    return { mode, maxPages, density, theme };
  }

  function read() {
    try {
      const raw = JSON.parse(windowObj.localStorage?.getItem(storageKey) || '{}');
      return normalize(raw);
    } catch {
      return { ...defaults };
    }
  }

  function apply() {
    const root = documentObj.documentElement;
    if (!root) return;
    root.classList.toggle('xns-density-compact', values.density === 'compact');
    if (values.theme === 'dark') {
      if (!root.classList.contains('dark-layout')) {
        root.classList.add('dark-layout');
        ownsDarkClass = true;
      }
    } else if (ownsDarkClass) {
      root.classList.remove('dark-layout');
      ownsDarkClass = false;
    }
  }

  function save() {
    try { windowObj.localStorage?.setItem(storageKey, JSON.stringify(values)); } catch { /* 存储被禁用时仍允许本次使用。 */ }
  }

  function update(patch = {}) {
    values = normalize({ ...values, ...patch });
    state.mode = values.mode;
    save();
    apply();
    return { ...values };
  }

  function reset() {
    return update(defaults);
  }

  values = read();
  state.mode = values.mode;
  apply();

  return Object.freeze({
    get: () => ({ ...values }),
    update,
    reset,
    getMaxPage: () => values.maxPages,
    apply,
  });
}

const xnsPreferences = createPreferences({
  windowObj: window,
  documentObj: document,
  state,
  storageKey: 'xns-comment-preview-settings',
  defaultMode: DEFAULT_MODE,
  maxPage: MAX_PAGE,
});
const getSettings = (...args) => xnsPreferences.get(...args);
const updateSettings = (...args) => xnsPreferences.update(...args);
const resetSettings = (...args) => xnsPreferences.reset(...args);
const getMaxPage = (...args) => xnsPreferences.getMaxPage(...args);
const applySettings = (...args) => xnsPreferences.apply(...args);
