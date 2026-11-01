'use strict';
// 清空库存按钮结果反馈（2026-10-29）：勾 / 叉、2.5 秒复原、连点保护、幽灵节点。
// 从源码抠 clearStockFeedback 本体跑，用最小假节点，不假装成浏览器。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '../src/content/inject-button.js'), 'utf8');
const start = code.indexOf('function clearStockFeedback(');
const end = code.indexOf('\n/**', start);
if (start < 0 || end < start) throw new Error('源码里没找到 clearStockFeedback，结构变了');

function makeButton(text, title) {
  const classes = new Set();
  return {
    textContent: text, title, innerHTML: '',
    isConnected: true,
    style: {},
    attrs: {},
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      remove(...names) { names.forEach((n) => classes.delete(n)); },
      contains(name) { return classes.has(name); }
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; }
  };
}

const timers = [];
let cleared = 0;
const context = vm.createContext({
  BUTTON_CLASS: 'dyb-clear-btn',
  setTimeout(fn, ms) { timers.push({ fn, ms, id: timers.length }); return timers.length; },
  clearTimeout(id) { cleared++; const t = timers[id - 1]; if (t) t.fn = null; }
});
vm.runInContext(code.slice(start, end), context);

const okPath = 'M5 12l5 5L19 7';
const failPath = 'M6 6l12 12M18 6L6 18';

// ① 成功：绿勾 + 无障碍标签 + 锁定点击 + 2.5 秒
const btn1 = makeButton('清空库存', '将该商品所有规格的普通库存清零');
const row1 = { isConnected: true, querySelector: () => btn1 };
context.clearStockFeedback(row1, 'ok');
assert.equal(btn1.classList.contains('dyc-clear-ok'), true, '成功应加绿勾类');
assert.equal(btn1.attrs['aria-label'], '库存已清零');
assert.match(btn1.innerHTML, new RegExp(okPath), '成功应画勾');
assert.equal(btn1.style.pointerEvents, 'none', '反馈期间不许再点');
assert.equal(timers[0].ms, 2500, '保留 2.5 秒');

// ② 到点复原：文字、悬停说明、类、标签、可点击全部还原
timers[0].fn();
assert.equal(btn1.textContent, '清空库存', '应恢复按钮文字');
assert.equal(btn1.title, '将该商品所有规格的普通库存清零', '应恢复原悬停说明');
assert.equal(btn1.classList.contains('dyc-clear-ok'), false, '应摘掉绿勾类');
assert.equal(btn1.attrs['aria-label'], undefined, '应清掉无障碍标签');
assert.equal(btn1.style.pointerEvents, '', '应恢复可点击');

// ③ 失败：红叉
const btn2 = makeButton('清空库存', '清空渠道品库存，清零后库存归还主品');
const row2 = { isConnected: true, querySelector: () => btn2 };
context.clearStockFeedback(row2, 'fail');
assert.equal(btn2.classList.contains('dyc-clear-fail'), true, '失败应加红叉类');
assert.equal(btn2.attrs['aria-label'], '清零失败');
assert.match(btn2.innerHTML, new RegExp(failPath), '失败应画叉');

// ④ 渠道品的悬停说明也要按原样复原，不能写死成商品列表那一句
const t2 = timers[timers.length - 1];
t2.fn();
assert.equal(btn2.title, '清空渠道品库存，清零后库存归还主品', '渠道品说明不应被覆盖');

// ⑤ 连点两次：前一个定时器必须被清掉，否则先到点的会把后一次结果抹掉
const btn3 = makeButton('清空库存', 'x');
const row3 = { isConnected: true, querySelector: () => btn3 };
context.clearStockFeedback(row3, 'ok');
const before = timers.length;
context.clearStockFeedback(row3, 'fail');
assert.equal(cleared >= 1, true, '第二次反馈应先清掉上一个定时器');
assert.equal(btn3.classList.contains('dyc-clear-fail'), true, '以最后一次结果为准');
assert.equal(timers.length, before + 1);

// ⑥ 按钮已被页面重渲染销毁：到点不再往幽灵节点写字
const btn4 = makeButton('清空库存', 'y');
const row4 = { isConnected: true, querySelector: () => btn4 };
context.clearStockFeedback(row4, 'ok');
const html4 = btn4.innerHTML;
btn4.isConnected = false;
timers[timers.length - 1].fn();
assert.equal(btn4.innerHTML, html4, '节点已脱离文档，不应再改它');

// ⑦ 行本身不在文档里：连按钮都不用查
let queried = 0;
context.clearStockFeedback({ isConnected: false, querySelector() { queried++; } }, 'ok');
assert.equal(queried, 0, '行不在文档就不该查按钮');

// ⑧ 没有按钮 / 传空：静默，不抛错
context.clearStockFeedback({ isConnected: true, querySelector: () => null }, 'ok');
context.clearStockFeedback(null, 'ok');
context.clearStockFeedback({}, 'fail');

// ⑨ 确认框风险文案（2026-10-30 用户定稿：只留两句，不再提区域库存）
assert.match(code, /此操作将把该商品所有规格的普通库存清零，执行后不可撤销。/);
assert.match(code, /若该商品正在直播中，会导致直播间无法继续下单。/);
assert.doesNotMatch(code, /区域库存（超市小时达等）不受影响/, '区域库存那行已按用户要求删掉');
assert.doesNotMatch(code, /直播间将无法继续下单/, '末句改成「会导致直播间无法继续下单」');

// ⑩ 直提说「本来就 0」的可信度对账（2026-10-30 批量 8 个全跳过）
// 页面行内还有库存、接口却算成 0（库存 v2 / 批次结构读法变了）时，必须回退点击链路核对。
const csCode = fs.readFileSync(path.join(__dirname, '../src/content/clear-stock.js'), 'utf8');
const tStart = csCode.indexOf('function trustAlreadyZero(');
const tEnd = csCode.indexOf('\n}', tStart);
if (tStart < 0 || tEnd < tStart) throw new Error('clear-stock.js 里没找到 trustAlreadyZero');
vm.runInContext(csCode.slice(tStart, tEnd + 2), context);
assert.equal(context.trustAlreadyZero(0), true, '两边都是 0 才算真「本就为 0」');
assert.equal(context.trustAlreadyZero(undefined), true, '读不到页面库存时按接口结论走');
assert.equal(context.trustAlreadyZero(12), false, '页面行内 > 0 时不许认「已是 0」，必须回退核对');

console.log('库存清零按钮反馈自测：通过；勾只给确认成功，反馈期间禁点，2.5 秒按原样复原；' +
  '直提的「已是 0」要与页面行内对账。');
