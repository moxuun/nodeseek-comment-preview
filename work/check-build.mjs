import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const artifact = new URL('../outputs/nodeseek-comment-preview.user.js', import.meta.url);
const source = await readFile(artifact, 'utf8');
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert(source.startsWith('// ==UserScript==\n'), '安装元数据必须在文件开头');
assert.equal(source.match(/==UserScript==/g)?.length, 1, '产物必须只有一份 userscript 头');
const header = source.slice(0, source.indexOf('// ==/UserScript=='));
const values = (key) => [...header.matchAll(new RegExp(`^// @${key}\\s+(.*)$`, 'gm'))].map(match => match[1].trim());
assert.deepEqual(values('name'), ['nodeseek楼中楼预览']);
assert.deepEqual(values('version'), [pkg.version]);
assert.deepEqual(values('match'), ['https://www.nodeseek.com/*']);
assert.deepEqual(values('grant'), ['GM_registerMenuCommand']);
assert.deepEqual(values('run-at'), ['document-start']);
assert.match(header, /^\/\/ @noframes\s*$/m);
assert.deepEqual(values('require'), [], '发布产物不得引入远程模块');
// Check as a classic script even though the source package uses ESM.
execFileSync(process.execPath, ['--check', '--input-type=commonjs'], { input: source, stdio: ['pipe', 'inherit', 'inherit'] });
assert((await readFile(new URL('../outputs/README.md', import.meta.url), 'utf8')).length > 0, '构建不得清空安装文档');
console.log(`Userscript 构建契约通过：${fileURLToPath(artifact)}`);
