'use strict';
// 库存清零各出口的消息与按钮反馈（2026-10-29 扩充）
// 规矩：只有接口确认清零成功才给勾；「已提交保存，请核对库存」不给勾。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');
const code = fs.readFileSync(path.join(__dirname, '../src/content/clear-stock.js'), 'utf8');
const start = code.indexOf('async function startClearStock(');
const end = code.indexOf('\n/**', start);

const messages = [];
const feedbacks = [];
let resets = 0, scheduled = 0;
let saveFound = false;
let editIcon = true;
let clearReady = true;
let editorOpen = false;
let inputCount = 0;
let fillCount = 0;

const context = vm.createContext({
  window: {}, document: {}, debugLog() {}, isDebugMode: () => false,
  findStockEditIcon: () => (editIcon ? { click() {} } : null),
  waitClearAllButton: async () => (clearReady
    ? { ready: true, button: { disabled: false, click() {} } }
    : { ready: false, reason: '没等到清零控件', editorOpen }),
  sleep: async () => {}, updateProgress() {}, clickSaveButton: () => saveFound,
  findStockInputs: () => Array.from({ length: inputCount }, () => ({})),
  fillStockInputsZero: () => fillCount,
  failStatus: (text, opts) => messages.push({ text, opts, type: 'error' }),
  finishStatus: (text, opts) => messages.push({ text, opts, type: 'success' }),
  toast: (text, kind, opts) => messages.push({ text, kind, opts: opts || {}, type: 'toast' }), resetInjection: () => resets++, injectAllRows() {},
  clearStockFeedback: (row, result) => feedbacks.push(result),
  // setTimeout 只有「恢复注入」那一处（1500ms）要计数；进度闸门挂的 700ms 计时器
  // 不执行也不计数 —— 它的行为另有 自测-进度延迟 专门测。
  setTimeout: (fn, ms) => { if (ms === 1500) scheduled++; return 0; },
  clearTimeout: () => {},
  setStatus: (text, type, opts) => messages.push({ text, type: 'status', opts: opts || {} })
});

function pickFn(name) {
  const start = code.indexOf('function ' + name + '(');
  assert.ok(start > 0, '源码里没找到 ' + name);
  let depth = 0, opened = false;
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') { depth++; opened = true; }
    else if (code[i] === '}') { depth--; if (opened && depth === 0) return code.slice(start, i + 1); }
  }
  throw new Error(name + ' 没有闭合');
}

['createProgressGate', 'clickLikeUser', 'describeInput', 'hasEditorOverlay', 'trustAlreadyZero'].forEach((name) => {
  vm.runInContext(pickFn(name), context);
});
vm.runInContext(code.slice(start, end), context);

const last = () => messages[messages.length - 1];

