# 源码说明

源码按功能拆分，构建产物位于 `outputs/`：

| 目录职责 | 说明 |
| --- | --- |
| `src/core/` | 运行时常量与状态 |
| `src/nodeseek/` | NodeSeek URL、DOM/SSR 适配、身份和动作 API |
| `src/data/` | 分页读取与评论记录收集 |
| `src/preview/` | 预览入口、弹窗、滚动、灯箱、楼层导航、渲染和虚拟楼层流 |
| `src/comments/` | 评论树模型 |
| `src/features/` | 评论动作、内容增强、投票 |
| `src/post-page/` | 原帖页增强控制器 |
| `src/app/`、`src/ui/` | 启动事件和样式 |

## 构建

在仓库根目录运行：

```powershell
node work/build.mjs
```

安装和发布使用 `outputs/nodeseek-comment-preview.user.js`，不要直接编辑构建产物。

## 架构图

架构图展示模块划分、数据流和安全边界。点击白色调静态预览可打开交互式版本：

[![NodeSeek 楼中楼预览脚本架构图](../docs/architecture/nodeseek-architecture.visual-check.2048x1320.light.png)](https://htmlpreview.github.io/?https://github.com/moxuun/nodeseek-comment-preview/blob/master/docs/architecture/nodeseek-architecture.html)

- [架构图源文件](../docs/architecture/nodeseek-architecture.html)
- [架构图源规格](../docs/architecture/nodeseek-architecture.architecture.json)

## 测试与真实环境检查

本地浏览器回归测试位于 `work/test/`，真实环境只读冒烟需要用户明确提供已打开 NodeSeek 的 Chrome CDP 地址。夹具通过本地页面模拟 NodeSeek，只能验证已定义的模拟契约，不能替代真实页面兼容性检查。

- [完整使用说明](../outputs/README.md)
- [测试说明](../work/test/README.md)
