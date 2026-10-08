import { DEFAULT_MAX_PAGES, DEFAULT_MODE, MAX_PAGE, state } from './config.js';
import type { PostMode } from './config.js';
import type { Settings } from '../ui/settings-panel';

/** 偏好存储依赖；测试可注入替身。 */
interface PreferencesDeps {
  windowObj: { localStorage?: Storage | null };
  documentObj: { documentElement: HTMLElement | null };
  state: { mode: PostMode };
  storageKey: string;
  defaultMode: Settings['mode'];
  maxPage: number;
  defaultMaxPages: number;
}

// 用户偏好存储；只保存界面设置，不保存帖子内容、登录信息或写操作数据。
function createPreferences({ windowObj, documentObj, state, storageKey, defaultMode, maxPage, defaultMaxPages }: PreferencesDeps) {
  const defaults: Readonly<Settings> = Object.freeze({
    mode: defaultMode,
    maxPages: defaultMaxPages,
    density: 'comfortable',
    theme: 'auto',
  });
  let values: Settings = { ...defaults };
  let ownsDarkClass = false;

  function normalize(raw: Partial<Settings> = {}): Settings {
    const mode = raw.mode === 'original' ? 'original' : defaultMode;
    const requestedPages = Number(raw.maxPages);
    const maxPages = [10, 20, 25, 30, maxPage].includes(requestedPages) ? requestedPages : defaultMaxPages;
    const density = raw.density === 'compact' ? 'compact' : 'comfortable';
    const theme = raw.theme === 'dark' ? 'dark' : 'auto';
    return { mode, maxPages, density, theme };
  }

  function read(): Settings {
    try {
      const raw = JSON.parse(windowObj.localStorage?.getItem(storageKey) || '{}');
      return normalize(raw);
    } catch {
      return { ...defaults };
    }
  }

  function apply(): void {
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

  function save(): void {
    try { windowObj.localStorage?.setItem(storageKey, JSON.stringify(values)); } catch { /* 存储被禁用时仍允许本次使用。 */ }
  }

  function update(patch: Partial<Settings> = {}): Settings {
    values = normalize({ ...values, ...patch });
    state.mode = values.mode;
    save();
    apply();
    return { ...values };
  }

  function reset(): Settings {
    return update(defaults);
  }

  values = read();
  state.mode = values.mode;
  apply();

  return Object.freeze({
    get: (): Settings => ({ ...values }),
    update,
    reset,
    getMaxPage: (): number => values.maxPages,
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
  defaultMaxPages: DEFAULT_MAX_PAGES,
});

const getSettings = (): Settings => xnsPreferences.get();
const updateSettings = (patch?: Partial<Settings>): Settings => xnsPreferences.update(patch);
const resetSettings = (): Settings => xnsPreferences.reset();
const getMaxPage = (): number => xnsPreferences.getMaxPage();

export { getMaxPage, getSettings, resetSettings, updateSettings };
