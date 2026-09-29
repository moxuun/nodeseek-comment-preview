// 运行时常量与应用状态。这里不放业务逻辑，便于各功能模块明确依赖。
import type { CommentRecord } from '../nodeseek/content-parser.js';

const PREFIX = 'xns';
const REQUEST_TIMEOUT = 8_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_PAGE = 50;
// NodeSeek 对连续分页请求有明显的限流；保留少量并发，避免长帖读取时成批 429。
const PAGE_CONCURRENCY = 2;
// 发生限流后，分页请求之间错开起始时间；正常情况下不人为降低吞吐。
const PAGE_REQUEST_GAP = 150;
const HTML_CACHE_TTL = 30_000;
const HTML_CACHE_MAX_ENTRIES = 16;
const HTML_CACHE_MAX_BYTES = 4_000_000;
const HTML_CACHE_ITEM_MAX_BYTES = 512_000;
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

/** 楼层布局模式：`thread` = 楼中楼扁平列表，`original` = 站点原生嵌套。 */
type PostMode = 'thread' | 'original';

/** 帖子页控制器写进 `state.post` 的能力；完整实现见 post-page/controller.ts。 */
interface PostHandle {
  setMode?: (mode: PostMode) => void;
  prepareNativeEdit?: (comment: Element) => boolean;
  requestNativeEdit?: (target: CommentRecord) => boolean;
  composer?: HTMLElement | null;
  reloadPages?: (options: { refreshCurrentPage?: boolean }) => Promise<unknown>;
}

/** 预览弹窗写进 `state.modal` 的能力；完整状态见 preview/controller.ts 的 PreviewModalState。 */
interface ModalHandle {
  overlay?: HTMLElement | null;
  postId?: string | number | null;
  url?: URL | null;
  body?: HTMLElement | null;
  composer?: HTMLElement | null;
  composerHost?: HTMLElement | null;
  /** 关窗时要断掉的在途请求与监听。 */
  requestController?: { abort: () => void } | null;
  replySyncController?: { abort: () => void } | null;
  scrollCleanup?: (() => void) | null;
  refreshScrollCleanup?: (() => void) | null;
  /** 弹窗自己提供的重渲染入口（楼层动作不反向依赖 preview controller）。 */
  refresh?: () => void;
  /** 弹窗自己提供的回复同步入口。 */
  syncReply?: () => Promise<boolean>;
}

/** 设置面板写进 `state.settingsPanel` 的能力。 */
interface SettingsPanelHandle {
  overlay?: HTMLElement | null;
  close?: () => void;
  unmount?: () => void;
}

/** 图片灯箱写进 `state.lightbox` 的能力。 */
interface LightboxHandle {
  overlay?: HTMLElement | null;
  cleanup?: () => void;
}

/**
 * 跨模块共享的运行时状态槽。这里只声明各消费方真正用到的能力，具体形状由写入方
 * （post-page / preview / settings / lightbox 控制器）用完整句柄实现。
 */
interface AppState {
  post: PostHandle | null;
  modal: ModalHandle | null;
  settingsPanel: SettingsPanelHandle | null;
  lightbox: LightboxHandle | null;
  mode: PostMode;
}

const state: AppState = {
  post: null,
  modal: null,
  settingsPanel: null,
  lightbox: null,
  mode: DEFAULT_MODE,
};

export { ANSI_BG_HEX, ANSI_BRIGHT_HEX, ANSI_COLORS, ANSI_FG_HEX, DEFAULT_MODE, HTML_CACHE_ITEM_MAX_BYTES, HTML_CACHE_MAX_BYTES, HTML_CACHE_MAX_ENTRIES, HTML_CACHE_TTL, MAX_PAGE, MAX_RESPONSE_BYTES, PAGE_CONCURRENCY, PAGE_REQUEST_GAP, REQUEST_TIMEOUT, SELECTORS, STYLE_ID, state };
export type { AppState, LightboxHandle, ModalHandle, PostHandle, PostMode, SettingsPanelHandle };
