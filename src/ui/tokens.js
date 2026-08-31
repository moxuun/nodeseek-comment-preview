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
        --xns-success: #16a34a;
      }
      .dark-layout {
        --xns-text: #e5e7eb;
        --xns-muted: #9ca3af;
        --xns-subtle: #6b7280;
        --xns-surface: #111827;
        --xns-surface-muted: #18202b;
        --xns-accent: #93c5fd;
        --xns-accent-strong: #60a5fa;
        --xns-accent-soft: rgba(59,130,246,.18);
        --xns-border: rgba(148,163,184,.35);
        --xns-danger: #fca5a5;
        --xns-success: #4ade80;
      }
`;
