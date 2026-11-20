'use strict';
/* 小红书中控台 · 猫爪光标（cursor-fix.js 双平台分键）
 * ============================================================
 * 守四件事（每条都含反向验证或分键反向验证）：
 *   1. 作用页分键：pgy 中控台读 xhsCursorFix，抖音键改它不动小红书；
 *      抖音系页面读 cursorFix，小红书键改它不动抖音。
 *   2. 小红书拖拽起点 = 按下时实测光标是 grab（平台手柄没有 rbd 属性）。
 *   3. 抖音侧口径不变：非 rbd 手柄的 grab 元素按下**不**启用全页猫爪
 *      （旧口径反向验证 —— 放宽了这条就是改坏了抖音侧）。
 *   4. 排除项与松手还原照旧：按钮/右键不启用，pointerup 还原。
 * ============================================================ */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const SRC_UNDER_TEST = 'src/content/cursor-fix.js';
const source = fs.readFileSync(path.resolve(__dirname, '..', SRC_UNDER_TEST), 'utf8');
const diag = fs.readFileSync(path.resolve(__dirname, '../src/content/diag.js'), 'utf8');

const XHS_URL = 'https://pgy.xiaohongshu.com/commerce/redlive/live_center_control';
const DY_URL = 'https://buyin.jinritemai.com/dashboard/live/control';
const SCREEN_URL = 'https://pgy.xiaohongshu.com/commerce/redlive/live_screen/operation';
const PATTERNS = {
  xhsCtrl: /^https:\/\/pgy\.xiaohongshu\.com\/commerce\/redlive\/live_center_control(?:\/|[?#]|$)/,
  xhsAll: /^https:\/\/pgy\.xiaohongshu\.com\//
};

async function setup(url, flags) {
  const dom = new JSDOM(
    '<body><div class="card" style="cursor:grab">商品卡</div><button>普通按钮</button></body>',
    { runScripts: 'outside-only', url }
  );
  const w = dom.window;
  // jsdom 无法生成真实手势；事件接线照常执行，只在输入边界模拟可信来源。
  let trusted = true;
  for (const target of [w, w.document]) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    const wrappers = new WeakMap();
    target.addEventListener = (type, fn, opts) => {
      if (!/^(pointer|blur|dragend)/.test(type)) return add(type, fn, opts);
      if (!wrappers.has(fn)) wrappers.set(fn, e => fn(new Proxy(e, {
        get: (event, key) => key === 'isTrusted' ? trusted : Reflect.get(event, key, event)
      })));
      add(type, wrappers.get(fn), opts);
    };
    target.removeEventListener = (type, fn, opts) => remove(type, wrappers.get(fn) || fn, opts);
  }
  const timers = new Map();
  let seq = 0, watch;
  w.setTimeout = fn => { timers.set(++seq, fn); return seq; };
  w.clearTimeout = id => timers.delete(id);
  w.requestIdleCallback = () => 1;
  w.Image = class { set src(value) { this.onload(); } };
  w.console.log = () => {};
  w.console.warn = () => {};
  w.DYC_PAGE_PATTERNS = PATTERNS;
  w.dycReadFlags = async () => flags;
  w.dycWatchFlags = fn => { watch = fn; };
  w.eval(source);
  await Promise.resolve();
  const card = w.document.querySelector('.card');
  const button = w.document.querySelector('button');
  function fire(target, type, opts = {}) {
    const e = new w.MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10, ...opts });
    Object.defineProperty(e, 'pointerId', { value: opts.pointerId || 1 });
    Object.defineProperty(e, 'pointerType', { value: opts.pointerType || 'mouse' });
    trusted = opts.trusted !== false;
    target.dispatchEvent(e);
    trusted = true;
  }
  const cursor = el => w.getComputedStyle(el).cursor;
  function startDrag(el) {
    fire(el || card, 'pointerdown');
    fire(w, 'pointermove', { clientX: 25 });
  }
  return { w, dom, card, button, fire, cursor, startDrag, watch, timers };
}

