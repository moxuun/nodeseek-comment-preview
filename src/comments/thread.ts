import type { CommentRecord } from '../nodeseek/content-parser.js';

// 纯评论关系模型：不访问 DOM、不发请求，只根据楼层引用建立树。
function buildReplyTree(records: CommentRecord[]): CommentRecord[] {
  const byFloor = new Map<number, CommentRecord>(records.map((record) => [record.floor, record]));
  records.forEach((record) => {
    record.parent = null;
    record.children = [];
  });
  records.forEach((record) => {
    const target = record.reply?.targetFloor ? byFloor.get(record.reply.targetFloor) : null;
    if (target && target !== record && !record.pinned) {
      record.parent = target;
      target.children.push(record);
    }
  });
  const order = (record: CommentRecord): number => record.page * 100_000 + record.index;
  records.forEach((record) => record.children.sort((a, b) => order(a) - order(b)));
  return records.filter((record) => !record.parent).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return order(a) - order(b);
  });
}

/** 展平后的楼层条目，供虚拟列表逐层渲染。 */
interface FlatEntry {
  record: CommentRecord;
  depth: number;
}

function flattenReplyTree(records: CommentRecord[]): FlatEntry[] {
  const flat: FlatEntry[] = [];
  const roots = buildReplyTree(records);
  const stack: FlatEntry[] = roots.slice().reverse().map((record) => ({ record, depth: 0 }));
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) continue;
    flat.push(entry);
    entry.record.children.slice().reverse().forEach((child) => stack.push({ record: child, depth: entry.depth + 1 }));
  }
  return flat;
}

function mergeCommentRecords<T extends { floor: number; current?: boolean }>(
  ...groups: Array<ReadonlyArray<T | null | undefined> | null | undefined>
): T[] {
  const merged = new Map<string, T>();
  groups.forEach((records) => {
    if (!Array.isArray(records)) return;
    records.forEach((record) => {
      if (!record) return;
      const key = String(record.floor);
      const previous = merged.get(key);
      if (!previous || record.current) merged.set(key, record);
    });
  });
  return Array.from(merged.values());
}

export { buildReplyTree, flattenReplyTree, mergeCommentRecords };
export type { FlatEntry };
