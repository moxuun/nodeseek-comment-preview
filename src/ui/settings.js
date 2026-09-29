import { state } from '../core/config.js';
import { createElement } from '../core/dom.js';
import { getSettings, resetSettings, updateSettings } from '../core/preferences.js';
import { mountSettingsPanel } from './settings-panel';

// Legacy state/GM bridge; React owns only the settings panel, never site nodes.
function closeSettings() {
  state.settingsPanel?.unmount?.();
  state.settingsPanel?.overlay?.remove();
  state.settingsPanel = null;
}

function openSettings() {
  closeSettings();
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', openSettings, { once: true });
    return;
  }
  const overlay = createElement('div', 'xns-settings-overlay');
  overlay.tabIndex = -1;
  overlay.addEventListener('click', event => { if (event.target === overlay) closeSettings(); });
  document.body.appendChild(overlay);
  const apply = (update) => {
    const previousMode = state.mode;
    const next = update();
    if (next.mode !== previousMode) state.post?.setMode?.(next.mode);
    return next;
  };
  const unmount = mountSettingsPanel(overlay, {
    initialValues: getSettings(),
    onChange: patch => apply(() => updateSettings(patch)),
    onReset: () => apply(resetSettings),
    onClose: closeSettings,
  });
  state.settingsPanel = { overlay, close: closeSettings, unmount };
}

export function registerSettingsMenu() {
  if (typeof GM_registerMenuCommand !== 'function') return false;
  try {
    GM_registerMenuCommand('NodeSeek 评论预览：打开设置', openSettings);
    return true;
  } catch {
    return false;
  }
}
