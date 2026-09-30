import { ANSI_BG_HEX, ANSI_BRIGHT_HEX, ANSI_COLORS, ANSI_FG_HEX, STYLE_ID } from '../core/config.js';
import { XNS_PREVIEW_SHELL_STYLES } from './preview-shell-style.js';
import { XNS_SETTINGS_STYLES } from './settings-style.js';
import { XNS_STYLE_TOKENS } from './tokens.js';

/** 样式注入依赖；样式文本是构建期静态资源，运行时只负责一次性安装。 */
interface StyleInstallerDeps {
  documentObj: Document;
  styleId: string;
  ansiColors: readonly string[];
  ansiFgHex: readonly string[];
  ansiBgHex: readonly string[];
  ansiBrightHex: readonly string[];
  styleTokens: string;
  settingsStyles: string;
  previewShellStyles: string;
}

// 全局样式注入。样式是构建期静态资源，运行时只负责一次性安装。
function createStyleInstaller({ documentObj, styleId, ansiColors, ansiFgHex, ansiBgHex, ansiBrightHex, styleTokens, settingsStyles, previewShellStyles }: StyleInstallerDeps) {
function ansiRulesFor(prefix: string, property: string, hexes: readonly string[]): string {
  return ansiColors.map((name, index) => `.xns-preview-content .xns-ansi-${prefix}-${name} { ${property}:${hexes[index]}; }`).join(' ');
}

function installStyle(): void {
  if (documentObj.getElementById(styleId)) return;
  const style = documentObj.createElement('style');
  style.id = styleId;
  style.textContent = `
      ${styleTokens}
      ${settingsStyles}
      ${previewShellStyles}
      .xns-post-toolbar, .xns-post-toolbar * { box-sizing: border-box; }
      /* 右边缘停靠：right 必须让开 NodeSeek 自己那列固定按钮（宽度约 48–56px，右侧内缩约 8–12px），
         否则窄屏下会盖住设置/反馈/分享/回顶。max-width 保证窄屏时面板不会把左边挤出屏幕。 */
      .xns-post-toolbar { position:fixed; right:78px; bottom:166px; z-index:1000; display:flex; align-items:center; flex-wrap:wrap; gap:6px; max-width:calc(100vw - 96px); margin:0; padding:7px; border:1px solid var(--xns-border); border-radius:8px; color:var(--xns-text); background:rgba(248,250,252,.96); font:13px/1.3 system-ui,sans-serif; box-shadow:0 4px 16px rgba(0,0,0,.25); }
      .xns-post-toolbar button { padding:5px 10px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:transparent; cursor:pointer; font:inherit; }
      .xns-post-toolbar button:hover, .xns-post-toolbar button:focus-visible { border-color:var(--xns-accent-strong); outline:none; }
      .xns-post-toolbar button[aria-pressed="true"] { color:var(--xns-accent); border-color:var(--xns-accent-strong); background:var(--xns-accent-soft); }
      .xns-post-mode-switch { display:inline-flex; padding:2px; border:1px solid var(--xns-border); border-radius:6px; background:var(--xns-accent-soft); }
      .xns-post-mode-switch button { padding:4px 8px; border:0; border-radius:4px; background:transparent; }
      .xns-post-mode-switch button:hover, .xns-post-mode-switch button:focus-visible { border-color:transparent; color:var(--xns-accent); background:var(--xns-accent-soft); }
      .xns-post-mode-switch button[aria-pressed="true"] { border-color:transparent; color:var(--xns-accent-strong); background:var(--xns-surface); box-shadow:0 1px 3px rgba(0,0,0,.12); }
      .xns-toolbar-status { display:inline-flex; align-items:center; gap:6px; max-width:min(62vw,720px); min-width:0; margin-left:auto; overflow:hidden; color:var(--xns-muted); font-size:12px; text-overflow:ellipsis; white-space:nowrap; }
      .xns-toolbar-status.is-loading::before { width:8px; height:8px; flex:0 0 8px; border:2px solid rgba(46,163,79,.35); border-top-color:var(--xns-accent); border-radius:50%; content:""; animation:xns-spin .9s linear infinite; }
      .xns-toolbar-status.is-failed { color:var(--xns-danger); }
      .xns-loading, .xns-status { margin:10px 0; padding:7px 10px; border:1px solid var(--xns-border); border-radius:7px; color:var(--xns-muted); background:var(--xns-accent-soft); font:13px/1.4 system-ui,sans-serif; }
      .xns-comment-root[data-xns-floor], .xns-comment-child[data-xns-floor] { position:relative; }
      .xns-preview-thread .floor-link-wrapper, .xns-preview-content .floor-link-wrapper { position:absolute; top:9px; right:10px; }
      .xns-preview-thread .floor-link-wrapper .floor-link, .xns-preview-content .floor-link-wrapper .floor-link { padding:2px 5px; border-radius:4px; color:var(--xns-subtle); background:var(--xns-accent-soft); font-size:13px; font-weight:400; line-height:19.5px; text-decoration:none; cursor:pointer; }
      .xns-preview-thread .floor-link-wrapper .floor-link:hover, .xns-preview-thread .floor-link-wrapper .floor-link:focus-visible, .xns-preview-content .floor-link-wrapper .floor-link:hover, .xns-preview-content .floor-link-wrapper .floor-link:focus-visible { color:var(--xns-accent); background:var(--xns-accent-soft); outline:none; }
      /* 楼中楼：每个子楼层都是一张和顶层楼层外观相同的卡片（只是没有顶层那条楼层身份边框），
         整张卡片按层级右移 18px（margin-left = --xns-indent），层级一眼可见。
         关系线画在卡片左侧的空白里，由 ::before 覆盖层承载：覆盖层向左越出一整段缩进（再补回卡片 1px 左边框），
         于是它的左边缘与列表左边缘对齐，坐标仍与 JS（renderer.ts 的 applyThreadGeometry）一致：
         - 竖线逐层一条 3px 宽（x = 18k + 6，同官方 blockquote 竖线宽度），--xns-thread-columns 由 JS 按树结构生成：
           祖先里还有后续兄弟的层级贯穿整行（上下各溢出 3px 跨过 3px 条目间隙，同层竖线严丝合缝）；
         - 本层竖线不画在自己的卡片里（卡片不透底，画在本行会变成卡片内部的一条装饰线），它出现在子楼层的行上；
         - 9px 短横线从父层竖线右边缘（18(d-1) + 9）接到卡片左边缘，高度对准第一行（作者/时间）的垂直中心；
         - 本条是父层最后一条子楼层时，父层竖线不贯穿本行，只用 --xns-thread-stop-* 画到横线处（不空垂一条长线）；
         - content-visibility 必须回到 visible：外层卡片的 contain:paint 会把越出卡片左侧的竖线整体裁掉。 */
      .xns-preview-thread > .content-item.xns-comment-child { --xns-thread-elbow: 15px; position:relative; content-visibility:visible; margin:3px 0 0 var(--xns-indent, 0px); }
      .xns-preview-thread > .content-item.xns-comment-child::before { content:''; position:absolute; left:calc(-1 * var(--xns-indent, 0px) - 1px); top:-3px; width:calc(100% + var(--xns-indent, 0px) + 1px); height:calc(100% + 6px); pointer-events:none; background-image:var(--xns-thread-columns, none), linear-gradient(var(--xns-thread-line), var(--xns-thread-line)), linear-gradient(var(--xns-thread-line), var(--xns-thread-line)); background-repeat:no-repeat; background-size:100% 100%, 9px 3px, var(--xns-thread-stop-width, 0px) 21px; background-position:0 0, calc(var(--xns-indent, 0px) - 9px) var(--xns-thread-elbow), var(--xns-thread-stop-x, 0px) 0; }
      .xns-reply-list { margin:6px 0 0 !important; padding:0 !important; list-style:none !important; }
      .xns-floor-highlight { animation:xns-floor-highlight 1.8s ease both; }
      @keyframes xns-floor-highlight { 0%,100%{box-shadow:none} 20%{box-shadow:0 0 0 4px rgba(46,163,79,.3)} }
      .xns-preview-content { font-size:14px; line-height:1.45; }
      .xns-preview-content pre { box-sizing:border-box; max-width:100%; overflow:auto; white-space:pre; }
      .xns-preview-content pre.xns-code-block { position:relative !important; padding-top:30px; border:1px solid var(--xns-code-border); border-radius:4px; color:var(--xns-code-text); background:var(--xns-code-bg); font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; }
      .xns-preview-content pre.xns-code-block code { font:inherit; }
      .xns-preview-content .xns-code-copy-btn { position:absolute; top:8px; right:8px; z-index:2; padding:2px 8px; border:0; border-radius:3px; color:#fff; background:var(--xns-accent-strong); cursor:pointer; font:12px/1.2 system-ui,sans-serif; opacity:.85; }
      .xns-preview-content .xns-code-copy-btn:hover, .xns-preview-content .xns-code-copy-btn:focus-visible { opacity:1; outline:none; }
      .xns-preview-content .xns-code-copy-btn.xns-copy-failed { background:var(--xns-danger); }
      ${ansiRulesFor('fg', 'color', ansiFgHex)}
      ${ansiRulesFor('fg-bright', 'color', ansiBrightHex)}
      ${ansiRulesFor('bg', 'background', ansiBgHex)}
      ${ansiRulesFor('bg-bright', 'background', ansiBrightHex)}
      .xns-preview-content .xns-ansi-bold { font-weight:700; } .xns-preview-content .xns-ansi-dim { opacity:.72; } .xns-preview-content .xns-ansi-italic { font-style:italic; } .xns-preview-content .xns-ansi-underline { text-decoration:underline; } .xns-preview-content .xns-ansi-strike { text-decoration:line-through; } .xns-preview-content .xns-ansi-hidden { visibility:hidden; } .xns-preview-content .xns-ansi-inverse { filter:invert(1); }
      .xns-preview-content .xns-markdown-tabs { margin:8px 0; overflow:hidden; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface-muted); }
      .xns-preview-content .xns-markdown-tabs-nav { display:flex; align-items:center; flex-wrap:wrap; gap:4px; padding:5px 6px; border-bottom:1px solid var(--xns-border); background:var(--xns-accent-soft); }
      .xns-preview-content .xns-markdown-tab { padding:5px 9px; border:1px solid transparent; border-radius:5px; color:var(--xns-muted); background:transparent; cursor:pointer; font:13px/1.25 system-ui,sans-serif; }
      .xns-preview-content .xns-markdown-tab:hover, .xns-preview-content .xns-markdown-tab:focus-visible { color:var(--xns-accent); outline:none; }
      .xns-preview-content .xns-markdown-tab.is-active { border-color:var(--xns-border); color:var(--xns-accent-strong); background:var(--xns-surface); box-shadow:0 1px 2px rgba(0,0,0,.08); }
      .xns-preview-content .xns-markdown-tab-panel { display:none; padding:8px 10px; }
      .xns-preview-content .xns-markdown-tab-panel.is-active { display:block; }
      .xns-preview-content .nsk-magic-tabs { margin:8px 0; overflow:hidden; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface-muted); }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title { display:inline-block; box-sizing:border-box; margin:0; padding:8px 12px; border:1px solid transparent; border-bottom:0; color:var(--xns-muted); background:transparent; cursor:pointer; font-size:14px; line-height:1.3; vertical-align:bottom; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title:hover, .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title:focus-visible { color:var(--xns-accent); outline:none; }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title.xns-active { border-color:var(--xns-border); border-radius:7px 7px 0 0; color:var(--xns-accent-strong); background:var(--xns-surface); }
      .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-body { display:none; clear:both; box-sizing:border-box; padding:8px 10px; border-top:1px solid var(--xns-border); }
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
      .xns-preview-comments { margin-top:10px; padding-top:8px; border-top:1px solid var(--xns-border); }
      .xns-preview-comments > h3 { margin:0 0 7px; font-size:15px; line-height:1.3; }
      .xns-preview-thread { margin:0; padding:0; list-style:none; }
      .xns-virtual-list > .xns-virtual-spacer { display:block !important; height:0; margin:0 !important; padding:0 !important; border:0 !important; list-style:none !important; pointer-events:none; }
      .xns-preview-thread > .content-item { margin:4px 0; padding:8px 10px 7px; border:1px solid var(--xns-border); border-radius:7px; background:var(--xns-surface-muted); content-visibility:auto; contain-intrinsic-size:150px; }
      .xns-preview-thread > .content-item.xns-comment-root[data-xns-floor] { border-left:3px solid var(--xns-accent-strong); }
      .xns-preview-thread .nsk-content-meta-info { display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px; margin:0 0 3px; color:#64748b; font-size:12px; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .content-info, .xns-preview-content .nsk-content-meta-info .date-created { display:inline-flex; align-items:center; flex-wrap:wrap; gap:5px; margin:0 !important; line-height:1.25; }
      .xns-preview-content .nsk-content-meta-info .date-created time { display:inline; white-space:nowrap; }
      .xns-preview-content .user-info-display { position:static !important; display:inline-flex !important; align-items:center; transform:none !important; margin:0 !important; padding:0 !important; }
      .xns-preview-thread .post-content, .xns-preview-thread article.post-content { margin:0; line-height:1.45; }
      .xns-preview-thread .post-content p, .xns-preview-thread article.post-content p { margin:2px 0 4px; }
      .xns-preview-thread .post-content > :first-child, .xns-preview-thread article.post-content > :first-child { margin-top:0; }
      .xns-preview-thread .post-content > :last-child, .xns-preview-thread article.post-content > :last-child { margin-bottom:0; }
      .xns-preview-thread .comment-menu, .xns-preview-menu { display:flex; align-items:center; flex-wrap:wrap; gap:2px 5px; margin-top:7px; padding-top:5px; border-top:1px solid var(--xns-border); color:#999; font:12px/1.2 system-ui,sans-serif; }
      .xns-preview-thread .comment-menu > .menu-item, .xns-preview-menu > .menu-item { display:inline-flex; align-items:center; gap:4px; min-height:22px; padding:2px 5px; border:0; border-radius:4px; color:inherit; background:transparent; cursor:pointer; text-decoration:none; }
      .xns-preview-thread .comment-menu > .menu-item:hover, .xns-preview-thread .comment-menu > .menu-item:focus-visible, .xns-preview-menu > .menu-item:hover, .xns-preview-menu > .menu-item:focus-visible { color:var(--xns-accent); background:var(--xns-accent-soft); outline:none; }
      .xns-preview-thread .comment-menu > .menu-item[data-xns-action="quote"], .xns-preview-thread .comment-menu > .menu-item[data-xns-action="reply"], .xns-preview-menu > .menu-item[data-xns-action="quote"], .xns-preview-menu > .menu-item[data-xns-action="reply"] { margin-left:4px; }
      .xns-preview-thread .xns-action-icon, .xns-preview-menu .xns-action-icon { display:inline-flex; min-width:14px; justify-content:center; color:inherit; font-size:14px; line-height:1; }
      .xns-preview-thread .xns-action-count, .xns-preview-menu .xns-action-count { font-variant-numeric:tabular-nums; }
      .xns-preview-thread .comment-menu > .menu-item.xns-action-pending, .xns-preview-menu > .menu-item.xns-action-pending { opacity:.55; pointer-events:none; }
      .xns-preview-thread .comment-menu > .menu-item.xns-action-failed, .xns-preview-menu > .menu-item.xns-action-failed { color:#b91c1c; }
      /* 已操作状态：对齐官方 .comment-menu .menu-item.clicked 的红色高亮。 */
      .xns-preview-thread .comment-menu > .menu-item.xns-action-done, .xns-preview-menu > .menu-item.xns-action-done { color:#e70606; }
      /* 预览菜单不提供“收藏”，但不真删官方那条（切回原版要用），只隐藏；复原时去掉标记。 */
      .xns-preview-thread .comment-menu > .menu-item[data-xns-menu-hidden], .xns-preview-menu > .menu-item[data-xns-menu-hidden] { display:none; }
      .xns-action-state { font-size:11px; }
      .xns-preview-composer { margin-top:10px; padding-top:8px; border-top:1px solid rgba(100,116,139,.2); }
      .xns-preview-composer-title { margin:0 0 6px; font-size:14px; }
      .xns-preview-composer textarea { display:block; box-sizing:border-box; width:100%; min-height:100px; resize:vertical; padding:8px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:transparent; font:14px/1.5 system-ui,sans-serif; }
      .xns-preview-composer-actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:8px; }
      .xns-preview-composer button, .xns-preview-composer a { padding:5px 10px; border:1px solid var(--xns-border); border-radius:6px; color:inherit; background:transparent; cursor:pointer; text-decoration:none; font:13px/1.2 system-ui,sans-serif; }
      .xns-preview-composer button:hover, .xns-preview-composer button:focus-visible, .xns-preview-composer a:hover, .xns-preview-composer a:focus-visible { border-color:var(--xns-accent-strong); outline:none; }
      .xns-preview-composer-status { color:var(--xns-muted); font-size:12px; }
      .xns-image-error { display:block; margin-top:5px; color:var(--xns-danger); font:12px/1.4 system-ui,sans-serif; }
      .xns-preview-content .vote-panel { margin:8px 0; }
      .xns-preview-content .vote-panel .pure-form { padding:2px 0; }
      .xns-preview-content .vote-panel form { background:var(--xns-surface-muted); border:1px solid var(--xns-border); border-radius:7px; padding:8px 10px; }
      .xns-preview-content .vote-panel .vote-stat { display:flex; align-items:flex-start; gap:6px; margin:4px 0; }
      .xns-preview-content .vote-panel input[type="radio"] { margin-top:3px; flex:0 0 auto; }
      .xns-preview-content .vote-panel button { margin-top:8px; padding:4px 14px; border:1px solid var(--xns-accent-strong); border-radius:6px; color:var(--xns-accent-strong); background:transparent; cursor:pointer; font:13px/1.3 system-ui,sans-serif; }
      .xns-preview-content .vote-panel button:disabled { opacity:.55; cursor:not-allowed; }
      .xns-vote-status { margin-top:6px; color:var(--xns-muted); font-size:12px; }
      .xns-vote-status:empty { display:none; }
      .xns-vote-results { display:flex; flex-direction:column; gap:6px; margin:4px 0 6px; }
      .xns-vote-results .xns-vote-result { display:flex; flex-direction:column; gap:2px; }
      .xns-vote-results .vote-item-text { font-size:13px; line-height:1.3; }
      .xns-vote-results .xns-vote-bar-wrap { height:16px; border:1px solid var(--xns-border); border-radius:4px; background:var(--xns-accent-soft); overflow:hidden; }
      .xns-vote-results .xns-vote-bar { box-sizing:border-box; min-width:26px; height:100%; padding:0 6px; display:flex; align-items:center; justify-content:flex-end; color:#fff; background:var(--xns-accent-strong); font:11px/16px system-ui,sans-serif; border-radius:3px 0 0 3px; }
      /* min-width 是为了让极小占比也能容下百分比文字；0 票不该因此长出一条绿杠。 */
      .xns-vote-results .xns-vote-bar-empty { min-width:0; padding:0; background:transparent; }
      .xns-vote-results .xns-vote-mine .vote-item-text { color:var(--xns-accent-strong); font-weight:600; }
      .xns-vote-results .xns-vote-result-meta { color:var(--xns-muted); font-size:12px; }
      .xns-vote-total { margin-top:4px; color:var(--xns-muted); font-size:12px; }
      .xns-preview-content img { cursor:zoom-in; }
      .xns-lightbox { position:fixed; z-index:2147483500; inset:0; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(0,0,0,.88); }
      .xns-lightbox-stage { position:relative; display:flex; align-items:center; justify-content:center; width:100%; height:100%; overflow:hidden; cursor:grab; }
      .xns-lightbox-stage.xns-dragging { cursor:grabbing; }
      .xns-lightbox-image { max-width:calc(100vw - 48px); max-height:calc(100vh - 48px); object-fit:contain; user-select:none; -webkit-user-drag:none; transform-origin:center; cursor:grab; }
      .xns-lightbox-stage.xns-dragging .xns-lightbox-image { cursor:grabbing; }
      .xns-lightbox-close, .xns-lightbox-open { position:absolute; z-index:1; padding:6px 10px; border:1px solid rgba(255,255,255,.35); border-radius:6px; color:#fff; background:rgba(0,0,0,.58); cursor:pointer; text-decoration:none; font:13px/1.2 system-ui,sans-serif; }
      .xns-lightbox-close { top:10px; right:10px; font-size:20px; line-height:1; }
      .xns-lightbox-open { left:10px; bottom:10px; }
      .xns-lightbox-close:hover, .xns-lightbox-open:hover, .xns-lightbox-close:focus-visible, .xns-lightbox-open:focus-visible { background:rgba(0,0,0,.9); outline:none; }
      .dark-layout .xns-preview-post, .dark-layout .xns-preview-thread > .content-item { color:var(--xns-text); background:var(--xns-surface); }
      /* #2f2f2f = 官方暗色 --body-bg / --tab-active-bg（下面几处按下态沿用）。 */
      .dark-layout .xns-preview-content .xns-ansi-fg-black { color:var(--xns-code-text); } .dark-layout .xns-preview-content .xns-ansi-fg-white { color:#272727; }
      .dark-layout .xns-preview-content .xns-markdown-tabs { background:var(--xns-surface); } .dark-layout .xns-preview-content .xns-markdown-tabs-nav { background:var(--xns-surface-muted); } .dark-layout .xns-preview-content .xns-markdown-tab.is-active { color:var(--xns-accent); background:#2f2f2f; }
      .dark-layout .xns-preview-content .nsk-magic-tabs { background:var(--xns-surface); } .dark-layout .xns-preview-content .nsk-magic-tabs > .nsk-magic-tab-title.xns-active { color:var(--xns-accent); background:#2f2f2f; }
      .dark-layout .xns-post-toolbar { color:var(--xns-text); background:var(--xns-surface-muted); border-color:var(--xns-border); }
      .dark-layout .xns-post-toolbar button[aria-pressed="true"] { color:var(--xns-accent); border-color:var(--xns-accent-strong); background:#2f2f2f; }
      .dark-layout .xns-preview-composer textarea { color:var(--xns-text); }
      .dark-layout .xns-preview-content .vote-panel form { color:var(--xns-text); background:var(--xns-surface); border-color:var(--xns-border); }
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

const installStyle = (): void => xnsStyleInstaller.installStyle();

export { installStyle };
