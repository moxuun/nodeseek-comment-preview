# NodeSeek 测试基线

## 本地夹具回归

在仓库根目录运行（需要 Node.js 22.12+（22.x）或 24+）：

```powershell
npm ci
npm ci --prefix work/test
npm test
```

测试会先执行兼容入口 `node work/build.mjs`，运行类型检查和 Vite 构建，因此测试的是当前 `src/` 构建出来的安装产物，而不是工作区里手工残留的旧输出文件。在 `work/test/` 目录内仍可执行 `npm test`。

### 楼层关系线纯逻辑测试

`thread-lines.test.mjs` 在浏览器场景之前先跑，直接 `import` `src/comments/thread.ts`（Node ≥ 23 原生剥离类型，该模块只有 `import type`，运行时零依赖），用小型树对拍 `flattenReplyTree` 输出的 `full/stop`：单链、多兄弟、末子节点带后代、非末子节点带后代、跨页追加兄弟后几何反转。

树规则只在纯逻辑测试里核对；浏览器场景只断言这些几何正确映射到 CSS（卡片缩进、覆盖层位置、贯穿/收口），不再用渲染结果反推树结构。

这组测试使用 `work/xns-fixture/` 和本地 HTTP 服务器，只能证明脚本在已知夹具契约下工作。测试现在会统一记录并报告：

- 页面未捕获异常；
- `console.error` / `console.warn`；
- 请求失败；
- HTTP 400 及以上响应。

## 真实环境只读冒烟

以下命令在 `work/test/` 目录运行。

`test:live` 不启动新的登录环境，也不读取 Cookie、Storage 或账号信息。它要求用户明确提供一个已经打开 NodeSeek 的 Chrome CDP 地址：

```powershell
$env:XNS_CDP_URL='http://127.0.0.1:9222'
npm run test:live
```

默认只检查页面结构、`#xns-style`、Cloudflare 挑战状态和运行时异常。需要验证“帖子标题点击后打开预览且 URL 不变”时，显式开启只读交互：

```powershell
$env:XNS_LIVE_INTERACTION='1'
npm run test:live
```

交互模式只点击帖子标题并关闭预览弹窗，不执行点赞、收藏、回复、编辑或投票。

如果没有 `XNS_CDP_URL`，测试会明确失败，不会偷偷启动一个没有登录态的浏览器来冒充真实环境。

## 虚拟楼层流基准

基准脚本会用同一组 fixture 分别运行 `HEAD` 构建产物和当前构建产物，并报告首屏、全部分页完成时间、JS 堆、DOM 节点和活动评论数量：

```powershell
$env:XNS_BENCH_RUNS='3'
node benchmark.mjs
```

脚本包含 10、30、50 页的富内容帖子页，以及 500 条评论的帖子页/预览页。这里的“评论数量”是完整虚拟数据模型数量；“DOM/活动评论”应在长帖规模增长时保持在视口窗口量级。滚动回归另由 `npm test` 中的虚拟列表场景覆盖。
