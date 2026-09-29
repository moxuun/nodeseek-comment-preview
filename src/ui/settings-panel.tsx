import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

export interface Settings {
  mode: 'thread' | 'original';
  maxPages: number;
  density: 'comfortable' | 'compact';
  theme: 'auto' | 'dark';
}

interface SettingsPanelProps {
  initialValues: Settings;
  onChange: (patch: Partial<Settings>) => Settings;
  onReset: () => Settings;
  onClose: () => void;
}

function Field({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
  return <label className="xns-settings-field">
    <span className="xns-settings-label">{label}</span>
    {children}
    {note && <small className="xns-settings-note">{note}</small>}
  </label>;
}

function SettingsPanel({ initialValues, onChange, onReset, onClose }: SettingsPanelProps) {
  const [values, setValues] = useState(initialValues);
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { closeButton.current?.focus(); }, []);
  const apply = (patch: Partial<Settings>) => setValues(onChange(patch));

  return <section className="xns-settings-panel" role="dialog" aria-modal="true" aria-labelledby="xns-settings-title">
    <header className="xns-settings-header">
      <h2 id="xns-settings-title">预览设置</h2>
      <button ref={closeButton} className="xns-settings-close" type="button" title="关闭设置" aria-label="关闭设置" onClick={onClose}>×</button>
    </header>
    <div className="xns-settings-form">
      <Field label="默认评论布局" note="只影响帖子详情页，切换会立即生效。">
        <select value={values.mode} onChange={event => apply({ mode: event.currentTarget.value === 'original' ? 'original' : 'thread' })}>
          <option value="thread">楼中楼</option><option value="original">原版评论</option>
        </select>
      </Field>
      <Field label="自动读取页数" note="最多 50 页；修改后在下次刷新或打开帖子时生效。">
        <select value={values.maxPages} onChange={event => apply({ maxPages: Number(event.currentTarget.value) })}>
          {[10, 20, 30, 50].map(pages => <option key={pages} value={pages}>{pages} 页</option>)}
        </select>
      </Field>
      <Field label="评论密度">
        <select value={values.density} onChange={event => apply({ density: event.currentTarget.value === 'compact' ? 'compact' : 'comfortable' })}>
          <option value="comfortable">舒适</option><option value="compact">紧凑</option>
        </select>
      </Field>
      <Field label="主题">
        <select value={values.theme} onChange={event => apply({ theme: event.currentTarget.value === 'dark' ? 'dark' : 'auto' })}>
          <option value="auto">跟随 NodeSeek</option><option value="dark">深色</option>
        </select>
      </Field>
    </div>
    <footer className="xns-settings-actions">
      <button type="button" onClick={() => setValues(onReset())}>恢复默认</button>
      <button className="xns-settings-primary" type="button" onClick={onClose}>完成</button>
    </footer>
  </section>;
}

export function mountSettingsPanel(host: HTMLElement, props: SettingsPanelProps): () => void {
  const root = createRoot(host);
  root.render(<SettingsPanel {...props} />);
  return () => root.unmount();
}
