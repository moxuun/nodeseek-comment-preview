在 NodeSeek 主题列表页直接预览帖子评论，并按引用关系还原楼中楼。不离开当前页面，也能快速查看长帖的评论上下文。

## 主要功能

- 列表页点击帖子标题直接打开预览。
- 自动读取后续评论页，并按引用关系重建评论树。
- 支持楼中楼与原版评论布局切换。
- 通过虚拟楼层流减少大量评论同时驻留 DOM 带来的内存压力。
- 支持回复、引用、编辑、点赞、鸡腿、反对和收藏等评论操作。
- 支持图片灯箱、代码块复制、标签页、ANSI 和投票面板。
- 支持 NodeSeek 亮色与暗色模式。

## 设置

安装后，从油猴脚本菜单打开设置。

## 界面预览

![NodeSeek 预览弹窗](https://raw.githubusercontent.com/moxuun/nodeseek-comment-preview/master/docs/preview.jpg)

![NodeSeek 楼中楼评论树](https://raw.githubusercontent.com/moxuun/nodeseek-comment-preview/master/docs/tree-privew.jpg)

![NodeSeek 亮色模式](https://raw.githubusercontent.com/moxuun/nodeseek-comment-preview/master/docs/302.jpg)

![NodeSeek 暗色模式](https://raw.githubusercontent.com/moxuun/nodeseek-comment-preview/master/docs/dark_mode.jpg)

## 说明

- 默认最多自动读取帖子前 50 页评论。
- Cloudflare、网络或登录状态可能导致部分分页读取失败。
- 设置从油猴菜单进入，脚本不加载远程模块，也不执行远程代码。

[GitHub 源码与完整使用说明](https://github.com/moxuun/nodeseek-comment-preview)
