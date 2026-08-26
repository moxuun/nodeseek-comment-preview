# NodeSeek 楼中楼预览

NodeSeek（https://www.nodeseek.com）的用户脚本：把平铺评论重建成「楼中楼」嵌套视图，支持首页/列表页的站内预览弹窗、评论操作、ANSI 代码块、图片灯箱等。

## 功能

- 帖子页：`楼中楼` / `原版` 评论布局切换（右下角悬浮按钮），自动读取同帖其他分页补齐引用关系
- 列表页：普通左键点击帖子标题打开站内预览弹窗，弹窗内同样按楼中楼展示
- 预览主帖支持点赞、加鸡腿、反对、收藏、引用、回复；回复楼层不含收藏
- 图片点击放大、滚轮缩放、拖动；代码块一键复制；ANSI 代码块与标签页渲染
- 跨页评论自动从服务端 SSR 状态恢复真实计数

详见 [outputs/README.md](outputs/README.md)（完整功能、使用、故障排查与版本历史）。

## 安装使用

1. 浏览器安装 Tampermonkey 或 Violentmonkey 扩展
2. 打开 [outputs/nodeseek-comment-preview.user.js](outputs/nodeseek-comment-preview.user.js) 并安装
3. 刷新 NodeSeek 页面即可生效

脚本使用 `@grant none`，不加载远程模块，不执行远程代码。

## 文件结构

```
outputs/
  nodeseek-comment-preview.user.js  用户脚本本体（安装这个）
  README.md                         完整中文文档
work/
  xns-fixture-server.mjs            本地 fixture HTTP 服务器（测试用）
  xns-fixture/                      测试用帖子/列表页面（post-123-1、post-123-2、list）
  test/
    run-tests.mjs                   浏览器端到端回归测试
    package.json                    puppeteer-core 依赖
```

## 开发测试

```powershell
cd work\test
npm install
npm test
```

测试自动启动本地 fixture 服务器（随机端口）并在结束时关闭，需要本机 Chromium/Chrome/Edge（找不到时用 `CHROME_PATH` 指定可执行文件）。全部通过退出码为 0，任一失败为 1。

## 安全边界

只读取当前 NodeSeek 帖子页面的同源 HTML；不读取 Cookie、密码、令牌、剪贴板、私信或浏览历史；所有点赞、鸡腿、反对、收藏、回复都须由用户主动点击后才请求 NodeSeek。