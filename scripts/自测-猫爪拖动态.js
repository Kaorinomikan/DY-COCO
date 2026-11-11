'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const SRC_UNDER_TEST = 'src/content/cursor-fix.js';
const source = fs.readFileSync(path.resolve(__dirname, '..', SRC_UNDER_TEST), 'utf8');

async function setup() {
  const dom = new JSDOM('<body><div data-rbd-drag-handle-draggable-id="1"><svg><path/></svg></div><button>普通按钮</button></body>', { runScripts: 'outside-only' });
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
  w.dycReadFlags = async () => ({});
  w.dycWatchFlags = fn => { watch = fn; };
  w.eval(source);
  await Promise.resolve();
  const handle = w.document.querySelector('[data-rbd-drag-handle-draggable-id]');
  const child = handle.querySelector('path');
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
  function start() {
    fire(child, 'pointerdown');
    fire(w, 'pointermove', { clientX: 25 });
  }
  return { w, dom, handle, child, button, fire, cursor, start, watch, timers };
}

(async () => {
  let failed = 0, passed = 0;
  async function test(name, fn) {
    const f = await setup();
    try { await fn(f); passed++; console.log('PASS ' + name); }
    catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
    finally { f.dom.window.close(); }
  }
  await test('悬停非抓手，按下才变 grabbing 仍能识别', f => {
    f.handle.style.cursor = 'default';
    f.fire(f.handle, 'mouseover');
    f.handle.style.cursor = 'grabbing';
    f.fire(f.handle, 'mousedown');
    assert.equal(f.handle.hasAttribute('data-dyc-cursor-fix'), true);
  });
  await test('SVG 手柄拖动后，浮层与整页继承握紧猫爪', f => {
    f.start();
    const overlay = f.w.document.createElement('div');
    overlay.style.cursor = 'grabbing';
    f.w.document.body.appendChild(overlay);
    for (const el of [f.w.document.body, f.child, overlay]) assert.match(f.cursor(el), /url\(/);
  });
  await test('悬停猫爪与拖动猫爪使用不同图像', f => {
    f.handle.style.cursor = 'grab';
    f.fire(f.handle, 'mouseover');
    const hover = f.cursor(f.handle);
    f.start();
    assert.match(hover, /url\(/);
    assert.ok(f.cursor(f.handle) !== hover, '按住后应换成收拢图');
  });
  for (const event of ['pointerup', 'pointercancel', 'blur', 'dragend']) {
    await test(event + ' 立即还原光标', f => {
      f.start();
      assert.match(f.cursor(f.button), /url\(/);
      f.fire(f.w, event);
      assert.doesNotMatch(f.cursor(f.button), /url\(/);
      f.fire(f.w, 'pointermove', { clientX: 40 });
      assert.doesNotMatch(f.cursor(f.button), /url\(/);
    });
  }
  await test('点击手柄未移动、普通按钮、右键都不启用全页猫爪', f => {
    f.fire(f.child, 'pointerdown');
    f.fire(f.w, 'pointermove', { clientX: 12 });
    assert.doesNotMatch(f.cursor(f.button), /url\(/);
    f.fire(f.w, 'pointerup');
    f.fire(f.button, 'pointerdown');
    f.fire(f.w, 'pointermove', { clientX: 40 });
    assert.doesNotMatch(f.cursor(f.button), /url\(/);
    f.fire(f.child, 'pointerdown', { button: 2 });
    f.fire(f.w, 'pointermove', { clientX: 40 });
    assert.doesNotMatch(f.cursor(f.button), /url\(/);
  });
  await test('拖动中关闭再开启，不残留拖动态', f => {
    f.start();
    assert.match(f.cursor(f.button), /url\(/);
    f.watch({ cursorFix: false });
    assert.doesNotMatch(f.cursor(f.button), /url\(/);
    f.watch({ cursorFix: true });
    assert.doesNotMatch(f.cursor(f.button), /url\(/);
    f.start();
    assert.match(f.cursor(f.button), /url\(/);
  });
  await test('合成松手和其他指针不打断真实拖动', f => {
    f.start();
    f.fire(f.w, 'pointerup', { trusted: false });
    assert.match(f.cursor(f.button), /url\(/);
    f.fire(f.w, 'pointerup', { pointerId: 2 });
    assert.match(f.cursor(f.button), /url\(/);
    f.fire(f.w, 'pointerup');
    assert.doesNotMatch(f.cursor(f.button), /url\(/);
  });
  await test('拖动中连续移动只写一次状态标记', async f => {
    let writes = 0;
    const observer = new f.w.MutationObserver(records => { writes += records.length; });
    observer.observe(f.w.document.documentElement, { attributes: true });
    f.start();
    for (let i = 0; i < 20; i++) f.fire(f.w, 'pointermove', { clientX: 30 + i });
    await Promise.resolve();
    observer.disconnect();
    assert.equal(writes, 1);
  });
  await test('丢失松手事件后超时恢复', f => {
    f.start();
    const timeout = [...f.timers.values()].at(-1);
    timeout();
    assert.doesNotMatch(f.cursor(f.button), /url\(/);
  });
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
