import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../docs/greasy-fork-description.md', import.meta.url), 'utf8');
const encoded = Array.from(source, (character) => {
  const codePoint = character.codePointAt(0);
  return codePoint > 0x7f ? `&#x${codePoint.toString(16)};` : character;
}).join('');
await fs.writeFile(new URL('../docs/greasy-fork-description.gf.md', import.meta.url), encoded, 'utf8');
console.log('Greasy Fork 描述同步文件：docs/greasy-fork-description.gf.md');
