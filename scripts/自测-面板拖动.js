/**
 * 【交互】调试面板可拖动 + 位置不记忆 · 自检(2026-11-01)
 * ============================================================
 * 用户需求:
 *   「调试模式的黑色框改成可以自由在页面拖动。每个页的位置都是临时单独
 *     记忆的,其中一个变化,其他不会跟着变。没有位置记忆功能,刷新网页或者
 *     重新开关调试模式都会归位。」
 *
 * 本自检覆盖两件事:
 *   ① **几何数学** —— 从 src/content/debug-panel.js 同源切片四个纯函数
 *      (scaleOf / clampPos / layoutPos / dragPos),用 vm 跑真实实现。
 *      页面挂 transform 缩放时(直播大屏),鼠标位移是屏幕像素、left/top 是
 *      布局像素,换算错一点就"跟不上手";这一层必须算准。
 *   ② **归位契约** —— 三条归位路径只能走源码断言(涉及完整状态机):
 *      刷新(内存变量重置)/ 关调试模式(teardown 清 pos)/ 收起(保留 pos)。
 *
 * 跑法:node scripts/自测-面板拖动.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src/content/debug-panel.js'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; return; }
  fails.push(name + (extra ? '  → ' + extra : ''));
}

/* ============ 同源切片 ============ */

function sliceFn(src, name) {
  const header = 'function ' + name + '(';
  const i = src.indexOf(header);
  if (i < 0) throw new Error('找不到函数:' + name);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error('函数体不闭合:' + name);
}

function sliceVar(src, name) {
  const m = src.match(new RegExp('var\\s+' + name + '\\s*=\\s*[0-9.]+;'));
  if (!m) throw new Error('找不到常量:' + name);
  return m[0];
}

const FN_NAMES = ['scaleOf', 'clampPos', 'layoutPos', 'dragPos'];
const code = [
  sliceVar(SRC, 'MIN_VISIBLE'),
  sliceVar(SRC, 'HANDLE_H'),
  ...FN_NAMES.map((n) => sliceFn(SRC, n)),
  '({ ' + FN_NAMES.map((n) => n + ': ' + n).join(', ') + ' });'
].join('\n');

const api = vm.runInNewContext(code, {});
const { scaleOf, clampPos, layoutPos, dragPos } = api;

/* ============ 一、缩放比 ============ */

ok('无缩放时比例为 1', scaleOf(460, 460) === 1, scaleOf(460, 460));
ok('页面放大到 1.25 倍(屏幕 575 布局 460)得 0.8',
  Math.abs(scaleOf(460, 575) - 0.8) < 1e-9, scaleOf(460, 575));
ok('未挂载(rect 宽 0)按 1 处理', scaleOf(460, 0) === 1, scaleOf(460, 0));
ok('未渲染(offsetWidth 0)按 1 处理', scaleOf(0, 0) === 1, scaleOf(0, 0));
ok('离谱比例(10 倍)不校正,退回 1', scaleOf(460, 46) === 1, scaleOf(460, 46));
ok('离谱比例(0.1 倍)不校正,退回 1', scaleOf(460, 4600) === 1, scaleOf(460, 4600));
ok('极小比例仍在可校正区间内(0.25)', Math.abs(scaleOf(460, 1840) - 0.25) < 1e-9,
  scaleOf(460, 1840));

/* ============ 二、视口夹取 ============ */

const VW = 1440, VH = 900, W = 460;

let c = clampPos(500, 300, W, VW, VH);
ok('视口内的位置原样保留', c.left === 500 && c.top === 300, JSON.stringify(c));

c = clampPos(-500, -100, W, VW, VH);
ok('往左上拖过头:最多只让出 120px,标题栏贴顶',
  c.left === 120 - W && c.top === 0, JSON.stringify(c));

c = clampPos(2000, 1000, W, VW, VH);
ok('往右下拖过头:右留 120px 可见,标题栏留在视口内',
  c.left === VW - 120 && c.top === VH - 34, JSON.stringify(c));

