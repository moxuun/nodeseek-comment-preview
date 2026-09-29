// 楼层关系线几何的纯逻辑测试：直接 import src/comments/thread.ts（Node ≥ 23 原生剥离类型，
// thread.ts 只有 import type，运行时零依赖），用几组小型树核对 flattenReplyTree 的输入输出。
//
// 规则：竖线层级 k 代表“深度 k 的祖先的子女流”。子楼层不是父层最后一条时，父层竖线要贯穿整行
// （后面还有兄弟）；是最后一条时父层只在本行横线处收口（stop），不能垂空线。
// 浏览器场景（run-tests.mjs 的 0.5.81 回归）只负责确认这些几何正确映射到 CSS，不再用渲染结果反推树规则。

import { flattenReplyTree } from '../../src/comments/thread.ts';

let failures = 0;

const record = (floor, targetFloor) => ({
  floor,
  page: 1,
  index: floor,
  reply: targetFloor ? { targetFloor } : null,
});

// 展平结果压成 `楼层:深度 full=[…] stop=…`，便于逐条对拍。
const lines = (records) => flattenReplyTree(records)
  .map((entry) => `${entry.record.floor}:${entry.depth} full=[${entry.thread.full.join(',')}] stop=${entry.thread.stop}`);

function check(name, actual, expected) {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText === expectedText) {
    console.log(`✓ ${name}`);
    return;
  }
  failures += 1;
  console.log(`✗ ${name}\n    期望 ${expectedText}\n    实际 ${actualText}`);
}

// 单链：每层都是父层唯一的子楼层，没有任何层需要贯穿，全部在父层竖线处收口。
check('关系线：单链逐层收口', lines([record(1), record(2, 1), record(3, 2)]),
  ['1:0 full=[] stop=-1', '2:1 full=[] stop=0', '3:2 full=[] stop=1']);

// 多兄弟：不是最后一条的子楼层要把父层竖线贯穿整行，最后一条收口。
check('关系线：多兄弟只有末条收口', lines([record(1), record(2, 1), record(3, 1)]),
  ['1:0 full=[] stop=-1', '2:1 full=[0] stop=-1', '3:1 full=[] stop=0']);

// 末子节点带后代：末子节点不继承更上层竖线，它的后代只继承本层（0 层竖线在末子处就收掉了）。
check('关系线：末子节点的后代不带更上层竖线',
  lines([record(1), record(2, 1), record(4, 2), record(3, 1), record(5, 3)]),
  ['1:0 full=[] stop=-1', '2:1 full=[0] stop=-1', '4:2 full=[0] stop=1', '3:1 full=[] stop=0', '5:2 full=[] stop=1']);

// 非末子节点带后代：非末子把父层竖线传给后代，后代自己不是末条时再叠一层。
check('关系线：非末子节点的后代叠加本层竖线',
  lines([record(1), record(2, 1), record(4, 2), record(5, 2), record(3, 1)]),
  ['1:0 full=[] stop=-1', '2:1 full=[0] stop=-1', '4:2 full=[0,1] stop=-1', '5:2 full=[0] stop=1', '3:1 full=[] stop=0']);

// 跨页追加：后一页返回的兄弟会改变前一页最后一条的几何（收口 → 贯穿），所以展平必须整棵重算。
check('关系线：只有一页时第 2 楼收口', lines([record(1), record(2, 1)]),
  ['1:0 full=[] stop=-1', '2:1 full=[] stop=0']);
check('关系线：跨页追加兄弟后第 2 楼改为贯穿', lines([record(1), record(2, 1), record(3, 1)]),
  ['1:0 full=[] stop=-1', '2:1 full=[0] stop=-1', '3:1 full=[] stop=0']);

export { failures };
