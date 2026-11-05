/**
 * 拖拽闸门 · 回归自测（2026-11-05 · 反馈 #130）
 * ============================================================
 * 被测文件：src/content/drag-gate.js
 *
 * 为什么要有它：
 *   这个模块唯一的职责是「判断现在是不是正在拖拽」，而它的错误方向是**双向**的：
 *     · 判漏（该让路却照常补涂）⇒ 购物车拖动时每帧全量重扫，掉帧；
 *     · 判多（没拖却一直让路）⇒ 按钮与名称换行停在旧状态、永不刷新。
 *   所以两条都要钉死：只在真拖拽（含松手后的落点冷却）期间为真，且一定会复位。
 *
 * 覆盖：
 *   A. 初始空闲；非可信事件（程序化点击）不进入拖拽态
 *   B. 抓住平台拖动把手 ⇒ 立刻进入拖拽态（不用等位移）
 *   C. 整行按下**不移动**不算拖（普通点击不能被当成拖拽）；移动超阈值才算
 *   D. 落在扩展自己的控件上（货号按钮等）不算拖
 *   E. 松手后进入冷却，冷却结束才恢复，并**只补一次**
 *   F. 同一回调在拖拽期反复登记只执行一次（拖拽期每帧都会问）
 *   G. 收不到 pointerup 时 60 秒强制复位（防卡在「拖拽中」永不刷新）
 *   H. 监听在松手后摘干净（不残留 window 监听）
 *   I. 接线契约：name-wrap / copy-code 的补涂入口确实询问了闸门
 *
 * 用法：node scripts/自测-拖拽闸门.js
 * 退出码 0 = 全绿；1 = 有用例失败。
 * ============================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SRC_UNDER_TEST = 'src/content/drag-gate.js';
const ROOT = path.resolve(__dirname, '..');

/* ============================================================
 * 1. 假时钟 + 最小事件垫片
 * ============================================================ */

let clock = 1000000;
let seq = 0;
const timers = new Map();

function advance(ms) {
  const end = clock + ms;
  for (;;) {
    let next = null;
    for (const entry of timers) {
      if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
    }
    if (!next) break;
    clock = next[1].at;
    timers.delete(next[0]);
    next[1].fn();
  }
  clock = end;
}

const docListeners = [];
const doc = {
  addEventListener(type, fn) { docListeners.push({ type, fn }); },
  removeEventListener() {}
};

const winListeners = new Map();
const win = {
  addEventListener(type, fn) {
    if (!winListeners.has(type)) winListeners.set(type, []);
    const arr = winListeners.get(type);
    if (arr.indexOf(fn) === -1) arr.push(fn);
  },
  removeEventListener(type, fn) {
    const arr = winListeners.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
};
function fireWin(type, e) {
  const arr = (winListeners.get(type) || []).slice();
  for (const fn of arr) fn(e);
}
function winCount(type) { return (winListeners.get(type) || []).length; }

const ctx = {
  window: win,
  document: doc,
  console: console,
  setTimeout(fn, ms) {
    const id = ++seq;
    timers.set(id, { fn, at: clock + Math.max(0, Math.floor(ms || 0)) });
    return id;
  },
  clearTimeout(id) { timers.delete(id); },
  Date: { now: function () { return clock; } }
};

vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, SRC_UNDER_TEST), 'utf8'), ctx, { filename: SRC_UNDER_TEST });

const busy = win.__dycDragBusy;
const whenIdle = win.__dycWhenDragIdle;

assert.equal(typeof busy, 'function', '闸门必须提供 __dycDragBusy');
assert.equal(typeof whenIdle, 'function', '闸门必须提供 __dycWhenDragIdle');

/* ============================================================
 * 2. 事件垫片：只回答本模块真正会问的两个选择器
 * ============================================================ */

const HANDLE = '[data-rbd-drag-handle-draggable-id]';
const ROW = '[data-rbd-draggable-id]';
const OWN = '.dyc-code-btn,#dyc-toolbar,#dyc-omni-shell,#dyc-search-fab,' +
            '#dyc-search-pill,.dyb-status,#dyb-bag-badge,#dyb-bag-panel';

