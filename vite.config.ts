import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  build: {
    outDir: 'outputs',
    emptyOutDir: false, // outputs/README.md is maintained documentation.
    minify: false,
    target: 'es2022',
  },
  plugins: [monkey({
    entry: 'src/main.ts',
    userscript: {
      name: 'nodeseek楼中楼预览',
      namespace: 'https://www.nodeseek.com/',
      version: pkg.version,
      description: '楼中楼、虚拟楼层流、原版评论布局、ANSI 代码块和标签页渲染、代码块复制、更窄灰色边缘、帖子回复、分页并发加载、图片灯箱和 V2Next 式预览刷新/滚动控制。',
      author: 'moxuun',
      license: 'MIT',
      homepageURL: 'https://github.com/moxuun/nodeseek-comment-preview',
      supportURL: 'https://github.com/moxuun/nodeseek-comment-preview/issues',
      match: ['https://www.nodeseek.com/*'],
      'run-at': 'document-start',
      grant: ['GM_registerMenuCommand'],
      noframes: true,
    },
    server: { open: false },
    build: {
      fileName: 'nodeseek-comment-preview.user.js',
      autoGrant: false,
    },
  })],
});
