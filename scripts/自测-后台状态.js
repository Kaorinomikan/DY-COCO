'use strict';

/**
 * 后台状态与弹窗交互自测。
 *
 * 约束：只抽取真实源码中的函数/事件片段；chrome、storage、截图与网络均为内存桩，
 * 不访问真实浏览器、网络或系统截图。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadJsdom() {
  try { return require('jsdom'); } catch (_) {
    const root = 'C:/Users/79412/.workbuddy/binaries/node/workspace/node_modules';
    return require(path.join(root, 'jsdom'));
  }
}

const { JSDOM } = loadJsdom();
const windows = [];
const root = path.resolve(__dirname, '..');
const swSource = fs.readFileSync(path.join(root, 'src/background/service-worker.js'), 'utf8');
const flagsSource = fs.readFileSync(path.join(root, 'src/content/flags.js'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'src/popup/popup.js'), 'utf8');

function extractFunction(source, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const match = re.exec(source);
  if (!match) throw new Error('找不到函数：' + name);
  const start = match.index;
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const c = source[i];
    const n = source[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && n === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { lineComment = true; i++; continue; }
    if (c === '/' && n === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('函数边界不完整：' + name);
}

function extractBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error('找不到片段起点：' + startMarker);
  const end = source.indexOf(endMarker, start);
  if (end < 0) throw new Error('找不到片段终点：' + endMarker);
  return source.slice(start, end);
}

function makeStorage(initial = {}) {
  const data = structuredClone(initial);
  const listeners = [];
  let failSet = 0;
  return {
    data,
    onChanged: { addListener(fn) { listeners.push(fn); } },
    failNextSet(count = 1) { failSet += count; },
    get(keys, callback) {
      const wanted = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || data));
      const result = {};
      wanted.forEach((key) => { if (Object.hasOwn(data, key)) result[key] = structuredClone(data[key]); });
      const promise = Promise.resolve(result);
      if (typeof callback === 'function') promise.then(callback);
      return promise;
    },
    set(patch, callback) {
      if (failSet > 0) {
        failSet--;
        const error = Promise.reject(new Error('模拟 storage 写入失败'));
        if (typeof callback === 'function') error.catch(() => callback());
        return error;
      }
      const changes = {};
      Object.keys(patch).forEach((key) => {
        changes[key] = { oldValue: structuredClone(data[key]), newValue: structuredClone(patch[key]) };
        data[key] = structuredClone(patch[key]);
      });
      listeners.forEach((fn) => fn(changes, 'local'));
      const promise = Promise.resolve();
      if (typeof callback === 'function') promise.then(callback);
      return promise;
    }
  };
}

function makeChrome(storage, extra = {}) {
  return {
    storage: { local: storage, onChanged: storage.onChanged },
    runtime: { lastError: null, getManifest: () => ({ version: '0.0.0-test' }) },
    tabs: {},
    ...extra
  };
}

function makeContext(values = {}) {
  const ctx = {
    console,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Date,
    Error,
    TypeError,
    JSON,
    Math,
    isFinite,
    Uint8Array,
    URL,
    setTimeout,
    clearTimeout,
    structuredClone,
    ...values
  };
  vm.createContext(ctx);
  return ctx;
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('通过：' + name);
  } catch (error) {
    failed++;
    console.error('失败：' + name + '：' + (error && error.message || error));
  }
}

function assertReject(promise, message) {
  return promise.then(
    () => { throw new Error(message); },
    () => undefined
  );
}

async function testFlags() {
  const storage = makeStorage();
  const chrome = makeChrome(storage);
  const ctx = makeContext({ chrome, flagWriteQueue: Promise.resolve() });
  vm.runInContext(flagsSource, ctx, { filename: 'flags.js' });
  vm.runInContext(extractFunction(swSource, 'writeFeatureFlag'), ctx, { filename: 'service-worker.js' });

  await test('两个功能开关并发写入不互相覆盖', async () => {
    await Promise.all([
      ctx.writeFeatureFlag('liveLocate', false),
      ctx.writeFeatureFlag('clearStock', false)
    ]);
    assert.equal(storage.data.dybFeatures.liveLocate, false);
    assert.equal(storage.data.dybFeatures.clearStock, false);
  });

  await test('开关写入失败后队列仍继续执行', async () => {
    storage.failNextSet();
    await assertReject(ctx.writeFeatureFlag('liveNameWrap', false), '首个写入失败应拒绝');
    await ctx.writeFeatureFlag('liveCopyCode', false);
    assert.equal(storage.data.dybFeatures.liveCopyCode, false);
  });

  await test('未知开关键被拒绝且不写入存储', async () => {
    const before = structuredClone(storage.data.dybFeatures);
    await assertReject(ctx.writeFeatureFlag('__unknown__', true), '未知键应拒绝');
    assert.deepEqual(storage.data.dybFeatures, before);
  });
}

function makeHistoryContext() {
  const storage = makeStorage();
  let now = 1000;
  class FakeDate extends Date {}
  FakeDate.now = () => ++now;
  const chrome = makeChrome(storage);
  const ctx = makeContext({ chrome, Date: FakeDate, historyQueue: Promise.resolve(), HISTORY_STORE: 'dycPrivateHistory' });
  vm.runInContext([
    extractFunction(swSource, 'mergeHistoryItems'),
    extractFunction(swSource, 'historyRequest')
  ].join('\n'), ctx, { filename: 'service-worker-history.js' });
  return { ctx, storage };
}

function historyItem(text, options = {}) {
  return {
    type: 'success', source: '测试来源', text, count: '', time: '12:00:00', ts: Date.now(), ...options
  };
}

async function testHistory() {
  const { ctx, storage } = makeHistoryContext();
  const pageA = { tab: { url: 'https://fxg.jinritemai.com/ffa/g/channel-goods-manage/list' } };
  const pageB = { tab: { url: 'https://buyin.jinritemai.com/dashboard/live/control' } };

  await test('同页多次写入按 histKey 合并并保留最新状态', async () => {
    await Promise.all([
      ctx.historyRequest('dyc:historyMerge', [historyItem('第1轮', { key: 'autoLoop:cycle', ts: 1 })], pageA),
      ctx.historyRequest('dyc:historyMerge', [historyItem('第2轮', { key: 'autoLoop:cycle', ts: 2 })], pageA)
    ]);
    const page = new URL(pageA.tab.url).origin + new URL(pageA.tab.url).pathname;
    assert.equal(storage.data.dycPrivateHistory[page].items.length, 1);
    assert.equal(storage.data.dycPrivateHistory[page].items[0].text, '第2轮');
  });

  await test('跨页面历史互不混合', async () => {
    await ctx.historyRequest('dyc:historyMerge', [historyItem('页面B消息', { ts: 3 })], pageB);
    const a = new URL(pageA.tab.url).origin + new URL(pageA.tab.url).pathname;
    const b = new URL(pageB.tab.url).origin + new URL(pageB.tab.url).pathname;
    assert.equal(storage.data.dycPrivateHistory[a].items.some((item) => item.text === '页面B消息'), false);
    assert.equal(storage.data.dycPrivateHistory[b].items[0].text, '页面B消息');
  });

  await test('单个页面最多保留最新 100 条', async () => {
    const items = Array.from({ length: 105 }, (_, i) => historyItem('第' + (i + 1) + '条', { ts: i + 10 }));
    await ctx.historyRequest('dyc:historyMerge', items, pageA);
    const page = new URL(pageA.tab.url).origin + new URL(pageA.tab.url).pathname;
    const rows = storage.data.dycPrivateHistory[page].items;
    assert.equal(rows.length, 100);
    assert.equal(rows[0].text, '第6条');
    assert.equal(rows.at(-1).text, '第105条');
  });

  await test('历史作用域最多保留最近 20 个页面', async () => {
    for (let i = 0; i < 21; i++) {
      await ctx.historyRequest('dyc:historyMerge', [historyItem('页面' + i, { ts: 1000 + i })], {
        tab: { url: 'https://fxg.jinritemai.com/ffa/g/test-' + i }
      });
    }
    assert.equal(Object.keys(storage.data.dycPrivateHistory).length, 20);
  });

  await test('无效消息页面被拒绝', async () => {
    await assertReject(ctx.historyRequest('dyc:historyMerge', [historyItem('不该保存')], {
      tab: { url: 'http://evil.example.test/page' }
    }), '不支持的页面应拒绝');
  });
}

function makeScreenshotContext() {
  const calls = [];
  const tabs = new Map();
  const reads = new Map();
  const chrome = {
    runtime: { lastError: null },
    tabs: {
      get(id, callback) {
        const queue = reads.get(id);
        const tab = queue && queue.length ? queue.shift() : tabs.get(id);
        callback(tab || null);
      },
      captureVisibleTab(windowId, options, callback) {
        calls.push({ windowId, options });
        callback('data:image/jpeg;base64,TEST');
      }
    }
  };
  const ctx = makeContext({ chrome, delayMs: () => Promise.resolve(), captureVisibleTabSafe: (windowId) => {
    calls.push({ safeWindowId: windowId });
    return Promise.resolve('data:image/jpeg;base64,TEST');
  }, hideWindowForCapture: () => Promise.resolve(null), restoreWindowAfterCapture: () => Promise.resolve() });
  vm.runInContext(extractFunction(swSource, 'chromeCb') + '\n' + extractFunction(swSource, 'captureScreenshot'), ctx,
    { filename: 'service-worker-capture.js' });
  return { ctx, tabs, reads, calls };
}

async function testScreenshots() {
  const { ctx, tabs, reads, calls } = makeScreenshotContext();
  tabs.set(1, { id: 1, windowId: 10, active: true, url: 'https://fxg.jinritemai.com/a' });
  tabs.set(2, { id: 2, windowId: 20, active: true, url: 'https://fxg.jinritemai.com/b' });

  await test('截图请求 B 只捕获 B 所在窗口', async () => {
    const result = await ctx.captureScreenshot({ sourceTabId: 2, sourceWindowId: 20 });
    assert.equal(result.ok, true);
    assert.equal(calls.at(-1).safeWindowId, 20);
    assert.equal(calls.some((call) => call.safeWindowId === 10), false);
  });

  await test('失效来源标签页拒绝截图', async () => {
    const before = calls.length;
    tabs.set(2, { id: 2, windowId: 99, active: true, url: 'https://fxg.jinritemai.com/b' });
    const result = await ctx.captureScreenshot({ sourceTabId: 2, sourceWindowId: 20 });
    assert.equal(calls.length, before);
    assert.match(result.error, /切换|关联/);
  });

  await test('非 active 来源标签页拒绝截图', async () => {
    tabs.set(2, { id: 2, windowId: 20, active: false, url: 'https://fxg.jinritemai.com/b' });
    const before = calls.length;
    const result = await ctx.captureScreenshot({ sourceTabId: 2, sourceWindowId: 20 });
    assert.equal(calls.length, before);
    assert.match(result.error, /切换|关联/);
  });

  await test('缺少来源绑定拒绝截图', async () => {
    const before = calls.length;
    const result = await ctx.captureScreenshot({});
    assert.equal(calls.length, before);
    assert.match(result.error, /未关联/);
  });

  await test('隐藏界面后重新核对来源，切页则取消', async () => {
    tabs.set(2, { id: 2, windowId: 20, active: true, url: 'https://fxg.jinritemai.com/b' });
    reads.set(2, [
      { id: 2, windowId: 20, active: true, url: 'https://fxg.jinritemai.com/b' },
      { id: 2, windowId: 20, active: false, url: 'https://fxg.jinritemai.com/b' }
    ]);
    const before = calls.length;
    const result = await ctx.captureScreenshot({ sourceTabId: 2, sourceWindowId: 20 });
    assert.equal(calls.length, before);
    assert.match(result.error, /切换|取消/);
  });
}

async function testSafeScreenshots() {
  for (const scenario of [
    { name: '真实截图辅助函数预热后切页不执行正式抓取', states: [true, false], captures: 1 },
    { name: '真实截图辅助函数正式抓取后切页拒绝返回帧', states: [true, true, false], captures: 2 }
  ]) {
    await test(scenario.name, async () => {
      const { ctx, reads, calls } = makeScreenshotContext();
      vm.runInContext(extractFunction(swSource, 'captureVisibleTabSafe'), ctx,
        { filename: 'service-worker-safe-capture.js' });
      reads.set(2, scenario.states.map((active) => ({ id: 2, windowId: 20, active })));
      await assert.rejects(ctx.captureVisibleTabSafe(20, 2), /切换|取消/);
      assert.equal(calls.length, scenario.captures);
      assert.ok(calls.every((call) => call.windowId === 20));
    });
  }
}

function setupPopupEventContext() {
  const dom = new JSDOM('<!doctype html><body><div id="apply-note"></div></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'chrome-extension://test/popup.html'
  });
  windows.push(dom.window);
  const input = dom.window.document.createElement('input');
  input.type = 'checkbox';
  dom.window.document.body.appendChild(input);
  const row = dom.window.document.createElement('div');
  const caret = dom.window.document.createElement('span');
  const name = dom.window.document.createElement('span');
  row.append(caret, name);
  dom.window.document.body.appendChild(row);
  const gate = { on: true, calls: 0 };
  const calls = { writes: 0, applied: 0, flashes: [] };
  let resolveWrite;
  let rejectWrite;
  const ctx = makeContext({
    window: dom.window,
    document: dom.window.document,
    DYC_FLAGS_META: [{ key: 'testFlag', pages: ['liveCtrl'] }],
    flagInputs: { testFlag: input },
    foldOpeners: [{ key: 'testFlag', setGate(value) { gate.on = value; gate.calls++; } }],
    reportApplied() { calls.applied++; },
    flash(text) { calls.flashes.push(text); },
    dycWriteFlag() {
      calls.writes++;
      return new Promise((resolve, reject) => { resolveWrite = resolve; rejectWrite = reject; });
    }
  });
  vm.runInContext(extractBetween(popupSource, '/* ---- 事件绑定', '// ---- 初始状态'), ctx,
    { filename: 'popup-change-handler.js' });
  return { dom, ctx, input, gate, calls, resolveWrite: () => resolveWrite(), rejectWrite: (e) => rejectWrite(e) };
}

async function testPopupChangeHandler() {
  await test('开关变化等待后台写入成功后才提示已保存', async () => {
    const state = setupPopupEventContext();
    state.input._savedValue = false;
    state.input.checked = true;
    state.input.dispatchEvent(new state.dom.window.Event('change', { bubbles: true }));
    assert.equal(state.calls.writes, 1);
    assert.equal(state.calls.applied, 0);
    state.resolveWrite();
    await new Promise(setImmediate);
    await new Promise(setImmediate);
    assert.equal(state.calls.applied, 1);
  });

  await test('后台写入失败恢复开关与门控状态', async () => {
    const state = setupPopupEventContext();
    state.input._savedValue = true;
    state.input.checked = false;
    state.input.dispatchEvent(new state.dom.window.Event('change', { bubbles: true }));
    state.rejectWrite(new Error('模拟失败'));
    await new Promise(setImmediate);
    await new Promise(setImmediate);
    assert.equal(state.input.checked, true);
    assert.equal(state.gate.on, true);
    assert.match(state.calls.flashes.at(-1), /未保存/);
  });

  await test('重复点击只发起一次后台写入请求', async () => {
    const state = setupPopupEventContext();
    state.input._savedValue = false;
    state.input.checked = true;
    state.input.dispatchEvent(new state.dom.window.Event('change', { bubbles: true }));
    state.input.dispatchEvent(new state.dom.window.Event('change', { bubbles: true }));
    assert.equal(state.calls.writes, 1);
    state.resolveWrite();
    await new Promise(setImmediate);
  });
}

function setupHelpContext() {
  const dom = new JSDOM('<!doctype html><body><label id="host"><input id="check" type="checkbox"></label></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'chrome-extension://test/popup.html'
  });
  windows.push(dom.window);
  const ctx = makeContext({ window: dom.window, document: dom.window.document });
  vm.runInContext(extractBetween(popupSource, '/* ==== 问号气泡浮动定位 开始 ==== */', '/* ==== 问号气泡浮动定位 结束 ==== */')
    + '\n' + extractFunction(popupSource, 'attachHelpBadge'), ctx, { filename: 'popup-help.js' });
  return { dom, ctx };
}

async function testHelpKeyboard() {
  await test('帮助问号可被 Tab 聚焦并展示，Esc 收起且不切换开关', async () => {
    const { dom, ctx } = setupHelpContext();
    const host = dom.window.document.getElementById('host');
    const check = dom.window.document.getElementById('check');
    check.checked = false;
    const badge = ctx.attachHelpBadge(host, '说明');
    assert.equal(badge.tabIndex, 0);
    badge.focus();
    assert.equal(badge.getAttribute('aria-expanded'), 'true');
    badge.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(badge.getAttribute('aria-expanded'), 'false');
    assert.equal(check.checked, false);
    badge.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.equal(check.checked, false);
  });
}

(async () => {
  await testFlags();
  await testHistory();
  await testScreenshots();
  await testSafeScreenshots();
  await testPopupChangeHandler();
  await testHelpKeyboard();
  console.log('\n后台状态自测：' + passed + '/' + (passed + failed) + ' 通过');
  if (failed) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const win of windows) win.close();
});