function target(kind) {
  return {
    kind: kind,
    closest(sel) {
      const s = String(sel);
      if (s === OWN) return kind === 'own' ? { own: true } : null;
      if (s === HANDLE) return kind === 'handle' ? { handle: true } : null;
      if (s === ROW) return (kind === 'handle' || kind === 'row') ? { row: true } : null;
      return null;
    }
  };
}

function down(kind, x, y, trusted) {
  const e = { isTrusted: trusted !== false, target: target(kind), clientX: x || 0, clientY: y || 0 };
  for (const h of docListeners) if (h.type === 'pointerdown') h.fn(e);
}
function up() { fireWin('pointerup', {}); }

/* ============================================================
 * 3. 用例
 * ============================================================ */

let order = 0;

/* A. 初始空闲 + 非可信事件 */
assert.strictEqual(busy(), false, '初始必须空闲');
down('handle', 10, 10, false);
assert.strictEqual(busy(), false, '程序化事件不算拖拽');

/* B. 抓住把手立刻进入拖拽态 */
down('handle', 10, 10);
assert.strictEqual(busy(), true, '按住拖动把手即进入拖拽态');

/* E/F. 拖拽期登记的回调不执行、去重、松手冷却后只补一次 */
let hits = 0;
const job = function () { hits++; order++; };
whenIdle(job);
whenIdle(job);
whenIdle(job);
assert.strictEqual(hits, 0, '拖拽期不得执行补扫');
advance(300);
assert.strictEqual(hits, 0, '拖拽期再久也不执行');
up();
assert.strictEqual(busy(), true, '松手后仍在冷却期（等落点动画）');
advance(100);
assert.strictEqual(hits, 0, '冷却期内不补扫');
advance(350);
assert.strictEqual(busy(), false, '冷却结束后恢复');
assert.strictEqual(hits, 1, '同一回调只补一次');

/* H. 监听摘干净 */
assert.strictEqual(winCount('pointerup'), 0, '松手后必须摘掉 window 监听');
assert.strictEqual(winCount('pointermove'), 0, '松手后必须摘掉 pointermove');

/* C. 整行按下不移动 = 点击，不算拖 */
down('row', 100, 100);
assert.strictEqual(busy(), false, '只按下整行不算拖拽');
fireWin('pointermove', { clientX: 102, clientY: 101 });
assert.strictEqual(busy(), false, '微小抖动不算拖拽');
fireWin('pointermove', { clientX: 106, clientY: 100 });
assert.strictEqual(busy(), true, '位移超过阈值才算拖');
up();
advance(500);

/* D. 扩展自己的控件不参与 */
down('own', 10, 10);
assert.strictEqual(busy(), false, '点货号按钮不能进拖拽态');
fireWin('pointermove', { clientX: 40, clientY: 40 });
assert.strictEqual(busy(), false, '在自己控件上划线也不算拖');
up();

/* G. 丢事件兜底：60 秒强制复位 */
down('handle', 10, 10);
assert.strictEqual(busy(), true, '兜底用例起点');
advance(61000);
assert.strictEqual(busy(), false, '丢 pointerup 也要在 60 秒内复位');
let afterHold = 0;
whenIdle(function () { afterHold++; });
assert.strictEqual(afterHold, 1, '复位后补扫立即执行');

/* 空闲时 whenIdle 直接执行，不排队 */
let direct = 0;
whenIdle(function () { direct++; });
assert.strictEqual(direct, 1, '空闲时立即执行');

/* ============================================================
 * 4. 接线契约：使用方必须在补涂入口询问闸门
 * ============================================================ */
for (const f of ['src/live/name-wrap.js', 'src/live/copy-code.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  assert.ok(src.indexOf('__dycDragBusy') >= 0, f + ' 必须在补涂入口询问拖拽闸门');
  assert.ok(src.indexOf('__dycWhenDragIdle') >= 0, f + ' 必须登记「松手后补一轮」');
}

console.log('拖拽闸门自测：全部通过');
console.log('  · 把手按下即让路、整行需位移阈值、自家控件不误判');
console.log('  · 松手冷却 400ms 后只补一次，丢事件 60 秒兜底复位');
