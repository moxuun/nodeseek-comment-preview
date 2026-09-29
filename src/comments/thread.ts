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

/**
 * 楼层关系线几何：供 preview/renderer.ts 的 applyThreadGeometry 与 ui/style.ts 画线用。
 * 竖线层级 k 代表“深度 k 的祖先的子女流”（x = 18k + 6，宽 3px）。
 */
interface ThreadLines {
  /** 需要贯穿整行（含上下各 3px 桥接）的竖线层级。 */
  full: number[];
  /** 父层竖线需要在本条目横线处收口的层级（-1 表示不收口）；本条是父层最后一条子楼层时用它。 */
  stop: number;
}

/** 楼层缩进的最大层级：更深的楼层压平到这一层，卡片缩进与竖线坐标共用这套映射。 */
const THREAD_LEVEL_LIMIT = 8;
/** 竖线最多画到哪一层；必须比缩进上限小 1，否则最深层的竖线会落到自己的卡片里。 */
const THREAD_COLUMN_LIMIT = THREAD_LEVEL_LIMIT - 1;

/** 真实深度 → 卡片缩进层级。 */
function threadLevel(depth: number): number {
  return Math.min(depth, THREAD_LEVEL_LIMIT);
}

/** 真实深度 → 竖线层级（“该深度的祖先的子女流”所在的列）。 */
function threadColumn(depth: number): number {
  return Math.min(depth, THREAD_COLUMN_LIMIT);
}

/** 展平后的楼层条目，供虚拟列表逐层渲染。 */
interface FlatEntry {
  record: CommentRecord;
  depth: number;
  /** 关系线几何，见 ThreadLines。 */
  thread: ThreadLines;
}

function flattenReplyTree(records: CommentRecord[]): FlatEntry[] {
  const flat: FlatEntry[] = [];
  const roots = buildReplyTree(records);
  // 深度优先展平，同时按树结构算出每行的关系线几何：
  // 子楼层不是父层最后一条时，父层竖线要贯穿子楼层整行（后面还有兄弟）；
  // 是最后一条时父层竖线只在子楼层横线处收口，否则没有后续兄弟也会垂出一条长线。
  // 层级统一经过 threadLevel/threadColumn 映射：超过缩进上限的深楼层被压平，
  // 卡片缩进与竖线坐标用的是同一套层级，不会出现线跑到卡片外面的情况。
  const stack: FlatEntry[] = roots.slice().reverse().map((record) => ({ record, depth: 0, thread: { full: [], stop: -1 } }));
  while (stack.length) {
    const entry = stack.pop();
    if (!entry) continue;
    flat.push(entry);
    const children = entry.record.children;
    children.slice().reverse().forEach((child, index) => {
      // 反向遍历：第一个处理的是最后一条子楼层。
      const isLastChild = index === 0;
      stack.push({
        record: child,
        depth: entry.depth + 1,
        thread: {
          full: isLastChild ? entry.thread.full : entry.thread.full.concat(threadColumn(entry.depth)),
          stop: isLastChild ? threadColumn(entry.depth) : -1,
        },
      });
    });
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

export { buildReplyTree, flattenReplyTree, mergeCommentRecords, THREAD_COLUMN_LIMIT, THREAD_LEVEL_LIMIT, threadColumn, threadLevel };
export type { FlatEntry, ThreadLines };