c = clampPos(100, 0, W, VW, VH);
ok('正好贴顶不越界', c.top === 0, JSON.stringify(c));

c = clampPos(0, 866, W, VW, VH);
ok('正好贴底(标题栏 34px 全可见)不越界', c.top === 866, JSON.stringify(c));

c = clampPos(100, 500, W, 300, 200);
ok('窄窗口里右侧不放任越界', c.left <= 300 - 120, JSON.stringify(c));
ok('窗口比标题栏还矮时贴顶', clampPos(100, 500, W, 300, 20).top === 0);

/* ============ 三、屏幕坐标 → 布局坐标 ============ */

// 场景 A:无缩放,rect 就是布局值
let p = layoutPos({ left: 348, top: 600 }, { left: 348, top: 600 }, 1);
ok('无缩放时坐标不变', p.left === 348 && p.top === 600, JSON.stringify(p));

// 场景 B:页面 scale(0.8),包含块原点在屏幕 0 处
// 真实布局 250 → 屏幕 200;把 200 当 left 写进去 → 屏幕 160
p = layoutPos({ left: 200, top: 0 }, { left: 160, top: 0 }, 0.8);
ok('缩放 0.8 时反推出真实布局值 250', Math.abs(p.left - 250) < 1e-9, p.left);

// 场景 C:缩放 0.5 且包含块原点偏移(transform-origin 不在 0)
// 真实布局 300 → 屏幕 50 + 300*0.5 = 200;写入 200 → 屏幕 50 + 100 = 150
p = layoutPos({ left: 200, top: 0 }, { left: 150, top: 0 }, 0.5);
ok('原点有偏移时仍精确(偏移被抵消)', Math.abs(p.left - 300) < 1e-9, p.left);

// 场景 D:纵向同理
p = layoutPos({ left: 0, top: 400 }, { left: 0, top: 320 }, 0.8);
ok('纵向换算与横向同规则', Math.abs(p.top - 500) < 1e-9, p.top);

/* ============ 四、拖动跟随(闭环) ============ */

// 无缩放:鼠标右下移 100/50,面板应整段跟过去
let d = dragPos(
  { left: 348, top: 400 },
  { left: 348, top: 400 },
  { left: 348, top: 400 },
  { x: 100, y: 50 }, 1
);
ok('无缩放时面板位移等于鼠标位移',
  d.left === 448 && d.top === 450, JSON.stringify(d));

// 缩放 0.8:鼠标移 100 屏幕像素,布局只该移 125
d = dragPos(
  { left: 250, top: 0 },
  { left: 200, top: 0 },
  { left: 200, top: 0 },
  { x: 100, y: 0 }, 0.8
);
ok('缩放 0.8 时布局位移 = 屏幕位移 / 0.8',
  Math.abs(d.left - 375) < 1e-9, d.left);

// 闭环:第二帧时 now 已经追上目标 ⇒ 不该再动,否则会越拖越跑
d = dragPos(
  { left: 375, top: 0 },
  { left: 200, top: 0 },
  { left: 300, top: 0 },   // 目标屏幕位 200+100=300,已到位
  { x: 100, y: 0 }, 0.8
);
ok('到位后不再叠加(闭环不漂移)', Math.abs(d.left - 375) < 1e-9, d.left);

// 连续 60 帧、每帧鼠标 +3px,模拟真实拖动:位置必须线性跟手且不漂
(function () {
  const s = 0.8;
  let cur = { left: 100, top: 100 };
  const start = { left: 100 * s, top: 100 * s };   // 原点为 0 的屏幕位
  let screen = { left: start.left, top: start.top };
  let drift = 0;
  for (let i = 1; i <= 60; i++) {
    const move = { x: i * 3, y: i * 3 };
    cur = dragPos(cur, start, screen, move, s);
    screen = { left: start.left + move.x, top: start.top + move.y };  // 浏览器跟上
    drift = Math.abs(cur.left - (100 + i * 3 / s));
  }
  ok('连续 60 帧跟手无累积漂移', drift < 1e-9, drift);
})();

