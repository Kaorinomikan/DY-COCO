'use strict';
// 行内库存读成 0 时先问接口（2026-10-29 反馈 #124）
// 关键口径：不能再凭页面上那个 0 直接拦掉；接口说没有才算没有，查不到要明说。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '../src/content/inject-button.js'), 'utf8');
const start = code.indexOf('function handleClearStockClick(');
assert.ok(start > 0, '源码里没找到 handleClearStockClick');
const source = code.slice(start);   // 其后依次是 openClearConfirm / verifyZeroStockThenOpen

const toastLog = [];
const dialogs = [];
const feedbacks = [];
let info = { title: '商品甲', productId: '3456789012', totalStock: 0 };
let probeCalls = 0;
let probeResult = 5;

const context = vm.createContext({
  extractProductInfo: () => info,
  clearStockFeedback: (row, result) => feedbacks.push(result),
  toast: (text, kind, opts) => toastLog.push({ text, kind, opts }),
  showConfirmDialog: (opts) => dialogs.push(opts),
  startClearStock: () => {},
  debugLog: () => {},
  window: {
    __DYC_STOCK_DIRECT__: {
      probeStockTotal() { probeCalls++; return Promise.resolve(probeResult); }
    }
  }
});
vm.runInContext(source, context);

const tick = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  // ① 行内读成 0，接口说实际有 5 ⇒ 照常弹确认框，不拦
  info = { title: '商品甲', productId: '3456789012', totalStock: 0 };
  probeResult = 5;
  context.handleClearStockClick({});
  await tick();
  assert.equal(probeCalls, 1, '读成 0 时应先问接口');
  assert.equal(dialogs.length, 1, '接口说有库存就必须让用户能清');
  assert.equal(toastLog.length, 0, '不该弹「库存已经没有了」');

  // ② 接口说真的没有了 ⇒ 报无需清零，不弹确认框
  probeResult = 0;
  context.handleClearStockClick({});
  await tick();
  assert.equal(dialogs.length, 1, '确实为 0 时不应弹确认框');
  assert.equal(toastLog[toastLog.length - 1].text, '库存已经没有了');

  // ③ 接口查不到 ⇒ 明说没读到，不能冒充「本来就没了」
  probeResult = null;
  context.handleClearStockClick({});
  await tick();
  assert.match(toastLog[toastLog.length - 1].text, /没能读到库存明细/);

  // ④ 直提模块没加载 ⇒ 退回原来的拦截口径（不能因为缺模块就弹确认框）
  const saved = context.window.__DYC_STOCK_DIRECT__;
  delete context.window.__DYC_STOCK_DIRECT__;
  const before = dialogs.length;
  context.handleClearStockClick({});
  await tick();
  assert.equal(dialogs.length, before, '没有探针时不应弹确认框');
  assert.equal(toastLog[toastLog.length - 1].text, '库存已经没有了');
  context.window.__DYC_STOCK_DIRECT__ = saved;

  // ⑤ 行内库存正常（非 0）⇒ 直接弹确认框，不必问接口
  const calls0 = probeCalls;
  info = { title: '商品乙', productId: '3456789012', totalStock: 12 };
  context.handleClearStockClick({});
  await tick();
  assert.equal(probeCalls, calls0, '库存不是 0 时不该多打一次接口');
  assert.equal(dialogs.length, before + 1);

  // ⑥ 认不出商品 ⇒ 按钮给叉 + 报错，不弹确认框
  info = { title: '', productId: '', productCode: '' };
  const d0 = dialogs.length;
  context.handleClearStockClick({});
  await tick();
  assert.equal(dialogs.length, d0);
  assert.equal(feedbacks[feedbacks.length - 1], 'fail');

  console.log('库存零值探针自测：13/13 通过；行内 0 不再直接拦，接口说有就照常清，查不到明说。');
})().catch((error) => { console.error(error); process.exitCode = 1; });
