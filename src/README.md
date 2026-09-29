# 源码说明

源码按功能拆分，全部为 TypeScript（设置面板是 `.tsx`），使用显式 ES 模块依赖，由 Vite + vite-plugin-monkey 构建到 `outputs/`。
`src/main.ts` 是唯一脚本入口，`vite.config.ts` 管理 userscript 元数据，版本读取根目录 `package.json`。

## 运行主链路

1. `src/app/bootstrap.ts` 读偏好、装样式、注册油猴菜单，然后把列表页入口和帖子页控制器挂上去。
2. 列表页点击标题走 `src/preview/entry.ts` → `src/preview/controller.ts`；帖子页由 `src/post-page/controller.ts` 接管评论区。
3. 两者都通过 `src/data/page-loader.ts` 读取同帖分页，记录模型由 `src/nodeseek/content-parser.ts` 产出。
4. 楼层关系由 `src/comments/thread.ts` 展平，`src/preview/virtualizer.ts` 决定哪些楼层进 DOM，`src/preview/renderer.ts` 把记录物化成节点。

## 关键模块

`src/core/config.ts` 集中运行时常量（分页上限 `MAX_PAGE`、请求预算 `PAGE_CONCURRENCY` / `PAGE_REQUEST_GAP`、超时、选择器）和共享状态的能力契约。楼层关系线自己的常量跟关系线放在一起：缩进步长 `THREAD_STEP` 与线宽 `THREAD_LINE_WIDTH` 在 `src/preview/renderer.ts`，深度上限 `THREAD_LEVEL_LIMIT` 与竖线层级上限 `THREAD_COLUMN_LIMIT` 在 `src/comments/thread.ts`。
共享状态不再用 `unknown`：`config.ts` 导出 `ModalHandle`、`PreviewModalState`、`ActionPostHandle`、`ActionRecord` 等最小能力契约，`mode` 是字面量联合类型；各模块只声明自己真正会用到的字段。

`src/nodeseek/content-parser.ts` 解析评论记录并调用 `src/nodeseek/sanitize.ts` 清洗远端节点，输出预览和帖子页共用的记录模型。
`sanitize.ts` 用 DOMPurify 清洗远端节点，再应用楼层 ID、评论菜单、链接和延迟图片规则；不清洗或替换当前页原生评论节点。
`src/nodeseek/ssr-state.ts` 提供 SSR 状态与评论记录类型。

`src/data/page-loader.ts` 负责分页读取：并发上限、请求起始间隔、失败退避和记录合并都在这里。
“用户取消”和“读取失败/超时”的区分在 `src/nodeseek/http.ts`：超时会被改写成可重试的错误并重试，调用（`isAbortError`）用它决定这次中断要不要提示重试。

`src/comments/thread.ts` 只做一件事：把记录展平成带 `depth`、`full`、`stop` 的条目，供渲染层画关系线。
树数据在展平时一次算完，渲染和滚动都只看结果——祖先节点被虚拟列表卸载后，当前楼层仍然知道哪些竖线要贯穿、哪些要收口。
回复环（两条评论互相引用）会降级成根节点，保证每条记录都能进入展示结果。
深度映射只此一处：`threadLevel()` 决定卡片缩进层级（上限 8，更深的楼层压平），`threadColumn()` 决定竖线层级（上限 7）；竖线层级必须小于本行缩进层级。

`src/preview/virtualizer.ts` 是评论虚拟列表：保留完整记录，只把视口附近的楼层物化成 DOM，帖子页和预览弹窗共用同一套窗口模型。
它的接口只有四件事：`setEntries`（换条目）、`onMount` / `onUnmount`（节点进出视口）、`onUpdate`（条目变了但节点被复用）。
跨页补全后布局要重算，就是靠 `onUpdate` 回调交给渲染层，调用方不需要记得手动补一次同步。
`destroyVirtualLists(root)` 用于替换内容或关闭弹窗时销毁实例。

`src/preview/renderer.ts` 负责记录到节点的映射，并在这里写入楼层布局：`prepareCommentRecord` 与 `applyThreadGeometry` 计算缩进、根/子/叶子标记和关系线几何，`updateThreadGeometry` 是虚拟列表 `onUpdate` 的入口。
`src/preview/render-utils.ts` 的 `stripRenderArtifacts` 负责把节点还原成官方形态，布局写入与布局清理必须成对维护。

`src/preview/controller.ts` 管理预览弹窗的状态与生命周期：内容替换前先销毁旧的虚拟列表，弹窗关闭时取消未完成的请求并销毁当前视图。
回复成功后的刷新由弹窗自己负责，评论动作模块不再反向依赖预览控制器，双方都通过 `src/core/config.ts` 的能力契约通信。

`src/ui/settings-panel.tsx` 使用 React + TypeScript 渲染设置面板，关闭时卸载 React root；`src/ui/settings.ts` 仅桥接现有状态、偏好保存和油猴菜单，React 不接管 NodeSeek 原生评论节点。
`src/ui/tokens.ts` 与 `src/ui/style.ts` 提供配色变量和注入样式，`src/ui/status.ts` 维护工具栏状态。

| 目录职责 | 说明 |
| --- | --- |
| `src/core/` | 运行时常量、共享状态契约、DOM 与偏好工具 |
| `src/nodeseek/` | NodeSeek URL、DOM/SSR 适配、清洗、身份和动作 API |
| `src/data/` | 分页读取、请求预算与评论记录收集 |
| `src/comments/` | 评论树模型与楼层关系线几何 |
| `src/preview/` | 预览入口、弹窗、控制器、渲染、虚拟楼层流、滚动、灯箱、楼层导航 |
| `src/features/` | 评论动作、内容增强、投票 |
| `src/post-page/` | 原帖页增强控制器 |
| `src/app/`、`src/ui/` | 启动装配和界面样式 |

## 构建

在仓库根目录运行：

```powershell
npm ci
npm run build
```

需要 Node.js 22.12+（22.x）或 24+，CI 使用 Node.js 24。
`node work/build.mjs` 仍兼容旧命令，内部执行 TypeScript 检查、Vite 构建和 Greasy Fork 描述同步，不再拼接源码。
`npm run typecheck` 检查 `src/` 全部 TS/TSX；`npm run dev` 启动本地 Vite 开发服务，按终端提示安装开发脚本。
发布产物是单个可读的 `.user.js`，依赖内联，不增加远程 `@require`。

安装和发布使用 `outputs/nodeseek-comment-preview.user.js`，不要直接编辑构建产物。

## 架构图

架构图展示模块划分、数据流和安全边界（该图早于 0.5.63 起的模块合并与 TS 迁移，模块名以本文件为准）。点击白色调静态预览可打开交互式版本：

[![NodeSeek 楼中楼预览脚本架构图](../docs/architecture/nodeseek-architecture.visual-check.2048x1320.light.png)](https://htmlpreview.github.io/?https://github.com/moxuun/nodeseek-comment-preview/blob/master/docs/architecture/nodeseek-architecture.html)

- [架构图源文件](../docs/architecture/nodeseek-architecture.html)
- [架构图源规格](../docs/architecture/nodeseek-architecture.architecture.json)

## 测试与真实环境检查

本地浏览器回归测试位于 `work/test/`，纯逻辑与几何不变量另由 `work/test/thread-lines.test.mjs` 覆盖；真实环境只读冒烟需要用户明确提供已打开 NodeSeek 的 Chrome CDP 地址。夹具通过本地页面模拟 NodeSeek，只能验证已定义的模拟契约，不能替代真实页面兼容性检查。

- [完整使用说明](../outputs/README.md)
- [测试说明](../work/test/README.md)
