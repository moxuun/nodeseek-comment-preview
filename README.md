# NodeSeek 楼中楼预览

NodeSeek（https://www.nodeseek.com）用户脚本：把平铺评论重建成「楼中楼」嵌套视图，并支持首页/列表页的站内预览弹窗。

## 安装

1. 浏览器安装 Tampermonkey 或 Violentmonkey 扩展
2. 打开 [outputs/nodeseek-comment-preview.user.js](outputs/nodeseek-comment-preview.user.js) 并安装
3. 刷新 NodeSeek 页面即可生效

脚本使用 `@grant none`，不加载远程模块，不执行远程代码。

## 功能一览

- 帖子页：`楼中楼` / `原版` 布局切换（右下角悬浮按钮），自动读取同帖其他分页补齐引用关系
- 列表页：普通左键点击帖子标题打开站内预览弹窗，弹窗内同样按楼中楼展示
- 评论操作（点赞/加鸡腿/反对/收藏/引用/回复）、图片放大、代码块复制、ANSI 与标签页渲染

完整功能、使用说明、故障排查与版本历史见 [outputs/README.md](outputs/README.md)。

## 文件结构

| 路径 | 说明 |
| --- | --- |
| `outputs/nodeseek-comment-preview.user.js` | 用户脚本本体（安装这个） |
| `outputs/README.md` | 完整中文文档 |
| `work/test/` | 浏览器端到端回归测试（`npm install && npm test`） |
| `work/xns-fixture-server.mjs` | 本地 fixture HTTP 服务器（测试用） |
| `work/xns-fixture/` | 测试用帖子/列表页面 |

## 安全边界

只读取当前 NodeSeek 帖子页面的同源 HTML；不读取 Cookie、密码、令牌、剪贴板、私信或浏览历史；所有点赞、鸡腿、反对、收藏、回复都须由用户主动点击后才请求 NodeSeek。