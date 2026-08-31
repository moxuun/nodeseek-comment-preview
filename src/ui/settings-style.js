// 设置中心的独立样式片段；由总样式安装器统一注入。
const XNS_SETTINGS_STYLES = `
      .xns-settings-overlay { position:fixed; z-index:2147483600; inset:0; display:flex; align-items:center; justify-content:center; padding:18px; background:rgba(15,23,42,.5); }
      .xns-settings-panel { box-sizing:border-box; width:min(500px,100%); max-height:calc(100vh - 36px); overflow:auto; padding:16px; border:1px solid var(--xns-border); border-radius:10px; color:var(--xns-text); background:var(--xns-surface); box-shadow:0 18px 55px rgba(15,23,42,.3); font:13px/1.4 system-ui,sans-serif; }
      .xns-settings-header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:12px; }
      .xns-settings-header h2 { margin:0; font-size:18px; line-height:1.3; }
      .xns-settings-close { padding:2px 8px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface-muted); cursor:pointer; font-size:20px; line-height:1; }
      .xns-settings-close:hover, .xns-settings-close:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-settings-form { display:grid; gap:11px; }
      .xns-settings-field { display:grid; grid-template-columns:minmax(110px,1fr) minmax(150px,1.5fr); align-items:center; gap:4px 12px; }
      .xns-settings-label { color:var(--xns-muted); font-weight:600; }
      .xns-settings-field select { min-width:0; padding:5px 7px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface); font:inherit; }
      .xns-settings-field select:focus-visible { outline:2px solid rgba(59,130,246,.45); outline-offset:1px; }
      .xns-settings-note { grid-column:2; color:var(--xns-muted); font-size:11px; }
      .xns-settings-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; padding-top:12px; border-top:1px solid rgba(100,116,139,.16); }
      .xns-settings-actions button { padding:6px 11px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface); cursor:pointer; font:inherit; }
      .xns-settings-actions button:hover, .xns-settings-actions button:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-settings-actions .xns-settings-primary { color:#fff; border-color:var(--xns-accent-strong); background:var(--xns-accent-strong); }
      .xns-settings-actions .xns-settings-primary:hover, .xns-settings-actions .xns-settings-primary:focus-visible { color:#fff; background:var(--xns-accent); }
      .xns-density-compact .xns-preview-thread > .content-item { padding-top:5px; padding-bottom:4px; }
      .xns-density-compact .xns-preview-thread .xns-comment-child { padding-top:4px !important; padding-bottom:3px !important; }
      .xns-density-compact .xns-post-toolbar { padding:5px; }
      .dark-layout .xns-settings-overlay { background:rgba(2,6,23,.72); }
      @media (max-width:640px) {
        .xns-settings-overlay { padding:10px; }
        .xns-settings-panel { max-height:calc(100vh - 20px); padding:12px; }
        .xns-settings-field { grid-template-columns:1fr; gap:3px; }
        .xns-settings-note { grid-column:1; }
      }
`;
