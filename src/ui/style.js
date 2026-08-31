// 全局样式注入。样式是构建期静态资源，运行时只负责一次性安装。
function createStyleInstaller({ documentObj, styleId, ansiColors, ansiFgHex, ansiBgHex, ansiBrightHex, styleTokens, settingsStyles, previewShellStyles }) {
function ansiRulesFor(prefix, property, hexes) {
  return ansiColors.map((name, index) => `.xns-preview-content .xns-ansi-${prefix}-${name} { ${property}:${hexes[index]}; }`).join(' ');
}

function installStyle() {
  if (documentObj.getElementById(styleId)) return;
  const style = documentObj.createElement('style');
  style.id = styleId;
  style.textContent = `
      ${styleTokens}
      ${settingsStyles}
      ${previewShellStyles}
      .xns-post-toolbar, .xns-post-toolbar * { box-sizing: border-box; }
      .xns-post-toolbar { position:fixed; right:42px; bottom:166px; z-index:1000; display:flex; align-items:center; flex-wrap:wrap; gap:6px; margin:0; padding:7px; border:1px solid var(--xns-border); border-radius:8px; color:var(--xns-text); background:rgba(248,250,252,.96); font:13px/1.3 system-ui,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.25); }
      .xns-post-toolbar button { padding:5px 10px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:transparent; cursor:pointer; font:inherit; }
      .xns-post-toolbar button:hover, .xns-post-toolbar button:focus-visible { border-color:var(--xns-accent-strong); outline:none; }
      .xns-post-toolbar button[aria-pressed="true"] { color:var(--xns-accent); border-color:var(--xns-accent-strong); background:var(--xns-accent-soft); }
      .xns-post-settings { margin-left:0 !important; }
      .xns-post-toolbar-label { color:var(--xns-muted); font-size:12px; }
      .xns-post-mode-switch { display:inline-flex; padding:2px; border:1px solid rgba(100,116,139,.25); border-radius:6px; background:rgba(148,163,184,.08); }
      .xns-post-mode-switch button { padding:4px 8px; border:0; border-radius:4px; background:transparent; }
      .xns-post-mode-switch button:hover, .xns-post-mode-switch button:focus-visible { border-color:transparent; color:#2563eb; background:#eff6ff; }
      .xns-post-mode-switch button[aria-pressed="true"] { border-color:transparent; color:#1d4ed8; background:#fff; box-shadow:0 1px 3px rgba(15,23,42,.12); }
      .xns-toolbar-status { display:inline-flex; align-items:center; gap:6px; max-width:min(62vw,720px); min-width:0; margin-left:auto; overflow:hidden; color:#64748b; font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
      .xns-toolbar-status.is-loading::before { width:8px; height:8px; flex:0 0 8px; border:2px solid rgba(37,99,235,.22); border-top-color:#2563eb; border-radius:50%; content:""; animation:xns-spin .9s linear infinite; }
      .xns-toolbar-status.is-failed { color:var(--xns-danger); }
      .xns-loading, .xns-status { margin:10px 0; padding:7px 10px; border:1px solid rgba(100,116,139,.2); border-radius:7px; color:#64748b; background:rgba(148,163,184,.08); font:13px/1.4 system-ui,sans-serif; }
      .xns-comment-root[data-xns-floor], .xns-comment-child[data-xns-floor] { position:relative; }
      .xns-preview-thread .floor-link-wrapper, .xns-preview-content .floor-link-wrapper { position:absolute; top:9px; right:10px; }
      .xns-preview-thread .floor-link-wrapper .floor-link, .xns-preview-content .floor-link-wrapper .floor-link { padding:2px 5px; border-radius:4px; color:#c5c5c5; background:rgba(148,163,184,.1); font-size:13px; font-weight:400; line-height:19.5px; text-decoration:none; cursor:pointer; }
      .xns-preview-thread .floor-link-wrapper .floor-link:hover, .xns-preview-thread .floor-link-wrapper .floor-link:focus-visible, .xns-preview-content .floor-link-wrapper .floor-link:hover, .xns-preview-content .floor-link-wrapper .floor-link:focus-visible { color:#2563eb; background:#eff6ff; outline:none; }
      .xns-comment-child { margin-top:7px !important; margin-left:clamp(8px,2vw,28px) !important; padding-left:clamp(8px,1.5vw,18px) !important; border-left:2px solid rgba(59,130,246,.35); }
      .xns-reply-list { margin:6px 0 0 !important; padding:0 !important; list-style:none !important; }
      .xns-floor-highlight { animation:xns-floor-highlight 1.8s ease both; }
      @keyframes xns-floor-highlight { 0%,100%{box-shadow:none} 20%{box-shadow:0 0 0 4px rgba(59,130,246,.3)} }
      .xns-preview-content { font-size:14px; line-height:1.45; }
      .xns-preview-content pre { box-sizing:border-box; max-width:100%; overflow:auto; white-space:pre; }
      .xns-preview-content pre.xns-code-block { position:relative !important; padding-top:30px; font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; }
      .xns-preview-content pre.xns-code-block code { font:inherit; }
      .xns-preview-content .xns-code-copy-btn { position:absolute; top:8px; right:8px; z-index:2; padding:2px 8px; border:0; border-radius:3px; color:#fff; background:#4caf50; cursor:pointer; font:12px/1.2 system-ui,sans-serif; opacity:.85; }
      .xns-preview-content .xns-code-copy-btn:hover, .xns-preview-content .xns-code-copy-btn:focus-visible { opacity:1; outline:none; }
      .xns-preview-content .xns-code-copy-btn.xns-copy-failed { background:#dc2626; }
      ${ansiRulesFor('fg', 'color', ansiFgHex)}
      ${ansiRulesFor('fg-bright', 'color', ansiBrightHex)}
      ${ansiRulesFor('bg', 'background', ansiBgHex)}
      ${ansiRulesFor('bg-bright', 'background', ansiBrightHex)}
      .xns-preview-content .xns-ansi-bold { font-weight:700; } .xns-preview-content .xns-ansi-dim { opacity:.72; } .xns-preview-content .xns-ansi-italic { font-style:italic; } .xns-preview-content .xns-ansi-underline { text-decoration:underline; } .xns-preview-content .xns-ansi-strike { text-decoration:line-through; } .xns-preview-content .xns-ansi-hidden { visibility:hidden; } .xns-preview-content .xns-ansi-inverse { filter:invert(1); }
      .xns-preview-content .xns-markdown-tabs { margin:8px 0; overflow:hidden; border:1px solid rgba(100,116,139,.24); border-radius:7px; background:#f8fafc; }
      .xns-preview-content .xns-markdown-tabs-nav { display:flex; align-items:center; flex-wrap:wrap; gap:4px; padding:5px 6px; border-bottom:1px solid rgba(100,116,139,.2); background:rgba(148,163,184,.1); }
      .xns-preview-content .xns-markdown-tab { padding:5px 9px; border:1px solid transparent; border-radius:5px; color:#64748b; background:transparent; cursor:pointer; font:13px/1.25 system-ui,sans-serif; }
      .xns-preview-content .xns-markdown-tab:hover, .xns-preview-content .xns-markdown-tab:focus-visible { color:#2563eb; outline:none; }
      .xns-preview-content .xns-markdown-tab.is-active { border-color:rgba(59,130,246,.28); color:#1d4ed8; background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.08); }
      .xns-preview-content .xns-markdown-tab-panel { display:none; padding:8px 10px; }
      .xns-preview-content .xns-markdown-tab-panel.is-active { display:block; }
      .xns-preview-content .nsk-magic-tabs { margin:8px 0; overflow:hidden; border:1px solid rgba(100,116,139,.24); border-radius:7px; background:#f8fafc; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title { display:inline-block; box-sizing:border-box; margin:0; padding:8px 12px; border:1px solid transparent; border-bottom:0; color:#64748b; background:transparent; cursor:pointer; font-size:14px; line-height:1.3; vertical-align:bottom; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title:hover, .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title:focus-visible { color:#2563eb; outline:none; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title.xns-active { border-color:rgba(100,116,139,.24); border-radius:7px 7px 0 0; color:#1d4ed8; background:#fff; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-body { display:none; clear:both; box-sizing:border-box; padding:8px 10px; border-top:1px solid rgba(100,116,139,.24); }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-body.xns-active { display:block; }
      .xns-preview-content h1, .xns-preview-content h2, .xns-preview-content h3, .xns-preview-content p { line-height:1.45; }
      .xns-preview-content h1, .xns-preview-content h2, .xns-preview-content h3 { margin-top:0; }
      .xns-preview-content p { margin:3px 0 6px; }
      .xns-preview-post { margin:0 0 10px; padding:8px 10px; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface-muted); }
      .xns-preview-post h1, .xns-preview-post h1.post-title, .xns-preview-post .post-title { margin:0 0 4px; font-size:20px; line-height:1.3; }
      .xns-preview-post h2 { margin:5px 0 3px; font-size:17px; }
      .xns-preview-post .nsk-content-meta-info { display:flex; align-items:center; flex-wrap:wrap; gap:4px 9px; margin:0 0 4px; color:#64748b; font-size:12px; line-height:1.25; }
      .xns-preview-post .post-content, .xns-preview-post article.post-content { margin:0; line-height:1.5; }
      .xns-preview-post .post-content p, .xns-preview-post article.post-content p { margin:2px 0 5px; }
      .xns-preview-post .post-content > :first-child, .xns-preview-post article.post-content > :first-child { margin-top:0; }
      .xns-preview-post .post-content > :last-child, .xns-preview-post article.post-content > :last-child { margin-bottom:0; }
      .xns-preview-comments { margin-top:10px; padding-top:8px; border-top:1px solid rgba(100,116,139,.2); }
      .xns-preview-comments > h3 { margin:0 0 7px; font-size:15px; line-height:1.3; }
      .xns-preview-thread { margin:0; padding:0; list-style:none; }
      .xns-virtual-list > .xns-virtual-spacer { display:block !important; height:0; margin:0 !important; padding:0 !important; border:0 !important; list-style:none !important; pointer-events:none; }
      .xns-virtual-list > .content-item[data-xns-depth] { margin-left:var(--xns-indent,0px) !important; }
      .xns-preview-thread > .content-item { margin:4px 0; padding:8px 10px 7px; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface-muted); content-visibility:auto; contain-intrinsic-size:150px; }
      .xns-preview-thread > .content-item[data-xns-floor] { border-left:3px solid rgba(37,99,235,.72); }
      .xns-preview-thread .xns-comment-child { margin:3px 0 0 14px !important; padding:7px 8px 6px 10px !important; border:0 !important; border-left:2px solid rgba(59,130,246,.4) !important; border-radius:0 !important; background:transparent !important; }
      .xns-preview-thread .nsk-content-meta-info { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; margin:0 0 3px; color:#64748b; font-size:12px; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .content-info, .xns-preview-content .nsk-content-meta-info .date-created { display:inline-flex; align-items:center; flex-wrap:wrap; gap:5px; margin:0 !important; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .date-created time { display:inline; white-space:nowrap; }
      .xns-preview-content .user-info-display { position:static !important; display:inline-flex !important; align-items:center; transform:none !important; margin:0 !important; padding:0 !important; }
      .xns-preview-thread .post-content, .xns-preview-thread article.post-content { margin:0; line-height:1.45; }
      .xns-preview-thread .post-content p, .xns-preview-thread article.post-content p { margin:2px 0 4px; }
      .xns-preview-thread .post-content > :first-child, .xns-preview-thread article.post-content > :first-child { margin-top:0; }
      .xns-preview-thread .post-content > :last-child, .xns-preview-thread article.post-content > :last-child { margin-bottom:0; }
      .xns-preview-thread .comment-menu, .xns-preview-menu { display:flex; align-items:center; flex-wrap:wrap; gap:2px 5px; margin-top:7px; padding-top:5px; border-top:1px solid rgba(100,116,139,.13); color:#8b95a1; font:12px/1.2 system-ui,sans-serif; }
      .xns-preview-thread .comment-menu > .menu-item, .xns-preview-menu > .menu-item { display:inline-flex; align-items:center; gap:4px; min-height:22px; padding:2px 5px; border:0; border-radius:4px; color:inherit; background:transparent; cursor:pointer; text-decoration:none; }
      .xns-preview-thread .comment-menu > .menu-item:hover, .xns-preview-thread .comment-menu > .menu-item:focus-visible, .xns-preview-menu > .menu-item:hover, .xns-preview-menu > .menu-item:focus-visible { color:#2563eb; background:#eff6ff; outline:none; }
      .xns-preview-thread .comment-menu > .menu-item[data-xns-action="quote"], .xns-preview-thread .comment-menu > .menu-item[data-xns-action="reply"], .xns-preview-menu > .menu-item[data-xns-action="quote"], .xns-preview-menu > .menu-item[data-xns-action="reply"] { margin-left:4px; }
      .xns-preview-thread .xns-action-icon, .xns-preview-menu .xns-action-icon { display:inline-flex; min-width:14px; justify-content:center; color:inherit; font-size:14px; line-height:1; }
      .xns-preview-thread .xns-action-count, .xns-preview-menu .xns-action-count { font-variant-numeric:tabular-nums; }
      .xns-preview-thread .comment-menu > .menu-item.xns-action-pending, .xns-preview-menu > .menu-item.xns-action-pending { opacity:.55; pointer-events:none; }
      .xns-preview-thread .comment-menu > .menu-item.xns-action-failed, .xns-preview-menu > .menu-item.xns-action-failed { color:#b91c1c; }
      .xns-action-state { font-size:11px; }
      .xns-preview-composer { margin-top:10px; padding-top:8px; border-top:1px solid rgba(100,116,139,.2); }
      .xns-preview-composer-title { margin:0 0 6px; font-size:14px; }
      .xns-preview-composer textarea { display:block; box-sizing:border-box; width:100%; min-height:100px; resize:vertical; padding:8px; border:1px solid rgba(100,116,139,.35); border-radius:6px; color:inherit; background:transparent; font:14px/1.5 system-ui,sans-serif; }
      .xns-preview-composer-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px; }
      .xns-preview-composer button, .xns-preview-composer a { padding:5px 10px; border:1px solid rgba(100,116,139,.3); border-radius:6px; color:inherit; background:transparent; cursor:pointer; text-decoration:none; font:13px/1.2 system-ui,sans-serif; }
      .xns-preview-composer button:hover, .xns-preview-composer button:focus-visible, .xns-preview-composer a:hover, .xns-preview-composer a:focus-visible { border-color:#3b82f6; outline:none; }
      .xns-preview-composer-status { color:#64748b; font-size:12px; }
      .xns-image-error { display:block; margin-top:5px; color:#b91c1c; font:12px/1.4 system-ui,sans-serif; }
      .xns-preview-content .vote-panel { margin:8px 0; }
      .xns-preview-content .vote-panel .pure-form { padding:2px 0; }
      .xns-preview-content .vote-panel form { background:#fbfbfb; border:1px solid rgba(100,116,139,.2); border-radius:7px; padding:8px 10px; }
      .xns-preview-content .vote-panel .vote-stat { display:flex; align-items:flex-start; gap:6px; margin:4px 0; }
      .xns-preview-content .vote-panel input[type="radio"] { margin-top:3px; flex:0 0 auto; }
      .xns-preview-content .vote-panel button { margin-top:8px; padding:4px 14px; border:1px solid rgba(0,120,231,.4); border-radius:6px; color:#0078e7; background:transparent; cursor:pointer; font:13px/1.3 system-ui,sans-serif; }
      .xns-preview-content .vote-panel button:disabled { opacity:.55; cursor:not-allowed; }
      .xns-vote-status { margin-top:6px; color:#64748b; font-size:12px; }
      .xns-vote-status:empty { display:none; }
      .xns-vote-results { display:flex; flex-direction:column; gap:6px; margin:4px 0 6px; }
      .xns-vote-results .xns-vote-result { display:flex; flex-direction:column; gap:2px; }
      .xns-vote-results .vote-item-text { font-size:13px; line-height:1.3; }
      .xns-vote-results .xns-vote-bar-wrap { height:16px; border:1px solid rgba(100,116,139,.25); border-radius:4px; background:rgba(148,163,184,.12); overflow:hidden; }
      .xns-vote-results .xns-vote-bar { box-sizing:border-box; min-width:26px; height:100%; padding:0 6px; display:flex; align-items:center; justify-content:flex-end; color:#fff; background:#3b82f6; font:11px/16px system-ui,sans-serif; border-radius:3px 0 0 3px; }
      .xns-vote-results .xns-vote-mine .vote-item-text { color:#1d4ed8; font-weight:600; }
      .xns-vote-results .xns-vote-result-meta { color:#64748b; font-size:12px; }
      .xns-vote-total { margin-top:4px; color:#64748b; font-size:12px; }
      .xns-preview-content img { cursor:zoom-in; }
      .xns-lightbox { position:fixed; z-index:2147483500; inset:0; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(2,6,23,.88); }
      .xns-lightbox-stage { position:relative; display:flex; align-items:center; justify-content:center; width:100%; height:100%; overflow:hidden; cursor:grab; }
      .xns-lightbox-stage.xns-dragging { cursor:grabbing; }
      .xns-lightbox-image { max-width:calc(100vw - 48px); max-height:calc(100vh - 48px); object-fit:contain; user-select:none; -webkit-user-drag:none; transform-origin:center; cursor:grab; }
      .xns-lightbox-stage.xns-dragging .xns-lightbox-image { cursor:grabbing; }
      .xns-lightbox-close, .xns-lightbox-open { position:absolute; z-index:1; padding:6px 10px; border:1px solid rgba(255,255,255,.35); border-radius:6px; color:#fff; background:rgba(15,23,42,.58); cursor:pointer; text-decoration:none; font:13px/1.2 system-ui,sans-serif; }
      .xns-lightbox-close { top:10px; right:10px; font-size:20px; line-height:1; }
      .xns-lightbox-open { left:10px; bottom:10px; }
      .xns-lightbox-close:hover, .xns-lightbox-open:hover, .xns-lightbox-close:focus-visible, .xns-lightbox-open:focus-visible { background:rgba(15,23,42,.9); outline:none; }
      .dark-layout .xns-preview-post, .dark-layout .xns-preview-thread > .content-item { color:#e5e7eb; background:#111827; }
      .dark-layout .xns-preview-thread > .content-item[data-xns-floor] { border-left-color:#60a5fa; }
      .dark-layout .xns-preview-thread .xns-comment-child { border-left-color:rgba(96,165,250,.6) !important; }
      .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link { background:rgba(148,163,184,.14); }
      .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link:hover, .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link:focus-visible, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link:hover, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link:focus-visible { color:#93c5fd; background:rgba(59,130,246,.18); }
      .dark-layout .xns-preview-thread .comment-menu > .menu-item:hover, .dark-layout .xns-preview-thread .comment-menu > .menu-item:focus-visible, .dark-layout .xns-preview-menu > .menu-item:hover, .dark-layout .xns-preview-menu > .menu-item:focus-visible { color:#93c5fd; background:rgba(59,130,246,.18); }
      .dark-layout .xns-preview-content pre.xns-code-block { color:#e5e7eb; background:#0b1220; }
      .dark-layout .xns-preview-content .xns-ansi-fg-black { color:#e5e7eb; } .dark-layout .xns-preview-content .xns-ansi-fg-white { color:#111827; }
      .dark-layout .xns-preview-content .xns-markdown-tabs { background:#111827; } .dark-layout .xns-preview-content .xns-markdown-tabs-nav { background:rgba(15,23,42,.65); } .dark-layout .xns-preview-content .xns-markdown-tab.is-active { color:#93c5fd; background:#18202b; }
      .dark-layout .xns-preview-content .nsk-magic-tabs { background:#111827; } .dark-layout .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title.xns-active { color:#93c5fd; background:#18202b; }
      .dark-layout .xns-post-toolbar { color:#e5e7eb; background:#1e293b; border-color:rgba(148,163,184,.3); }
      .dark-layout .xns-post-toolbar button { color:#e5e7eb; border-color:rgba(148,163,184,.35); }
      .dark-layout .xns-post-toolbar button[aria-pressed="true"] { color:#93c5fd; border-color:#3b82f6; background:rgba(59,130,246,.22); }
      .dark-layout .xns-post-toolbar-label { color:#9ca3af; }
      .dark-layout .xns-post-mode-switch { border-color:rgba(148,163,184,.35); background:rgba(15,23,42,.35); }
      .dark-layout .xns-post-mode-switch button { border-color:transparent; }
      .dark-layout .xns-post-mode-switch button:hover, .dark-layout .xns-post-mode-switch button:focus-visible { color:#93c5fd; background:rgba(59,130,246,.18); }
      .dark-layout .xns-post-mode-switch button[aria-pressed="true"] { color:#93c5fd; background:#111827; box-shadow:0 1px 3px rgba(0,0,0,.3); }
      .dark-layout .xns-preview-composer textarea { color:#e5e7eb; }
      .dark-layout .xns-preview-composer button, .dark-layout .xns-preview-composer a { color:#e5e7eb; border-color:rgba(148,163,184,.35); }
      .dark-layout .xns-preview-content .vote-panel form { color:#e5e7eb; background:#111827; border-color:rgba(148,163,184,.25); }
      .dark-layout .xns-preview-content .vote-panel button { color:#93c5fd; border-color:rgba(59,130,246,.5); }
      .dark-layout .xns-vote-results .xns-vote-bar { color:#0b1220; background:#60a5fa; }
      .dark-layout .xns-vote-results .xns-vote-mine .vote-item-text { color:#93c5fd; }
      .dark-layout .xns-toolbar-status, .dark-layout .xns-preview-status, .dark-layout .xns-loading, .dark-layout .xns-status, .dark-layout .xns-vote-status { color:#9ca3af; }
      .dark-layout .xns-toolbar-status.is-failed { color:#fca5a5; }
      .dark-layout .xns-preview-status.is-failed { color:#fca5a5; }
      .dark-layout .xns-preview-status.is-truncated { color:#fcd34d; }
      .dark-layout .xns-preview-thread .floor-link-wrapper .floor-link, .dark-layout .xns-preview-content .floor-link-wrapper .floor-link { color:#6b7280; }
      @media (max-width:640px) { .xns-preview-post { padding:7px 8px; } .xns-preview-post h1, .xns-preview-post h1.post-title, .xns-preview-post .post-title { font-size:18px; } .xns-lightbox { padding:10px; } .xns-lightbox-image { max-width:calc(100vw - 20px); max-height:calc(100vh - 20px); } .xns-toolbar-status { width:100%; max-width:none; margin-left:0; } }
    `;
  (documentObj.head || documentObj.documentElement || documentObj.body)?.appendChild(style);
}

  return Object.freeze({ ansiRulesFor, installStyle });
}

const xnsStyleInstaller = createStyleInstaller({
  documentObj: document,
  styleId: STYLE_ID,
  ansiColors: ANSI_COLORS,
  ansiFgHex: ANSI_FG_HEX,
  ansiBgHex: ANSI_BG_HEX,
  ansiBrightHex: ANSI_BRIGHT_HEX,
  styleTokens: XNS_STYLE_TOKENS,
  settingsStyles: XNS_SETTINGS_STYLES,
  previewShellStyles: XNS_PREVIEW_SHELL_STYLES,
});
const ansiRulesFor = (...args) => xnsStyleInstaller.ansiRulesFor(...args);
const installStyle = (...args) => xnsStyleInstaller.installStyle(...args);
