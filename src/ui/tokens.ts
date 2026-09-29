// 共享视觉 token；组件样式只引用这些语义颜色，避免页面状态各自维护一套颜色。
const XNS_STYLE_TOKENS = `
      :root {
        --xns-text: #1f2937;
        --xns-muted: #64748b;
        --xns-subtle: #94a3b8;
        --xns-surface: #fff;
        --xns-surface-muted: #f8fafc;
        --xns-accent: #2563eb;
        --xns-accent-strong: #1d4ed8;
        --xns-accent-soft: #eff6ff;
        --xns-border: rgba(100,116,139,.25);
        --xns-danger: #b91c1c;
        --xns-warning: #92400e;
        --xns-success: #16a34a;
      }
      /* 暗色 token 取官方暗色主题的色值（官方定义在 body.dark-layout 上）：
         --body-text / --text-color / --disabled-text / --bg-main-color / --bg-sub-color /
         --sub-color / --main-color / --glass-color / --tabs-border 与暗色 markdown-alert 色。
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
      }
`;

export { XNS_STYLE_TOKENS };
