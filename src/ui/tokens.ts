// 共享视觉 token；组件样式只引用这些语义颜色，避免页面状态各自维护一套颜色。
// 亮色 token 取官方亮色主题的色值（官方定义在 :root / .nsk-magic-tabs 上）：
// --text-color / --tab-text / --disabled-text / --tab-active-bg / --tabs-bg / --main-color /
// --glass-color / --tabs-border 与亮色 markdown-alert 色，另加官方 blockquote 竖线、pre 底色。
const XNS_STYLE_TOKENS = `
      :root {
        --xns-text: #333;
        --xns-muted: #64748b;
        --xns-subtle: #94a3b8;
        --xns-surface: #fff;
        --xns-surface-muted: #f8fafc;
        --xns-accent: #2ea44f;
        --xns-accent-strong: #2ea44f;
        --xns-accent-soft: rgba(0,0,0,.05);
        --xns-border: #e5e7eb;
        --xns-danger: #cf222e;
        --xns-warning: #9a6700;
        --xns-success: #1a7f37;
        --xns-thread-line: rgba(0,0,0,.1);
        --xns-code-bg: rgba(255,255,153,.33);
        --xns-code-border: #eee;
        --xns-code-text: #444;
      }
      /* 暗色 token 取官方暗色主题的色值（官方定义在 body.dark-layout 上）：
         --body-text / --text-color / --disabled-text / --bg-main-color / --bg-sub-color /
         --sub-color / --main-color / --glass-color / --tabs-border 与暗色 markdown-alert 色，
         竖线/pre 底色取官方暗色 blockquote 与 pre 规则。
         刻意不写 var(--…)：官方在亮色页面同样定义了这些变量，引用会把亮色值带进来。 */
      .dark-layout {
        --xns-text: #f1f1f1;
        --xns-muted: #aaa;
        --xns-subtle: #8a8a8a;
        --xns-surface: #272727;
        --xns-surface-muted: #3b3b3b;
        --xns-accent: #45ca6b;
        --xns-accent-strong: #2ea44f;
        --xns-accent-soft: rgba(255,255,255,.05);
        --xns-border: #2c2c2c;
        --xns-danger: #da3633;
        --xns-warning: #9e6a03;
        --xns-success: #238636;
        --xns-thread-line: rgba(255,255,255,.1);
        --xns-code-bg: #2e2e04;
        --xns-code-border: #56560b;
        --xns-code-text: #aaa;
      }
`;

export { XNS_STYLE_TOKENS };
