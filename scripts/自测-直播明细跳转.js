'use strict';

// 直播明细页「跳转直播服务平台」按钮 —— 锚点查找 + 性能契约。
//
// 2026-11-05 性能自检补测:本文件此前**零自测覆盖**(scripts/*.js 里搜不到它),
// 而当天改动了 findAnchor 的矩形读取方式,必须锁住行为不退化。
//
// 锁的契约只有一条,但它正是改动的目的:
//   findAnchor 的 getBoundingClientRect 调用次数 == 命中候选的个数
//   —— 每个候选恰好量一次,不允许「拿 best 再重复量」的写法回来。
// 另配四条行为断言:取最靠顶、跳过不可见、文案必须全等、空列表返回 null。

const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const SRC_UNDER_TEST = 'src/live/live-detail-jump.js';
const SRC = path.join(__dirname, '..', SRC_UNDER_TEST);
const ANCHOR_TEXT = '直播大屏';

let pass = 0;
const failures = [];
function ok(label, cond, extra) {
  if (cond) { pass++; return; }
  failures.push(label + (extra ? ' —— ' + extra : ''));
}

function makeEl(text, rect) {
  const r = rect || { left: 0, top: 0, width: 80, height: 24 };
  return {
    nodeType: 1,
    isConnected: true,
    textContent: text,
    parentNode: null,
    parentElement: null,
    style: {},
    dataset: {},
    nextElementSibling: null,
    getBoundingClientRect() {
      this.__rectCalls = (this.__rectCalls || 0) + 1;
      return {
        left: r.left, top: r.top,
        right: r.left + r.width, bottom: r.top + r.height,
        width: r.width, height: r.height
      };
    },
    getAttribute() { return null; },
    setAttribute() {}, removeAttribute() {},
    appendChild() {}, removeChild() {}, insertBefore() {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} }
  };
}

function load(cands) {
  const doc = {
    hidden: false,
    documentElement: { clientWidth: 1600, clientHeight: 900 },
    body: { appendChild() {}, removeChild() {}, isConnected: true },
    querySelectorAll(sel) {
      return sel === 'button, a, [role="button"]' ? cands : [];
    },
    querySelector() { return null; },
    getElementById() { return null; },
    contains() { return true; },
    addEventListener() {}, removeEventListener() {},
    createElement() { return makeEl('', { left: 0, top: 0, width: 80, height: 24 }); }
  };
  cands.forEach((c) => { c.parentNode = doc.body; c.parentElement = doc.body; });

  const ctx = {
    window: { innerWidth: 1600, innerHeight: 900, addEventListener() {}, removeEventListener() {} },
    document: doc,
    location: { href: 'https://compass.jinritemai.com/shop/live-detail' },
    console,
    setTimeout, clearTimeout,
    setInterval() { return 0; }, clearInterval() {},
    chrome: {
      runtime: { lastError: null, sendMessage(m, cb) { if (cb) cb(); } },
      storage: { local: { get() { return Promise.resolve({}); } }, onChanged: { addListener() {} } }
    },
    // 开关读成「关」,让 start() 不跑 —— 本套只测 findAnchor 这一个纯函数,
    // 不去承担 UI 挂载链路的夹具成本(那是另一件事)。
    dycReadFlags() { return Promise.resolve({ liveDetailJump: false }); },
    dycWatchFlags() {},
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } }
  };
  ctx.window.document = doc;
  vm.createContext(ctx);

  let src = fs.readFileSync(SRC, 'utf8');
  const before = src;
  src = src.replace(/\}\)\(\);\s*$/, '\nwindow.__perf = { findAnchor: findAnchor };\n})();');
  if (src === before) throw new Error('注入导出钩子失败 —— 文件末尾结构变了,检查 IIFE 收尾');
  vm.runInContext(src, ctx, { filename: SRC_UNDER_TEST });
  if (!ctx.window.__perf || typeof ctx.window.__perf.findAnchor !== 'function') {
    throw new Error('findAnchor 没拿到 —— 导出钩子注入位置可能已失效');
  }
  return ctx.window.__perf;
}

function rectTotal(cands) {
  return cands.reduce((n, c) => n + (c.__rectCalls || 0), 0);
}

/* ---------- ① 取最靠顶 + 每个候选只量一次 ---------- */
{
  const cands = [
    makeEl(ANCHOR_TEXT, { left: 10, top: 100, width: 90, height: 24 }),
    makeEl(ANCHOR_TEXT, { left: 10, top: 80, width: 90, height: 24 }),
    makeEl(ANCHOR_TEXT, { left: 10, top: 120, width: 90, height: 24 }),
    makeEl(ANCHOR_TEXT, { left: 10, top: 60, width: 90, height: 24 }),
    makeEl(ANCHOR_TEXT, { left: 10, top: 200, width: 90, height: 24 })
  ];
  const api = load(cands);
  const got = api.findAnchor();
  // 注意:这里不能再调 got.getBoundingClientRect() —— 那会污染下面的计数断言。
  ok('A1 多个命中取最靠顶的那个', got === cands[3], '返回的不是 top 最小的那枚');
  const total = rectTotal(cands);
  ok('A2 五个候选只量五次(每候选一次,不重复量 best)', total === 5,
     '实际 ' + total + ' 次' + (total > 5 ? ' —— 疑似又出现「对 best 重复读矩形」' : ''));
}

/* ---------- ② 跳过不可见(宽或高不足)---------- */
{
  const cands = [
    makeEl(ANCHOR_TEXT, { left: 0, top: 40, width: 0, height: 0 }),     // 折叠
    makeEl(ANCHOR_TEXT, { left: 0, top: 70, width: 90, height: 0 }),    // 塌陷
    makeEl(ANCHOR_TEXT, { left: 0, top: 90, width: 90, height: 24 })    // 唯一可见
  ];
  const api = load(cands);
  const got = api.findAnchor();
  ok('A3 不可见候选被跳过,返回真正可见的那枚', got === cands[2]);
  ok('A4 不可见候选也要量(判可见性必须量),读数仍等于候选数', rectTotal(cands) === 3,
     '实际 ' + rectTotal(cands) + ' 次');
}

/* ---------- ③ 文案必须全等,不许 includes ---------- */
{
  const cands = [
    makeEl('去' + ANCHOR_TEXT, { left: 0, top: 10, width: 120, height: 24 }),
    makeEl(ANCHOR_TEXT + '页面', { left: 0, top: 20, width: 120, height: 24 }),
    makeEl('跳转直播服务平台', { left: 0, top: 30, width: 120, height: 24 })
  ];
  const api = load(cands);
  ok('A5 长得像但不等同的文案一律不认(防误插到别的按钮旁)', api.findAnchor() === null,
     '把长文案当成锚点了');
}

/* ---------- ④ 空格差异不影响(归一化口径)---------- */
{
  const spaced = makeEl('直播 大屏', { left: 0, top: 50, width: 90, height: 24 });
  const api = load([spaced]);
  ok('A6 文本里的空格被归一化后仍能命中', api.findAnchor() === spaced);
}

/* ---------- ⑤ 空列表 ---------- */
{
  const api = load([]);
  ok('A7 页面没有可点元素时返回 null 且零读数', api.findAnchor() === null);
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(62));
console.log('通过 ' + pass + ' / ' + (pass + failures.length));
if (failures.length) {
  console.log('失败用例:');
  failures.forEach((f) => console.log('  · ' + f));
  process.exit(1);
}
console.log('全绿 ✓ —— 锚点查找取最靠顶、跳过不可见、文案全等,且矩形读取次数严格等于候选数');
