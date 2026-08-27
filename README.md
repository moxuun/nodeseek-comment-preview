# NodeSeek 楼中楼预览

[NodeSeek]（https://www.nodeseek.com）用户脚本：把平铺评论重建成楼中楼嵌套视图。功能参考 [V2Next](https://github.com/zyronon/V2Next)，用 Codex 辅助开发的轮子。

## 安装

1. 浏览器安装 Tampermonkey 或 Violentmonkey 扩展
2. 打开 [outputs/nodeseek-comment-preview.user.js](outputs/nodeseek-comment-preview.user.js) 并安装
3. 刷新 NodeSeek 页面即可生效

脚本使用 `@grant none`，不加载远程模块，不执行远程代码。

## 功能

1. **预览楼中楼**：首页/列表页点击帖子标题打开站内预览，回复按楼中楼嵌套展示；压缩信息密度，复杂论战一分钟吃完瓜。
2. **图片灯箱**：预览图片点击放大、滚轮缩放、拖动、Esc 关闭，可打开原图。
3. **Markdown / NQ 渲染**：沿用 NodeSeek 服务端渲染的 Markdown 结构、ANSI 代码块、标签页；`pre > code` 代码块带一键复制。
4. **懒加载与并发优化**：多分页并发读取（上限 4），评论卡片浏览器懒渲染，首屏先出当前页。

完整使用说明、故障排查与版本历史见 [outputs/README.md](outputs/README.md)。

## 已知问题

- Stardust 收款码不会显示（有意不支持）。
- 主要用本地夹具测试，真实 NodeSeek 环境的鸡腿、收藏、点赞、回复可能有未发现的边界问题。
- 内容含邮箱时会触发 NodeSeek 的 email protect。
- 只能读取帖子前 12 页评论。

## 文件结构

| 路径 | 说明 |
| --- | --- |
| `outputs/nodeseek-comment-preview.user.js` | 用户脚本本体（安装这个） |
| `outputs/README.md` | 完整中文文档 |
| `work/test/` | 浏览器端到端回归测试（`npm install && npm test`） |
| `work/xns-fixture-server.mjs` | 本地 fixture HTTP 服务器（测试用） |
| `work/xns-fixture/` | 测试用帖子/列表页面 |

## 反馈

欢迎提 [issue](https://github.com/moxuun/nodeseek-comment-preview/issues) 反馈问题，我会在自己帖子下测试「点赞、鸡腿、收藏、回复」相关场景。对你有帮助的话点个 [star](https://github.com/moxuun/nodeseek-comment-preview) 吧。

## 安全边界

只读取当前 NodeSeek 帖子页面的同源 HTML；不读取 Cookie、密码、令牌、剪贴板、私信或浏览历史；所有点赞、鸡腿、反对、收藏、回复都须由用户主动点击后才请求 NodeSeek。