(async () => {
  let failed = 0, passed = 0;
  async function test(name, url, flags, fn) {
    const f = await setup(url, flags);
    try { await fn(f); passed++; console.log('PASS ' + name); }
    catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
    finally { f.dom.window.close(); }
  }

  await test('小红书页：xhsCursorFix=false 不启用（显式 false 才算关）', XHS_URL, { xhsCursorFix: false }, f => {
    assert.equal(f.w.document.getElementById('dyc-cursor-fix-style'), null, '样式不该注入');
    f.startDrag();
    assert.doesNotMatch(f.cursor(f.button), /url\(/, '关着时拖拽也不启用全页猫爪');
  });

  await test('小红书页：xhsCursorFix 开着即启用，抖音键关闭不影响', XHS_URL, { xhsCursorFix: true, cursorFix: false }, f => {
    assert.ok(f.w.document.getElementById('dyc-cursor-fix-style'), '样式应注入');
    f.fire(f.card, 'mouseover');
    assert.match(f.cursor(f.card), /url\(/, 'grab 元素应换成猫爪图');
  });

  await test('小红书页：grab 元素无 rbd 属性也能启用全页拖拽猫爪', XHS_URL, {}, f => {
    f.startDrag();
    assert.match(f.cursor(f.button), /url\(/, '按下 grab 手柄拖动后，整页应继承握紧猫爪');
    f.fire(f.w, 'pointerup');
    assert.doesNotMatch(f.cursor(f.button), /url\(/, '松手立即还原');
    f.fire(f.w, 'pointermove', { clientX: 40 });
    assert.doesNotMatch(f.cursor(f.button), /url\(/);
  });

  await test('抖音页：非 rbd 手柄的 grab 元素按下不启用（旧口径不变）', DY_URL, {}, f => {
    f.startDrag();
    assert.doesNotMatch(f.cursor(f.button), /url\(/, '抖音侧仍只认 rbd 手柄，放宽即是改坏');
    assert.ok(!f.w.document.documentElement.hasAttribute('data-dyc-cursor-dragging'), '拖动态标记不该出现');
  });

  await test('抖音页：小红书键关闭不影响抖音侧', DY_URL, { xhsCursorFix: false, cursorFix: true }, f => {
    assert.ok(f.w.document.getElementById('dyc-cursor-fix-style'), '抖音侧应照常启用');
  });

  await test('小红书页：按钮与右键不启用全页猫爪', XHS_URL, {}, f => {
    f.fire(f.button, 'pointerdown');
    f.fire(f.w, 'pointermove', { clientX: 40 });
    assert.doesNotMatch(f.cursor(f.button), /url\(/, '普通按钮排除');
    f.fire(f.card, 'pointerdown', { button: 2 });
    f.fire(f.w, 'pointermove', { clientX: 40 });
    assert.doesNotMatch(f.cursor(f.button), /url\(/, '右键排除');
  });

  await test('小红书页：watch 关掉猫爪立即还原、开启恢复', XHS_URL, { xhsCursorFix: true }, f => {
    f.startDrag();
    assert.match(f.cursor(f.button), /url\(/);
    f.watch({ xhsCursorFix: false });
    assert.doesNotMatch(f.cursor(f.button), /url\(/, '拖动中关开关也要立即还光标');
    assert.equal(f.w.document.getElementById('dyc-cursor-fix-style'), null);
    f.watch({ xhsCursorFix: true });
    f.startDrag();
    assert.match(f.cursor(f.button), /url\(/, '重新开启后拖拽猫爪应恢复');
  });

  await test('直播大屏：两个开关都开启也不注入猫爪，站内切页后自动对齐', SCREEN_URL,
    { xhsCursorFix: true, cursorFix: true }, f => {
      let pollRoute;
      const setInterval = f.w.setInterval;
      f.w.setInterval = callback => { pollRoute = callback; };
      f.w.eval(diag);
      f.w.setInterval = setInterval;
      const style = () => f.w.document.getElementById('dyc-cursor-fix-style');
      function navigate(url) {
        f.w.history.pushState({}, '', url);
        pollRoute();
      }
      assert.equal(style(), null);
      f.watch({ xhsCursorFix: true, cursorFix: true });
      assert.equal(style(), null);
      navigate(XHS_URL);
      assert.ok(style());
      navigate(SCREEN_URL);
      assert.equal(style(), null);
    });

  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
