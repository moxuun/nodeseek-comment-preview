// 楼层关系线几何的纯逻辑测试：直接 import src/comments/thread.ts（Node ≥ 23 原生剥离类型，
// thread.ts 只有 import type，运行时零依赖），用几组小型树核对 flattenReplyTree 的输入输出。
//
// 规则：竖线层级 k 代表“深度 k 的祖先的子女流”。子楼层不是父层最后一条时，父层竖线要贯穿整行
// （后面还有兄弟）；是最后一条时父层只在本行横线处收口（stop），不能垂空线。
// 浏览器场景（run-tests.mjs 的 0.5.81 回归）只负责确认这些几何正确映射到 CSS，不再用渲染结果反推树规则。

import { flattenReplyTree, threadLevel } from '../../src/comments/thread.ts';

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

// 深度上限：超过 8 层的楼层被压平到第 8 层；竖线最多画到第 7 层，否则最深的竖线会落进自己的卡片里。
const deepChain = Array.from({ length: 12 }, (_, index) => (index === 0 ? record(1) : record(index + 1, index)));
check('关系线：超过缩进上限的深链逐层收口、收口层级封顶在第 7 层', lines(deepChain),
  ['1:0 full=[] stop=-1', '2:1 full=[] stop=0', '3:2 full=[] stop=1', '4:3 full=[] stop=2', '5:4 full=[] stop=3',
    '6:5 full=[] stop=4', '7:6 full=[] stop=5', '8:7 full=[] stop=6', '9:8 full=[] stop=7', '10:9 full=[] stop=7',
    '11:10 full=[] stop=7', '12:11 full=[] stop=7']);

// 上限之下再分叉：第 10 楼（深度 9，已压平）有两个子楼层，先出现的那条继承第 7 层竖线，末条收口在第 7 层。
const deepBranch = deepChain.slice(0, 10).concat([record(11, 10), record(12, 10)]);
check('关系线：压平层的兄弟仍按贯穿/收口区分', lines(deepBranch).slice(-2),
  ['11:10 full=[7] stop=-1', '12:10 full=[] stop=7']);

// 通用不变量：任何一行的贯穿层级与收口层级都必须小于本行的缩进层级，否则线会画到卡片里面。
function checkColumnsLeftOfCard(name, records) {
  const bad = flattenReplyTree(records)
    .filter((entry) => [...entry.thread.full, entry.thread.stop]
      .some((level) => level >= 0 && level >= threadLevel(entry.depth)))
    .map((entry) => `${entry.record.floor}@${entry.depth}`);
  check(`关系线：${name} 的竖线都在卡片左侧`, bad, []);
}

checkColumnsLeftOfCard('深链', deepChain);
checkColumnsLeftOfCard('上限处分叉', deepBranch);
checkColumnsLeftOfCard('多兄弟与末子节点带后代', [record(1), record(2, 1), record(4, 2), record(5, 2), record(3, 1), record(6, 5)]);

// 异常数据：两条楼层互相引用会形成没有根的环，环里的楼层会整条从展示结果里消失；现在把环上
// 最早出现的那条楼层的父子边降级成根节点，保证每条记录都能被渲染。
check('关系线：互相引用时降级成根节点，两条都保留', lines([record(1, 2), record(2, 1)]),
  ['1:0 full=[] stop=-1', '2:1 full=[] stop=0']);
check('关系线：三楼层成环时同样降级，不丢楼层', lines([record(1, 2), record(2, 3), record(3, 1)]),
  ['1:0 full=[] stop=-1', '3:1 full=[] stop=0', '2:2 full=[] stop=1']);

// 通用不变量：不管树里有环还是异常引用，展平结果都要包含每一条楼层。
function checkKeepsEveryFloor(name, records) {
  const floors = flattenReplyTree(records).map((entry) => entry.record.floor).sort((a, b) => a - b);
  const expected = records.map((item) => item.floor).sort((a, b) => a - b);
  check(`关系线：${name} 每条楼层都会出现在展平结果里`, floors, expected);
}

checkKeepsEveryFloor('互相引用', [record(1, 2), record(2, 1)]);
checkKeepsEveryFloor('三楼层成环', [record(1, 2), record(2, 3), record(3, 1)]);
checkKeepsEveryFloor('自引用加正常树', [record(1, 1), record(2, 1), record(3, 2), record(4, 99)]);

export { failures };
