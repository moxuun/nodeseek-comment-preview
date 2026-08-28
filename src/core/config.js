// 运行时常量与应用状态。这里不放业务逻辑，便于各功能模块明确依赖。
const PREFIX = 'xns';
const REQUEST_TIMEOUT = 8_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_PAGE = 50;
// NodeSeek 对连续分页请求有明显的限流；保留少量并发，避免长帖读取时成批 429。
const PAGE_CONCURRENCY = 2;
const STYLE_ID = `${PREFIX}-style`;
const DEFAULT_MODE = 'thread';

const SELECTORS = Object.freeze({
  commentContainer: '.comment-container',
  commentList: '.comment-container > ul.comments, .comment-container ul.comments',
  commentItem: '.content-item[id], li[id].content-item',
  postContent: 'article.post-content, .post-content',
  postTitle: 'h1.post-title, .post-title, h1',
});

const ANSI_FG_HEX = ['#111827', '#dc2626', '#16a34a', '#ca8a04', '#2563eb', '#c026d3', '#0891b2', '#f8fafc'];
const ANSI_BG_HEX = ['#111827', '#ef4444', '#22c55e', '#facc15', '#3b82f6', '#d946ef', '#06b6d4', '#f8fafc'];
const ANSI_BRIGHT_HEX = ['#6b7280', '#f87171', '#4ade80', '#fde047', '#60a5fa', '#f0abfc', '#67e8f9', '#fff'];
const ANSI_COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

const state = {
  post: null,
  modal: null,
  lightbox: null,
  mode: DEFAULT_MODE,
};
