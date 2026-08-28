# NodeSeek 测试基线

## 本地夹具回归

```powershell
npm test
```

测试会先执行 `node ../build.mjs`，因此测试的是当前 `src/` 构建出来的安装产物，而不是工作区里手工残留的旧输出文件。

这组测试使用 `work/xns-fixture/` 和本地 HTTP 服务器，只能证明脚本在已知夹具契约下工作。测试现在会统一记录并报告：

- 页面未捕获异常；
- `console.error` / `console.warn`；
- 请求失败；
- HTTP 400 及以上响应。

## 真实环境只读冒烟

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