(async () => {
  // ① 直提成功：接口确认 ⇒ 给勾，且不再走点击链路
  context.window.__DYC_STOCK_DIRECT__ = {
    tryDirectClearStock: async () => ({ ok: true }),
    updateRowStockDisplay() {}
  };
  await context.startClearStock({}, { title: '商品甲', productId: '1' });
  assert.deepEqual(feedbacks, ['ok'], '接口确认成功才给勾');
  assert.match(last().opts.count, /库存已清零/);

  // ② 库存本来就是 0：提前拦截，不算失败，不给叉
  context.window.__DYC_STOCK_DIRECT__ = { tryDirectClearStock: async () => ({ why: 'already-zero' }) };
  await context.startClearStock({}, { title: '商品乙', productId: '2' });
  assert.deepEqual(feedbacks, ['ok'], '已是 0 不给叉');

  // ③ 找不到库存编辑区：叉
  context.window.__DYC_STOCK_DIRECT__ = undefined;
  editIcon = false;
  await context.startClearStock({}, { title: '商品丙' });
  assert.deepEqual(feedbacks, ['ok', 'fail'], '找不到编辑区应给叉');
  editIcon = true;

  // ④ 等不到「全部清零」：编辑区没打开 ⇒ 提示去点编辑图标
  clearReady = false;
  editorOpen = false;
  await context.startClearStock({}, { title: '商品丁' });
  assert.deepEqual(feedbacks, ['ok', 'fail', 'fail'], '等不到清零控件应给叉');
  assert.equal(last().opts.count, '没等到库存编辑区', '编辑区没开时要说清去点编辑图标');
  assert.match(last().opts.full, /编辑图标/);

  // ④b 编辑区已打开、只是没有全清控件 ⇒ 换一句提示（#124 那类商品）
  editorOpen = true;
  await context.startClearStock({}, { title: '商品丁二' });
  assert.deepEqual(feedbacks, ['ok', 'fail', 'fail', 'fail']);
  assert.equal(last().opts.count, '没有「全部清零」控件', '已展开却没控件要另说');
  assert.match(last().opts.full, /逐个规格/);
  editorOpen = false;
  clearReady = true;

  // ⑤ 自动保存失败：叉，并恢复注入
  saveFound = false;
  await context.startClearStock({}, { title: '商品戊' });
  assert.deepEqual(feedbacks, ['ok', 'fail', 'fail', 'fail', 'fail'], '保存失败应给叉');
  assert.equal(resets, 1);
  assert.equal(scheduled, 1);
  assert.match(last().opts.count, /手动保存/);

  // ⑥ 已点击保存：只确认提交，库存未回读 ⇒ 不给勾、不给叉
  saveFound = true;
  const before = feedbacks.length;
  await context.startClearStock({}, { title: '商品己' });
  assert.equal(feedbacks.length, before, '只确认提交不能打勾');
  assert.equal(resets, 2);
  assert.equal(scheduled, 2);
  assert.match(last().opts.count, /已提交保存/);
  assert.doesNotMatch(last().opts.count, /库存已清零/);

  // ⑦ 没有「全部清零」但有库存框 ⇒ 逐个填 0 再保存（#124 时效批次那条链路）
  const baseResets = resets, baseScheduled = scheduled, baseFb = feedbacks.length;
  clearReady = false;
  editorOpen = true;
  inputCount = 3;
  fillCount = 3;
  saveFound = true;
  await context.startClearStock({}, { title: '时效批次商品' });
  assert.equal(resets, baseResets + 1, '走通后要重置注入');
  assert.equal(scheduled, baseScheduled + 1);
  assert.equal(last().type, 'success');
  assert.equal(last().opts.count, '已提交保存，请核对库存');
  assert.equal(feedbacks.length, baseFb, '只点了保存、没回读落库，不能打勾');

  // ⑧ 编辑区开了但一个可用库存框都没有 ⇒ 退回「没有全部清零控件」并给叉
  fillCount = 0;
  inputCount = 0;
  const fbBefore = feedbacks.length;
  await context.startClearStock({}, { title: '无框商品' });
  assert.equal(last().type, 'toast');
  assert.equal(last().opts.count, '没有「全部清零」控件');
  assert.deepEqual(feedbacks.slice(fbBefore), ['fail'], '什么都没做成要给叉');

  // ⑨ 快路径不展示过程提示（用户 2026-10-29：结果那么快出就别展示过程）
  //    闸门的计时器在这套桩里不会触发 ⇒ 一条 running 消息都不该出现，
  //    收尾消息也不该带 dropRunning（没有过程消息可收）。
  assert.equal(messages.filter((m) => m.type === 'status').length, 0, '快路径不该出现过程消息');
  assert.ok(messages.every((m) => !m.opts || !m.opts.dropRunning), '没有过程消息时不必让结果去收');

  // ⑩ 批量模式（quiet）：一条消息都不出，只把结果回调出去
  const beforeQuiet = messages.length;
  const quietKinds = [];
  clearReady = true;
  saveFound = true;
  await context.startClearStock({}, { title: '批量甲' }, {
    quiet: true,
    onResult: (kind) => quietKinds.push(kind)
  });
  assert.deepEqual(quietKinds, ['pending'], 'quiet 模式要把「已提交保存」回报成 pending，不能冒充成功');
  assert.equal(messages.length, beforeQuiet, 'quiet 模式不许出任何消息');

  // ---- ⑪ 看得见的元素绝不替用户滚动（2026-10-30「点清空之后页面自动滚动」）----
  context.window.innerHeight = 800;
  context.window.innerWidth = 1200;
  let scrolled = 0;
  const makeEl = (rect) => ({
    getBoundingClientRect: () => rect,
    scrollIntoView: () => { scrolled++; },
    click: () => {}
  });
  context.clickLikeUser(makeEl({ top: 100, left: 100, bottom: 140, right: 200 }));
  assert.equal(scrolled, 0, '元素本来就在视口里，一下都不许滚');
  context.clickLikeUser(makeEl({ top: 2000, left: 100, bottom: 2040, right: 200 }));
  assert.equal(scrolled, 1, '完全看不见时才滚，且只滚一次');

  console.log('库存保存反馈自测：通过；勾只给接口确认成功，逐个填 0 只报已提交，做不成都给叉；' +
    '看得见的元素不替用户滚动。');
})().catch(error => { console.error(error); process.exitCode = 1; });
