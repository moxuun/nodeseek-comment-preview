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
      .xns-modal-title { min-width:0; overflow:hidden; margin:0; font-size:17px; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-meta { display:flex; align-items:center; flex-wrap:wrap; gap:2px 10px; margin-top:3px; color:var(--xns-muted); font:11px/1.25 system-ui,sans-serif; }
      .xns-modal-meta-item { display:inline-flex; align-items:center; gap:3px; min-width:0; }
      .xns-modal-meta-item[hidden] { display:none; }
      .xns-modal-meta-label { color:var(--xns-subtle); }
      .xns-modal-meta-value { max-width:22em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .xns-modal-actions { display:flex; align-items:center; gap:6px; flex:0 0 auto; }
      .xns-modal-actions .xns-modal-tool { margin-left:0; }
      .xns-modal-header a, .xns-modal-header .xns-modal-reply, .xns-modal-close { padding:5px 8px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:var(--xns-surface-muted); cursor:pointer; text-decoration:none; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-header a:hover, .xns-modal-header a:focus-visible, .xns-modal-header .xns-modal-reply:hover, .xns-modal-header .xns-modal-reply:focus-visible, .xns-modal-close:hover, .xns-modal-close:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-modal-close { font-size:18px; line-height:1; }
      .xns-modal-toolbar { display:flex; align-items:center; gap:8px; min-height:38px; padding:5px 16px; border-bottom:1px solid rgba(100,116,139,.16); color:var(--xns-muted); background:var(--xns-surface-muted); font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-toolbar-status { display:inline-flex; flex:1 1 auto; align-items:center; min-width:0; gap:6px; overflow:hidden; color:var(--xns-muted); white-space:nowrap; text-overflow:ellipsis; }
      .xns-modal-toolbar-status > span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
      .xns-preview-status.is-loading::before { width:8px; height:8px; flex:0 0 8px; border:2px solid rgba(37,99,235,.22); border-top-color:var(--xns-accent); border-radius:50%; content:""; animation:xns-spin .9s linear infinite; }
      .xns-preview-status.is-failed { color:var(--xns-danger); }
      .xns-preview-status.is-truncated { color:#92400e; }
      .xns-preview-status > span + span::before { margin:0 4px 0 1px; color:var(--xns-subtle); content:"·"; }
      .xns-inline-retry { padding:2px 7px; border:1px solid rgba(185,28,28,.35); border-radius:5px; color:var(--xns-danger); background:var(--xns-surface); cursor:pointer; font:11px/1.2 system-ui,sans-serif; }
      .xns-inline-retry:hover, .xns-inline-retry:focus-visible { border-color:var(--xns-danger); outline:none; }
      .xns-modal-tool { display:inline-flex; align-items:center; gap:5px; margin-left:auto; padding:4px 8px; border:1px solid var(--xns-border); border-radius:6px; color:var(--xns-muted); background:var(--xns-surface); cursor:pointer; font:12px/1.2 system-ui,sans-serif; }
      .xns-modal-tool:hover, .xns-modal-tool:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); outline:none; }
      .xns-modal-tool svg { width:14px; height:14px; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; }
      .xns-modal-body { flex:1 1 auto; min-height:0; overflow:auto; padding:clamp(10px,2vw,18px); color:var(--xns-text); }
      .xns-preview-composer-host { flex:0 0 auto; padding:0 16px; border-bottom:1px solid rgba(100,116,139,.2); background:var(--xns-surface-muted); }
      .xns-preview-composer-host[hidden] { display:none; }
      .xns-preview-composer-host > .xns-preview-composer { margin:0; padding:10px 0; border-top:0; }
      .xns-modal-body img { max-width:100%; height:auto; }
      .dark-layout .xns-modal { color:var(--xns-text); background:var(--xns-surface-muted); }
      .dark-layout .xns-modal-meta { color:var(--xns-muted); }
      .dark-layout .xns-modal-meta-label { color:var(--xns-subtle); }
      .dark-layout .xns-modal-toolbar { color:var(--xns-muted); background:var(--xns-surface); }
      .dark-layout .xns-scroll-btn { border-color:var(--xns-border); color:var(--xns-muted); background:var(--xns-surface); }
      .dark-layout .xns-scroll-btn:hover, .dark-layout .xns-scroll-btn:focus-visible { border-color:var(--xns-accent-strong); color:var(--xns-accent); background:var(--xns-surface-muted); }
      .dark-layout .xns-scroll-btn[data-xns-tip]::after { color:var(--xns-text); background:var(--xns-surface); border-color:var(--xns-border); }
      .dark-layout .xns-inline-retry { color:var(--xns-danger); background:var(--xns-surface); border-color:var(--xns-border); }
      @media (max-width:800px) { .xns-preview-scroll-btns { right:6px; } .xns-scroll-btn { width:30px !important; min-width:30px !important; max-width:30px !important; height:30px !important; min-height:30px !important; max-height:30px !important; flex-basis:30px; } }
      @media (max-width:640px) { .xns-overlay { padding:0; } .xns-modal { width:100%; max-height:100vh; } .xns-modal-header { gap:8px; padding:9px 10px; } .xns-modal-actions { gap:4px; } .xns-modal-header a, .xns-modal-header .xns-modal-reply { padding:5px 6px; } .xns-modal-toolbar { padding:5px 10px; } .xns-preview-composer-host { padding:0 10px; } .xns-modal-body { padding:9px; } .xns-preview-scroll-btns { right:5px; } .xns-scroll-btn { width:28px !important; min-width:28px !important; max-width:28px !important; height:28px !important; min-height:28px !important; max-height:28px !important; flex-basis:28px; } .xns-lightbox { padding:10px; } .xns-lightbox-image { max-width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .xns-toolbar-status { width:100%; max-width:none; margin-left:0; } }
`;
