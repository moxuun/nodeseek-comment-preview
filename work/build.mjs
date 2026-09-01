import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.join(here, '..', 'src');
const outputPath = path.join(here, '..', 'outputs', 'nodeseek-comment-preview.user.js');

const header = `// ==UserScript==
// @name         nodeseek楼中楼预览
// @namespace    https://www.nodeseek.com/
// @version      0.5.54
// @description  楼中楼、虚拟楼层流、原版评论布局、ANSI 代码块和标签页渲染、代码块复制、更窄灰色边缘、帖子回复、分页并发加载、图片灯箱和 V2Next 式预览刷新/滚动控制。
// @author       moxuun
// @license      MIT
// @homepageURL  https://github.com/moxuun/nodeseek-comment-preview
// @supportURL   https://github.com/moxuun/nodeseek-comment-preview/issues
// @match        https://www.nodeseek.com/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==`;

async function sourceFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(file);
  }
  return files.sort();
}

const allFiles = await sourceFiles(sourceRoot);
const newModuleOrder = [
  `${path.sep}core${path.sep}config.js`,
  `${path.sep}core${path.sep}preferences.js`,
  `${path.sep}ui${path.sep}status.js`,
  `${path.sep}core${path.sep}dom.js`,
  `${path.sep}ui${path.sep}settings.js`,
  `${path.sep}ui${path.sep}tokens.js`,
  `${path.sep}ui${path.sep}settings-style.js`,
  `${path.sep}ui${path.sep}preview-shell-style.js`,
  `${path.sep}nodeseek${path.sep}url.js`,
  `${path.sep}core${path.sep}runtime.js`,
  `${path.sep}nodeseek${path.sep}ssr-state.js`,
  `${path.sep}nodeseek${path.sep}action-api.js`,
  `${path.sep}nodeseek${path.sep}identity.js`,
  `${path.sep}nodeseek${path.sep}content-parser.js`,
  `${path.sep}nodeseek${path.sep}pagination.js`,
  `${path.sep}nodeseek${path.sep}http.js`,
  `${path.sep}comments${path.sep}thread.js`,
  `${path.sep}preview${path.sep}virtualizer.js`,
  `${path.sep}data${path.sep}page-loader.js`,
  `${path.sep}preview${path.sep}entry.js`,
  `${path.sep}preview${path.sep}navigation.js`,
  `${path.sep}features${path.sep}comment-actions.js`,
  `${path.sep}preview${path.sep}render-utils.js`,
  `${path.sep}preview${path.sep}renderer.js`,
  `${path.sep}features${path.sep}vote.js`,
  `${path.sep}preview${path.sep}lightbox.js`,
  `${path.sep}preview${path.sep}modal-ui.js`,
  `${path.sep}features${path.sep}content.js`,
  `${path.sep}preview${path.sep}controller.js`,
  `${path.sep}app${path.sep}events.js`,
  `${path.sep}post-page${path.sep}controller.js`,
  `${path.sep}ui${path.sep}style.js`,
  `${path.sep}app${path.sep}bootstrap.js`,
];
const unlistedFiles = allFiles.filter((file) => !newModuleOrder.some((marker) => file.endsWith(marker)));
if (unlistedFiles.length) {
  throw new Error(`源码模块未声明构建顺序：${unlistedFiles.map((file) => path.relative(sourceRoot, file)).join(', ')}`);
}
const newFiles = allFiles
  .sort((left, right) => {
    // 新模块会在初始化阶段注入依赖，顺序必须显式维护，不能依赖目录字典序。
    const rank = (file) => {
      const marker = newModuleOrder.findIndex((item) => file.endsWith(item));
      return marker === -1 ? newModuleOrder.length : marker;
    };
    return rank(left) - rank(right) || left.localeCompare(right);
  });
const files = newFiles;
if (files.length === 0) throw new Error(`没有找到源码模块：${sourceRoot}`);

const body = (await Promise.all(files.map((file) => fs.readFile(file, 'utf8')))).join('\n\n');
const output = `${header}\n\n(() => {\n  'use strict';\n\n${body}\n})();\n`;
await fs.writeFile(outputPath, output, 'utf8');

const descriptionSourcePath = path.join(here, '..', 'docs', 'greasy-fork-description.md');
const descriptionOutputPath = path.join(here, '..', 'docs', 'greasy-fork-description.gf.md');
const descriptionSource = await fs.readFile(descriptionSourcePath, 'utf8');
const descriptionForGreasyFork = Array.from(descriptionSource, (character) => {
  const codePoint = character.codePointAt(0);
  return codePoint > 0x7f ? `&#x${codePoint.toString(16)};` : character;
}).join('');
await fs.writeFile(descriptionOutputPath, descriptionForGreasyFork, 'utf8');

console.log(`构建完成：${path.relative(path.join(here, '..'), outputPath)}（${files.length} 个源码模块）`);
console.log(`Greasy Fork 描述同步文件：${path.relative(path.join(here, '..'), descriptionOutputPath)}`);
