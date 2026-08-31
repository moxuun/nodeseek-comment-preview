// 预览弹窗壳层样式；评论卡片和内容增强样式继续由总样式管理。
const XNS_PREVIEW_SHELL_STYLES = `
      .xns-modal { position:relative; }
      .xns-preview-scroll-btns { position:absolute; top:50%; right:8px; bottom:auto; display:flex; flex-direction:column; gap:6px; z-index:3; transform:translateY(-50%); transition:opacity .3s ease; pointer-events:none; }
      .xns-scroll-btn { position:relative; box-sizing:border-box !important; width:34px !important; min-width:34px !important; max-width:34px !important; height:34px !important; min-height:34px !important; max-height:34px !important; flex:0 0 34px; padding:0 !important; border:1px solid var(--xns-border); border-radius:50%; color:var(--xns-muted); background:rgba(255,255,255,.96); display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 2px 8px rgba(15,23,42,.14); opacity:.9; line-height:1; transition:all .2s ease; pointer-events:auto; }
      .xns-scroll-btn:hover, .xns-scroll-btn:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); background:var(--xns-surface); opacity:1; transform:scale(1.05); outline:none; }
      .xns-scroll-btn[data-xns-tip]::after { position:absolute; right:calc(100% + 8px); top:50%; padding:4px 7px; border:1px solid var(--xns-border); border-radius:5px; color:var(--xns-text); background:var(--xns-surface); box-shadow:0 3px 10px rgba(15,23,42,.14); content:attr(data-xns-tip); font:12px/1.2 system-ui,sans-serif; opacity:0; pointer-events:none; transform:translateY(-50%) translateX(4px); transition:opacity .15s ease,transform .15s ease; white-space:nowrap; }
      .xns-scroll-btn:hover::after, .xns-scroll-btn:focus-visible::after { opacity:1; transform:translateY(-50%) translateX(0); }
      .xns-scroll-btn svg { width:13px; height:13px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .xns-scroll-btn.hidden { opacity:0; pointer-events:none; }
      .xns-scroll-btn.xns-action-pending { opacity:.45; pointer-events:none; }
      @keyframes xns-spin { to { transform:rotate(360deg); } }
      .xns-refresh-post.xns-action-pending svg { animation:xns-spin .9s linear infinite; }
      .xns-overlay { position:fixed; z-index:2147483000; inset:0; display:flex; align-items:stretch; justify-content:center; padding:0 clamp(32px,5vw,110px); background:rgba(15,23,42,.55); }
      .xns-modal { display:flex; flex-direction:column; width:min(1040px,100%); height:100vh; max-height:100vh; overflow:hidden; border-radius:0; color:var(--xns-text); background:var(--xns-surface); box-shadow:0 18px 55px rgba(15,23,42,.3); }
      .xns-modal-header { display:flex; align-items:center; gap:16px; padding:11px 16px; border-bottom:1px solid rgba(100,116,139,.2); }
      .xns-modal-heading { flex:1; min-width:0; }
      .xns-modal-eyebrow { display:block; margin-bottom:2px; color:var(--xns-muted); font:11px/1.2 system-ui,sans-serif; letter-spacing:.02em; }
      .xns-modal-title { min-width:0; overflow:hidden; margin:0; font-size:17px; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-meta { display:flex; align-items:center; flex-wrap:wrap; gap:2px 10px; margin-top:3px; color:var(--xns-muted); font:11px/1.25 system-ui,sans-serif; }
      .xns-modal-meta-item { display:inline-flex; align-items:center; gap:3px; min-width:0; }
      .xns-modal-meta-item[hidden] { display:none; }
      .xns-modal-meta-label { color:var(--xns-subtle); }
      .xns-modal-meta-value { max-width:22em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-actions { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
      .xns-modal-more { position:relative; }
      .xns-modal-actions .xns-modal-tool { margin-left:0; }
      .xns-modal-more-menu { position:absolute; top:calc(100% + 6px); right:0; z-index:5; display:flex; min-width:150px; flex-direction:column; gap:2px; padding:4px; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface); box-shadow:0 8px 24px rgba(15,23,42,.18); }
      .xns-modal-more-menu[hidden] { display:none; }
      .xns-modal-more-item { padding:7px 9px; border:0; border-radius:5px; color:var(--xns-muted); background:transparent; cursor:pointer; text-align:left; white-space:nowrap; font:12px/1.3 system-ui,sans-serif; }
      .xns-modal-more-item:hover, .xns-modal-more-item:focus-visible { color:var(--xns-accent); background:var(--xns-accent-soft); outline:none; }
      .xns-modal-header a, .xns-modal-header .xns-modal-reply, .xns-modal-close { padding:5px 8px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface-muted); cursor:pointer; text-decoration:none; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-header a:hover, .xns-modal-header a:focus-visible, .xns-modal-header .xns-modal-reply:hover, .xns-modal-header .xns-modal-reply:focus-visible, .xns-modal-close:hover, .xns-modal-close:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-modal-close { font-size:18px; line-height:1; }
      .xns-modal-toolbar { display:flex; align-items:center; gap:8px; min-height:38px; padding:5px 16px; border-bottom:1px solid rgba(100,116,139,.16); color:var(--xns-muted); background:var(--xns-surface-muted); font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-toolbar-label { color:var(--xns-subtle); }
      .xns-modal-mode { padding:4px 8px; border:1px solid rgba(59,130,246,.28); border-radius:5px; color:var(--xns-accent-strong); background:var(--xns-accent-soft); }
      .xns-modal-toolbar-status { display:inline-flex; flex:1 1 auto; align-items:center; min-width:0; gap:6px; overflow:hidden; color:var(--xns-muted); white-space:nowrap; text-overflow:ellipsis; }
      .xns-modal-toolbar-status > span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
      .xns-preview-status.is-loading::before { width:8px; height:8px; flex:0 0 8px; border:2px solid rgba(37,99,235,.22); border-top-color:var(--xns-accent); border-radius:50%; content:""; animation:xns-spin .9s linear infinite; }
      .xns-preview-status.is-failed { color:var(--xns-danger); }
      .xns-preview-status.is-truncated { color:#92400e; }
      .xns-preview-status > span + span::before { margin:0 4px 0 1px; color:var(--xns-subtle); content:"·"; }
      .xns-inline-retry { padding:2px 7px; border:1px solid rgba(185,28,28,.35); border-radius:5px; color:var(--xns-danger); background:var(--xns-surface); cursor:pointer; font:11px/1.2 system-ui,sans-serif; }
      .xns-inline-retry:hover, .xns-inline-retry:focus-visible { border-color:var(--xns-danger); outline:none; }
      .xns-modal-tool { display:inline-flex; align-items:center; gap:5px; margin-left:auto; padding:4px 8px; border:1px solid var(--xns-border); border-radius:6px; color:var(--xns-muted); background:var(--xns-surface); cursor:pointer; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-help-toggle { margin-left:0; min-width:26px; justify-content:center; padding-right:6px; padding-left:6px; font-weight:700; }
      .xns-modal-tool:hover, .xns-modal-tool:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-modal-tool svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .xns-modal-help { padding:8px 16px; border-bottom:1px solid rgba(59,130,246,.18); color:var(--xns-text); background:var(--xns-accent-soft); font:12px/1.45 system-ui,sans-serif; }
      .xns-modal-help[hidden] { display:none; }
      .xns-modal-help-list { display:flex; flex-wrap:wrap; gap:5px 16px; margin:5px 0 0; padding:0; list-style:none; }
      .xns-modal-help-item { display:inline-flex; align-items:center; gap:5px; }
      .xns-modal-help kbd { padding:1px 5px; border:1px solid var(--xns-border); border-bottom-width:2px; border-radius:4px; color:var(--xns-text); background:var(--xns-surface); font:11px/1.3 ui-monospace,SFMono-Regular,Consolas,monospace; }
      .xns-one-time-prompt { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 16px; border-bottom:1px solid rgba(59,130,246,.18); color:var(--xns-text); background:var(--xns-surface-muted); font:12px/1.35 system-ui,sans-serif; }
      .xns-one-time-prompt button { flex:0 0 auto; padding:3px 8px; border:1px solid rgba(59,130,246,.3); border-radius:5px; color:var(--xns-accent); background:var(--xns-surface); cursor:pointer; font:inherit; }
      .xns-one-time-prompt button:hover, .xns-one-time-prompt button:focus-visible { border-color:var(--xns-accent-strong); outline:none; }
      .xns-modal-body { overflow:auto; padding:clamp(10px,2vw,18px); color:var(--xns-text); }
      .xns-modal-body img { max-width:100%; height:auto; }
      .dark-layout .xns-modal { color:var(--xns-text); background:var(--xns-surface-muted); }
      .dark-layout .xns-modal-meta { color:var(--xns-muted); }
      .dark-layout .xns-modal-meta-label { color:var(--xns-subtle); }
      .dark-layout .xns-modal-more-menu { color:var(--xns-text); background:var(--xns-surface); border-color:var(--xns-border); }
      .dark-layout .xns-modal-more-item { color:var(--xns-muted); }
      .dark-layout .xns-modal-more-item:hover, .dark-layout .xns-modal-more-item:focus-visible { color:var(--xns-accent); background:var(--xns-accent-soft); }
      .dark-layout .xns-modal-help { color:var(--xns-text); background:var(--xns-accent-soft); border-bottom-color:rgba(96,165,250,.25); }
      .dark-layout .xns-modal-help kbd { color:var(--xns-text); background:var(--xns-surface-muted); border-color:var(--xns-border); }
      .dark-layout .xns-one-time-prompt { color:var(--xns-text); background:var(--xns-surface); border-bottom-color:rgba(96,165,250,.25); }
      .dark-layout .xns-one-time-prompt button { color:var(--xns-accent); background:var(--xns-surface-muted); border-color:var(--xns-border); }
      .dark-layout .xns-modal-toolbar { color:var(--xns-muted); background:var(--xns-surface); }
      .dark-layout .xns-modal-eyebrow, .dark-layout .xns-modal-toolbar-label { color:var(--xns-muted); }
      .dark-layout .xns-modal-mode { color:var(--xns-accent); border-color:var(--xns-border); background:var(--xns-accent-soft); }
      .dark-layout .xns-scroll-btn { border-color:var(--xns-border); color:var(--xns-muted); background:var(--xns-surface); }
      .dark-layout .xns-scroll-btn:hover, .dark-layout .xns-scroll-btn:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); background:var(--xns-surface-muted); }
      .dark-layout .xns-scroll-btn[data-xns-tip]::after { color:var(--xns-text); background:var(--xns-surface); border-color:var(--xns-border); }
      .dark-layout .xns-inline-retry { color:var(--xns-danger); background:var(--xns-surface); border-color:var(--xns-border); }
      @media (max-width:800px) { .xns-preview-scroll-btns { right:6px; } .xns-scroll-btn { width:30px !important; min-width:30px !important; max-width:30px !important; height:30px !important; min-height:30px !important; max-height:30px !important; flex-basis:30px; } }
      @media (max-width:640px) { .xns-overlay { padding:0; } .xns-modal { width:100%; max-height:100vh; } .xns-modal-header { gap:8px; padding:9px 10px; } .xns-modal-eyebrow { display:none; } .xns-modal-actions { gap:4px; } .xns-modal-header a, .xns-modal-header .xns-modal-reply { padding:5px 6px; } .xns-modal-toolbar { padding:5px 10px; } .xns-modal-body { padding:9px; } .xns-preview-scroll-btns { right:5px; } .xns-scroll-btn { width:28px !important; min-width:28px !important; max-width:28px !important; height:28px !important; min-height:28px !important; max-height:28px !important; flex-basis:28px; } .xns-lightbox { padding:10px; } .xns-lightbox-image { max-width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .xns-toolbar-status { width:100%; max-width:none; margin-left:0; } }
`;