/* ============ 五、归位契约(源码断言) ============ */

// ① 位置只是模块内存变量,初值 null ⇒ 刷新(脚本重新注入)必然归位
ok('位置是内存变量且初值为 null', /var pos = null;/.test(SRC));

// ② 关掉调试模式那条路径调用 teardown() 不带参数 ⇒ 清 pos
ok('teardown 支持按需清空位置', /if \(!keepPos\) pos = null;/.test(SRC));
ok('关调试模式走 teardown() 无参(清位置)',
  /if \(!isDebugMode\(\)\) teardown\(\);/.test(SRC));

// ③ 点「收起」走 teardown(true) ⇒ 保留位置
ok('收起面板保留位置', /teardown\(true\);/.test(SRC));

// ④ 重开面板时应用上次位置,且必须夹一次视口
ok('重开面板应用位置', /if \(pos\) \{[\s\S]{0,220}applyPos\(hostEl, pos\);/.test(SRC));
ok('重开时按当前窗口再夹一次', /clampPos\(pos\.left, pos\.top, hostEl\.offsetWidth/.test(SRC));

// ⑤ 位置绝不能落盘
ok('不写 localStorage', !/localStorage\.(setItem|removeItem)|localStorage\[/.test(SRC));
ok('不写 chrome.storage', !/storage\.local\.set|storage\.session\.set/.test(SRC));

// ⑥ 拖动只认可信事件(合成 mouseup 不能结束拖动)
const trustedHits = (SRC.match(/isTrusted === false/g) || []).length;
ok('mousemove / mouseup 都过滤合成事件', trustedHits >= 2, 'isTrusted 过滤处数=' + trustedHits);

// ⑦ 监听成对:加与删必须同参数(否则拖动一次后 window 上留一堆监听)
ok('mousemove 成对且都用捕获阶段',
  SRC.includes("addEventListener('mousemove', onDragMove, true)")
  && SRC.includes("removeEventListener('mousemove', onDragMove, true)"));
ok('mouseup 成对且都用捕获阶段',
  SRC.includes("addEventListener('mouseup', onDragEnd, true)")
  && SRC.includes("removeEventListener('mouseup', onDragEnd, true)"));
ok('blur 成对',
  SRC.includes("addEventListener('blur', onDragBlur, true)")
  && SRC.includes("removeEventListener('blur', onDragBlur, true)"));

// ⑧ 误点标题栏不留痕(否则点一下就永久改成 left+top 定位)
ok('未移动时还原原始样式', /if \(!d\.moved\)[\s\S]{0,320}origin\.bottom/.test(SRC));

// ⑨ 「收起」按钮不能当手柄
ok('按钮不触发拖动', /closest\('button'\)\) return;/.test(SRC));

// ⑩ 默认位置与「归位」同源:CSS 里那份默认值只有一个出处
ok('默认位置仍贴消息盒子右侧',
  SRC.includes("'bottom:34px', 'left:348px'"), '默认位置被改动?');

// ⑪ 提示语与真实行为一致(标题栏可拖)
ok('面板提示写明可拖动', SRC.includes('按住标题栏可拖动'));

// ⑫ 拖动期间不许页面选中文字 / 触摸滚动
ok('标题栏禁选中并接管触摸', /cursor: move; user-select: none/.test(SRC)
  && /touch-action: none;/.test(SRC));

/* ============ 汇总 ============ */

if (fails.length) {
  console.error('面板拖动自检失败 ' + fails.length + ' 项(通过 ' + pass + '):');
  fails.forEach((f) => console.error('  · ' + f));
  process.exit(1);
}
console.log('面板拖动自检全部通过(' + pass + ' 项)');
